# Audit UI — `HEAD` (branche `main`, commit `9508c91`)

Périmètre : le chrome HTML/CSS du site (index.html + src/style.css + src/ui.ts). Le rendu 3D est
audité à part dans [`audit-3d.md`](audit-3d.md). **Aucun fichier de code n'a été modifié** : ce
document et les maquettes de `proposals/` sont les seuls livrables.

Méthode : captures headless reproductibles (`.vibe/shotkit/`, 1440×900 et 390×844, scène entrée,
`t = 0.45`), mesure DOM des amas visibles, comptage des valeurs en dur dans `src/style.css`.

---

## 1. Ce qui marche déjà — à ne pas casser

1. **La palette.** `#faf7f2` / `#33566e` / `#ddd5c7` est tirée des tableaux, elle tient. Rien à
   changer dans les valeurs.
2. **Le couple Fraunces + Inter.** Fraunces à 500/600 pour les noms, Inter pour les faits : c'est
   juste. Le problème n'est pas la famille, c'est le nombre de tailles.
3. **La scène.** Le hall, la verrière à meneaux, les moulures, les cartels sont un vrai parti pris,
   pas un décor générique.
4. **Le filet de progression 1 px en haut** (`#progress-bar`, `style.css:748`) : c'est déjà
   l'indicateur de position le plus élégant du site. Il est simplement concurrencé par quatre autres.
5. **Le grain** (`.grain`, `style.css:878`, turbulence SVG à 5 %) : il enlève le côté CAD de la
   scène pour un coût nul. À conserver.
6. **La fiche et l'index existent et fonctionnent** (images responsives AVIF/WebP + LQIP, `src/ui.ts`
   `setResponsiveImg`). On recompose, on ne réécrit pas.

---

## 2. Diagnostics

### D1 — Huit amas, dont quatre disent la même chose

Mesure DOM sur `HEAD`, scène entrée, `t = 0.45` :

| Écran | Amas visibles | Surface de chrome |
|---|---|---|
| 1440×900 | **8** (`brand`, `room-banner`, `minimap`, `dots`, `hud-bottom`, `big-counter`, `progress-bar`, `panel`) | ≈ 8 % de l'écran |
| 390×844 | **6** (`brand`, `big-counter`, `minimap`, `hud-bottom`, `progress-bar`, `panel`) | ≈ 12 % de l'écran |

Et quatre de ces amas affichent la **même information** (position dans la visite) :

| Amas | Emplacement | Ce qu'il dit | Verdict |
|---|---|---|---|
| `#minimap` (`index.html:36`) | carte flottante 84 × 320, rayon 16, ombre | plan + 5 stops numérotés + nom de salle | **supprimer** (redondant) |
| `#dots` (`index.html:41`) | pilule centrée 174 × 40, rayon 999 | 5 points numérotés | **supprimer** (doublon exact des stops) |
| `#hud-bottom` (`index.html:43`) | pilule centrée 549 × 58, rayon 999 | ‹ › + « 3 / 5 — salle » + Index + Explorer | **démonter** : ne garder que les commandes |
| `#big-counter` (`index.html:115`) | 58 px en bas à gauche | « 03 — 05 » | **supprimer** |
| `#progress-bar` (`index.html:118`) | filet 2 px en haut | progression | **garder**, seul indicateur |
| `#room-banner` (`index.html:38`) | pilule centrée, italique 23 px | nom de salle, 2,4 s | **fusionner** dans la légende |

Sur 390 px de large, `#minimap` (y = 717, h = 53) et `#hud-bottom` (y = 780, h = 52) se suivent :
**105 px de cartes empilées en bas**, plus 75 px d'amas en haut. L'écran est encadré.

### D2 — Pas de système : 22 tailles, 9 rayons, 11 ombres

Comptage sur `src/style.css` :

| Dimension | Valeurs distinctes | Détail |
|---|---|---|
| `font-size` | **22** | 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 14.5, 15, 16, 18, 20, 23, 24, 26, 27, 30, 33, 58 (+ `clamp`) |
| `border-radius` | **9** | 999px (×7), 50 % (×5), 2px (×3), 8px (×2), 6px (×2), 12, 14, 16, 18 |
| `box-shadow` | **11** occurrences | 4 familles d'ombre douce + 1 dure, toutes différentes |
| `transition` | **20** | durées 0.15/0.18/0.2/0.4/0.45/0.5/0.55/0.6/0.65/0.8 s |
| Marges au bord | 5 valeurs | 12, 14, 18, 20, 22, 26 px selon l'amas |

Conséquence visible : chaque élément a l'air dessiné par une main différente. Le lecteur ne sait
pas ce qui est *important*, seulement ce qui est *rond*.

### D3 — La hiérarchie est inversée

À l'écran, par ordre de contraste réel : le **cadre métallique noir** des picture lights (3D), puis
la pilule HUD blanche à ombre, puis le compteur de 58 px, puis la bannière de salle de 23 px, puis
les tableaux. Les deux éléments les plus contrastés de la page ne sont pas des œuvres.
C'est le défaut principal, et il est **double** : CSS (pilules) et 3D (luminaires noirs — voir
`audit-3d.md` §P0-2).

### D4 — La fiche d'œuvre gaspille sa surface

`#panel` (`style.css:378-473`), 380 px de large :

| Défaut | Code | Effet |
|---|---|---|
| Image arrondie 8 px + bordure + ombre + `background: #fff` | `style.css:414-425` | une œuvre encadrée par l'interface, alors qu'elle l'est déjà par son cadre 3D |
| Méta en une seule ligne « année — technique — dimensions » | `src/ui.ts` `openPanel` | 12.5 px illisible sur 380 px ; l'information la plus factuelle est la moins structurée |
| Trois boutons pleine largeur empilés (44 px × 3 + gaps) | `style.css:449-457` | ≈ 148 px de hauteur pour 2 actions et 1 navigation |
| Titre 33 px qui n'est dans aucune échelle | `style.css:427` | 33 px n'existe nulle part ailleurs |
| `panel-kicker` en capitales 10 px + `·` inséré par `::before` | `style.css:973-984` | le séparateur est un détail de contenu placé dans le CSS |

### D5 — Le mobile est le parent pauvre

À 390 px : 4 amas, 12 % de l'écran, deux cartes empilées en bas, un compteur en haut à droite, un
wordmark de 20 px + sous-titre de 9 px. Le pouce doit atteindre une pilule de 38 px de haut
(`.hud-btn.wide`) contenant cinq cibles dont deux libellés de 10.5 px. Aucune des trois directions
proposées ne descend en dessous de 44 px de cible.

### D6 — Deux affordances pour un seul geste

`#cursor` (`style.css:887`) affiche « VOIR » dans un cercle de 52 px au survol d'un tableau, alors
que la scène fait déjà grossir le tableau de 2 % et monte son `emissiveIntensity` de 0.1 à 0.3
(`src/gallery/paintings.ts`, `applyHover`). Le curseur custom masque en plus l'œuvre qu'il désigne.
→ **Supprimer.** Le survol 3D suffit, et il est meilleur.

### D7 — Le hint qui ne s'arrête jamais

`#scroll-hint` (`style.css:791-838`) est une animation `drip` infinie de 1.8 s. Une boucle
d'animation sur du chrome attire l'œil en permanence sur **rien**. Idem `#free-hint`
(`style.css:840`) qui reste affiché tant que le mode libre est actif.
→ Hint d'entrée unique de 12.5 px, qui disparaît au premier mouvement, sans boucle.

### D8 — Score heuristique (avant / cible)

| Critère | HEAD | Cible | Pourquoi |
|---|---|---|---|
| Hiérarchie visuelle | 2/4 | 4/4 | l'œuvre redevient l'élément le plus contrasté |
| Cohérence du système | 1/4 | 4/4 | 5 tailles, 1 rayon, 2 ombres |
| Densité de chrome | 1/4 | 4/4 | 8 amas → 3 |
| Lisibilité de la fiche | 2/4 | 4/4 | grille de méta + actions sur une ligne |
| Équilibre mobile | 2/4 | 3/4 | 44 px, un seul bloc en bas |
| Qualité du mouvement | 2/4 | 4/4 | 4 durées, 2 courbes, pas de boucle |
| **Total** | **10/24** | **23/24** | |

---

## 3. Chrome à supprimer — la liste

| # | Élément | Où | Décision | Remplacé par |
|---|---|---|---|---|
| 1 | `#minimap` — carte flottante, rayon 16, ombre, 5 stops | `index.html:36`, `style.css:105-217`, `src/gallery/minimap.ts` | **supprimer** | en direction B : un filet-rail de 1 px en bas ; en A et C : rien (le filet de progression suffit) |
| 2 | `#dots` — pilule de 5 points | `index.html:41`, `style.css:267-309` | **supprimer** | — |
| 3 | `#big-counter` — « 03 — 05 » en 58 px | `index.html:115`, `style.css:761-789`, `src/main.ts` (tick) | **supprimer** | le compte de la légende (`02 / 05`, 10 px) |
| 4 | `#room-banner` — pilule italique 23 px | `index.html:38`, `style.css:218-240` | **supprimer la pilule**, garder le texte | le nom de salle de la légende |
| 5 | `#hud-bottom` — la pilule conteneur | `index.html:43`, `style.css:311-341` | **supprimer la pilule** | trois commandes nues, ancrées bas-droite |
| 6 | `.hud-btn.wide` « Explorer librement » | `index.html:51` | **déplacer** | une entrée dans l'index, ou une touche (`F`) + un hint d'une fois |
| 7 | `#cursor` — curseur « Voir » | `index.html:120`, `style.css:887-941`, `src/main.ts` | **supprimer** | le survol 3D existant |
| 8 | `#scroll-hint` — animation en boucle | `index.html:116`, `style.css:791-838` | **supprimer la boucle** | un hint de 12.5 px, une fois |
| 9 | `#free-hint` — pilule permanente | `index.html:117`, `style.css:840-869` | **supprimer** | hint d'une fois |
| 10 | `#toast` — pilule noire | `index.html:39`, `style.css:242-265` | **garder** (message d'erreur), passer en filet + texte | — |
| 11 | `#app::before` vignette radiale 9 % | `style.css:50-57` | **garder**, réduire à 5 % | — |
| 12 | `#app::after` dégradé haut de 110 px | `style.css:59-67` | **garder**, réduire à 64 px | — |
| 13 | `#panel-img` — rayon 8 + bordure + ombre | `style.css:414-425` | **supprimer les trois** | image bord à bord, rayon 0 |
| 14 | `#panel` `border-left` + ombre | `style.css:378-390` | **garder l'ombre**, réduire à 6 % | filet 1 px conservé |
| 15 | `.panel-actions` en colonne, 3 × 44 px | `style.css:449-457` | **passer en une rangée** | 1 action pleine + 1 filet |
| 16 | `.index-card` rayon 12 + ombre + `object-fit: cover` | `style.css:500-520` | **rayon 0, sans ombre, `contain`** | l'image n'est plus rognée |
| 17 | `#panel-kicker` `::before` « · » | `style.css:973-984` | **supprimer le pseudo-élément** | séparateur en HTML |
| 18 | `:root` — 6 tokens seulement | `style.css:1-11` | **étendre** aux tokens de `DESIGN.md` §10 | — |

Total : **11 suppressions, 4 réductions, 3 recompositions.**

---

## 4. Ce que l'on ne touche pas

- La scène 3D elle-même (hors luminaires/cadres, voir `audit-3d.md`).
- `src/ui.ts` : la logique d'images responsives (AVIF/WebP/LQIP) et les `srcset` sont bons.
- La structure ARIA (`role="status"`, `aria-modal`, `aria-label`) : elle est correcte.
- `prefers-reduced-motion` : présent et correct (`style.css:1160-1165`).
- Le grain, le filet de progression, la palette, les deux familles de police.

---

## 5. Application — fichier par fichier

| Fichier | Changement | Ampleur |
|---|---|---|
| `index.html` | retirer `#minimap`, `#dots`, `#big-counter`, `#cursor`, `#scroll-hint`, `#free-hint` ; démonter `#hud-bottom` en 3 commandes ; recomposer `#panel` (barre + image + grille + actions) ; retirer `#room-banner` ou le vider | ~60 lignes |
| `src/style.css` | remplacer les 6 tokens par les 26 de `DESIGN.md` §10 ; supprimer les 9 blocs des éléments retirés (~330 lignes) ; réécrire `#panel`, `.index-card`, `.hud-btn` avec les tokens | −330 / +180 lignes |
| `src/ui.ts` | `openPanel` : méta → 4 champs ; retirer `flashRoom` (ou le réaffecter à la légende) ; `buildDots`/`setActiveDot` supprimés | ~40 lignes |
| `src/gallery/minimap.ts` | si direction B : réduire à un rail de 1 px (garder `update`, jeter le markup carte). Si A ou C : suppression du fichier et de son import | 159 → ~50 lignes, ou 0 |
| `src/main.ts` | retirer les appels `setActiveDot`, `bc.*`, `#cursor`, `#scroll-hint`, `#free-hint` ; garder `setProgressBar`, `setProgress`, `flashRoom` | ~35 lignes |

Le détail 3D (post-processing, cadres, luminaires) est dans `audit-3d.md`, section « Diff prévisible ».

---

## 6. Risques

1. **Retirer la minimap retire aussi la navigation directe** sur desktop. Réponse : la direction B
   la conserve sous forme de rail cliquable (5 cibles de 24 × 24 px, chevauchement horizontal à
   mesurer sur 390 px) ; les directions A et C la déplacent dans l'index, qui est déjà atteignable
   en un clic.
2. **Le filet de progression seul est peu informatif** au-delà de ~10 œuvres. Réponse : la légende
   porte le compte exact (`02 / 05`), et le rail de B absorbe la montée en charge (test `?dup=5`
   déjà en place).
3. **La suppression du curseur custom** enlève un signal de survol sur desktop. Réponse : la scène
   grossit déjà le tableau et augmente son émission ; si c'est trop discret, on ajuste `1.02 → 1.03`
   plutôt que de réintroduire un curseur.
4. **La direction C cache des commandes** : à vérifier au clavier (`Tab` doit révéler la légende).
   Contrainte à respecter dans l'implémentation, pas un obstacle de design.
