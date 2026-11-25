# Revue n°5 — itération B : A/B typographique (vraies webfonts en headless)

## Méthode

Le sandbox n'avait aucune police système au début ; pour juger les polices il fallait
les **vraies webfonts** dans les captures. Mise en place :

- `/tmp/shotkit/fetchfonts2.mjs` télécharge les woff2 Google Fonts (Cormorant Garamond
  500/600/500i, Inter 400/500/600, Instrument Serif 400/400i, Instrument Sans
  400–700, Fraunces opsz 9..144 500/600/500i) → `/tmp/fonts/` + `fonts.css`.
- `/tmp/shotkit/shoot-fonts.mjs` : sert `dist/` en loopback, **intercepte**
  `fonts.googleapis.com` (répond avec le `fonts.css` local, URL absolues + CORS) et
  bloque `fonts.gstatic.com`. Une variante (`VARIANT=a|b|c`) réinjecte les variables
  `--serif` / `--sans` par `addStyleTag` après chargement.
- 3 variantes × 5 captures (intro, entrée, fiche, index desktop 1440×900 + entrée
  mobile 390×844), **0 erreur console** chacune. Captures : `.vibe/fonts/{a,b,c}/`.

| Variante | Serif | Sans |
|---|---|---|
| A (avant) | Cormorant Garamond 600 | Inter |
| B | Instrument Serif (400 seul) | Instrument Sans |
| C | **Fraunces opsz 500/600 + ital** | Inter |

## Décision : variante C (Fraunces + Inter)

- **Instrument Serif (B)** : très tendance (Awwwards) mais un seul poids 400 — le nom
  de l'artiste et les titres d'œuvres sont en 600 → faux gras synthétisé, rendu moins
  net. Écarté pour les titres ; Instrument Sans reste une option UI mais Inter est
  plus neutre/lLisible en petit.
- **Cormorant Garamond (A)** : élégant mais « luxure générique », déjà très vu.
- **Fraunces (C)** : vrais poids 500/600 + italique, axe optique `opsz` (le display
  grandit en contraste automatiquement), caractère éditorial premium distinctif — le
  plus « Awwwards » des trois tout en restant lisible en petit (opsz auto). Gardé.

## Changements (ce commit)

- `index.html` : lien Google Fonts → `Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500` + `Inter:wght@400;500;600`.
- `src/style.css` : `--serif: 'Fraunces', Georgia, serif`.
- `docs/style-guide.md` : section typographie mise à jour avec la justification.

## Validation

- `npm run build` OK (`tsc` strict + vite).
- `shoot-fonts.mjs` en mode `app` (sans override, donc vraies variables du site +
  vraies polices interceptées) : 5 captures, **0 erreur console**, Fraunces bien
  rendue (vérifié visuellement : contraste élevé du nom en intro, gras 600 net).
- `shoot.mjs` standard (18 captures, polices de secours) : 0 erreur console, aucun
  changement de layout (les métriques de Fraunces sont proches de Cormorant à ces
  tailles ; HUD mobile toujours mono-ligne à 360 px).

## Suite (plan-dev-v2)

Itération C (polish desktop capture par capture) puis D (vraies photos HD dans
`references/` + pipeline d'optimisation) — D est bloqué côté toi : uploader les
photos originales. Puis E (admin sans code) quand tu voudras.
