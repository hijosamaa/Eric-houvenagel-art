import * as THREE from 'three';

/**
 * Charpente, menuiserie et mobilier en bois massif : prismes à section **chanfreinée**,
 * avec des UV en mètres le long du fil (le grain suit l'axe de la pièce).
 *
 * Pourquoi ce module : une poutre = un `BoxGeometry` donne une arête vive, une lumière
 * plate sur les quatre faces et aucune lecture du fil du bois — d'où l'effet « trois
 * rectangles ». Un chanfrein de 18 mm suffit à créer deux facettes qui accrochent la
 * lumière et une arête adoucie : c'est ce qui fait lire une pièce de charpente.
 */

/** Pas de texture le long du fil (m) et autour de la section (m). */
const TILE_V = 2.6;
const TILE_U = 1.4;

export interface TimberOpts {
  /** Longueur de la pièce (axe +Z, centrée). */
  length: number;
  /** Largeur (axe X). */
  width: number;
  /** Hauteur (axe Y). */
  height: number;
  /** Chanfrein (m). 0 = arêtes vives. */
  chamfer?: number;
  /** Échelle du grain le long du fil (défaut TILE_V). */
  tileV?: number;
}

/**
 * Section rectangulaire chanfreinée (octogone), dans le plan XY, sens horaire vu de +Z.
 * Renvoie les sommets dans l'ordre, avec la largeur selon X et la hauteur selon Y.
 */
export function chamferedSection(width: number, height: number, chamfer: number): [number, number][] {
  const hw = width / 2;
  const hh = height / 2;
  const c = Math.max(0.0001, Math.min(chamfer, Math.min(hw, hh) * 0.42));
  if (chamfer <= 0) {
    return [
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
      [-hw, -hh],
    ];
  }
  return [
    [hw, -hh + c],
    [hw, hh - c],
    [hw - c, hh],
    [-hw + c, hh],
    [-hw, hh - c],
    [-hw, -hh + c],
    [-hw + c, -hh],
    [hw - c, -hh],
  ];
}

/**
 * Prisme extrudé depuis une section fermée, le long de +Z, centré sur z = 0.
 * UV : `u` = périmètre (m) / TILE_U, `v` = z (m) / tileV → le fil du bois suit la longueur.
 * Les faces de bout reçoivent des UV projetées (le grain y apparaît en coupe).
 */
export function extrudedPrism(
  section: readonly [number, number][],
  length: number,
  opts: { tileV?: number; tileU?: number; caps?: boolean } = {},
): THREE.BufferGeometry {
  const tileV = opts.tileV ?? TILE_V;
  const tileU = opts.tileU ?? TILE_U;
  const n = section.length;
  const hz = length / 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];

  // périmètre cumulé pour u
  const perim: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const a = section[i - 1];
    const b = section[i % n];
    perim.push(perim[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  const push = (p: [number, number, number], t: [number, number], nv: [number, number, number]): void => {
    pos.push(p[0], p[1], p[2]);
    uv.push(t[0], t[1]);
    nrm.push(nv[0], nv[1], nv[2]);
  };

  for (let i = 0; i < n; i++) {
    const a = section[i];
    const b = section[(i + 1) % n];
    // normale de la facette (section en sens horaire dans XY → normale vers l'extérieur)
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len;
    const ny = -ex / len;
    const u0 = perim[i] / tileU;
    const u1 = perim[i + 1] / tileU;
    const v0 = -hz / tileV;
    const v1 = hz / tileV;
    // deux triangles (quad)
    push([a[0], a[1], -hz], [u0, v0], [nx, ny, 0]);
    push([b[0], b[1], -hz], [u1, v0], [nx, ny, 0]);
    push([b[0], b[1], hz], [u1, v1], [nx, ny, 0]);
    push([a[0], a[1], -hz], [u0, v0], [nx, ny, 0]);
    push([b[0], b[1], hz], [u1, v1], [nx, ny, 0]);
    push([a[0], a[1], hz], [u0, v1], [nx, ny, 0]);
  }

  if (opts.caps !== false) {
    for (const sgn of [-1, 1]) {
      const zz = sgn * hz;
      const nz: [number, number, number] = [0, 0, sgn];
      for (let i = 1; i < n - 1; i++) {
        const a = section[0];
        const b = section[i];
        const c = section[i + 1];
        const tri = sgn > 0 ? [a, b, c] : [a, c, b];
        for (const p of tri) {
          push([p[0], p[1], zz], [p[0] / tileU, p[1] / tileU], nz);
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** Poutre / nervure chanfreinée, longueur selon +Z, centrée. */
export function timberGeometry(opts: TimberOpts): THREE.BufferGeometry {
  const c = opts.chamfer ?? Math.min(opts.width, opts.height) * 0.12;
  return extrudedPrism(chamferedSection(opts.width, opts.height, c), opts.length, { tileV: opts.tileV });
}

/** Même pièce mais couchée sur X (traverse, linteau). */
export function timberX(opts: TimberOpts): THREE.BufferGeometry {
  const g = timberGeometry(opts);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Même pièce mais debout (pied, montant) : le fil monte, la base est à y = 0. */
export function timberY(opts: TimberOpts): THREE.BufferGeometry {
  const g = timberGeometry(opts);
  g.rotateX(-Math.PI / 2);
  g.translate(0, opts.length / 2, 0);
  return g;
}

/** Prisme vertical quelconque (socle, fût) : section en plan `width × depth`, hauteur `height`. */
export function prismY(width: number, depth: number, height: number, chamfer = 0.004): THREE.BufferGeometry {
  const g = extrudedPrism(chamferedSection(width, height, chamfer), depth, { tileV: 1 });
  g.translate(0, height / 2, 0);
  return g;
}
