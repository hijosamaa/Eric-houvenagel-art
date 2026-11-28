import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Layout, Room } from './layout';

import { timberX, timberGeometry } from './wood';

import { skyTexture } from './textures';

/**
 * Plafonds et verrières, **salle par salle**.
 *
 * Ce qui a changé (et pourquoi) : la version « enfilade » traitait le lieu comme une nef
 * unique de 90 m — une verrière continue, une poutre maîtresse, une solive tous les
 * 1,92 m, une sablière, des portiques, plus une plaque de laiton sur chaque linteau. Vu
 * d'en bas, cela faisait un plafond « chargé » qui concurrençait les toiles.
 *
 * Ici chaque salle a **son** plafond : une dalle à trémie, deux poutres qui encadrent la
 * verrière, deux ou trois poutres transversales, et rien d'autre. La verrière court dans
 * le sens de la profondeur — donc dans l'axe du parcours — et les salles n'ont ni la même
 * hauteur ni la même largeur de ciel : c'est ce qui les distingue d'un couloir.
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
  halfX: number,
  halfZ: number,
  wellX: number,
  wellZ: number,
  thickness: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-halfX, -halfZ);
  shape.lineTo(halfX, -halfZ);
  shape.lineTo(halfX, halfZ);
  shape.lineTo(-halfX, halfZ);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-wellX, -wellZ);
  hole.lineTo(-wellX, wellZ);
  hole.lineTo(wellX, wellZ);
  hole.lineTo(wellX, -wellZ);
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

/** Axe long de la pièce : la profondeur, de la baie au mur du fond. */
function longAxisOf(room: Room): 'x' | 'z' {
  return room.inZ !== 0 ? 'z' : 'x';
}

export function buildCeilings(layout: Layout, mats: CeilingMaterials, shadows: boolean): CeilingBuild {
  const group = new THREE.Group();
  group.name = 'plafonds';
  const panes: THREE.Material[] = [];

  for (const room of layout.rooms) {
    const shell = room.shell;
    const H = room.height;
    const cx = (room.rect.x0 + room.rect.x1) / 2;
    const cz = (room.rect.z0 + room.rect.z1) / 2;
    const halfX = (room.rect.x1 - room.rect.x0) / 2;
    const halfZ = (room.rect.z1 - room.rect.z0) / 2;
    const axis = longAxisOf(room);
    // dimensions de la pièce dans le repère local (a = profondeur, b = largeur)
    const halfA = axis === 'z' ? halfZ : halfX;
    const halfB = axis === 'z' ? halfX : halfZ;
    /** Repère local → monde. */
    const mx = (a: number, b: number): number => cx + (axis === 'z' ? b : a);
    const mz = (a: number, b: number): number => cz + (axis === 'z' ? a : b);

    const wellA = Math.min(halfA - 1.2, shell.skyL / 2);
    const wellB = Math.min(halfB - 1.35, shell.skyW / 2);
    if (wellA <= 0.2 || wellB <= 0.2) continue;

    // trémie exprimée dans le repère monde de la dalle
    const wellX = axis === 'z' ? wellB : wellA;
    const wellZ = axis === 'z' ? wellA : wellB;

    const painted: THREE.BufferGeometry[] = [];
    const bronze: THREE.BufferGeometry[] = [];

    // ---- dalle à trémie ----
    const slab = new THREE.Mesh(slabWithWell(halfX, halfZ, wellX, wellZ, SLAB_THICKNESS), mats.plaster);
    slab.position.set(cx, H, cz);
    slab.castShadow = shadows;
    slab.receiveShadow = shadows;
    slab.name = `dalle-${room.id}`;
    group.add(slab);

    // ---- redent : un **bandeau** peint de 11 cm qui borde la trémie ----
    //
    // La version précédente posait une plaque peinte sur toute la dalle : vue d'en bas,
    // la salle avait un plafond de bois. Ici le bandeau ne fait que border le ciel — la
    // dalle reste de l'enduit, et c'est la seule pièce peinte du plafond avec les poutres.
    {
      const mouthT = 0.05;
      const mouthW = 0.11;
      const by = H - mouthT / 2;
      const bx = wellX + MOUTH_STEP;
      const bz = wellZ + MOUTH_STEP;
      const bar = (w: number, d: number, x: number, z: number): void => {
        // toNonIndexed : les poutres de wood.ts ne sont pas indexées, et
        // mergeGeometries refuse de mélanger les deux familles d'attributs.
        const box = new THREE.BoxGeometry(w, mouthT, d);
        const g = box.toNonIndexed();
        box.dispose();
        g.translate(x, by, z);
        painted.push(g);
      };
      bar(bx * 2 + mouthW * 2, mouthW, cx, cz - bz - mouthW / 2);
      bar(bx * 2 + mouthW * 2, mouthW, cx, cz + bz + mouthW / 2);
      bar(mouthW, bz * 2, cx - bx - mouthW / 2, cz);
      bar(mouthW, bz * 2, cx + bx + mouthW / 2, cz);
    }

    // ---- deux poutres qui encadrent la verrière, dans l'axe de la pièce ----
    const beamW = 0.18;
    const beamH = 0.26;
    const beamOffset = wellB + beamW / 2 + 0.06;
    for (const s of [-1, 1]) {
      const g =
        axis === 'z'
          ? timberGeometry({ length: halfA * 2, width: beamW, height: beamH, chamfer: 0.018, tileV: 3 })
          : timberX({ length: halfA * 2, width: beamW, height: beamH, chamfer: 0.018, tileV: 3 });
      g.translate(mx(0, s * beamOffset), H - beamH / 2, mz(0, s * beamOffset));
      painted.push(g);
    }

    // ---- poutres transversales : d'un mur à l'autre, sous la dalle ----
    const transW = 0.22;
    const transH = 0.3;
    const n = shell.beams;
    for (let k = 1; k <= n; k++) {
      const a = -halfA + (halfA * 2 * k) / (n + 1);
      const g =
        axis === 'z'
          ? timberX({ length: halfB * 2 - 0.06, width: transW, height: transH, chamfer: 0.016, tileV: 2.6 })
          : timberGeometry({ length: halfB * 2 - 0.06, width: transW, height: transH, chamfer: 0.016, tileV: 2.6 });
      g.translate(mx(a, 0), H - transH / 2, mz(a, 0));
      painted.push(g);
    }

    // ---- verrière : vitrage (ciel) + meneaux fins posés dessous ----
    const paneY = H + SLAB_THICKNESS - 0.03;
    const paneMat = new THREE.MeshBasicMaterial({
      map: skyTexture(),
      // 1,35 : le ciel reste au-dessus du seuil de bloom (1,02) mais ne se clippe plus en
      // aplat blanc (mesure : 60,8 % des pixels de la vue plafond étaient > 240). Un
      // vitrage doit lire comme un ciel, avec une valeur — pas comme un caisson.
      color: new THREE.Color(1.35, 1.42, 1.55),
      fog: false,
    });
    panes.push(paneMat);
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(wellX * 2 + 0.04, wellZ * 2 + 0.04),
      paneMat,
    );
    pane.rotation.x = Math.PI / 2;
    pane.position.set(cx, paneY, cz);
    pane.name = `verriere-${room.id}`;
    group.add(pane);

    // Meneaux : 90 mm de pourtour et 40 mm de traverses. À 36-48 mm, vus d'en bas à 4 m,
    // ils ne faisaient que 6 à 10 niveaux d'écart avec le vitrage : la verrière lisait
    // comme une plaque de lumière sans trame.
    const my = paneY - 0.03;
    const ringW = 0.09;
    const mull = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      bronze.push(g);
    };
    mull(wellX * 2, 0.06, ringW, cx, my, cz - wellZ + ringW / 2);
    mull(wellX * 2, 0.06, ringW, cx, my, cz + wellZ - ringW / 2);
    mull(ringW, 0.06, wellZ * 2, cx - wellX + ringW / 2, my, cz);
    mull(ringW, 0.06, wellZ * 2, cx + wellX - ringW / 2, my, cz);
    mull(0.04, 0.065, wellZ * 2, cx, my, cz);
    const nZ = Math.max(1, Math.round(wellZ / 1.5));
    for (let k = 1; k < nZ; k++) {
      mull(wellX * 2, 0.065, 0.04, cx, my, cz - wellZ + (wellZ * 2 * k) / nZ);
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
    add(painted, mats.painted, `charpente-${room.id}`);
    add(bronze, mats.bronze, `meneaux-${room.id}`);
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
