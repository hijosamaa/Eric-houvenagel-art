/**
 * Lumière de la galerie — paramètres cibles de l'audit 3D §3.1 (P1-1 → P1-5) et
 * contrôleur du pool de spots de tableau (hystérésis + fondu 350 ms, P1-4).
 *
 * `main.ts` ne doit plus positionner les spots « à la main » : il appelle
 * `spots.update(cam, layout.placed, dt)` une fois par frame (voir
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
  sky: 0xe4e6e2,
  // Rebond du parquet vers les sous-faces : c'est la seule lumière qui atteint une dalle
  // (elle regarde le sol). Sans ce terme, le plafond tombait à 80 % de la valeur des murs
  // ET franchement chaud — il lisait comme du contreplaqué sur un tiers de l'image.
  ground: 0xf1eee6,
  /**
   * 0,24 (et 0,3 sur mobile, privé de RectAreaLight). À 0,34 l'ambiante portait le sol
   * du sas à 200/255 même à l'ombre : la tache de soleil sous la verrière ne se lisait
   * plus, et les pièces n'avaient aucun contraste (p05 = 127, aucune valeur sombre).
   */
  intensity: 0.2,
  /** Repli mobile (pas de RectAreaLight) : un peu plus haut pour compenser. */
  coarseIntensity: 0.24,
} as const;

/** Soleil « plein jour » : blanc chaud, assez puissant pour la trame de la verrière. */
export const SUN = {
  color: 0xfff0da,
  /** 3,2 : la trame de la verrière doit se dessiner au sol, pas seulement l'éclairer. */
  intensity: 3.2,
  /**
   * Élévation ≈ 50° : la tache de soleil s'allonge et vient mourir au pied du mur des
   * toiles sans l'atteindre (mise en lumière rasante, et conservation : une aquarelle
   * ne reçoit pas de soleil direct). À 77° la tache tombait à la verticale sous la
   * verrière (aucune trame lisible) ; à 37° elle frappait les œuvres.
   */
  position: { x: 3.1, y: 12, z: -8.6 },
  shadow: {
    /**
     * 4096 sur une fenêtre ±15 × ±16 m (espace lumière) → 0,73 cm/texel.
     *
     * La fenêtre précédente (±9 × ±21 m) datait du couloir : elle ne couvrait que 18 m en
     * travers, donc les salles Est et Ouest (bâti de 26 × 28 m) sortaient du champ et
     * perdaient leurs ombres — la dalle cessait de projeter la trame de la verrière au sol.
     */
    mapSize: 4096,
    mapSizeCoarse: 2048,
    /**
     * Demi-fenêtre en **espace lumière** : avec un soleil oblique, l'axe « up » de la
     * caméra d'ombre n'est plus l'axe Z monde, donc une fenêtre de 11 m ne couvrait que
     * ~14 m de sol — les ombres s'arrêtaient net au milieu du hall.
     */
    halfX: 15,
    halfZ: 16,
    /** Quantification de la fenêtre : supprime le shadow swimming (P1-2). */
    quantum: 0.5,
    bias: -0.0002,
    normalBias: 0.008,
    /**
     * Rayon de pénombre en texels (PCFShadowMap). 3072 texels sur ±8 m → 5,2 mm/texel :
     * radius 14 ≈ 7 cm de pénombre, ce qui est l'ordre de grandeur réel sous une verrière
     * de 5 m de large (la source a un diamètre angulaire énorme).
     */
    radius: 8,
  },
} as const;

/** Ciel diffus de la trémie (substitut de ciel, sans ombre ni CSM). Desktop uniquement. */
export const SKY_FILL = {
  color: 0xf4f1e6,
  /**
   * Une seule `RectAreaLight` suit la pièce où se trouve la caméra. L'ancienne version en
   * posait une, fixe, de 5,4 × 26 m au centre du hall : depuis que le plan est un sas de
   * 12 × 12 entouré de trois salles, elle éclairait le sas **entier** sans aucune occlusion
   * (RectAreaLight ne projette pas d'ombre) — le sas devenait un studio blanc à 154 de
   * luminance moyenne et le soleil n'y dessinait plus rien.
   */
  intensity: 0.34,
  /** Fondu lors du passage d'une pièce à l'autre (s). */
  fade: 0.45,
  /** `false` = pas de RectAreaLight du tout (mobile, ou si la mesure impose de couper). */
  enabled: true,
} as const;

/**
 * Place le ciel diffus sous la verrière de la pièce où se trouve la caméra.
 *
 * `RectAreaLight` n'émet que dans son demi-espace : on la couche donc à plat sous la
 * dalle, orientée vers le bas, à la taille exacte de la trémie. Elle éclaire ainsi comme
 * le ciel qu'elle remplace — un rectangle de lumière qui tombe du plafond, et non un
 * projecteur de studio posé au milieu du volume.
 *
 * Renvoie la pièce retenue (utile aux tests) ; `null` si la caméra est hors du bâti.
 */
export function updateSkyFill(
  light: THREE.RectAreaLight,
  rooms: { id: string; rect: { x0: number; z0: number; x1: number; z1: number }; height: number; shell: { skyW: number; skyL: number }; inZ: number }[],
  cam: { x: number; z: number },
  dt: number,
): string | null {
  // 1. pièce qui contient la caméra, sinon la plus proche (on traverse une baie : la
  //    caméra est brièvement « dans le mur », il ne faut pas que le ciel s'éteigne).
  let room: (typeof rooms)[number] | null = null;
  let best = Infinity;
  for (const r of rooms) {
    const inside = cam.x > r.rect.x0 && cam.x < r.rect.x1 && cam.z > r.rect.z0 && cam.z < r.rect.z1;
    const dx = Math.max(r.rect.x0 - cam.x, 0, cam.x - r.rect.x1);
    const dz = Math.max(r.rect.z0 - cam.z, 0, cam.z - r.rect.z1);
    const d = inside ? -1 : Math.hypot(dx, dz);
    if (d < best) {
      best = d;
      room = r;
    }
  }
  if (!room) return null;

  // 2. taille de la trémie dans le repère du monde (la verrière court dans l'axe de la
  //    pièce : largeur = skyW dans l'axe transversal).
  const alongZ = room.inZ !== 0;
  const w = alongZ ? room.shell.skyW : room.shell.skyL;
  const h = alongZ ? room.shell.skyL : room.shell.skyW;
  if (light.userData.roomId !== room.id) {
    light.userData.roomId = room.id;
    light.intensity = 0;
    light.width = w;
    light.height = h;
    light.position.set(
      (room.rect.x0 + room.rect.x1) / 2,
      room.height - 0.14,
      (room.rect.z0 + room.rect.z1) / 2,
    );
  }
  // 3. fondu : un saut d'intensité se lit comme un claquement d'interrupteur.
  const target = SKY_FILL.intensity;
  const k = Math.min(1, dt / Math.max(0.001, SKY_FILL.fade));
  light.intensity += (target - light.intensity) * k;
  return room.id;
}

/** Spots « tableau » : un par œuvre, dans le luminaire (P0-2 / P1-5). */
export const TABLE_SPOT = {
  color: 0xffe3bb,
  /**
   * Candélas. L'appareil est à 1,05 m de la toile : 1,35 cd / 1,05² ≈ 1,2 d'irradiance.
   * L'ancienne valeur (1,8) avec un appareil à 9 cm du mur brûlait le mur AU-DESSUS du
   * cadre (la tache blanche visible sur les captures) au lieu de laver la toile.
   */
  /**
   * 4,0 cd. Mesure d'attribution (audit rendu §1) : à 1,15 les six spots n'ajoutaient que
   * +8 niveaux à la toile visée, soit rien — une œuvre de papier ressortait 31 niveaux
   * PLUS SOMBRE que le mur qui la porte. À 4,0 la toile est le point le plus clair du mur.
   */
  intensity: 4.0,
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
  distFadeMin: 0.7,
  distFadeRange: 7,
  shadowMapSize: 1024,
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
  update(cam: { x: number; z: number }, placed: PlacedWork[], dt: number): boolean {
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
      let d = Math.hypot(placed[j].viewX - cam.x, placed[j].viewZ - cam.z);
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
      // le spot est décalé du mur dans la direction de la normale de la toile
      s.position.set(
        p.x + p.nx * FRAME_METRICS.spotZ,
        p.y + FRAME_METRICS.spotY,
        p.z + p.nz * FRAME_METRICS.spotZ,
      );
      s.target.position.set(
        p.x + p.nx * 0.06,
        p.y + FRAME_METRICS.targetY,
        p.z + p.nz * 0.06,
      );
      s.target.updateMatrixWorld();
      // fondu d'affectation × atténuation douce par distance : jamais de coupure nette
      const d = Math.hypot(p.viewX - cam.x, p.viewZ - cam.z);
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
export function updateSunShadow(sun: THREE.DirectionalLight, cam: { x: number; z: number }): boolean {
  const q = SUN.shadow.quantum;
  const qx = Math.round(cam.x / q) * q;
  const qz = Math.round(cam.z / q) * q;
  const sc = sun.shadow.camera;
  if (Math.abs(sun.target.position.x - qx) < 1e-4 && Math.abs(sun.target.position.z - qz) < 1e-4) {
    return false;
  }
  sun.target.position.set(qx, 0, qz);
  sun.position.set(qx + SUN.position.x, SUN.position.y, qz + SUN.position.z);
  sc.top = SUN.shadow.halfZ;
  sc.bottom = -SUN.shadow.halfZ;
  sc.left = -SUN.shadow.halfX;
  sc.right = SUN.shadow.halfX;
  sc.updateProjectionMatrix();
  return true;
}
