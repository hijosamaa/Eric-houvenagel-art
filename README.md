# Eric Houvenagel — Art

Site galerie virtuelle en 3D présentant les tableaux (huile et aquarelle) d'Eric Houvenagel, avec un **mode administrateur sans code** pour publier de nouveaux tableaux à partir d'une image, les réordonner et éditer leurs descriptions.

## Structure du dépôt

| Dossier | Rôle |
|---|---|
| racine | Le site statique (Vite + TypeScript + Three.js) : `index.html`, `src/`, `public/` |
| `public/data/` | **Généré au build** (gitignoré) : `works.json` + images optimisées, produits par `scripts/build-data.mjs` |
| `references/` | Photos originales des tableaux (source HD, déposées ici par l'artiste ou via l'admin) |
| `data/` | Données éditées via l'admin : `site.json`, `rooms/*.json`, `works/*.json` |
| `public/admin/` | CMS Decap servi à `/admin/` (config dans `public/admin/config.yml`) |
| `api/` | Fonctions serverless Vercel du pont OAuth GitHub (`auth` / `callback`) |
| `scripts/` | `build-data.mjs` : data/ + references/ → public/data/ optimisé (sharp) |
| `docs/` | Plan (`plan.md`, `plan-dev-v2.md`), guide de style, admin (`admin.md`), revues |

## Ajouter des tableaux de référence

Depuis l'interface GitHub (web ou navigateur mobile), branche `main` :

1. **Add file → Upload files**.
2. Destination : le dossier **`references/`**.
3. Valider le commit.

Conventions pour les photos : JPG/PNG en pleine résolution, lumière naturelle sans flash, tableau de face, nommage `huile-<sujet>-<annee>.jpg` / `aquarelle-<sujet>-<annee>.jpg`.

## Développement local

```bash
npm install
npm run dev
```

## Déploiement (Vercel)

Hébergement sur **Vercel** (gratuit, HTTPS, domaine perso gratuit) — choisi plutôt que GitHub Pages, qui exige un plan payant pour les dépôts privés. Branche par défaut : `main`.

**Tant que le dépôt est public** (c'est le cas actuellement) : le déploiement natif suffit. Importe le projet une fois sur [vercel.com](https://vercel.com) (**Add New… → Project → Import Git Repository** → `hijosamaa/Eric-houvenagel-art`). Preset **Vite** détecté automatiquement, build `npm run build`, output `dist` (déjà dans `vercel.json`), Root Directory = racine du dépôt, branche de production `main`. Chaque push sur `main` déploie automatiquement sur `https://<nom-du-projet>.vercel.app`.

**Si le dépôt repasse en privé** : sur le plan Hobby, Vercel bloque alors les déploiements git dont l'auteur du commit n'est pas le propriétaire du projet (« *The deployment was blocked because the commit author did not have contributing access* »). Dans ce cas :

1. Sur ta machine, dans un clone du dépôt : `npm i -g vercel && vercel login && vercel link`, puis **committe `.vercel/project.json`** (déjà non ignoré) et push.
2. Crée un token sur [vercel.com/account/tokens](https://vercel.com/account/tokens).
3. Ajoute le secret `VERCEL_TOKEN` : dépôt → **Settings → Secrets and variables → Actions → New repository secret**.
4. Lance à la main le workflow **« Déployer sur Vercel (manuel) »** (onglet **Actions**) : `npm ci`, `npm run build`, puis `vercel pull` / `vercel build --prod` / `vercel deploy --prebuilt --prod` avec le token.

**Alternative manuelle à tout moment**, depuis un clone local (tu es l'auteur des commits, donc accepté) : `vercel login && vercel link && vercel --prod`.

Voir `docs/plan.md` pour l'architecture complète et `docs/style-guide.md` pour les décisions de style.

## Mode administrateur (sans code, sans IA)

Ouvrir **`https://<projet>.vercel.app/admin/`** → connexion GitHub (OAuth) → publier
une œuvre depuis une image, réordonner, éditer titre/année/technique/dimensions/
description. L'admin (Decap CMS) committe dans `data/` + `references/` sur `main` ;
le build régénère `public/data/` (images optimisées) et Vercel redéploie.

Mise en place initiale (créer l'OAuth App GitHub + 2 variables d'environnement Vercel)
détaillée dans **`docs/admin.md`**.
