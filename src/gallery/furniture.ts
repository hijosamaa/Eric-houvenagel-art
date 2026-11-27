import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { HALL_WIDTH, hallBounds, portalPositions, type Layout } from './layout';

import { beamTexture } from './textures';

/**
 * Mobilier de la galerie — module UNIQUE consommé par `scene.ts` (meshes) et
 * `physics.ts` (colliders) : les positions sont calculées une seule fois ici,
 * il est donc impossible que la physique diverge du visuel.
 *
 * Tout est fusionné par matériau : bancs, socles, plantes, console = ~8 draw calls
 * pour tout le hall, quoi qu'il contienne.
 */

export interface ColliderBox {
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
}

/** Bancs le long du mur droit (les œuvres sont au mur gauche). */
export const BENCH_X = HALL_WIDTH / 2 - 0.38;
/** Socles au centre-droit du hall, un par salle. */
export const PEDESTAL_X = 0.9;

export function benchPositions(layout: Layout): number[] {
  const { zMin, zMax } = hallBounds(layout);
  const out: number[] = [];
  for (let bz = zMin + 6; bz < zMax - 4; bz += 11) out.push(bz);
  return out;
}

export function pedestalPositions(layout: Layout): number[] {
  return layout.zones
    .filter((z) => z.zMax - z.zMin > 4)
    .map((z) => (z.zMin + z.zMax) / 2);
}

export function plantPositions(layout: Layout): { x: number; z: number }[] {
  const { zMin, zMax } = hallBounds(layout);
  const out: { x: number; z: number }[] = [];
  // une plante de part et d'autre de chaque portail (mêmes z que scene.ts / physics.ts)
  for (const portal of portalPositions(layout)) {
    out.push({ x: HALL_WIDTH / 2 - 0.55, z: portal.z + 1.4 });
    out.push({ x: HALL_WIDTH / 2 - 0.55, z: portal.z - 1.4 });
  }
  // et aux deux extrémités du hall, côté mur droit
  out.push({ x: HALL_WIDTH / 2 - 0.55, z: zMin + 1.8 });
  out.push({ x: HALL_WIDTH / 2 - 0.55, z: zMax - 1.8 });
  return out;
}

/** Console + vase contre le mur du fond (zMin), centrée. */
export function consoleSpec(layout: Layout): { x: number; z: number } {
  const { zMin } = hallBounds(layout);
  return { x: 0, z: zMin + 0.32 };
}

/** Tous les colliders du mobilier, dans le repère monde (pour Rapier). */
export function furnitureColliders(layout: Layout): ColliderBox[] {
  const out: ColliderBox[] = [];
  for (const bz of benchPositions(layout)) {
    out.push({ hx: 0.28, hy: 0.05, hz: 0.95, x: BENCH_X, y: 0.46, z: bz });
  }
  for (const pz of pedestalPositions(layout)) {
    out.push({ hx: 0.21, hy: 0.48, hz: 0.21, x: PEDESTAL_X, y: 0.48, z: pz });
  }
  for (const p of plantPositions(layout)) {
    out.push({ hx: 0.19, hy: 0.65, hz: 0.19, x: p.x, y: 0.65, z: p.z });
  }
  const c = consoleSpec(layout);
  out.push({ hx: 0.85, hy: 0.46, hz: 0.3, x: c.x, y: 0.46, z: c.z });
  return out;
}

/* ------------------------------- géométries ------------------------------- */

/** Sphère de feuillage irrégulière (icosaèdre subdivisé + déplacement de sommets). */
function foliageBlob(r: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  let s = seed * 2654435761;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (rnd() - 0.5) * 0.34;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function latheVase(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    [0.001, 0], [0.15, 0], [0.185, 0.04], [0.195, 0.16], [0.15, 0.28],
    [0.115, 0.34], [0.125, 0.40], [0.16, 0.44], [0.165, 0.46], [0.001, 0.46],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 28);
}

export interface FurnitureMaterials {
  wood: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  lacquer: THREE.MeshPhysicalMaterial;
  pot: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshPhysicalMaterial;
}

export function furnitureMaterials(aniso: number, maxSize = 2048): FurnitureMaterials {
  // chêne clair pour le mobilier (la texture 'beam' de base est sombre : on éclaircit
  // par la couleur du matériau ; une version IA dans ai/beam.webp remplacera les deux)
  const woodMap = beamTexture(aniso, 2.2, '#8a6a48', maxSize);
  return {
    wood: new THREE.MeshStandardMaterial({ map: woodMap, color: 0xe9d3ae, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2c2925, roughness: 0.42, metalness: 0.85, envMapIntensity: 0.9 }),
    lacquer: new THREE.MeshPhysicalMaterial({
      color: 0xf4f2ee, roughness: 0.25, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 0.7,
    }),
    pot: new THREE.MeshStandardMaterial({ color: 0x9a5b40, roughness: 0.9, envMapIntensity: 0.15 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3a4a2e, roughness: 0.95, envMapIntensity: 0.1, flatShading: true }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: 0x2f2a26, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6 }),
  };
}

/** Construit tous les meshes du mobilier (fusionnés par matériau) dans un seul Group. */
export function buildFurniture(layout: Layout, mats: FurnitureMaterials, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  const wood: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  const lacquer: THREE.BufferGeometry[] = [];
  const pot: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];
  const ceramic: THREE.BufferGeometry[] = [];

  const put = (g: THREE.BufferGeometry, arr: THREE.BufferGeometry[], x: number, y: number, z: number, ry = 0): void => {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    arr.push(g);
  };

  // ---- bancs : assise lattée (3 lattes) + 4 poteaux acier fins (pas de panneau latéral) ----
  for (const bz of benchPositions(layout)) {
    for (let k = -1; k <= 1; k++) {
      put(new THREE.BoxGeometry(0.56, 0.024, 0.56), wood, BENCH_X, 0.475, bz + k * 0.62);
    }
    for (const [px, pz] of [[-0.24, -0.7], [0.24, -0.7], [-0.24, 0.7], [0.24, 0.7]] as const) {
      put(new THREE.BoxGeometry(0.05, 0.46, 0.05), steel, BENCH_X + px, 0.23, bz + pz);
    }
  }

  // ---- socles laqués, un par salle ----
  for (const pz of pedestalPositions(layout)) {
    put(new THREE.BoxGeometry(0.42, 0.96, 0.42), lacquer, PEDESTAL_X, 0.48, pz);
    put(new THREE.BoxGeometry(0.48, 0.03, 0.48), lacquer, PEDESTAL_X, 0.975, pz); // chapeau
  }

  // ---- plantes en pot (topiaire) ----
  let seed = 7;
  for (const p of plantPositions(layout)) {
    const potG = new THREE.CylinderGeometry(0.17, 0.135, 0.34, 20);
    const rim = new THREE.TorusGeometry(0.168, 0.022, 10, 24);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, 0.34, 0);
    const trunk = new THREE.CylinderGeometry(0.018, 0.03, 0.55, 8);
    trunk.translate(0, 0.6, 0);
    const b1 = foliageBlob(0.26, seed++);
    b1.translate(0, 1.02, 0);
    const b2 = foliageBlob(0.19, seed++);
    b2.translate(0.12, 1.22, 0.06);
    const b3 = foliageBlob(0.15, seed++);
    b3.translate(-0.1, 1.16, -0.1);
    put(potG, pot, p.x, 0.17, p.z);
    put(rim, pot, p.x, 0.17, p.z);
    put(trunk, pot, p.x, 0.17, p.z); // même matériau terre cuite sombre ok pour le tronc
    put(b1, leaf, p.x, 0, p.z);
    put(b2, leaf, p.x, 0, p.z);
    put(b3, leaf, p.x, 0, p.z);
  }

  // ---- console + vase au mur du fond ----
  const c = consoleSpec(layout);
  put(new THREE.BoxGeometry(1.7, 0.045, 0.55), wood, c.x, 0.88, c.z);
  put(new THREE.BoxGeometry(1.58, 0.07, 0.48), wood, c.x, 0.82, c.z);
  for (const [lx, lz] of [[-0.78, -0.22], [0.78, -0.22], [-0.78, 0.22], [0.78, 0.22]] as const) {
    put(new THREE.BoxGeometry(0.05, 0.86, 0.05), wood, c.x + lx, 0.43, c.z + lz);
  }
  const vase = latheVase();
  vase.translate(0.35, 0.9, 0);
  put(vase, ceramic, c.x, 0, c.z);

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
  add(wood, mats.wood, 'mobilier-bois');
  add(steel, mats.steel, 'mobilier-acier');
  add(lacquer, mats.lacquer, 'socles');
  add(pot, mats.pot, 'pots');
  add(leaf, mats.leaf, 'feuillage');
  add(ceramic, mats.ceramic, 'vase');
  return group;
}
