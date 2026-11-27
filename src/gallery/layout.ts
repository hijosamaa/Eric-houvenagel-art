import type { GalleryData } from '../types';

export const HALL_WIDTH = 12;
export const HALL_HEIGHT = 3.4;
export const WALL_Y = 1.55;
export const SLOT_SPACING = 3.0;
export const Z_FIRST = 1.5;
export const Z_START = 5.5;
export const Z_END_MARGIN = 4.5;
export const VIEW_DIST = 2.6;

/**
 * Marge de la caméra au-delà des deux extrémités du hall — reprend les extrémités de
 * l'ancien tracé CatmullRom de controls.ts (Z_START + 1.2 → zEnd + 1.2).
 */
export const CAM_MARGIN = 1.2;

/** §4 de docs/design/rebuild.md : demi-largeur d'un palier « dwell », en fraction de l'écart inter-œuvres. */
export const DWELL_HALF = 0.08;

export interface PlacedWork {
  work: GalleryData['works'][number];
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  viewX: number;
  viewZ: number;
  scrollT: number;
  roomName: string;
  /**
   * Signe de la normale de la cimaise (direction x monde vers laquelle pointe le tableau).
   * +1 = tableau au mur gauche (x < 0), face tournée vers +x : c'est le cas livré, choisi
   * pour que « avancer » (scroll bas / bouton suivant) fasse défiler le contenu de la
   * droite vers la gauche à l'écran, comme une page qu'on tourne (voir docs/visite-structure.md).
   */
  faceX: 1 | -1;
}

export interface Zone {
  id: string;
  name: string;
  zMin: number;
  zMax: number;
}

export interface Layout {
  zEnd: number;
  pathX: number;
  placed: PlacedWork[];
  zones: Zone[];
}

export function hallBounds(layout: Layout): { zMin: number; zMax: number } {
  return { zMin: layout.zEnd - 2, zMax: Z_START + 3 };
}

export interface Portal {
  z: number;
  /** Index de la salle d'arrivée dans `layout.zones` (−1 si introuvable). */
  zoneIndex: number;
}

/**
 * Portails entre salles = frontières entre deux œuvres consécutives de salles
 * différentes (et PAS les `zones` brutes : une salle sans œuvre ne doit pas poser
 * de portail au début du hall). Consommé par `scene.ts` (géométrie) et
 * `physics.ts` (colliders) pour ne jamais diverger.
 */
export function portalPositions(layout: Layout): Portal[] {
  const out: Portal[] = [];
  const ps = layout.placed;
  for (let i = 0; i < ps.length - 1; i++) {
    if (ps[i].work.room !== ps[i + 1].work.room) {
      const zi = layout.zones.findIndex((z) => z.id === ps[i + 1].work.room);
      out.push({ z: (ps[i].z + ps[i + 1].z) / 2, zoneIndex: zi });
    }
  }
  return out;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** smoothstep : dérivée nulle aux deux bornes, raccord C1 avec les paliers du dwell. */
const smoothstep = (u: number): number => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};

/**
 * Courbe de « dwell » (§4 de docs/design/rebuild.md) — fonction pure, sans dépendance :
 * monotone [0,1] → [0,1], de dérivée nulle sur ±DWELL_HALF × (écart inter-œuvres) autour de
 * chaque `centers[i]`. Avec `camZ = lerp(zFirst, zLast, dwell(t))`, la caméra s'arrête
 * devant chaque œuvre et accélère entre deux, sans que le visiteur ait à arrêter de
 * scroller. Repli linéaire (`t => t`) en `prefers-reduced-motion`, côté appelant.
 */
export function createDwellCurve(centers: number[]): (t: number) => number {
  const cs = [...centers].sort((a, b) => a - b);
  const n = cs.length;
  if (n === 0) return (t) => clamp01(t);
  // Demi-largeur de palier : ±8 % de l'écart au voisin le plus proche, bornée à 45 % de cet
  // écart pour que deux paliers ne se chevauchent jamais (sinon plus monotone).
  const half = cs.map((c, i) => {
    const gap = Math.min(i > 0 ? c - cs[i - 1] : c, i < n - 1 ? cs[i + 1] - c : 1 - c);
    return Math.min(DWELL_HALF, 0.45) * gap;
  });
  return (t) => {
    const x = clamp01(t);
    let prevEnd = 0;
    let prevVal = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, cs[i] - half[i]);
      const b = Math.min(1, cs[i] + half[i]);
      if (x <= b) {
        if (x >= a) return cs[i]; // palier : la caméra est arrêtée devant l'œuvre i
        return prevVal + (cs[i] - prevVal) * smoothstep((x - prevEnd) / Math.max(1e-9, a - prevEnd));
      }
      prevEnd = b;
      prevVal = cs[i];
    }
    return prevVal + (1 - prevVal) * smoothstep((x - prevEnd) / Math.max(1e-9, 1 - prevEnd));
  };
}

/**
 * Trajet caméra du mode guidé : bornes z et positions linéaires t des œuvres sur ce trajet.
 * `camZ(t) = lerp(zFirst, zLast, dwell(t))` avec `dwell = createDwellCurve(centers)`.
 * (Les points de l'ancien tracé CatmullRom étaient colinéaires, x/y constants : son
 * `getPointAt(t)` produisait exactement ce lerp — aucun changement de comportement au repos.)
 */
export function cameraPath(layout: Layout): { zFirst: number; zLast: number; centers: number[] } {
  const zFirst = Z_START + CAM_MARGIN;
  const zLast = layout.zEnd + CAM_MARGIN;
  const span = zFirst - zLast;
  return { zFirst, zLast, centers: layout.placed.map((p) => (zFirst - p.viewZ) / span) };
}

export function computeLayout(data: GalleryData, viewDist = VIEW_DIST): Layout {
  const rooms = [...data.rooms].sort((a, b) => a.order - b.order);
  const roomIndexOf = (id: string): number => {
    const i = rooms.findIndex((r) => r.id === id);
    return i === -1 ? rooms.length : i;
  };
  const roomNameOf = (id: string): string => rooms.find((r) => r.id === id)?.name ?? id;
  const works = [...data.works].sort(
    (a, b) => roomIndexOf(a.room) - roomIndexOf(b.room) || a.order - b.order,
  );
  const zLast = Z_FIRST - Math.max(0, works.length - 1) * SLOT_SPACING;
  const zEnd = zLast - Z_END_MARGIN;
  // Chemin caméra côté mur des œuvres (gauche) : avancer = regarder vers -x, donc
  // screen-right = -z = direction de la visite → le contenu défile droite → gauche.
  const pathX = -((HALL_WIDTH / 2 - viewDist) * 0.8);

  const placed: PlacedWork[] = works.map((work, i) => {
    const z = Z_FIRST - i * SLOT_SPACING;
    let w = 1.5 * work.ratio;
    let h = 1.5;
    if (w > 2.4) {
      w = 2.4;
      h = w / work.ratio;
    }
    return {
      work,
      x: -(HALL_WIDTH / 2 - 0.08),
      y: WALL_Y,
      z,
      w,
      h,
      viewX: -(HALL_WIDTH / 2 - viewDist),
      viewZ: z,
      scrollT: 0,
      roomName: roomNameOf(work.room),
      faceX: 1,
    };
  });

  const zones: Zone[] = rooms.map((room) => {
    const zs = placed.filter((p) => p.work.room === room.id).map((p) => p.z);
    if (zs.length === 0) return { id: room.id, name: room.name, zMin: Z_START, zMax: Z_START };
    return {
      id: room.id,
      name: room.name,
      zMin: Math.min(...zs) - SLOT_SPACING / 2,
      zMax: Math.max(...zs) + SLOT_SPACING / 2,
    };
  });

  return { zEnd, pathX, placed, zones };
}
