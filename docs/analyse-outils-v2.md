# Analyse — ce que les nouveaux outils peuvent apporter au site v2

Date : 2026-11-26. Base : commit `23613de` (v2 livrée, validée PERFECT ×3) + installs **non commités**
(package.json / package-lock / tsconfig / vite.config modifiés).

## 1. Ce qui a été installé, et ce qui est déjà câblé

| Package | Dans package.json ? | Câblé dans le build ? | Utilisé dans `src/` ? |
|---|---|---|---|
| `three` 0.170 → **0.187** | oui | oui (upgrade) | oui — et r187 embarque `three.webgpu.js` (WebGPURenderer + TSL) |
| `vgpu` 0.6 (+ `@vgpu/wgsl`, `@webgpu/types`, `wgpu-matrix`) | oui | **oui** : `wgslVitePlugin()` dans `vite.config.ts`, types `@webgpu/types` + `@vgpu/wgsl/wgsl-types` dans `tsconfig.json` | **non** — aucun shader WGSL, aucun device |
| `three-mesh-bvh` 0.10 | oui | non | **non** |
| `@vercel/analytics` + `@vercel/speed-insights` | oui | non | **non** |
| `@dimforge/rapier3d-compat` | non (présent dans lock/node_modules) | non | **non** |
| `@tweenjs/tween.js` | non (présent) | non | **non** |
| `meshoptimizer` | non (présent) | non | **non** |
| `@modelcontextprotocol/core` + `server` | non (présent) | non | **non** |
| `webgpu` (node) + `@vgpu/adapter-node` / `adapter-mock` | non (présent) | non | **non** |
| `vite` 5 → 8, `typescript` 5 → 7 | oui | oui | — |

Lecture : le câblage WGSL/WebGPU dans `vite.config.ts` + `tsconfig.json` montre une intention claire
(côté WebGPU), mais **aucun outil n'est encore branché dans le code**. Le site tourne toujours
100 % WebGL2 + canvas 2D + raycasting CPU + clamps manuels.

## 2. Photo de la v2 — où sont les leviers

- **Rendu** : Three.js WebGL2, scène procédurale (`src/gallery/scene.ts`) : parquet 4096², plâtre 2048²
  (26 000 `fillRect`), plafond, tapis — générés **en canvas 2D synchrone au boot** → main thread bloqué
  au chargement (impacte le LCP perçu avant le loader).
- **Pick** : `THREE.Raycaster` CPU sur les seuls plans des tableaux (`main.ts` hover à chaque
  `pointermove`, `controls.ts` `tap()` qui **recrée un Raycaster à chaque tap**).
- **Mode libre** : collisions = clamps AABB manuels (`controls.ts` `update()` : `clamp(x, ±(HALL_WIDTH/2-0.8))`,
  `clamp(z, zEnd+1 … Z_START+1.6)`) → on traverse les bancs et les portails.
- **Caméra** : lerp manuels partout (`dt*7.5` pour t, `dt*3` pour le regard, `dt*5` pour le focusAnim).
- **Images** : `scripts/build-data.mjs` (sharp) → JPEG uniquement, 2 tailles (800 px + full ~2000 px),
  ~1,1 Mo pour 5 œuvres, pas de WebP/AVIF, pas de `srcset`, pas de LQIP.
- **Perf par frame** (`main.ts` `tick()`) : `[...entries].sort(...)` **à chaque frame** pour le pool de
  spots ; `currentIndex()` en O(n) à chaque frame.
- **Tests** : harness maison Playwright headless (SwiftShader) dans `.vibe/shotkit/`, piloté à la main.
- **Prod** : Vercel, mais aucun analytics branché malgré les packages installés.

## 3. Opportunités, outil par outil

### A. `@vercel/analytics` + `@vercel/speed-insights` — pertinence HAUTE, effort ~5 min
`inject()` + `injectSpeedInsights()` dans `main.ts`, conditionnés à `import.meta.env.PROD`.
Donne les **Core Web Vitals réels** (LCP, INP, CLS) en prod → c'est exactement ce qui manque à
l'itération F du `plan-dev-v2.md`. Cookieless, ~3 Ko, hébergement déjà sur Vercel.
Risque : quasi nul. À prendre tel quel.

### B. `@tweenjs/tween.js` — pertinence HAUTE (ressenti), effort faible
Remplacer les lerp manuels de `controls.ts` (focusAnim `dt*5`, retour guidé, `lookVec` `dt*3`)
par des tweens avec easing (`Cubic.Out` / `Expo.Out`), en respectant `prefers-reduced-motion`.
Transitions « focus œuvre », « retour visite guidée », ouverture du panneau : sensation expo immediate.
Risque faible : garder le mode guidé piloté par le scroll (lerp sur `targetT` inchangé).

### C. `three-mesh-bvh` — pertinence MOYENNE aujourd'hui, HAUTE si la scène devient cliquable
Aujourd'hui le pick ne touche que N plans → le BVH n'apporte rien. Mais dès qu'on veut rendre
cliquables les **plaques de salles** (naviguer directement), les bancs, les portails — ou importer des
modèles 3D — un BVH global (`mesh.geometry.boundsTree = new MeshBVH(geo)` + `raycaster.firstHitOnly = true`)
accélère le raycast ×10–100 et simplifie le code (un seul raycast sur la scène, plus de `pickMeshes`).
Effort faible. À coupler avec l'idée « clic plaque de salle → focus salle ».

### D. `@dimforge/rapier3d-compat` — pertinence MOYENNE, chantier mode libre
Remplacer les clamps manuels par un **capsule collider** (character controller) contre des colliders
des murs, bancs, portails, tableaux : le mode libre cesse de traverser les bancs et glisse le long
des murs. WASM ~1,5 Mo chargé **lazy** au premier passage en mode libre (zéro coût au chargement).
Peut aussi fournir les raycasts physiques (remplacer `THREE.Raycaster`). Effort moyen ; bien borner
la source de vérité de position (rapier vs `controls.pos`).

### E. `vgpu` + WGSL (WebGPU) — pertinence HAUTE, choisir le bon chantier
Le plugin WGSL est déjà câblé : la porte est ouverte. Trois chantiers possibles, par ordre de ROI :

1. **E1 — Textures procédurales en compute shader** (runtime) : déplacer la génération plâtre /
   parquet / plafond / tapis du canvas 2D CPU (`scene.ts`) vers un compute WGSL qui écrit directement
   dans une texture GPU. Gain : boot + LCP, main thread libéré. **Fallback obligatoire** : garder le
   canvas 2D si `navigator.gpu` absent (Safari < 26).
2. **E2 — Précalcul build-time en Node** (`webgpu` + `@vgpu/adapter-node`) : générer les textures 4K
   offline au `prebuild` → PNG/WebP/KTX2 statiques servis, **zéro coût runtime**, rendu identique
   partout, testable en CI. Recommandé en premier : aucun risque côté navigateur.
3. **E3 — Migrer le renderer vers `WebGPURenderer`** (`three.webgpu.js`, r187) avec fallback WebGL2 :
   plus gros chantier (matériaux TSL, double maintenance), gain perf sur devices WebGPU.
   À réserver si E1/E2 ne suffisent pas. vgpu reste utile en parallèle pour le compute pur.
4. **E4 — Post-processing WebGPU** (bloom doux sur lentilles/luminaires) : le grain est déjà en CSS ;
   le bloom WebGL existe déjà en addon three. Moyen.

### F. `webgpu` (node) + `@vgpu/adapter-node` — support de E2 + tests plus fidèles
Dawn en Node permet de (a) précalculer les textures au build (E2), (b) rendre la scène en headless
avec un **vrai GPU logiciel WebGPU** au lieu de SwiftShader → screenshots et mesures de perf
beaucoup plus proches du réel dans le shotkit.

### G. `meshoptimizer` — pertinence FAIBLE aujourd'hui
Toute la géométrie est procédurale (Box/Plane/Extrude) : rien à compresser. Devient utile dès qu'on
importe des **GLB réels** (banc sculpté, moulures, luminaires modélisés) : compression meshopt + decode
côté client. À garder en réserve, pas prioritaire.

### H. `@modelcontextprotocol/server` — pertinence HAUTE pour le dev, zéro impact prod
Créer un **serveur MCP local** (`scripts/mcp-server.mjs`, devDependency, jamais bundlé) qui expose
le projet à l'agent : `build()`, `shoot(specs)` / `measure()` / `console_errors()` (réutilise le
Playwright de `.vibe/shotkit/`), `perf()` (lit `__gallery.perf()`), `works list/get/update`,
`verify(dup)`. Industrialise le workflow aujourd'hui manuel. Permet aussi de piloter l'admin/data
sans toucher au clavier.

### I. `sharp` (déjà là) — pousser l'itération D du plan
Passer de « JPEG 800 + full » à **WebP/AVIF + `srcset` (480/800/1200/2000) + LQIP blur-up**
(+ KTX2 pour les textures 3D via E2). Divise la bande passante par ~2–3 et améliore le LCP.

## 4. Séquencement recommandé

| Ordre | Quoi | Pourquoi en premier |
|---|---|---|
| 1 | A. Analytics + Speed Insights | 5 min, prod, donne les métriques qui pilotent tout le reste |
| 2 | B. tween.js sur la caméra | ressenti immédiat, faible risque |
| 3 | I. sharp : WebP/AVIF + srcset + LQIP | LCP, bande passante |
| 4 | E2. Textures procédurales précalculées en Node WebGPU (build-time) | zéro risque runtime, qualité 4K garantie partout |
| 5 | E1. Compute WGSL runtime (avec fallback canvas 2D) | si E2 insuffisant côté poids réseau |
| 6 | C. BVH + clic scène (plaques de salles, etc.) | quand on rend plus d'éléments interactifs |
| 7 | D. Rapier pour le mode libre | polish du mode libre (collisions réelles) |
| 8 | H. Serveur MCP local | industrialise les itérations (peut être fait quand on veut) |
| — | G. meshoptimizer | en réserve, utile seulement avec des GLB |

## 5. Poids réseau & latence — mesures réelles (2026-11-26)

Tailles mesurées dans `node_modules` (brut → gzip quand pertinent) :

| Package | Poids | Stratégie | Coût au 1er écran |
|---|---|---|---|
| `three` (déjà là) | 644 Ko min | eager (inchangé) | déjà payé aujourd'hui |
| `vgpu` | ~537 Ko de JS dist (wrapper JS pur de l'API native, **pas de WASM**) | eager si E1, sinon build only | ~50–100 Ko gzip |
| `@tweenjs/tween.js` | 104 Ko brut → **6 Ko gzip** | eager | négligeable |
| `three-mesh-bvh` | 292 Ko brut → **64 Ko gzip** | eager | faible |
| `@vercel/analytics` + `speed-insights` | 8 Ko chacun brut, chargement async | eager (prod only) | ~3 Ko gzip |
| `@dimforge/rapier3d-compat` | **1,4 Mo WASM** + ~190 Ko glue ESM | **lazy** (`import()` au 1er passage en mode libre) | 0 si lazy, +1,4 Mo si eager |
| `meshoptimizer` | 181 Ko brut | build only (ou decode client si GLB) | 0 aujourd'hui |
| `@modelcontextprotocol/*` | 1,3 Mo + 6,2 Mo | **Node uniquement** (dev) | jamais servi au navigateur |
| `webgpu` (node, Dawn) | 68 Mo | **Node uniquement** (build/tests) | jamais servi au navigateur |
| `sharp` | natif | build only | 0 |

**Latence d'input : inchangée.** WebGPU rend dans le même frame à 60 Hz (vsync) que WebGL2 ;
le `pointermove` est traité avant le render, comme aujourd'hui. Aucun ajout de latence de clic/scroll.

**Seul vrai coût de démarrage WebGPU** : la compilation des pipelines WGSL (~100–300 ms la première
fois, ensuite servie depuis le cache du navigateur). Pour un compute one-shot au boot, imperceptible.

**Support WebGPU** : Chrome/Edge 113+ (2023), Firefox 141+ (2025-07), Safari 26+ (2025-09).
→ Safari < 26 n'a pas WebGPU : **fallback obligatoire** (garder le générateur canvas 2D actuel comme
chemin par défaut, WGSL en enhancement). C'est le design prévu pour E1/E2.

**Le gain de latence vient d'ailleurs** : main thread libéré au boot (textures en compute ou
précalculées = plus de canvas 2D synchrone de plusieurs centaines de ms), et images en
WebP/srcset (moins d'octets → LCP meilleur).

**Risques réels** : double backend à maintenir pour les textures (WGSL + canvas 2D) ; debug WebGPU
plus rude (`chrome://gpu`, erreurs Dawn) ; avec Rapier, deux sources de vérité pour la position
caméra à borner ; analytics = données envoyées à Vercel (cookieless).

**Verdict chiffré** : A+B+C+E2+H = ~120 Ko gzip ajoutés, 0 WASM côté client, latence input inchangée.
Seul Rapier ajoute du poids (1,4 Mo) → lazy obligatoire.

## 6. Bonus — dettes perf remarquées dans le code (hors outils)

- `src/main.ts` `tick()` : `[...entries].sort(...)` **à chaque frame** pour le pool de spots
  (les z sont fixes → précalculer l'ordre ou garder un index de proximité).
- `src/main.ts` `currentIndex(camZ)` : boucle O(n) à chaque frame → recherche binaire (z décroissants).
- `src/gallery/controls.ts` `tap()` : `new THREE.Raycaster()` recréé à chaque tap → singleton.
- `src/gallery/scene.ts` : génération canvas 2D synchrone au boot (parquet 4096²…) → E1/E2.
- `?dup=N` et `window.__gallery` exposés en prod : utiles pour les tests headless — à documenter,
  éventuellement derrière un flag `?debug`.
