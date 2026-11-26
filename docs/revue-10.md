# Revue n°10 — étapes S (salle 4K) + M2 (minimap v3 + tests mur) + correctifs des 3 agents critiques

Date : 2026-11-26. Commit précédent : `0c05766` (R2). Cette passe répond aux rapports des
sous-agents critiques `.vibe/critiques/{design,scene,tests}.md` (tous VERDICT: NOT READY,
findings mesurés) + à la demande utilisateur : veille Awwwards round 2, minimap améliorée,
tests `?dup` « derrière le mur », audit élément par élément, textures 4K, luminaires au-dessus
des tableaux, sous-agents critiques avant livraison.

## 1. Veille round 2 ✅

`docs/inspiration.md` + **~90 captures headless 1440×900 (hero + 2 scrolls)** dans
`docs/inspiration/screenshots/round2/` : mur SOTD Awwwards, collections Three.js/WebGL/
virtual-gallery/scrolling, catégorie gallery, profils SOTD 2026 (Vredestein Experience
Centre, Elektra Virtual Museum, My Art Gallery, Minh Pham, G. Colombel 2026, Hearst
Exhibit 2026, The State of the Gallery), sites externes scrapés depuis le mur SOTD
(`sotd-live-*`, `r2-*` : two26, huxleysaga, polpharmabiologics, laboiteaslides…), musées en
ligne (Louvre, DAM Berlin, teamLab, Framesixty), blogs jurés 2026. Rapports :
`round2/report.json`, `report-v2.json`, liens scrapés `sotd-external-links*.json`.
Constats retenus : une seule idée forte par écran, HUD qui s'efface, split éditorial
micro-labels capitales, scroll = salles (alcôves Cartier W&W 2026), hero plein écran + CTA
unique pour les visites virtuelles.

## 2. Étape S — salle virtuelle « 4K » ✅ (`src/gallery/scene.ts`, `paintings.ts`)

- **Textures procédurales haute résolution** : fabrique `canvasTex` avec
  `anisotropy = min(getMaxAnisotropy(), 16 desktop / 8 mobile)` (avant : 1 sur murs/plafond/tapis).
  Parquet **4096 px desktop / 2048 mobile** : teinte par lame, dégradé dans la lame, joints de
  bout décalés, veines, micro-rayures, nœuds, + `roughnessMap` 1024 ; plâtre **2048** grain
  26 000 pts + 22 marbrures ; plafond enduit 2048 ; tapis tissé 1024 (trame croisée + liseré)
  en greige chaud `#cdc2ad` (avant : slab bleu-gris `#454c55` hors palette). Repeats dépendants
  de `len` (avant : smear à dup=8).
- **Verrière structurée** : vitre émissive segmentée + châssis métal sombre (cadre + 3 meneaux
  + traverses tous les 2,4 m) — avant : plane blanc brûlé 5×122 m.
- **Moulures en relief** : couronne et plinthe en `ExtrudeGeometry` (profil mouluré) — avant :
  boxes plates.
- **Luminaires au-dessus de chaque tableau** : vrai *picture light* (2 bras + boîtier métal
  `0x2b2e33` + lentille émissive `0xfff3dd`) à la place de la barre flottante, + **pool de
  SpotLights réels** (3 desktop / 1 mobile, cône 0,48 rad, pénombre 1,0, 15 cd) positionnés sur
  les œuvres les plus proches de la caméra ; ombre portée sur les 2 plus proches (desktop).
  Auto-émissif de l'image ramené à 0,10 (0,30 au hover) — avant 0,25/0,55 « rétroéclairé ».
- **Ombre du soleil fenêtrée** suivant la caméra (±16 m) — avant : 6,6 cm/texel à dup=8.
  `fog.far = max(45, len*0.55)`. `toneMappingExposure` 1,0 ; soleil 2,3 ; hémisphère 0,5.
- **Cartels en atlas** : 1 texture 2048×2048 (8×5 cellules) pour toutes les œuvres — avant : 1
  texture canvas par œuvre (40 textures / ~12,6 Mo à dup=8). Cartels repositionnés façon musée
  (0,22×0,135 m, collés au cadre, ~1,05 m du sol). Plaque de portail en laiton 1,3×0,32 m.
- **Bancs** le long du mur de gauche tous les 11 m.
- **LRU textures** : chargement initial limité au voisinage de l'entrée, lazy `|dz|<16`,
  libération GPU (`dispose`) au-delà de 30 m. **Résultat mesuré à ?dup=8 : 22 textures GPU
  (avant 86 / 114,6 Mo), 203 draw calls.**

## 3. Étape M2 — minimap v3 + tests « derrière le mur » ✅ (`minimap.ts`, `style.css`, `main.ts`)

- Piste à **taille adaptative** (desktop : hauteur `clamp(180, (n-1)*28/fraction, 460)` px ;
  mobile : largeur `min(70vw, 320px)`), **stops de taille adaptative** `--sz =
  clamp(gap-2, 8, 24)` avec calcul du vrai écart (fraction du hall occupée par les œuvres),
  **numéros masqués en dense** (`.mini`), **segments de salles** `.mm-seg`, **marqueur caméra**
  `.mm-cam`, **butées début/fin** `.mm-cap`, remplissage de progression.
- **Mode tactile dense** : stops en `pointer-events:none` + clic sur la piste → œuvre la plus
  proche (plus de tap ambigu). Desktop : stops cliquables individuellement (24 px, WCAG OK).
- **Tests mesurés** (`?dup=1/2/3/5/8` × 1440×900 / 390×844 / 360×740, `.vibe/verify*.json`) :
  chevauchement de stops **0 paire desktop à dup 2/3/5/8** (avant 9/14/48/150) ; mobile dense
  en nearest-pick ; 0 chevauchement DOM entre éléments visibles à toutes les tailles ;
  **mur du fond jamais traversé** (guidé : min z = zEnd+1,2 ; libre : clamp zEnd+1, mesuré à
  dup 1/3/8 en fonçant avec W) ; écran de fin à t>0,985 + HUD cliquable dessous ; `?dup=N` →
  N×5 œuvres (dots/stops/spacer proportionnels) ; **0 erreur console** partout.

## 4. Correctifs des agents critiques ✅

- **F1** (panneau fermé pendant le trajet caméra après clic minimap/dot/index en guidé) :
  `panelTravelUntil` — le panneau reste ouvert pendant le trajet programmatique et à l'arrivée
  (vérifié : clic stop 15 à dup=3 → panneau ouvert, camZ = cible). `main.ts`.
- **F2** (boutons lightbox ‹ › fermaient la lightbox par bubbling) : `stopPropagation` sur
  `#lb-prev/#lb-next/#lb-close`. Vérifié : navigation OK, lightbox reste ouverte. `ui.ts`.
- **Curseur fantôme** : `#cursor` z-index 100→35 + opacity 0 tant qu'aucun `pointermove`.
- **Collision mobile brand × big-counter** : `#brand-sub` 9 px / 0,15 em en ≤640 px (mesuré :
  0 chevauchement après fix).
- **scroll-hint × dots** (bottom 96→136 px), **free-hint × HUD** (bottom 24→88 px),
  **dots** bottom 88 px + wrap, **stops/dots 24 px** (bordure `var(--muted)`), **toast** top 78,
  **HUD idle 0,28→0,45**, **`#btn-free` masqué en CSS ≤640**, `.mm-room` mobile margin 16 px,
  **lightbox 0,94→0,97**, **écran de fin 0,90→0,96**, **index fond plein**, **panel actions en
  colonne pleine largeur 44 px**, **hint de navigation ajouté sur l'intro**, scroll-hint/toast
  en `visibility:hidden` quand invisibles, écran de fin aussi en mode libre, clamp de défense
  `pos.z ≥ zEnd+1` après `getPointAt`.
- `window.__gallery.perf()` exposé (draw calls / textures / geometries).

## 5. Validation par sous-agents critiques (condition de livraison)

3 sous-agents critiques indépendants lancés en parallèle (mode local), en **2 passes** :

- **Passe 1** (`.vibe/critiques/{design,scene,tests}.md`) : 3× `VERDICT: NOT READY` avec
  findings mesurés (minimap illisible dès dup≥2, collision brand×compteur mobile, curseur
  fantôme, F1 panneau fermé pendant le trajet, F2 lightbox ‹ ›, textures 512 px aniso 1,
  barres lumineuses flottantes, 114 Mo de textures au boot, etc.).
- **Passe 2** (`.vibe/critiques/{design,scene,tests}-pass2.md`) : design = **PERFECT**
  (25/25 findings FIXED prouvés) ; scène = 3 résidus triviaux (N1 plaque flottante, N2 bras
  noyés, N3 scale stop actif) ; tests = 2 résidus (F4 `#lb-close` sous `#lb-next`, F5 flèches
  clavier non câblées).
- **Correctifs N1/N2/N3/F4/F5 appliqués** (plaque sur le linteau, bras allongés dans le mur,
  `--as` plafonné, `#lightbox #lb-close` spécificité, `controls.onNext/onPrev` câblés).
- **Passe 3** (sections « PASS 3 » des rapports) : **les 3 agents rendent `VERDICT: PERFECT`**
  — 5/5 points FIXED mesurés, 0 erreur console, build OK, aucun nouveau défaut.

✅ Condition de livraison remplie : les agents critiques ont dit « parfait » (3/3, passes 2+3).

- `npm run build` : tsc strict + vite OK.
- Harnais Playwright `.vibe/shotkit/{shoot,verify,verify2,verify3,verify4}.mjs` : 0 erreur
  console sur toutes les combos tailles × ?dup ; mesures DOM ; screenshots `.vibe/shots-v3/`,
  `.vibe/shots-v4/`, `.vibe/shots-final/`.

## Suite

Itération D (vraies photos HD dans `references/`), F (SEO/domaine), G (tests réels +
Lighthouse/axe).
