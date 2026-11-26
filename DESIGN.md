# DESIGN.md — Eric Houvenagel, galerie virtuelle

Source de vérité du langage visuel du site. Ce fichier décrit **ce qui est décidé**, pas ce qui
existe aujourd'hui : l'écart entre les deux est mesuré dans
[`docs/design/audit-ui.md`](docs/design/audit-ui.md), et les maquettes de la cible sont dans
[`docs/design/proposals/`](docs/design/proposals/).

> `PRODUCT.md` n'existe pas encore dans ce dépôt. Ce document a été écrit à partir du code, du
> [`docs/style-guide.md`](docs/style-guide.md) (déjà très solide sur l'intention) et des captures
> réelles du rendu. Si tu veux figer le contexte produit (public, objectifs, contraintes de
> publication), on peut lancer un `PRODUCT.md` séparément — rien ici n'en dépend.

Le site est une **salle**. Le mode de la surface est **Experience** : le visiteur est à l'intérieur
de l'œuvre, l'interface doit se retirer. Deux surfaces secondaires ont leur propre mode :
la fiche d'œuvre et l'index sont en **Read**, l'écran d'entrée en **Persuade**.

---

## 1. Les trois principes

1. **L'œuvre est le seul objet lumineux de l'écran.**
   Aucun élément d'interface n'a le droit d'être plus contrasté qu'un tableau. Conséquence
   concrète : pas de surface pleine, pas de pastille opaque, pas de bouton sombre de 44 px, pas de
   cartes flottantes. Le chrome se dessine en **filets de 1 px** et en **typographie**.

2. **Un seul rayon : le cercle.**
   Toute surface rectangulaire a `border-radius: 0` — images, fiches, panneaux, cartes, boutons,
   champs. Seuls les éléments *circulaires* (flèches précédent/suivant, points) sont ronds.
   Cela supprime d'un coup les 9 rayons concurrents actuels (2/6/8/12/14/16/18/50 %/999 px) et
   l'effet « bulle » des pilules qui date le site.

3. **Trois amas, jamais quatre.**
   Le chrome visible se répartit au maximum en trois groupes ancrés : identité, légende,
   navigation. Tout ce qui ne rentre pas dans ces trois amas est soit supprimé, soit fusionné.
   Une pastille de pastilles (points 1-5) + un panneau-plan + un compteur géant + une pilule HUD
   qui disent tous les quatre la même position, c'est trois amas de trop.

---

## 2. Couleur

La palette du [`docs/style-guide.md`](docs/style-guide.md) est conservée telle quelle : elle est
tirée des tableaux et fonctionne. Ce qui change est son **usage**.

| Token | Valeur | Rôle | Interdit |
|---|---|---|---|
| `--bg` | `#faf7f2` | fond de page, papier | jamais `#fff` pur |
| `--paper` | `#fffdf9` | surface de la fiche d'œuvre, index | jamais sur le fond de page |
| `--ink` | `#20242a` | titre, valeur, glyphe de commande | jamais en aplat de plus de 44 px |
| `--muted` | `#6f6a60` | méta, labels, hints | jamais pour un texte < 11 px sur le sol |
| `--accent` | `#33566e` | **une seule** intention par vue : la position | jamais en fond de bouton large |
| `--line` | `#ddd5c7` | tous les filets, bordures 1 px | jamais > 1 px |

Règles d'usage :

- **L'accent est un signal de position, pas une décoration.** Il ne colore que : le filet de
  progression, le nom de la salle courante, le point actif, l'action primaire de la fiche.
  Aujourd'hui l'accent est à la fois sur le bouton « Voir en grand », la pastille active, le
  point du plan, la bannière de salle et le curseur : il ne signale donc plus rien.
- **Pas de dégradé de couleur**, sauf deux voiles de lisibilité déjà présents (bas de la scène,
  haut de la scène) qui doivent rester ≤ 0.8 d'opacité et sans bord visible.
- **Blanc réservé au passe-partout** des œuvres : c'est le seul `#fff` du site.

---

## 3. Typographie — cinq marches

Deux familles, **aucune autre**, et cinq tailles, **aucune autre**. L'état actuel utilise 22 tailles
distinctes (9 → 58 px) : c'est la première cause de la sensation de « bricolage ».

| Marche | Token | Taille | Famille / graisse | Usage (liste fermée) |
|---|---|---|---|---|
| 1 | `--t1` | **10 px** / 0.22em, capitales | Inter 500 | labels : salle, compte d'œuvre, méta de grille, lien Index |
| 2 | `--t2` | **12.5 px** / 1.45 | Inter 400 | valeurs de méta, sous-titre de marque, hints |
| 3 | `--t3` | **15 px** / 1.62 | Inter 400 | description de la fiche, corps de l'index |
| 4 | `--t4` | **24 px** / 1.1 | Fraunces 500 *italique* (légende) ou 600 (titre de fiche) | titre d'œuvre dans la légende, titre de la fiche, titre de salle dans l'index |
| 5 | `--t5` | `clamp(38px, 6.4vw, 88px)` / 1.05 | Fraunces 500, capitales + 0.14em | wordmark de l'intro, titre de l'écran de fin |

Détails qui font la différence :

- **Le serif porte les noms propres, l'inter porte les faits.** Un titre d'œuvre ne passe jamais
  en sans ; une année ne passe jamais en serif.
- **L'italique Fraunces est réservé à la légende et au nom de salle.** Jamais dans la fiche
  (où le titre est en romain 600) — la fiche est un document, pas une légende.
- **Interlettrage :** capitales `+0.22em` (jamais en dessous de `+0.18em`), serif display `-0.005em`,
  corps `0`. Aucune autre valeur.
- **Chiffres tabulaires obligatoires** pour tout compteur (`font-variant-numeric: tabular-nums`).
- `font-weight` maximum : 600. Aucun 700, aucun faux gras.

---

## 4. Espacement

Pas de base **4 px**. L'échelle est fermée :

```
--s1 4    --s2 8    --s3 12   --s4 16   --s5 24
--s6 32   --s7 48   --s8 64   --s9 96
```

- **Marge de scène :** `--s6` (32 px) sur desktop, `--s4` (16 px) sur mobile, sur les quatre bords.
  Aujourd'hui : 22/18/20/26 px selon les éléments — aucune règle.
- **Rythme vertical d'un texte** : gap de `--s1` entre un label et sa valeur, `--s3` entre deux
  blocs de la fiche, `--s5` entre les sections de la fiche.
- **Une seule respiration forte par écran** : l'écart entre la légende et les commandes est au
  moins égal à `--s7`. C'est cet écart qui donne l'air « musée ».
- Interdits : `padding` en dessous de 8 px sur une cible cliquable (cible minimale 44 × 44 px sur
  mobile, 36 × 36 px sur desktop), marges négatives hors recouvrement optique des capitales.

---

## 5. Rayons, filets, profondeur

| Token | Valeur | Usage |
|---|---|---|
| `--r` | `0` | toute surface : image, fiche, carte, bouton, champ |
| `--r-round` | `999px` | uniquement un élément dont la hauteur = la largeur (flèche, point) |

- **Bordures :** `1px solid var(--line)` partout. Aucune bordure `2px` sauf l'anneau de focus.
- **Ombres :** deux autorisées, pas une de plus.
  1. `0 -18px 40px rgba(32,36,42,0.06)` — projection de la fiche sur la scène.
  2. `0 20px 60px rgba(0,0,0,0.45)` — l'image en grand (lightbox).
     Toute autre ombre (11 aujourd'hui, sur les pilules, le plan, les cartes d'index, le curseur)
     est supprimée : une carte blanche qui flotte sur une scène 3D est une couture visible.
- **La profondeur vient de la scène, pas du CSS.** Si un élément d'interface semble devoir
  « flotter », c'est qu'il doit plutôt se poser sur un filet.

---

## 6. Mouvement

| Token | Valeur | Usage |
|---|---|---|
| `--d-fast` | `160ms` | survol, changement de couleur/z-index |
| `--d-ui` | `240ms` | apparition/disparition d'un amas, révélation de légende |
| `--d-panel` | `480ms` | ouverture de la fiche, de l'index, de l'écran de fin |
| `--d-cam` | `700ms` | déplacement caméra entre deux œuvres (déjà dans les tween) |
| `--e-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | toutes les entrées |
| `--e-inout` | `cubic-bezier(0.65, 0, 0.35, 1)` | les sorties |

- On n'anime **qu'`opacity` et `transform`**. Jamais `width`, `left`, `top`, `height` (sauf le
  filet de progression 1 px, où c'est sans coût de layout perceptible).
- Une entrée = un décalage de `8px` maximum + un fondu. Pas de `scale` sur du texte.
- Les trois amas entrent en **cascade de 60 ms** (identité → légende → navigation), une seule fois.
- Le survol ne déplace rien : il change une couleur de filet ou un contraste.
- `prefers-reduced-motion: reduce` : toutes les durées à `1ms` sauf les fondus de 1 ms → 0, et
  **aucun** tween caméra : on téléporte.
- Interdit : animation en boucle sur un élément de chrome (le « drip » du hint de défilement
  actuel attire l'œil en permanence sur du vide).

---

## 7. Doctrine du chrome

Hiérarchie d'attention autorisée, du plus fort au plus faible :

```
1. l'œuvre (scène 3D)                    — non négociable
2. le titre de l'œuvre courante          — --t4 serif
3. la position (salle + k/n)             — --t1 capitales + filet 1 px
4. les commandes                         — cercle 36 px, filet 1 px
```

- **Trois amas maximum**, ancrés : `haut-gauche` (identité), `bas-gauche` (légende),
  `bas-droite` (navigation). Un quatrième amas (plan, compteur, pastilles, bannière) est un défaut.
- **Un seul indicateur de position.** Pas de « 02 / 05 » *et* de points *et* de plan *et* de
  compteur géant. Le filet de progression en haut de l'écran + le compte de la légende suffisent.
- **Tout ce qui est disponible en permanence doit être indispensable.** Le reste apparaît à la
  demande (survol, mouvement, touche `I`).
- **Aucun élément de chrome ne se superpose à une œuvre.** Si le chrome doit passer sur la scène,
  il se pose sur le sol, jamais sur un cadre.
- **Le mode libre est un mode, pas un bouton permanent.** Il s'annonce une fois, par un hint de
  12.5 px qui disparaît au premier mouvement.

### Cibles (mesures)

| Élément | Desktop | Mobile |
|---|---|---|
| Amas — marge au bord | 32 px | 16 px |
| Flèche préc./suiv. | 36 × 36 px | 44 × 44 px |
| Filet de progression | 1 px, haut, largeur = progression | idem |
| Titre de légende | 24 px | 20 px |
| Méta | 12.5 px | 10.5 px |
| Fiche — largeur | 420 px | 100 % (feuille) |
| Fiche — image | bord à bord, rayon 0 | bord à bord |
| Fiche — actions | 1 rangée : 1 plein + 1 filet | 1 rangée |
| Index — carte | image rayon 0, titre `--t4`, méta `--t1` | idem |

---

## 8. Écrans

- **Intro** : wordmark `--t5` capitales espacées, une ligne `--t2` sous le nom, filet de chargement
  1 px de 240 px de large, bouton d'entrée en filet 1 px (pas d'aplat), hint `--t1`.
  Les trois aperçus restent, en 56 px de haut, sans rayon, sans bordure.
- **Scène** : chrome minimal (voir §7). Les œuvres portent la lumière (voir `audit-3d.md`).
- **Fiche** : barre de titre 52 px (`← Galerie` / `×`), image bord à bord, kicker + navigation,
  titre `--t4` 600, grille de méta 2 × 2 avec filets, description `--t3`, actions sur une rangée.
- **Index** : fond `--bg`, titre de salle `--t4` italique accent, grille de cartes sans rayon ni
  ombre, image **non rognée** (`object-fit: contain` sur fond `--paper`), titre + méta.
- **En grand** : fond `#181a1e`, image sans rayon, légende `--t2`, flèches en cercle filet.
- **Fin** : miniature 168 px sans rayon, kicker `--t1`, titre `--t5`, deux commandes.

---

## 9. Accessibilité (plancher)

- Contraste : ≥ 4.5:1 pour tout texte. `--muted` sur `--bg` = 4.7:1 → OK ; `--muted` **sur le sol
  de la scène** n'est pas garanti → la légende porte un `text-shadow` de papier (1 px,
  `rgba(250,247,242,.55)`) et le filet de progression est toujours doublé d'un compte lisible.
- Focus : `outline: 2px solid var(--accent); outline-offset: 2px` — jamais `outline: none`.
- Cibles : 44 px mobile / 36 px desktop minimum.
- Tout dialogs garde `aria-modal`, `role="dialog"` et le focus initial.
- `prefers-reduced-motion` respecté (voir §6).
- Aucun texte en `--line` (décoratif uniquement).

---

## 10. Application au code existant

Tokens à créer dans `src/style.css` (remplacent les valeurs en dur) :

```css
:root {
  /* couleur */
  --bg: #faf7f2; --paper: #fffdf9; --ink: #20242a;
  --muted: #6f6a60; --accent: #33566e; --line: #ddd5c7;
  /* typo */
  --serif: 'Fraunces', Georgia, serif; --sans: 'Inter', system-ui, sans-serif;
  --t1: 10px; --t2: 12.5px; --t3: 15px; --t4: 24px;
  --t5: clamp(38px, 6.4vw, 88px);
  /* espace */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px;
  --s5: 24px; --s6: 32px; --s7: 48px; --s8: 64px; --s9: 96px;
  /* forme */
  --r: 0px; --r-round: 999px;
  /* mouvement */
  --d-fast: 160ms; --d-ui: 240ms; --d-panel: 480ms; --d-cam: 700ms;
  --e-out: cubic-bezier(0.22, 1, 0.36, 1);
  --e-inout: cubic-bezier(0.65, 0, 0.35, 1);
}
```

Ce que cela implique, fichier par fichier, est tabulé dans `docs/design/audit-ui.md` §5, et le
rendu 3D cible dans `docs/design/audit-3d.md`.
