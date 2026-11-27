# Refonte appliquée — `feat/rebuild-v3`

Ce qui est **fait** sur cette branche, ce qui reste à arbitrer, et comment le rythme de scroll
a été engagé (§4). Le diagnostic et les propositions sont dans
[`audit-ui.md`](audit-ui.md), [`audit-3d.md`](audit-3d.md) et [`proposals/`](proposals/).
Le système cible est dans [`../../DESIGN.md`](../../DESIGN.md).

## Avant / après

![](rebuild/avant-apres-desktop.jpg)

![](rebuild/avant-apres-mobile.jpg)

Trois commits :

| Commit | Contenu |
|---|---|
| `refonte(ui)` | chrome de 8 amas à 3, cartel en bas, fiche recomposée, index, échelle typo à 5 marches |
| `refonte(3d)` | lumière qui entre par la trémie, cadres devant le mur, tubes laiton, `TableSpots`, AO + bloom + SMAA + grain |
| ce document | synthèse, arbitrages restants, rythme |

## 1. UI — ce qui a été appliqué

| Point de l'audit | État |
|---|---|
| 8 amas → 3 (identité, cartel, commandes) | fait |
| plan flottant, pastilles, compteur 58 px, bannière, curseur, hints en boucle | supprimés |
| le plan devient un rail de 1 px (graduations cliquables, salle courante, curseur caméra) | fait |
| fiche : image bord à bord rayon 0, méta en grille 2 × 2, actions sur une rangée | fait |
| index : une grille, œuvres non rognées, méta sur 2 lignes | fait |
| 22 tailles de police → 5, 9 rayons → 1, 11 ombres → 2, 20 transitions → 4 | fait |
| icônes SVG dessinées, surfaces du navigateur (sélection, focus, scrollbar) accordées | fait |
| copie : plus de sur-titre au-dessus d'un titre, plus de « · » ni de tiret cadratin dans les métas | fait |

![](rebuild/apres-fiche.png)

![](rebuild/apres-index.png)

## 2. 3D — ce qui a été appliqué

Détail du câblage et des leviers dans [`3d-integration.md`](3d-integration.md).
Les quatre P0 de l'audit sont traités : cadre hors du mur et passe-partout non coplanaire,
luminaires fins qui éclairent vraiment, `emissiveIntensity` de la toile à ~0, chaîne de
post-processing AO → bloom → ACES → SMAA → grain.

## 3. Les arbitrages, tranchés

| # | Point | Décision | Valeur livrée |
|---|---|---|---|
| 1 | Direction de chrome | **B** — deux amas, le rail *est* le plan | fait |
| 2 | Fiche d'œuvre | **bord à bord**, rayon 0, filet de 1 px sous l'image (sans lui, l'aquarelle blanche se confondait avec le papier du panneau) | fait |
| 3 | Étalonnage 3D | **V1 « Pellicule »** : contraste +10 %, halo doux, grain discret | `bloom.strength 0.22`, `grain 0.020`, exposition 0,95 |
| 4 | Cadres & luminaires | **A « discrète »** : chêne 55 mm, passe-partout 20 mm, tube laiton Ø 22 mm sur 74 % | `FRAME_VARIANT = 'discrete'` |
| 5 | Index | **non rogné** (`contain`), dans des fenêtres 4/3 de même taille : l'œuvre entière est visible, la grille reste alignée. Rogner une aquarelle pour la faire entrer dans une vignette, c'est décider à la place du peintre de son cadrage | fait |
| 6 | Intro | **bande de 3 aperçus conservée** : trois vraies toiles valent mieux qu'un mot seul pour donner envie d'entrer, et c'est la seule image du site qui ne soit pas de la 3D | fait |
| 7 | Mode libre | **entrée dans l'index, pas de bouton permanent** : zéro chrome dans la scène, une seule porte, découvrable. Pas de raccourci clavier seul (un raccourci muet n'est pas découvrable, un raccourci annoncé est du chrome) | fait |

### Couleur du cadre — chêne, pas charbon

Le cadre « discret » était `0x2a2724`, presque noir : il lisait « galerie contemporaine » et pesait
plus que les toiles sur un mur clair. Passé à **`0x7a5c3a`** (chêne moyen), qui rend un brun chaud
sous l'exposition 0,95 + ACES sans sauter aux yeux, et qui est la couleur du guide de style.

### Motif du plâtre — tuile plus large, bosse plus douce

La trame de la texture se devinait sur les grands aplats. `PLASTER_TILE` **8,5 m → 13 m** (moins de
répétitions sur la longueur du hall) et `bumpScale` **0,02 → 0,014**.

### Halo et grain — V1, plus retenu

`POST_TUNING.bloom.strength` **0,30 → 0,22** : la tache de soleil ne bave plus sur le mur.
`grain.amount` **0,028 → 0,020** : présent à 100 %, invisible quand on regarde une toile.

### Cadrage au repos — recul partiel, le reste au rythme

`viewDist` desktop **2,6 → 2,85 m** : la caméra recule de 25 cm, les toiles respirent et la
première ne touche plus le bord. La cause profonde (la caméra passe *à côté* d'une œuvre, pas
devant) est un problème de **rythme**, pas de distance focale : c'est la courbe de « dwell » du
point 4 qui la règle, en faisant s'arrêter la caméra face à chaque toile.

## 4. Rythme de scroll — fait (option 1, courbe de « dwell »)

Décision : **on le fait, après**. Le plan est prêt, il ne dépend de rien d'autre.

**Livré** : option 1 — `createDwellCurve()` dans `src/gallery/layout.ts` (fonction pure,
~25 lignes) + `cameraPath()` (bornes z du trajet et centres des paliers), câblées dans
`src/gallery/controls.ts` : `camZ = lerp(zFirst, zLast, dwell(t))` remplace l'ancien tracé
CatmullRom (points colinéaires : écart < 1 mm, comportement au repos inchangé), `scrollT`
= centre du palier de l'œuvre, repli linéaire si `prefers-reduced-motion`. `progressT()` et
la détection de fin ne bougent pas.

L'effet recherché (le rythme d'une salle de musée) est un **temps d'arrêt devant chaque œuvre**,
pas une animation de plus. Deux façons, par ordre de préférence :

1. **Courbe de « dwell », sans dépendance** (recommandé) — une fonction pure dans `layout.ts`,
   ~25 lignes : `camZ = lerp(zFirst, zLast, dwell(t))` où `dwell()` est monotone et de dérivée
   nulle sur ±8 % autour de chaque œuvre. La caméra ralentit devant chaque toile et accélère
   entre deux, sans que le visiteur ait à arrêter de scroller. `progressT()` et la détection de
   fin ne bougent pas. Repli linéaire en `prefers-reduced-motion`.
2. **GSAP ScrollTrigger** — `ScrollTrigger` sur `#scroll-spacer`, `scrub: 0.6`, une seule timeline
   de caméra, `post.render` gardé hors de la boucle GSAP, un seul `ScrollTrigger.refresh()` après
   le chargement des textures. Plus de moyens (labels, snap, pinning), ~45 ko de plus et un
   `ScrollTrigger.scrollerProxy` à câbler sur le scroll natif.

Dans les deux cas, le même bonus gratuit : le **fondu de la légende** (240 ms) quand on change
d'œuvre, aujourd'hui instantané.
