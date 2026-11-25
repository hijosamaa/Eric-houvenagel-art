import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HALL_HEIGHT, HALL_WIDTH, Z_START, hallBounds, type Layout } from './layout';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  spot: THREE.SpotLight;
}

function noiseTexture(base: string, amount: number, size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < amount; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${(Math.random() * 0.045).toFixed(3)})`;
    const s = 1 + Math.random() * 2;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture(len: number): THREE.CanvasTexture {
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#c8a67a';
  g.fillRect(0, 0, s, s);
  const plankH = 128;
  for (let y = 0; y < s; y += plankH) {
    const offset = (y / plankH) % 2 === 0 ? 0 : s / 4;
    g.strokeStyle = 'rgba(112, 82, 48, 0.6)';
    g.lineWidth = 3;
    g.strokeRect(-4, y, s + 8, plankH);
    g.beginPath();
    g.moveTo((offset + s / 2) % s, y);
    g.lineTo((offset + s / 2) % s, y + plankH);
    g.stroke();
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(138, 103, 62, ${(Math.random() * 0.22).toFixed(3)})`;
      g.lineWidth = 1 + Math.random();
      const gy = y + Math.random() * plankH;
      const gx = Math.random() * s;
      g.beginPath();
      g.moveTo(gx, gy);
      g.bezierCurveTo(gx + 40, gy + 4, gx + 120, gy - 4, gx + 220, gy + 6);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, Math.max(2, Math.round(len / 2.5)));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function plaqueTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 160;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.fillStyle = '#f7f2e7';
  g.fillRect(0, 0, 640, 160);
  g.strokeStyle = '#c9bfa9';
  g.lineWidth = 5;
  g.strokeRect(8, 8, 624, 144);
  g.fillStyle = '#33566e';
  g.font = '600 64px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 320, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createScene(
  canvas: HTMLCanvasElement,
  layout: Layout,
  pixelRatio: number,
  opts: { shadows: boolean },
): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfaf7f2);
  scene.fog = new THREE.Fog(0xfaf7f2, 22, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120);
  camera.position.set(2.7, 1.6, Z_START);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b2, 0.5));

  const { zMin, zMax } = hallBounds(layout);
  const len = zMax - zMin;
  const cz = (zMin + zMax) / 2;

  const sun = new THREE.DirectionalLight(0xfff2df, 2.4);
  sun.position.set(0, 15, cz);
  sun.target.position.set(0, 0, cz);
  scene.add(sun);
  scene.add(sun.target);
  if (opts.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = zMax + 2;
    sun.shadow.camera.bottom = zMin - 2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
  }

  const spot = new THREE.SpotLight(0xfff1da, 30, 14, 0.6, 0.8, 1.6);
  spot.position.set(4, HALL_HEIGHT - 0.25, Z_START - 2);
  if (opts.shadows) {
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0003;
  }
  scene.add(spot);
  scene.add(spot.target);

  const plasterTex = noiseTexture('#f1ece2', 9000, 512);
  plasterTex.repeat.set(4, 1);
  const plaster = new THREE.MeshStandardMaterial({
    map: plasterTex,
    bumpMap: plasterTex,
    bumpScale: 0.02,
    roughness: 0.94,
    envMapIntensity: 0.5,
  });
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorTexture(len),
    roughness: 0.32,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.6,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    map: noiseTexture('#faf8f3', 3000, 512),
    roughness: 1,
    envMapIntensity: 0.3,
  });
  const wood = new THREE.MeshPhysicalMaterial({
    color: 0x7d5f3f,
    roughness: 0.4,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.7,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.9, envMapIntensity: 0.4 });
  const runnerMat = new THREE.MeshStandardMaterial({
    map: noiseTexture('#454c55', 8000, 512),
    roughness: 1,
    envMapIntensity: 0.15,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = opts.shadows;
    scene.add(m);
    return m;
  };

  const floor = add(new THREE.PlaneGeometry(HALL_WIDTH, len), floorMat, 0, 0, cz);
  floor.rotation.x = -Math.PI / 2;
  const ceil = add(new THREE.PlaneGeometry(HALL_WIDTH, len), ceilMat, 0, HALL_HEIGHT, cz);
  ceil.rotation.x = Math.PI / 2;

  const runner = add(new THREE.PlaneGeometry(3.2, len - 1.5), runnerMat, 3.4, 0.006, cz);
  runner.rotation.x = -Math.PI / 2;

  add(new THREE.BoxGeometry(0.25, HALL_HEIGHT, len), plaster, -HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(new THREE.BoxGeometry(0.25, HALL_HEIGHT, len), plaster, HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(new THREE.BoxGeometry(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25), plaster, 0, HALL_HEIGHT / 2, zMax);
  add(new THREE.BoxGeometry(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25), plaster, 0, HALL_HEIGHT / 2, zMin);

  const skylight = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_WIDTH * 0.42, len * 0.94),
    new THREE.MeshBasicMaterial({ color: 0xfffef8 }),
  );
  skylight.rotation.x = Math.PI / 2;
  skylight.position.set(0, HALL_HEIGHT - 0.01, cz);
  scene.add(skylight);
  add(new THREE.BoxGeometry(0.08, 0.03, len * 0.94), trim, -HALL_WIDTH * 0.21, HALL_HEIGHT - 0.005, cz);
  add(new THREE.BoxGeometry(0.08, 0.03, len * 0.94), trim, HALL_WIDTH * 0.21, HALL_HEIGHT - 0.005, cz);

  const inner = HALL_WIDTH / 2 - 0.125;
  add(new THREE.BoxGeometry(0.05, 0.16, len), trim, -inner + 0.045, 0.08, cz);
  add(new THREE.BoxGeometry(0.05, 0.16, len), trim, inner - 0.045, 0.08, cz);
  add(new THREE.BoxGeometry(0.07, 0.14, len), trim, -inner + 0.05, HALL_HEIGHT - 0.07, cz);
  add(new THREE.BoxGeometry(0.07, 0.14, len), trim, inner - 0.05, HALL_HEIGHT - 0.07, cz);

  add(new THREE.BoxGeometry(0.05, 0.06, len), trim, -HALL_WIDTH / 2 + 0.04, 2.3, cz);
  for (let z = zMin + 2; z < zMax - 1; z += 2.8) {
    add(new THREE.BoxGeometry(0.04, 1.9, 2.2), trim, -HALL_WIDTH / 2 + 0.035, 1.15, z);
  }

  const benchX = -HALL_WIDTH / 2 + 0.38;
  const seat = add(new THREE.BoxGeometry(0.5, 0.09, 1.8), wood, benchX, 0.45, cz);
  const legA = add(new THREE.BoxGeometry(0.42, 0.4, 0.08), wood, benchX, 0.2, cz - 0.8);
  const legB = add(new THREE.BoxGeometry(0.42, 0.4, 0.08), wood, benchX, 0.2, cz + 0.8);
  for (const m of [seat, legA, legB]) m.castShadow = opts.shadows;

  for (let i = 0; i < layout.zones.length - 1; i++) {
    const z = layout.zones[i].zMax;
    const p1 = add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, -HALL_WIDTH / 2 + 0.3, HALL_HEIGHT / 2, z);
    const p2 = add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, HALL_WIDTH / 2 - 0.3, HALL_HEIGHT / 2, z);
    const lintel = add(new THREE.BoxGeometry(HALL_WIDTH - 0.6, 0.45, 0.35), wood, 0, HALL_HEIGHT - 0.225, z);
    for (const m of [p1, p2, lintel]) m.castShadow = opts.shadows;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.65),
      new THREE.MeshBasicMaterial({ map: plaqueTexture(layout.zones[i + 1].name) }),
    );
    plaque.position.set(0, HALL_HEIGHT - 0.68, z + 0.185);
    scene.add(plaque);
  }

  return { renderer, scene, camera, spot };
}
