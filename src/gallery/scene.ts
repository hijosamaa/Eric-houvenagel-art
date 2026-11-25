import * as THREE from 'three';
import { HALL_HEIGHT, HALL_WIDTH, hallBounds, type Layout } from './layout';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createScene(canvas: HTMLCanvasElement, layout: Layout): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfaf7f2);
  scene.fog = new THREE.Fog(0xfaf7f2, 20, 55);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
  camera.position.set(0, 1.6, 5.5);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cbb8, 1.2));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  sun.position.set(4, 10, 4);
  scene.add(sun);

  const plaster = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.96 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9a87c, roughness: 0.65 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xfaf8f3, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8f7350, roughness: 0.55 });

  const { zMin, zMax } = hallBounds(layout);
  const len = zMax - zMin;
  const cz = (zMin + zMax) / 2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL_WIDTH, len), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, cz);
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL_WIDTH, len), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, HALL_HEIGHT, cz);
  scene.add(ceil);

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    scene.add(m);
  };

  add(new THREE.BoxGeometry(0.25, HALL_HEIGHT, len), plaster, -HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(new THREE.BoxGeometry(0.25, HALL_HEIGHT, len), plaster, HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(new THREE.BoxGeometry(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25), plaster, 0, HALL_HEIGHT / 2, zMax);
  add(new THREE.BoxGeometry(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25), plaster, 0, HALL_HEIGHT / 2, zMin);

  for (let i = 0; i < layout.zones.length - 1; i++) {
    const z = layout.zones[i].zMax;
    add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, -HALL_WIDTH / 2 + 0.3, HALL_HEIGHT / 2, z);
    add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, HALL_WIDTH / 2 - 0.3, HALL_HEIGHT / 2, z);
    add(new THREE.BoxGeometry(HALL_WIDTH - 0.6, 0.45, 0.35), wood, 0, HALL_HEIGHT - 0.225, z);
  }

  return { renderer, scene, camera };
}
