import * as THREE from 'three';

import type { Layout, PlacedWork } from './layout';

import type { Work } from '../types';

import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

import { WALL_FACE_Z, buildFrame, type FrameBuild } from './frames';

// Patch unique (niveau module) : raycast accéléré par BVH quand geometry.boundsTree
// est présent, sinon retombe sur le raycast three d'origine (comportement identique).
// Le flag raycaster.firstHitOnly = true (voir controls.ts / main.ts) ne garde que le hit le plus proche.
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

export interface PaintingEntry {
  placed: PlacedWork;
  group: THREE.Group;
  imageMesh: THREE.Mesh;
  frame: FrameBuild;
  tex: THREE.Texture | null;
  loaded: boolean;
  loadStarted: boolean;
}

/**
 * Émissif de la toile (P0-3) : la luminance doit venir de la lumière, pas du matériau.
 * 0 au repos, 0,03 au survol — le survol est porté par le spot (`TABLE_SPOT.hoverBoost`)
 * et par le curseur, pas par la toile qui s'« allume » comme un écran.
 */
const CANVAS_EMISSIVE_IDLE = 0;
const CANVAS_EMISSIVE_HOVER = 0.03;

/** Anisotropie minimale des toiles : le sujet ne doit pas être le moins bien filtré (P1-8). */
const CANVAS_MIN_ANISO = 8;
const CANVAS_MAX_ANISO = 16;

let hoveredId: string | null = null;

function applyHover(e: PaintingEntry): void {
  const mat = e.imageMesh.material as THREE.MeshStandardMaterial;
  const active = e.placed.work.id === hoveredId;
  mat.emissiveIntensity = active && e.loaded ? CANVAS_EMISSIVE_HOVER : CANVAS_EMISSIVE_IDLE;
  // Le tableau ne BOUGE PAS au survol (le scale 1.012 faisait « fake ») : seul le spot
  // et le curseur « Voir » répondent (voir main.ts).
}

export function setHovered(id: string | null, entries: PaintingEntry[]): void {
  hoveredId = id;
  for (const e of entries) applyHover(e);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- Atlas de cartels : 1 texture pour toutes les œuvres ----------
// 2048×2048 → 64 cellules (8 cols) ; au-delà (?dup=N), on passe à 4096 → 256 cellules.
const ATLAS_SIZE = 2048;
const ATLAS_SIZE_BIG = 4096;
const ATLAS_COLS = 8;
let atlasCell = ATLAS_SIZE / ATLAS_COLS;

function drawLabel(g: CanvasRenderingContext2D, work: Work, x: number, y: number, s: number): void {
  // Cartel : carte crème, texte encre. Une carte blanche en `MeshBasicMaterial`
  // s'allumait comme une boîte à lumière ; ici la carte est éclairée comme le mur.
  g.fillStyle = '#f8f4ec';
  g.fillRect(x, y, s, s);
  g.fillStyle = '#eee8dc';
  g.fillRect(x, y, s, s * 0.012);
  g.strokeStyle = 'rgba(140,130,112,0.55)';
  g.lineWidth = 2;
  g.strokeRect(x + 2, y + 2, s - 4, s - 4);
  g.fillStyle = '#1b1f24';
  g.font = `600 ${Math.round(s * 0.12)}px Georgia, serif`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(truncate(work.title, 22), x + s * 0.075, y + s * 0.37, s * 0.85);
  g.fillStyle = '#4d4a43';
  g.font = `${Math.round(s * 0.082)}px Inter, system-ui, sans-serif`;
  const line2 = [work.year > 0 ? String(work.year) : null, work.medium].filter(Boolean).join(', ');
  g.fillText(truncate(line2, 38), x + s * 0.075, y + s * 0.585, s * 0.85);
  g.fillStyle = '#5f5b52';
  g.font = `${Math.round(s * 0.072)}px Inter, system-ui, sans-serif`;
  if (work.dimensions) {
    g.fillText(truncate(work.dimensions, 38), x + s * 0.075, y + s * 0.75, s * 0.85);
  }
}

function buildLabelAtlas(works: Work[]): THREE.CanvasTexture {
  const size = works.length > 64 ? ATLAS_SIZE_BIG : ATLAS_SIZE;
  atlasCell = size / ATLAS_COLS;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  works.forEach((w, i) => {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    drawLabel(g, w, col * atlasCell, row * atlasCell, atlasCell);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Halo d'ombre de contact **sur le mur**, autour du cadre.
 *
 * Un cadre de 7 cm de saillie projette sur le parement une ombre qui meurt en 4 à 8 cm.
 * Elle manquait totalement : la mesure donnait 150 ± 2,3 sur le mur à 10 cm sous un
 * cadre, c'est-à-dire **exactement la valeur du mur nu**. C'est ce détail qui fait la
 * différence entre une image de synthèse et une photo d'accrochage.
 *
 * Un seul matériau et un seul dégradé sont partagés : 30 quads, 1 texture, 1 draw call
 * par toile (les quads sont fusionnés avec le groupe de l'œuvre, donc rien de plus).
 */
function wallHaloTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  // cœur plein (caché derrière le cadre) puis décroissance : l'ombre ne se voit que dans
  // la couronne, entre le bord du cadre et 8 cm plus loin.
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.34)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function labelGeometry(index: number, w: number, h: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h);
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const u0 = col / ATLAS_COLS;
  const v0 = 1 - (row + 1) / ATLAS_COLS; // flipY : la rangée 0 est en haut du canvas
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) / ATLAS_COLS, v0 + uv.getY(i) / ATLAS_COLS);
  }
  uv.needsUpdate = true;
  return geo;
}

// -----------------------------------------------------------------------------

/**
 * Construit les œuvres : cadre + passe-partout + luminaire via `frames.ts` (P0-1, P0-2),
 * toile seule à recevoir la texture.
 *
 * `coarse` est optionnel pour rester compatible avec l'appel actuel de `main.ts` ;
 * il ne sert qu'à couper le verre de la variante muséale.
 */
export function buildPaintings(
  scene: THREE.Scene,
  layout: Layout,
  shadows: boolean,
  coarse = false,
): PaintingEntry[] {
  const atlas = buildLabelAtlas(layout.placed.map((p) => p.work));
  const labelMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.94, envMapIntensity: 0.12 });
  const haloMat = new THREE.MeshBasicMaterial({
    map: wallHaloTexture(),
    color: 0x2a2118,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    fog: true,
  });
  const entries: PaintingEntry[] = [];

  layout.placed.forEach((p, i) => {
    const group = new THREE.Group();
    group.position.set(p.x, p.y, p.z);
    // +π/2 quand le tableau est au mur gauche (faceX = +1) : la normale +z locale part
    // vers +x, c'est-à-dire vers la salle.
    group.rotation.y = p.rotY;

    // Moulures variées (dorée / discrète / muséale) : trente cadres identiques trahissent
    // le catalogue. Le choix suit l'index pour rester stable d'un rendu à l'autre.
    const variant = (['gilt', 'discrete', 'gilt', 'museum'] as const)[i % 4];
    const frame = buildFrame(p.w, p.h, { shadows, coarse, variant });
    group.add(frame.root);

    // Toile : plan nu, mate (pas de vernis spéculaire qui refléterait la verrière),
    // BVH pour le picking.
    const imgMat = new THREE.MeshStandardMaterial({
      color: 0xe3ded6,
      // Papier mat : roughness 1 étale le reflet de l'appareil en un voile large.
      // Avec 0,8 le spot dessinait une petite tache blanche nette sur la toile.
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.06,
    });
    const imgGeo = new THREE.PlaneGeometry(p.w, p.h);
    imgGeo.boundsTree = new MeshBVH(imgGeo);
    const imageMesh = new THREE.Mesh(imgGeo, imgMat);
    imageMesh.position.z = frame.imageZ;
    imageMesh.userData.workId = p.work.id;
    imageMesh.name = 'toile';
    group.add(imageMesh);

    // Halo d'ombre de contact : 1 mm devant le parement, débord de 9 cm.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(frame.halfWidth * 2 + 0.18, frame.halfHeight * 2 + 0.18),
      haloMat,
    );
    halo.position.z = WALL_FACE_Z + 0.002;
    halo.name = 'halo-cadre';
    group.add(halo);

    // Cartel musée : sur une petite plaque métal décollée du mur (14 mm), à ~24 cm du
    // cadre, centrée vers ~1,15 m — plus « collé » au mur ni au cadre. L'offset est
    // clampé pour ne jamais toucher le cadre de l'œuvre suivante (pano w=2,4).
    const nextP = layout.placed[i + 1];
    const hwNext = nextP ? nextP.w / 2 + 0.123 : 0;
    const gap = nextP ? p.z - nextP.z - (frame.halfWidth + hwNext) : 1;
    const labelOff = frame.halfWidth + Math.max(0.08, Math.min(0.24, gap / 2 - 0.13));
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x2b2a27,
      roughness: 0.62,
      metalness: 0.1,
      envMapIntensity: 0.3,
    });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.148, 0.009), plateMat);
    plate.position.set(labelOff, -p.h / 2 + 0.42, 0.05);
    plate.receiveShadow = shadows;
    plate.name = 'cartel-plaque';
    group.add(plate);
    const label = new THREE.Mesh(labelGeometry(i, 0.225, 0.137), labelMat);
    label.position.set(labelOff, -p.h / 2 + 0.42, 0.0548);
    label.name = 'cartel';
    group.add(label);

    scene.add(group);
    entries.push({ placed: p, group, imageMesh, frame, tex: null, loaded: false, loadStarted: false });
  });

  return entries;
}

export function ensureTexture(entry: PaintingEntry, baseUrl: string, aniso: number, onLoad?: () => void): void {
  if (entry.loadStarted) return;
  entry.loadStarted = true;
  new THREE.TextureLoader().load(baseUrl + entry.placed.work.image, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    // P1-8 : les toiles sont vues en incidence rasante (mur latéral) ; 8 minimum, 16 si
    // le renderer le permet (three borne à `capabilities.getMaxAnisotropy()`).
    tex.anisotropy = Math.min(CANVAS_MAX_ANISO, Math.max(CANVAS_MIN_ANISO, aniso));
    const mat = entry.imageMesh.material as THREE.MeshStandardMaterial;
    mat.map = tex;
    // L'emissiveMap reste branchée : c'est le canal du survol (intensité 0,03), donc
    // aucune texture supplémentaire et aucun re-upload au hover.
    mat.emissiveMap = tex;
    mat.emissive = new THREE.Color(0xffffff);
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    entry.tex = tex;
    entry.loaded = true;
    applyHover(entry);
    onLoad?.();
  });
}

/** Libère la texture GPU d'une œuvre trop éloignée (LRU) — rechargeable via ensureTexture. */
export function releaseTexture(entry: PaintingEntry): void {
  if (!entry.loaded) return;
  entry.tex?.dispose();
  entry.tex = null;
  const mat = entry.imageMesh.material as THREE.MeshStandardMaterial;
  mat.map = null;
  mat.emissiveMap = null;
  mat.color.set(0xe3ded6);
  mat.needsUpdate = true;
  entry.loaded = false;
  entry.loadStarted = false;
}
