# Mode administrateur — guide de mise en place

L'admin est un **CMS Decap** servi par le site lui-même à `/admin/`. Il écrit dans le
dépôt GitHub (branche `main`) via l'API GitHub, authentifié par **OAuth GitHub** dont
le pont est assuré par deux fonctions serverless Vercel (`api/auth.js`,
`api/callback.js`). Aucun code à écrire côté artiste : on ouvre `/admin/`, on se
connecte avec GitHub, on publie.

## 1. Créer l'application OAuth GitHub (une fois, ~2 min)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   (https://github.com/settings/developers).
2. **Application name** : `Eric Houvenagel — galerie (admin)`.
3. **Homepage URL** : `https://<ton-projet>.vercel.app`
4. **Authorization callback URL** : `https://<ton-projet>.vercel.app/api/callback`
5. Enregistre, puis copie le **Client ID** et génère un **Client Secret**.

> Le scope demandé est `repo` : il couvre aussi le cas où le dépôt repasserait en
> privé. Si le dépôt reste public, `public_repo` suffit (à changer dans
> `api/auth.js`).

## 2. Variables d'environnement Vercel (une fois)

Projet Vercel → **Settings → Environment Variables** :

| Nom | Valeur |
|---|---|
| `GITHUB_CLIENT_ID` | Client ID de l'app OAuth |
| `GITHUB_CLIENT_SECRET` | Client Secret de l'app OAuth |

Coche **Production, Preview et Development**, puis **redéploie** le projet
(Settings → Deployments → … → Redeploy) pour que les fonctions prennent les variables.

## 3. Utilisation (sans code)

1. Ouvrir `https://<ton-projet>.vercel.app/admin/` → **Login with GitHub** → autoriser.
2. **Œuvres → New** : titre, année, technique, dimensions, description, **salle**
   (liste déroulante alimentée par la collection *Salles*), **ordre** dans la salle,
   et **Image** : upload de la photo (JPG/PNG/WebP, pleine résolution — elle est
   déposée dans `references/`).
3. **Save → Publish** : commit sur `main` → Vercel redéploie → le build
   (`scripts/build-data.mjs`) optimise l'image (800 px pour la 3D/cartes,
   2000 px pour le "Voir en grand") et régénère `public/data/works.json`.
4. L'œuvre est en ligne. Pour réordonner : changer le champ **Ordre** (ou l'ordre
   des salles) et publier.

## 4. Développement local de l'admin

```bash
npm run dev          # génère public/data/ (predev) puis sert le site sur 127.0.0.1
npx decap-server     # backend local Decap sur 127.0.0.1:8081 (local_backend)
```

Puis ouvrir `http://localhost:5173/admin/` — `public/admin/index.html` active
`local_backend` automatiquement sur localhost (pas besoin d'OAuth ni de fonctions).

## 5. Architecture

```
references/            ← photos originales (commitées, NON déployées telles quelles)
data/site.json         ← identité (artiste, accroche)
data/rooms/*.json      ← salles { name, order }
data/works/*.json      ← une fiche par œuvre { title, year, medium, dimensions,
                            description, room, order, image }
scripts/build-data.mjs ← lit data/ + references/, écrit public/data/works.json
                            + public/data/images/ (optimisées via sharp)
public/admin/          ← Decap CMS (config.yml : git-gateway, branche main)
api/auth.js            ← /api/auth     : redirect OAuth GitHub (state en cookie)
api/callback.js        ← /api/callback : échange code→token, postMessage à l'admin
```

- `public/data/` est **généré** (gitignoré) : ne jamais l'éditer à la main.
- `vercel.json` : les fonctions `api/` et les fichiers statiques `public/admin/`
  sont servis avant la réécriture SPA `/(.*) → /index.html`.
- Le chemin d'image stocké dans `data/works/*.json` est le chemin public
  (`/data/images/<fichier>`) ; `build-data.mjs` retrouve le fichier original dans
  `references/` par son nom de base.
- La galerie charge `data/works.json` au runtime : `image` = 800 px (textures 3D,
  cartes, panneau), `imageFull` = 2000 px (lightbox « Voir en grand »).

## 6. Dépannage

- **« Variable GITHUB_CLIENT_ID manquante »** → variables Vercel non renseignées ou
  déploiement non refait après ajout.
- **« Paramètres OAuth invalides (state) »** → cookies bloqués ou callback URL mal
  renseignée dans l'app GitHub (doit être exactement `…/api/callback`).
- **401 GitHub dans l'admin** → le token a expiré : se reconnecter. Scope `repo`
  nécessaire si le dépôt est privé.
- **Image non visible dans l'admin après upload** → normal en production tant que
  le build n'a pas régénéré `public/data/images/` ; le fichier original est bien
  dans `references/` et apparaîtra sur le site au prochain déploiement.
