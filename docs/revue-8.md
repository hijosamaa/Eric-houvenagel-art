# Revue n°8 — étapes N (navigation) + M (minimap v2 + tests) + R (veille)

## N — Navigation & animations (bugs signalés : suivant/précédent ouvrait la fiche,
écran de fin bloquait le HUD)

- `src/main.ts` `step()` : n'ouvre le panneau **que s'il est déjà ouvert** ; sinon simple
  déplacement caméra (`scrollToWork` en guidé, `focusOn` en libre). Suivant au dernier
  tableau → défilement jusqu'à la fin (écran de fin) ; précédent au premier → début.
  `navTarget` pour ignorer les clics répétés pendant l'animation (anti double-saut).
  Lightbox : suivant/précédent navigue dans la lightbox sans rouvrir le panneau.
- `src/style.css` : `#end` en `pointer-events: none` (boutons actifs) → le HUD reste
  cliquable quand l'écran de fin est affiché.
- `src/gallery/controls.ts` : caméra plus réactive (lerp t 6→7.5, regard 2.2→3).
- **Validation headless** (`?dup=3`, 15 œuvres, 1440×900) : next ×4 → 5/15 → 8/15,
  `panelOpen:false` à chaque fois, scroll fluide ; t=1 → écran de fin affiché, next à la
  fin le garde, précédent à la fin → retour 15/15 et fin masquée. 0 erreur console.

## M — Minimap v2 + hook de test

- Mobile ≤ 640 px : minimap **en bas au centre, horizontale** (piste 58vw max 250px,
  `--p`/`--fill` posent stops et remplissage), toast remonté en haut (64px). Mesuré
  390×844 : minimap y=726 h=44, HUD y=780 h=52, **0 chevauchement** avec HUD/marque/toast,
  stops 30 px. Desktop inchangé (verticale à droite).
- `?dup=N` dans `main.ts` : duplique les œuvres N fois (ids suffixés, ordre décalé) pour
  tester une galerie longue sans toucher aux données — utilisé pour les tests ci-dessus.

## R — Veille & inspiration (étape intermédiaire demandée)

- `docs/inspiration.md` + **33 screenshots réels** dans `docs/inspiration/screenshots/`
  (Cartier W&W 2025 SOTM, Lusion, White Cube, bruno-simon, Dennis Snellenberg,
  makemepulse, David Hockney, Tate, Pentagram, collections Awwwards WebGL/SOTD).
- 8 éléments proposés à reprendre, **à valider par l'utilisateur** (intro wordmark centré,
  HUD discret + barre fine en haut, compteur géant au focus, bloc « œuvre suivante »,
  curseur « Voir », méta en ligne, transition panneau, hint mode libre) → itération R2.

## Suite

R2 (implémenter les choix de `docs/inspiration.md`) → Q (audit élément par élément,
2 passes, 3 tailles d'écran) → D (photos HD) → F (SEO/domaine) → G (tests réels).
