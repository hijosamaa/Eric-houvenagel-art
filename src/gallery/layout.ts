import type { GalleryData } from '../types';

export const HALL_WIDTH = 12;
export const HALL_HEIGHT = 3.4;
export const WALL_Y = 1.55;
export const SLOT_SPACING = 3.4;
export const Z_FIRST = 1.5;
export const Z_START = 5.5;
export const Z_END_MARGIN = 4.5;
export const VIEW_DIST = 2.6;

export interface PlacedWork {
  work: GalleryData['works'][number];
  side: 'left' | 'right';
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  viewX: number;
  viewZ: number;
  scrollT: number;
  roomName: string;
}

export interface Zone {
  id: string;
  name: string;
  zMin: number;
  zMax: number;
}

export interface Layout {
  zEnd: number;
  placed: PlacedWork[];
  zones: Zone[];
}

export function hallBounds(layout: Layout): { zMin: number; zMax: number } {
  return { zMin: layout.zEnd - 2, zMax: Z_START + 3 };
}

export function computeLayout(data: GalleryData): Layout {
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

  const placed: PlacedWork[] = works.map((work, i) => {
    const side: 'left' | 'right' = i % 2 === 0 ? 'right' : 'left';
    const z = Z_FIRST - i * SLOT_SPACING;
    let w = 1.45 * work.ratio;
    let h = 1.45;
    if (w > 2.3) {
      w = 2.3;
      h = w / work.ratio;
    }
    const x = side === 'right' ? HALL_WIDTH / 2 - 0.08 : -HALL_WIDTH / 2 + 0.08;
    const viewX = side === 'right' ? HALL_WIDTH / 2 - VIEW_DIST : -HALL_WIDTH / 2 + VIEW_DIST;
    const scrollT = Math.min(1, Math.max(0, (Z_START - z) / (Z_START - zEnd)));
    return {
      work,
      side,
      x,
      y: WALL_Y,
      z,
      w,
      h,
      viewX,
      viewZ: z,
      scrollT,
      roomName: roomNameOf(work.room),
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

  return { zEnd, placed, zones };
}
