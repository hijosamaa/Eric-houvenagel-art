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

## Déploiement

Le site est construit et déployé automatiquement sur **GitHub Pages** à chaque push (workflow `.github/workflows/deploy.yml`) : https://hijosamaa.github.io/Eric-houvenagel-art/

Voir `docs/plan.md` pour l'architecture complète et `docs/style-guide.md` pour les décisions de style.
