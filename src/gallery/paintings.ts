import * as THREE from 'three';
import type { Layout, PlacedWork } from './layout';
import type { Work } from '../types';

export interface PaintingEntry {
  placed: PlacedWork;
  group: THREE.Group;
  imageMesh: THREE.Mesh;
  loaded: boolean;
  loadStarted: boolean;
}

let hoveredId: string | null = null;

function applyHover(e: PaintingEntry): void {
  const mat = e.imageMesh.material as THREE.MeshStandardMaterial;
  const active = e.placed.work.id === hoveredId;
  mat.emissiveIntensity = active && e.loaded ? 0.55 : 0.25;
  e.group.scale.setScalar(active ? 1.02 : 1);
}

export function setHovered(id: string | null, entries: PaintingEntry[]): void {
  hoveredId = id;
  for (const e of entries) applyHover(e);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function labelTexture(work: Work): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 220;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 360, 220);
  g.strokeStyle = '#d8d2c4';
  g.lineWidth = 3;
  g.strokeRect(4, 4, 352, 212);
  g.fillStyle = '#20242a';
  g.font = '600 34px Georgia, serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(truncate(work.title, 20), 24, 78, 312);
  g.fillStyle = '#6f6a60';
  g.font = '24px Inter, system-ui, sans-serif';
  const line2 = [work.year > 0 ? String(work.year) : null, work.medium].filter(Boolean).join(', ');
  g.fillText(truncate(line2, 34), 24, 122, 312);
  if (work.dimensions) {
    g.fillText(truncate(work.dimensions, 34), 24, 158, 312);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildPaintings(scene: THREE.Scene, layout: Layout, shadows: boolean): PaintingEntry[] {
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x8a6a45,
    roughness: 0.32,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.8,
  });
  const matBoardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, envMapIntensity: 0.3 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffedd0 });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a1a,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  return layout.placed.map((p) => {
    const group = new THREE.Group();
    group.position.set(p.x, p.y, p.z);
    group.rotation.y = p.side === 'right' ? -Math.PI / 2 : Math.PI / 2;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.16, p.h + 0.16, 0.08), frameMat);
    frame.castShadow = shadows;
    const matBoard = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.08, p.h + 0.08), matBoardMat);
    matBoard.position.z = 0.045;
    const imgMat = new THREE.MeshStandardMaterial({ color: 0xe3ded6, roughness: 0.88, envMapIntensity: 0.25 });
    const imageMesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), imgMat);
    imageMesh.position.z = 0.055;
    imageMesh.userData.workId = p.work.id;
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.24, 0.06, 0.06), lightMat);
    lightBar.position.set(0, p.h / 2 + 0.14, 0.14);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.24, p.h + 0.24), shadowMat);
    shadow.position.set(0.012, -0.02, -0.042);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.16),
      new THREE.MeshBasicMaterial({ map: labelTexture(p.work) }),
    );
    label.position.set((p.w + 0.16) / 2 + 0.17, -0.04, 0.06);

    group.add(frame, matBoard, imageMesh, lightBar, shadow, label);
    scene.add(group);
    return { placed: p, group, imageMesh, loaded: false, loadStarted: false };
  });
}

export function ensureTexture(entry: PaintingEntry, baseUrl: string, onLoad?: () => void): void {
  if (entry.loadStarted) return;
  entry.loadStarted = true;
  new THREE.TextureLoader().load(baseUrl + entry.placed.work.image, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = entry.imageMesh.material as THREE.MeshStandardMaterial;
    mat.map = tex;
    mat.emissiveMap = tex;
    mat.emissive = new THREE.Color(0xffffff);
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    entry.loaded = true;
    applyHover(entry);
    onLoad?.();
  });
}
