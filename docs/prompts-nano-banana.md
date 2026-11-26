# Textures IA (Nano Banana) — prompts prêts à l'emploi

La galerie charge les textures dans cet ordre de priorité (`src/gallery/textures.ts`, `precalcTexture`) :

1. `public/assets/textures/ai/<name>.webp` ← **tes images IA (prioritaires)**
2. `public/assets/textures/<name>.webp` (textures procédurales précalculées au build)
3. générateur canvas 2D interne (fallback, toujours dispo)

## Comment faire (résumé)

1. Génère l'image avec Nano Banana (ou autre), puis exporte en **WebP q85–90, max 2048 px** (1024 pour le lointain).
2. Dépose le fichier dans `public/assets/textures/ai/` avec **exactement** le nom du slot :
   `plaster.webp`, `floor.webp`, `ceiling.webp`, `beam.webp`, `metal.webp`, `rug.webp`, `gilt.webp`.
3. Recharge la page : l'image IA est utilisée immédiatement (aucun rebuild nécessaire en dev ;
   en prod, `vite build` copie `public/` dans `dist/` automatiquement).
4. Le dossier `ai/` est ignoré par git (`.gitignore` interne) : tes assets ne seront pas commités,
   et `scripts/gen-textures.mjs` ne les écrasera **jamais** (il ne touche que les 5 noms de base).

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
