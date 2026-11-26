import * as THREE from 'three';

import type { Layout, PlacedWork } from './layout';

import type { Work } from '../types';

export interface PaintingEntry {
  placed: PlacedWork;
  group: THREE.Group;
  imageMesh: THREE.Mesh;
  tex: THREE.Texture | null;
  loaded: boolean;
  loadStarted: boolean;
}

let hoveredId: string | null = null;

function applyHover(e: PaintingEntry): void {
  const mat = e.imageMesh.material as THREE.MeshStandardMaterial;
  const active = e.placed.work.id === hoveredId;
  mat.emissiveIntensity = active && e.loaded ? 0.3 : e.loaded ? 0.1 : 0;
  e.group.scale.setScalar(active ? 1.02 : 1);
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

export function buildPaintings(scene: THREE.Scene, layout: Layout, shadows: boolean): PaintingEntry[] {
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x8a6a45,
    roughness: 0.32,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.8,
  });
  const matBoardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, envMapIntensity: 0.3 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.35, metalness: 0.65, envMapIntensity: 0.6 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff3dd });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a1a,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const atlas = buildLabelAtlas(layout.placed.map((p) => p.work));
  const labelMat = new THREE.MeshBasicMaterial({ map: atlas });

  return layout.placed.map((p, i) => {
    const group = new THREE.Group();
    group.position.set(p.x, p.y, p.z);
    group.rotation.y = -Math.PI / 2;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.16, p.h + 0.16, 0.08), frameMat);
    frame.castShadow = shadows;
    const matBoard = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.08, p.h + 0.08), matBoardMat);
    matBoard.position.z = 0.045;
    const imgMat = new THREE.MeshStandardMaterial({ color: 0xe3ded6, roughness: 0.88, envMapIntensity: 0.25 });
    const imageMesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), imgMat);
    imageMesh.position.z = 0.055;
    imageMesh.userData.workId = p.work.id;

    // Vrai appareil d'éclairage de tableau (picture light) : bras + boîtier métal + lentille émissive
    const fy = p.h / 2 + 0.13;
    // bras qui traversent le mur (local z négatif = dans le mur) jusqu'au boîtier
    const armGeo = new THREE.BoxGeometry(0.025, 0.17, 0.14);
    const armL = new THREE.Mesh(armGeo, housingMat);
    armL.position.set(-(p.w / 2 + 0.1), fy, 0.015);
    const armR = new THREE.Mesh(armGeo, housingMat);
    armR.position.set(p.w / 2 + 0.1, fy, 0.015);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.28, 0.07, 0.075), housingMat);
    housing.position.set(0, fy, 0.115);
    housing.castShadow = shadows;
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.2, 0.028), lensMat);
    lens.position.set(0, fy, 0.154);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.24, p.h + 0.24), shadowMat);
    shadow.position.set(0.012, -0.02, -0.042);

    // Cartel musée : collé au cadre, hauteur ~1,05 m
    const label = new THREE.Mesh(labelGeometry(i, 0.22, 0.135), labelMat);
    label.position.set((p.w + 0.16) / 2 + 0.1, -p.h / 2 + 0.3, 0.06);

    group.add(frame, matBoard, imageMesh, armL, armR, housing, lens, shadow, label);
    scene.add(group);
    return { placed: p, group, imageMesh, tex: null, loaded: false, loadStarted: false };
  });
}

export function ensureTexture(entry: PaintingEntry, baseUrl: string, aniso: number, onLoad?: () => void): void {
  if (entry.loadStarted) return;
  entry.loadStarted = true;
  new THREE.TextureLoader().load(baseUrl + entry.placed.work.image, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    const mat = entry.imageMesh.material as THREE.MeshStandardMaterial;
    mat.map = tex;
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
