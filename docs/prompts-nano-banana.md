# Textures IA (Nano Banana) — prompts prêts à l'emploi

La galerie charge les textures dans cet ordre de priorité (`src/gallery/textures.ts`, `precalcTexture`) :

1. `public/assets/textures/ai/<name>.webp` ← **tes images IA (prioritaires)** ; une seule
   forme par texture (`<name>.webp` + `<name>-1024.webp`), les JPEG déposés sont convertis
   puis supprimés (`.vibe/shotkit/jpg2webp.mjs`)
2. `public/assets/textures/<name>.webp` (textures procédurales précalculées au build)
3. générateur canvas 2D interne (fallback, toujours dispo)

## Comment faire (résumé)

1. Génère l'image avec Nano Banana (ou autre). Un **JPEG ou PNG 2048² suffit** : dépose-le tel
   quel, il sera converti en WebP (2048 + 1024) puis supprimé.
2. Nomme-le **exactement** comme le slot : `plaster`, `floor`, `ceiling`, `beam`, `metal`,
   `rug`, `gilt`, `painted`, `oak`, `leaf`, `plaster-lisse` (+ `.jpg`/`.png`).
3. Recharge la page : l'image IA est utilisée immédiatement (aucun rebuild nécessaire en dev ;
   en prod, `vite build` copie `public/` dans `dist/` automatiquement).
4. Le dossier `ai/` est **versionné** (les `.webp` sont commités sur `main`, seuls les `.png/.jpg`
   sources et fichiers temporaires sont ignorés) : chaque texture déposée doit être `git add` +
   commit + push pour être publiée. `scripts/gen-textures.mjs` ne les écrase **jamais**
   (il ne touche que les 5 noms de base dans `textures/`).

Conversion PNG → WebP si besoin :

```bash
npx sharp-cli -i in.png -o public/assets/textures/ai/rug.webp resize 2048 -- webpQuality 88
# ou via Squoosh.app (WebP, qualité 85-90)
```

## Règles communes à toutes les images (important)

- **Seamless / tileable** (bords qui se raccordent) pour tout ce qui est répété : plaster, floor, ceiling, beam, rug, gilt.
- **Albedo uniquement** : pas d'ombres portées, pas de reflets de source lumineuse, pas de AO baked dans l'image (la scène calcule déjà ombres + AO dynamiques).
- **Pas de blanc pur** (ça déclenche le bloom), tons moyens.
- **Aucun texte, watermark, signature, cadre** dans l'image.
- Éclairage **uniforme, diffus, frontal** (photo de matière, pas de scène).
- `rug` : vue **plongée orthographique** (tapis à plat, vu du dessus).

## Prompts

### `plaster.webp` — enduit de mur (2048, seamless)
> Seamless tileable texture of a warm limewash plaster wall, very subtle trowel marks and fine mineral grain, color around #f2ede4 (warm off-white), matte, no cracks, no stains, no vignetting, even soft frontal lighting, 2048x2048, photorealistic, edges wrap perfectly.

### `floor.webp` — parquet chêne (2048 ou 4096, seamless)
> Seamless tileable texture of a wide-plank oak parquet floor seen from directly above, warm honey-oak planks with natural wood grain, long grain direction, subtle per-plank color variation, thin dark seams between planks and staggered butt joints, satin finish, soft even lighting, no reflections, no people, 2048x2048, photorealistic, tileable on all edges.

### `ceiling.webp` — enduit de plafond (2048, seamless)
> Seamless tileable texture of a plain painted plaster ceiling, slightly warm white #faf8f3, very fine stipple grain, matte, even soft lighting, no stains, 2048x2048, photorealistic, edges wrap perfectly.

### `beam.webp` — chêne sombre des poutres (1024, seamless dans la longueur)
> Seamless tileable dark oak wood texture, grain running along the long axis, deep brown with occasional small knots, satin varnish, even lighting, no bark, 1024x1024, photorealistic, wraps on all edges.

### `metal.webp` — bronze brossé des châssis de verrière (512 ou 1024, seamless)
> Seamless tileable brushed bronze metal texture, fine vertical brushing lines, dark warm bronze tone around #4a4136 with subtle lighter streaks, metallic but no mirror reflections, even lighting, 1024x1024, photorealistic, wraps on all edges.

### `rug.webp` — tapis tissé par salle (2048, seamless, tuile de 2,6 m)
> Seamless tileable pattern of a hand-woven wool carpet field seen from directly above, deep terracotta / madder red ground with a subtle geometric diamond lattice in cream and charcoal, small scattered motifs inside the diamonds, visible woven texture, slightly worn, muted colors, even soft lighting, no border (the border is 3D geometry), no fringe, 2048x2048, photorealistic, tiles perfectly on all edges.

Alternative « tapis entier avec bordure » : si tu préfères un vrai tapis entier (médaillon central + bordure), génère-le en 2048×2048 vu du dessus et on passera le slot en `wrap: clamp` + `repeat 1,1` par salle (me le dire, c'est un petit changement dans `scene.ts`).

### `gilt.webp` — dorure des cadres (512 ou 1024, seamless)
> Seamless tileable burnished gold leaf texture for a picture frame, warm antique gold around #c9a24f, fine brushed micro-scratches and subtle patina variation, NO glitter, NO sparkle, NO paillettes (would alias), satin metallic sheen, even lighting, 1024x1024, photorealistic, wraps on all edges.

## Slots disponibles et leur rôle

| Fichier `ai/` | Remplace | Vu à | Taille conseillée |
|---|---|---|---|
| `plaster.webp` | murs | partout | 2048 |
| `floor.webp` | parquet | sol | 2048–4096 |
| `ceiling.webp` | plafond | haut | 2048 |
| `beam.webp` | poutres + mobilier bois | plafond / bancs / portails | 1024 |
| `metal.webp` | châssis de la verrière | contre-jour | 512–1024 |
| `rug.webp` | tapis (1 par salle) | sol, sous le parcours | 2048 |
| `gilt.webp` | cadres dorés | œuvres | 512–1024 |

Après dépôt, vérifie visuellement (les screenshots : `node .vibe/shotkit/shoot-v5.mjs http://localhost:5199/ .vibe/shots-check "check=0.45:1440x900:1"`).

---

## Qualité des masters d'œuvres (à reprendre)

Les masters de `public/data/images/` font **1080 px** de côté. À DPR 2, une toile de 1,5 m
vue à 2,9 m occupe ~1 340 px d'écran : l'image est donc **agrandie de 1,24×**. Il faudrait
des exports à **1 600-2 000 px** pour un rendu réellement 4K sur écran Retina.

Et `baigneuse.jpg` est une **capture d'écran Instagram** (badge « 1/2 » en haut à droite,
avatar rond en bas à gauche, tous deux incrustés dans l'image) : à refaire depuis l'original.

## Slots désormais fournis (2025-11-28)

`plaster-lisse` (murs), `painted` (charpente), `oak` (mobilier), `leaf` (végétation) sont
livrés et branchés. Ce qui reste sur le générateur procédural : **rien d'important**.

### `painted.webp` — bois peint de la charpente (2048, seamless)
La structure du hall (poutres, dalles, passerelles) est **peinte blanc cassé** : le bois ne
doit se lire que par son grain très fin, jamais par un contraste de couleur.

> Seamless tileable texture of off-white painted wood, matte eggshell finish over oak, extremely subtle grain showing through the paint, colour around #eee8dd, faint brush texture, no drips, no chipped paint, no knots, even soft frontal lighting, 2048x2048, photorealistic, edges wrap perfectly.

### `oak.webp` — chêne clair du mobilier (2048, seamless)
Bancs, consoles, socles. Veine longue, ton miel clair, **sans vernis brillant**.

> Seamless tileable texture of pale oak wood, long straight grain running along the vertical axis, light honey colour around #b8935f, fine open grain, a few small sound knots, bare oiled finish (matte, no varnish gloss), even soft frontal lighting, no reflections, 2048x2048, photorealistic, tiles perfectly on all edges.

### `leaf.webp` — fibre de feuille (1024, seamless)
**Carte de luminance neutre**, pas une couleur : les feuilles portent leur vert en couleur de
sommet (sinon deux verts multipliés donnent un feuillage noir à l'ombre).

> Seamless tileable grayscale-ish leaf surface texture, neutral luminosity map (no green tint), fine veins, slightly waxy micro-bumps, mid-grey around #b8b8b8, no highlights, no strong shadows, even flat lighting, 1024x1024, photorealistic, wraps on all edges.

### Variante `plaster-lisse.webp` — badigeon très lisse (2048, seamless, optionnel)
L'asset `plaster` actuel a des coups de taloche marqués, qui se lisent comme des rayures à
1 m du mur. Une version plus lisse (badigeon de chaux essuyé) serait meilleure pour les
salles d'accrochage.

> Seamless tileable texture of a very smooth limewash wall, almost no trowel marks, only an extremely fine mineral haze, warm off-white #f3efe7, matte, no stains, no cracks, even soft frontal lighting, 2048x2048, photorealistic, edges wrap perfectly.

### Ce qu'il ne faut PAS générer
- Pas de AO / d'ombre baked dans les textures (la scène les calcule).
- Pas de blanc pur (déclenche le bloom) ni de noir pur.
- Pas de reflet de source (les reflets sont calculés par le moteur).

---

## Rappel de la chaîne de chargement (mise à jour)

`precalcTexture()` demande, dans cet ordre :

1. `assets/textures/ai/<name>.webp` puis `.jpg` — **pleine résolution 2048²** (priorité HD) ;
2. la variante `-1024` n'est demandée qu'**en repli** : la pleine résolution passe
   toujours d'abord (sur mobile compris), sinon on ne voit jamais l'asset HD ;
3. `assets/textures/<name>-<taille>.webp` (généré au build par `scripts/gen-textures.mjs`) ;
4. le générateur canvas interne.

Le doublon `public/tex/` (21 Mo identiques servis une seconde fois) a été supprimé :
**un seul dossier**, `public/assets/textures/ai/`.

Un asset peut être **étalonné à l'upload** (`TexOpts.grade`, filtre CSS appliqué au
transfert) : c'est ainsi que le parquet est désaturé à 45 %, la chaux à 78 % de contraste et
la dorure ramenée dans le nuancier du hall. Si un asset arrive trop saturé ou trop
contrasté, on le corrige ici plutôt que de le refuser.
