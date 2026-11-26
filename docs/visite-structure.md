# Structure de la visite — analyse et décision

Date : 2026-11-26. Concerne `src/gallery/layout.ts`, `controls.ts`, `scene.ts`, `physics.ts`.

## 1. Sens de déplacement (corrigé)

**Symptôme** : scroll vers le bas → le contenu partait vers la **gauche** à l'écran,
le bouton « suivant » (chevron droit) avançait aussi vers la gauche.

**Cause** (calcul vérifié avec three 0.187) : `screen-right = cross(forward, up)`.
Avec les tableaux au mur **droit** (x=+5,92) et la caméra à x=+2,52, `forward ≈ +x`
donc `screen-right ≈ +z` : avancer (z décroissant) = déplacement apparent vers la
**gauche** (`dot((0,0,-1), right) = -0,915`).

**Correction livrée** : tous les tableaux passent au mur **gauche** (x=-5,92,
`faceX = +1`, `rotation.y = +π/2`), le chemin caméra reste côté gauche
(`pathX ≈ -2,52`). Alors `forward ≈ -x`, `screen-right ≈ -z` et
`dot((0,0,-1), right) = +0,915` : **la direction d'avance se projette vers la droite
à l'écran** — le contenu défile donc de la droite vers la gauche quand on scrolle,
les nouveautés entrent par la droite, comme une page qu'on tourne. C'est cohérent
avec le chevron « suivant » (droite) et le sens de lecture. Le signe reste stable
tant que la caméra reste à droite du mur des œuvres (garanti par le clamp
`|x| ≤ 5,5` et `viewX ≥ -3,15`).

## 2. Une grande pièce, ou plusieurs salles ? (analyse à N catégories × ~10 œuvres)

Hypothèse à terme : ~3–4 catégories, ~10 œuvres chacune → ~30–40 œuvres.
À `SLOT_SPACING = 3 m`, un hall unilatéral fait **~90–120 m** ; le scroll-spacer
vaut `(N×1,15+1,8)×100vh` (~37 écrans à 30 œuvres — un défilement continu fluide,
~0,85 œuvre par écran).

| Option | Sens à l'écran | Coût/perf | Verdict |
|---|---|---|---|
| Zigzag murs alternés | s'inverse à chaque œuvre (146° de balayage caméra) | identique | **rejeté** : pire que le bug |
| Salles fermées (mur + porte) | stable | courbe caméra à réécrire (entonnoirs), minimap 2D, +2 murs/salle ; le frustum culling rend le bénéfice nul | **rejeté** |
| Plusieurs halls (reload) | stable par hall | casse le scroll continu, re-init LRU/état | **rejeté** |
| **Un grand hall, accrochage unilatéral (mur gauche) + portails ouverts entre salles** | **stable (+0,915)** | tout est déjà linéaire en z (minimap, LRU ±16/30 m, fenêtre d'ombre, spots, physique, `?dup=N`) | **retenu** |

**Décision retenue** : une seule grande « enfilade », une seule paroi d'accrochage
(mur gauche), et les **portails ouverts** existants entre zones (`portalPositions`,
calculés sur les frontières entre œuvres de salles différentes — une salle vide ne pose
pas de portail). Séparation visuelle par salle : tapis dédié, plaque laiton sur le
linteau, socle au centre, plantes de part et d'autre du portail.

Améliorations structurelles livrées avec ce choix :

- **Brouillard adaptatif** : `density = clamp(0,33/len, 0,004, 0,02)` → ~12 % de voile
  au fond quelle que soit la longueur (à densité fixe, 100 m = 91 % de voile).
- **Atlas de cartels** : 2048 (64 œuvres) → 4096 (256 œuvres) au-delà, plus de cartel blanc.
- **Fenêtre d'ombre du soleil** : `updateSunShadow()` (quantification 0,5 m) enfin branchée
  dans `tick()` — corrige le shadow swimming signalé dans l'audit P1-2.
- **Focus mode libre** : waypoint `(pathX, p.z)` avant la cible, pour ne pas traverser
  les portails en ligne droite.

Si un jour une catégorie dépasse ~15 œuvres, découper en deux salles reste possible
sans changer le code : il suffit d'ajouter une entrée dans `data/rooms/`.
