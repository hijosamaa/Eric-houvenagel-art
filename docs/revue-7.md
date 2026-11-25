# Revue n°7 — itération E : mode administrateur sans code (Decap CMS + OAuth Vercel)

## Ce qui est livré (ce commit)

- **Modèle de données par fichiers** (source de vérité éditable) :
  `data/site.json` (identité), `data/rooms/*.json` (salles, ordre),
  `data/works/*.json` (une fiche par œuvre : titre, année, technique, dimensions,
  description, salle, ordre, image). Les 5 œuvres de démo migrées depuis l'ancien
  `public/data/works.json` ; images déplacées vers `references/`.
- **`scripts/build-data.mjs`** (sharp, devDependency) : lue `data/` + `references/`,
  génère `public/data/works.json` + `public/data/images/` — `<nom>-800.jpg`
  (textures 3D, cartes, panneau) et `<nom>` recadré à 2000 px max (lightbox
  « Voir en grand », `imageFull`). Tourné via `predev`/`prebuild`.
  `public/data/` est désormais **gitignoré** (généré, jamais édité à la main).
- **Admin Decap** : `public/admin/index.html` + `config.yml` (backend git-gateway,
  branche `main`, média dans `references/`, collections *Paramètres / Salles /
  Œuvres* avec relation salle, champ image, ordre numérique). Servi à `/admin/`
  (statique, avant la réécriture SPA). `local_backend` auto sur localhost.
- **Pont OAuth GitHub** : `api/auth.js` (302 vers GitHub, state+origine en cookies
  HttpOnly) et `api/callback.js` (échange code→token, `postMessage`
  `authorization:github:success` à l'admin). Fonctions serverless Vercel, servies
  avant la réécriture SPA.
- **Site** : `Work.imageFull` ajouté ; lightbox et `og:image` l'utilisent.
- **Docs** : `docs/admin.md` (création de l'OAuth App, variables Vercel
  `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, usage, dépannage), README à jour.

## Validation

- `npm run build` OK (`tsc` strict + vite + prebuild) ; `dist/` contient `admin/`,
  `data/works.json`, images optimisées (800 px ≈ 60–100 Ko, full ≈ 120–195 Ko).
- Fonctions `api/` testées avec mocks (aucun appel GitHub depuis le sandbox) :
  302 + state cookie cohérent, échange de token avec bons paramètres, postMessage
  correct, `state` faux → 400, client id manquant → 500 explicite.
- Pipeline headless complète (18 screenshots desktop/mobile) : **0 erreur console**,
  site identique visuellement (tableaux chargés depuis les données générées, HUD
  mobile mono-ligne à 360 px, lightbox nette en `imageFull`).
- `GET /admin/config.yml`, `/data/works.json`, `/data/images/*.jpg` → 200 depuis
  `dist/` (test serveur statique loopback).

## À faire côté toi (2 réglages, voir docs/admin.md)

1. Créer l'**OAuth App GitHub** (callback `https://<projet>.vercel.app/api/callback`).
2. Ajouter **GITHUB_CLIENT_ID** / **GITHUB_CLIENT_SECRET** dans les variables
   d'environnement Vercel, puis redéployer.

Puis `/admin/` est opérationnel. Note : les aperçus d'images dans l'admin en
production apparaîtront après le build (les originaux `references/` ne sont pas
déployés — seulement les versions optimisées) ; en local `npx decap-server` donne
les aperçus immédiats.

## Suite (plan-dev-v2)

- **D** : quand tu uploades les vraies photos HD dans `references/` (ou via
  l'admin), le pipeline les optimise automatiquement — aucun code à changer.
- **F** : domaine perso, SEO (sitemap, OG par œuvre, JSON-LD). **G** : tests sur
  vrais terminaux + Lighthouse/axe.
