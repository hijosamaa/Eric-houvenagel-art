import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { HALL_WIDTH, type Layout } from './layout';

import { timberX, timberGeometry } from './wood';

import { skyTexture } from './textures';

/**
 * Plafonds et verrières, **salle par salle**.
 *
 * Ce qui a changé (et pourquoi) : la version précédente traitait le lieu comme une nef
 * unique de 90 m — une verrière continue, une poutre maîtresse, une solive tous les
 * 1,92 m, une sablière, des portiques, plus une plaque de laiton sur chaque linteau.
 * Vu d'en bas, cela faisait un plafond « chargé » qui concurrençait les toiles.
 *
 * Ici chaque salle a **son** plafond : une dalle à trémie, deux poutres qui encadrent la
 * verrière, deux ou trois poutres transversales, et rien d'autre. Les salles n'ont pas la
 * même hauteur, ce qui donne des seuils francs plutôt qu'un long couloir.
 *
 * Toutes les pièces peintes d'une salle sont fusionnées en un seul maillage : 1 draw call
 * par salle pour la charpente, quel que soit le nombre de poutres.
 */

/** Épaisseur de la dalle (= profondeur de la trémie) en mètres. */
export const SLAB_THICKNESS = 0.32;
/** Retombée du redent qui borde la trémie. */
const MOUTH_STEP = 0.05;

export interface CeilingMaterials {
  /** Bois peint de la charpente (poutres). */
  painted: THREE.MeshStandardMaterial;
  /** Enduit de plafond de la dalle. */
  plaster: THREE.MeshStandardMaterial;
  /** Acier des meneaux. */
  bronze: THREE.MeshStandardMaterial;
}

export interface CeilingBuild {
  group: THREE.Group;
  dispose(): void;
}

/** Dalle rectangulaire percée de la trémie (une Shape extrudée = arêtes réelles). */
function slabWithWell(
  halfW: number,
  halfL: number,
  wellW: number,
  wellL: number,
  thickness: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, -halfL);
  shape.lineTo(halfW, -halfL);
  shape.lineTo(halfW, halfL);
  shape.lineTo(-halfW, halfL);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-wellW, -wellL);
  hole.lineTo(-wellW, wellL);
  hole.lineTo(wellW, wellL);
  hole.lineTo(wellW, -wellL);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  // UV de WorldUVGenerator exprimées en mètres → tuile de plafond de 3,4 m (même échelle
  // que les murs : une dalle et un mur voisins ne doivent pas trahir deux échelles).
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.4, uv.getY(i) / 3.4);
  uv.needsUpdate = true;
  return geo;
}

export function buildCeilings(layout: Layout, mats: CeilingMaterials, shadows: boolean): CeilingBuild {
  const group = new THREE.Group();
  group.name = 'plafonds';
  const halfW = HALL_WIDTH / 2;
  const panes: THREE.Material[] = [];

  for (const zone of layout.zones) {
    const shell = zone.shell;
    const z0 = Math.min(zone.zMin, zone.zMax);
    const z1 = Math.max(zone.zMin, zone.zMax);
    const len = z1 - z0;
    if (len <= 0.05) continue;
    const cz = (z0 + z1) / 2;
    const H = shell.height;
    const halfL = len / 2;

    const wellW = Math.min(halfW - 1.1, shell.skyWidth / 2);
    const wellL = Math.max(0.8, (len * shell.skyRatio) / 2);

    const painted: THREE.BufferGeometry[] = [];
    const bronze: THREE.BufferGeometry[] = [];

    // ---- dalle à trémie ----
    const slab = new THREE.Mesh(slabWithWell(halfW, halfL, wellW, wellL, SLAB_THICKNESS), mats.plaster);
    slab.position.set(0, H, cz);
    slab.castShadow = shadows;
    slab.receiveShadow = shadows;
    slab.name = `dalle-${zone.id}`;
    group.add(slab);

    // ---- redent : plateau mince, trémie légèrement plus large, sous la dalle ----
    const mouth = new THREE.Mesh(
      slabWithWell(halfW, halfL, wellW + MOUTH_STEP, wellL + MOUTH_STEP, 0.045),
      mats.painted,
    );
    mouth.position.set(0, H - 0.045, cz);
    mouth.receiveShadow = shadows;
    mouth.castShadow = shadows;
    group.add(mouth);

    // ---- deux poutres qui encadrent la verrière (le long du hall) ----
    const beamW = 0.18;
    const beamH = 0.26;
    const beamX = wellW + beamW / 2 + 0.06;
    for (const sx of [-1, 1]) {
      const g = timberGeometry({ length: len, width: beamW, height: beamH, chamfer: 0.018, tileV: 3 });
      g.translate(sx * beamX, H - beamH / 2, cz);
      painted.push(g);
    }

    // ---- poutres transversales : d'un mur à l'autre, sous la dalle ----
    const transW = 0.22;
    const transH = 0.3;
    const n = shell.beams;
    for (let k = 1; k <= n; k++) {
      const z = z0 + (len * k) / (n + 1);
      const g = timberX({ length: HALL_WIDTH - 0.06, width: transW, height: transH, chamfer: 0.016, tileV: 2.6 });
      g.translate(0, H - transH / 2, z);
      painted.push(g);
    }

    // ---- verrière : vitrage (ciel) + meneaux fins posés dessous ----
    const paneY = H + SLAB_THICKNESS - 0.03;
    const paneMat = new THREE.MeshBasicMaterial({
      map: skyTexture(),
      // 1,16–1,26 : le vitrage « brûle » un peu comme sur une photo, sans perdre le ciel.
      // 2,4 : franchement au-dessus du seuil de bloom (1,02). À 1,16 le ciel restait un
      // aplat gris-bleu sans halo, et la verrière n'« éclairait » plus l'image.
      color: new THREE.Color(2.35, 2.45, 2.6),
      fog: false,
    });
    panes.push(paneMat);
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(wellW * 2 + 0.04, wellL * 2 + 0.04),
      paneMat,
    );
    pane.rotation.x = Math.PI / 2;
    pane.position.set(0, paneY, cz);
    pane.name = `verriere-${zone.id}`;
    group.add(pane);

    // Meneaux : 36-48 mm. Une verrière d'atelier, pas une huisserie.
    const my = paneY - 0.03;
    const ringW = 0.048;
    const mull = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      bronze.push(g);
    };
    mull(wellW * 2, 0.038, ringW, 0, my, cz - wellL + ringW / 2);
    mull(wellW * 2, 0.038, ringW, 0, my, cz + wellL - ringW / 2);
    mull(ringW, 0.038, wellL * 2, -wellW + ringW / 2, my, cz);
    mull(ringW, 0.038, wellL * 2, wellW - ringW / 2, my, cz);
    mull(0.026, 0.042, wellL * 2, 0, my, cz);
    const nZ = Math.max(1, Math.round(wellL / 1.5));
    for (let k = 1; k < nZ; k++) {
      const z = cz - wellL + (wellL * 2 * k) / nZ;
      mull(wellW * 2, 0.042, 0.026, 0, my, z);
    }

    const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string): void => {
      if (parts.length === 0) return;
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      if (!merged) return;
      const m = new THREE.Mesh(merged, mat);
      m.name = name;
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      group.add(m);
    };
    add(painted, mats.painted, `charpente-${zone.id}`);
    add(bronze, mats.bronze, `meneaux-${zone.id}`);

  }

  return {
    group,
    dispose(): void {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
      for (const p of panes) p.dispose();
    },
  };
}
