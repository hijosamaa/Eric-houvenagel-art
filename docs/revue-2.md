# Revue critique n°2 — personas experts (itération 3)

> Note de méthode : cette session ne fournit aucun outil de sous-agents réels (catalogue vérifié : seuls des
> outils Mistral Studio et GitHub sont disponibles). La « revue par experts » est donc menée sous forme de
> **4 passes à persona**, chacune confrontée aux captures d'écran headless réelles (puppeteer + SwiftShader,
> 1440×900 et 390×844) et à l'OCR des écrans. Les personas : visiteur novice sur mobile, directeur artistique,
> ingénieur performance, expert accessibilité.

## Pass 1 — Visiteur novice / mobile (le « tournis »)

- **Constat (v2)** : tableaux en alternance mur gauche/droite + caméra qui ondule → le regard fouette
  gauche-droite à chaque œuvre = nausée, on perd le fil. La minimap canvas était illisible (petits points gris).
- **Décision** : réorganisation complète — **tous les tableaux sur un seul mur (droite)**, espacés régulièrement,
  salles = segments du même mur séparés par des portails. La caméra avance en **ligne droite** (`PATH_X` fixe),
  le `lookAt` est amorti (lerp) vers l'œuvre **la plus proche** : plus aucun mouvement latéral.
- **Minimap refaite en DOM** : carte verticale « Plan » avec arrêts numérotés 1..N cliquables, ligne de
  progression accent, nom de la salle courante. Net, accessible (boutons réels, `aria-label`, tooltips), stylée.

## Pass 2 — Directeur artistique

- **Constat (v2)** : murs nus à gauche, sol seul, rendu un peu vide/plat malgré l'IBL.
- **Décisions** : **tapis de couloir** (anthracite) sous le parcours, **banc** contre le mur gauche, ** cimaise
  (picture rail) + panneaux moulurés** sur le mur gauche, **cadre du puits de lumière**, portails avec plaques
  nominatives, cartels de musée à chaque œuvre, sol verni (clearcoat) avec reflets, IBL + ombres PCFSoft + ACES.
- Règle maintenue : lumière d'abord, tout mouvement amorti, la 3D sert l'ambiance, le détail se lit en 2D.

## Pass 3 — Ingénieur performance

- Bilan draw calls : ~10 panneaux + murs + 5 œuvres (6 meshes chacune) + banc + portails ≈ 60 desktop, ok.
- Ombres activées **desktop uniquement** ; mobile : pas d'ombres, pixelRatio ≤ 1.5, textures lazy à 16 m,
  anisotropie 8, fog 22–60 m. Textures procédurales 512–1024 px générées une fois.
- Zéro erreur console constaté sur 15 screenshots (desktop + mobile).

## Pass 4 — Accessibilité

- `prefers-reduced-motion` : caméra sans lerp, scroll auto. Fallback no-WebGL. Cibles tactiles ≥ 22 px (arrêts
  du plan) / 38 px (boutons HUD). Focus visibles. Échap ferme overlay/panneau. Entrée au clavier.
- Reste à faire : contraste à vérifier sur mobile réel, lecteur d'écran sur l'index (liste de boutons OK).

## Vérification

- Pipeline headless rejoué après refonte : 15 screenshots, 0 erreur JS ; OCR confirme HUD (« 1/5 — Marines &
  Bretagne », « Index »), plan DOM avec numéros, écran de fin, et aucune trace d'UI Instagram dans les images.
