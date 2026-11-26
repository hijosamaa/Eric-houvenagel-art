/**
 * Cadres, passe-partout et picture lights — audit 3D §6 (P0-1, P0-2, P2-1, P2-2).
 *
 * Trois variantes, basculées par la constante exportée `FRAME_VARIANT` :
 *  - 'gilt' (défaut, livrée) : moulure dorée 70 mm avec **doucine** (anneau incliné
 *    en retrait, plus sombre via couleur de sommet), passe-partout crème 55 mm,
 *    tube laiton Ø 22 mm sur ~62 % de la largeur, lentille émissive faible.
 *    La caisse + doucine sont fusionnées en UNE géométrie à couleurs de sommets
 *    (1 draw call) : le profil capte la lumière différemment, ça ne lit plus « bande plate ».
 *  - 'discrete' (variante A historique) : caisse en chêne 55 mm, passe-partout 20 mm.
 *  - 'museum' (variante B « muséale ») : moulure 65 mm à deux gradins, passe-partout
 *    80 mm biseauté, verre, aucun appareil visible.
 *
 * Repère local du `Group` d'œuvre (cf. paintings.ts) : +z va **vers la salle**
 * (groupe tourné de ±π/2 selon le mur ; après le flip des œuvres au mur gauche,
 * rotation.y = +π/2 et x_monde = x_groupe + z_local). La face intérieure du parement
 * est à z_local 0,045 (mur de 0,25 m centré sur x = ±6, soit 5,875 m).
 *
 * Conséquence géométrique (P0-1) : tout ce qui doit être vu est **devant** 0,045, et
 * rien n'est coplanaire avec le parement ni entre soi — les écarts valent tous >= 3 mm,
 * ce qui reste très au-dessus de la précision du depth buffer 24 bits sur ~6 m.
 *
 * Coût : caisse+doucine (1 draw), passe-partout (1 draw), luminaire tube + bras (1 draw),
 * lentille (1 draw) → 4 draws par œuvre au lieu de 9, et aucun plan transparent.
 */
import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { giltTexture } from './textures';

export type FrameVariant = 'discrete' | 'gilt' | 'museum';

/** Variante livrée. Passer à 'museum' ou 'discrete' pour les variantes de l'audit. */
export const FRAME_VARIANT: FrameVariant = 'gilt';

/** Un appareil visible est-il monté au-dessus de l'œuvre ? */
export const PICTURE_LIGHT_VISIBLE: boolean = (FRAME_VARIANT as FrameVariant) !== 'museum';

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
  /** Profondeur locale de l'ancre du spot (dans la salle, devant le parement). */
  spotZ: 0.138,
  /** Ordonnée locale du spot (sous le tube). */
  spotY: 1.03,
  /** Ordonnée locale de la cible du spot : centre de la toile (éclairage uniforme). */
  targetY: 0.0,
  /** Luminance HDR de la lentille (MeshBasic HDR, avant tone mapping) — juste au-dessus du seuil de bloom. */
  lensPeak: 1.12,
  /** Largeur du tube en fraction de la largeur de toile. */
  luminaireRatio: 0.62,
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
  /** Largeur = profondeur de la doucine intérieure (variante gilt ; 0 sinon). */
  cove: number;
}

const SPECS: Record<FrameVariant, VariantSpec> = {
  gilt: {
    frameWidth: 0.07,
    matWidth: 0.055,
    canvasZ: 0.06,
    matZ: 0.07,
    frameFrontZ: 0.1,
    stepWidth: 0,
    stepDepth: 0,
    glass: false,
    luminaire: true,
    cove: 0.02,
  },
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
    cove: 0,
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
    cove: 0,
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
  gilt: THREE.MeshPhysicalMaterial;
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
  // Dorure : métal réel + texture (brossage/mouchetures, remplaçable par IA via
  // assets/textures/ai/gilt.webp). vertexColors = la doucine est assombrie par sommet,
  // donc caisse + doucine tiennent en UN draw call. envMapIntensity haut pour compenser
  // scene.environmentIntensity = 0,5 (sinon l'or paraît plastique).
  const gilt = new THREE.MeshPhysicalMaterial({
    map: giltTexture(8),
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.88,
    clearcoat: 0.18,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.8,
    side: THREE.DoubleSide,
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
  matCache = { frame, gilt, mat, brass, lens, glass };
  return matCache;
}

/** Libère les matériaux de cadre (une fois pour toutes, au démontage de la scène). */
export function disposeFrameMaterials(): void {
  if (!matCache) return;
  matCache.frame.dispose();
  matCache.gilt.dispose();
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

/** Anneau incliné teinté (doucine dorée) — fusionnable avec les montants (attribut color). */
function coveRing(
  innerFront: readonly [number, number],
  drop: number,
  zFront: number,
): THREE.BufferGeometry {
  const g = bevelRing(
    innerFront,
    [innerFront[0] + drop, innerFront[1] + drop],
    zFront,
    zFront - drop,
  );
  return paint(g, 0.6, 0.5, 0.36); // doucine plus sombre → le profil accroche la lumière
}

/** Teinte uniforme d'une géométrie (attribut `color`, pour les matériaux vertexColors). */
function paint(geo: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
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
  // les anneaux (doucine) sont non indexés → on convertit les boîtes pour fusionner
  const push = (g: THREE.BufferGeometry): void => {
    const ni = g.index ? g.toNonIndexed() : g;
    if (ni !== g) g.dispose();
    parts.push(ni);
  };
  // haut / bas : pleine largeur extérieure
  for (const sy of [-1, 1]) {
    const g = new THREE.BoxGeometry((ox + width) * 2, width, depth);
    g.translate(0, sy * (oy + width / 2), zCenter);
    push(g);
  }
  // gauche / droite : hauteur de l'ouverture seulement (pas de recouvrement aux angles)
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(width, oy * 2, depth);
    g.translate(sx * (ox + width / 2), 0, zCenter);
    push(g);
  }
  if (stepWidth > 0) {
    // gradin intérieur (variante muséale) : 2e plan de moulure, en saillie
    for (const sy of [-1, 1]) {
      const g = new THREE.BoxGeometry((ox + stepWidth) * 2, stepWidth, depth * 0.6);
      g.translate(0, sy * (oy + stepWidth / 2), zCenter + depth / 2 + stepDepth / 2 - depth * 0.2);
      push(g);
    }
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(stepWidth, oy * 2, depth * 0.6);
      g.translate(sx * (ox + stepWidth / 2), 0, zCenter + depth / 2 + stepDepth / 2 - depth * 0.2);
      push(g);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('frames: fusion des montants impossible');
  return paint(merged, 1, 1, 1);
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
/**
 * Cache de géométries par (variante, w, h) : toutes les œuvres de même taille
 * (ex. ratio 1 → 1,50 × 1,50 m) partagent les mêmes buffers → le hall à 30+ œuvres
 * ne duplique pas la mémoire GPU. Les géométries cachées ne sont jamais `dispose()`
 * individuellement (voir `dispose()` de FrameBuild).
 */
interface CachedGeos {
  frame: THREE.BufferGeometry;
  mat: THREE.BufferGeometry;
  lum: THREE.BufferGeometry | null;
  lens: THREE.BufferGeometry | null;
}
const geoCache = new Map<string, CachedGeos>();

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

  const cacheKey = `${variant}:${w.toFixed(3)}x${h.toFixed(3)}`;
  let cached = geoCache.get(cacheKey);
  if (!cached) {
    // caisse (montants, teintés blanc) + doucine (anneau incliné assombri) fusionnées :
    // 1 draw call, le profil varie en normale donc en lumière.
    const bars = frameBars(openingHalf, spec.frameWidth, depth, FRAME_BACK_Z + depth / 2, spec.stepWidth, spec.stepDepth);
    const frameParts: THREE.BufferGeometry[] = [bars];
    if (spec.cove > 0) {
      frameParts.push(coveRing(openingHalf, spec.cove, spec.frameFrontZ));
    }
    const frameGeo = mergeGeometries(frameParts, false);
    for (const p of frameParts) p.dispose();
    if (!frameGeo) throw new Error('frames: fusion du cadre impossible');

    // Passe-partout : anneau plat + biseau de fenêtre (aucun plan plein → pas de z-fighting).
    const matInnerHalf: [number, number] = [canvasHalfX - MAT_OVERLAP, canvasHalfY - MAT_OVERLAP];
    const matFrontInner: [number, number] = [matInnerHalf[0] + MAT_BEVEL, matInnerHalf[1] + MAT_BEVEL];
    const ring = flatRing(matFrontInner, matOuterHalf, spec.matZ);
    const bev = bevelRing(matFrontInner, matInnerHalf, spec.matZ, spec.canvasZ + 0.0005);
    const matGeo = mergeGeometries([ring, bev], false);
    ring.dispose();
    bev.dispose();
    if (!matGeo) throw new Error('frames: fusion du passe-partout impossible');

    let lumGeo: THREE.BufferGeometry | null = null;
    let lensGeo: THREE.BufferGeometry | null = null;
    if (spec.luminaire) {
      lumGeo = luminaireGeometry(w * FRAME_METRICS.luminaireRatio, FRAME_METRICS.luminaireY, 0.14);
      lensGeo = new THREE.PlaneGeometry(w * FRAME_METRICS.luminaireRatio * 0.96, 0.01);
    }
    cached = { frame: frameGeo, mat: matGeo, lum: lumGeo, lens: lensGeo };
    geoCache.set(cacheKey, cached);
  }

  const frame = new THREE.Mesh(cached.frame, variant === 'gilt' ? m.gilt : m.frame);
  frame.castShadow = opts.shadows;
  frame.receiveShadow = opts.shadows;
  frame.name = 'cadre';
  root.add(frame);

  // Passe-partout (géométrie cachée, partagée entre œuvres de même taille).
  const matBoard = new THREE.Mesh(cached.mat, m.mat);
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
  if (spec.luminaire && cached.lum && cached.lens) {
    const y = FRAME_METRICS.luminaireY;
    const z = 0.14;
    const body = new THREE.Mesh(cached.lum, m.brass);
    body.castShadow = opts.shadows;
    body.name = 'luminaire';
    root.add(body);

    const lens = new THREE.Mesh(cached.lens, m.lens);
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
