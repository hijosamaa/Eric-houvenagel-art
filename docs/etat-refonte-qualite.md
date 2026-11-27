# Refonte qualité de la galerie — état d'avancement (reprise)

> Document de reprise : il dit ce qui est fait, ce qui reste, et comment vérifier.
> Mis à jour à chaque session. Dernière mise à jour : session « charpente peinte + assets ».

## Où en est le rendu

Le hall est aujourd'hui un **atelier d'artiste** : dalle à trémie, charpente **peinte**
(poutres maîtresses chanfreinées + solives + sablière, plus de chêne sombre), verrière à
meneaux fins avec ciel dégradé, murs à la chaux, **parquet chêne** et plantes en pots.

Fichiers créés : `src/gallery/wood.ts`, `src/gallery/plants.ts`, `src/gallery/ceiling.ts`.
Refondus : `scene.ts`, `lights.ts`, `textures.ts`, `frames.ts`, `paintings.ts`,
`furniture.ts`, `post.ts`, `physics.ts`, `main.ts`.

## Les trois bugs qui ont tout débloqué (ne pas régresser)

1. **Sol jamais rendu** (`scene.ts`) — les quads du parquet étaient ordonnés à l'envers :
   le produit vectoriel donnait une normale −Y et le back-face culling supprimait le sol
   entier. On voyait le fond de scène à travers (l'« aplat blanc » des captures d'avant).
   Sens correct : `(x0,z0) → (x0,z1) → (x1,z1)` puis `(x0,z0) → (x1,z1) → (x1,z0)`.
2. **Assets IA silencieusement ignorés** (`textures.ts`) — `precalcTexture()` renvoyait un
   placeholder 2×2 puis remplaçait l'image. three alloue les textures en stockage
   **immuable** (`texStorage2D`) : le remplacement partait en
   `glTexSubImage2D: Offset overflows texture dimensions` et le GPU gardait le 2×2.
   Correctif : `t.dispose()` **avant** `t.needsUpdate = true` (réallocation complète).
   Conséquence : `floor`, `plaster`, `gilt`, `metal`, `beam` sont maintenant réellement
   affichés — d'où le changement complet du nuancier.
3. **Tone mapping** (`scene.ts`) — ACES → **Neutral** (Khronos PBR Neutral) à exposition
   0,94 : ACES désaturait dès 0,6 de luminance et transformait le chêne en gris-blanc.

## Décisions de direction artistique

- **Charpente peinte** blanc cassé (l'utilisateur n'aime pas les poutres) : le bois ne se
  lit que par son relief, ses chanfreins et ses ombres.
- **Le sol est l'ancrage** : 60 lames de 20 cm (12 m / 60 = 7 lames par tuile d'asset de
  1,40 m). L'asset fournit le fil et les nœuds, la géométrie fournit le joint (gorge cuite
  en couleurs de sommet, 1,2 cm de chaque côté) parce qu'en filtrage anisotrope le GPU
  moyenne les joints sur 3-4 lames : un sol en aplat de couleur.
- **Étalonnage des assets à l'upload** (`TexOpts.grade`, filtre CSS dessiné au transfert) :
  le parquet est désaturé à 45 %, la chaux à 78 % de contraste, la dorure à 62 %. C'est ce
  qui permet d'utiliser les assets tels quels sans qu'ils jurent avec le hall.
- **Tissus, métaux** : meneaux acier anthracite chaud (jamais noirs), dorure à 78 % de
  métal (au-delà elle ne renvoie plus que l'IBL et vire olive).

## Ce qui reste à faire

### Priorité 1 — finitions visibles
- [ ] **Ombres de contact** : les socles et le banc ne « posent » pas encore sur le sol.
      Piste : AO cuit en couleurs de sommet au pied des meubles, ou GTAO `radius` 0,25 m
      sur les petits objets (le pass est global : plutôt cuire l'AO).
- [ ] **Sous-faces de la charpente** : encore plates en vue longue. Piste : dégradé de
      couleur de sommet sur les faces du bas des poutres/solives (assombrir au contact de
      la dalle), qui remplace un AO que GTAO ne capte pas à 3,4 m.
- [ ] **Dorure** : vérifier au close-up la tuile de 80 mm (contraste 0,62 / brightness 1,16)
      après le dernier réglage — la dernière série de captures n'a pas été rejugée.
- [ ] **Plantes** : silhouettes encore un peu « brindilles » (olivier, eucalyptus). Ajouter
      du feuillage et un pot plus large ; les 7 espèces sont dans `plants.ts`
      (`plantPlacements` pour la mise en espace).

### Priorité 2 — assets à demander à l'utilisateur (Nano Banana)
Slots sans asset (`docs/prompts-nano-banana.md` à compléter, section « restants ») :
- `oak` — chêne clair pour le mobilier (banc, console, socles) ;
- `painted` — bois peint blanc cassé, grain à peine perceptible (charpente) ;
- `leaf` — fibre de feuille **neutre** (carte de luminance, pas une couleur verte) ;
- `plaster` — déjà là, mais une variante « badigeon très lisse » serait meilleure que les
  coups de taloche actuels.

### Priorité 3 — vérifications
- [ ] `npm run build` passe (fait), tester la version prod (`npm run preview`) : la
      qualité des textures en 2048 et le tone mapping Neutral changent le rendu.
- [ ] Perf réelle : le headless swiftshader n'est pas représentatif. Le sol fait 9 600
      triangles (60 lames × 5 colonnes × 20 rangées × 2), négligeable.
- [ ] Mobile : `coarse` → textures 1024, pas de GTAO, hemi 0,46. À revalider (le
      changement d'environnement PMREM et de tone mapping impacte aussi le mobile).

## Comment vérifier visuellement

Serveur de dev (port 5199) puis captures :

```bash
PLAYWRIGHT_BROWSERS_PATH=/c/Users/Hijo/AppData/Local/ms-playwright \
  node .vibe/shotkit/shoot-q.mjs .vibe/shots-q-pNN
```

12 vues : parcours guidé 0 → 0,85 (scroll), détails plafond / cadres / sol / plantes /
mur droit, mobile. Les captures sont déterministes : deux séries identiques au pixel près
signifient que le changement n'a pas été pris en compte (c'est ainsi qu'a été trouvé le
bug du sol).

Sondes utiles (dans `.vibe/shotkit/`) : `probe.mjs` (taille/valeurs du `map` du sol),
`probe4.mjs` (fond rouge : prouve si une surface est rendue ou non), `probe6.mjs`
(matériau du sol isolé).

## État git

Branche `main`. Le présent commit contient la refonte complète (charpente, sol, plants,
assets réellement pris en compte, tone mapping Neutral). Aucune régression connue de
build ou de typage (`npx tsc --noEmit` OK).
