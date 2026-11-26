# Plan de dev v2 — itérations critiques

Date : commit après `89c1147` (revue n°3). Rédigé après une passe de revue des screenshots
headless desktop (1440×900) et mobile (390×844) — dossier `.vibe/shots4/`, 17 captures,
0 erreur console.

## 1. Diagnostic factuel (ce qui est réellement cassé aujourd'hui)

Constaté sur les captures, pas supposé :

1. **Chevauchement en haut sur mobile** (`shots4/09-mobile.png`) : la bannière de salle
   `#room-banner` (centrée, `top:14px`, `max-width:72vw`) recouvre la marque `#brand`
   (haut gauche) à 390 px de large → texte illisible, aspect "cheap".
2. **Redondance d'info sur mobile** : la salle est déjà affichée 3 fois (`.mm-room` dans la
   minimap, `#p-room` dans `#progress`, `#room-banner`), les numéros d'œuvres 2 fois
   (`#dots` + `.mm-stop`). Trop d'éléments = collisions.
3. **Cibles tactiles trop petites** : `.mm-stop` fait 22 px, et la minimap est scalée à
   0.85 sur mobile → ~18 px effectifs (WCAG 2.5.8 demande ≥ 24 px, idéalement 44 px).
4. **HUD bas fragile** : `#hud-bottom` autorise le `flex-wrap` sur mobile → à 360 px de
   large, les 5 contrôles peuvent passer sur 2 lignes et couvrir plus d'écran.
5. **Toast en haut** : `#toast` à `top:58px` sur mobile peut entrer en conflit avec la
   bannière/marque quand elles sont visibles.

Ce qui est OK et qu'on garde : mur unique + caméra en ligne droite (plus de zigzag),
FOV adaptatif portrait + `viewDist=4.2` (le tableau tient dans le champ —
vérifié `shots4/16-mobile-facing.png`), panneau plein écran sur mobile
(`shots4/10-mobile-panel.png`), index et intro mobile propres
(`shots4/15-mobile-index.png`, `shots4/14-mobile-intro.png`).

## 2. Décisions remises en cause (à challenger, pas à subir)

| Décision actuelle | Statut | Action |
|---|---|---|
| Mur unique à droite, caméra en ligne droite | **Validé visuellement** | Garder. À confirmer encore sur de vrais terminaux. |
| Cormorant Garamond + Inter | **À challenger** | A/B test par screenshots headless avec Instrument Serif / Fraunces (serif) et Inter /Instrument Sans (sans). Choisir au vu des captures, pas au goût. |
| Blanc cassé chaud `#FAF7F2` + bleu marine `#33566E` | **À confirmer** | Tester une variante légèrement plus contrastée (fond plus profond en intro, accent plus saturé) et comparer. |
| Cadres chêne + passe-partout blanc | **Validé** | Garder. |
| Images de démo = extraits 1080 px des captures Instagram | **Bloquant pour le "très haute définition"** | Remplacer par les vraies photos originales uploadées dans `references/`, puis pipeline d'optimisation (voir itération D). |
| Une seule salle (`Marines & Bretagne`) | **À valider** | Prévoir dès maintenant le multi-salles dans le layout (portails déjà en place) pour ne pas re-casser la caméra. |

## 3. Itérations priorisées

Chaque itération = tâches concrètes + **critères de validation mesurables**.
Validation systématique : `npm run build` propre, puis pipeline headless
(`/tmp/shotkit/shoot.mjs`, 17 screenshots desktop 1440×900 + mobile 390×844 et 360×740),
**0 erreur console**, revue image des captures, aucun chevauchement aux 2 tailles mobiles,
cibles tactiles ≥ 24 px (idéal 38+).

### Itération A — HUD mobile sans collision (faite dans ce commit)
- Sous 640 px : masquer `#room-banner` (salle déjà dans `.mm-room` + kicker panneau) et
  `#dots` (numéros déjà dans `.mm-stop`) ; masquer `#p-room` dans `#progress` pour
  raccourcir la barre.
- `#hud-bottom` en **une seule ligne** (`flex-wrap: nowrap`, `max-width: 98vw`, boutons
  compacts) — plus jamais de retour à la ligne.
- `#toast` déplacé au-dessus du HUD bas (`bottom: 78px`) — plus jamais dans la zone haute.
- `@media (pointer: coarse)` : `.mm-stop` porté à 30 px (≈ 25 px effectifs après scale).
- **Validation** : screenshots 390×844 et 360×740, aucun chevauchement, HUD sur une ligne.

### Itération B — Typographie & style (A/B par screenshots)
- Tester 2 alternatives de serif (Instrument Serif, Fraunces) et 1 de sans
  (Instrument Sans) via un flag `?font=` ou un commit jetable ; capturer intro + panneau
  + index en desktop et mobile.
- Comparer objectivement : lisibilité à 20 px, personnalité, cohérence avec l'huile/
  aquarelle. Choisir, documenter dans `docs/style-guide.md`.
- Ajuster la palette si le A/B le justifie (fond, accent, contraste texte).

### Étape intermédiaire R — Veille & sélection d'inspiration ✅ (livrée : `docs/inspiration.md`)
- Recherches web (Awwwards SOTD 2025–2026, collections WebGL/transitions/portfolios,
  sites de peintres/galeries) + **33 captures d'écran réelles** des sites retenus dans
  `docs/inspiration/screenshots/` (Cartier W&W 2025, Lusion, White Cube, bruno-simon,
  Dennis Snellenberg, makemepulse, David Hockney, Tate, Pentagram, collections Awwwards).
- Sélection critique de 8 éléments proposés à reprendre (intro wordmark centré, HUD
  discret + barre de progression fine en haut, compteur géant au focus, bloc « œuvre
  suivante », curseur « Voir », méta en ligne unique, transition panneau, hint mode
  libre) → **l'utilisateur a validé les 8 → implémentées en R2** (commit revue-9).

### Itération N — Navigation & animations ✅ (corrigée, commit revue-8)
- Bugs constatés : suivant/précédent ouvrait la fiche à chaque clic ; au dernier tableau
  le clic ouvrait la fiche au lieu de passer à la fin ; écran de fin bloquait le HUD.
- Fix : `step()` n'ouvre la fiche que si elle est déjà ouverte (sinon simple déplacement
  caméra) ; suivant au dernier → écran de fin ; précédent au premier → début ; `navTarget`
  anti double-clic pendant l'animation ; `#end` en `pointer-events:none` (boutons actifs)
  pour garder le HUD cliquable ; caméra plus réactive (lerp 6→7.5, regard 2.2→3).
- **Validation** : test headless `?dup=3` (15 œuvres) — next ×4 → 5/15→8/15 sans ouvrir
  la fiche, fin atteinte → écran fin, précédent à la fin → retour œuvre 15/15. 0 erreur.

### Itération M — Minimap v2 + tests galerie longue ✅ (commit revue-8)
- Mobile : minimap déplacée **en bas au centre, horizontale** (au-dessus du HUD), stops
  via `--p`/`--fill` ; toast remonté en haut (64 px). Mesuré 390×844 : aucun chevauchement
  minimap/HUD/marque/toast, stops 30 px.
- Hook de test `?dup=N` (duplique les œuvres N fois) pour tester une galerie longue /
  multi-salles sans polluer les données : `?dup=3` → 15 œuvres, parcours progressif OK.

### Itération R2 — Implémenter les 8 choix de la veille ✅ (commit revue-9)
### Itération Q — Audit élément par élément (anti « slop ») 🔄 passe 1 faite (revue-9)
- Grille de check par composant (intro, brand, HUD, minimap, panneau, index, lightbox,
  fin, mode libre, toast, compteur géant, hints) × critères : placement exact, hiérarchie
  typo, espacement, cohérence palette, pas d'élément qui « flotte », cibles tactiles,
  390×844 + 360×740 + 1440×900. Défauts trouvés en passe 1 : aucun chevauchement réel
  (mesures DOM), hint « Défiler » masqué sur tactile pour éviter tout conflit avec la
  minimap. **Passe 2 à refaire à chaque livraison** (ne pas s'arrêter à la première).

### Itération C — Polish desktop & détails
- Relire chaque écran desktop (intro, entrée, focus œuvre, panneau, index, lightbox,
  fin, mode libre) capture par capture ; corriger micro-défauts (alignement, ombres,
  reflets, cartel).
- Vérifier le mode libre (WASD + drag) et le retour guidé, la minimap en mouvement.
- Transitions : easing, durées, fondu `#app.ready`.

### Itération D — Pipeline images haute définition
- L'utilisateur uploade les **photos originales** dans `references/`.
- Script `scripts/optimize-images.mjs` : crop propre (détection de bords), génération
  WebP/AVIF qualité haute + JPEG fallback, tailles responsive (srcset), métadonnées
  EXIF conservées côté source. Les images servies dans `public/data/images/` restent
  optimisées (jamais les originaux lourds).
- Option KTX2/Basis pour les textures 3D si besoin de perf, sinon WebP suffit pour
  les toiles (ce sont des textures planes).

### Itération E — Mode administrateur sans code ni IA ✅ (commit revue-7, `docs/revue-7.md`)
- Decap CMS servi à `/admin/` (`public/admin/`), git-gateway branche `main`, média
  dans `references/`, collections site / salles / œuvres (relation salle, ordre).
- Pont OAuth GitHub en fonctions serverless Vercel `api/auth.js` + `api/callback.js`.
- `scripts/build-data.mjs` (sharp) : `data/` + `references/` → `public/data/`
  optimisé (gitignoré), exécuté en `predev`/`prebuild`.
- **Validation faite** : build OK, fonctions testées avec mocks, 18 screenshots
  0 erreur. **Reste côté propriétaire** : créer l'OAuth App + 2 variables Vercel
  (`docs/admin.md`), puis test réel : publier/réordonner/éditer depuis un téléphone.

### Itération F — Déploiement, domaine, SEO
- Confirmer le déploiement Vercel (branche de prod = `main`), domaine perso si souhaité.
- SEO : title/description par œuvre (routes ou meta dynamiques), `sitemap.xml`,
  `robots.txt`, OG images haute déf par œuvre, JSON-LD `VisualArtwork`.
- Core Web Vitals : LCP (précharger l'image de la première œuvre), CLS nul, INP.

### Itération G — Tests humains réels & accessibilité
- Tests sur vrais terminaux : iOS Safari, Android Chrome (tactile, scroll, panneau,
  lightbox swipe, mode libre).
- Lighthouse (perf, a11y, SEO) + axe-core : 0 violation grave. WCAG 2.2 AA : contrastes,
  focus visibles, `prefers-reduced-motion`, aria sur dialogues (index, lightbox, panneau),
  clavier complet (flèches, Échap, Entrée sur les œuvres).

## 4. Checklists transversales (à valider à chaque itération)

- **Perf** : 60 fps desktop / 30+ fps mobile récent ; `pixelRatio` capé (déjà 2) ;
  ombres uniquement si `!coarse` ; lazy-load des textures ; budget < 3 Mo première vue.
- **Mobile** : 0 chevauchement à 390×844 et 360×740 ; HUD mono-ligne ; cibles ≥ 24 px ;
  pas de `pull-to-refresh` parasite (déjà `overscroll-behavior: none`) ; panneau et
  overlays plein écran.
- **A11y** : contrastes AA, focus trap dans index/lightbox, `role="dialog"`, labels aria
  sur tous les boutons icones, réduction de mouvement respectée.
- **Contenu** : 0 texte parasite dans les images (crop vérifié), ratios d'image réels
  dans `works.json`, cartels = données JSON (jamais de texte en dur dans la scène).
- **Build** : `tsc --noEmit` strict + `vite build` sans warning ; 0 erreur console en
  headless ; screenshots archivés hors repo (`.vibe/`, gitignoré).

## 5. Risques & limites connues

- Le rendu headless (SwiftShader) sous-estime la qualité réelle des ombres/lumière sur
  GPU ; les décisions finales de contraste se prennent aussi sur vrais écrans.
- Les captures headless utilisent des polices de secours (DejaVu) — le site réel sert
  Cormorant/Inter via Google Fonts ; l'itération B devra idéalement se faire avec les
  vraies polices (prévoir de télécharger les woff2 dans le kit de screenshots).
- L'admin (E) dépend du OAuth GitHub côté Vercel — à prototyper tôt pour détecter un
  bloqueur (rate limits, callback URL) avant d'y investir.
- Assets HD : sans les vraies photos originales dans `references/`, le site restera
  limité par les extraits 1080 px — **bloqueur externe** pour l'objectif "très haute
  définition".

---

## 6. Ajouts du 2026-11-26 (demande utilisateur — mode local, sous-agents critiques)

### Veille round 2 — Awwwards & galeries virtuelles 2026 ✅ (livrée : `docs/inspiration/screenshots/round2/`)
- Nouvelles recherches web (SOTD 2026, collections Three.js/WebGL/scrolling, musées en ligne
  — Louvre online tours, DAM Berlin, teamLab, Vredestein Experience Centre, Elektra Virtual
  Museum, portfolios Minh Pham / G. Colombel 2026, « My Art Gallery », « The State of the
  Gallery ») + **captures headless réelles 1440×900 (hero + 2 scrolls)** par site, plus les
  vrais sites externes linkés depuis le mur SOTD du jour (`sotd-live-*`, liens dans
  `sotd-external-links.json`, rapport dans `report.json`).
- À lire avec round 1 (`docs/inspiration/screenshots/`) : sélectionner les patterns à
  reprendre pour la **salle virtuelle** (matériaux, lumière, transitions).

### Étape S — Salle virtuelle « 4K » : textures & lumières ✅ (livrée : revue-10, validée PERFECT par les 3 agents critiques en passe 3)
Objectif : une **vraie visite virtuelle**, pas un décor procédural basique.

- **Textures procédurales haute résolution** : passer les canvas de 512/1024 px à **2048 voire 4096 px** (sol parquet chêne : lames avec variation de teinte, joints, veines, micro-rayures, reflet verni ; murs plâtre : grain fin + grandes marbrures douces ; plafond : enduit + structure du puits de lumière ; plinthes/moulures/cimaise avec profil réel en relief).
- **Puits de lumière** : remplacer le grand panneau blanc uni par une verrière structurée (châssis métallique + vitres émissives segmentées) qui projette une lumière crédible.
- **Luminaires au-dessus de chaque tableau** : remplacer la « barre flottante » actuelle par un **vrai appareil** (boîtier slim métal sombre + lentille émissive) + un **SpotLight réel par œuvre** (cône chaud, pénombre douce, portée limitée) ; le spot « suiveur » global reste en appoint. Ombres portées sur desktop uniquement, activées seulement pour les 2–3 spots les plus proches de la caméra (perf).
- **Détails de musée** : cimaises hautes, moulures de plafond, banc avec ombres, portails de salles avec plaque laiton, tapis sobre, reflets au sol (clearcoat) — cohérents avec `docs/style-guide.md`.
- **Validation** : screenshots headless desktop 1440×900 à plusieurs t (0 / 0.45 / 0.9 / 1) + mobile 390×844, 0 erreur console, draw calls et fps mesurés (`__gallery.renderer.info`), textures `anisotropy` = max du renderer, `SRGBColorSpace` partout.

### Étape M2 — Minimap v3 + tests « derrière le mur » ✅ (livrée : revue-10, validée PERFECT passe 3)

- **Minimap robuste en grand nombre d'œuvres** (`?dup=N`) : stops qui ne se chevauchent plus (taille/numéros adaptatifs : au-delà d'un seuil, pastilles sans numéro + tooltip), **segments de salles** colorés sur la piste, **marqueur de position caméra** (curseur distinct des stops), limites du hall visibles (début/fin), remplissage de progression lisible.
- **Tests de franchissement du mur** : avec `?dup=2, 3, 5, 8` (10/15/25/40 œuvres) vérifier en guidé et en libre que la caméra **ne traverse jamais le mur du fond** (`z >= zEnd + marge`), que l'écran de fin s'affiche bien à t≈1, que la minimap reste lisible et cliquable, et que le scroll-spacer est proportionnel.
- **Validation** : mesures DOM (chevauchements, tailles de stops) à 1440×900, 390×844, 360×740 pour chaque `?dup` ; 0 erreur console ; screenshots archivés dans `.vibe/shots-*` (gitignoré).

### Audit Q — passe 2+ formalisée (check de CHAQUE élément, à chaque livraison) ✅ passe 2+3 faites (revue-10 : 3 agents critiques, VERDICT PERFECT ×3)
Grille à rejouer à chaque commit, 3 tailles d'écran (1440×900, 390×844, 360×740), documentée dans la revue :

| Élément | Critères |
|---|---|
| intro | wordmark centré, capitales espacées, loader lisible, bouton état, 0 chevauchement |
| brand | position, taille, contraste, pas de collision avec bannière/comptoir |
| minimap | lisible à N œuvres, stops cliquables ≥ 24 px, segments salles, marqueur caméra, 0 chevauchement |
| HUD bas | mono-ligne, cibles ≥ 24 px (44 idéal), état idle cohérent |
| dots | masqués mobile, pas de chevauchement avec hint |
| compteur géant | visible au focus uniquement, position fixe, pas de collision |
| bannière salle | fondu, tempo, masquée mobile |
| toast | zone sans conflit, auto-dismiss |
| panneau œuvre | placement, hiérarchie typo, image zoom transition, actions atteignables |
| index | grille propre, cartes lisibles, fermeture OK |
| lightbox | image centrée, nav, zoom, fermeture, swipe |
| écran de fin | miniature, serif, boutons, HUD toujours cliquable |
| mode libre | hint discret, retour guidé, caméra clampée (jamais dans/derrière un mur) |
| scène 3D | textures nettes (pas de pixelisation), luminaires visibles au-dessus des tableaux, ombres cohérentes, fog propre, fin du hall propre (mur du fond visible, pas de trou noir) |

**Règle anti « slop »** : aucun élément ne doit flotter sans raison, aucun dégradé tape-à-l'œil, une seule famille d'accent, typo serif/sans stricte (`docs/style-guide.md`), espacements réguliers, cibles tactiles grandes, **0 chevauchement mesuré en DOM**, 0 erreur console. Toute régression trouvée → corrigée avant livraison.

### Sous-agents critiques (mode local)
- 3 agents critiques lancés en parallèle à chaque itération majeure :
  **design/UI** (style.css, ui.ts, index.html, screenshots vs inspiration), **scène 3D/minimap** (scene.ts, paintings.ts, layout.ts, controls.ts, minimap.ts), **tests fonctionnels** (shotkit headless, ?dup, mesures DOM, console).
- Chacun produit un rapport de critique **actionnable** dans `.vibe/critiques/`.
- **Bloquant** : la nouvelle version n'est livrée (commit « release ») que quand les 3 agents valident à l'unanimité, sur 2 passes consécutives, que chaque élément est « parfait » (placement exact, design conforme, pas de slop).
