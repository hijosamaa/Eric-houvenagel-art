import * as THREE from 'three';

/**
 * Ombres de contact au sol (bancs, socles, pots, consoles).
 *
 * Pourquoi une texture et pas seulement le GTAO : à 1,6 m de haut, le GTAO (rayon 0,45 m)
 * donne une occlusion juste, mais elle est calculée à la résolution du G-buffer et se
 * perd dès que l'objet est à plus de 4 m. Une tache radiale très douce, posée à 4 mm du
 * sol, est ce qui « colle » réellement un meuble à son parquet — c'est le premier détail
 * qui manque quand un rendu a l'air d'un collage.
 *
 * Le décalage de 4 mm évite le z-fighting ; `depthWrite: false` et le rendu après la
 * géométrie opaque garantissent qu'elle ne masque jamais rien.
 */

export interface ContactBox {
  x: number;
  z: number;
  /** Demi-largeur (x) et demi-profondeur (z) de l'emprise. */
  hx: number;
  hz: number;
  /** Intensité relative (1 = référence). */
  strength?: number;
}

/** Dégradé radial doux, teinté par la couleur du matériau (noir chaud). */
function shadowTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // cœur dense puis décroissance quadratique : une ombre de contact, pas un halo
  grad.addColorStop(0, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function buildContactShadows(boxes: ContactBox[], shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ombres-contact';
  if (boxes.length === 0) return group;

  const tex = shadowTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0x2b2118,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    fog: true,
  });

  const geos: THREE.BufferGeometry[] = [];
  for (const b of boxes) {
    // marge : l'ombre déborde de 22 cm autour de l'emprise (pénombre)
    const w = (b.hx + 0.22) * 2;
    const d = (b.hz + 0.22) * 2;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(b.x, 0.004, b.z);
    // intensité par sommet : permet des taches discrètes (petits pots) et franches (bancs)
    const k = b.strength ?? 1;
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i++) col[i] = k;
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }

  const merged = geos.length === 1 ? geos[0] : mergeAll(geos);
  for (const g of geos) if (g !== merged) g.dispose();
  const mesh = new THREE.Mesh(merged, mat);
  mesh.material.vertexColors = true;
  mesh.receiveShadow = shadows;
  mesh.renderOrder = 2;
  mesh.name = 'taches-contact';
  group.add(mesh);
  return group;
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // fusion minimale (position/uv/color) — évite d'importer BufferGeometryUtils ici
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute;
    const c = g.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i);
      pos[(o + i) * 3 + 1] = p.getY(i);
      pos[(o + i) * 3 + 2] = p.getZ(i);
      uv[(o + i) * 2] = u.getX(i);
      uv[(o + i) * 2 + 1] = u.getY(i);
      col[(o + i) * 3] = c.getX(i);
      col[(o + i) * 3 + 1] = c.getY(i);
      col[(o + i) * 3 + 2] = c.getZ(i);
    }
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
