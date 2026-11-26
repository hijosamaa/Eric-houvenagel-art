# Veille & inspiration — étape R du plan (livrée avec captures)

Recherche faite le commit de `docs/revue-8.md` : recherches web (Awwwards SOTD 2025–2026,
collections WebGL / transitions / portfolios, sites de peintres et de galeries) puis
**captures d'écran réelles** des sites retenus, prises en headless (1440×900, hero +
2 positions de scroll) et stockées dans [`inspiration/screenshots/`](inspiration/screenshots/).

## Sources capturées (33 screenshots)

| Dossier de captures | Site | Pourquoi |
|---|---|---|
| `awwwards-webgl-collection-*` | awwwards.com — collection WebGL | Référence des sites 3D primés (grille vignettes + tags) |
| `awwwards-sotd-*` | awwwards.com — Sites of the Day | Tendances actuelles SOTD |
| `cartier-waw-2025-*` | Cartier Watches & Wonders 2025 (Immersive Garden, SOTM août 2025) | **Le plus proche de notre cas** : 6 alcôves 3D scrollées « comme des salles de musée » |
| `lusion-*` | Lusion (studio 3D) | Rendu 3D haut de gamme, chrome minimal |
| `bruno-simon-*` | bruno-simon.com | Portfolio WebGL jouable, curseur custom |
| `dennis-snellenberg-*` | dennis-snellenberg.com (SOTD) | Pattern « next project » en fin de page projet |
| `makemepulse-*` | makemepulse.com | WebXR / galeries virtuelles (Magical Reflections, Alte Nationalgalerie) |
| `whitecube-*` | whitecube.com | Galerie d'art : hero plein écran, logo centré, méta expo (titre — dates — lieu) |
| `david-hockney-*` | david-hockney.com | Site de peintre établi |
| `tate-*`, `pentagram-*` | tate.org.uk, pentagram.com | Musées / studios : hiérarchie éditoriale sobre |

(gerhardrichter.com bloque le rendu headless — écarté des captures.)

## Ce que montrent les captures (constats)

- **Cartier W&W 2025** (`cartier-waw-2025-hero.jpg`) : fond beige calme, **titre centré
  en capitales espacées**, logo centré en haut, seul hint « DÉFILER » en bas au centre.
  Zéro HUD visible → le luxe vient du *retrait* de l'interface, pas de son ajout.
- **White Cube** (`whitecube-hero.jpg`) : image plein écran, logo « WHITE CUBE » centré
  en haut en sans capitales, menu horizontal discret, puis ligne méta « Artiste — dates —
  lieu ». Pattern directement réutilisable pour nos cartes d'index.
- **Lusion** (`lusion-scroll.jpg`) : scène 3D sombre et lustrée, logo sans minimal en
  haut à gauche, aucun autre chrome. La 3D porte tout.
- **Awwwards WebGL/SOTD** : les gagnants 2025–2026 partagent : une **idée forte unique**
  (pas un empilement d'effets), scroll comme moteur de narration, compteur/progression
  discret, transitions de page soignées (collection « transitions »).

## Sélection critique — éléments proposés à reprendre (à valider)

| # | Élément | Vu sur | Proposition pour notre galerie |
|---|---|---|---|
| 1 | **Intro plein écran, wordmark centré capitales espacées + « Défiler » bas-centre** | Cartier | Remplacer la strip d'images de l'intro par un wordmark centré + hint bas-centre ; garder les 3 aperçus en miniatures discrètes en bas |
| 2 | **HUD qui se fait oublier** : compteur « 3 / 5 » fixe, flèches fines, barre de progression **fine en haut de l'écran** | Cartier, SOTD | Barre 2 px en haut (on a déjà `#progress-bar`) + compteur ; la pill HUD actuelle reste en fallback mobile |
| 3 | **Compteur géant en serif lors du focus œuvre** (« 03 — 05 ») | portfolios SOTD | Grand numéro discret en coin inférieur gauche quand on s'arrête sur une œuvre |
| 4 | **Bloc « Œuvre suivante » en fin de panneau / écran de fin** : grande typo serif + miniature + flèche → | Dennis Snellenberg « next project » | Écran de fin enrichi : miniature de la dernière œuvre + « Revoir l'index » / « Recommencer » en grand serif ; panneau : lien « Suivante → » déjà présent, le renforcer visuellement |
| 5 | **Curseur custom avec label « Voir »** sur les tableaux | bruno-simon, Lusion | Notre `#cursor` existe ; ajouter le texte « Voir » dans le cercle au survol d'un tableau |
| 6 | **Méta d'œuvre en ligne unique** « Titre — Année — Technique — Dimensions » | White Cube | Uniformiser kicker/méta du panneau et des cartes index sur ce pattern |
| 7 | **Transition d'ouverture du panneau : fondu + léger zoom de l'image** (clip-path ou scale 1.04→1) | collections « transitions » | Affiner l'easing actuel du panneau |
| 8 | **Mode libre desktop** : hint clavier discret coin bas-droite + vignette légère | portfolios 3D | Ajouter un hint « WASD + glisser » sobre en mode libre |

## Questions pour toi (tu choisis quoi implémenter)

1. Intro : wordmark centré façon Cartier (proposition #1) ou garder la strip d'aperçus ?
2. HUD desktop : barre de progression fine en **haut** + compteur fixe (proposition #2) — oui/non ? Et la pill du bas, on la garde ou on la fond dans le bas ?
3. Compteur géant « 03 — 05 » au focus (#3) : oui, et à quel endroit (coin bas-gauche ?) ?
4. Curseur « Voir » (#5) : oui/non ?
5. Écran de fin enrichi avec miniature + grand serif (#4) : oui/non ?
6. Autre : quelque chose dans les 33 screenshots qui te plaît et que je n'ai pas listé ?

Réponds par numéros (ex: « 1 oui, 2 oui barre en haut, 5 oui… ») et j'implémente.
