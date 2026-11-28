import type { GalleryData } from '../types';

/**
 * Plan du lieu — **sas central, trois salles autour, parcours en boucle**.
 *
 * Ce qui a changé (et pourquoi) : la version précédente était une **enfilade** le long de
 * −z. Avec 30 œuvres à 2,8 m de pas, cela faisait 90 m de long pour 8,6 m de large, soit
 * un ratio de 10,5:1 — un couloir. Chaque salle mesurait 28 m de long, et l'on n'y voyait
 * jamais autre chose qu'un mur qui fuit.
 *
 * Ici le plan est **compact et bouclé** :
 *
 * ```
 *            ┌──────────────┐
 *            │   MARINES    │  15 × 15
 *            └──────┬───────┘
 *   ┌──────────┐    │    ┌──────────┐
 *   │ABSTRAKT. │────┼────│ FIGURES  │   sas 9,6 × 9,6 au centre
 *   └──────────┘    │    └──────────┘
 *            ┌──────┴───────┐
 *            │  entrée/nom  │
 *            └──────────────┘
 * ```
 *
 * Chaque salle est accrochée sur **trois murs** (4 + 2 + 4), la quatrième paroi portant la
 * baie vers le sas. Le parcours entre par la baie, fait le tour en U — un mur latéral, le
 * mur du fond, l'autre mur latéral — et ressort par la même baie. On traverse donc le sas
 * trois fois, comme dans un vrai musée : le hall lumineux est le pivot, chaque salle est
 * un cabinet sombre qu'on ouvre l'une après l'autre.
 *
 * Aucune ligne de vue ne dépasse 15 m, et le parcours **revient à son point de départ** —
 * il finit sur le mur du nom, face à l'entrée.
 */

/* ------------------------------- constantes ------------------------------- */

/** Épaisseur des murs (m). La ligne de mur est l'axe de la boîte. */
export const WALL_T = 0.24;
/** Hauteur de l'œil (m) — caméra guidée et capsule du mode libre. */
export const EYE_Y = 1.6;
/** Ordonnée du centre des toiles (m). */
export const WALL_Y = 1.55;
/** Distance œil → toile, en mode guidé (m). */
export const VIEW_DIST = 2.9;
/**
 * Demi-côté du sas : 12 m de côté.
 *
 * C'est lui qui donne l'échelle de tout le plan : les salles font **exactement** la même
 * largeur que lui, de sorte que les quatre pièces se pavent sans se chevaucher. (Avec un
 * sas de 9,6 m et des salles de 15 m, les angles se superposaient de 2,7 m : une toile de
 * la salle Ouest traversait le mur de la salle Nord.)
 */
export const SAS_HALF = 6;
/** Largeur intérieure d'une salle (m) — égale au côté du sas, par construction. */
export const ROOM_LAT = 12;
/** Profondeur intérieure d'une salle, depuis la baie (m). */
export const ROOM_DEPTH = 14;
/** Baie entre le sas et une salle (m). */
export const DOOR_W = 2.6;
export const DOOR_H = 2.9;
/** Hauteur du sas (m) — plus haut que deux salles, plus bas que la grande. */
export const LOBBY_H = 4.0;

/* --------------------------------- types ---------------------------------- */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Profil d'une pièce : c'est lui qui donne son caractère au volume. */
export interface RoomShell {
  height: number;
  /** Largeur de la verrière (m, 0 = pas de verrière). */
  skyW: number;
  /** Longueur de la verrière (m). */
  skyL: number;
  /** Nombre de poutres transversales. */
  beams: number;
}

export interface Room {
  id: string;
  name: string;
  /** True pour le sas : ce n'est pas une salle d'accrochage. */
  lobby?: boolean;
  /** Rectangle de la pièce, mesuré **aux axes de murs**. */
  rect: Rect;
  height: number;
  shell: RoomShell;
  /** Direction qui **entre** dans la pièce depuis sa baie (unitaire, axe-alignée). */
  inX: number;
  inZ: number;
  /** Centre de la baie, sur l'axe du mur. */
  doorX: number;
  doorZ: number;
}

/** Morceau de mur plein, prêt à extruder (et à collider). */
export interface WallPiece {
  /** 'x' : mur constant en z (il court selon x) ; 'z' : mur constant en x. */
  dir: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  y0: number;
  y1: number;
  /** True si aucune pièce de l'autre côté (mur de façade). */
  outer: boolean;
}

/** Baie percée dans un mur. */
export interface Opening {
  dir: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  /** Hauteur sous linteau. */
  h: number;
}

export interface PlacedWork {
  work: GalleryData['works'][number];
  /** Centre du cadre, au nu du mur. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Rotation Y du cadre : la normale locale +z vise la salle. */
  rotY: number;
  /** Normale de la toile, vers l'intérieur de la salle (unitaire, axe-alignée). */
  nx: number;
  nz: number;
  roomId: string;
  roomName: string;
  /** Pose d'observation (mode guidé) et centre du palier de scroll. */
  viewX: number;
  viewZ: number;
  /** Position dans le **scroll** (0..1) : c'est là qu'il faut amener la page. */
  scrollT: number;
  /**
   * Position **curviligne** de l'arrêt (0..1). Les deux diffèrent depuis que le scroll est
   * repondéré : traverser le sas coûtait 8,7 fois le prix d'un pas d'une toile à l'autre
   * (4 830 px de molette dans un hall vide), donc chaque intervalle est plafonné.
   */
  viewU: number;
}

export interface PathNode {
  x: number;
  z: number;
  yaw: number;
  /** Position curviligne (m) le long du parcours. */
  s: number;
  /** Index de l'œuvre dont c'est le palier d'arrêt. */
  work?: number;
}

export interface Layout {
  rooms: Room[];
  walls: WallPiece[];
  openings: Opening[];
  placed: PlacedWork[];
  /** Polyligne lissée du parcours guidé (échantillonnée). */
  path: PathNode[];
  /** Longueur totale du parcours (m). */
  length: number;
  /** Bornes du bâti. */
  bounds: Rect;
  /** Hauteur maximale. */
  height: number;
  /** Pose caméra pour u ∈ [0,1] du parcours. */
  at(u: number): { x: number; z: number; yaw: number };
}

/* -------------------------------- helpers --------------------------------- */

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Cap à donner à la caméra pour regarder dans la direction (dx, dz). */
export function yawFor(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Gauche d'une direction unitaire axis-alignée (repère x→droite, z→vers soi). */
function leftOf(dx: number, dz: number): [number, number] {
  return [dz, -dx];
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (u: number): number => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Pièce contenant un point (axes de murs inclus). */
export function zoneAt(layout: Layout, x: number, z: number): number {
  const rs = layout.rooms;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i].rect;
    if (x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6) return i;
  }
  // hors bâti : la pièce la plus proche
  let best = 0;
  let bd = Infinity;
  rs.forEach((r, i) => {
    const cx = clamp(x, r.rect.x0, r.rect.x1);
    const cz = clamp(z, r.rect.z0, r.rect.z1);
    const d = Math.hypot(x - cx, z - cz);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Index de la salle d'accrochage (0..n-1) contenant le point, pour la numérotation. */
export function roomNumberAt(layout: Layout, x: number, z: number): number {
  const zi = zoneAt(layout, x, z);
  return layout.rooms.slice(0, zi).filter((r) => !r.lobby).length;
}

/** Index des pièces qui accrochent (le sas est en tête, `lobby`). */
export function roomZones(layout: Layout): Room[] {
  return layout.rooms.filter((r) => !r.lobby);
}

/** Quatre côtés d'un rectangle, avec la normale qui pointe vers l'intérieur. */
export function roomEdges(r: Rect): { dir: 'x' | 'z'; at: number; from: number; to: number; nx: number; nz: number }[] {
  return [
    { dir: 'x', at: r.z1, from: r.x0, to: r.x1, nx: 0, nz: -1 },
    { dir: 'x', at: r.z0, from: r.x0, to: r.x1, nx: 0, nz: 1 },
    { dir: 'z', at: r.x1, from: r.z0, to: r.z1, nx: -1, nz: 0 },
    { dir: 'z', at: r.x0, from: r.z0, to: r.z1, nx: 1, nz: 0 },
  ];
}

/**
 * Découpe une arête en tronçons, en retirant les baies qu'elle contient.
 * Sert aux plinthes et à la cimaise : elles doivent s'interrompre dans les passages.
 */
export function edgeRuns(
  edge: { dir: 'x' | 'z'; at: number; from: number; to: number },
  openings: Opening[],
  pad = 0,
): [number, number][] {
  const lo = Math.min(edge.from, edge.to);
  const hi = Math.max(edge.from, edge.to);
  const cuts = openings
    .filter((o) => o.dir === edge.dir && Math.abs(o.at - edge.at) < 1e-3)
    .map((o) => [o.from - pad, o.to + pad] as [number, number])
    .filter(([a, b]) => b > lo && a < hi)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of cuts) {
    if (a > cur + 1e-3) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
  }
  if (cur < hi - 1e-3) out.push([cur, hi]);
  return out;
}

/* ------------------------------ construction ------------------------------ */

interface Slot {
  inX: number;
  inZ: number;
}

/** Ordre de visite : nord, est, ouest, sud (sens des aiguilles, sas au centre). */
const SLOTS: Slot[] = [
  { inX: 0, inZ: -1 },
  { inX: 1, inZ: 0 },
  { inX: -1, inZ: 0 },
  { inX: 0, inZ: 1 },
];

const SHELLS: RoomShell[] = [
  // Marines : la grande salle, verrière large, plafond haut.
  { height: 4.2, skyW: 3.6, skyL: 8.0, beams: 3 },
  // Figures : plus basse, verrière plus étroite, deux poutres.
  { height: 3.55, skyW: 3.0, skyL: 7.0, beams: 2 },
  // Abstractions : la plus basse et la plus resserrée.
  { height: 3.2, skyW: 2.4, skyL: 6.0, beams: 2 },
  { height: 3.8, skyW: 3.2, skyL: 7.4, beams: 3 },
];

const LOBBY_SHELL: RoomShell = { height: LOBBY_H, skyW: 2.6, skyL: 2.6, beams: 0 };

/**
 * Répartition des œuvres sur les trois murs d'une salle : [gauche, fond, droite].
 *
 * Symétrique jusqu'à 9 (le cas courant : 3 salles × 10 œuvres), puis répartie au plus
 * juste — **aucune œuvre n'est perdue** si une salle en reçoit davantage : c'est
 * l'espacement qui se resserre, pas la liste qui se raccourcit.
 */
function allocate(n: number): [number, number, number] {
  switch (n) {
    case 0:
      return [0, 0, 0];
    case 1:
      return [0, 1, 0];
    case 2:
      return [1, 0, 1];
    case 3:
      return [1, 1, 1];
    case 4:
      return [2, 0, 2];
    case 5:
      return [2, 1, 2];
    case 6:
      return [2, 2, 2];
    case 7:
      return [3, 1, 3];
    case 8:
      return [3, 2, 3];
    case 9:
      return [3, 3, 3];
    default: {
      const far = Math.min(4, Math.max(2, n - 8));
      const rest = n - far;
      const a = Math.ceil(rest / 2);
      return [a, far, rest - a];
    }
  }
}

/**
 * Rectangle d'une pièce pour un emplacement donné, mesuré aux axes de murs.
 *
 * La largeur latérale vaut `ROOM_LAT` = le côté du sas : les pièces se touchent
 * exactement, sans recouvrement. Un plan qui se recouvre produit des murs en double,
 * des toiles dans le mur du voisin et une physique qui bloque au milieu d'une salle.
 */
function rectForSlot(slot: Slot): Rect {
  const lat = ROOM_LAT / 2;
  const d = ROOM_DEPTH;
  if (slot.inZ === -1) return { x0: -lat, z0: -(SAS_HALF + d), x1: lat, z1: -SAS_HALF };
  if (slot.inZ === 1) return { x0: -lat, z0: SAS_HALF, x1: lat, z1: SAS_HALF + d };
  if (slot.inX === 1) return { x0: SAS_HALF, z0: -lat, x1: SAS_HALF + d, z1: lat };
  return { x0: -(SAS_HALF + d), z0: -lat, x1: -SAS_HALF, z1: lat };
}

/* --------------------------------- parcours -------------------------------- */

/* ------------------------------ entrée publique ---------------------------- */

export function computeLayout(data: GalleryData, viewDist = VIEW_DIST): Layout {
  const roomsData = [...data.rooms].sort((a, b) => a.order - b.order);
  const roomIndexOf = (id: string): number => {
    const i = roomsData.findIndex((r) => r.id === id);
    return i === -1 ? roomsData.length : i;
  };

  const works = [...data.works].sort(
    (a, b) => roomIndexOf(a.room) - roomIndexOf(b.room) || a.order - b.order,
  );

  const nRooms = Math.max(1, Math.min(SLOTS.length, roomsData.length));

  // ---- pièces : le sas d'abord (index 0), puis les salles ----
  const rooms: Room[] = [
    {
      id: '__sas',
      name: 'Entrée',
      lobby: true,
      rect: { x0: -SAS_HALF, z0: -SAS_HALF, x1: SAS_HALF, z1: SAS_HALF },
      height: LOBBY_H,
      shell: LOBBY_SHELL,
      inX: 0,
      inZ: 1,
      doorX: 0,
      doorZ: SAS_HALF,
    },
  ];
  const openings: Opening[] = [];
  for (let i = 0; i < nRooms; i++) {
    const slot = SLOTS[i];
    const rect = rectForSlot(slot);
    const rd = roomsData[i];
    rooms.push({
      id: rd?.id ?? `room-${i}`,
      name: rd?.name ?? `Salle ${i + 1}`,
      rect,
      height: SHELLS[i % SHELLS.length].height,
      shell: SHELLS[i % SHELLS.length],
      inX: slot.inX,
      inZ: slot.inZ,
      doorX: slot.inX * SAS_HALF,
      doorZ: slot.inZ * SAS_HALF,
    });
    openings.push({
      dir: slot.inX === 0 ? 'x' : 'z',
      at: slot.inX === 0 ? slot.inZ * SAS_HALF : slot.inX * SAS_HALF,
      from: slot.inX === 0 ? -DOOR_W / 2 : -DOOR_W / 2,
      to: DOOR_W / 2,
      h: DOOR_H,
    });
  }

  // ---- murs : arêtes de chaque pièce, fusionnées par ligne ----
  interface Edge {
    dir: 'x' | 'z';
    at: number;
    from: number;
    to: number;
  }
  const groups = new Map<string, { line: Edge; spans: { from: number; to: number; h: number }[] }>();
  for (const room of rooms) {
    for (const e of roomEdges(room.rect)) {
      const key = `${e.dir}:${r4(e.at)}`;
      let g = groups.get(key);
      if (!g) {
        g = { line: { dir: e.dir, at: e.at, from: 0, to: 0 }, spans: [] };
        groups.set(key, g);
      }
      g.spans.push({ from: Math.min(e.from, e.to), to: Math.max(e.from, e.to), h: room.height });
    }
  }

  const walls: WallPiece[] = [];
  for (const g of groups.values()) {
    // découpe en intervalles élémentaires : chaque borne voit un nombre fixe de pièces
    const cuts = [...new Set(g.spans.flatMap((s) => [r4(s.from), r4(s.to)]))].sort((a, b) => a - b);
    for (let k = 0; k < cuts.length - 1; k++) {
      const from = cuts[k];
      const to = cuts[k + 1];
      if (to - from < 1e-3) continue;
      const mid = (from + to) / 2;
      const cover = g.spans.filter((s) => mid > s.from && mid < s.to);
      if (cover.length === 0) continue;
      const h = Math.max(...cover.map((s) => s.h));
      walls.push({
        dir: g.line.dir,
        at: r4(g.line.at),
        from,
        to,
        y0: 0,
        y1: h,
        outer: cover.length < 2,
      });
    }
  }

  // ---- murs découpés par les baies (avec linteau) ----
  const solid: WallPiece[] = [];
  for (const w of walls) {
    const here = openings.filter((o) => o.dir === w.dir && Math.abs(o.at - w.at) < 1e-3);
    let runs: [number, number][] = [[w.from, w.to]];
    for (const o of here) {
      const next: [number, number][] = [];
      for (const [a, b] of runs) {
        if (o.to <= a || o.from >= b) {
          next.push([a, b]);
          continue;
        }
        if (o.from > a) next.push([a, o.from]);
        if (o.to < b) next.push([o.to, b]);
      }
      runs = next;
    }
    for (const [a, b] of runs) {
      if (b - a < 1e-3) continue;
      solid.push({ ...w, from: a, to: b });
    }
    // linteaux au-dessus des baies
    for (const o of here) {
      const a = Math.max(o.from, w.from);
      const b = Math.min(o.to, w.to);
      if (b - a < 1e-3 || w.y1 <= o.h) continue;
      solid.push({ dir: w.dir, at: w.at, from: a, to: b, y0: o.h, y1: w.y1, outer: w.outer });
    }
  }
  walls.length = 0;
  walls.push(...solid);

  // ---- œuvres : 3 murs par salle, en U ----
  const placed: PlacedWork[] = [];
  const pathRaw: PathNode[] = [];

  /** Recul du nu du cadre par rapport à l'axe du mur (le cadre rentre de 4,5 cm). */
  const face = 0.075;

  /** Pas courant du mur en cours — sert à ne jamais poser deux cadres côte à côte. */
  let slotW = 2.8;

  /** Cadre la toile : largeur bornée par le pas du mur, hauteur liée au ratio. */
  const sizeOf = (work: GalleryData['works'][number]): { w: number; h: number } => {
    let w = Math.min(1.5 * work.ratio, Math.max(0.9, slotW - 0.45));
    let h = 1.5;
    if (w > 2.4) {
      w = 2.4;
      h = w / work.ratio;
    }
    return { w, h };
  };

  const startZ = SAS_HALF - 1.6;
  pathRaw.push({ x: 0, z: startZ, yaw: 0, s: 0 });

  for (let ri = 0; ri < nRooms; ri++) {
    const room = rooms[ri + 1];
    const r = room.rect;
    const inX = room.inX;
    const inZ = room.inZ;
    const [lx, lz] = leftOf(inX, inZ); // « gauche » en entrant : premier mur accroché
    // repère local : u = profondeur depuis la baie, v = latéral (gauche > 0)
    const depth = inX === 0 ? r.z1 - r.z0 : r.x1 - r.x0;
    const width = inX === 0 ? r.x1 - r.x0 : r.z1 - r.z0;
    const originX = room.doorX;
    const originZ = room.doorZ;
    const toWorld = (u: number, v: number): { x: number; z: number } => ({
      x: originX + inX * u + lx * v,
      z: originZ + inZ * u + lz * v,
    });

    const roomWorks = works.filter((w) => w.room === room.id);
    const [nA, nF, nB] = allocate(roomWorks.length);
    let wi = 0;

    /**
     * Pose une toile sur un mur, à `viewDist` du nu, et ajoute son palier au parcours.
     * `nx, nz` = normale du mur **vers l'intérieur de la salle**.
     */
    const hang = (
      wallX: number,
      wallZ: number,
      nx: number,
      nz: number,
      work: GalleryData['works'][number],
    ): void => {
      const { w, h } = sizeOf(work);
      const viewX = wallX + nx * (face + viewDist);
      const viewZ = wallZ + nz * (face + viewDist);
      placed.push({
        work,
        x: wallX + nx * face,
        y: WALL_Y,
        z: wallZ + nz * face,
        w,
        h,
        rotY: Math.atan2(nx, nz),
        nx,
        nz,
        roomId: room.id,
        roomName: room.name,
        viewX,
        viewZ,
        scrollT: 0,
        viewU: 0,
      });
      pathRaw.push({ x: viewX, z: viewZ, yaw: yawFor(-nx, -nz), s: 0, work: placed.length - 1 });
    };

    // Répartition sur un mur : espacement 2,8 m au plus, centré entre la baie et l'angle
    // du parcours (marge `guard`) pour que la dernière toile ne soit jamais dans le virage.
    const guard = viewDist + 1.25;
    const firstU = 2.4;
    const lastU = depth - guard;
    const uAt = (n: number, i: number): number => {
      if (n <= 1) return (firstU + lastU) / 2;
      const sp = Math.min(2.8, (lastU - firstU) / (n - 1));
      slotW = sp;
      const span = sp * (n - 1);
      return (firstU + lastU) / 2 - span / 2 + i * sp;
    };
    const vAt = (n: number, i: number): number => {
      if (n <= 1) return 0;
      const lim = width / 2 - viewDist - 1.0;
      const sp = Math.min(3.2, (lim * 2) / (n - 1));
      slotW = sp;
      const span = sp * (n - 1);
      return -span / 2 + i * sp;
    };

    // ---- entrée (0,35 m à l'intérieur de la baie, cap vers le fond) ----
    const entry = toWorld(0.35, 0);
    pathRaw.push({ x: entry.x, z: entry.z, yaw: yawFor(inX, inZ), s: 0 });

    // ---- mur de gauche ----
    for (let i = 0; i < nA; i++) {
      const work = roomWorks[wi++];
      if (!work) break;
      const p = toWorld(uAt(nA, i), width / 2);
      hang(p.x, p.z, -lx, -lz, work);
    }

    // ---- congé du fond (côté gauche) ----
    const cornerA = toWorld(depth - viewDist - face, width / 2 - viewDist - face);
    pathRaw.push({ x: cornerA.x, z: cornerA.z, yaw: yawFor(inX, inZ), s: 0 });

    // ---- mur du fond : on le parcourt de gauche à droite (v décroissant) ----
    for (let i = nF - 1; i >= 0; i--) {
      const work = roomWorks[wi++];
      if (!work) break;
      const p = toWorld(depth, vAt(nF, i));
      hang(p.x, p.z, -inX, -inZ, work);
    }

    // ---- congé du fond (côté droit) ----
    const cornerB = toWorld(depth - viewDist - face, -width / 2 + viewDist + face);
    pathRaw.push({ x: cornerB.x, z: cornerB.z, yaw: yawFor(-inX, -inZ), s: 0 });

    // ---- mur de droite : on revient vers la baie (u décroissant) ----
    for (let i = nB - 1; i >= 0; i--) {
      const work = roomWorks[wi++];
      if (!work) break;
      const p = toWorld(uAt(nB, i), -width / 2);
      hang(p.x, p.z, lx, lz, work);
    }

    // ---- sortie : 1,1 m à l'intérieur, cap vers le sas ----
    const exit = toWorld(1.1, 0);
    pathRaw.push({ x: exit.x, z: exit.z, yaw: yawFor(-inX, -inZ), s: 0 });
  }

  // ---- retour au sas, face au mur du nom ----
  // 3,4 m du mur du nom (et non 2,4) : à 2,4 m, le titre de 3 m débordait de l'écran.
  const endZ = nRooms < 4 ? SAS_HALF - 3.4 : 0;
  pathRaw.push({ x: 0, z: endZ, yaw: Math.PI, s: 0 });

  // ---- parcours : congés + caps ----
  const path = smoothPath(pathRaw);

  // paliers de scroll : position curviligne de chaque arrêt, normalisée
  const total = Math.max(1e-6, path[path.length - 1].s);
  const centers = placed.map((_p, i) => {
    const node = path.find((n) => n.work === i);
    return node ? node.s / total : 0;
  });
  // ---- repondération du scroll ----
  //
  // `centers` est proportionnel à la distance parcourue : un pas de 3 m entre deux toiles
  // coûtait 560 px de molette, la traversée de 20 m du sas 4 830 px — 39 crans dans un
  // hall où il n'y a rien à lire. On plafonne donc chaque intervalle à `SCROLL_CAP` fois
  // la **médiane** des intervalles entre œuvres : les trajets longs se font plus vite,
  // les arrêts gardent leur place. La courbe reste strictement croissante (aucun palier
  // ne se confond avec son voisin), et `at()` n'est pas touché : c'est le paramètre de
  // scroll qui se resserre, pas la géométrie.
  const stops: number[] = [...centers, 1];
  const gaps = stops.map((c, i) => Math.max(1e-6, c - (i === 0 ? 0 : stops[i - 1])));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0.03;
  const weights = gaps.map((g) => Math.min(g, median * 1.9));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const scrollCenters = centers.map((_c, i) => {
    acc += weights[i];
    return acc / wsum;
  });
  placed.forEach((p, i) => {
    p.scrollT = scrollCenters[i];
    p.viewU = centers[i];
  });

  // ---- bornes ----
  const bounds = rooms.reduce(
    (b, r) => ({
      x0: Math.min(b.x0, r.rect.x0),
      z0: Math.min(b.z0, r.rect.z0),
      x1: Math.max(b.x1, r.rect.x1),
      z1: Math.max(b.z1, r.rect.z1),
    }),
    { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity },
  );
  const height = Math.max(...rooms.map((r) => r.height));

  const at = (u: number): { x: number; z: number; yaw: number } => {
    const target = clamp(u, 0, 1) * total;
    let lo = 0;
    let hi = path.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (path[mid].s <= target) lo = mid;
      else hi = mid;
    }
    const a = path[lo];
    const b = path[hi];
    const span = Math.max(1e-6, b.s - a.s);
    const t = clamp((target - a.s) / span, 0, 1);
    // le cap est déjà interpolé sur les sommets : on lisse seulement entre échantillons
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + dy * t };
  };

  return {
    rooms,
    walls,
    openings,
    placed,
    path,
    length: total,
    bounds,
    height,
    at,
  };
}

/* ------------------------- parcours : lissage & caps ----------------------- */

/**
 * Construit la polyligne finale : congés aux angles (jamais aux arrêts), caps interpolés
 * en smoothstep entre deux sommets consécutifs, positions curvilignes accumulées.
 */
function smoothPath(raw: PathNode[]): PathNode[] {
  // 1. doublons (deux sommets au même endroit) retirés : ils créeraient une division par 0
  const nodes: PathNode[] = [];
  for (const n of raw) {
    const p = nodes[nodes.length - 1];
    if (p && Math.hypot(n.x - p.x, n.z - p.z) < 1e-3) {
      p.yaw = n.yaw;
      if (n.work !== undefined) p.work = n.work;
      continue;
    }
    nodes.push({ ...n });
  }
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...nodes[0], s: 0 }];

  const dist = (a: PathNode, b: PathNode): number => Math.hypot(b.x - a.x, b.z - a.z);
  /**
   * Rayon du congé à un sommet. **Zéro sur un arrêt d'œuvre** : la caméra doit
   * s'immobiliser exactement sur la pose d'observation, sinon le palier de scroll tombe
   * à côté et le cadre se lit de biais. Zéro aussi aux extrémités et sur un alignement.
   */
  const radiusAt = (i: number): number => {
    if (i <= 0 || i >= n - 1) return 0;
    if (nodes[i].work !== undefined) return 0;
    const la = dist(nodes[i - 1], nodes[i]);
    const lb = dist(nodes[i], nodes[i + 1]);
    const ax = (nodes[i].x - nodes[i - 1].x) / la;
    const az = (nodes[i].z - nodes[i - 1].z) / la;
    const bx = (nodes[i + 1].x - nodes[i].x) / lb;
    const bz = (nodes[i + 1].z - nodes[i].z) / lb;
    const turn = Math.acos(clamp(ax * bx + az * bz, -1, 1));
    const sharp = clamp(turn / (Math.PI / 2), 0, 1);
    return Math.min(1.05, la * 0.42, lb * 0.42) * sharp;
  };

  const pts: { x: number; z: number; yaw: number; work?: number }[] = [
    { x: nodes[0].x, z: nodes[0].z, yaw: nodes[0].yaw },
  ];
  for (let i = 0; i < n - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const L = dist(a, b);
    if (L < 1e-6) continue;
    const ux = (b.x - a.x) / L;
    const uz = (b.z - a.z) / L;
    const rA = radiusAt(i);
    const rB = radiusAt(i + 1);
    // tronçon droit entre les deux congés
    const x0 = a.x + ux * rA;
    const z0 = a.z + uz * rA;
    const x1 = b.x - ux * rB;
    const z1 = b.z - uz * rB;
    const runLen = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(runLen / 0.55));
    const dyaw = shortest(a.yaw, b.yaw);
    for (let k = 1; k <= steps; k++) {
      const tl = k / steps;
      // position curviligne **sur le tronçon entier** : le cap suit la même horloge que
      // l'avancement, d'où un virage qui part et arrive à vitesse angulaire nulle.
      const ts = (rA + runLen * tl) / L;
      pts.push({
        x: x0 + (x1 - x0) * tl,
        z: z0 + (z1 - z0) * tl,
        yaw: a.yaw + dyaw * smooth(ts),
        work: k === steps && rB <= 0.06 ? b.work : undefined,
      });
    }
    // congé : le cap tient la pose du sommet
    if (rB > 0.06) {
      const steps2 = 6;
      for (let k = 1; k <= steps2; k++) {
        const t = k / steps2;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * x1 + 2 * mt * t * b.x + t * t * (b.x + ux * rB),
          z: mt * mt * z1 + 2 * mt * t * b.z + t * t * (b.z + uz * rB),
          yaw: b.yaw,
          work: b.work,
        });
      }
    }
  }

  let s = 0;
  return pts.map((p, i) => {
    if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    return { x: r4(p.x), z: r4(p.z), yaw: p.yaw, s: r4(s), work: p.work };
  });
}

/** Écart angulaire le plus court de a vers b. */
function shortest(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Courbe de « dwell » : monotone [0,1] → [0,1], de dérivée nulle autour de chaque centre. */
export const DWELL_HALF = 0.08;

export function createDwellCurve(centers: number[], values?: number[]): (t: number) => number {
  const cs = [...centers].sort((a, b) => a - b);
  const n = cs.length;
  if (n === 0) return (t) => clamp(t, 0, 1);
  // `values` (défaut : les centres) permet de faire correspondre un paramètre de scroll
  // repondéré à une position curviligne différente (voir `computeLayout`).
  const vs = values ? [...values].sort((a, b) => a - b) : cs;
  const half = cs.map((c, i) => {
    const gap = Math.min(i > 0 ? c - cs[i - 1] : c, i < n - 1 ? cs[i + 1] - c : 1 - c);
    return Math.min(DWELL_HALF, 0.45) * gap;
  });
  return (t) => {
    const x = clamp(t, 0, 1);
    let prevEnd = 0;
    let prevVal = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, cs[i] - half[i]);
      const b = Math.min(1, cs[i] + half[i]);
      if (x <= b) {
        if (x >= a) return vs[i];
        return prevVal + (vs[i] - prevVal) * smooth((x - prevEnd) / Math.max(1e-9, a - prevEnd));
      }
      prevEnd = b;
      prevVal = vs[i];
    }
    return prevVal + (1 - prevVal) * smooth((x - prevEnd) / Math.max(1e-9, 1 - prevEnd));
  };
}
