# Eric Houvenagel — Art

Site galerie virtuelle en 3D présentant les tableaux (huile et aquarelle) d'Eric Houvenagel, avec un **mode administrateur sans code** pour publier de nouveaux tableaux à partir d'une image, les réordonner et éditer leurs descriptions.

## Structure du dépôt

| Dossier | Rôle |
|---|---|
| `references/` | Photos de tableaux de référence fournies par l'artiste (à uploader ici) |
| `docs/` | Plan d'implémentation et guide de style du site |
| `data/` | Données des œuvres affichées sur le site (gérées par le mode admin, ne pas éditer à la main) |
| racine | Le site statique sera développé ici (à venir) |

## Ajouter des tableaux de référence

Depuis l'interface GitHub (web ou navigateur mobile) :

1. Ouvrir le dépôt et sélectionner la branche courante.
2. Cliquer sur **Add file → Upload files**.
3. Choisir le dossier **`references/`** comme destination.
4. Sélectionner les photos des tableaux et valider le commit.

Conventions pour les photos :

- Format JPG ou PNG, résolution maximale de l'appareil photo.
- Lumière naturelle, sans flash, tableau photographié de face.
- Nom de fichier parlant : `huile-<sujet>-<annee>.jpg` ou `aquarelle-<sujet>-<annee>.jpg`.

Ces tableaux serviront à définir la palette, la typographie et l'ambiance de la galerie 3D, puis à pré-remplir la galerie de démonstration.

## Mode administrateur (à venir)

Un CMS headless (interface web d'administration) permettra de publier un tableau depuis une image, de changer l'ordre des œuvres et d'éditer titre, année, technique, dimensions et description — sans toucher au code. Le détail technique sera décrit dans `docs/`.

## Développement local

```bash
npm install
npm run dev
```

## Déploiement (Vercel)

Le dépôt reste **privé** : GitHub Pages exigerait un dépôt public ou un plan payant, donc on déploie sur **Vercel** (gratuit, HTTPS, domaine perso gratuit).

> **Limitation Hobby + dépôt privé** : Vercel bloque les déploiements déclenchés par git quand l'auteur du commit n'est pas le propriétaire du projet (« *The deployment was blocked because the commit author did not have contributing access* »). Comme les commits sont poussés par un compte tiers, on déploie via un **token Vercel en CI** (voir ci-dessous), ce qui garde le dépôt privé et le déploiement automatique.

### Mise en place (une seule fois)

1. Crée le projet sur [vercel.com](https://vercel.com) : **Add New… → Project → Import Git Repository** → `hijosamaa/Eric-houvenagel-art` (autorise l'app GitHub Vercel, dépôt privé). Preset **Vite** détecté automatiquement, build `npm run build`, output `dist` (déjà dans `vercel.json`), Root Directory = racine du dépôt, branche de production `main`.
2. Sur ta machine, dans un clone du dépôt : `npm i -g vercel && vercel login && vercel link` → crée `.vercel/project.json`, à **committer** (déjà exclu du gitignore sauf ce fichier).
3. Crée un token : [vercel.com/account/tokens](https://vercel.com/account/tokens), copie sa valeur.
4. Ajoute le secret : dépôt GitHub → **Settings → Secrets and variables → Actions → New repository secret** → nom `VERCEL_TOKEN`, valeur = le token.
5. Push sur `main` : le workflow `.github/workflows/deploy-vercel.yml` fait `npm ci`, `npm run build`, puis `vercel pull` / `vercel build --prod` / `vercel deploy --prebuilt --prod` avec le token → le site est publié sur `https://<nom-du-projet>.vercel.app`.

### Alternative manuelle (sans CI)

Depuis ton clone local (tu es l'auteur des commits, donc accepté par Vercel) : `vercel login && vercel link && vercel --prod`.

### Autre option

Rendre le dépôt **public** : les déploiements git connectés marchent alors tels quels sur le plan Hobby (mais le code et les images deviennent publics).

Voir `docs/plan.md` pour l'architecture complète et `docs/style-guide.md` pour les décisions de style.
