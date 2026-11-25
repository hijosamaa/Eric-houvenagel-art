# Eric Houvenagel — Art

Site galerie virtuelle en 3D présentant les tableaux (huile et aquarelle) d'Eric Houvenagel, avec un **mode administrateur sans code** pour publier de nouveaux tableaux à partir d'une image, les réordonner et éditer leurs descriptions.

## Structure du dépôt

| Dossier | Rôle |
|---|---|
| racine | Le site statique (Vite + TypeScript + Three.js) : `index.html`, `src/`, `public/` |
| `public/data/` | Données de la galerie (`works.json`) et images des œuvres |
| `references/` | Photos de tableaux de référence fournies par l'artiste |
| `docs/` | Plan d'implémentation (`plan.md`) et guide de style (`style-guide.md`) |
| `data/` | Réservé aux données éditées via le mode admin (schéma CMS à venir) |
| `admin/` | À venir : CMS headless d'administration |

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

## Mode administrateur (à venir)

Un CMS headless (interface web d'administration dans `admin/`) permettra de publier un tableau depuis une image, de changer l'ordre des œuvres et d'éditer titre, année, technique, dimensions et description — sans toucher au code. Le détail technique sera décrit dans `docs/plan.md`.
