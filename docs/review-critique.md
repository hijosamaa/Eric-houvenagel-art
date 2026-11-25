# Revue critique — galerie 3D (itération 2)

Méthode : comme aucun outil de sous-agent n'est disponible dans cette session, la revue a été faite en
plusieurs passes critiques structurées, **appuyées sur des captures d'écran réelles** (navigateur headless
Chromium + SwiftShader, 1440×900 et 390×844, voir `.vibe/shots/` en local) : pass 1 parcours/UX, pass 2 rendu
visuel, pass 3 robustesse/perf. Les constats viennent des screenshots, pas de l'intuition.

## Constats (ce qui faisait « cheap »)

1. **Images contaminées** : les premières images étaient rognées depuis des captures Instagram et contenaient
   encore la légende/hashtags/« Publications » → lecture comme du contenu UI, rendu amateur. **Fix** : re-crop
   propre (détection des bords de la photo), ratio carré 1:1.
2. **Trajet en zigzag gauche-droite** : la caméra restait au centre avec un `lookAt` interpolé entre les murs
   opposés → le regard fouettait à chaque tableau. **Fix** : chemin caméra en `CatmullRomCurve3` qui ondule
   doucement vers le mur du tableau courant + `lookAt` amorti (lerp) vers l'œuvre courante.
3. **Minimap illisible** : trop petite, intérieur vide, pas de labels. **Fix** : carte plus grande, bandes de
   salles nommées, pastilles numérotées, marqueur caméra pulsant, légende « Entrée ».
4. **Rendu plat** : pas d'ombres, pas d'IBL, matières basiques, spot à bord dur. **Fix** : environnement
   `RoomEnvironment` (PMREM) pour l'éclairage ambiant réaliste, ombres PCFSoft (desktop), matériaux
   `MeshPhysicalMaterial` (sol verni avec clearcoat, cadres bois), puits de lumière au plafond, cartels de
   musée (titre/année/médium) à côté de chaque tableau, textures procédurales 1024 px.
5. **Pas de vue d'ensemble** : on ne comprenait pas comment circuler. **Fix** : overlay **« Index »** (liste de
   toutes les œuvres groupées par salle, avec vignettes), pastilles numérotées, minimap cliquable.
6. **Pas de fin** : le parcours se terminait sur un mur nu. **Fix** : écran de fin « Merci de votre visite »
   avec « Revoir depuis le début » et « Index ».
7. **Intro pauvre** : juste un titre. **Fix** : landing d'accueil avec nom en grand serif, extrait de 3 œuvres
   en « polaroids », CTA.

## Ce qui est conservé (ça marchait)

- Visite guidée au scroll (fonctionne nativement au tactile mobile), clic tableau → fiche + lightbox 2D,
  mode libre desktop avec collisions, lazy-loading des textures, fallback no-WebGL, `prefers-reduced-motion`.

## Principes retenus (pour ne plus retomber dans le « 3D cheap »)

- Lumière d'abord, géométrie ensuite (HDRI/IBL + ACES + ombres douces > plus de polygones).
- Tout mouvement est amorti (lerp), jamais de changement instantané (caméra, lookAt, scroll).
- La 3D sert l'ambiance et le parcours ; le détail de l'œuvre se lit en 2D (lightbox).
- Toujours un moyen de se repérer : minimap + index + numérotation + progression.
- Images des œuvres en pleine résolution, anisotropie max, jamais de déformation (ratio conservé).
- **Assets HD réels** : les 5 images actuelles sont des extraits 1080 px de captures Instagram. Pour du vrai
  HD, uploader les photos originales des tableaux dans `references/` (elles remplaceront les démos via l'admin).

## Vérification visuelle

- Pipeline local reproductible : build `dist/`, serveur statique sur `127.0.0.1`, puppeteer headless
  (SwiftShader) → screenshots desktop/mobile analysés à chaque itération. Zéro erreur console JS constaté.
