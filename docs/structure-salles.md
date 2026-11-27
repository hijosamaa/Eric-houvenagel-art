# Séparer les catégories : hall en long vs alternatives — analyse et recommandation

Date : 2026-11-27. Concerne la structure spatiale (`src/gallery/layout.ts`, `scene.ts`,
`physics.ts`, `controls.ts`, `minimap.ts`) et la navigation entre salles (`src/ui.ts`, `src/main.ts`).

## 1. Le problème chiffré

Hypothèse à terme : 4–5 catégories × ~10 œuvres = **40–50 œuvres**.
À `SLOT_SPACING = 3 m` (`layout.ts`), un hall unilatéral fait **120–150 m** de long,
soit un scroll-spacer d'environ **46–58 écrans** à 100vh (~0,85 œuvre par écran).
Même si tout scale techniquement (brouillard adaptatif, LRU ±16/30 m, atlas de cartels
4096 — voir `docs/visite-structure.md` §2), **subir 150 m de scroll linéaire pour changer
de catégorie n'est pas agréable** : on perd le fil, on ne sait plus où l'on est, et le
« siguiente » devient une corvée.

Ce qui existe déjà côté séparation (livré avec le hall unique) :

- zones de salles contiguës (`computeLayout`, `layout.ts`) : tapis dédié par salle,
  portail ouvert (piliers + linteau + **plaque laiton cliquable** → saute à la 1ère œuvre
  de la salle suivante, `scene.ts:643`, `controls.ts` `onZonePick`, `main.ts:132`) ;
- index overlay groupé par salle (`ui.ts` `buildIndex`) ;
- minimap = rail avec **segment par salle** + nom de salle courante (`minimap.ts`) ;
- la séparation visuelle existe donc, mais la **navigation** entre salles reste
  « scroll jusqu'au prochain portail ».

## 2. Options comparées

| Option | Longueur totale | Séparation perçue | Coût technique | Verdict |
|---|---|---|---|---|
| **A. Enfilade unique + navigation par salles renforcée** | 120–150 m (mais jamais subis d'un bloc) | moyenne (portails, tapis, plaques — à renforcer) | faible : UI + raccourcis, zéro refonte du moteur | **recommandé maintenant** |
| **B. Hub central + salles rayonnantes** (portes → pièces dédiées) | ~40 m d'axe + 5 salles de ~12 m | forte (pièce + ambiance par catégorie) | très élevé : `computeLayout`, `cameraPath`, minimap 2D, physics, LRU, état de salle, transitions | refonte — plus tard si parti pris éditorial fort |
| **C. Hall en « peigne »** (salles perpendiculaires en parallèle, parcours en serpentin) | ~70–80 m au lieu de 150 | forte (vrais murs, portes entre salles) | élevé : path caméra 2D avec virages 90° (le moteur a déjà eu un CatmullRom), dwell à généraliser en 2D, minimap-plan, physics étendu | crédible en itération dédiée |
| **D. Tronçons + fondus au noir** entre catégories (téléport caméra) | 150 m découpé en 5 chapitres | artificielle (fondu = aveu que le hall est trop long) | faible | rejeté : casse le flux continu, minimap globale incohérente |
| Zigzag murs alternés / salles fermées en ligne / multi-halls (reload) | — | — | — | déjà rejetés dans `docs/visite-structure.md` §2 (sens de lecture inversé, caméra, perfs) |

## 3. Option A détaillée — ce qu'il faut ajouter (la plupart est déjà là)

Principe : **la longueur du hall devient un détail qu'on ne subit jamais**, grâce à une
navigation par salles de premier plan. Le scroll guidé reste le mode de visite à
l'intérieur d'une salle.

1. **Barre « Salles » dans le HUD** (ou en tête de l'index) : un chip par catégorie
   (`layout.zones`), clic → `controls.scrollToWork()` sur la 1ère œuvre de la zone.
   Actif = salle courante (déjà calculée dans `minimap.update`).
2. **Raccourcis clavier 1–5** → salle N ; `PageDown` entre salles en complément du pas-à-pas œuvre par œuvre.
3. **Portail = « Salle suivante → » explicite** : la plaque laiton existe et est cliquable ;
   la compléter d'une flèche/label « salle suivante » visible de loin (le portail est déjà
   en arche avec linteau, `scene.ts:643`).
4. **Minimap : clic sur le segment d'une salle** → début de salle (aujourd'hui seuls les
   stops œuvre et le clic-piste sont actifs, `minimap.ts`) ; le label de salle y est déjà.
5. **Indicateur de salle dans le cartel** : « Salle 2/5 · Marines & Bretagne · 10 œuvres »
   (le nom de salle est déjà calculé dans `minimap.update`, à remonter dans le HUD `ui.ts`).
6. **Séparation visuelle renforcée par catégorie** (léger, décoratif) : teinte de spot ou
   de cimaise par zone, plante au portail (déjà), tapis dédié (déjà), plaque laiton (déjà).

Bilan chiffré : 50 œuvres = 150 m, mais un saut de salle = téléport/scroll smooth direct ;
le plus long trajet « à la main » entre deux œuvres d'une même salle ≈ 30 m (~12 écrans).
Le brouillard adaptatif garde le fond à ~12 % de voile quelle que soit la longueur.

## 4. Option C (peigne) — à creuser si la séparation architecturale devient un vrai enjeu

Chaque catégorie = une salle rectangulaire perpendiculaire à l'axe principal, reliée par
une porte ; les tableaux restent sur le **mur gauche de chaque tronçon** (sens de lecture
+0,915 conservé, cf. `docs/visite-structure.md` §1). Longueur totale ~70–80 m.

Impacts : `computeLayout` génère un parcours 2D (x, z) au lieu d'un axe z ; `cameraPath`
redevient un vrai path (CatmullRom, comme à l'origine) avec dwell 2D ; `minimap` devient
un plan cliquable ; `physics.ts` ajoute les murs des salles ; `hallBounds` → bornes par salle.
Risque : virages à 90° en scroll guidé = désorientation possible → à prototyper et tester.

## 5. Recommandation

**A maintenant** (quelques jours, aucun risque, tout le moteur linéaire reste valable),
avec 1–5 + portail « salle suivante » + indicateur de salle. **C en itération dédiée**
si l'on veut un jour une vraie architecture par catégorie (ambiances, lumières, murs).
B et D ne valent pas leur coût / leur régression d'UX.

## 6. Implémentation livrée (2026-11-27)

Option A réalisée :

- **Barre « Salles »** en haut à droite (`#rooms-bar`, `ui.buildRooms`) : un chip par
  catégorie, clic → saut au début de la salle ; sur mobile, numéro seul (touche 1–5
  au clavier desktop) ;
- **Touches 1–9** → `goToZone(n)` dans `main.ts` (ferme lightbox/index/panneau) ;
- **Portail** : plaque laiton élargie (1,8 × 0,42 m, `scene.ts`), toujours cliquable
  (saut à la 1ère œuvre de la salle suivante) ;
- **Minimap** : les segments de salle (`.mm-seg`) sont cliquables, cible 15 px
  (`minimap.onZonePick`) ;
- **Cartel** : ligne « Salle k/N · nom » au-dessus du titre (`#cap-room`,
  `ui.setRoomLabel` + `ui.setActiveRoom` dans le tick) ;
- **Séparation visuelle** : tapis teinté par salle (`RUG_TINTS` dans `scene.ts`).

Et au passage, même commit :

- **Ambiance naturelle** : `scene.fog = null` (plus de brouillard), `far` caméra
  `max(160, len+60)`, exposition 1,05, HEMI jour 0,55 (ciel bleuté), SUN 2,6 blanc
  chaud, SKY_FILL 1,8, `environmentIntensity` 0,55 ;
- **Mobile** : textures servies en variantes `-1024.webp` (générées par
  `scripts/gen-texture-variants.mjs`, branchées en `prebuild`/`predev`) et resizées
  côté client via `createImageBitmap` à `maxSize` (1024 mobile / 2048 desktop) —
  fini les textures noires sur mobile ; `pixelRatio` 2 partout ; `antialias: true` ;
  post-traitement `low` (MSAA 2× + **SMAA actif**) sur mobile au lieu de `off` ;
  aniso 8 partout → fini l'escalier des lignes droites au zoom ;
- **Spots tableaux** : pool 6 desktop / 3 mobile, fondu 0,8 s, hystérésis 1,2 m,
  intensité modulée en continu par la distance (`distFade`) → la lumière glisse
  d'un tableau à l'autre sans jamais s'éteindre brutalement.
