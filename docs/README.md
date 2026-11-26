# Documentation

| Fichier / dossier | Rôle |
|---|---|
| `plan.md`, `plan-dev-v2.md` | plan d'implémentation du site (stack, architecture, mode administrateur) |
| `style-guide.md` | décisions de style d'origine (palette, typographie, ambiance de la galerie 3D) |
| `admin.md` | mise en place du CMS (Decap + OAuth GitHub) |
| `analyse-outils-v2.md`, `mcp.md`, `textures-precalc.md` | notes d'outillage et de build |
| `revue-*.md`, `inspiration.md` | revues successives et veille |
| **`design/`** | **audit + système de design + maquettes de la refonte (branche `design/direction-v3`)** |

## `design/` — audit et propositions

- [`design/audit-ui.md`](design/audit-ui.md) — audit mesuré du chrome, liste des 11 éléments à supprimer (`fichier:ligne`), plan d'application.
- [`design/audit-3d.md`](design/audit-3d.md) — audit du rendu 3D (cadres, luminaires, lumière) + plan AO / bloom / TAA / grain et garde-fous de performance.
- [`design/proposals/`](design/proposals/) — trois directions de chrome (A « Salle blanche », B « Cartel », C « Plein cadre »), la fiche d'œuvre recomposée, les étalonnages 3D et le comparatif cadres/luminaires, en maquettes HTML + captures.

Le système de design cible (tokens, échelle typographique, rayons, mouvement) est dans
[`../DESIGN.md`](../DESIGN.md), à la racine du dépôt.
