# Rendu 3D — câblage et leviers

État livré sur la branche `feat/rebuild-v3`, commit `refonte(3d)`. Ce document dit **comment
c'est branché** et **quoi toucher** pour ajuster ; la spécification d'origine est dans
[`audit-3d.md`](audit-3d.md).

## 1. Ce qui a changé, par fichier

| Fichier | Rôle |
|---|---|
| `src/gallery/frames.ts` *(nouveau, ~410 l.)* | cadre (profil, profondeur, passe-partout, biseau), cartel musée, luminaire de tableau. Supprime l'enfouissement du cadre dans le mur et le z-fighting du passe-partout. |
| `src/gallery/lights.ts` *(nouveau, ~265 l.)* | constantes de lumière (`HEMI`, `SUN`, `SKY_FILL`, `TABLE_SPOT`), trémie + meneaux projetants, et `TableSpots` : pool de spots avec hystérésis et fondu. |
| `src/gallery/post.ts` *(nouveau, ~530 l.)* | la chaîne de post-processing et ses réglages (`POST_TUNING`). |
| `src/gallery/scene.ts` | utilise les deux modules ci-dessus ; exposition 0,95, brouillard `FogExp2`, plafond avec trémie, matériaux. |
| `src/gallery/paintings.ts` | délègue le cadre et le luminaire à `frames.ts`, `emissiveIntensity` de la toile à ~0. |
| `src/main.ts` | crée le pipeline, le redimensionne, l'appelle à la place de `renderer.render`, et alimente `TableSpots`. |

## 2. Le câblage dans `src/main.ts`

```ts
import { createPost, type PostPipeline } from './gallery/post';

const { renderer, scene, camera, sun, spots } = createScene(canvas, layout, pixelRatio, { shadows, coarse });

const post: PostPipeline | null = createPost(renderer, scene, camera, { shadows, coarse });

function resize(): void {
  /* … renderer.setSize, camera.aspect … */
  post?.setSize(window.innerWidth, window.innerHeight);
}

// dans tick(), avant le rendu :
spots.hoverIndex = hoverId ? layout.placed.findIndex((q) => q.work.id === hoverId) : -1;
spots.update(camZ, layout.placed, dt);

// à la place de renderer.render(scene, camera) :
if (post) post.render(dt);
else renderer.render(scene, camera);
```

`createPost()` renvoie **`null`** si `EXT_color_buffer_half_float` (et `_float`) n'existent pas :
le rendu direct est alors conservé, sans perte de fonction. Sur mobile (`coarse`), la chaîne démarre
en `'off'` : aucune allocation de buffer.

## 3. Les leviers

| Ce que tu veux changer | Où | Constante |
|---|---|---|
| Passer en cadre muséal (aucun luminaire visible) | `frames.ts:28` | `FRAME_VARIANT = 'museum'` |
| Cacher le luminaire sans changer le cadre | `frames.ts:31` | `PICTURE_LIGHT_VISIBLE` |
| Épaisseur du cadre, passe-partout, biseau, tube | `frames.ts:42` | `FRAME_METRICS` |
| Position du cartel sur le mur | `frames.ts:34` | `WALL_FACE_Z` |
| Intensité / couleur / angle des spots | `lights.ts` | `TABLE_SPOT` |
| Soleil, ciel, remplissage diffus | `lights.ts` | `SUN`, `HEMI`, `SKY_FILL` |
| Occlusion, bloom, grain, MSAA | `post.ts` | `POST_TUNING` |
| Exposition générale | `scene.ts:373` | `toneMappingExposure = 0.95` |

Après chaque essai, `window.__gallery.perf().post` donne `{ passes, gpuMs }` et
`window.__gallery.perf().render` le nombre d'appels de rendu.

## 4. Décisions et écarts par rapport à l'audit

1. **Pas de TAA.** Il n'existe pas de TAA par reprojection en WebGL 2 avec `EffectComposer` dans
   three 0.187 : `TAARenderPass`/`SSAARenderPass` sont des accumulateurs d'images (ghosting sur une
   caméra qui coulisse), et la vélocité n'est écrite que par le backend WebGPU. Livré : MSAA 4× sur
   le render target + `SMAAPass`. Le chemin WebGPU/TSL (`mrt({ velocity })` + `traa()`) est
   documenté dans `post.ts` mais non implémenté.
2. **`shadowMap.autoUpdate = false`.** `GTAOPass` refait un `renderer.render()` complet pour son
   G-buffer ; sans ça, toutes les shadow maps seraient recalculées deux fois par frame.
3. **G-buffer propre à GTAO.** On ne branche pas `setGBuffer()` sur le render target du composer :
   il est multisample, donc sa profondeur n'est pas échantillonnable.
4. **Le bloom est en ½ résolution**, pas ¼ : `UnrealBloomPass.setSize()` divise déjà par deux.
5. **`GrainPass` maison** plutôt que `FilmPass` : le bruit de `FilmPass` n'est pas symétrique
   (`base + base * clamp(...)`) et éclaircit l'image au lieu de la grainer.

## 5. Restes à arbitrer (esthétique, mesuré sur captures)

| Point | Constat | Levier |
|---|---|---|
| Cadre sombre | la variante « discrète » lit presque noire sur un mur clair ; c'est plus « galerie contemporaine » que chêne | couleur du bois dans `FRAME_METRICS`, ou passer en `'museum'` |
| Halo de la trame solaire | la tache de soleil sur le mur, près du bord gauche, est très lumineuse et le bloom la fait baver | `POST_TUNING.bloom.strength` (0,30 → 0,22) ou le seuil |
| Grain | ±0,028 à 24 Hz se voit à 100 % | `POST_TUNING.grain.amount` |
| Occlusion | le rayon de 0,30 m donne un contact net ; en dessous de 0,22 m le cadre décolle | `POST_TUNING.ao.radius` |
