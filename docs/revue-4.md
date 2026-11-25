# Revue n°4 — plan de dev v2 + itération A (HUD mobile sans collision)

## Diagnostic (captures `.vibe/shots4/`)

- 390×844 : `#room-banner` (centrée, `top:14px`) chevauchait `#brand` (haut gauche) →
  texte illisible en haut.
- Redondances mobile : salle affichée 3× (`#room-banner`, `.mm-room`, `#p-room`),
  numéros 2× (`#dots` + `.mm-stop`).
- `.mm-stop` = 22 px × scale 0.85 ≈ 18 px effectifs (trop petit pour le tactile).
- `#hud-bottom` autorisait le wrap sur mobile ; `#toast` en haut pouvait entrer en
  conflit avec bannière/marque.

## Plan

`docs/plan-dev-v2.md` : diagnostic factuel, décisions à challenger (typographie A/B
Instrument Serif / Fraunces vs Cormorant, palette, assets HD), itérations A→G avec
critères de validation mesurables (0 erreur console, 0 chevauchement à 390×844 et
360×740, cibles ≥ 24 px, HUD mono-ligne), checklists perf / WCAG 2.2 AA / UX, risques.

## Itération A réalisée (ce commit)

`src/style.css` :

- ≤ 640 px : `#room-banner` et `#dots` masqués (infos déjà dans `.mm-room`, kicker du
  panneau et `.mm-stop`) ; `#p-room` masqué dans `#progress`.
- `#hud-bottom` mono-ligne forcée (`flex-wrap: nowrap`, `max-width: 98vw`, boutons
  compacts) — plus jamais de retour à la ligne.
- `#toast` déplacé au-dessus du HUD bas (`bottom: 78px`).
- `@media (pointer: coarse)` : `.mm-stop` et `.dot` à 30 px (≈ 26 px effectifs après
  scale minimap → conforme WCAG 2.5.8 ≥ 24 px).

## Validation (pipeline headless, 18 screenshots, 0 erreur console)

- `09-mobile.png` (390×844) : marque seule en haut, **aucun chevauchement** ; HUD
  `‹ 3/5 › Index` sur une seule ligne (`btn-free` masqué sur tactile, choix assumé :
  pas de WASD sur mobile) ; minimap à droite, pastilles 1–5 lisibles.
- `17-mobile-360.png` (360×740) : HUD = 187 px sur une seule ligne, aucun débordement ;
  bannière et dots `display:none` (mesuré) ; pastilles `.mm-stop` mesurées à 26–32 px.
- `10-mobile-panel.png` : panneau plein écran, kicker « ŒUVRE 3/5 », 3 actions visibles,
  bouton × non coupé, HUD sous le panneau.
- Desktop 1440×900 (`hudcheck`) : `overlaps: []` entre brand/minimap/dots/hud/banner/toast,
  HUD 387×58 px, dots visibles, bannière OK.
- Note : le script de captures émule maintenant `pointer: coarse` + `hasTouch` en CDP
  pour refléter les vrais mobiles (auparavant le headless ne correspondait pas).

## Reste à faire (voir plan-dev-v2.md)

B : A/B typographique par screenshots. C : polish desktop. D : vraies photos HD dans
`references/` + pipeline d'optimisation. E : admin sans code (Decap/Sveltia + OAuth
Vercel). F : domaine/SEO/sitemap. G : tests sur vrais terminaux + Lighthouse/axe.
