# Textures précalculées au build (WebGPU/Dawn en Node)

Les 4 textures procédurales de la scène 3D (`src/gallery/scene.ts`) étaient générées
en canvas 2D **synchrone** au boot (plaster 2048² avec 26 000 `fillRect`, floor 4096² +
roughness 1024², ceiling 2048², runner 1024²), ce qui bloquait le main thread au chargement.
Elles sont désormais **précalculées au build** et servies comme fichiers statiques WebP.

## Génération

```bash
node scripts/gen-textures.mjs
```

Produit dans `public/assets/textures/` (q90, tailles identiques aux originales) :

| Fichier | Taille | Contenu |
|---|---|---|
| `plaster.webp` | 2048² | plâtre : grain fin + marbrures radiales |
| `floor.webp` | 4096² | parquet : teinte par lame, veines (Bézier), joints de bout, nœuds |
| `floor-rough.webp` | 1024² | roughness map du parquet (joints + micro-rayures) |
| `ceiling.webp` | 2048² | enduit de plafond : grain + marbrures |
| `runner.webp` | 1024² | tapis : trame croisée 8 px + liserés |

### Méthode de rendu

1. **WebGPU en Node via le package `webgpu` (Dawn)** — compute shaders WGSL qui
   reproduisent chaque générateur (scatter de features en `atomicMax` sur tampons
   `dark`/`light`, puis passe « combine » pixel par pixel : base, dégradés, joints,
   marbrures radiales, nœuds, liserés). Le rendu de chaque texture est isolé dans un
   **petit processus enfant** (`node -e`) car le binding natif Dawn `win32-x64` peut
   SIGSEGV de façon reproductible quand on compile des shaders dans un gros processus
   Node (constaté et contourné). Le parent n'importe jamais Dawn.
2. **Fallback build-time CPU** si Dawn est indisponible : même logique en JS pur,
   pixel par pixel dans un `Buffer`, encodée via `sharp`. La méthode utilisée est
   loguée par le script.

Le script est **idempotent** (graines déterministes → octets identiques, vérifié par
sha256) et tourne en **~5 s** (< 30 s). `public/assets/textures/` n'est PAS gitignoré
(`.gitignore` ne matche que les dossiers nommés `build/`).

## Chargement runtime (`src/gallery/scene.ts`)

`precalcTexture(name, size, draw, opts, placeholder, srgb)` retourne immédiatement une
texture placeholder 2×2 (boot non bloquant), charge `${BASE_URL}assets/textures/<name>.webp`
en arrière-plan via `TextureLoader` et l'injecte dans la texture courante — **mêmes
paramètres** (repeat dépendant de `len`, anisotropy, colorSpace SRGB, `bumpMap` pour le
plâtre, `NoColorSpace` pour la roughness map). Si le chargement échoue (404, WebP non
supporté), le **générateur canvas 2D d'origine** (`draw`, code conservé tel quel) est
exécuté : aucun changement de comportement visuel.

Note : le fichier `floor.webp` est en 4096² pour desktop comme pour mobile (le mode
`coarse` ne génère plus qu'en fallback) — qualité identique ou supérieure partout.

## Validation

Voir `.vibe/critiques/wgpu-textures.md` (méthode, tailles, temps, boot avant/après,
résultats fallback, captures dans `.vibe/shots-wgpu/`).
