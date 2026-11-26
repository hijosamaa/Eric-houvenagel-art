import * as THREE from 'three';

import type { Layout, PlacedWork } from './layout';

import type { Work } from '../types';

import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

import { buildFrame, type FrameBuild } from './frames';

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
  e.group.scale.setScalar(active ? 1.012 : 1);
}

export function setHovered(id: string | null, entries: PaintingEntry[]): void {
  hoveredId = id;
  for (const e of entries) applyHover(e);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- Atlas de cartels : 1 seule texture 2048×2048 pour toutes les œuvres ----------
const ATLAS_SIZE = 2048;
const ATLAS_COLS = 8;
const ATLAS_CELL = ATLAS_SIZE / ATLAS_COLS; // 256

function drawLabel(g: CanvasRenderingContext2D, work: Work, x: number, y: number, s: number): void {
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, s, s);
  g.strokeStyle = '#d8d2c4';
  g.lineWidth = 3;
  g.strokeRect(x + 4, y + 4, s - 8, s - 8);
  g.fillStyle = '#20242a';
  g.font = `600 ${Math.round(s * 0.095)}px Georgia, serif`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(truncate(work.title, 20), x + s * 0.067, y + s * 0.36, s * 0.86);
  g.fillStyle = '#6f6a60';
  g.font = `${Math.round(s * 0.067)}px Inter, system-ui, sans-serif`;
  const line2 = [work.year > 0 ? String(work.year) : null, work.medium].filter(Boolean).join(', ');
  g.fillText(truncate(line2, 34), x + s * 0.067, y + s * 0.56, s * 0.86);
  if (work.dimensions) {
    g.fillText(truncate(work.dimensions, 34), x + s * 0.067, y + s * 0.72, s * 0.86);
  }
}

function buildLabelAtlas(works: Work[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS_SIZE;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  works.forEach((w, i) => {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    drawLabel(g, w, col * ATLAS_CELL, row * ATLAS_CELL, ATLAS_CELL);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
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
  const labelMat = new THREE.MeshBasicMaterial({ map: atlas });
  const entries: PaintingEntry[] = [];

  layout.placed.forEach((p, i) => {
    const group = new THREE.Group();
    group.position.set(p.x, p.y, p.z);
    group.rotation.y = -Math.PI / 2;

    const frame = buildFrame(p.w, p.h, { shadows, coarse });
    group.add(frame.root);

    // Toile : plan nu, sans émissif (la lumière fait tout), BVH pour le picking.
    const imgMat = new THREE.MeshStandardMaterial({
      color: 0xe3ded6,
      roughness: 0.8,
      envMapIntensity: 0.1,
    });
    const imgGeo = new THREE.PlaneGeometry(p.w, p.h);
    imgGeo.boundsTree = new MeshBVH(imgGeo);
    const imageMesh = new THREE.Mesh(imgGeo, imgMat);
    imageMesh.position.z = frame.imageZ;
    imageMesh.userData.workId = p.work.id;
    imageMesh.name = 'toile';
    group.add(imageMesh);

    // Cartel musée : à côté du cadre, hauteur ~1,05 m, à 5 mm du parement.
    const label = new THREE.Mesh(labelGeometry(i, 0.22, 0.135), labelMat);
    label.position.set(frame.halfWidth + 0.1, -p.h / 2 + 0.3, 0.0525);
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
