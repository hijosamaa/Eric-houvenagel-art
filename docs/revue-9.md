# Revue n°9 — itération R2 (les 8 propositions de `docs/inspiration.md`) + audit Q passe 1

Toutes les propositions validées par l'utilisateur sont implémentées :

| # | Proposition | Implémentation | Validation |
|---|---|---|---|
| 1 | Intro façon Cartier | `#intro-inner h1` en capitales espacées Fraunces 500 (`letter-spacing .14em`), tagline « GALERIE VIRTUELLE », 3 miniatures 72 px sans rotation, hint retiré | capture `01-intro` (vraies polices) : centré, sobre, aucun défaut |
| 2 | HUD discret + barre fine en haut | `#progress-bar` déplacée en haut (2 px, fond transparent), `#hud-bottom.idle` → opacity 0.28 après 2,4 s sans scroll (desktop `pointer:fine` uniquement) | DOM : barre top y=0 h=2, fill 45 % à t=0.45 |
| 3 | Compteur géant au focus | `#big-counter` « 03 — 05 » Fraunces, bas-gauche desktop / haut-droite mobile, visible à < 3 m d'une œuvre | DOM : `show` à t=0.45, **0 chevauchement** avec dots/HUD/minimap (mesuré) |
| 4 | Écran de fin enrichi | `#end-thumb` (miniature dernière œuvre, chargée OK), h2 serif 64 px, boutons conservés | capture `12-end` : miniature + titre + actions propres |
| 5 | Curseur « Voir » | `#cursor` avec `<span>Voir</span>`, cercle 52 px flouté au survol d'un tableau (caché sur tactile) | CSS en place, `pointer:fine` only |
| 6 | Méta en ligne « — » | `join(' — ')` dans panneau, lightbox et cartes index (année — technique — dimensions) | capture panneau : ligne unique |
| 7 | Transition panneau douce | easing `cubic-bezier(0.22,1,0.36,1)` 0.55 s + image `scale(1.045)→1` sur 0.65 s à l'ouverture | build OK |
| 8 | Hint mode libre | `#free-hint` bas-droite, visible uniquement en `body.free` et `pointer:fine` | `setFreeLabel` toggle la classe |

Divers : hint « DÉFILER » animé bas-centre à l'entrée, masqué au premier scroll
(comme le toast) ; masqué sur tactile (évite le chevauchement avec la minimap du bas).

## Audit Q — passe 1 (élément par élément)

- Mesures DOM 1440×900 à t=0 et t=0.45 : overlaps `bcDots/bcHud/bcMm/dotsHud/mmHud` =
  tous false ; `hintDots` vrai mais élément invisible (opacity 0, hint retiré au scroll).
- 390×844 : compteur haut-droite sans chevaucher la marque ; minimap horizontale au-dessus
  du HUD sans chevauchement ; scène propre.
- 18 screenshots headless + run « app » avec vraies polices : **0 erreur console**.

## Suite

Q passe 2 au prochain lot de captures (après D si photos HD dispo) ; puis F (SEO/domaine),
G (tests réels + Lighthouse/axe).
