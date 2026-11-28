import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { HALL_WIDTH, hallBounds, portalPositions, type Layout } from './layout';


import { leafTexture } from './textures';

/**
 * Végétation de la galerie — géométrie de feuilles réelle (pas de « blobs »).
 *
 * Chaque espèce est construite feuille par feuille : une feuille est une bande
 * paramétrique (largeur variable le long de la nervure, pli en V, affaissement,
 * vrille), ce qui donne une silhouette reconnaissable même à contre-jour et une
 * ombre portée crédible. Les feuilles sont fusionnées par matériau → 2 draw calls
 * pour toute la végétation du hall.
 *
 * Trois détails qui font la différence :
 *  1. **couleur par sommet** : les feuilles du cœur sont plus sombres que celles de
 *     l'extérieur, comme sur une vraie plante (une couleur unique donne du plastique) ;
 *  2. **`aSway`** : un poids d'oscillation par sommet (0 au pied, 1 à la pointe) qui
 *     anime la végétation dans le vertex shader — un souffle de quelques millimètres,
 *     coupé si `prefers-reduced-motion` ;
 *  3. **placement déterministe** (PRNG semé sur la position) : le visuel et les
 *     colliders Rapier ne peuvent pas diverger.
 */

/* ------------------------------- aléatoire -------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine stable à partir d'une position (jamais Math.random dans la géométrie). */
function hash2(x: number, z: number): number {
  const a = Math.round(x * 1000) ^ Math.round(z * 1000) * 2654435761;
  return (a >>> 0) || 1;
}

/* --------------------------------- types ---------------------------------- */

export type PlantSpecies = 'olivier' | 'ficus' | 'monstera' | 'sansevieria' | 'fougere' | 'pothos' | 'eucalyptus';
export type PotStyle = 'terracotta' | 'blanc' | 'pierre' | 'zinc';

export interface PlantPlacement {
  x: number;
  z: number;
  species: PlantSpecies;
  pot: PotStyle;
  /** Échelle globale de la plante (1 = taille de référence de l'espèce). */
  scale: number;
  /** Rotation autour de Y (rad). */
  rot: number;
  /** Sur un socle / une console (pas de collider au sol). */
  elevated?: boolean;
}

export interface PlantMaterials {
  leaf: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  stem: THREE.MeshStandardMaterial;
  pot: THREE.MeshStandardMaterial;
  potWhite: THREE.MeshStandardMaterial;
  potStone: THREE.MeshStandardMaterial;
  potZinc: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
}

/* ------------------------------ feuille ----------------------------------- */

interface LeafOpts {
  /** Longueur (m). */
  length: number;
  /** Largeur max (m). */
  width: number;
  /** Nombre de segments le long de la nervure. */
  segments?: number;
  /** Affaissement de la pointe (m à t = 1). */
  droop?: number;
  /** Pli en V (fraction de la demi-largeur, 0 = plat). */
  fold?: number;
  /** Vrille (rad) : la feuille se tourne autour de sa nervure. */
  twist?: number;
  /** Découpes latérales (monstera) : nombre de fentes par côté. */
  slits?: number;
  /** Profondeur des fentes (0..1). */
  slitDepth?: number;
  /** Pincement du pétiole à la base (0..1). */
  pinch?: number;
  /** Décalage de la feuille hors du plan (relief de nervure). */
  rib?: number;
}

/**
 * Feuille : bande paramétrique non indexée. Normale +Z au repos, base à l'origine,
 * pointe vers +Y. Deux quads par segment (moitié gauche / moitié droite) : les fentes
 * de monstera sont obtenues en supprimant des quads sur toute la demi-largeur, ce qui
 * ouvre une vraie découpe jusqu'à la nervure centrale.
 */
function leafGeometry(o: LeafOpts): THREE.BufferGeometry {
  const seg = o.segments ?? 6;
  const fold = o.fold ?? 0.18;
  const droop = o.droop ?? 0.16;
  const twist = o.twist ?? 0;
  const rib = o.rib ?? 0.004;
  const pinch = o.pinch ?? 0.35;
  const slits = o.slits ?? 0;
  const slitDepth = o.slitDepth ?? 0.8;

  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];

  /** Demi-largeur à t ∈ [0,1] : base pincée, ventre large, pointe fine. */
  const halfWidth = (t: number): number => {
    const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.72);
    const pinchMask = 1 - pinch * Math.pow(1 - t, 3.2);
    let v = (o.width / 2) * env * pinchMask;
    if (slits > 0) {
      // dents : la largeur plonge par intermittence → découpes en peigne
      const phase = (t * slits) % 1;
      const notch = Math.pow(Math.abs(Math.sin(Math.PI * phase)), 0.5);
      v *= 1 - slitDepth * (1 - notch) * (t > 0.08 ? 1 : 0);
    }
    return Math.max(0, v);
  };
  /** Axe de la nervure : affaissement quadratique + léger ventre. */
  const spine = (t: number): THREE.Vector3 =>
    new THREE.Vector3(0, o.length * t, droop * Math.pow(t, 2.1) - rib * Math.sin(Math.PI * t));

  const rows: { t: number; l: THREE.Vector3; r: THREE.Vector3; c: THREE.Vector3 }[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = spine(t);
    const w = halfWidth(t);
    const ang = twist * t;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    // pli en V : les bords remontent (ou descendent) par rapport à la nervure
    const off = new THREE.Vector3(-w, 0, fold * w);
    const offR = new THREE.Vector3(w, 0, fold * w);
    const l = new THREE.Vector3(c.x + off.x * ca - off.z * sa, c.y, c.z + off.x * sa + off.z * ca);
    const r = new THREE.Vector3(c.x + offR.x * ca - offR.z * sa, c.y, c.z + offR.x * sa + offR.z * ca);
    rows.push({ t, l, r, c });
  }

  const isNotch = (t: number): boolean => {
    if (slits <= 0) return false;
    const phase = (t * slits) % 1;
    return t > 0.12 && t < 0.92 && Math.abs(Math.sin(Math.PI * phase)) < 0.34;
  };

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: number, ub: number, uc: number): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
    for (let k = 0; k < 3; k++) nrm.push(n.x, n.y, n.z);
    uvs.push(ua, 0, ub, 1, uc, 0.5);
  };

  for (let i = 0; i < seg; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const notch = isNotch((a.t + b.t) / 2);
    const va = a.t;
    const vb = b.t;
    if (!notch) {
      // moitié gauche (nervure → bord), face +Z
      pushTri(a.c, b.c, b.l, va, vb, vb);
      pushTri(a.c, b.l, a.l, va, vb, va);
      // moitié droite
      pushTri(a.c, b.r, b.c, va, vb, vb);
      pushTri(a.c, a.r, b.r, va, va, vb);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/* ------------------------------ assemblage -------------------------------- */

const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

interface Bucket {
  parts: THREE.BufferGeometry[];
}

/**
 * Normalise une géométrie pour la fusion : non indexée, attributs
 * `position / normal / uv / color / aSway`, transformée par `matrix`.
 */
function finalize(
  g: THREE.BufferGeometry,
  color: THREE.Color,
  sway: number,
  matrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    const n = geo.attributes.position.count;
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sw = new Float32Array(n).fill(sway);
  geo.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  if (matrix) geo.applyMatrix4(matrix);
  // attributs utiles seulement
  for (const key of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color', 'aSway'].includes(key)) geo.deleteAttribute(key);
  }
  return geo;
}

function matrixAt(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  scale = 1,
): THREE.Matrix4 {
  _q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(scale, scale, scale));
}

/** Tige (cylindre effilé) orientée de `from` vers `to`. */
function stemGeometry(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sides = 6): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(Math.max(0.0015, r1), Math.max(0.0015, r0), len, sides, 1, false);
  // le cylindre est centré sur Y : on le décale pour que sa base soit à l'origine
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, dir.clone().normalize());
  g.applyQuaternion(_q);
  g.translate(from.x, from.y, from.z);
  return g;
}

/* ------------------------------ espèces ----------------------------------- */

const GREEN_DARK = new THREE.Color(0x2f4529);
const GREEN_MID = new THREE.Color(0x436236);
const GREEN_LIGHT = new THREE.Color(0x5f7d45);
const GREEN_OLIVE = new THREE.Color(0x6b7c50);
const GREEN_SAGE = new THREE.Color(0x8a9a76);
const BARK = new THREE.Color(0x4a3a2c);

/** Feuille posée en éventail autour d'un point, orientée par (yaw, pitch). */
function addLeaf(
  bucket: Bucket,
  opts: LeafOpts,
  at: THREE.Vector3,
  yaw: number,
  pitch: number,
  roll: number,
  color: THREE.Color,
  sway: number,
  scale = 1,
): void {
  const g = leafGeometry(opts);
  const m = matrixAt(at.x, at.y, at.z, pitch, yaw, roll, scale);
  bucket.parts.push(finalize(g, color, sway, m));
}

/** Olive (Olea) : tronc noueux, houppier aéré de petites feuilles. */
function buildOlivier(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const h = 1.75 + rng() * 0.3;
  let base = new THREE.Vector3(0, 0.14, 0);
  let top = base;
  // tronc en 3 segments légèrement coudés
  for (let i = 0; i < 3; i++) {
    const next = new THREE.Vector3(
      base.x + (rng() - 0.5) * 0.08,
      0.14 + (h * 0.5 * (i + 1)) / 3,
      base.z + (rng() - 0.5) * 0.08,
    );
    b.stem.parts.push(
      finalize(stemGeometry(base, next, 0.058 - i * 0.012, 0.046 - i * 0.012, 7), BARK, 0.05 + i * 0.12),
    );
    base = next;
    top = next;
  }

  /** Petites feuilles groupées en bouquets autour d'un point. */
  const tuft = (center: THREE.Vector3, count: number, spread: number, swayBase: number): void => {
    for (let k = 0; k < count; k++) {
      const p = new THREE.Vector3(
        center.x + (rng() - 0.5) * spread,
        center.y + (rng() - 0.5) * spread * 0.85,
        center.z + (rng() - 0.5) * spread,
      );
      const shade = GREEN_OLIVE.clone().lerp(GREEN_SAGE, rng() * 0.75);
      shade.multiplyScalar(0.72 + rng() * 0.5);
      addLeaf(
        b.leaf,
        {
          length: 0.1 + rng() * 0.045,
          width: 0.022 + rng() * 0.01,
          segments: 3,
          droop: 0.014,
          fold: 0.3,
          pinch: 0.15,
        },
        p,
        rng() * Math.PI * 2,
        (rng() - 0.5) * 1.7,
        rng() * Math.PI,
        shade,
        swayBase + rng() * 0.3,
      );
    }
  };

  // branches principales, chacune portant 2 rameaux
  const branches = 7;
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng() * 0.55;
    const tilt = 0.38 + rng() * 0.55;
    const len = 0.55 + rng() * 0.5;
    const end = new THREE.Vector3(
      top.x + Math.cos(a) * Math.sin(tilt) * len,
      top.y + Math.cos(tilt) * len,
      top.z + Math.sin(a) * Math.sin(tilt) * len,
    );
    b.stem.parts.push(finalize(stemGeometry(top, end, 0.023, 0.01, 5), BARK, 0.4));
    tuft(end, 22 + Math.floor(rng() * 10), 0.17, 0.62);
    // rameaux secondaires à mi-branche
    for (let j = 0; j < 2; j++) {
      const t = 0.45 + rng() * 0.4;
      const from = new THREE.Vector3().lerpVectors(top, end, t);
      const a2 = a + (j === 0 ? 0.9 : -0.9) + (rng() - 0.5) * 0.4;
      const l2 = 0.22 + rng() * 0.22;
      const to = new THREE.Vector3(
        from.x + Math.cos(a2) * l2,
        from.y + (rng() - 0.2) * l2,
        from.z + Math.sin(a2) * l2,
      );
      b.stem.parts.push(finalize(stemGeometry(from, to, 0.011, 0.005, 4), BARK, 0.5));
      tuft(to, 14 + Math.floor(rng() * 8), 0.13, 0.7);
    }
  }
}

/** Ficus lyrata : grand tronc, grandes feuilles en raquette. */
function buildFicus(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const h = 1.5 + rng() * 0.35;
  const base = new THREE.Vector3(0, 0.15, 0);
  const top = new THREE.Vector3((rng() - 0.5) * 0.06, 0.15 + h, (rng() - 0.5) * 0.06);
  b.stem.parts.push(finalize(stemGeometry(base, top, 0.042, 0.026, 8), BARK, 0.2));
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t = 0.32 + (i / Math.max(1, n - 1)) * 0.66;
    const p = new THREE.Vector3().lerpVectors(base, top, t);
    const a = i * 2.4 + rng() * 0.5;
    // pétiole court
    const pet = new THREE.Vector3(
      p.x + Math.cos(a) * 0.14,
      p.y + 0.05 + rng() * 0.05,
      p.z + Math.sin(a) * 0.14,
    );
    b.stem.parts.push(finalize(stemGeometry(p, pet, 0.012, 0.008, 4), GREEN_MID, 0.5 + t * 0.4));
    const leaves = 6 + Math.floor(rng() * 3);
    for (let k = 0; k < leaves; k++) {
      const shade = GREEN_MID.clone().lerp(GREEN_LIGHT, rng() * 0.55).multiplyScalar(0.85 + rng() * 0.3);
      addLeaf(
        b.leaf,
        {
          length: 0.28 + rng() * 0.09,
          width: 0.2 + rng() * 0.05,
          segments: 7,
          droop: 0.05,
          fold: 0.22,
          twist: (rng() - 0.5) * 0.5,
          pinch: 0.28,
          rib: 0.008,
        },
        pet,
        a + (rng() - 0.5) * 1.4,
        -0.55 + rng() * 0.85,
        (rng() - 0.5) * 0.7,
        shade,
        0.55 + t * 0.45,
      );
    }
  }
}

/** Monstera : feuilles larges et fendues, port retombant. */
function buildMonstera(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const base = new THREE.Vector3(0, 0.16, 0);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.5;
    const len = 0.32 + rng() * 0.3;
    const end = new THREE.Vector3(
      base.x + Math.cos(a) * len * 0.55,
      base.y + 0.28 + rng() * 0.55,
      base.z + Math.sin(a) * len * 0.55,
    );
    b.stem.parts.push(finalize(stemGeometry(base, end, 0.014, 0.009, 5), GREEN_MID, 0.4 + rng() * 0.4));
    const shade = GREEN_DARK.clone().lerp(GREEN_MID, rng() * 0.6).multiplyScalar(0.88 + rng() * 0.28);
    addLeaf(
      b.leaf,
      {
        length: 0.34 + rng() * 0.14,
        width: 0.3 + rng() * 0.1,
        segments: 16,
        droop: 0.1,
        fold: 0.16,
        twist: (rng() - 0.5) * 0.35,
        slits: 3 + Math.floor(rng() * 2),
        slitDepth: 0.86,
        pinch: 0.12,
        rib: 0.01,
      },
      end,
      a + (rng() - 0.5) * 0.9,
      -1.1 + rng() * 0.7,
      (rng() - 0.5) * 0.5,
      shade,
      0.6 + rng() * 0.4,
    );
  }
}

/** Sansevieria : lames dressées, pliées en V, bord plus clair. */
function buildSansevieria(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.4;
    const r = 0.03 + rng() * 0.09;
    const at = new THREE.Vector3(Math.cos(a) * r, 0.16, Math.sin(a) * r);
    const shade = GREEN_DARK.clone().lerp(GREEN_MID, 0.2 + rng() * 0.7).multiplyScalar(0.9 + rng() * 0.15);
    addLeaf(
      b.leaf,
      {
        length: 0.62 + rng() * 0.34,
        width: 0.075 + rng() * 0.02,
        segments: 6,
        droop: 0.03 + rng() * 0.05,
        fold: 0.55,
        twist: (rng() - 0.5) * 1.1,
        pinch: 0.18,
      },
      at,
      a,
      (rng() - 0.5) * 0.22,
      (rng() - 0.5) * 0.2,
      shade,
      0.3 + rng() * 0.5,
    );
  }
}

/** Fougère : frondes arquées à pinnules. */
function buildFougere(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const fronds = 13;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng() * 0.35;
    const out = 0.44 + rng() * 0.26;
    const base = new THREE.Vector3(0, 0.13, 0);
    const mid = new THREE.Vector3(Math.cos(a) * out * 0.6, 0.13 + 0.44, Math.sin(a) * out * 0.6);
    const tip = new THREE.Vector3(Math.cos(a) * out, 0.13 + 0.2, Math.sin(a) * out);
    b.stem.parts.push(finalize(stemGeometry(base, mid, 0.008, 0.006, 4), GREEN_MID, 0.4));
    b.stem.parts.push(finalize(stemGeometry(mid, tip, 0.006, 0.004, 4), GREEN_MID, 0.8));
    // pinnules le long de la fronde (courbe quadratique base → mid → tip)
    const steps = 11;
    const frondPoint = (u: number): THREE.Vector3 => {
      const a = new THREE.Vector3().lerpVectors(base, mid, u);
      const c = new THREE.Vector3().lerpVectors(mid, tip, u);
      return a.lerp(c, u);
    };
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const p = frondPoint(t);
      const side = i % 2 === 0 ? 1 : -1;
      const w = 0.1 * (1 - t * 0.6);
      const shade = GREEN_MID.clone().lerp(GREEN_LIGHT, rng() * 0.8).multiplyScalar(0.85 + rng() * 0.25);
      addLeaf(
        b.leaf,
        { length: w, width: 0.026, segments: 3, droop: 0.012, fold: 0.25, pinch: 0.1 },
        p,
        a + side * 1.35,
        -0.25 + (rng() - 0.5) * 0.3,
        side * 0.5,
        shade,
        0.35 + t * 0.65,
      );
    }
  }
}

/** Pothos retombant : tiges qui passent par-dessus le bord du pot. */
function buildPothos(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const vines = 5;
  for (let v = 0; v < vines; v++) {
    const a = (v / vines) * Math.PI * 2 + rng() * 0.5;
    let p = new THREE.Vector3(Math.cos(a) * 0.06, 0.2, Math.sin(a) * 0.06);
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const dirx = Math.cos(a) * (0.055 + t * 0.02);
      const next = new THREE.Vector3(
        p.x + dirx * (0.7 + rng() * 0.6),
        p.y - (i < 2 ? 0.012 : 0.075 + t * 0.035),
        p.z + Math.sin(a) * (0.055 + t * 0.02) * (0.7 + rng() * 0.6),
      );
      b.stem.parts.push(finalize(stemGeometry(p, next, 0.006, 0.005, 4), GREEN_MID, 0.3 + t * 0.7));
      const shade = GREEN_MID.clone().lerp(GREEN_LIGHT, rng() * 0.6).multiplyScalar(0.85 + rng() * 0.25);
      addLeaf(
        b.leaf,
        { length: 0.085 + rng() * 0.05, width: 0.075 + rng() * 0.04, segments: 4, droop: 0.02, fold: 0.2, pinch: 0.2 },
        next,
        rng() * Math.PI * 2,
        -0.6 + rng() * 1.2,
        rng() * Math.PI,
        shade,
        0.3 + t * 0.7,
      );
      p = next;
    }
  }
}

/** Branches séchées d'eucalyptus : architecture, presque pas de feuilles. */
function buildEucalyptus(b: { leaf: Bucket; stem: Bucket; rng: () => number }): void {
  const { rng } = b;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.7;
    const tilt = 0.14 + rng() * 0.3;
    const len = 0.7 + rng() * 0.5;
    const base = new THREE.Vector3(0, 0.28, 0);
    const end = new THREE.Vector3(
      Math.cos(a) * Math.sin(tilt) * len,
      0.28 + Math.cos(tilt) * len,
      Math.sin(a) * Math.sin(tilt) * len,
    );
    b.stem.parts.push(finalize(stemGeometry(base, end, 0.009, 0.004, 4), BARK, 0.5));
    const leaves = 14 + Math.floor(rng() * 8);
    for (let k = 0; k < leaves; k++) {
      const t = 0.25 + rng() * 0.75;
      const p = new THREE.Vector3().lerpVectors(base, end, Math.min(1, t));
      p.x += (rng() - 0.5) * 0.1;
      p.y += (rng() - 0.5) * 0.1;
      p.z += (rng() - 0.5) * 0.1;
      const shade = GREEN_SAGE.clone().multiplyScalar(0.9 + rng() * 0.3);
      addLeaf(
        b.leaf,
        { length: 0.05, width: 0.042, segments: 3, droop: 0.004, fold: 0.3, pinch: 0.05 },
        p,
        rng() * Math.PI * 2,
        (rng() - 0.5) * 1.2,
        rng() * Math.PI,
        shade,
        0.4 + t * 0.6,
      );
    }
  }
}

/* --------------------------------- pots ----------------------------------- */

function potBuckets(kind: PotStyle): 'pot' | 'potWhite' | 'potStone' | 'potZinc' {
  return kind === 'blanc' ? 'potWhite' : kind === 'pierre' ? 'potStone' : kind === 'zinc' ? 'potZinc' : 'pot';
}

/** Pot tourné : profil évasé + col, avec épaisseur de lèvre. */
function potGeometry(style: PotStyle): { body: THREE.BufferGeometry; rim: THREE.BufferGeometry; r: number; h: number; rInner: number } {
  const isTerracotta = style === 'terracotta';
  const isTall = style === 'zinc';
  const h = isTerracotta ? 0.34 : isTall ? 0.44 : 0.3;
  const rTop = isTerracotta ? 0.185 : isTall ? 0.15 : 0.165;
  const rBot = rTop * (isTall ? 0.86 : 0.78);
  const lipOut = isTerracotta ? 0.026 : 0.014;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rBot, 0),
    new THREE.Vector2(rBot * 1.02, 0.02),
    new THREE.Vector2(rTop * 0.97, h * 0.92),
    new THREE.Vector2(rTop, h - 0.03),
    new THREE.Vector2(rTop + lipOut, h - 0.012),
    new THREE.Vector2(rTop + lipOut, h),
    new THREE.Vector2(rTop + lipOut - 0.018, h),
    new THREE.Vector2(rTop + lipOut - 0.018, h - 0.02),
    new THREE.Vector2(0.001, h - 0.02),
  ];
  const body = new THREE.LatheGeometry(pts, 34);
  const rim = new THREE.TorusGeometry(rTop + lipOut - 0.008, 0.006, 6, 30);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, h - 0.004, 0);
  return { body, rim, r: rTop + lipOut, h, rInner: rTop - 0.012 };
}

/* ------------------------------ matériaux --------------------------------- */

export function plantMaterials(aniso: number): PlantMaterials {
  const leafMap = leafTexture(aniso);
  const leaf = new THREE.MeshStandardMaterial({
    map: leafMap,
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    // feuilles vernissées : un peu d'IBL pour que les feuilles à l'ombre ne soient pas noires
    envMapIntensity: 0.45,
    // fausse translucidité : une feuille traversée par la lumière n'est jamais noire
    emissive: new THREE.Color(0x121a0e),
    emissiveIntensity: 1,
    side: THREE.DoubleSide,
  });
  // Feuillage fin (olive, eucalyptus) : un peu plus mat et plus clair sous la lumière.
  const foliage = new THREE.MeshStandardMaterial({
    map: leafMap,
    vertexColors: true,
    roughness: 0.66,
    metalness: 0,
    envMapIntensity: 0.4,
    emissive: new THREE.Color(0x14190f),
    side: THREE.DoubleSide,
  });
  const stem = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.12,
  });
  const pot = new THREE.MeshStandardMaterial({ color: 0x8a604a, roughness: 0.9, envMapIntensity: 0.16 });
  const potWhite = new THREE.MeshPhysicalMaterial({
    color: 0xf0ece4,
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.4,
  });
  const potStone = new THREE.MeshStandardMaterial({ color: 0x6a6560, roughness: 0.72, metalness: 0.04, envMapIntensity: 0.35 });
  const potZinc = new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.7 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.96, envMapIntensity: 0.05 });
  return { leaf, foliage, stem, pot, potWhite, potStone, potZinc, soil };
}

/* ------------------------------ placement --------------------------------- */

/**
 * Emplacements des plantes, déterministes. Les grands végétaux encadrent les portiques
 * et les extrémités du hall, les moyens rythment le mur droit, les petits vivent sur
 * les consoles / socles. Aucun doublon : chaque emplacement est unique.
 */
export function plantPlacements(layout: Layout): PlantPlacement[] {
  const { zMin, zMax } = hallBounds(layout);
  const out: PlantPlacement[] = [];
  const push = (p: Omit<PlantPlacement, 'rot' | 'scale'> & { scale?: number; rot?: number }): void => {
    const r = mulberry32(hash2(p.x, p.z));
    out.push({ rot: r() * Math.PI * 2, scale: p.scale ?? 1, ...p });
  };

  /**
   * Règle de placement : **jamais devant une toile**.
   *
   * Les œuvres occupent les deux murs tous les 2,8 m ; il ne reste de mur libre que les
   * **retours de seuil** (les murs transversaux, de part et d'autre du passage). C'est
   * donc là que vivent les plantes : à 2,9 m de l'axe et à 0,8 m du seuil, elles
   * encadrent les portes sans jamais masquer un cadre. (Avant, elles étaient collées aux
   * murs latéraux : un ficus se plantait devant une aquarelle.)
   */
  const species: PlantSpecies[] = ['olivier', 'ficus', 'monstera', 'sansevieria', 'fougere', 'eucalyptus', 'pothos'];
  const insetX = HALL_WIDTH / 2 - 1.35;
  portalPositions(layout).forEach((portal, i) => {
    const z = portal.z - 0.95; // côté salle (z décroît vers le fond)
    const a = species[(i * 2) % species.length];
    const b = species[(i * 2 + 3) % species.length];
    push({ x: -insetX, z, species: a, pot: i % 2 === 0 ? 'terracotta' : 'pierre', scale: 0.98 + (i % 3) * 0.06 });
    push({ x: insetX, z: z - 0.35, species: b, pot: i % 2 === 0 ? 'pierre' : 'terracotta', scale: 0.92 + (i % 4) * 0.05 });
  });

  // entrée : deux plantes qui accueillent, dans les angles du sas
  push({ x: -insetX - 0.35, z: zMax - 0.8, species: 'olivier', pot: 'pierre', scale: 1.1 });
  push({ x: insetX + 0.35, z: zMax - 0.8, species: 'fougere', pot: 'blanc', scale: 1.02 });

  // mur du fond : un eucalyptus haut dans un bac + une sansevieria
  push({ x: -1.9, z: zMin + 0.7, species: 'eucalyptus', pot: 'zinc', scale: 1.1 });
  push({ x: 2.1, z: zMin + 0.62, species: 'sansevieria', pot: 'terracotta', scale: 1.0 });

  // console du mur du fond : deux petites plantes sur le plateau (pas de collider)
  out.push({ x: -0.52, z: zMin + 0.34, species: 'sansevieria', pot: 'blanc', scale: 0.42, rot: 0.7, elevated: true });
  out.push({ x: 0.62, z: zMin + 0.32, species: 'pothos', pot: 'terracotta', scale: 0.9, rot: 2.1, elevated: true });

  return out;
}

/** Colliders des plantes (r = rayon du pot), pour Rapier. */
export function plantColliders(layout: Layout): { hx: number; hy: number; hz: number; x: number; y: number; z: number }[] {
  const out: { hx: number; hy: number; hz: number; x: number; y: number; z: number }[] = [];
  for (const p of plantPlacements(layout)) {
    if (p.elevated) continue;
    const { r } = potGeometry(p.pot);
    const rad = r * p.scale * 0.92;
    const h = 0.5 * p.scale;
    out.push({ hx: rad, hy: h, hz: rad, x: p.x, y: h, z: p.z });
  }
  return out;
}

/* ------------------------------- construction ----------------------------- */

export interface PlantsBuild {
  group: THREE.Group;
  /** Avance l'oscillation (s) ; amplitude nulle si `reduced`. */
  update(elapsed: number, reduced: boolean): void;
  dispose(): void;
}

export function buildPlants(layout: Layout, mats: PlantMaterials, shadows: boolean): PlantsBuild {
  const leafAll: THREE.BufferGeometry[] = [];
  const foliageAll: THREE.BufferGeometry[] = [];
  const stemAll: THREE.BufferGeometry[] = [];
  const potByKey: Record<string, THREE.BufferGeometry[]> = { pot: [], potWhite: [], potStone: [], potZinc: [] };
  const soilAll: THREE.BufferGeometry[] = [];

  for (const p of plantPlacements(layout)) {
    const rng = mulberry32(hash2(p.x, p.z));
    const leaf: Bucket = { parts: [] };
    const stem: Bucket = { parts: [] };
    const ctx = { leaf, stem, rng };

    // socle (pot) + terre
    const { body, rim, h: potH, rInner } = potGeometry(p.pot);
    const key = potBuckets(p.pot);
    const potM = matrixAt(p.x, 0, p.z, 0, p.rot, 0, p.scale);
    potByKey[key].push(finalize(body, new THREE.Color(0xffffff), 0, potM));
    potByKey[key].push(finalize(rim, new THREE.Color(0xffffff), 0, potM));
    const soilGeo = new THREE.CircleGeometry(Math.max(0.03, rInner * 0.94 * p.scale), 24);
    soilGeo.rotateX(-Math.PI / 2);
    soilGeo.translate(p.x, (potH - 0.05) * p.scale, p.z);
    soilAll.push(finalize(soilGeo, new THREE.Color(0xffffff), 0));

    switch (p.species) {
      case 'olivier':
        buildOlivier(ctx);
        break;
      case 'ficus':
        buildFicus(ctx);
        break;
      case 'monstera':
        buildMonstera(ctx);
        break;
      case 'sansevieria':
        buildSansevieria(ctx);
        break;
      case 'fougere':
        buildFougere(ctx);
        break;
      case 'pothos':
        buildPothos(ctx);
        break;
      case 'eucalyptus':
        buildEucalyptus(ctx);
        break;
    }

    const place = matrixAt(p.x, (potH - 0.045) * p.scale, p.z, 0, p.rot, 0, p.scale);
    const fine = p.species === 'olivier' || p.species === 'eucalyptus';
    for (const g of leaf.parts) {
      g.applyMatrix4(place);
      (fine ? foliageAll : leafAll).push(g);
    }
    for (const g of stem.parts) {
      g.applyMatrix4(place);
      stemAll.push(g);
    }
  }

  const group = new THREE.Group();
  group.name = 'vegetation';
  const merge = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
  };
  merge(leafAll, mats.leaf, 'feuillage-large');
  merge(foliageAll, mats.foliage, 'feuillage-fin');
  merge(stemAll, mats.stem, 'tiges');
  merge(potByKey.pot, mats.pot, 'pots-terre-cuite');
  merge(potByKey.potWhite, mats.potWhite, 'pots-blancs');
  merge(potByKey.potStone, mats.potStone, 'pots-pierre');
  merge(potByKey.potZinc, mats.potZinc, 'pots-zinc');
  merge(soilAll, mats.soil, 'terre');

  // ---- souffle : déplacement de sommet, poids `aSway`, coupé en reduced-motion ----
  const uniforms = { uTime: { value: 0 }, uAmp: { value: 0.011 } };
  const animate = (mat: THREE.MeshStandardMaterial): void => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uAmp = uniforms.uAmp;
      shader.vertexShader = 'attribute float aSway;\nuniform float uTime;\nuniform float uAmp;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float sw = aSway * aSway;
         float ph = position.x * 2.3 + position.z * 1.7 + position.y * 1.1;
         transformed.x += sin(uTime * 1.15 + ph) * uAmp * sw;
         transformed.z += cos(uTime * 0.9 + ph * 1.31) * uAmp * sw * 0.8;
         transformed.y += sin(uTime * 1.6 + ph * 0.7) * uAmp * 0.25 * sw;`,
      );
    };
    mat.customProgramCacheKey = () => 'sway';
    mat.needsUpdate = true;
  };
  animate(mats.leaf);
  animate(mats.foliage);

  return {
    group,
    update(elapsed: number, reduced: boolean): void {
      uniforms.uTime.value = elapsed;
      uniforms.uAmp.value = reduced ? 0 : 0.011;
    },
    dispose(): void {
      for (const child of group.children) {
        const m = child as THREE.Mesh;
        m.geometry.dispose();
      }
    },
  };
}
