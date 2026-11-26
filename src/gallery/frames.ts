/**
 * Cadres, passe-partout et picture lights — audit 3D §6 (P0-1, P0-2, P2-1, P2-2).
 *
 * Deux variantes, basculées par la constante exportée `FRAME_VARIANT` :
 *  - 'discrete' (défaut, variante A « discrète ») : caisse en chêne 55 mm, passe-partout
 *    20 mm, tube laiton Ø 22 mm sur ~74 % de la largeur, lentille émissive faible.
 *  - 'museum' (variante B « muséale ») : moulure 65 mm à deux gradins, passe-partout
 *    80 mm biseauté, verre, **aucun appareil visible** (la lumière vient d'un spot encastré).
 *
 * Repère local du `Group` d'œuvre (cf. paintings.ts) : +z va **vers la salle**
 * (le groupe est tourné de −π/2, donc x_monde = x_groupe − z_local). La face intérieure
 * du parement est à z_local 0,045 (mur de 0,25 m centré sur x = ±6, soit 5,875 m).
 *
 * Conséquence géométrique (P0-1) : tout ce qui doit être vu est **devant** 0,045, et
 * rien n'est coplanaire avec le parement ni entre soi — les écarts valent tous >= 3 mm,
 * ce qui reste très au-dessus de la précision du depth buffer 24 bits sur ~6 m.
 *
 * Coût : caisse (1 draw), passe-partout (1 draw), luminaire tube + bras (1 draw),
 * lentille (1 draw) → 4 draws par œuvre au lieu de 9, et aucun plan transparent.
 */
import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type FrameVariant = 'discrete' | 'museum';

/** Variante livrée. Passer à 'museum' pour la variante B de l'audit. */
export const FRAME_VARIANT: FrameVariant = 'discrete';

/** Un appareil visible est-il monté au-dessus de l'œuvre (variante A) ? */
export const PICTURE_LIGHT_VISIBLE = FRAME_VARIANT === 'discrete';

/** Face intérieure du parement dans le repère local du groupe (mur 0,25 m centré sur x = 6). */
export const WALL_FACE_Z = 0.045;

/**
 * Valeurs chiffrées à connaître côté `main.ts` / `lights.ts` :
 * - `spotLocal` : ancre du spot **dans** le luminaire (P1-5, la lumière sort de l'appareil) ;
 * - `lensPeak` : luminance HDR de la lentille (seul dépassement du seuil de bloom avec le
 *   cœur de verrière ; « faible » = à peine au-dessus de 1,0).
 */
export const FRAME_METRICS = {
  /** Ordonnée locale de l'axe du luminaire (monde : p.y + 1,05 = 2,60 m). */
  luminaireY: 1.05,
  /** Abscisse locale de l'ancre du spot (12 cm du parement, monde : p.x − 0,138). */
  spotZ: 0.138,
  /** Ordonnée locale du spot (sous le tube). */
  spotY: 1.03,
  /** Ordonnée locale de la cible du spot : centre haut de la toile. */
  targetY: 0.05,
  /** Luminance HDR de la lentille (MeshBasic HDR, avant tone mapping). */
  lensPeak: 1.35,
  /** Largeur du tube en fraction de la largeur de toile. */
  luminaireRatio: 0.74,
} as const;

interface VariantSpec {
  /** Largeur de la moulure vue de face. */
  frameWidth: number;
  /** Largeur du passe-partout visible. */
  matWidth: number;
  /** z_local du plan de toile. */
  canvasZ: number;
  /** z_local de la face avant du passe-partout. */
  matZ: number;
  /** z_local du bord avant du cadre. */
  frameFrontZ: number;
  /** Largeur du gradin intérieur (0 = profil plat). */
  stepWidth: number;
  /** Profondeur du gradin au-delà du bord avant. */
  stepDepth: number;
  /** Verre de protection (variante muséale). */
  glass: boolean;
  /** Picture light visible. */
  luminaire: boolean;
}

const SPECS: Record<FrameVariant, VariantSpec> = {
  discrete: {
    frameWidth: 0.055,
    matWidth: 0.02,
    canvasZ: 0.055,
    matZ: 0.062,
    frameFrontZ: 0.085,
    stepWidth: 0,
    stepDepth: 0,
    glass: false,
    luminaire: true,
  },
  museum: {
    frameWidth: 0.065,
    matWidth: 0.08,
    canvasZ: 0.05,
    matZ: 0.078,
    frameFrontZ: 0.09,
    stepWidth: 0.02,
    stepDepth: 0.011,
    glass: true,
    luminaire: false,
  },
};

/** Fond de caisse (dans le mur de 5 mm : c'est le montage, jamais visible). */
const FRAME_BACK_Z = 0.04;
/** Chevauchement passe-partout / toile : le passe-partout mord de 3 mm sur l'image. */
const MAT_OVERLAP = 0.003;
/** Biseau du passe-partout : 2,5 mm de retrait entre face avant et fenêtre arrière. */
const MAT_BEVEL = 0.0025;
/** Le passe-partout se glisse de 2 mm sous la moulure (aucune arête coplanaire). */
const MAT_TUCK = 0.002;

// ---------------------------------------------------------------------------
// Matériaux partagés (4 objets pour toutes les œuvres)
// ---------------------------------------------------------------------------

let matCache: {
  frame: THREE.MeshPhysicalMaterial;
  mat: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  lens: THREE.MeshBasicMaterial;
  glass: THREE.MeshPhysicalMaterial;
} | null = null;

function materials(): NonNullable<typeof matCache> {
  if (matCache) return matCache;
  const discrete = FRAME_VARIANT === 'discrete';
  // Variante A : chêne mat. Le guide de style donne #A08055 pour les cadres : sous
  // l'exposition 0,95 et l'ACES, un chêne moyen (0x7a5c3a) rend un brun chaud sans
  // sauter aux yeux. Un cadre charbon (0x2a2724) lisait « galerie contemporaine »
  // et pesait plus que les toiles sur un mur clair.
  // Variante B : bois teinté plus clair, avec verre.
  const frame = new THREE.MeshPhysicalMaterial({
    color: discrete ? 0x7a5c3a : 0x94764d,
    roughness: discrete ? 0.62 : 0.45,
    metalness: 0,
    clearcoat: discrete ? 0.08 : 0.15,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.4,
  });
  const mat = new THREE.MeshStandardMaterial({ color: 0xf6f2e9, roughness: 0.96, envMapIntensity: 0.2 });
  // Laiton patiné du tube : « plus clair que le cadre » et 22 mm de diamètre, il ne peut
  // plus lire comme une barre noire plus large que la toile (P0-2).
  const brass = new THREE.MeshStandardMaterial({ color: 0x8d7752, roughness: 0.42, metalness: 0.55, envMapIntensity: 0.9 });
  // Lentille : luminance HDR constante (non éclairée) → seul émissif volontaire de l'œuvre.
  const lens = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const k = FRAME_METRICS.lensPeak;
  lens.color.setRGB(k, 0.94 * k, 0.83 * k);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.06,
    roughness: 0.04,
    metalness: 0,
    envMapIntensity: 1,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  matCache = { frame, mat, brass, lens, glass };
  return matCache;
}

/** Libère les matériaux de cadre (une fois pour toutes, au démontage de la scène). */
export function disposeFrameMaterials(): void {
  if (!matCache) return;
  matCache.frame.dispose();
  matCache.mat.dispose();
  matCache.brass.dispose();
  matCache.lens.dispose();
  matCache.glass.dispose();
  matCache = null;
}

// ---------------------------------------------------------------------------
// Construction de géométries
// ---------------------------------------------------------------------------

/**
 * Anneau rectangulaire plat (4 quads) dans le plan XY, normale +z.
 * `outer`/`inner` = demi-largeurs, `z` = ordonnée. Winding CCW vu depuis +z.
 */
function flatRing(
  inner: readonly [number, number],
  outer: readonly [number, number],
  z: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
    d: readonly [number, number],
  ): void => {
    // a,b = arête extérieure (sens CCW) ; c,d = arête intérieure correspondante.
    pos.push(a[0], a[1], z, b[0], b[1], z, c[0], c[1], z);
    pos.push(a[0], a[1], z, c[0], c[1], z, d[0], d[1], z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  const [ox, oy] = outer;
  const [ix, iy] = inner;
  quad([-ox, -oy], [ox, -oy], [ix, -iy], [-ix, -iy]); // bas  (gauche → droite)
  quad([ox, -oy], [ox, oy], [ix, iy], [ix, -iy]); // droit (bas → haut)
  quad([ox, oy], [-ox, oy], [-ix, iy], [ix, iy]); // haut  (droite → gauche)
  quad([-ox, oy], [-ox, -oy], [-ix, -iy], [-ix, iy]); // gauche (haut → bas)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Biseau du passe-partout : anneau incliné entre (inner, zFront) et (inner−b, zBack). */
function bevelRing(
  innerFront: readonly [number, number],
  innerBack: readonly [number, number],
  zFront: number,
  zBack: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
    d: readonly [number, number],
  ): void => {
    pos.push(a[0], a[1], zFront, b[0], b[1], zFront, c[0], c[1], zBack);
    pos.push(a[0], a[1], zFront, c[0], c[1], zBack, d[0], d[1], zBack);
  };
  const [fx, fy] = innerFront;
  const [bx, by] = innerBack;
  quad([-fx, -fy], [fx, -fy], [bx, -by], [-bx, -by]);
  quad([fx, -fy], [fx, fy], [bx, by], [bx, -by]);
  quad([fx, fy], [-fx, fy], [-bx, by], [bx, by]);
  quad([-fx, fy], [-fx, -fy], [-bx, -by], [-bx, by]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // uv trivial (matériau non texturé) : évite un attribut manquant à la fusion.
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

/** 4 montants de moulure (boîtes) fusionnés en une seule géométrie. */
function frameBars(
  openingHalf: readonly [number, number],
  width: number,
  depth: number,
  zCenter: number,
  stepWidth: number,
  stepDepth: number,
): THREE.BufferGeometry {
  const [ox, oy] = openingHalf;
  const parts: THREE.BufferGeometry[] = [];
  // haut / bas : pleine largeur extérieure
  for (const sy of [-1, 1]) {
    const g = new THREE.BoxGeometry((ox + width) * 2, width, depth);
    g.translate(0, sy * (oy + width / 2), zCenter);
    parts.push(g);
  }
  // gauche / droite : hauteur de l'ouverture seulement (pas de recouvrement aux angles)
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(width, oy * 2, depth);
    g.translate(sx * (ox + width / 2), 0, zCenter);
    parts.push(g);
  }
  if (stepWidth > 0) {
    // gradin intérieur (variante muséale) : 2e plan de moulure, en saillie
    for (const sy of [-1, 1]) {
      const g = new THREE.BoxGeometry((ox + stepWidth) * 2, stepWidth, depth * 0.6);
      g.translate(0, sy * (oy + stepWidth / 2), zCenter + depth / 2 + stepDepth / 2 - depth * 0.2);
      parts.push(g);
    }
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(stepWidth, oy * 2, depth * 0.6);
      g.translate(sx * (ox + stepWidth / 2), 0, zCenter + depth / 2 + stepDepth / 2 - depth * 0.2);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('frames: fusion des montants impossible');
  return merged;
}

/** Tube Ø 22 mm + 2 bras plats, fusionnés (1 draw call). */
function luminaireGeometry(length: number, y: number, z: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tube = new THREE.CylinderGeometry(0.011, 0.011, length, 12, 1);
  tube.rotateZ(Math.PI / 2);
  tube.translate(0, y, z);
  parts.push(tube);
  for (const sx of [-1, 1]) {
    // bras : du parement (z 0,045) jusqu'à l'axe du tube
    const arm = new THREE.BoxGeometry(0.024, 0.03, z - WALL_FACE_Z + 0.006);
    arm.translate(sx * (length / 2 + 0.012), y, (WALL_FACE_Z + z) / 2);
    parts.push(arm);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('frames: fusion du luminaire impossible');
  return merged;
}

// ---------------------------------------------------------------------------

export interface FrameBuild {
  /** Caisse + passe-partout (+ verre) — à ajouter au groupe d'œuvre. */
  readonly root: THREE.Group;
  /** z_local du plan de toile (le mesh image est créé par paintings.ts). */
  readonly imageZ: number;
  /** Demi-largeur extérieure du cadre (positionnement du cartel). */
  readonly halfWidth: number;
  /** Luminaire (tube + bras + lentille) ou null en variante muséale. */
  readonly luminaire: THREE.Object3D | null;
  /** Ancre locale du spot, dans le luminaire (repère du groupe). */
  readonly spotLocal: THREE.Vector3;
  /** Cible locale du spot. */
  readonly spotTargetLocal: THREE.Vector3;
  /** Libère les géométries propres à cette œuvre (matériaux partagés : voir disposeFrameMaterials). */
  dispose(): void;
}

/**
 * Construit le cadre complet d'une œuvre de `w × h` (mètres).
 * `shadows` = le rendu projette-t-il des ombres (desktop) ; `coarse` désactive le verre.
 */
export function buildFrame(
  w: number,
  h: number,
  opts: { shadows: boolean; coarse: boolean; variant?: FrameVariant },
): FrameBuild {
  const variant = opts.variant ?? FRAME_VARIANT;
  const spec = SPECS[variant];
  const m = materials();
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];

  const canvasHalfX = w / 2;
  const canvasHalfY = h / 2;
  const matOuterHalf: [number, number] = [canvasHalfX + spec.matWidth, canvasHalfY + spec.matWidth];
  const openingHalf: [number, number] = [matOuterHalf[0] - MAT_TUCK, matOuterHalf[1] - MAT_TUCK];
  const depth = spec.frameFrontZ - FRAME_BACK_Z;

  const bars = frameBars(openingHalf, spec.frameWidth, depth, FRAME_BACK_Z + depth / 2, spec.stepWidth, spec.stepDepth);
  geos.push(bars);
  const frame = new THREE.Mesh(bars, m.frame);
  frame.castShadow = opts.shadows;
  frame.receiveShadow = opts.shadows;
  frame.name = 'cadre';
  root.add(frame);

  // Passe-partout : anneau plat + biseau de fenêtre (aucun plan plein → pas de z-fighting).
  const matInnerHalf: [number, number] = [canvasHalfX - MAT_OVERLAP, canvasHalfY - MAT_OVERLAP];
  const matFrontInner: [number, number] = [matInnerHalf[0] + MAT_BEVEL, matInnerHalf[1] + MAT_BEVEL];
  const ring = flatRing(matFrontInner, matOuterHalf, spec.matZ);
  const bev = bevelRing(matFrontInner, matInnerHalf, spec.matZ, spec.canvasZ + 0.0005);
  const matGeo = mergeGeometries([ring, bev], false);
  ring.dispose();
  bev.dispose();
  if (!matGeo) throw new Error('frames: fusion du passe-partout impossible');
  geos.push(matGeo);
  const matBoard = new THREE.Mesh(matGeo, m.mat);
  matBoard.receiveShadow = opts.shadows;
  matBoard.name = 'passe-partout';
  root.add(matBoard);

  if (spec.glass && !opts.coarse) {
    const geo = new THREE.PlaneGeometry(openingHalf[0] * 2, openingHalf[1] * 2);
    geos.push(geo);
    const glass = new THREE.Mesh(geo, m.glass);
    glass.position.z = spec.frameFrontZ - 0.003;
    glass.name = 'verre';
    root.add(glass);
  }

  let luminaire: THREE.Object3D | null = null;
  if (spec.luminaire) {
    const y = FRAME_METRICS.luminaireY;
    const z = 0.14;
    const len = w * FRAME_METRICS.luminaireRatio;
    const geo = luminaireGeometry(len, y, z);
    geos.push(geo);
    const body = new THREE.Mesh(geo, m.brass);
    body.castShadow = opts.shadows;
    body.name = 'luminaire';
    root.add(body);

    const lensGeo = new THREE.PlaneGeometry(len * 0.96, 0.01);
    geos.push(lensGeo);
    const lens = new THREE.Mesh(lensGeo, m.lens);
    lens.rotation.x = Math.PI / 2; // normale −y : la fente est vue de dessous
    lens.position.set(0, y - 0.0115, z + 0.001);
    lens.name = 'lentille';
    root.add(lens);

    luminaire = body;
  }

  return {
    root,
    imageZ: spec.canvasZ,
    halfWidth: openingHalf[0] + spec.frameWidth,
    luminaire,
    spotLocal: new THREE.Vector3(0, FRAME_METRICS.spotY, FRAME_METRICS.spotZ),
    spotTargetLocal: new THREE.Vector3(0, FRAME_METRICS.targetY, 0.06),
    dispose(): void {
      for (const g of geos) g.dispose();
      geos.length = 0;
    },
  };
}
