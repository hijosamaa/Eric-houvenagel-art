# Guide de style — Eric Houvenagel

Établi à partir des tableaux de référence (`references/`, posts Instagram @erichouvenagel) : marines et ports de Bretagne, une figure, une abstraction ; aquarelles/encre sur papier 300 g (parfois marouflé sur bois, wax), huile sur lin, acrylique sur bois. Palette dominante : **bleus marine, blancs, vert olive, bruns**, avec une touche d'orange.

## Palette

| Rôle | Hex | Usage |
|---|---|---|
| Fond page | `#FAF7F2` | blanc cassé chaud (jamais `#FFFFFF` pur) |
| Murs 3D (plâtre) | `#F2EDE4` | scène Three.js |
| Sol 3D (chêne clair) | `#C9A87C` | scène Three.js |
| Accent | `#33566E` | bleu marine tiré des œuvres : boutons, point actif minimap, monogramme |
| Texte | `#20242A` | titres et corps |
| Texte secondaire | `#6F6A60` | métadonnées, hints |
| Lignes / bordures | `#DDD5C7` | HUD, panneaux |
| Cadres 3D (chêne) | `#A08055` | meshes des cadres |
| Passe-partout | `#FFFFFF` | toujours présent, surtout pour les aquarelles |

## Typographie

- **Titres** (nom de l'artiste, titres d'œuvres, bannière de salle) : *Fraunces* variable (opsz auto) 500/600 + italique 500, fallback Georgia/serif. Choisi en A/B contre Cormorant Garamond et Instrument Serif (voir `docs/revue-5.md`) : vrais poids 500/600 (Instrument Serif n'a que 400 → faux gras) et plus de caractère que Cormorant.
- **UI** (boutons, métadonnées, progression) : *Inter* 400/500/600, fallback system-ui.
- Lettrage espacé en petites capitales pour les sous-titres (« Galerie virtuelle », hints).

## Scène 3D

- Hall de galerie blanche : 12 m de large, hauteur 3,4 m, murs plâtre `#F2EDE4`, sol chêne clair, plafond blanc.
- Salles = zones du hall séparées par des portails en bois sombre (`#8F7350`) ; nom de salle en bannière serif italique à l'entrée.
- Hauteur d'accrochage : 1,55 m. Tableaux jamais déformés (ratio de l'image conservé), hauteur cible 1,45 m, largeur plafonnée à 2,3 m.
- Cadre chêne fin + passe-partout blanc + barre lumineuse discrète au-dessus.
- Éclairage doux (hémisphère + directionnelle chaude), `fog` blanc cassé, pas d'ombres portée (perf mobile).

## UI / HUD

- **Haut gauche** : nom de l'artiste (serif) + « Galerie virtuelle ».
- **Haut droite** : minimap 2D (plan du hall, points des œuvres, position caméra), cliquable.
- **Haut centre** : bannière de salle (apparaît à l'entrée d'une zone).
- **Bas centre** : pilule avec ‹ ›, « œuvre k / n — salle », et bouton « Explorer librement » (desktop uniquement).
- **Panneau latéral droit** : fiche œuvre (titre serif, meta, description, « Voir en grand »).
- **Lightbox** : plein écran sombre, image 2D haute définition.
- **Intro** : plein écran blanc cassé, nom en serif, barre de chargement, bouton « Entrer dans la galerie », hint de navigation.

## Règles

- Le site s'efface devant les œuvres : fond neutre, une seule couleur d'accent, pas d'animation superflue.
- Le détail d'un tableau se regarde en 2D (lightbox), la 3D sert l'ambiance et le parcours.
- Mobile d'abord pour la navigation (scroll natif), desktop pour le mode libre.
- Accessibilité : `prefers-reduced-motion`, fallback no-WebGL, cibles tactiles ≥ 36 px, contraste suffisant.
