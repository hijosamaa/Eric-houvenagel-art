import type { GalleryData } from '../types';

/**
 * Plan du lieu — une **enfilade** de salles le long de −z.
 *
 * Ce qui a changé et pourquoi : avec 30 œuvres sur un seul mur, le hall mesurait 90 m et
 * le visiteur traversait une seule nef interminable. Les œuvres sont maintenant
 * **en vis-à-vis** (un mur sur deux, alterné) dans des salles larges de 8,6 m, et le
 * parcours traverse **un sas d'entrée puis trois salles** aux plafonds différents.
 * Résultat : 30 œuvres tiennent en 84 m répartis en volumes distincts, et la caméra
 * regarde tantôt à gauche tantôt à droite au lieu de fixer un mur unique.
 */

/** Largeur des salles (m) : 8,6 m = 3,4 m entre l'œil et la toile quand on est décalé. */
export const HALL_WIDTH = 8.6;
/** Hauteur maximale (m) — la plus haute salle. */
export const HALL_HEIGHT = 4.15;
/** Hauteur des yeux / de la ligne des œuvres. */
export const WALL_Y = 1.55;
/** Pas entre deux œuvres successives (m) — elles alternent de mur. */
export const SLOT_SPACING = 2.8;
export const Z_FIRST = 1.6;
/** z de départ (dans le sas, avant la première œuvre). */
export const Z_START = 6.4;
/** Longueur du sas d'entrée. */
export const LOBBY_LEN = 5.2;
export const Z_END_MARGIN = 4.2;
export const VIEW_DIST = 3.3;

/** Marge caméra au-delà des extrémités. */
export const CAM_MARGIN = 1.1;

/** §4 de docs/design/rebuild.md : demi-largeur d'un palier « dwell ». */
export const DWELL_HALF = 0.08;

/** Profil d'une salle : c'est ce qui donne sa personnalité au volume. */
export interface RoomShell {
  /** Hauteur sous dalle (m). */
  height: number;
  /** Largeur de la verrière (0 = pas de verrière). */
  skyWidth: number;
  /** Longueur de la verrière, en fraction de la salle. */
  skyRatio: number;
  /** Nombre de poutres transversales dans la salle. */
  beams: number;
}

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
  /** Signe de la normale de la toile : +1 = mur gauche (x < 0), −1 = mur droit. */
  faceX: 1 | -1;
}

export interface Zone {
  id: string;
  name: string;
  zMin: number;
  zMax: number;
  /** True pour le sas d'entrée (pas une salle d'accrochage). */
  lobby?: boolean;
  shell: RoomShell;
}

export interface Layout {
  zEnd: number;
  pathX: number;
  placed: PlacedWork[];
  zones: Zone[];
  /** z où commence le sas (entrée) et où finit la dernière salle. */
  zFront: number;
  zBack: number;
}

export function hallBounds(layout: Layout): { zMin: number; zMax: number } {
  return { zMin: layout.zBack, zMax: layout.zFront };
}

/** Position x de la caméra guidée pour un z donné : elle se décale vers le mur de l'œuvre courante. */
export function pathXAt(layout: Layout, z: number): number {
  const ps = layout.placed;
  if (ps.length === 0) return 0;
  // ps est trié par z décroissant : trouver l'encadrement.
  let lo = 0;
  let hi = ps.length - 1;
  // devant la première œuvre (dans le sas) et derrière la dernière, la caméra revient sur
  // l'axe : sinon elle longe le trumeau du seuil et le cadre du passage masque la vue.
  const ramp = (d: number): number => Math.min(1, Math.max(0, 1 - d / 2.2));
  if (z >= ps[0].z) return ps[0].viewX * ramp(z - ps[0].z);
  if (z <= ps[hi].z) return ps[hi].viewX * ramp(ps[hi].z - z);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ps[mid].z > z) lo = mid;
    else hi = mid;
  }
  const a = ps[lo];
  const b = ps[hi];
  const t = (a.z - z) / Math.max(1e-6, a.z - b.z);
  const s = t * t * (3 - 2 * t);
  return a.viewX + (b.viewX - a.viewX) * s;
}

export interface Portal {
  z: number;
  zoneIndex: number;
  /** Hauteur sous linteau du passage (m). */
  openingH: number;
  /** Demi-largeur du passage (m). */
  openingHalf: number;
  /** Hauteur du mur au-dessus du passage (m) — la salle la plus haute impose la retombée. */
  height: number;
}

/** Portails = frontières entre deux zones consécutives (le sas en est une). */
export function portalPositions(layout: Layout): Portal[] {
  const out: Portal[] = [];
  const zs = layout.zones;
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i];
    const b = zs[i + 1];
    out.push({
      z: (a.zMin + b.zMax) / 2,
      zoneIndex: i + 1,
      openingH: 2.72,
      openingHalf: b.lobby || a.lobby ? 1.55 : 1.35,
      height: Math.max(a.shell.height, b.shell.height),
    });
  }
  return out;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** smoothstep : dérivée nulle aux bornes, raccord C1 avec les paliers du dwell. */
const smoothstep = (u: number): number => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};

/**
 * Courbe de « dwell » : monotone [0,1] → [0,1], de dérivée nulle autour de chaque
 * `centers[i]`. `camZ = lerp(zFirst, zLast, dwell(t))` arrête la caméra devant chaque œuvre.
 */
export function createDwellCurve(centers: number[]): (t: number) => number {
  const cs = [...centers].sort((a, b) => a - b);
  const n = cs.length;
  if (n === 0) return (t) => clamp01(t);
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
        if (x >= a) return cs[i];
        return prevVal + (cs[i] - prevVal) * smoothstep((x - prevEnd) / Math.max(1e-9, a - prevEnd));
      }
      prevEnd = b;
      prevVal = cs[i];
    }
    return prevVal + (1 - prevVal) * smoothstep((x - prevEnd) / Math.max(1e-9, 1 - prevEnd));
  };
}

export function cameraPath(layout: Layout): { zFirst: number; zLast: number; centers: number[] } {
  const zFirst = layout.zFront - CAM_MARGIN;
  const zLast = layout.zBack + CAM_MARGIN;
  const span = zFirst - zLast;
  return { zFirst, zLast, centers: layout.placed.map((p) => (zFirst - p.viewZ) / span) };
}

/** Personnalité des salles — indexée par ordre de salle (0 = première salle d'accrochage). */
const SHELLS: RoomShell[] = [
  { height: 3.55, skyWidth: 2.5, skyRatio: 0.62, beams: 2 },
  { height: 4.15, skyWidth: 3.1, skyRatio: 0.5, beams: 3 },
  { height: 3.3, skyWidth: 2.2, skyRatio: 0.66, beams: 2 },
  { height: 3.85, skyWidth: 2.8, skyRatio: 0.55, beams: 2 },
];

const LOBBY_SHELL: RoomShell = { height: 3.1, skyWidth: 1.5, skyRatio: 0.5, beams: 0 };

export function computeLayout(data: GalleryData, _viewDist = VIEW_DIST): Layout {
  const rooms = [...data.rooms].sort((a, b) => a.order - b.order);
  const roomIndexOf = (id: string): number => {
    const i = rooms.findIndex((r) => r.id === id);
    return i === -1 ? rooms.length : i;
  };
  const roomNameOf = (id: string): string => rooms.find((r) => r.id === id)?.name ?? id;
  const works = [...data.works].sort(
    (a, b) => roomIndexOf(a.room) - roomIndexOf(b.room) || a.order - b.order,
  );

  const wallX = HALL_WIDTH / 2 - 0.08;
  const viewOffset = HALL_WIDTH / 2 - VIEW_DIST;
  const zFirstWork = Z_FIRST;
  const zLast = zFirstWork - Math.max(0, works.length - 1) * SLOT_SPACING;

  const placed: PlacedWork[] = works.map((work, i) => {
    const faceX: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const z = zFirstWork - i * SLOT_SPACING;
    let w = 1.5 * work.ratio;
    let h = 1.5;
    if (w > 2.4) {
      w = 2.4;
      h = w / work.ratio;
    }
    // Convention de `faceX` (héritée de paintings.ts) : +1 = mur GAUCHE (x < 0), la
    // toile regarde vers +x. D'où le signe inversé entre faceX et x.
    return {
      work,
      x: -faceX * wallX,
      y: WALL_Y,
      z,
      w,
      h,
      viewX: -faceX * viewOffset,
      viewZ: z,
      scrollT: 0,
      roomName: roomNameOf(work.room),
      faceX,
    };
  });

  // --- sas + salles ---
  const zFront = Z_START;
  const zBack = zLast - Z_END_MARGIN;
  const zones: Zone[] = [];
  zones.push({
    id: '__sas',
    name: 'Entrée',
    zMin: zFirstWork + SLOT_SPACING / 2,
    zMax: zFront,
    lobby: true,
    shell: LOBBY_SHELL,
  });
  rooms.forEach((room, idx) => {
    const zs = placed.filter((p) => p.work.room === room.id).map((p) => p.z);
    const shell = SHELLS[idx % SHELLS.length];
    if (zs.length === 0) {
      zones.push({ id: room.id, name: room.name, zMin: zFront, zMax: zFront, shell });
      return;
    }
    zones.push({
      id: room.id,
      name: room.name,
      zMin: Math.min(...zs) - SLOT_SPACING / 2,
      zMax: Math.max(...zs) + SLOT_SPACING / 2,
      shell,
    });
  });

  return { zEnd: zBack, pathX: 0, placed, zones, zFront, zBack };
}
