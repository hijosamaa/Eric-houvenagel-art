import * as THREE from 'three';
import type { Layout, PlacedWork } from './layout';

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

export function buildPaintings(scene: THREE.Scene, layout: Layout): PaintingEntry[] {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xa08055, roughness: 0.45 });
  const matBoardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffedd0 });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a1a,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  return layout.placed.map((p) => {
    const group = new THREE.Group();
    group.position.set(p.x, p.y, p.z);
    group.rotation.y = p.side === 'right' ? -Math.PI / 2 : Math.PI / 2;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.16, p.h + 0.16, 0.08), frameMat);
    const matBoard = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.08, p.h + 0.08), matBoardMat);
    matBoard.position.z = 0.045;
    const imgMat = new THREE.MeshStandardMaterial({ color: 0xe3ded6, roughness: 0.9 });
    const imageMesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), imgMat);
    imageMesh.position.z = 0.055;
    imageMesh.userData.workId = p.work.id;
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.24, 0.06, 0.06), lightMat);
    lightBar.position.set(0, p.h / 2 + 0.14, 0.14);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 0.22, p.h + 0.22), shadowMat);
    shadow.position.set(0.012, -0.02, -0.042);

    group.add(frame, matBoard, imageMesh, lightBar, shadow);
    scene.add(group);
    return { placed: p, group, imageMesh, loaded: false, loadStarted: false };
  });
}

export function ensureTexture(entry: PaintingEntry, baseUrl: string, onLoad?: () => void): void {
  if (entry.loadStarted) return;
  entry.loadStarted = true;
  new THREE.TextureLoader().load(baseUrl + entry.placed.work.image, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
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
