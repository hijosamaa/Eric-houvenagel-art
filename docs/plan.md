# Plan d'implémentation — site galerie 3D d'Eric Houvenagel

## Objectif

Site statique présentant les tableaux (huile & aquarelle) d'Eric Houvenagel dans une **galerie virtuelle 3D** (Three.js), navigable facilement sur PC et mobile, avec un **mode administrateur sans code et sans IA** pour publier de nouveaux tableaux à partir d'une image, les réordonner et éditer leurs fiches.

## Stack retenue

- **Vite + TypeScript + Three.js (vanilla)** — pas de framework UI, bundle léger.
- **Hébergement : Vercel** (gratuit, HTTPS, domaine perso gratuit), déploiement automatique à chaque push sur la branche de production. Choisi plutôt que GitHub Pages car le dépôt reste privé (Pages exige un dépôt public ou un plan payant pour les dépôts privés).
- **Mode admin : CMS headless** (Decap CMS, ou Sveltia CMS) adossé au dépôt GitHub, servi dans `admin/`.

Pourquoi pas autre chose : pas de serveur nécessaire (tout est statique + données JSON dans le dépôt), coût nul, déploiement auto, et l'admin committe directement dans le même repo que le site.

## Architecture

```
index.html                 page unique (canvas plein écran + HUD)
public/
  data/works.json          données de la galerie (voir schéma ci-dessous)
  data/images/*.jpg        images des œuvres (uploadées par l'admin)
  favicon.svg
src/
  main.ts                  boot : chargement données, scène, boucle de rendu
  types.ts                 types Work / GalleryData
  style.css                HUD, panneau œuvre, lightbox, intro
  ui.ts                    HUD (progression, bannière de salle, panneau, lightbox, loader)
  gallery/
    layout.ts              placement des œuvres dans le hall (data-driven)
    scene.ts               renderer, salle (murs/sol/plafond), lumières, portails de salles
    paintings.ts           cadres + passe-partout + textures (chargement lazy)
    controls.ts            mode guidé (scroll) / mode libre (WASD + drag), raycast clic
    minimap.ts             plan 2D en overlay, cliquable
data/                      (réservé aux données éditées via l'admin — cf. schéma CMS)
docs/                      ce plan + guide de style
references/                tableaux de référence fournis par l'artiste
admin/                     (à venir) Decap CMS : index.html + config.yml
```

## Modèle de données

`public/data/works.json` :

```json
{
  "artist": "Eric Houvenagel",
  "rooms": [{ "id": "marines", "name": "Marines & Bretagne", "order": 1 }],
  "works": [
    {
      "id": "morbihan",
      "title": "Morbihan",
      "year": 2026,
      "medium": "Aquarelle sur papier 300 g et wax",
      "dimensions": "50 x 65 cm",
      "description": "La côte du Morbihan…",
      "room": "marines",
      "order": 2,
      "image": "data/images/morbihan.jpg",
      "ratio": 0.8824
    }
  ]
}
```

- `room` + `order` définissent la **salle** et la **position/ordre** d'accrochage : les œuvres sont triées par salle puis par ordre, et posées en alternance sur les murs gauche/droite du hall.
- `ratio` = largeur/hauteur de l'image, pour ne jamais déformer le tableau.
- **Évolution prévue (admin)** : un fichier JSON par œuvre dans `data/works/` + un `index.json`, géré par le CMS (collection « works »), avec médias dans `data/works/images/`. Le front lira `data/works/index.json`.

## La scène 3D

- **Un hall unique** (12 m de large, longueur calculée selon le nombre d'œuvres, hauteur 3,4 m), murs plâtre blanc cassé, sol chêne clair, plafond blanc. Les salles sont des **zones** du hall séparées par des portails en bois, avec bannière de nom affichée à l'entrée.
- **Tableaux** : cadre chêne + passe-partout blanc + image (texture). Hauteur d'accrochage 1,55 m. Barre lumineuse émissive au-dessus de chaque cadre.
- **Lumières** : hémisphère + directionnelle + `fog` ; ombres désactivées (perf mobile) ; les textures ont une légère émissive pour rester lisibles.

## Navigation (décision clé)

Deux modes, bascule par bouton (bouton « Explorer librement » visible uniquement sur pointeur fin) :

1. **Visite guidée (défaut, PC + mobile)** : la page fait défiler (espace de scroll invisible en hauteur) → la caméra avance le long d'un chemin fixe au centre du hall, avec `lookAt` interpolé automatiquement vers le prochain tableau. **L'orientation est donnée par le site.** Fonctionne nativement au scroll tactile sur mobile.
2. **Mode libre (desktop)** : drag pour regarder, WASD pour avancer, collisions = clamp dans le rectangle du hall. Échap pour revenir à la visite guidée.

Aides au repérage : **minimap 2D cliquable** (haut droite, avec position caméra et points des œuvres), **progression « œuvre k / n — salle »** en bas, **bannière de salle** à l'entrée de chaque zone, **boutons ‹ ›** et flèches clavier, **labels** via le panneau.

**Clic/tap sur un tableau** → scroll lisse jusqu'au point de vue frontal + **panneau latéral** (titre, année, médium, dimensions, description) + bouton **« Voir en grand »** → lightbox 2D plein écran (le détail se lit en 2D, pas en texture 3D).

## Performance

- `pixelRatio` plafonné à 2 (1 sur mobile bas de gamme via détection), `fog` pour le lointain.
- Textures : chargement **lazy** quand la caméra approche (seuil 16 m), `SRGBColorSpace`, anisotropie 4. **À venir** : compression KTX2 générée côté admin/build + vignettes WebP.
- Cibles : < 50 draw calls sur mobile (cadres en géométries partagées), `prefers-reduced-motion` respecté, fallback « no WebGL » affiché proprement, écran de chargement avec progression.

## Mode administrateur (sans code, sans IA)

- **Decap CMS** servi depuis `admin/` du site, collection « works » : image (upload), titre, année, médium, dimensions, description, salle (select), ordre (champ numérique, réordonnable par glisser-déposer côté liste).
- Backend GitHub : OAuth via git-gateway (micro-service gratuit, ex. Cloudflare Worker) **ou** Sveltia CMS avec flux PKCE sur une OAuth App GitHub (zéro serveur). Le CMS committe image + JSON dans le dépôt → Vercel redéploie le site automatiquement.
- **Fallback zéro-infra** : upload manuel de l'image dans `data/works/images/` + édition du JSON via l'interface GitHub (bouton « Edit »), possible depuis le mobile.

## Hébergement et limites (Vercel)

- Projet importé sur [vercel.com](https://vercel.com) depuis ce dépôt (privé, autorisé via l'app GitHub Vercel). Config dans `vercel.json` : preset Vite, build `npm run build`, output `dist`, rewrites SPA vers `index.html`. La base Vite reste `/` (pas de `VITE_BASE` nécessaire hors GitHub Pages).
- Branche de production : `vibe/repo-structure-5c40ea`. Chaque push redéploie automatiquement ; les PR reçoivent une URL de preview.
- URL : `https://<nom-du-projet>.vercel.app` (domaine perso gratuit ensuite dans les réglages Vercel).
- Limites (offre gratuite) : 100 Go de bande passante/mo, fonctions serverless limitées — largement suffisant pour un site d'artiste. Images compressées de toute façon (KTX2/WebP prévus).
- Bonus : les **fonctions serverless Vercel** (`api/`) pourront héberger plus tard le pont OAuth du CMS admin (git-gateway), sans serveur dédié.

## Roadmap

1. ✅ Squelette : scène 3D + galerie data-driven + 5 œuvres de démo + navigation guidée/libre + minimap + panneau + lightbox + déploiement continu Vercel.
2. ⏭️ Itération « admin » : `admin/` (Decap/Sveltia), schéma par-fichier `data/works/*.json`, upload image + réordonnancement.
3. ⏭️ Itération « mobile/perf » : contrôles tactiles affinés, KTX2/WebP, LOD, test sur vrais téléphones.
4. ⏭️ Itération « contenu » : remplacer les images de démo (captures Instagram rognées) par les photos originales des œuvres via l'admin ; bio de l'artiste, page « À propos », contact.
5. ⏭️ Domaine perso + SEO (Open Graph, sitemap, alt textes).

## Décisions ouvertes

- OAuth App GitHub (PKCE, zéro serveur) vs git-gateway (petit serveur gratuit) pour l'admin — à trancher à l'itération 2.
- Faut-il une version « salle unique très légère » pour les vieux mobiles, ou un fallback galerie 2D classique ? (Recommandation : fallback 2D si pas de WebGL.)
