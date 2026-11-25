import * as THREE from 'three';
import { HALL_HEIGHT, HALL_WIDTH, Z_START, hallBounds, type Layout } from './layout';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  spot: THREE.SpotLight;
}

function noiseTexture(base: string, amount: number, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < amount; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${(Math.random() * 0.05).toFixed(3)})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture(len: number): THREE.CanvasTexture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#c9a87c';
  g.fillRect(0, 0, s, s);
  const plankH = 64;
  for (let y = 0; y < s; y += plankH) {
    const offset = (y / plankH) % 2 === 0 ? 0 : s / 4;
    g.strokeStyle = 'rgba(120, 90, 55, 0.55)';
    g.lineWidth = 2;
    g.strokeRect(-2, y, s + 4, plankH);
    g.beginPath();
    g.moveTo((offset + s / 2) % s, y);
    g.lineTo((offset + s / 2) % s, y + plankH);
    g.stroke();
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(140, 105, 65, ${(Math.random() * 0.18).toFixed(3)})`;
      g.lineWidth = 1;
      const gy = y + Math.random() * plankH;
      g.beginPath();
      g.moveTo(Math.random() * s, gy);
      g.lineTo(Math.random() * s, gy + Math.random() * 6);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, Math.max(2, Math.round(len / 3)));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function plaqueTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#f6f1e6';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#c9bfa9';
  g.lineWidth = 4;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#33566e';
  g.font = '600 52px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createScene(canvas: HTMLCanvasElement, layout: Layout, pixelRatio: number): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfaf7f2);
  scene.fog = new THREE.Fog(0xfaf7f2, 20, 55);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
  camera.position.set(0, 1.6, Z_START);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cbb8, 1.15));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.25);
  sun.position.set(4, 10, 4);
  scene.add(sun);

  const spot = new THREE.SpotLight(0xfff1da, 25, 13, 0.62, 0.75, 1.7);
  spot.position.set(0, HALL_HEIGHT - 0.25, Z_START - 2);
  scene.add(spot);
  scene.add(spot.target);

  const { zMin, zMax } = hallBounds(layout);
  const len = zMax - zMin;
  const cz = (zMin + zMax) / 2;

  const plasterTex = noiseTexture('#f2ede4', 2600);
  plasterTex.repeat.set(3, 1);
  const plaster = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.96 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(len), roughness: 0.65 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#faf8f3', 1200), roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8f7350, roughness: 0.55 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.9 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL_WIDTH, len), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, cz);
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL_WIDTH, len), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, HALL_HEIGHT, cz);
  scene.add(ceil);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    scene.add(m);
  };

  add(new THREE.BoxGeometry(0.25, HALL_HEIGHT, len), plaster, -HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(new THREE.BoxGeometry(0.25, HALL_HEIGHT, len), plaster, HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(new THREE.BoxGeometry(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25), plaster, 0, HALL_HEIGHT / 2, zMax);
  add(new THREE.BoxGeometry(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25), plaster, 0, HALL_HEIGHT / 2, zMin);

  const inner = HALL_WIDTH / 2 - 0.125;
  add(new THREE.BoxGeometry(0.05, 0.16, len), trim, -inner + 0.045, 0.08, cz);
  add(new THREE.BoxGeometry(0.05, 0.16, len), trim, inner - 0.045, 0.08, cz);
  add(new THREE.BoxGeometry(0.07, 0.14, len), trim, -inner + 0.05, HALL_HEIGHT - 0.07, cz);
  add(new THREE.BoxGeometry(0.07, 0.14, len), trim, inner - 0.05, HALL_HEIGHT - 0.07, cz);

  for (let i = 0; i < layout.zones.length - 1; i++) {
    const z = layout.zones[i].zMax;
    add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, -HALL_WIDTH / 2 + 0.3, HALL_HEIGHT / 2, z);
    add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, HALL_WIDTH / 2 - 0.3, HALL_HEIGHT / 2, z);
    add(new THREE.BoxGeometry(HALL_WIDTH - 0.6, 0.45, 0.35), wood, 0, HALL_HEIGHT - 0.225, z);
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: plaqueTexture(layout.zones[i + 1].name) }),
    );
    plaque.position.set(0, HALL_HEIGHT - 0.62, z + 0.185);
    scene.add(plaque);
  }

  return { renderer, scene, camera, spot };
}
