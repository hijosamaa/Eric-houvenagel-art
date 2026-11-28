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
