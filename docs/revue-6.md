# Revue n°6 — itération C : passe critique desktop/mobile avec les vraies polices

Captures `docs/revue-5` (variante `app` = Fraunces + Inter réels, 5 écrans) +
`.vibe/shots6/` (18 écrans standard). 0 erreur console partout.

## Constats

- **Mobile 390×844** : propre — marque seule en haut, aucun chevauchement, scène 3D
  (tableau cadré, proportionnel), minimap lisible (PLAN · salle · 1–5), HUD mono-ligne.
- **Fiche œuvre desktop** : hiérarchie OK (kicker → titre → méta → description →
  actions). Deux remarques : espacement image/boutons un peu juste (corrigé, ce
  commit) et **image légèrement pixelisée** → cause connue : assets de démo =
  extraits 1080 px des captures Instagram. **Bloqué sur l'upload des vraies photos HD
  dans `references/`** (itération D).
- **Index desktop** : en-tête sticky + groupes par salle OK ; la dernière rangée de
  cartes est coupée en bas de viewport mais l'overlay scrolle (padding-bottom 80 px)
  → comportement normal, pas un défaut.
- **Polices** : Fraunces rend un gras 600 net (pas de faux gras), contraste premium
  en intro ; Inter lisible en petit (HUD, méta).

## Changements (ce commit)

- `src/style.css` : `#panel-img` margin-bottom 16→22 px, `#panel-desc` margin-bottom
  22→30 px (meilleure respiration de la fiche).

## Reste du plan (plan-dev-v2)

- **D** : en attente des photos originales HD dans `references/` + pipeline
  `scripts/optimize-images.mjs` (WebP/AVIF + srcset). C'est le plus gros gain visuel.
- **E** : admin sans code (Decap/Sveltia + OAuth Vercel) — à lancer quand tu veux
  (tu avais dit « plus tard »).
- **F** : domaine/SEO/sitemap/OG par œuvre. **G** : tests sur vrais terminaux +
  Lighthouse/axe (nécessite un device réel ou CI).
