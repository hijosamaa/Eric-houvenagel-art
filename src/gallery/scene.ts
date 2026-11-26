import * as THREE from 'three';

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { HALL_HEIGHT, HALL_WIDTH, Z_START, hallBounds, type Layout } from './layout';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  spotPool: THREE.SpotLight[];
}

interface TexOpts {
  repeat?: [number, number];
  aniso: number;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  return [c, g];
}

const TEX_ASSETS = `${import.meta.env.BASE_URL}assets/textures/`;

/**
 * Texture précalculée au build (public/assets/textures/<name>.webp, généré par
 * scripts/gen-textures.mjs). Un placeholder 2×2 est retourné immédiatement pour
 * ne pas bloquer le boot ; le fichier statique est chargé en arrière-plan puis
 * injecté dans la texture (mêmes paramètres : repeat, anisotropy, colorSpace).
 * Si le chargement échoue (404, WebP non supporté…), on retombe sur le générateur
 * canvas 2D d'origine (`draw`) : aucun changement de comportement visuel.
 */
function precalcTexture(
  name: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
  opts: TexOpts,
  placeholder: string,
  srgb = true,
): THREE.Texture {
  const [c, g] = makeCanvas(2);
  g.fillStyle = placeholder;
  g.fillRect(0, 0, 2, 2);
  const t: THREE.Texture = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = opts.aniso;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  void new THREE.TextureLoader()
    .loadAsync(`${TEX_ASSETS}${name}.webp`)
    .then((loaded) => {
      t.image = loaded.image;
      t.needsUpdate = true;
    })
    .catch(() => {
      const [c2, g2] = makeCanvas(size);
      draw(g2, size);
      t.image = c2;
      t.needsUpdate = true;
    });
  return t;
}

/** Plâtre 2048 : grain fin + grandes marbrures douces. */
function plasterTexture(aniso: number, len: number): THREE.Texture {
  return precalcTexture('plaster', 2048, (g, s) => {
    g.fillStyle = '#f2ede4';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26000; i++) {
      const v = Math.random() > 0.5 ? 255 : 208;
      g.fillStyle = `rgba(${v},${v - 6},${v - 18},${(Math.random() * 0.05).toFixed(3)})`;
      const r = 1 + Math.random() * 1.6;
      g.fillRect(Math.random() * s, Math.random() * s, r, r);
    }
    for (let i = 0; i < 22; i++) {
      const r = s * (0.08 + Math.random() * 0.2);
      const x = Math.random() * s;
      const y = Math.random() * s;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(206,196,176,${(0.05 + Math.random() * 0.06).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(206,196,176,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
  }, { aniso, repeat: [Math.max(2, Math.round(len / 9)), 1] }, '#f2ede4');
}

/** Enduit de plafond 2048. */
function ceilingTexture(aniso: number, len: number): THREE.Texture {
  return precalcTexture('ceiling', 2048, (g, s) => {
    g.fillStyle = '#faf8f3';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random() > 0.5 ? 255 : 214;
      g.fillStyle = `rgba(${v},${v - 4},${v - 14},${(Math.random() * 0.045).toFixed(3)})`;
      g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
    }
    for (let i = 0; i < 10; i++) {
      const r = s * (0.1 + Math.random() * 0.18);
      const x = Math.random() * s;
      const y = Math.random() * s;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(216,210,196,${(0.04 + Math.random() * 0.05).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(216,210,196,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
  }, { aniso, repeat: [HALL_WIDTH / 6, Math.max(1, Math.round(len / 6))] }, '#faf8f3');
}

/** Parquet chêne : teinte par lame, veines, joints de bout, micro-rayures. Tuile = 3,6 m. */
function floorTextures(aniso: number, len: number, coarse: boolean): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const size = coarse ? 2048 : 4096;
  const rows = 18;
  const map = precalcTexture('floor', size, (g, s) => {
    const plankH = s / rows;
    for (let y = 0; y < rows; y++) {
      const luma = 0.52 + Math.random() * 0.2;
      const hue = 24 + Math.random() * 9;
      const sat = 34 + Math.random() * 12;
      g.fillStyle = `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${(luma * 100).toFixed(1)}%)`;
      g.fillRect(0, y * plankH, s, plankH);
      // léger dégradé dans la lame
      const lg = g.createLinearGradient(0, y * plankH, 0, (y + 1) * plankH);
      lg.addColorStop(0, 'rgba(255,244,224,0.10)');
      lg.addColorStop(1, 'rgba(70,46,22,0.10)');
      g.fillStyle = lg;
      g.fillRect(0, y * plankH, s, plankH);
      // joint horizontal (bord de lame)
      g.strokeStyle = 'rgba(58,38,18,0.55)';
      g.lineWidth = Math.max(2, s / 1024);
      g.beginPath();
      g.moveTo(0, y * plankH);
      g.lineTo(s, y * plankH);
      g.stroke();
      // joint de bout décalé
      const off = ((y % 2) * s) / 3 + Math.random() * s * 0.2;
      g.strokeStyle = 'rgba(58,38,18,0.5)';
      g.beginPath();
      g.moveTo(off % s, y * plankH);
      g.lineTo(off % s, (y + 1) * plankH);
      g.stroke();
      // veines + micro-rayures
      for (let i = 0; i < 110; i++) {
        g.strokeStyle = `hsla(28 32% 26% / ${(Math.random() * 0.2).toFixed(3)})`;
        g.lineWidth = 1 + Math.random() * (s / 1400);
        const gy = y * plankH + Math.random() * plankH;
        const gx = Math.random() * s;
        g.beginPath();
        g.moveTo(gx, gy);
        g.bezierCurveTo(gx + s * 0.05, gy + 3, gx + s * 0.16, gy - 3, gx + s * 0.3, gy + 4);
        g.stroke();
      }
      // nœud occasionnel
      if (Math.random() < 0.3) {
        const nx = Math.random() * s;
        const ny = y * plankH + plankH * (0.3 + Math.random() * 0.4);
        const nr = s * (0.008 + Math.random() * 0.012);
        const rg = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
        rg.addColorStop(0, 'rgba(70,46,22,0.5)');
        rg.addColorStop(1, 'rgba(70,46,22,0)');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(nx, ny, nr, 0, 7);
        g.fill();
      }
    }
  }, { aniso, repeat: [HALL_WIDTH / 3.6, Math.max(2, Math.round(len / 3.6))] }, '#9a7b52');

  const rough = precalcTexture('floor-rough', 1024, (g, s) => {
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, s, s);
    const plankH = s / rows;
    for (let y = 0; y < rows; y++) {
      g.strokeStyle = 'rgba(70,70,70,0.8)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, y * plankH);
      g.lineTo(s, y * plankH);
      g.stroke();
      const off = ((y % 2) * s) / 3 + Math.random() * s * 0.2;
      g.beginPath();
      g.moveTo(off % s, y * plankH);
      g.lineTo(off % s, (y + 1) * plankH);
      g.stroke();
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(90,90,90,${(Math.random() * 0.5).toFixed(2)})`;
        g.lineWidth = 1 + Math.random() * 2;
        const gy = y * plankH + Math.random() * plankH;
        const gx = Math.random() * s;
        g.beginPath();
        g.moveTo(gx, gy);
        g.lineTo(gx + s * 0.25, gy + 4);
        g.stroke();
      }
    }
  }, { aniso: Math.min(aniso, 8), repeat: [HALL_WIDTH / 3.6, Math.max(2, Math.round(len / 3.6))] }, '#b8b8b8', false);
  return { map, roughnessMap: rough };
}

/** Tapis tissé chaud (greige), liseré périphérique. Tuile = 2,2 m. */
function runnerTexture(aniso: number, len: number): THREE.Texture {
  return precalcTexture('runner', 1024, (g, s) => {
    g.fillStyle = '#cdc2ad';
    g.fillRect(0, 0, s, s);
    // trame croisée
    const step = 8;
    for (let y = 0; y < s; y += step) {
      for (let x = 0; x < s; x += step) {
        const v = 190 + ((x + y) % 16 === 0 ? 22 : Math.random() * 16);
        g.fillStyle = `rgb(${v | 0},${(v - 8) | 0},${(v - 26) | 0})`;
        g.fillRect(x, y, step - 1, step - 1);
      }
    }
    // liseré
    g.strokeStyle = '#a89a7e';
    g.lineWidth = 26;
    g.strokeRect(13, 13, s - 26, s - 26);
    g.strokeStyle = 'rgba(120,108,84,0.8)';
    g.lineWidth = 4;
    g.strokeRect(48, 48, s - 96, s - 96);
  }, { aniso, repeat: [3.2 / 2.2, Math.max(2, Math.round((len - 1.5) / 2.2))] }, '#cdc2ad');
}

/** Plaque de salle en laiton, 320×80. */
function plaqueTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 80;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  const grad = g.createLinearGradient(0, 0, 0, 80);
  grad.addColorStop(0, '#d9c48f');
  grad.addColorStop(0.5, '#c9b27a');
  grad.addColorStop(1, '#b39a63');
  g.fillStyle = grad;
  g.fillRect(0, 0, 320, 80);
  g.strokeStyle = 'rgba(90,72,38,0.9)';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 312, 72);
  g.fillStyle = '#3d3423';
  g.font = 'italic 600 30px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 160, 42, 290);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Profil de moulure extrudé (couronne / plinthe). */
function moldingGeometry(profile: [number, number][], len: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 4 });
}

export function createScene(
  canvas: HTMLCanvasElement,
  layout: Layout,
  pixelRatio: number,
  opts: { shadows: boolean; coarse: boolean },
): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const aniso = Math.min(maxAniso, opts.coarse ? 8 : 16);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfaf7f2);
  const { zMin, zMax } = hallBounds(layout);
  const len = zMax - zMin;
  const cz = (zMin + zMax) / 2;
  scene.fog = new THREE.Fog(0xfaf7f2, 18, Math.max(45, len * 0.55));

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120);
  camera.position.set(2.7, 1.6, Z_START);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b2, 0.5));

  const sun = new THREE.DirectionalLight(0xfff2df, 2.3);
  sun.position.set(2.5, 15, cz);
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

  // Pool de vrais spots « tableau » (3 desktop / 1 mobile) — positionnés par main.ts selon la caméra.
  const spotCount = opts.coarse ? 1 : 3;
  const spotPool: THREE.SpotLight[] = [];
  for (let i = 0; i < spotCount; i++) {
    const s = new THREE.SpotLight(0xfff1da, 0, 8, 0.48, 1.0, 1.8);
    s.castShadow = false;
    if (opts.shadows) {
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.01;
    }
    scene.add(s);
    scene.add(s.target);
    spotPool.push(s);
  }

  const plasterTex = plasterTexture(aniso, len);
  const plaster = new THREE.MeshStandardMaterial({
    map: plasterTex,
    bumpMap: plasterTex,
    bumpScale: 0.02,
    roughness: 0.94,
    envMapIntensity: 0.5,
  });
  const { map: floorMap, roughnessMap: floorRough } = floorTextures(aniso, len, opts.coarse);
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorMap,
    roughnessMap: floorRough,
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.6,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    map: ceilingTexture(aniso, len),
    roughness: 1,
    envMapIntensity: 0.3,
  });
  const wood = new THREE.MeshPhysicalMaterial({
    color: 0x6e5638,
    roughness: 0.4,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.7,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.9, envMapIntensity: 0.4 });
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.6, envMapIntensity: 0.5 });
  const runnerMat = new THREE.MeshStandardMaterial({
    map: runnerTexture(aniso, len),
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

  // Verrière structurée : vitre émissive + châssis métallique (meneaux + traverses + cadre)
  const skylightW = HALL_WIDTH * 0.42;
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(skylightW, len * 0.94),
    new THREE.MeshStandardMaterial({
      color: 0xeef3f7,
      emissive: 0xfffdf2,
      emissiveIntensity: 0.95,
      roughness: 0.15,
      metalness: 0.05,
    }),
  );
  pane.rotation.x = Math.PI / 2;
  pane.position.set(0, HALL_HEIGHT - 0.015, cz);
  scene.add(pane);
  // cadre périphérique
  add(new THREE.BoxGeometry(skylightW + 0.12, 0.1, 0.07), metalDark, 0, HALL_HEIGHT - 0.02, zMin + len * 0.03);
  add(new THREE.BoxGeometry(skylightW + 0.12, 0.1, 0.07), metalDark, 0, HALL_HEIGHT - 0.02, zMax - len * 0.03);
  add(new THREE.BoxGeometry(0.07, 0.1, len * 0.94), metalDark, -skylightW / 2, HALL_HEIGHT - 0.02, cz);
  add(new THREE.BoxGeometry(0.07, 0.1, len * 0.94), metalDark, skylightW / 2, HALL_HEIGHT - 0.02, cz);
  // meneaux longitudinaux
  for (let k = 1; k < 4; k++) {
    const x = -skylightW / 2 + (skylightW * k) / 4;
    add(new THREE.BoxGeometry(0.05, 0.09, len * 0.94), metalDark, x, HALL_HEIGHT - 0.02, cz);
  }
  // traverses
  for (let z = zMin + 2.4; z < zMax - 1; z += 2.4) {
    add(new THREE.BoxGeometry(skylightW, 0.09, 0.05), metalDark, 0, HALL_HEIGHT - 0.02, z);
  }

  // Moulures en relief (extrudées) : couronne en haut, plinthe en bas
  const inner = HALL_WIDTH / 2 - 0.125;
  const crownProfile: [number, number][] = [
    [0, 0], [0.09, 0], [0.09, 0.025], [0.05, 0.05], [0.075, 0.085], [0.03, 0.11], [0.05, 0.14], [0, 0.14],
  ];
  const skirtProfile: [number, number][] = [
    [0, 0], [0.05, 0], [0.05, 0.02], [0.025, 0.045], [0.04, 0.1], [0, 0.1],
  ];
  const crownGeo = moldingGeometry(crownProfile, len);
  const skirtGeo = moldingGeometry(skirtProfile, len);
  const crownR = new THREE.Mesh(crownGeo, trim);
  crownR.rotation.y = Math.PI;
  crownR.position.set(inner, HALL_HEIGHT - 0.14, zMax);
  crownR.receiveShadow = opts.shadows;
  scene.add(crownR);
  const crownL = new THREE.Mesh(crownGeo, trim);
  crownL.position.set(-inner, HALL_HEIGHT - 0.14, zMin);
  crownL.receiveShadow = opts.shadows;
  scene.add(crownL);
  const skirtR = new THREE.Mesh(skirtGeo, trim);
  skirtR.rotation.y = Math.PI;
  skirtR.position.set(inner, 0, zMax);
  scene.add(skirtR);
  const skirtL = new THREE.Mesh(skirtGeo, trim);
  skirtL.position.set(-inner, 0, zMin);
  scene.add(skirtL);

  // Cimaise (ligne de cimaise) + panneaux en partie basse du mur de gauche
  add(new THREE.BoxGeometry(0.05, 0.06, len), trim, -HALL_WIDTH / 2 + 0.04, 2.3, cz);
  for (let z = zMin + 2; z < zMax - 1; z += 2.8) {
    add(new THREE.BoxGeometry(0.04, 1.9, 2.2), trim, -HALL_WIDTH / 2 + 0.035, 1.15, z);
  }

  const benchX = -HALL_WIDTH / 2 + 0.38;
  for (let bz = zMin + 6; bz < zMax - 4; bz += 11) {
    const seat = add(new THREE.BoxGeometry(0.5, 0.09, 1.8), wood, benchX, 0.45, bz);
    const legA = add(new THREE.BoxGeometry(0.42, 0.4, 0.08), wood, benchX, 0.2, bz - 0.8);
    const legB = add(new THREE.BoxGeometry(0.42, 0.4, 0.08), wood, benchX, 0.2, bz + 0.8);
    for (const m of [seat, legA, legB]) m.castShadow = opts.shadows;
  }

  // Portails entre salles + plaque laiton
  for (let i = 0; i < layout.zones.length - 1; i++) {
    const z = layout.zones[i].zMax;
    const p1 = add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, -HALL_WIDTH / 2 + 0.3, HALL_HEIGHT / 2, z);
    const p2 = add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, HALL_WIDTH / 2 - 0.3, HALL_HEIGHT / 2, z);
    const lintel = add(new THREE.BoxGeometry(HALL_WIDTH - 0.6, 0.45, 0.35), wood, 0, HALL_HEIGHT - 0.225, z);
    for (const m of [p1, p2, lintel]) m.castShadow = opts.shadows;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.32),
      new THREE.MeshBasicMaterial({ map: plaqueTexture(layout.zones[i + 1].name) }),
    );
    // posée SUR la face du linteau (pas dans l'ouverture)
    plaque.position.set(0, HALL_HEIGHT - 0.225, z + 0.18);
    // cliquable : index de la salle suivante (géré par main.ts via controls.onZonePick)
    plaque.userData.zoneIndex = i + 1;
    scene.add(plaque);
  }

  return { renderer, scene, camera, sun, spotPool };
}
