import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { SAS_HALF, WALL_T, type Layout } from './layout';

import { oakTexture } from './textures';

import { timberGeometry, timberX, timberY, prismY } from './wood';

/**
 * Mobilier de la galerie — module UNIQUE consommé par `scene.ts` (meshes) et
 * `physics.ts` (colliders) : les positions sont calculées une seule fois ici,
 * il est donc impossible que la physique diverge du visuel.
 *
 * Tout est fusionné par matériau : bancs, socles et console = 4 draw calls pour
 * tout le bâtiment, quoi qu'il contienne. Les pièces de bois passent par `wood.ts`
 * (sections chanfreinées, grain le long du fil) : une arête vive donnait des
 * meubles en carton.
 */

export interface ColliderBox {
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
}

/** Dimensions du banc (m). */
const BENCH_L = 1.86;
const BENCH_D = 0.44;

export interface BenchSpot {
  x: number;
  z: number;
  /** True si le banc court selon x (sinon selon z). */
  alongX: boolean;
}

/**
 * Bancs : **au centre de chaque pièce accrochée**, parallèle au mur du fond.
 *
 * Les œuvres occupent trois murs : un banc latéral passerait devant une toile. Au
 * centre, il sert exactement à ce pour quoi il est fait — s'asseoir et regarder — et le
 * parcours le contourne (le tracé passe à 1,1 m de la baie, le banc commence à 3 m).
 */
export function benchPlacements(layout: Layout): BenchSpot[] {
  return layout.rooms
    .filter((r) => !r.lobby)
    .map((room) => ({
      x: (room.rect.x0 + room.rect.x1) / 2,
      z: (room.rect.z0 + room.rect.z1) / 2,
      alongX: room.inZ !== 0,
    }));
}

export interface PedestalSpot {
  x: number;
  z: number;
}

/**
 * Socles : **contre le mur de la baie**, de part et d'autre du passage (2 par salle).
 * C'est le seul pan de mur qui ne porte pas de toile, et un socle y tient sans jamais
 * passer devant un cadre.
 */
export function pedestalPlacements(layout: Layout): PedestalSpot[] {
  const out: PedestalSpot[] = [];
  for (const room of layout.rooms) {
    if (room.lobby) continue;
    // **dans** la salle : on part de la baie et l'on avance vers l'intérieur (inX, inZ).
    // (Le sens inverse posait les socles dans le sas, à 2 m du mur, au milieu du passage.)
    const nx = room.inX;
    const nz = room.inZ;
    const tx = -nz;
    const tz = nx;
    for (const s of [-1, 1]) {
      out.push({
        x: room.doorX + nx * (WALL_T / 2 + 0.55) + tx * s * 3.5,
        z: room.doorZ + nz * (WALL_T / 2 + 0.55) + tz * s * 3.5,
      });
    }
  }
  return out;
}

/** Console du mur du nom (sas) : plateau, pieds fuselés, livres, coupe. */
export function consoleSpec(_layout: Layout): { x: number; z: number } {
  return { x: 0, z: SAS_HALF - WALL_T / 2 - 0.32 };
}

/** Tous les colliders du mobilier, dans le repère monde (pour Rapier). */
export function furnitureColliders(layout: Layout): ColliderBox[] {
  const out: ColliderBox[] = [];
  for (const b of benchPlacements(layout)) {
    out.push({
      hx: b.alongX ? BENCH_L / 2 : BENCH_D / 2,
      hy: 0.22,
      hz: b.alongX ? BENCH_D / 2 : BENCH_L / 2,
      x: b.x,
      y: 0.22,
      z: b.z,
    });
  }
  for (const p of pedestalPlacements(layout)) {
    out.push({ hx: 0.22, hy: 0.47, hz: 0.22, x: p.x, y: 0.47, z: p.z });
  }
  const c = consoleSpec(layout);
  out.push({ hx: 0.9, hy: 0.45, hz: 0.3, x: c.x, y: 0.45, z: c.z });
  return out;
}

/* ------------------------------- géométries ------------------------------- */

function lathe(points: [number, number][], segments = 30): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
}

/** Vase en grès : panse basse, col resserré. */
function vesselGeometry(scale = 1): THREE.BufferGeometry {
  const pts: [number, number][] = [
    [0.001, 0],
    [0.09, 0],
    [0.115, 0.012],
    [0.145, 0.06],
    [0.152, 0.115],
    [0.138, 0.17],
    [0.105, 0.205],
    [0.093, 0.225],
    [0.1, 0.24],
    [0.001, 0.24],
  ];
  const g = lathe(pts, 34);
  g.scale(scale, scale, scale);
  return g;
}

/** Coupe basse en céramique (sur la console). */
function bowlGeometry(scale = 1): THREE.BufferGeometry {
  const pts: [number, number][] = [
    [0.001, 0],
    [0.075, 0],
    [0.115, 0.03],
    [0.145, 0.075],
    [0.15, 0.09],
    [0.138, 0.092],
    [0.12, 0.062],
    [0.09, 0.022],
    [0.001, 0.02],
  ];
  const g = lathe(pts, 30);
  g.scale(scale, scale, scale);
  return g;
}

export interface FurnitureMaterials {
  oak: THREE.MeshStandardMaterial;
  lacquer: THREE.MeshPhysicalMaterial;
  ceramic: THREE.MeshPhysicalMaterial;
  paper: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
}

export function furnitureMaterials(aniso: number, maxSize = 2048): FurnitureMaterials {
  const oakMap = oakTexture(aniso, 1, maxSize);
  return {
    oak: new THREE.MeshStandardMaterial({
      map: oakMap,
      color: 0xffffff,
      roughness: 0.52,
      metalness: 0,
      envMapIntensity: 0.45,
    }),
    lacquer: new THREE.MeshPhysicalMaterial({
      color: 0xe9e5dd,
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.55,
    }),
    ceramic: new THREE.MeshPhysicalMaterial({
      color: 0x55504a,
      roughness: 0.36,
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.7,
    }),
    paper: new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9, envMapIntensity: 0.15 }),
    bronze: new THREE.MeshStandardMaterial({
      color: 0x8a7350,
      roughness: 0.35,
      metalness: 0.85,
      envMapIntensity: 1.0,
    }),
  };
}

/**
 * Construit tous les meshes du mobilier (fusionnés par matériau) dans un seul Group.
 * `colliders` documente les volumes bloquants pour Rapier (voir furnitureColliders).
 */
export function buildFurniture(layout: Layout, mats: FurnitureMaterials, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mobilier';
  const oak: THREE.BufferGeometry[] = [];
  const lacquer: THREE.BufferGeometry[] = [];
  const ceramic: THREE.BufferGeometry[] = [];
  const paper: THREE.BufferGeometry[] = [];
  const bronze: THREE.BufferGeometry[] = [];

  const push = (
    src: THREE.BufferGeometry,
    arr: THREE.BufferGeometry[],
    x: number,
    y: number,
    z: number,
    ry = 0,
  ): void => {
    // toutes les pièces fusionnées doivent avoir le même jeu d'attributs : on
    // dé-indexe systématiquement (les primitives three sont indexées, wood.ts non)
    const g = src.index ? src.toNonIndexed() : src;
    if (g !== src) src.dispose();
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    arr.push(g);
  };

  // ---- bancs : plateau massif chanfreiné, joues en retrait sur pieds engagés ----
  // Un banc de galerie doit se lire d'un coup : une ligne horizontale franche, deux
  // appuis fins, une ligne d'ombre au sol. Les joues s'arrêtent à 6 cm du sol sur un
  // patin en retrait — c'est ce détail qui évite l'effet « table de pique-nique ».
  const benchL = BENCH_L;
  const benchD = BENCH_D;
  const benchH = 0.44;
  const topT = 0.045;
  for (const spot of benchPlacements(layout)) {
    const rot = spot.alongX ? Math.PI / 2 : 0;
    // Le banc est construit dans son repère local (longueur selon z) puis tourné :
    // `push` applique la rotation avant la translation, donc l'axe suit le mur du fond.
    const part = (src: THREE.BufferGeometry, ly: number, lz: number): void => {
      src.translate(0, ly, lz);
      push(src, oak, spot.x, 0, spot.z, rot);
    };
    // plateau
    part(
      timberGeometry({ length: benchL, width: benchD, height: topT, chamfer: 0.007, tileV: 1.9 }),
      benchH - topT / 2,
      0,
    );
    for (const sz of [-1, 1]) {
      const lz = sz * (benchL / 2 - 0.2);
      // joue
      part(
        timberY({ length: benchH - topT - 0.07, width: benchD - 0.08, height: 0.048, chamfer: 0.005, tileV: 1.2 }),
        0.07,
        lz,
      );
      // patin en retrait
      part(
        timberGeometry({ length: 0.05, width: benchD - 0.12, height: 0.07, chamfer: 0.005, tileV: 1.2 }),
        0.035,
        lz,
      );
    }
    // entretoise basse
    part(
      timberGeometry({ length: benchL - 0.46, width: 0.04, height: 0.055, chamfer: 0.005, tileV: 1.4 }),
      0.19,
      0,
    );
  }

  // ---- socles laqués : fût sur socle en retrait (effet « posé ») + objet ----
  pedestalPlacements(layout).forEach((p, i) => {
    // socle en retrait (2 cm) → ligne d'ombre au sol
    push(new THREE.BoxGeometry(0.35, 0.032, 0.35), lacquer, p.x, 0.016, p.z);
    // fût
    push(prismY(0.4, 0.4, 0.875, 0.005), lacquer, p.x, 0.032, p.z);
    // objet exposé (vase ou coupe, alterné)
    const obj = i % 2 === 0 ? vesselGeometry(1.25) : bowlGeometry(1.1);
    push(obj, ceramic, p.x, 0.907, p.z, i * 1.1);
  });

  // ---- console du mur du fond : plateau, pieds fuselés, livres, coupe ----
  const c = consoleSpec(layout);
  const topW = 1.74;
  const topD = 0.44;
  push(
    timberX({ length: topW, width: topD, height: 0.048, chamfer: 0.006, tileV: 1.7 }),
    oak,
    c.x,
    0.86,
    c.z,
  );
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = timberY({ length: 0.836, width: 0.042, height: 0.042, chamfer: 0.005, tileV: 1.7 });
      leg.scale(1, 1, 1);
      push(leg, oak, c.x + sx * (topW / 2 - 0.1), 0, c.z + sz * (topD / 2 - 0.09));
    }
  }
  push(
    timberX({ length: topW - 0.24, width: 0.03, height: 0.05, chamfer: 0.004, tileV: 1.5 }),
    oak,
    c.x,
    0.2,
    c.z,
  );
  // pile de livres
  let y = 0.884;
  const books: { w: number; d: number; h: number; r: number }[] = [
    { w: 0.3, d: 0.22, h: 0.045, r: 0.06 },
    { w: 0.27, d: 0.2, h: 0.038, r: -0.04 },
    { w: 0.24, d: 0.18, h: 0.03, r: 0.11 },
  ];
  for (const b of books) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    push(g, paper, c.x - 0.44, y + b.h / 2, c.z + 0.01, b.r);
    y += b.h;
  }
  push(bowlGeometry(1.0), ceramic, c.x + 0.16, 0.884, c.z - 0.02, 0.6);

  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return;
    const m = new THREE.Mesh(merged, mat);
    m.name = name;
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    group.add(m);
  };
  add(oak, mats.oak, 'mobilier-chene');
  add(lacquer, mats.lacquer, 'socles');
  add(ceramic, mats.ceramic, 'ceramiques');
  add(paper, mats.paper, 'livres');
  add(bronze, mats.bronze, 'bronze');

  return group;
}
