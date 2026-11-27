import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { HALL_HEIGHT, HALL_WIDTH, hallBounds, type Layout } from './layout';

import { ROOF_LAYER } from './lights';

import { extrudedPrism, timberX, timberGeometry, chamferedSection } from './wood';

import { skyTexture } from './textures';

/**
 * Charpente et verrière.
 *
 * Ce qui a changé (et pourquoi) : l'ancienne version posait deux `BoxGeometry` de chêne
 * sombre de part et d'autre de la verrière, plus des piliers et linteaux de portique
 * dans le même bois. Vu d'en bas, cela faisait « trois rectangles bruns » qui
 * concurrençaient les toiles et cassaient la perspective du hall.
 *
 * La structure est maintenant celle d'un atelier d'artiste réel, **peinte comme les
 * murs** (le bois ne se lit plus par son contraste mais par son relief et son ombre) :
 *
 *  - une dalle à trémie épaisse de 34 cm : l'ouverture de la verrière a une profondeur,
 *    avec un redent de 6 cm qui accroche la lumière rasante ;
 *  - deux poutres maîtresses chanfreinées encadrant la trémie ;
 *  - des solives chanfreinées qui portent **de la poutre maîtresse au mur** (elles ne
 *    traversent pas la trémie : le jour tombe librement et dessine sa trame au sol) ;
 *  - une sablière continue contre chaque mur, où les solives s'appuient ;
 *  - une verrière en bronze patiné, meneaux fins, ciel dégradé (aucune image brûlée).
 *
 * Toutes les pièces de bois partagent une seule géométrie fusionnée par matériau :
 * 2 draw calls pour la charpente entière, quel que soit le nombre de solives.
 */

/** Épaisseur de la dalle (profondeur de la trémie) en mètres. */
export const SLAB_THICKNESS = 0.34;
/** Largeur de la trémie (fraction de la largeur du hall). */
const WELL_W = 0.46;
/** Longueur de la trémie (fraction de la longueur du hall). */
const WELL_L = 0.9;
/** Retombée du redent qui borde la trémie. */
const MOUTH_STEP = 0.06;

export interface CeilingMaterials {
  /** Bois peint de la charpente (poutres, solives, sablière). */
  painted: THREE.MeshStandardMaterial;
  /** Enduit de plafond de la dalle. */
  plaster: THREE.MeshStandardMaterial;
  /** Bronze patiné des meneaux. */
  bronze: THREE.MeshStandardMaterial;
}

export interface CeilingBuild {
  group: THREE.Group;
  /** Demi-largeur de la trémie (m) — réutilisée par les lumières de ciel. */
  wellHalfW: number;
  wellHalfZ: number;
  dispose(): void;
}

/** Dalle de plafond percée de la trémie (une seule Shape extrudée = arêtes réelles). */
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
  // UV de WorldUVGenerator exprimées en mètres → tuile de plafond de 6,4 m.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 6.4, uv.getY(i) / 6.4);
  uv.needsUpdate = true;
  return geo;
}

export function buildCeiling(layout: Layout, mats: CeilingMaterials, shadows: boolean): CeilingBuild {
  const { zMin, zMax } = hallBounds(layout);
  const halfW = HALL_WIDTH / 2;
  const halfL = (zMax - zMin) / 2;
  const cz = (zMin + zMax) / 2;
  const len = zMax - zMin;
  const group = new THREE.Group();
  group.name = 'charpente';

  const wellHalfW = (halfW * WELL_W);
  const wellHalfZ = (len * WELL_L) / 2;

  const painted: THREE.BufferGeometry[] = [];
  const bronze: THREE.BufferGeometry[] = [];

  // ---- dalle à trémie ----
  const slab = new THREE.Mesh(
    slabWithWell(halfW, halfL, wellHalfW, wellHalfZ, SLAB_THICKNESS),
    mats.plaster,
  );
  slab.position.set(0, HALL_HEIGHT, cz);
  slab.castShadow = shadows;
  slab.receiveShadow = shadows;
  slab.layers.set(ROOF_LAYER);
  slab.name = 'dalle-tremie';
  group.add(slab);

  // ---- redent : un second plateau mince, trémie légèrement plus large, sous la dalle ----
  const mouth = new THREE.Mesh(
    slabWithWell(halfW, halfL, wellHalfW + MOUTH_STEP, wellHalfZ + MOUTH_STEP, 0.05),
    mats.painted,
  );
  mouth.position.set(0, HALL_HEIGHT - 0.05, cz);
  mouth.receiveShadow = shadows;
  mouth.castShadow = shadows;
  mouth.name = 'redent-tremie';
  group.add(mouth);

  // ---- poutres maîtresses (le long du hall), encadrant la trémie ----
  const beamW = 0.2;
  const beamH = 0.3;
  const beamX = wellHalfW + beamW / 2 + 0.1;
  for (const sx of [-1, 1]) {
    const g = timberGeometry({ length: len, width: beamW, height: beamH, chamfer: 0.022, tileV: 3.2 });
    g.translate(sx * beamX, HALL_HEIGHT - beamH / 2, cz);
    painted.push(g);
  }

  // ---- solives : de la poutre maîtresse au mur, sans traverser la trémie ----
  const joistW = 0.08;
  const joistH = 0.155;
  const joistInner = beamX + beamW / 2 - 0.03;
  const joistOuter = halfW - 0.09;
  const joistSpan = joistOuter - joistInner;
  const step = 1.92;
  for (let z = zMin + 1.1; z < zMax - 0.9; z += step) {
    for (const sx of [-1, 1]) {
      const centerX = sx * (joistInner + joistSpan / 2);
      const g = timberX({ length: joistSpan, width: joistW, height: joistH, chamfer: 0.012, tileV: 2.4 });
      g.translate(centerX, HALL_HEIGHT - joistH / 2, z);
      painted.push(g);
    }
  }

  // ---- sablière contre chaque mur (appui des solives) ----
  // Sablière : prisme extrudé le long de +Z, donc DÉJÀ dans l'axe du hall.
  // (Un `rotateY(π/2)` la couchait en travers de la verrière — d'où la barre blanche
  // qui traversait le plafond sur les captures précédentes.)
  for (const sx of [-1, 1]) {
    const g = extrudedPrism(chamferedSection(0.055, 0.1, 0.012), len, { tileV: 3 });
    g.translate(sx * (halfW - 0.0275), HALL_HEIGHT - 0.05, cz);
    painted.push(g);
  }

  // ---- verrière : vitrage (ciel) + meneaux bronze posés dessous ----
  const paneY = HALL_HEIGHT + SLAB_THICKNESS - 0.03;
  // 0,82–0,92 : la verrière reste lumineuse mais on VOIT le ciel (nuages, dégradé).
  // Au-dessus de 1,0 l'ACES écrase tout en blanc pur et la verrière devient un trou blanc.
  const paneMat = new THREE.MeshBasicMaterial({
    map: skyTexture(),
    // 1,15–1,25 : le vitrage reste au-dessus du blanc du papier (il « brûle » un peu,
    // comme sur une photo), mais le dégradé de ciel et les nuages restent lisibles.
    color: new THREE.Color(1.16, 1.2, 1.26),
    fog: false,
  });
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(wellHalfW * 2 + 0.04, wellHalfZ * 2 + 0.04),
    paneMat,
  );
  pane.rotation.x = Math.PI / 2;
  pane.position.set(0, paneY, cz);
  pane.layers.set(ROOF_LAYER);
  pane.name = 'verriere';
  group.add(pane);

  const memberY = paneY - 0.035;
  const mull = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    bronze.push(g);
  };
  // Meneaux fins (32-52 mm) : une verrière d'atelier, pas une huisserie. Plus épais, ils
  // masquaient le ciel et la verrière se lisait comme un caisson.
  const ringW = 0.052;
  mull(wellHalfW * 2, 0.04, ringW, 0, memberY, cz - wellHalfZ + ringW / 2);
  mull(wellHalfW * 2, 0.04, ringW, 0, memberY, cz + wellHalfZ - ringW / 2);
  mull(ringW, 0.04, wellHalfZ * 2, -wellHalfW + ringW / 2, memberY, cz);
  mull(ringW, 0.04, wellHalfZ * 2, wellHalfW - ringW / 2, memberY, cz);
  const nLong = 3;
  for (let k = 1; k <= nLong; k++) {
    const x = -wellHalfW + (wellHalfW * 2 * k) / (nLong + 1);
    mull(0.028, 0.045, wellHalfZ * 2, x, memberY, cz);
  }
  for (let z = cz - wellHalfZ + 2.6; z < cz + wellHalfZ - 1.6; z += 2.6) {
    mull(wellHalfW * 2, 0.045, 0.028, 0, memberY, z);
  }

  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string, roof: boolean): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) return;
    const m = new THREE.Mesh(merged, mat);
    m.name = name;
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    if (roof) m.layers.set(ROOF_LAYER);
    group.add(m);
  };
  add(painted, mats.painted, 'charpente-peinte', false);
  add(bronze, mats.bronze, 'meneaux', true);

  return {
    group,
    wellHalfW,
    wellHalfZ,
    dispose(): void {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
      paneMat.dispose();
    },
  };
}
