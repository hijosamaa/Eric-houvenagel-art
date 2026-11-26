import type { GalleryData } from '../types';

export const HALL_WIDTH = 12;
export const HALL_HEIGHT = 3.4;
export const WALL_Y = 1.55;
export const SLOT_SPACING = 3.0;
export const Z_FIRST = 1.5;
export const Z_START = 5.5;
export const Z_END_MARGIN = 4.5;
export const VIEW_DIST = 2.6;

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
