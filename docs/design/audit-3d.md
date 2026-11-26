# Audit technique 3D — galerie Eric Houvenagel

| | |
|---|---|
| Dépôt | `C:/Users/Hijo/Documents/Antigravity/Mistral/Eric Houvenagel` |
| Branche auditée | `design/direction-v3` (HEAD `9508c91`) |
| Date | 2026-11-26 |
| Périmètre | rendu 3D uniquement : `src/gallery/scene.ts`, `src/gallery/paintings.ts`, boucle `tick()` de `src/main.ts`, `src/gallery/layout.ts` (repères), `vite.config.ts` (contexte stack) |
| Hors périmètre | UI/DOM (`src/ui.ts`), minimap, physique Rapier, pipeline images `scripts/build-data.mjs`, audio |
| Stack constatée | three `0.187.0` (installée), Vite `^8.4.0`, TypeScript `^7.0.2`, `three-mesh-bvh ^0.10.0`, `vgpu ^0.6.0`, `@webgpu/types ^0.1.74`, plugin `@vgpu/wgsl/loader-vite` (`vite.config.ts:1-2`) |
| Nature | audit + direction. **Aucun code modifié.** Les chemins de type « `src/gallery/scene.ts:404` » sont cliquables au sens fichier:ligne. |

**Méthode.** Lecture intégrale des trois fichiers de rendu ; recalcul des positions monde avec `three` (matrices `Object3D.localToWorld`) pour vérifier les coplanarités ; vérification des API réellement présentes dans `node_modules/three@0.187.0` (passes GLSL `examples/jsm/postprocessing/*`, nœuds TSL `examples/jsm/tsl/display/*`, comportement du tone mapping en render target, repli WebGL 2 de `WebGPURenderer`). Les chiffres de type « texel de shadow map » ou « irradiance relative » sont dérivés de ces calculs, pas d'une mesure au runtime : les mesures GPU restent à faire via `window.__gallery.perf()` (voir §6).

---

## 1. État des lieux

### 1.1 Chaîne de rendu actuelle

```
WebGLRenderer (antialias: true)          scene.ts:277
 ├─ outputColorSpace = sRGB (défaut)      —
 ├─ toneMapping = ACESFilmic, exposure 1.0 scene.ts:279-280
 ├─ shadowMap.enabled = !coarse           scene.ts:281 ; main.ts:105
 └─ shadowMap.type = PCFSoftShadowMap     scene.ts:282

renderer.render(scene, camera)            main.ts:477  (aucun composer, aucune passe)
```

Aucun post-processing : `renderer.render()` est appelé directement dans `tick()` (`src/main.ts:477`) et aucun module de `three/examples/jsm/postprocessing/` n'est importé dans `src/` (vérifié par recherche sur tout `src/`). Le rendu final est donc celui des matériaux, tone-mappé par le shader de matériau.

### 1.2 Géométrie de la salle

| Élément | Valeur | Réf. |
|---|---|---|
| Largeur / hauteur / hauteur d'accrochage | 12 m / 3,4 m / 1,55 m | `layout.ts:3-5` |
| Espacement des œuvres | 3,0 m | `layout.ts:6` |
| Départ caméra | z = 5,5 | `layout.ts:8` ; `scene.ts:299` |
| Emprise Z de la salle | `zMax = 8,5`, `zMin = zEnd − 2` → **longueur 25,5 m** pour 5 œuvres (`zEnd = −15`) | `layout.ts:46-48` ; `scene.ts:289-290` |
| Épaisseur des murs | 0,25 m, centrés sur x = ±6 → **face intérieure x = 5,875** | `scene.ts:392-395` |
| Plafond | 1 seule dalle plane 12 × 25,5 m à y = 3,4 | `scene.ts:386-387` |
| Verrière | vitre émissive 5,04 × 23,97 m **sous** la dalle (y = 3,385), + 4 cadres, 3 meneaux, 10 traverses | `scene.ts:397-425` |
| Moulures | couronne 0,09 × 0,14 m ; plinthe 0,05 de large × 0,10 de haut × 0,04 de saillie | `scene.ts:427-452` |
| Nombre d'objets « décor » | ≈ 53 meshes (3 sols/plafond, 4 murs, 18 verrière, 4 moulures, 10 cimaise/panneaux, 6 bancs, 8 portails) | `scene.ts:376-484` |

Les 5 œuvres de `data/works/` ont toutes `ratio = 1` → toile **1,50 × 1,50 m**, `w > 2.4` jamais atteint (`layout.ts:56-62`).

### 1.3 Lumière

| Source | Valeur | Réf. |
|---|---|---|
| Hémisphérique | `0xffffff / 0xcfc4b2`, 0,5 | `scene.ts:301` |
| Directionnelle « soleil » | `0xfff2df`, **2,3**, position (2,5 ; 15 ; cz) | `scene.ts:303-305` |
| Environnement IBL | PMREM `RoomEnvironment`, blur 0,04 | `scene.ts:294-296` |
| Spots « tableau » | pool 3 (desktop) / 1 (mobile), `0xfff1da`, `distance 8`, `angle 0,48`, `penumbra 1,0`, `decay 1,8`, **intensité 15**, castShadow sur les 2 premiers | `scene.ts:323-334` ; `main.ts:412-424` |

Répartition indirecte : **une seule** estimation d'éclairage indirect, l'environnement PMREM (non occlus, `RoomEnvironment` = studio générique), modulé par `envMapIntensity` par matériau (plâtre 0,5 ; sol 0,6 ; plafond 0,3 ; bois 0,7 ; métal 0,5 ; toile 0,25 — `scene.ts:338-376`, `paintings.ts:110`). Aucun terme d'occlusion, aucune occlusion ambiante, aucun rebond.

Deux conséquences structurelles, vérifiables :

1. **La dalle de plafond ne projette pas d'ombre** : `add()` ne pose que `receiveShadow` (`scene.ts:378-385`) ; ni le plafond, ni les meneaux, ni les traverses de verrière ne sont `castShadow`. Le soleil directionnel éclaire donc le sol **comme si le toit n'existait pas**, à pleine intensité (normale du sol `+y`, lumière quasi verticale).
2. **Les œuvres ne reçoivent pas le soleil** : leur normale est `−x`, le soleil vient de (2,5 ; 15 ; cz) → `dot(N, L) < 0`. Elles sont donc éclairées presque exclusivement par le spot (voir §2, P1-3) et par l'IBL.

### 1.4 Matériaux

| Matériau | Paramètres | Réf. |
|---|---|---|
| Plâtre (murs) | `map` = `bumpMap` = 2048², `bumpScale 0,02`, `roughness 0,94`, `envMapIntensity 0,5` | `scene.ts:337-343` |
| Parquet | `MeshPhysicalMaterial`, `roughness 0,38` + roughnessMap, `clearcoat 0,5`, `clearcoatRoughness 0,4`, `envMapIntensity 0,6` | `scene.ts:345-353` |
| Plafond | 2048², `roughness 1`, `envMapIntensity 0,3` | `scene.ts:354-358` |
| Boiseries (bancs, portails) | `MeshPhysicalMaterial`, `0x6e5638`, `clearcoat 0,35` | `scene.ts:359-365` |
| Moulures | `0xf8f4ec`, `roughness 0,9`, `envMapIntensity 0,4` | `scene.ts:366` |
| Métal sombre (châssis verrière) | `0x3a3d42`, `roughness 0,4`, `metalness 0,6`, `envMapIntensity 0,5` | `scene.ts:367` |
| Verrière (virre) | `MeshStandardMaterial`, `emissive 0xfffdf2`, **`emissiveIntensity 0,95`**, `roughness 0,15` | `scene.ts:399-408` |
| Tapis | 1024², `roughness 1`, `envMapIntensity 0,15`, polygonOffset | `scene.ts:368-376` |
| Cadre | `MeshPhysicalMaterial`, `0x8a6a45`, `roughness 0,32`, `clearcoat 0,4` | `paintings.ts:103-108` |
| Passe-partout | `0xffffff`, `roughness 0,92`, `envMapIntensity 0,3` | `paintings.ts:110` |
| Boîtier de picture light | `0x2b2e33`, `roughness 0,35`, `metalness 0,65`, `envMapIntensity 0,6` | `paintings.ts:111` |
| Lentille | `MeshBasicMaterial 0xfff3dd` (non éclairée, non émissive) | `paintings.ts:112` |
| Toile | `0xe3ded6`, `roughness 0,88`, `envMapIntensity 0,25` ; après chargement : `map` + `emissiveMap` = texture, `emissive` blanc, **`emissiveIntensity 0,1`** (0,3 au survol) | `paintings.ts:134` ; `174-181` ; `27-32` |

### 1.5 Objets par œuvre et ombres

Chaque œuvre est un `Group` de **9 meshes** (`paintings.ts:163`) : cadre, passe-partout, toile, 2 bras, boîtier, lentille, « ombre » factice, cartel. Soit 45 draw calls pour 5 œuvres, ≈ 98 objets au total avec le décor.

Ombres projetées : `castShadow` sur les cadres (5), boîtiers (5), bancs (6), portails (6) = **22 objets** ; 3 lumières projettent (soleil + 2 spots) → jusqu'à 66 draw calls d'ombre par frame, hors culling. Repère mesuré existant : **203 draw calls à `?dup=8`** (`docs/revue-10.md`, section 2).

### 1.6 Boucle

`tick()` (`main.ts:373-479`) : `dt` plafonné à 50 ms (`main.ts:374`), `controls.update`, LRU de textures (`main.ts:376-381`), raycast de survol BVH (`main.ts:382-393`), pool de spots (`main.ts:409-424`), fenêtre d'ombre du soleil recalculée **à chaque frame** (`main.ts:427-433`), puis 4 accès `document.getElementById` par frame (`main.ts:207,436,440-441`), et `renderer.render` (`main.ts:477`).

Instrumentation existante : `window.__gallery = { renderer, scene, layout, controls, perf() }` (`main.ts:482-488`), `perf()` renvoyant `renderer.info.render` + `renderer.info.memory`.

---

## 2. Problèmes constatés

Synthèse des priorités (P0 = casse la lecture de la scène, P1 = tue la crédibilité, P2 = qualité/coût) :

| # | Problème | Preuve | Effet visuel |
|---|---|---|---|
| P0-1 | Cadre en bois **enterré dans le mur** ; passe-partout **exactement coplanaire** | `paintings.ts:130-133` + `layout.ts:68` + `scene.ts:392-395` | Aucun cadre visible, bande blanche qui scintille |
| P0-2 | Picture light = barre noire plus large que la toile, et il n'émet aucune lumière | `paintings.ts:111,150-154` ; `main.ts:419-422` | Barre noire dominante au-dessus de chaque œuvre |
| P0-3 | `emissiveIntensity 0,1` (0,3 au survol) sur la texture de la toile | `paintings.ts:30,177-179` | Toile « rétroéclairée », noirs remontés, contraste figé |
| P0-4 | Aucun post-processing alors que l'ACES est déjà en place | `main.ts:477` ; aucun import `postprocessing/*` | Rendu « CAD » : arêtes dures, pas de contact, pas de halo |
| P1-1 | Éclairage 100 % direct, zéro occlusion (ni AO, ni GI, ni ombre de contact) | `scene.ts:294-305` | Pas de contact plinthe/sol, pas de contact cadre/mur, murs plats |
| P1-2 | Ombre du soleil trop grossière + `normalBias 0,02` + fenêtre recalculée par frame | `scene.ts:310-319` ; `main.ts:427-433` | Ombre floue, décalée, qui « nage » |
| P1-3 | Le soleil traverse le plafond ; la verrière n'éclaire rien | `scene.ts:378-385,386,397-425` | Aucune tache de lumière, aucune trame de meneaux au sol |
| P1-4 | Pool de 3 spots qui se téléportent, sans fondu ni hystérésis | `main.ts:409-424` | Pop de lumière sur 2 œuvres à la fois |
| P1-5 | Spot déporté (0,35 m sur le côté, 0,55 m en avant) et `penumbra 1,0` | `main.ts:419-420` ; `scene.ts:325` | Lumière qui ne vient pas du luminaire, hotspot central |
| P1-6 | Verrière émissive 0,95 = dalle blanche brûlée, sans diffusion | `scene.ts:399-408` | Plafond surexposé, tiers haut de l'image sans détail |
| P1-7 | `Fog(0xfaf7f2, 18, 45)` ≈ 28 % de voile au fond, couleur = fond de scène | `scene.ts:288,292` | Extrémité de salle délavée, profondeur écrasée |
| P1-8 | Anisotropie des œuvres (8 / 4) < décor (16 / 8) | `main.ts:108` ; `scene.ts:285` | Scintillement sur le sujet même de la scène |
| P2-1 | Passe-partout et cadre sans biseau, sans fenêtre, sans ombre réelle | `paintings.ts:130-133,156-157` | Cadres plats, façon affiche |
| P2-2 | Ombres factices enterrées dans le mur | `paintings.ts:156-157` (x monde 5,962) | Géométrie morte, coût nul mais 1 draw call/œuvre |
| P2-3 | Coûts : 3 passes d'ombre/frame, 4096² partout, 9 meshes/œuvre, DOM par frame | `main.ts:427-433,207,436,440-441` ; `docs/textures-precalc.md` | Budget frame non maîtrisé, mobile défavorisé |
| P2-4 | Échelle de texture du plâtre différente murs longs / murs de bout | `scene.ts:93` + `392-395` | Grain visiblement 2× plus fin sur les murs de bout |
| P2-5 | IBL = `RoomEnvironment` (studio) réfléchi par un parquet clearcoaté | `scene.ts:294-296,346-353` | Reflets « plastique » sans rapport avec la salle |

### P0-1 — Le cadre est dans le mur, le passe-partout est coplanaire

**Preuve (positions monde calculées, `three` 0.187).** Le groupe est posé à `x = HALL_WIDTH/2 − 0,08 = 5,92` (`layout.ts:68`) avec `rotation.y = −π/2` (`paintings.ts:126`), donc `x_monde = 5,92 − z_local`. La face intérieure du mur est à `6 − 0,25/2 = 5,875` (`scene.ts:392-395`).

| Objet | `z_local` | `x_monde` | Position vs face du mur (5,875) |
|---|---|---|---|
| Face avant du cadre (boîte 0,08) | `+0,04` | **5,880** | **−5 mm : dans le mur** |
| Face arrière du cadre | `−0,04` | 5,960 | −85 mm : dans le mur |
| Passe-partout (plan) | `+0,045` | **5,875** | **0,000 m : coplanaire exact** |
| Toile (plan) | `+0,055` | 5,865 | +10 mm |
| « Ombre » factice | `−0,042` | **5,962** | −87 mm : invisible |
| Boîtier du luminaire | `+0,115` | 5,7675 | +107 mm |

Le cadre en bois (`BoxGeometry(p.w+0.16, p.h+0.16, 0.08)`, `paintings.ts:130`) est donc **entièrement contenu dans l'épaisseur du mur** : il est occlus par la face intérieure du mur et n'apparaît jamais. Idem pour la fausse ombre portée (`paintings.ts:156-157`) qui est 8,7 cm derrière le parement.

**Effet visuel.** L'œuvre se lit comme une toile posée à même le mur, entourée d'une bande blanche de 4 cm (différence `p.w+0.16` vs `p.w+0.08` divisée par deux, `paintings.ts:130,132`). Et comme le passe-partout est exactement à la profondeur du parement, les deux surfaces se disputent la même valeur de profondeur (`depthFunc` par défaut = `LEQUAL`) : scintillement / dents de scie sur le pourtour dès que la caméra bouge, disparition partielle de la bande blanche selon l'ordre de tri.

**Correctif de principe.** Le `Group` doit être reculé pour que la face avant du cadre ressorte franchement (4 cm) et que le plan de toile soit en creux dans la feuillure. Voir §7 (variantes A/B) pour les `z_local` exacts.

### P0-2 — Les picture lights lisent comme des barres noires et n'émettent rien

**Preuve.** Boîtier `BoxGeometry(p.w + 0.28, 0.07, 0.075)` (`paintings.ts:150`), soit pour une toile de 1,50 m : **1,78 × 0,07 × 0,075 m**, 19 % **plus large que la toile** (14 cm de débord de chaque côté), centré à `fy = p.h/2 + 0,13` (`paintings.ts:144`) → y = 2,43 m, à 10,75 cm du mur. Matériau `0x2b2e33` (≈ noir), `metalness 0,65`, `roughness 0,35`, `envMapIntensity 0,6` (`paintings.ts:111`) : dans une salle très claire, un métal sombre à faible rugosité n'a comme seule réponse spéculaire que l'IBL `RoomEnvironment` — il reste donc une silhouette quasi noire, sans variation.

La lentille est un `MeshBasicMaterial` **non émissif** (`paintings.ts:112`) de 1,70 × 0,028 m (`paintings.ts:153-154`) : une bande crème plate, sans halo, qui ne peut pas être plus lumineuse que `0xfff3dd` après ACES. Et surtout : **le luminaire n'émet aucune lumière**. La lumière vient du pool de spots, positionné à `p.x − 0,35` et `p.z + 0,55` (`main.ts:419`), c'est-à-dire 35 cm vers l'intérieur de la salle et 55 cm devant le tableau. L'ombre propre du cadre et du boîtier tombe donc du mauvais côté par rapport au luminaire affiché.

**Effet visuel.** Deux objets noirs par œuvre (boîtier + 2 bras, `paintings.ts:145-149`), plus larges que la toile, au-dessus d'une bande lumineuse crème plate : le luminaire **concurrence** l'œuvre au lieu de la servir, et le décalage lumière/luminaire est perceptible dès qu'on s'approche.

**Chiffrage de la lumière réelle.** Spot : `15 cd`, `decay 1,8`, distance à la toile ≈ 2,10 m → irradiance relative `15 / 2,10^1,8 ≈ 3,95`, à comparer au soleil `2,3` (`scene.ts:303`) et à l'hémisphérique `0,5`. Cône : demi-angle 0,48 rad → rayon `2,10 · tan(0,48) = 1,09 m`, soit Ø 2,19 m pour une toile de 1,50 m. Avec `penumbra = 1,0` (`scene.ts:325`), le cône interne vaut 0 rad : l'atténuation suit `smoothstep(cos 0,48 ; 1 ; cos θ)` → au bord de la toile (0,75 m hors axe, θ ≈ 0,342 rad) l'atténuation vaut ≈ **0,48**. La toile reçoit donc un **hotspot central à 2:1** et 35 cm de débord de chaque côté sur le mur.

### P0-3 — `emissiveIntensity 0,1` sur la texture de la toile

**Preuve.** Au chargement : `mat.emissiveMap = tex`, `mat.emissive = 0xffffff`, `mat.color = 0xffffff` (`paintings.ts:177-180`), puis `emissiveIntensity` fixé par `applyHover` (`paintings.ts:27-32`) à **0,1** au repos et **0,3** au survol.

**Effet.** Le terme émissif vaut `0,1 × albedo` en linéaire, ajouté **après** l'éclairage et indépendamment de lui : +10 % de luminance relative sur toute la surface, insensible aux ombres, aux occlusions et à l'angle. Un noir à 0,02 d'albedo remonte à 0,022 (négligeable), mais un demi-ton à 0,21 remonte à 0,231 : le résultat est un **relèvement uniforme proportionnel à l'image**, c'est-à-dire une perte de contraste local exactement là où le peintre a travaillé — et un comportement de « print rétroéclairé », puisque la matière ne répond plus à la lumière. Au survol, +30 % : la toile s'« allume » comme un écran, ce qui n'est pas un effet de lumière.

À noter que ce terme ne peut pas être rattrapé par le tone mapping : il est déjà dans le signal HDR avant `OutputPass`.

### P0-4 — Aucun post-processing

**Preuve.** `main.ts:477` appelle `renderer.render(scene, camera)` ; aucune occurrence de `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `GTAOPass`, `SMAAPass`, `OutputPass` ou `pass(` dans `src/` (recherche exhaustive). Le seul traitement d'image est l'ACES des matériaux (`scene.ts:279-280`).

**Effet.** C'est la cause racine du « rendu CAD » décrit : (a) aucune occlusion, donc aucun contact ; (b) aucune diffusion, donc la verrière est une dalle blanche à bords nets **sans halo**, et les arêtes des meneaux crépitent (l'antialias MSAA du canvas ne traite que la géométrie, pas les hautes fréquences de luminance) ; (c) aucune réponse « caméra » (grain), donc des aplats parfaits qui trahissent la synthèse ; (d) aucun historique temporel, donc micro-scintillement sur les images des œuvres (anisotropie 8, §P1-8) et sur le parquet.

Le point important pour la suite : **l'ACES existe déjà et devra rester unique**. Le jour où un composer est ajouté, three cesse d'appliquer le tone mapping dans les matériaux dès que la cible est un render target (`three/build/three.module.js:7261-7267` : `toneMapping = renderer.toneMapping` seulement si `currentRenderTarget === null`), et la couleur de sortie devient linéaire (`:7295`). C'est `OutputPass` qui doit alors porter l'ACES (`examples/jsm/postprocessing/OutputPass.js:33,93`). Toutes les valeurs HDR (seuil de bloom, émissive) restent donc valides, mais il faut **un seul** endroit qui tone-mape.

### P1-1 — Éclairage 100 % direct, pas d'occlusion

L'ensemble des termes indirects se réduit à l'IBL `RoomEnvironment` (`scene.ts:294-296`), non occlus et sans rapport avec l'architecture réelle. Il n'y a donc aucune occlusion : ni au pied des murs, ni sous les bancs, ni entre le cadre et le mur, ni dans l'angle plafond/mur. La plinthe extrudée (`scene.ts:432-434`, 0,10 m de haut, 0,04 m de saillie) et la couronne (`scene.ts:429-431`) sont modelées mais ne produisent **aucune** modulation de lumière : elles se lisent comme des rubans collés, ce qui est exactement la signature « CAD ».

### P1-2 — Ombres du soleil : texel trop gros, biais trop grand, fenêtre mobile

**Preuve.** `mapSize 2048` (`scene.ts:310`), fenêtre orthographique `left/right ±10`, `top/bottom = zMax+2 / zMin−2` (`scene.ts:311-314`), puis **redéfinie chaque frame** en `camZ ± 16` avec `left/right ±10` (`main.ts:428-431`), `bias −0,0004`, `normalBias 0,02` (`scene.ts:318-319`).

**Chiffrage.** Fenêtre courante 20 m × 32 m pour 2048² : **0,98 cm/texel en x, 1,56 cm/texel en z**. Une plinthe de 4 cm de saillie couvre 2–4 texels ; le `normalBias` de 2 cm repousse l'échantillon de deux texels supplémentaires. Résultat : aucune ombre de contact possible, et les ombres portées existantes (boîtier, bancs) sont des taches molles et décalées de plusieurs centimètres.

Second effet : la fenêtre suit la caméra **sans quantification** (`main.ts:428-429` prend `camZ` brut), donc l'ombre « nage » en continu pendant le scroll (shadow swimming), ce qui est un des artefacts les plus repérables en mouvement.

### P1-3 — Le soleil traverse le plafond, la verrière n'éclaire pas

`add()` ne pose jamais `castShadow` (`scene.ts:378-385`) : le plafond (386), les 4 cadres de verrière (413-416), les 3 meneaux (418-421) et les 10 traverses (423-425) ne projettent rien. Le soleil (2,3, quasi vertical) inonde donc le parquet en entier, sans tache, sans trame, et sans que rien ne bloque la lumière hors de l'ouverture de verrière — alors que la verrière est censée être **la** source de la salle.

Inversement, la verrière est une dalle pleine sous le plafond (le plafond est un plan continu 12 × 25,5 m, `scene.ts:386`) : il n'y a **pas de trémie**. La « lumière du jour » est donc entièrement décorative.

**Effet.** Sol uniformément éclairé à 2,3 d'irradiance, murs à ~0,5, aucune progression : l'œil ne trouve aucun indice de volume. C'est le deuxième pilier du « rendu CAD », avec l'absence d'AO.

### P1-4 — Le pool de spots se téléporte

**Preuve.** Fenêtre d'indices `idx−2 … idx+2`, triée par distance à `camZ`, puis `spotPool.forEach` réaffecte position, cible et intensité (`main.ts:409-424`). Aucun état par spot, aucune hystérésis, aucun fondu : `s.intensity = 15` est binaire (`main.ts:422`), `s.position.set(...)` (`main.ts:419`).

**Effet.** Quand la caméra franchit le point médian entre deux œuvres, l'ordre du tri permute et **deux slots sautent de 3,0 m en une frame** (l'espacement `SLOT_SPACING`, `layout.ts:6`). Comme `castShadow` est réassigné par slot (`main.ts:423`), c'est un double pop : la lumière *et* son ombre. À 3 spots, ce sont 2 œuvres sur 5 qui clignotent à chaque demi-pas.

### P1-5 — La lumière ne vient pas du luminaire

Déjà chiffré en P0-2 : spot à `(p.x − 0,35 ; p.y + p.h/2 + 1,25 ; p.z + 0,55)` (`main.ts:419`), cible `(p.x ; p.y − 0,05 ; p.z)` (`main.ts:420`). Le luminaire est au-dessus (y = 2,43 m) et collé au mur ; la lumière arrive à 45° de la gauche et de l'avant. La cohérence ombre/objet est rompue, et le `penumbra 1,0` produit un « spot de scène » plutôt qu'un bain de lumière de cadre.

### P1-6 — Verrière brûlée, sans diffusion

`emissiveIntensity 0,95` (`scene.ts:404`) sur 5,04 × 23,97 m : en linéaire, la vitre ajoute 0,95 avant même sa part diffuse (albedo `0xeef3f7`, `roughness 0,15`, soleil rasant) → sortie ≈ 1,4–1,5 linéaire, soit ≈ 0,87 après ACES. Le tiers supérieur de l'image devient un aplat blanc sans structure, d'autant plus visible qu'il n'y a **aucun bloom** pour l'accompagner : une dalle blanche à bords nets, avec 3 meneaux noirs par-dessus, est l'archétype du rendu non fini.

### P1-7 — Le brouillard blanchit

`Fog(0xfaf7f2, 18, 45)` (`scene.ts:292`) — avec `len = 25,5 m`, `max(45, 25,5·0,55) = 45`. Au mur du fond (25,5 m) : `(25,5 − 18)/(45 − 18) = 0,278`, soit **28 % de voile couleur `0xfaf7f2`** — exactement la couleur du `scene.background` (`scene.ts:288`). La profondeur de la salle se referme donc sur un blanc identique au vide : on perd le point de fuite, et le contraste des œuvres lointaines tombe de près d'un tiers.

### P1-8 — Anisotropie inversée

`scene.ts:285` : `aniso = min(max, coarse ? 8 : 16)` pour le décor ; `main.ts:108` : `texAniso = touch ? 4 : 8` pour les toiles ; `scene.ts:207` : `min(aniso, 8)` pour la roughness map. Les œuvres — le sujet — sont donc filtrées **deux fois moins bien** que le parquet, alors qu'elles sont vues en incidence rasante (mur latéral, caméra au centre). Scintillement de texture sur les aplats peints, particulièrement visible en scroll.

### P2 — qualité et coût

- **P2-1 Cadres plats** : `BoxGeometry` de 0,08 m d'épaisseur, matériau unique, sans profil ni feuillure (`paintings.ts:130`) ; passe-partout plan sans fenêtre ni biseau, 4 cm de large (`paintings.ts:132-133`). Pas de verre. Le mot « passe-partout » est ici un rectangle blanc.
- **P2-2 Ombre factice morte** : plan `1,74 × 1,74` à `x = 5,962`, `opacity 0,16`, `depthWrite false` (`paintings.ts:113-121,156-157`) — 8,7 cm dans le mur, jamais visible. Un draw call par œuvre pour rien.
- **P2-3 Coûts** (détaillés §5) : 3 passes d'ombre par frame (`main.ts:427-433` + 2 spots), `floor.webp` en **4096² sur mobile aussi** (`docs/textures-precalc.md`, note finale) soit ≈ 89 Mo de VRAM à lui seul, 9 meshes par œuvre non instanciables en l'état (tailles différentes par `new BoxGeometry`), 4 `getElementById` par frame (`main.ts:207,436,440-441`).
- **P2-4 Échelle du plâtre** : `repeat [max(2, round(len/9)), 1] = [3, 1]` (`scene.ts:93`) appliqué à la fois aux murs longs (25,5 m → 8,5 m/tuile) et aux murs de bout (12,5 m → 4,17 m/tuile) par le même matériau (`scene.ts:392-395`) : le grain est 2× plus fin sur les murs de bout.
- **P2-5 IBL incohérent** : `RoomEnvironment` (boîte d'étude) réfléchi par un parquet `clearcoat 0,5` (`scene.ts:346-353`) et par les boîtiers métalliques : reflets sans rapport avec une salle à verrière.

---

## 3. Direction proposée — une seule cible

> **« Verrière ».** Une salle blanche traversée par la lumière du jour : la lumière **entre** par la verrière et laisse une trame de meneaux au sol ; les murs sont modulés par l'occlusion (pied de mur, angles, cadre) ; les œuvres sont les seules surfaces nettement plus lumineuses que le mur, éclairées par leur propre luminaire, sans aucun halo parasite ; l'image finale a une texture de caméra discrète. Le noir n'est plus une couleur de matériau mais une conséquence de l'ombre.

Cette direction est **une** : elle se refuse à empiler AO + bloom + grain sur l'éclairage actuel (ce qui produirait du « post-processing sur un rendu CAD » et resterait gris). Elle repose sur trois décisions structurantes, puis des valeurs.

**D1 — Faire entrer la lumière.** Le plafond devient une dalle **avec trémie** (4 boîtes laissant l'ouverture 5,04 × 23,97 m centrée) et `castShadow = true` ; les meneaux et traverses deviennent `castShadow = true` ; la vitre reste non projetante. Le soleil est alors la source du motif, plus un remplissage global.

**D2 — Une occlusion, une seule, au bon endroit.** GTAO en espace écran, rayon 0,30 m, appliqué **avant** le bloom, à 0,30 m près du sol et des angles : c'est ce qui crée le contact plinthe/sol et cadre/mur sans toucher aux matériaux.

**D3 — Un luminaire crédible et une lumière qui en sort.** Le spot est déplacé **dans** le boîtier (à 6 cm du mur, sous le luminaire) et le boîtier est affiné (§7) ; la lentille devient émissive HDR pour être la seule source de bloom de la pièce avec le cœur de la verrière.

### 3.1 Paramètres cibles

| Réglage | Actuel | **Cible** | Raison |
|---|---|---|---|
| `toneMapping` | ACES (`scene.ts:279`) | **ACES, inchangé** | déjà en place ; reste l'unique tone mapper, porté par `OutputPass` dès qu'un composer existe |
| `toneMappingExposure` | 1,0 (`scene.ts:280`) | **0,95** | compense l'apport du bloom et de l'IBL occlus |
| Soleil (intensité / couleur) | 2,3 / `0xfff2df` | **3,4 / `0xfff4e6`** | la lumière n'entre plus que par la trémie : il faut plus de puissance pour la même tache |
| Soleil (position / cible) | (2,5 ; 15 ; cz) → (0 ; 0 ; cz) | **(1,6 ; 12 ; cz − 2,2) → (0 ; 0 ; cz)** | élévation ≈ 72°, décalage de la tache ≈ 1,1 m pour que la trame « tombe » dans le champ |
| Ombre soleil : `mapSize` | 2048 (`scene.ts:310`) | **3072 desktop / 2048 mobile** | 0,52 cm/texel sur une fenêtre ±8 × ±11 m |
| Ombre soleil : fenêtre | ±10 × (camZ ± 16) (`main.ts:428-431`) | **±8 × (camZ ± 11), `camZ` quantifié à 0,5 m** | supprime le shadow swimming |
| Ombre soleil : biais | −0,0004 / 0,02 (`scene.ts:318-319`) | **−0,0002 / 0,008** | le `normalBias` de 2 cm interdisait tout contact |
| Hémisphérique | 0,5 (`scene.ts:301`) | **0,22** (ciel `0xf2f7ff`, sol `0xcdbb9f`) | le remplissage doit venir de l'occlusion, pas d'un aplat |
| `envMapIntensity` | 0,3–0,7 | **plâtre 0,30 · sol 0,40 · plafond 0,25 · bois 0,45 · toile 0,10** | l'IBL ne doit plus faire le travail de l'éclairage indirect |
| `RectAreaLight` sous la trémie (desktop) | — | **5,04 × 23,97 m, 2,2, `0xf3f8ff`**, y = 3,30 | substitut crédible de ciel diffus, sans CSM ni coût d'ombre (voir §4.3 pour le coût et le repli mobile) |
| Verrière : `emissiveIntensity` | 0,95 (`scene.ts:404`) | **1,25 avec `emissiveMap` = dégradé radial** (cœur 1,0 → bords 0,35) | seul le cœur dépasse le seuil de bloom : halo au centre, bords propres |
| Spots : position | (p.x−0,35 ; +1,25 ; p.z+0,55) (`main.ts:419`) | **(p.x − 0,12 ; p.y + h/2 + 0,30 ; p.z)** → 1,06 m de la toile, dans l'axe du luminaire | la lumière sort du luminaire, plus de côté |
| Spots : intensité / décroissance | 15 / 1,8 (`scene.ts:325`, `main.ts:422`) | **2,6 cd / `decay 2,0`, `distance 4`** | irradiance 2,3 au centre de la toile à 1,06 m : borné et cohérent avec le soleil 3,4 |
| Spots : cône | angle 0,48 / penumbra 1,0 | **angle 1,15 rad / penumbra 0,50** | cône large (rayon 2,4 m à 1,06 m) : la toile **et** son pourtour sont éclairés, sans le blob central du `penumbra 1,0` |
| Spots : affectation | téléport (`main.ts:409-424`) | **hystérésis 0,9 m + fondu 350 ms** | supprime le pop (voir §2, P1-4) |
| Spots : ombres | 2 spots, 1024² (`scene.ts:328`, `main.ts:423`) | **1 spot, 512², `near 0,05`** | le contact est fait par l'AO, pas par l'ombre du spot |
| Spots : nombre par œuvre | 1 | **1** (option 2 × 1,4 cd si l'on veut un éclairement vraiment plat : +3 lumières actives, à ne pas retenir en mobile) | un point lumineux unique à 1,06 m donne ≈ 2,5:1 centre/coin (terme 1/d² + cosinus) : c'est aussi le comportement d'un vrai luminaire de tableau, on le conserve et on le recale |
| Toile : `emissiveIntensity` | 0,1 / 0,3 (`paintings.ts:30`) | **0 / 0,03** (survol porté par le spot +0,6 cd) | contraste du tableau rendu à la lumière |
| Brouillard | `Fog(0xfaf7f2, 18, 45)` | **`FogExp2(0xf2ebe0, 0,013)`** | 8 % à 25 m au lieu de 28 %, profondeur sans voile |
| Fond de scène | `0xfaf7f2` | **`0xf2ebe0`** (aligné sur le brouillard) | supprime la « découpe » du fond |
| Anisotropie toiles | 4 / 8 (`main.ts:108`) | **8 / 16, alignée sur le décor** | le sujet ne doit pas être le moins bien filtré |
| AO (GTAO) | — | **rayon 0,30 m ; `distanceExponent` 1,4 ; `thickness` 0,35 ; `scale` 1,0 ; `samples` 16 (8 mobile) ; `blendIntensity` 0,60** | contact lisible sans cerner |
| Bloom | — | **`strength` 0,30 ; `radius` 0,55 ; `threshold` 1,00 (linéaire HDR) ; résolution ½** | n'attrape que lentille et cœur de verrière |
| Grain | — | **±0,028, monochrome, 1 px, cadencé à 24 Hz** | texture caméra, pas de bruit vidéo |
| AA | MSAA canvas 4× implicite | **MSAA 4× sur le render target du composer, 2× mobile, pas de SMAA desktop** | une seule source d'AA, pas de double coût |

**Résultat attendu, en une phrase :** une salle à 0,95 d'exposition où le mur est à ~0,35 de luminance linéaire, le sol ~0,28 avec une tache de soleil à ~0,75, les toiles à ~0,45 avec un dégradé régulier, et deux points >1,0 (lentille + cœur de verrière) qui seuls rayonnent.

---

## 4. Plan AO + bloom + TAA + grain

Deux chemins d'implémentation sont possibles **sur cette stack**, avec un seul contrat : **WebGL 2 obligatoire en repli**. Le chemin A est celui à livrer (aucune dépendance nouvelle, tous les modules sont dans `three@0.187.0` déjà installé, `package.json:9`). Le chemin B est la cible technique pour TAA, à mettre derrière un drapeau.

### 4.0 Deux règles de pipeline, à ne pas inverser

1. **Un seul tone mapper.** Avec un composer, le rendering into render target n'applique plus ACES (`three.module.js:7261-7267`) et sort en linéaire (`:7295`). Donc : *scene pass → AO → bloom → **OutputPass** (ACES + sRGB) → grain → AA*. Le seuil de bloom est exprimé **en linéaire HDR** (1,00 = blanc nominal après exposition).
2. **L'AO avant le bloom, le grain après l'OutputPass.** L'AO doit moduler une image non tone-mappée (sinon l'occlusion s'applique à des valeurs déjà compressées) ; le grain doit s'appliquer en espace d'affichage (sinon son amplitude dépend de la luminance HDR).

### 4.1 Chemin A — WebGL 2 + `EffectComposer` (à livrer)

Tous les modules existent dans le three installé : `three/examples/jsm/postprocessing/{EffectComposer,RenderPass,GTAOPass,UnrealBloomPass,OutputPass,ShaderPass,SMAAPass}.js` (style d'import déjà utilisé dans le projet : `three/examples/jsm/...`, `scene.ts:3` ; l'alias `three/addons/*` existe aussi via le champ `exports` de three).

**Chaîne exacte, dans l'ordre :**

| # | Passe | Rôle / réglage | Coût estimé 1440p desktop |
|---|---|---|---|
| 0 | `WebGLRenderTarget(w·dpr, h·dpr, { type: HalfFloatType, samples: 4 })` passé à `new EffectComposer(renderer, rt)` | HDR + MSAA déplacé du canvas vers le RT | 1 resolve MSAA |
| 1 | `RenderPass(scene, camera)` | scène en linéaire HDR | 4,0–5,5 ms (98 objets + 1 ombre) |
| 2 | `GTAOPass(scene, camera, w, h)` | `output = GTAOPass.OUTPUT.Default` ; `blendIntensity 0,60` ; `updateGtaoMaterial({ radius: 0.30, distanceExponent: 1.4, thickness: 0.35, scale: 1.0, samples: 16, screenSpaceRadius: false })` ; `updatePdMaterial({ rings: 2, samples: 16, radius: 4 })` | 1,8–2,6 ms + 1 passe géométrie |
| 3 | `UnrealBloomPass(new Vector2(w/2, h/2), 0.30, 0.55, 1.00)` | seuil HDR 1,00 : seule la lentille (émissive 2,4) et le cœur de verrière dépassent | 0,6–0,9 ms (5 mips, ½ rés) |
| 4 | `OutputPass()` | ACES (`renderer.toneMappingExposure` lu à chaque frame, `OutputPass.js:93`) + sRGB | 0,15 ms |
| 5 | `ShaderPass(GrainShader)` | grain **symétrique** ±0,028, monochrome, `time` quantifié à 24 Hz | 0,10 ms |
| 6 | *(optionnel)* `SMAAPass()` | seulement si MSAA indisponible / `samples: 0` | 0,4–0,6 ms |

**Points de vigilance vérifiés dans le code de three 0.187 :**

- **Ne pas utiliser `FilmPass` pour le grain.** `shaders/FilmShader.js:57` calcule `color = base + base · clamp(0.1 + noise, 0, 1)` : le bruit **ne fait qu'éclaircir** (facteur 1,1 → 2,1 sur la base), il ne s'agit pas d'un grain symétrique. Même formule dans le nœud TSL (`tsl/display/FilmNode.js:70`). Un `ShaderPass` de ~12 lignes (hash de `gl_FragCoord` + `0,028·(n − 0,5)`) donne un vrai grain ; c'est le seul shader custom du plan et il ne touche à aucun matériau de la scène.
- **GTAO refait une passe géométrie complète.** `GTAOPass.render()` appelle `_renderOverride(...)` puis `renderer.render(scene, camera)` avec `scene.overrideMaterial` (`GTAOPass.js:510-513`, `:649`). Deux conséquences : (a) +1 passe de 98 objets ; (b) **les shadow maps sont recalculées deux fois par frame** si `shadowMap.autoUpdate` reste à `true` (three les rend au début de *chaque* `render()`, et `renderer.info` est remis à zéro à chaque appel, `three.module.js:17567`). → passer `renderer.shadowMap.autoUpdate = false` et poser `needsUpdate = true` **une fois** par frame (ou seulement quand la caméra a bougé de > 0,5 m ou qu'un spot a changé d'œuvre).
- **Ne pas brancher `GTAOPass.setGBuffer()` sur le RT du composer** : le RT est multisample, sa profondeur n'est pas échantillonnable. Laisser GTAO créer son propre G-buffer (`_renderGBuffer = true`), ce qui est aussi ce qui permet de le passer en demi-résolution.
- **Le MSAA doit migrer du canvas vers le RT** : `new THREE.WebGLRenderer({ antialias: false, ... })` (`scene.ts:277`), sinon on paie deux fois l'AA (canvas + `samples`). Attention : `renderer.setPixelRatio` doit être appelé avant `composer.setSize` / `composer.setPixelRatio`, et le `resize()` existant (`main.ts:352-360`) doit propager `composer.setSize(w,h)` puis `gtaoPass.setSize(w/2, h/2)` (l'AO en demi-résolution se mélange correctement : le blend échantillonne en UV normalisés).
- **`BlendMaterial`/`OutputPass` ne doivent pas être dupliqués** : un seul `OutputPass`, en dernier avant le grain/AA.

### 4.2 Chemin B — `WebGPURenderer` + TSL (TAA réel)

Le repli WebGL 2 est garanti par la classe elle-même : `WebGPURenderer` installe un `getFallback` qui bascule sur `WebGLBackend` si WebGPU n'est pas disponible (`three/build/three.webgpu.js:52115-52130`), et `forceWebGL: true` force ce backend. Le pipeline de nœuds fonctionne sur les deux backends. Ce chemin est le seul à donner un **TAA véritable** (reprojection temporelle) sur cette stack.

| Élément | API installée | Réglage |
|---|---|---|
| Pipeline | `THREE.RenderPipeline` (r183+, alias `PostProcessing` conservé : `three.webgpu.js:52263, 52740`) | `new THREE.RenderPipeline(renderer)` ; `renderPipeline.outputNode = …` |
| Passe scène | `pass(scene, camera)` (`three/tsl`) avec `setMRT(mrt({ output, normal: normalView, depth, velocity }))` | MRT obligatoire pour l'AO et le TAA |
| AO | `ao(depthNode, normalNode, camera)` = `GTAONode` (`tsl/display/GTAONode.js:727`) | `radius 0,30` ; `thickness 0,35` ; `samples 16` ; `resolutionScale 0,5` mobile ; `useTemporalFiltering` **uniquement** si TAA actif |
| Bloom | `bloom(color, 0.30, 0.55, 1.00)` (`tsl/display/BloomNode.js:597`) | seuil HDR 1,00, identique au chemin A |
| TAA | `traa(beauty, depth, velocity, camera)` (`tsl/display/TRAANode.js:609`) | nécessite le nœud `velocity` dans le MRT — three n'écrit la vélocité que si `mrt.has('velocity')` (`three.webgpu.js:16307`). **À valider sur cette scène avant activation**, sinon repli `smaa()`. |
| Grain | `Fn` custom (`hash`/`interleavedGradientNoise` sont exportés par `three/tsl`) | ±0,028, pas `film()` (même biais d'éclaircissement que `FilmPass`) |
| AA de repli | `smaa()` / `fxaa()` (`tsl/display/SMAANode.js:729`, `FXAANode.js:357`) | si TAA indisponible |
| Boucle | `renderer.setAnimationLoop` + `renderPipeline.render()` | remplace `renderer.render` (`main.ts:477`) |

**Compatibilité à revalider si ce chemin est choisi** (points de rupture identifiés) : `renderer.capabilities.getMaxAnisotropy()` (`scene.ts:284`) n'existe pas côté backend WebGPU — la méthode est portée par le renderer (`three.webgpu.js:24582`) ; `EffectComposer` est explicitement WebGL-only (`EffectComposer.js:8`) ; `PMREMGenerator.fromScene` et `RoomEnvironment` sont à re-tester sur backend node ; `three-mesh-bvh` (BVH de picking, `paintings.ts:12-18`) est indépendant du renderer et reste valide.

**Recommandation.** Livrer le chemin A. Ouvrir le chemin B derrière `?gpu=1` + détection `navigator.gpu`, avec repli dur sur le chemin A : c'est le seul moyen d'avoir du TAA sans mettre en risque la stabilité du rendu actuel, et cela respecte la contrainte « fallback WebGL obligatoire » du projet (`main.ts:12-20` teste déjà `webgl2` avant tout).

### 4.3 Ce qu'il ne faut pas faire

- **`TAARenderPass` / `SSAARenderPass` en WebGL 2** : ce sont des accumulateurs d'images (jitter de caméra sur N frames), sans reprojection ni vecteurs de vélocité — sur une caméra qui avance en continu ils produisent du ghosting, pas de l'anti-aliasing temporel. Le TAA du chemin B n'est pas transposable tel quel en WebGL 2 avec three 0.187.
- **`SSAOPass`** (kernel 32, profondeur seule) : disponible (`postprocessing/SSAOPass.js:55`) mais nettement moins stable que GTAO sur des surfaces planes et une caméra qui coulisse ; GTAO + Poisson denoise est le bon compromis ici.
- **`SunLight` (CSM)** : explicitement déconseillé pour les scènes bornées du type « une seule pièce » (`examples/jsm/lights/SunLight.js:9-11`). Le soleil directionnel + fenêtre quantifiée suffit sur 25 m.
- **`RectAreaLight` en mobile** : coût de BRDF LTC par fragment sur tous les matériaux Standard/Physical, et aucune ombre. Desktop uniquement ; sur `coarse`, compenser par hémisphérique 0,35 + `envMapIntensity` plâtre 0,40.

---

## 5. Garde-fous performance

### 5.1 Budgets

| Poste | Desktop (16,7 ms) | Mobile `coarse` (33 ms) |
|---|---|---|
| Passe scène + ombres (update à la demande) | ≤ 5,5 ms | ≤ 12 ms |
| GTAO | ≤ 2,6 ms | **coupé** |
| Bloom (½ rés) | ≤ 0,9 ms | ≤ 1,2 ms (¼ rés, `strength 0,20`, `threshold 1,20`) |
| OutputPass + grain | ≤ 0,3 ms | ≤ 0,3 ms |
| AA | MSAA 4× (inclus) | MSAA 2× |
| JS/UI (`tick`, raycast, DOM) | ≤ 1,5 ms | ≤ 2,5 ms |
| Marge | ≥ 5 ms | ≥ 12 ms |
| Draw calls | ≤ 220 | ≤ 140 |

Objectif : **P95 ≤ 16,7 ms desktop, P95 ≤ 33 ms mobile**.

### 5.2 Ce qu'on coupe en `coarse` (dans cet ordre)

1. GTAO **off** ; à défaut, `setSize(w/2, h/2)` + `samples 8` (gain ≈ 60 %).
2. Bloom en ¼ de résolution, `strength 0,20`, `threshold 1,20`.
3. Pas de `RectAreaLight` ; hémisphérique 0,35.
4. Ombres déjà coupées (`main.ts:105`) — conserver, et **ne pas** réactiver la trémie projetante (`castShadow` du plafond) sur `coarse` : sans ombre, la trémie ne se verrait pas et coûterait 18 objets.
5. `pixelRatio` déjà 1,5 (`main.ts:104`) → descendre à 1,25 si P95 > 33 ms.
6. 1 seul spot sans ombre (déjà, `scene.ts:324`).

### 5.3 Mesure via `window.__gallery.perf()`

L'API existe (`main.ts:482-488`) mais ne renvoie que `renderer.info.render` et `.memory`, et **souffrira d'un piège** dès qu'un composer est ajouté : `renderer.info` est remis à zéro à chaque `renderer.render()` (`three.module.js:17567`), donc avec GTAO + RenderPass, `perf()` ne rapporterait que la **dernière** passe de la frame. Ce qu'il faut exposer :

| Champ | Source | Intérêt |
|---|---|---|
| `calls`, `triangles` | `renderer.info.render` avec `renderer.info.autoReset = false` + `reset()` en tête de frame | budget draw calls cumulé sur toutes les passes |
| `textures`, `geometries`, `programs` | `renderer.info.memory` / `programs` | détecter les fuites (LRU de textures, `paintings.ts:186-199`) |
| `cpuMs` | EMA sur 60 frames de `performance.now()` autour de `composer.render()` | régression JS/matériaux |
| `gpuMs` | `gl.getExtension('EXT_disjoint_timer_query_webgl2')` (Chrome) | seul moyen de distinguer scène et AO |
| `passes` | longueur de `composer.passes` | vérifier qu'on ne duplique pas OutputPass |
| `shadowPasses` | compteur incrémenté quand `shadowMap.needsUpdate = true` | vérifier qu'on ne rend pas 2× les ombres |

**Protocole de mesure** (à figer pour comparer les itérations) : parcours scripté de la salle à 2 m/s sur les 29,5 m (≈ 15 s), 3 répétitions, relever P50/P95 de `cpuMs` et `gpuMs`, plus `calls` au pic. Mesurer aussi `?dup=8` (40 œuvres, `main.ts:47-56`) qui est le vrai test de montée en charge — le repère existant est **203 draw calls / 22 textures GPU** (`docs/revue-10.md`).

### 5.4 Postes à traiter indépendamment du post-processing

| Poste | Constat | Gain attendu |
|---|---|---|
| Ombres recalculées 2–3× | `main.ts:427-433` + GTAO override + 2 spots | `autoUpdate=false` + `needsUpdate` ciblé : −2 passes géométrie/frame, le plus gros gain du plan |
| Instanciation des luminaires/cadres | 9 meshes/œuvre dont 4 identiques entre œuvres de même taille (`paintings.ts:145-154`) | `InstancedMesh`/`BatchedMesh` (disponibles, `three.module.js` exports) : 4 draws au lieu de 4·N, décisif à `?dup=8` |
| `floor.webp` 4096² partout | `docs/textures-precalc.md`, note finale | ≈ 89 Mo de VRAM pour un seul fichier ; variante 2048 pour `coarse` : −67 Mo |
| DOM par frame | 4 `getElementById` par frame (`main.ts:207,436,440-441`) | +0,2–0,4 ms/frame ; cacher les références |
| `new Vector2` par `pointermove` | `main.ts:337-343` | négligeable mais gratuit à corriger |

---

## 6. Cadres & picture lights — deux variantes

Dans les deux cas, **le repère local est celui du `Group`** : `x_monde = 5,92 − z_local`, face du mur à **5,875**. Les valeurs ci-dessous rendent le cadre visible (saillie franche), placent la toile en creux et suppriment la coplanarité du passe-partout.

### 6.0 Socle commun (les deux variantes)

| Élément | `z_local` | `x_monde` | Saillie / mur |
|---|---|---|---|
| Fond de caisse (arrière) | 0,040 | 5,880 | −5 mm (dans le mur : montage) |
| Plan de toile | 0,055 | 5,865 | +10 mm |
| Bord avant du cadre | **0,085** | **5,835** | **+40 mm** |
| Luminaire (axe) | 0,140 (A) / 0,165 (B) | 5,780 / 5,755 | +95 / +120 mm |

La fausse ombre `paintings.ts:156-157` est **supprimée** (elle est dans le mur et l'AO la remplace).

### 6.1 Variante A — « discrète » (caisse américaine, galerie contemporaine)

| Élément | Dimensions | Matériau |
|---|---|---|
| Caisse (4 montants + fond) | section **45 × 45 mm**, profondeur **45 mm**, feuillure 8 mm ; jeu de 8 mm entre le bord de caisse et la toile (toile « flottante ») | `MeshStandardMaterial` noyer fumé `0x2a2724`, `roughness 0,55`, `metalness 0`, `clearcoat 0,08`, `envMapIntensity 0,40` |
| Passe-partout | **absent** (montage flottant) | — |
| Toile | 1,50 × 1,50 m, à `z_local 0,055` | `emissiveIntensity 0` ; `roughness 0,80` ; `envMapIntensity 0,10` |
| Luminaire | tube cylindrique **Ø 22 mm**, longueur `p.w + 0,10` (= 1,60 m), axe à **y = 2,60 m** (220 mm au-dessus du bord haut de la caisse, 2,38 m), à `z_local 0,140` (**95 mm du mur**) | `0x55565a`, `roughness 0,45`, `metalness 0,35`, `envMapIntensity 0,8` → gris moyen, lit comme un objet, **plus comme une barre noire** |
| Bras | 2 × plat 30 × 4 mm, longueur 90 mm, à `±(p.w/2 + 0,06)` | même matériau que le tube |
| Lentille | fente **1 580 × 10 mm** à `z_local 0,147` (sous le tube) | `MeshBasicMaterial` → **`MeshStandardMaterial` émissif** `0xfff4e0`, `emissiveIntensity 2,4` (HDR, seul bloom de l'œuvre) |
| Spot associé | 1 par œuvre, **dans** le tube : `(p.x − 0,12 ; 2,56 ; p.z)`, cible `(p.x ; 1,60 ; p.z)`, **2,6 cd, angle 1,15, penumbra 0,50, decay 2,0** | — |

Lecture : un filet sombre de 45 mm de large autour de la toile, 40 mm de saillie, une trame d'ombre réelle dans la feuillure (AO) et un tube fin gris qui « porte » la lumière. La barre noire disparaît deux fois : parce qu'elle est **plus fine que le cadre** (22 mm) et parce qu'elle est **plus claire que lui**.

### 6.2 Variante B — « muséale » (moulure bois/laiton, passe-partout biseauté, verre)

| Élément | Dimensions | Matériau |
|---|---|---|
| Moulure (4 côtés) | largeur **65 mm**, profondeur **45 mm**, profil à 2 gradins (plat 12 mm + gorge 8 mm + quart-de-rond 10 mm) | bois teinté `0x7a6444`, `roughness 0,45`, `clearcoat 0,15` ; **ou** laiton patiné `0xb08d4f`, `metalness 0,85`, `roughness 0,35`, `envMapIntensity 1,0` |
| Passe-partout | **80 mm** de large, **biseau 45° sur 2,5 mm**, surface à `z_local 0,078` (soit 17 mm devant la toile) | `0xf6f2e9`, `roughness 0,96`, `envMapIntensity 0,20` ; géométrie = 4 bandes inclinées (ou une `ShapeGeometry` à trou), **pas** un plan plein |
| Toile | 1,50 × 1,50 m à `z_local 0,058` → **20 mm en creux sous le passe-partout** | `emissiveIntensity 0` |
| Verre | plan `p.w + 0,16` à `z_local 0,082` (3 mm sous le bord avant, 4 mm devant le passe-partout) | `MeshPhysicalMaterial` `transparent: true`, `opacity 0,06`, `roughness 0,04`, `metalness 0`, `envMapIntensity 1,0`, `polygonOffsetFactor −1` — **desktop uniquement** (évite les halos de bloom sur mobile) |
| Luminaire | boîtier **cintré** 1 420 × 90 × 60 mm en laiton, à **y = 2,645 m** (280 mm au-dessus du bord haut du cadre, 2,365 m), à `z_local 0,165` (**120 mm du mur**) | `0xc0a062`, `roughness 0,30`, `metalness 0,90`, `envMapIntensity 1,0`, `emissive 0` → c'est l'IBL qui le sculpte, pas une couleur |
| Verrine du luminaire | 1 380 × 14 mm à `z_local 0,172` | émissif `0xfff2d8`, `emissiveIntensity 2,0` |
| Spot associé | 1 par œuvre, `(p.x − 0,14 ; 2,60 ; p.z)`, cible `(p.x ; 1,60 ; p.z)`, **2,9 cd, angle 1,15, penumbra 0,50, decay 2,0** | — |

Lecture : moulure large et basse, passe-partout en creux avec son biseau qui capte 2,5 mm d'ombre, verre qui ajoute une réflexion spéculaire faible et une légère désaturation. Le luminaire en laiton est le seul « objet métallique » de la salle, ce qui explique qu'il ne concurrence pas les œuvres.

**Coût comparé.** A : **5 meshes par œuvre** (caisse, tube, 2 bras, lentille), 0 transparence. B : 7 meshes par œuvre, 1 surface transparente de 1,66 m² (fill rate négligeable sur 5 œuvres, à surveiller à `?dup=8`). Dans les deux cas, les éléments **identiques entre œuvres de même dimension** (bras, lentille, tube) doivent être instanciés.

---

## 7. Diff prévisible

Aucune écriture de code dans cet audit ; ci-dessous le **type** de changement attendu par fichier, dans l'ordre de livraison recommandé.

| Ordre | Fichier | Type de changement | Risque |
|---|---|---|---|
| 1 | `src/gallery/scene.ts` | `WebGLRenderer({ antialias: false })` (`:277`) ; exposition 0,95 (`:280`) ; soleil 3,4 + position (`:303-305`) ; `mapSize` 3072 (`:310`) ; biais −0,0002 / 0,008 (`:318-319`) ; `FogExp2` (`:292`) + `background` (`:288`) ; params du pool de spots (`:325-328`) | faible, réversible par constantes |
| 2 | `src/main.ts` | ombre : `autoUpdate = false` + `needsUpdate` ciblé, fenêtre ±8/±11 quantifiée (`:427-433`) ; pool de spots : état par slot, hystérésis 0,9 m, fondu 350 ms (`:409-424`) ; `perf()` enrichi + `info.autoReset = false` (`:482-488`) ; cache des `getElementById` (`:207,436,440-441`) | moyen (logique d'état du pool) |
| 3 | **nouveau** `src/gallery/post.ts` | construction du `EffectComposer`, RT `HalfFloatType` + `samples`, `RenderPass` → `GTAOPass` → `UnrealBloomPass` → `OutputPass` → `GrainPass` ; `resize()` ; shader de grain (~12 lignes GLSL) | moyen ; **hors périmètre de cet audit, à cadrer séparément** |
| 4 | `src/main.ts` | `renderer.render` → `composer.render` (`:477`) ; `resize()` → `composer.setSize` + `gtao.setSize` (`:352-360`) ; `perf()` → `passes`, `gpuMs` | faible |
| 5 | `src/gallery/paintings.ts` | `frame` : géométrie profilée + `z_local` 0,040→0,085 (`:130`) ; `matBoard` : fenêtre + biseau, `z_local` 0,078 (`:132-133`) ; `imageMesh` : `emissiveIntensity 0/0,03` (`:30`), `envMapIntensity 0,10` (`:134`) ; luminaire : dimensions/matériaux/lentille émissive (`:111-112,145-154`) ; suppression de l'ombre factice (`:156-157`) ; `InstancedMesh` pour bras/lentille/tube | moyen ; c'est le lot qui porte le plus de gain visuel |
| 6 | `src/gallery/scene.ts` | trémie de plafond (4 boîtes) + `castShadow` plafond/meneaux/traverses (`:386,397-425`) ; `emissiveMap` dégradé de la verrière (`:399-408`) ; `RectAreaLight` desktop (`:301`) ; `envMapIntensity` par matériau (`:338-376`) ; `aniso` plâtre par mur (`:93,392-395`) | moyen ; modifier le plafond change le cadrage haut |
| 7 | `src/gallery/layout.ts` | seulement si la variante B est retenue : `SLOT_SPACING` 3,0 → 3,2 (moulure 65 mm + marge) (`:6`) et `x` du groupe (`:68`) pour les `z_local` du §6 | faible, mais décale la courbe caméra (`controls.ts:63-73`) |
| 8 | `src/gallery/paintings.ts` | anisotropie des toiles 8/16 (`main.ts:108`) — une ligne | trivial |
| 9 | `scripts/gen-textures.mjs` + `public/assets/textures/` | variante `floor-2k.webp` pour `coarse` (optionnel, −67 Mo VRAM) | nul à l'exécution |
| 10 | `vite.config.ts`, `package.json` | **aucun changement** : les passes sont dans `three@0.187.0` (`node_modules/three/examples/jsm/postprocessing/*`), le plugin WGSL et `vgpu` restent cantonnés au build des textures (`scripts/gen-textures.mjs`, voir `docs/textures-precalc.md`) | nul |

**Ce que le plan n'ajoute pas** : aucune dépendance, aucun shader de matériau modifié (`onBeforeCompile` inutile), aucun changement de `three-mesh-bvh`, de la physique Rapier ni du picking (`controls.ts`), aucun changement du pipeline d'images ni des `srcset`. Seul code GLSL nouveau : le grain (§4.1, passe 5).

---

## 8. Annexe — valeurs recalculées (reproductibles)

| Grandeur | Calcul | Valeur |
|---|---|---|
| Face intérieure du mur | `6 − 0,25/2` | 5,875 m |
| Face avant du cadre | `5,92 − 0,08/2` | 5,880 m (**−5 mm**) |
| Passe-partout | `5,92 − 0,045` | 5,875 m (**coplanaire**) |
| Ombre factice | `5,92 + 0,042` | 5,962 m (**dans le mur**) |
| Boîtier du luminaire (avant) | `5,92 − (0,115 + 0,0375)` | 5,7675 m |
| Longueur de salle | `(8,5) − (−17)` | 25,5 m |
| Texel d'ombre (actuel) | `20/2048` et `32/2048` | 0,98 cm et 1,56 cm |
| Texel d'ombre (cible) | `16/3072` et `22/3072` | 0,52 cm et 0,72 cm |
| Voile de brouillard au fond | `(25,5−18)/(45−18)` | 27,8 % |
| Irradiance relative du spot | `15 / 2,10^1,8` | ≈ 3,95 |
| Rayon du cône du spot à la toile | `2,10 · tan(0,48)` | 1,09 m (Ø 2,19 m) |
| Atténuation du spot au bord de la toile | `smoothstep(cos 0,48 ; 1 ; cos 0,342)` | ≈ 0,48 |
| VRAM textures (desktop) | 4096² + 2×2048² + 2×1024² + 5×~800², avec mips | ≈ 160 Mo (dont ≈ 89 Mo pour le seul parquet 4096²) |
| Objets par œuvre | 9 (`paintings.ts:163`) | 45 pour 5 œuvres |
| Objets de décor | 3 + 4 + 18 + 4 + 10 + 6 + 8 | ≈ 53 |

**Commandes de vérification utilisées** (lecture seule, aucun serveur lancé) : lecture de `src/gallery/{scene,paintings,layout,controls}.ts` et `src/main.ts` ; `grep -n` pour les citations ; `node --input-type=module -e` avec `three@0.187.0` pour les positions monde (`localToWorld`) ; inspection de `node_modules/three/build/{three.module,three.webgpu,three.tsl}.js` et de `node_modules/three/examples/jsm/{postprocessing,tsl/display,shaders,lights}/*` pour les API et les comportements cités.
