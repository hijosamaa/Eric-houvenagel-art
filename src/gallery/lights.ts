/**
 * Lumière de la galerie — paramètres cibles de l'audit 3D §3.1 (P1-1 → P1-5) et
 * contrôleur du pool de spots de tableau (hystérésis + fondu 350 ms, P1-4).
 *
 * `main.ts` ne doit plus positionner les spots « à la main » : il appelle
 * `spots.update(camZ, layout.placed, dt)` une fois par frame (voir
 * docs/design/3d-integration.md). Tant que ce branchement n'est pas fait, l'ancienne
 * boucle continue de fonctionner : les spots créés ici portent déjà les bons cône /
 * décroissance / couleur, et leurs ombres sont isolées du toit (layer ROOF_LAYER).
 */
import * as THREE from 'three';

import { FRAME_METRICS } from './frames';

import type { PlacedWork } from './layout';

/**
 * Couche réservée au toit (dalle à trémie, meneaux, traverses, verrière).
 *
 * Intérêt double :
 *  1. la caméra et la shadow map du soleil voient la couche 0 **et** la couche 1, donc la
 *     trémie projette bien sa trame au sol ;
 *  2. les shadow maps des spots sont réglées sur un masque « couche 0 + couche 2 »
 *     et n'ont donc pas à rastériser les ~20 objets du toit — qui, dans l'ancienne
 *     position des spots (au-dessus de la dalle), les auraient de toute façon occultés.
 *
 * three 0.187 : une light shadow camera dont le masque vaut exactement la couche 0
 * retombe sur les layers de la caméra principale (`three.module.js:9138`) ; il faut donc
 * lui donner un masque non trivial, d'où la couche 2 (inutilisée par des objets).
 */
export const ROOF_LAYER = 1;
/** Couche technique servant uniquement à « déverrouiller » le masque des shadow maps de spots. */
export const SPOT_SHADOW_LAYER = 2;

/** Hémisphérique « jour » : ciel bleuté doux, sol chaud — lumière naturelle ambiante. */
export const HEMI = {
  sky: 0xdae7f5,
  ground: 0xe8e1d3,
  intensity: 0.26,
  /** Repli mobile (pas de RectAreaLight) : un peu plus haut pour compenser. */
  coarseIntensity: 0.46,
} as const;

/** Soleil « plein jour » : blanc chaud, assez puissant pour la trame de la verrière. */
export const SUN = {
  color: 0xfff0da,
  intensity: 2.0,
  /**
   * Élévation ≈ 50° : la tache de soleil s'allonge et vient mourir au pied du mur des
   * toiles sans l'atteindre (mise en lumière rasante, et conservation : une aquarelle
   * ne reçoit pas de soleil direct). À 77° la tache tombait à la verticale sous la
   * verrière (aucune trame lisible) ; à 37° elle frappait les œuvres.
   */
  position: { x: 3.1, y: 12, z: -8.6 },
  shadow: {
    /** 3072 → 0,52 cm/texel sur une fenêtre ±8 × ±11 m. */
    mapSize: 3072,
    mapSizeCoarse: 2048,
    /**
     * Demi-fenêtre en **espace lumière** : avec un soleil oblique, l'axe « up » de la
     * caméra d'ombre n'est plus l'axe Z monde, donc une fenêtre de 11 m ne couvrait que
     * ~14 m de sol — les ombres s'arrêtaient net au milieu du hall.
     */
    halfX: 9,
    halfZ: 21,
    /** Quantification de la fenêtre : supprime le shadow swimming (P1-2). */
    quantum: 0.5,
    bias: -0.0002,
    normalBias: 0.008,
    /**
     * Rayon de pénombre en texels (PCFShadowMap). 3072 texels sur ±8 m → 5,2 mm/texel :
     * radius 14 ≈ 7 cm de pénombre, ce qui est l'ordre de grandeur réel sous une verrière
     * de 5 m de large (la source a un diamètre angulaire énorme).
     */
    radius: 26,
  },
} as const;

/** Ciel diffus de la trémie (substitut de ciel, sans ombre ni CSM). Desktop uniquement. */
export const SKY_FILL = {
  color: 0xeef5fd,
  intensity: 0.55,
  width: 5.4,
  height: 26,
  y: 3.24,
  /** `false` = pas de RectAreaLight du tout (mobile, ou si la mesure impose de couper). */
  enabled: true,
} as const;

/** Spots « tableau » : un par œuvre, dans le luminaire (P0-2 / P1-5). */
export const TABLE_SPOT = {
  color: 0xffe3bb,
  /**
   * Candélas. L'appareil est à 1,05 m de la toile : 1,35 cd / 1,05² ≈ 1,2 d'irradiance.
   * L'ancienne valeur (1,8) avec un appareil à 9 cm du mur brûlait le mur AU-DESSUS du
   * cadre (la tache blanche visible sur les captures) au lieu de laver la toile.
   */
  intensity: 1.15,
  distance: 6,
  /**
   * Cône calculé pour couvrir la toile : demi-angle ≈ atan(0,9 / 1,05) ≈ 0,71 rad.
   * Pénombre maximale : aucun bord de cône visible sur un mur clair.
   */
  angle: 0.68,
  penumbra: 1.0,
  decay: 2.0,
  /** Le survol est porté par la lumière, plus par l'émissif de la toile (P0-3). */
  hoverBoost: 0.5,
  /** Hystérésis d'affectation : un spot installé ne bouge pas pour moins de 1,2 m. */
  hysteresis: 1.2,
  /** Fondu d'allumage / extinction, en secondes (800 ms : aucun clignotement visible). */
  fade: 0.8,
  /**
   * Modulation douce par distance : un spot du pool pointé sur une œuvre éloignée
   * brille moins (jamais à 0) → la lumière glisse d'un tableau à l'autre au lieu
   * de sauter (le « tout ou rien » à 1 spot mobile était illisible).
   */
  distFadeMin: 0.45,
  distFadeRange: 7,
  shadowMapSize: 512,
  shadowNear: 0.05,
} as const;

/** Rampe d'allumage (smoothstep) : évite un front linéaire visible sur un mur clair. */
function ease(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

export interface TableSpotsOptions {
  /** Nombre de spots actifs (3 desktop / 1 mobile). */
  count: number;
  /** Ombres : projetées uniquement par le premier slot (coût, P1-4). */
  shadows: boolean;
}

/**
 * Pool de spots à état : chaque slot a une œuvre affectée, un fondu et une hystérésis.
 * Aucune allocation par frame (les tableaux de travail sont alloués au constructeur).
 */
export class TableSpots {
  readonly pool: THREE.SpotLight[] = [];
  /** Index (dans `layout.placed`) de l'œuvre survolée, ou −1. */
  hoverIndex = -1;

  private readonly assigned: Int32Array;
  private readonly blend: Float32Array;
  private readonly bestIdx: Int32Array;
  private readonly bestDist: Float64Array;
  private readonly shadows: boolean;

  constructor(scene: THREE.Scene, opts: TableSpotsOptions) {
    const n = Math.max(1, opts.count);
    this.shadows = opts.shadows;
    this.assigned = new Int32Array(n).fill(-1);
    this.blend = new Float32Array(n);
    this.bestIdx = new Int32Array(n);
    this.bestDist = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = new THREE.SpotLight(
        TABLE_SPOT.color,
        0,
        TABLE_SPOT.distance,
        TABLE_SPOT.angle,
        TABLE_SPOT.penumbra,
        TABLE_SPOT.decay,
      );
      s.castShadow = false;
      s.shadow.mapSize.set(TABLE_SPOT.shadowMapSize, TABLE_SPOT.shadowMapSize);
      s.shadow.camera.near = TABLE_SPOT.shadowNear;
      s.shadow.camera.far = TABLE_SPOT.distance;
      s.shadow.bias = -0.0006;
      s.shadow.normalBias = 0.004;
      // Masque non trivial → la shadow map n'utilise pas les layers de la caméra (voir ROOF_LAYER).
      s.shadow.camera.layers.set(0);
      s.shadow.camera.layers.enable(SPOT_SHADOW_LAYER);
      scene.add(s);
      scene.add(s.target);
      this.pool.push(s);
    }
  }

  /**
   * Met à jour les spots. Renvoie `true` si une affectation a changé (utile pour
   * invalider les shadow maps quand elles sont mises à jour à la demande).
   */
  update(camZ: number, placed: PlacedWork[], dt: number): boolean {
    const n = this.pool.length;
    if (placed.length === 0) {
      for (let i = 0; i < n; i++) {
        this.pool[i].intensity = 0;
        this.blend[i] = 0;
        this.assigned[i] = -1;
      }
      return false;
    }

    // Sélection des n plus proches avec bonus d'hystérésis pour les slots déjà installés.
    for (let i = 0; i < n; i++) {
      this.bestDist[i] = Infinity;
      this.bestIdx[i] = -1;
    }
    for (let j = 0; j < placed.length; j++) {
      let d = Math.abs(placed[j].z - camZ);
      for (let i = 0; i < n; i++) {
        if (this.assigned[i] === j && this.blend[i] > 0) d -= TABLE_SPOT.hysteresis;
      }
      for (let i = 0; i < n; i++) {
        if (d < this.bestDist[i]) {
          for (let k = n - 1; k > i; k--) {
            this.bestDist[k] = this.bestDist[k - 1];
            this.bestIdx[k] = this.bestIdx[k - 1];
          }
          this.bestDist[i] = d;
          this.bestIdx[i] = j;
          break;
        }
      }
    }

    const rate = dt / TABLE_SPOT.fade;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const desired = this.bestIdx[i];
      if (this.assigned[i] !== desired) {
        if (this.blend[i] > 0) {
          this.blend[i] = Math.max(0, this.blend[i] - rate);
          if (this.blend[i] === 0) {
            this.assigned[i] = desired;
            changed = true;
          }
        } else {
          this.assigned[i] = desired;
          changed = true;
        }
      } else if (this.blend[i] < 1) {
        this.blend[i] = Math.min(1, this.blend[i] + rate);
      }
      const s = this.pool[i];
      const idx = this.assigned[i];
      if (idx < 0) {
        s.intensity = 0;
        continue;
      }
      const p = placed[idx];
      // le spot est décalé du mur dans la direction de la normale du tableau (faceX)
      s.position.set(p.x + p.faceX * FRAME_METRICS.spotZ, p.y + FRAME_METRICS.spotY, p.z);
      s.target.position.set(p.x + p.faceX * 0.06, p.y + FRAME_METRICS.targetY, p.z);
      s.target.updateMatrixWorld();
      // fondu d'affectation × atténuation douce par distance : jamais de coupure nette
      const d = Math.abs(p.z - camZ);
      const distFade = Math.min(1, Math.max(TABLE_SPOT.distFadeMin, 1.25 - d / TABLE_SPOT.distFadeRange));
      s.intensity =
        (TABLE_SPOT.intensity + (idx === this.hoverIndex ? TABLE_SPOT.hoverBoost : 0)) * ease(this.blend[i]) * distFade;
      // Le premier slot projette, les autres non (1 seule passe d'ombre de spot).
      s.castShadow = this.shadows && i === 0 && this.blend[i] > 0.5;
    }
    return changed;
  }

  /** Réinitialise les slots (fondu à zéro, aucune œuvre affectée). */
  reset(): void {
    for (let i = 0; i < this.pool.length; i++) {
      this.assigned[i] = -1;
      this.blend[i] = 0;
      this.pool[i].intensity = 0;
      this.pool[i].castShadow = false;
    }
  }

  dispose(): void {
    for (const s of this.pool) {
      s.dispose();
      s.target.removeFromParent();
      s.removeFromParent();
    }
    this.pool.length = 0;
  }
}

/**
 * Fenêtre d'ombre du soleil : ±8 × ±11 m autour de la caméra, quantifiée à 0,5 m.
 * À appeler une fois par frame à la place du calcul brut de `main.ts` (`camZ ± 16`) :
 * la quantification supprime le shadow swimming (P1-2) et la fenêtre plus serrée divise
 * le texel par ~2. La **position** du soleil suit la même quantification pour que sa
 * direction reste constante (l'ancien code ne bougeait que la cible : le soleil basculait
 * de ~40° entre les deux extrémités de la salle).
 * Renvoie `true` quand la fenêtre a effectivement bougé.
 */
export function updateSunShadow(sun: THREE.DirectionalLight, camZ: number): boolean {
  const q = Math.round(camZ / SUN.shadow.quantum) * SUN.shadow.quantum;
  const cam = sun.shadow.camera;
  if (Math.abs(sun.target.position.z - q) < 1e-4) return false;
  sun.target.position.set(0, 0, q);
  sun.position.set(SUN.position.x, SUN.position.y, q + SUN.position.z);
  cam.top = SUN.shadow.halfZ;
  cam.bottom = -SUN.shadow.halfZ;
  cam.left = -SUN.shadow.halfX;
  cam.right = SUN.shadow.halfX;
  cam.updateProjectionMatrix();
  return true;
}
