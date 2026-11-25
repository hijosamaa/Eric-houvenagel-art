# Revue critique n°3 — tous les détails (itération 4)

Retour utilisateur (mobile) + passe complète « chaque détail », en s'appuyant sur les captures headless
rejouées après chaque changement (desktop 1440×900, mobile 390×844, ombres actives).

## Bugs mobile corrigés

1. **Tableau trop grand en face sur téléphone** : en portrait, le FOV horizontal est étroit → un tableau de
   2,4 m remplissait tout l'écran. Fix : distance de vue passée à **4,2 m sur tactile** (2,6 m desktop), le
   chemin caméra (`pathX`) se rapproche du mur en conséquence, et le **FOV vertical est recalculé selon
   l'aspect** (`fov = min(74, 62/√aspect)` en portrait, 58 paysage) pour garder un champ horizontal constant.
2. **Panneau qui ne couvrait pas l'écran → tableau « en deux fois »** : sur mobile le panneau passe en
   **plein écran** (100 % largeur/hauteur, glisse du bas), au lieu d'une bottom sheet à 56 %.

## Détails passés en revue et améliorés

- **Curseur custom** (desktop) : point accent qui grossit en anneau au survol d'un tableau.
- **Grain fin** (overlay SVG feTurbulence, opacité 5 %) : texture film, anti-plat.
- **Entrée du HUD en fondu** après « Entrer » (brand → plan → pastilles → barre, délais en cascade).
- **Panneau œuvre enrichi** : kicker « Œuvre k / n · Salle », clic sur l'image = lightbox, boutons nav.
- **Lightbox** : swipe gauche/droite (tactile), zoom molette **et** touches `+`/`-`, focus sur « fermer » à
  l'ouverture, légende complète.
- **Anti-artefacts mobile** : `overscroll-behavior: none` (plus de pull-to-refresh pendant la visite),
  `-webkit-tap-highlight-color: transparent`, images non draggables.
- **FOV/qualité adaptatifs** : pixelRatio ≤ 1.5 tactile, ombres off sur tactile (déjà), lazy textures 16 m.
- **Accessibilité** : focus visibles, Échap ferme tout, Entrée lance l'intro, `prefers-reduced-motion`.

## Vérification

- 17 screenshots rejoués, **0 erreur console** ; domcheck : `shadowMap: true`, 50 draw calls, FOV recalculé,
  `placedX` uniforme (mur unique). OCR : HUD complet, plan DOM numéroté, kicker du panneau, pas de texte UI
  Instagram dans les images.

## Reste ouvert (besoin du réel appareil / de vrais assets)

- Jugement fin de la lumière sur GPU réelle (SwiftShader ici) → à valider sur téléphone.
- Images HD originales à uploader dans `references/` (les démos sont des extraits 1080 px).
