# Refonte qualité de la galerie — état d'avancement (reprise)

> Document de reprise : il dit ce qui est fait, ce qui reste, et comment vérifier.
> Mis à jour à chaque session.

## Où en est le rendu

Le lieu est une **enfilade** : un sas d'entrée, puis **trois salles** de hauteurs
différentes (3,55 / 4,15 / 3,30 m), œuvres **en vis-à-vis** tous les 2,8 m. Trente toiles
tiennent donc dans quatre volumes distincts au lieu d'une nef unique de 90 m.

Architecture : murs de **seuil** percés d'une porte (trumeaux + linteau), murs à la chaux,
parquet chêne à joints réels, plafonds à trémie avec verrière et deux ou trois poutres
peintes par salle. Plus de solives tous les 1,9 m, plus de portiques à pilastres.

Fichiers : `layout.ts` (plan, chemins, dwell), `ceiling.ts` (plafonds/verrières par salle),
`wood.ts` (profils bois), `plants.ts` (7 espèces), `scene.ts` (volumes, matériaux, seuils,
texte de salle), `frames.ts`, `paintings.ts`, `furniture.ts`, `physics.ts`, `post.ts`,
`controls.ts`, `minimap.ts`.

## Les quatre bugs qui ont débloqué le rendu (ne pas régresser)

1. **Le sol n'était pas rendu** — quads du parquet ordonnés à l'envers (normale −Y), le
   back-face culling supprimait la face ; on voyait le fond de scène à travers.
   Sens correct : `(x0,z0) → (x0,z1) → (x1,z1)` puis `(x0,z0) → (x1,z1) → (x1,z0)`.
2. **Tous les assets IA étaient ignorés** — `precalcTexture()` remplaçait un placeholder
   2×2 par l'asset ; three alloue en stockage immuable (`texStorage2D`), d'où
   `glTexSubImage2D: Offset overflows texture dimensions` et un GPU qui gardait le 2×2.
   Correctif : `t.dispose()` **avant** `t.needsUpdate`.
3. **Tone mapping** — ACES désaturait dès 0,6 de luminance (chêne → gris-blanc).
   Passage à **Khronos PBR Neutral**, exposition 0,94.
4. **Convention `faceX`** — `faceX = +1` signifie *mur gauche* (x < 0) : le signe entre
   `faceX` et `x` est inversé. Une erreur de signe enfouissait les toiles dans le mur.

## Décisions de direction artistique

- **Charpente peinte** blanc cassé : le bois ne se lit que par le relief et l'ombre.
- **Le sol est l'ancrage** : 60 lames de 20 cm (7 lames par tuile d'asset de 1,40 m). Le
  joint est cuit en couleur de sommet, parce qu'en filtrage anisotrope le GPU moyenne les
  joints sur 3-4 lames (mesuré : écart-type 1,5 sur 400 px).
- **Étalonnage des assets à l'upload** (`TexOpts.grade`) : parquet désaturé à 45 %, chaux à
  78 %, dorure en `roughnessMap` (en albédo ses plis faisaient des chevrons).
- **Plafond** : sous-face quasi blanche + émission neutre 0,13 (0,24 sur mobile). Une dalle
  ne reçoit que le premier rebond de l'IBL ; sans ce terme elle lisait « contreplaqué ».
- **Nom de salle** : lettrage peint sur le trumeau, jamais une plaque sur un linteau.

## Navigation

| Mode | État |
|---|---|
| Scroll guidé (dwell devant chaque œuvre) | OK, la caméra se décale d'un mur à l'autre |
| Flèches ← →, PageUp/Down, Espace | OK |
| Mini-plan (salles cliquables, nom, progression, curseur) | OK |
| Visite libre ZQSD/WASD + souris (physique Rapier) | OK |
| Touches 1-9 (saut de salle), Échap, clic sur une toile | OK |

`?dup=N` répartit les copies en tourniquet sur les salles (mise en scène d'une trentaine
d'œuvres) ; `?dup=6` = 30 toiles.

## Ce qui reste

### Priorité 1
- [ ] Ombres de contact : socles et bancs ne « posent » pas encore franchement.
- [ ] Plantes : silhouettes d'olivier/eucalyptus encore en brindilles ; densifier.
- [ ] Chaux : les coups de taloche de l'asset se lisent comme des rayures à 1 m
      (voir la variante `plaster-lisse.webp` demandée dans `docs/prompts-nano-banana.md`).
- [ ] Bancs centrés : vérifier qu'ils ne gênent pas la caméra guidée dans les salles
      étroites (la caméra se décale de ±1,0 m, le banc fait 0,44 m de profondeur).

### Priorité 2 — assets à demander (prompts écrits)
`docs/prompts-nano-banana.md` → section « À demander maintenant » : `painted`, `oak`,
`leaf`, variante `plaster-lisse`.

### Priorité 3 — vérifications
- [ ] `npm run build` OK, à rejouer ; test prod (`npm run preview`).
- [ ] Perf réelle desktop/mobile (le headless swiftshader n'est pas représentatif).
- [ ] Écran de fin / « recommencer » sur un parcours de 30 œuvres.

## Comment vérifier visuellement

```bash
npm run dev -- --port 5199                      # serveur de dev
PLAYWRIGHT_BROWSERS_PATH=/c/Users/Hijo/AppData/Local/ms-playwright \
  node .vibe/shotkit/shoot-q.mjs .vibe/shots-q-pNN "http://localhost:5199/?dup=6"
PLAYWRIGHT_BROWSERS_PATH=/c/Users/Hijo/AppData/Local/ms-playwright \
  node .vibe/shotkit/views.mjs .vibe/views-pNN "http://localhost:5199/?dup=6"
```

`shoot-q.mjs` = parcours guidé + détails + mobile. `views.mjs` = une vue large par salle +
détails (lampe, plante, plafond, sol). Les captures sont **déterministes** : deux séries
identiques au pixel près signifient que le changement n'a pas été pris en compte.

Sondes : `probe.mjs` (map du sol), `probe4.mjs` (fond rouge = la surface est-elle rendue ?),
`probe6.mjs` (matériau du sol isolé), `probe9.mjs` (les 4 modes de navigation).

## État git

`main` : `c1ea2f0` (charpente peinte, parquet, assets) + `6625023` (textures HD).
Branche de travail : `vibe/salles-30` (sas + 3 salles, mini-plan, charpente apurée).

## Audit de la session « 30 œuvres » (ce qui est corrigé)

Deux audits indépendants (rendu, navigation) ont été passés sur la version `?dup=6`.
Corrigé dans `vibe/salles-30` :

- **25 toiles vides sur 30** : le palier LRU (charger < 16 m / libérer > 30 m) laissait
  une zone morte. Chargement d'une salle entière (75 m desktop, 34 m mobile), libération
  une salle plus loin.
- **Toiles floues** : les œuvres étaient servies en 800 px alors que les masters font
  1080 → 1080 sur desktop, 800 sur mobile (VRAM).
- **Bouton « précédent » recouvert par le mini-plan** : largeurs des boîtes normalisées sur
  la somme réelle des zones, `.mm-plan { overflow: hidden }`, `#nav { z-index: 3 }`.
- **Mauvaise salle annoncée** : les zones se chevauchaient de 2,6 m et `findIndex` prenait
  la première. Zones rendues **disjointes** au niveau des seuils + helper unique
  `zoneAt()` utilisé par le cartel et le plan.
- **Numérotation** : « Salle 1/3 · … » (le sas s'appelle « Entrée », il n'est plus « 1/4 »).
- **Flèche « suivante » qui sautait la 1ʳᵉ œuvre** depuis le sas.
- **Un glissement ouvrait la fiche** du tableau (origine du geste réécrite à chaque move).
- **Sortie de la visite libre qui téléportait** à l'entrée (scroll non resynchronisé).
- **Visite libre** : l'index se ferme et un message donne les touches.
- **Verrière** : vitrage à 2,4 (au-delà du seuil de bloom), meneaux moins métalliques.
- **Plafond** : asset `ceiling` dédié, anisotropie 4, bump 1,5 mm, émission 0,13/0,24.
- **Plinthe** : elle reçoit désormais le dégradé de pied de mur (couleurs de sommet).
- **Cadres** : variantes cyclées (dorée / discrète / musée) au lieu de 30 moulures
  identiques.
- **Ombres de contact** au sol sous bancs, socles, console et pots (`contact.ts`).

Reste ouvert (P1/P2, non bloquant) : moulure dorée encore « plate » (profil en tons cuits),
chaux avec rayures à 1 m, plantes en brindilles, `prefers-reduced-motion` non testé sur le
dwell, aide clavier du mode libre à afficher aussi en permanence.

---

# Session « plan compact + lumière directe » (branche `vibe/plan-sas-central`)

## Le plan : plus de couloir

Le parcours était un hall de **90,2 × 8,6 m** (ratio 10,5:1, 28 m par salle) : une ligne de
vue de 90 m, aucun repère, et l'impression d'un couloir. Le plan est maintenant un **sas
central de 12 × 12 m** entouré de **trois salles de 12 × 14 m** (nord, est, ouest), pavées
exactement (aucun recouvrement) et parcourues **en boucle** : sas → nord → sas → est → sas →
ouest → sas. Chaque salle accroche sur **trois murs** (4 + 2 + 4 toiles), la quatrième paroi
portant la baie : on entre, on fait le U, on ressort. **Aucune ligne de vue ne dépasse 14 m.**

Bug attrapé par la mesure (à ne pas réintroduire) : avec un sas de 9,6 m et des salles de
15 m, les pièces se **chevauchaient de 2,7 m** dans les angles, et une toile de la salle
ouest traversait le mur de la salle nord. Règle : `ROOM_LAT = 2 * SAS_HALF`.

## Navigation : quatre modes, dont un scroll repondéré

| Mode | Comment | Détail |
|---|---|---|
| Scroll | molette / geste | parcours cap-à-cap, paliers exacts devant chaque toile (`createDwellCurve`) |
| Flèches | `‹` `›`, ←/→, ←/→ d'une fiche | saut au palier voisin |
| Mini-plan | clic sur une salle ou sur un trait de toile | plan **à l'échelle** en SVG (viewBox en mètres) |
| Visite libre | bouton « Explorer librement », ZQSD, souris | Rapier pour les murs, Échap resynchronise |

Le scroll était **proportionnel à la distance** : un pas de 3 m entre deux toiles coûtait
560 px de molette, la traversée de 20 m du sas **4 830 px** (39 crans dans un hall vide).
Chaque intervalle est désormais plafonné à 1,9 × la médiane des intervalles entre toiles
(`viewU` = position curviligne, `scrollT` = position de scroll). Le sas coûte 1,9 fois un
pas de toile, plus 8,7.

Autres corrections de la session (audit UX) : l'état **0 œuvre** affiche « Aucune œuvre
publiée » au lieu d'un « Chargement… » éternel ; la fiche est `role="dialog"` + `aria-hidden`
+ `visibility: hidden` fermée (6 contrôles n'étaient plus tabulables hors écran) avec entrée
et restitution du focus ; les pastilles de salle sont numérotées 1…3 (le sas porte une
maison) et se décalent quand la fiche est ouverte ; le plan a des traits **non scalants** en
pixels (murs 1,4 px à 3,4:1, toiles ≥ 9 px avec zone de clic de 14 px, numéros sans
contour) et une plaque opaque sur tablette/mobile ; la barre passe sur **deux lignes dès
1100 px** (le plan disparaissait entre 721 et 880 px) ; l'intro ne laisse plus scroller avant
« Entrer ».

## Lumière : d'une ambiance à une lumière directe

Mesure d'attribution avant : **94 % de la lumière était ambiante**, un mur tenait dans
**9 niveaux d'amplitude**, 49 % des pixels d'une prise dans une seule tranche de 16 niveaux,
et une aquarelle ressortait **31 niveaux plus sombre que le mur** qui la porte.

| Levier | Avant | Après |
|---|---|---|
| `HEMI.intensity` | 0,34 | 0,20 |
| `scene.environmentIntensity` | 0,58 | 0,34 |
| `dalle.emissiveIntensity` | 0,13 | 0,05 |
| `SKY_FILL` (une seule lumière, **suit la pièce**) | 0,42 fixe, 5,4 × 26 m au centre du hall | 0,34, à la taille de la trémie de la pièce courante |
| `SUN.intensity` | 2,3 | 3,2 |
| `TABLE_SPOT.intensity` | 1,15 | **4,0** |
| Pool de spots | 6 | 12 |
| `toneMappingExposure` | 0,94 | 1,02 |
| Courbe finale (S) | aucune | `contrast 0,26`, `lift −0,008` |
| Fenêtre d'ombre du soleil | ±9 × ±21 m | ±15 × ±16 m (4096²) — les salles est/ouest sortaient du champ |

C'était **la** cause du délavé du sas : l'unique `RectAreaLight` de ciel, héritée du couloir,
était posée au centre du hall en 5,4 × 26 m et l'éclairait sans aucune occlusion (une
`RectAreaLight` ne projette pas d'ombre). Elle est désormais une lumière **par pièce**,
placée sous la trémie, à la taille de la verrière, avec un fondu de 0,45 s au passage d'une
baie (`lights.updateSkyFill`).

Autres corrections de rendu : halo d'**ombre de contact** derrière chaque cadre (le mur sous
un cadre mesurait exactement la valeur du mur nu) ; verrière ramenée de 2,35 à 1,35 linéaire
(60,8 % de la vue plafond étaient clippés) avec des meneaux de 90/40 mm et un bronze sombre ;
parquet désaturé à 30 % puis reverni (roughness 0,50, clearcoat 0,28) ; tuile de chaux
ramenée de 3,4 à 1,7 m (les taloches faisaient 80 cm) ; dorure en `metalness` 0,55 avec
`envMapIntensity` 3,5 ; cartel élargi à 24 × 14,8 cm ; plaques de salle et mur du nom en
2048 px / aniso 16 ; **cartouche d'entrée supprimé** (il répétait le mot-symbole, flottait
devant le mur et se lisait mal à 12 m).

Mesures après (captures 1440 × 900, `?dup=6`) : sas **130** de moyenne (p05 104, p95 154),
salles **115-138** (p05 46-61, p95 156-201). La dynamique est passée de 53 à ~100 niveaux.

## Reste ouvert

- `public/data/images/baigneuse.jpg` est une **capture d'écran Instagram** : le badge « 1/2 »
  et l'avatar sont incrustés dans l'image, visibles sur 6 des 30 accrochages en `?dup=6`.
  Il faut un export propre (l'utilisateur doit le fournir).
- Les masters font 1080 px : à DPR 2 la toile est agrandie de 1,24×. 1600 px seraient
  nécessaires pour un vrai 4K.
- Les plantes restent des « stickers » (12 feuilles plates, pas d'AO) — pistes chiffrées dans
  `.vibe/audit-rendu/RAPPORT.md` §10.
- Aucun fichier de `src/` n'est couvert par un test automatisé hors `probe.mjs` (géométrie).

## Session « sas réduit, charpente apurée, chemin de caméra » (suite)

### Le sas : 10,4 × 10,4 m et meublé

12 m de côté le laissaient vide : on y traversait trois fois sans rien y voir. Il fait
maintenant **10,4 m** (les salles 10,4 × 14), avec un **banc** contre le mur nord (décalé de
2,6 m pour ne pas gêner la baie), **quatre plantes** d'angle et la console du mur du nom.
Pourquoi pas moins : le mur du fond d'une salle porte deux toiles vues à 2,9 m ; sous
10,2 m de large, deux cadres de 1,7 m se chevauchent.

### La charpente : deux poutres, pas sept

Chaque salle portait 2 poutres encadrant la verrière + 2 ou 3 traverses + un bandeau :
six à sept pièces de bois sous une dalle de 10 m. Les **traverses sont supprimées**
(`beams: 0`) ; il reste les deux poutres du puits de lumière et le bandeau de la trémie. La
cimaise passe de 30 × 50 à **18 × 28 mm** : à 5 cm de haut, ce filet à 2,52 m se lisait comme
une poutre en travers de chaque mur.

### La « poutre » au-dessus des baies : une marche de couleur de sommet

Chaque tronçon de mur calculait son dégradé vertical sur **sa propre** hauteur. Le linteau
d'une baie (2,9 → 4,0 m) repartait donc à 0,99 quand le mur qu'il surmonte finissait à 1,04 :
une marche de 0,05 sur toute la largeur, lue comme une poutre à mi-hauteur. Le dégradé est
désormais indexé sur l'**altitude absolue** (`REF_H = 4,2`), donc continu d'un tronçon à
l'autre.

### Le chemin de la caméra : reculer, puis revenir

Deux arrêts d'un même mur étaient reliés par une **droite** à 2,9 m du nu : la caméra
glissait latéralement devant les toiles en pivotant, ce qui donne le tournis sur dix arrêts.
Un sommet **reculé de 1,15 m dans la pièce** est intercalé entre deux toiles d'un même mur
(cap à la bissectrice) : la caméra recule, tourne en gardant les deux toiles dans le champ,
puis revient sur la suivante. Le congé de `smoothPath` en fait un arc — 130 m de parcours,
paliers toujours exacts (30/30, écart 0,000 m).

### Changement de salle : fondu, pas trajet

Les pastilles de salle (et les touches 1-9) faisaient défiler 20 m de parcours en 400 ms,
en traversant les murs. Elles posent maintenant la caméra devant la première toile **sous un
fondu au papier** (`controls.snapToT` + voile de 170 ms/340 ms). Le mini-plan perd son cône
de vision (sur 96 px de haut, il était plus gros que la pièce).

### Textures : ménage et nouveaux assets

`public/assets/textures/ai/` pesait 33 Mo pour 8 textures, chacune en quatre fichiers
(`.webp`, `.jpg`, `-1024.webp`, `-1024.jpg`). Les JPEG ne servaient que de repli d'un temps
où WebP n'était pas universel : ils sont supprimés, il ne reste que **`<nom>.webp` +
`<nom>-1024.webp`** — 12 Mo. Les sources JPEG déposées pour conversion sont désormais
`gitignore` et converties par `.vibe/shotkit/jpg2webp.mjs` (Chromium + canvas, qualité 0,86).

Nouveaux assets branchés : **`plaster-lisse`** porte la couleur des murs (l'ancien
`plaster`, taloché, ne sert plus qu'au relief — ses coups de taloche se lisaient comme des
rayures à 1 m) ; `painted` (charpente), `oak` (mobilier) et `leaf` (végétation) sont pris
automatiquement par les slots qui les attendaient.
