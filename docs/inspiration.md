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

---

## Round 2 — 2026-11-26 (veille Awwwards & galeries virtuelles 2026, captures réelles)

Recherche web + **captures headless 1440×900 (hero + 2 scrolls)** dans
[`inspiration/screenshots/round2/`](inspiration/screenshots/round2/) — rapport dans
`round2/report.json` (+ `report-v2.json`, liens externes scrapés dans
`sotd-external-links.json` / `-v2.json`).

| Captures | Source | Ce que ça montre |
|---|---|---|
| `awwwards-sotd-wall-*`, `awwwards-collection-{threejs,webgl,virtual-gallery}-*`, `awwwards-category-gallery-*`, `awwwards-scrolling-*` | awwwards.com (mur SOTD, collections Three.js/WebGL, catégorie gallery, scrolling) | Tendances 2026 : 61 % des SOTD Q1 2026 sont des expériences 3D immersives ; le scroll reste le moteur de narration ; compteurs/progression discrets |
| `sotd-live-5…10-*` | Vrais sites SOTD du jour scrapés depuis le mur (huxleysaga.com, polpharmabiologics.com, two26.studio, laboiteaslides.fr, go.streamlinehq.com/pixel-yellow, artemiilebedev.com) | Patterns concrets : wordmark géant centré sur fond uni (two26), split-screen éditorial image/texte avec micro-labels capitales (Huxley « CHARACTERS / MAX »), nav top minimaliste |
| `awwwards-site-{state-of-the-gallery,minh-pham,g-colombel-2026,vredestein-experience,hearst-exhibit-2026,elektra-virtual-museum,my-art-gallery}-*` | Pages profils Awwwards (SOTD 2026) | Galeries/musées 3D primés : Vredestein Experience Centre (musée 3D en ligne), Elektra Virtual Museum, My Art Gallery (portfolio Three.js+GSAP), portfolios 2026 Minh Pham / G. Colombel |
| `dam-digital-art-museum-*`, `teamlab-art-*`, `louvre-online-tours-*`, `framesixty-virtual-museum-*` | DAM Berlin, teamLab, Louvre « Louvre at home », Framesixty | Musées en ligne : hero plein écran + entrée « Launch virtual tour », gros titres serif/sans contrastés |
| `hontran-best-2026-*`, `utsubo-best-threejs-2026-*` | Blogs jurés Awwwards 2026 | « La 3D sert l'atmosphère et le cadrage, pas le spectacle » ; digital twin du pavillon Cartier W&W 2026 (Immersive Garden) : 6 alcôves 3D scrollées comme des salles de musée — **le plus proche de notre cas** |

### Constats round 2 (à croiser avec round 1)

- **Une seule idée forte** par écran, le reste s'efface (wordmark géant centré sur fond uni, zéro chrome — two26 ; logo centré + un seul hint — Cartier).
- **Split éditorial image/texte** avec micro-labels en capitales espacées et filets fins (Huxley) — directement applicable à notre fiche œuvre et à l'index.
- **Compteur / progression discrets** intégrés à la navigation, jamais en overlay criard.
- **Le scroll = les salles** : alcôves 3D qui se succèdent (Cartier W&W 2026) — notre mur unique + caméra en ligne droite est exactement ce pattern, à pousser plus loin côté **matériaux et lumière** (voir étape S du plan).
- Les musées en ligne (Louvre, DAM) ouvrent sur un **hero plein écran + CTA unique « lancer la visite »** — pattern de notre intro, à garder.
