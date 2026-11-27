import * as THREE from 'three';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import { HALL_HEIGHT, HALL_WIDTH, Z_START, hallBounds, portalPositions, type Layout } from './layout';

import { HEMI, ROOF_LAYER, SKY_FILL, SUN, TableSpots } from './lights';

import { beamTexture, metalTexture, precalcTexture, rugTexture } from './textures';

import { buildFurniture, furnitureMaterials } from './furniture';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  spotPool: THREE.SpotLight[];
  /** Contrôleur du pool de spots (hystérésis + fondu). `main.ts` l'appelle par frame. */
  spots: TableSpots;
}

/** Échelle de texture du plâtre : 1 tuile = 13 m dans les deux directions. */
const PLASTER_TILE = 13;
/** Échelle de texture du plafond (la tuile suit les UV en mètres de l'extrusion). */
const CEILING_TILE = 6.4;
/** Échelle de tuile du tapis : 1 tuile = 2,6 m. */
const RUG_TILE = 2.6;
/** Hauteur de la cimaise (haut des toiles = WALL_Y + 0,75 = 2,30 → marge). */
const CIMAISE_Y = 2.5;

/** Plâtre 2048 : grain fin + grandes marbrures douces. */
function plasterTexture(aniso: number, len: number, coarse = false): THREE.Texture {
  return precalcTexture('plaster', 2048, (g, s) => {
    g.fillStyle = '#ece5d8';
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
      rg.addColorStop(0, `rgba(198,186,164,${(0.05 + Math.random() * 0.06).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(198,186,164,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
  }, { aniso, repeat: [Math.max(1, len / PLASTER_TILE), HALL_HEIGHT / PLASTER_TILE], maxSize: coarse ? 1024 : 2048 }, '#ece5d8');
}

/**
 * Enduit de plafond 2048. La géométrie du plafond est extrudée depuis une `Shape` dont
 * les UV valent des **mètres** (WorldUVGenerator) : le repeat ramène une tuile à
 * CEILING_TILE mètres, quelle que soit la découpe de la trémie.
 */
function ceilingTexture(aniso: number, coarse = false): THREE.Texture {
  return precalcTexture('ceiling', 2048, (g, s) => {
    g.fillStyle = '#f3efe6';
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
      rg.addColorStop(0, `rgba(210,202,186,${(0.04 + Math.random() * 0.05).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(210,202,186,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
  }, { aniso, repeat: [1 / CEILING_TILE, 1 / CEILING_TILE], maxSize: coarse ? 1024 : 2048 }, '#f3efe6');
}

/** Dégradé radial de la verrière : cœur à 1,0 (seul dépassement du seuil de bloom avec la lentille), bords à ~0,30. */
function skylightEmissiveTexture(): THREE.Texture {
  const w = 64;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = ((y + 0.5) / h) * 2 - 1;
    const ends = 1 - 0.34 * Math.pow(Math.abs(v), 2.4);
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * 2 - 1;
      const core = 1 - 0.68 * Math.pow(Math.abs(u), 1.6);
      const val = Math.max(0, Math.round(255 * core * ends));
      const i = (y * w + x) * 4;
      img.data[i] = val;
      img.data[i + 1] = val;
      img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Parquet chêne : teinte par lame, veines, joints de bout, micro-rayures. Tuile = 3,6 m. */
function floorTextures(aniso: number, len: number, coarse: boolean): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const size = coarse ? 2048 : 4096;
  const rows = 18;
  const map = precalcTexture('floor', size, (g, s) => {
    const plankH = s / rows;
    for (let y = 0; y < rows; y++) {
      const luma = 0.46 + Math.random() * 0.18;
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
  }, { aniso, repeat: [HALL_WIDTH / 3.6, Math.max(2, Math.round(len / 3.6))], maxSize: coarse ? 1024 : 2048 }, '#8a6c46');

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
  }, { aniso: Math.min(aniso, 8), repeat: [HALL_WIDTH / 3.6, Math.max(2, Math.round(len / 3.6))], maxSize: 1024 }, '#b8b8b8', false);
  return { map, roughnessMap: rough };
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

/** Panneau du mur du fond : nom de l'artiste en capitales espacées, discret. */
function wallSignTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 200;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.clearRect(0, 0, 1024, 200);
  const text = name.toUpperCase();
  const size = 92;
  g.font = `500 ${size}px Georgia, serif`;
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(125,118,106,0.85)';
  // capitales espacées à la main (letterSpacing canvas pas universel)
  const spacing = 26;
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = (1024 - total) / 2;
  [...text].forEach((ch, i) => {
    g.fillText(ch, x, 104);
    x += widths[i] + spacing;
  });
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

/** Multiplie les UV d'une géométrie (échelle du plâtre sur les murs de bout). */
function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Dalle de plafond **avec trémie** : l'ouverture de la verrière est découpée dans la
 * dalle, qui projette donc son ombre — c'est ce qui fait entrer la lumière (trame des
 * meneaux au sol). Une seule `Shape` extrudée sur 6 cm : 1 draw call, arêtes réelles.
 */
function ceilingWithLightwell(
  halfWidth: number,
  halfLength: number,
  halfOpeningW: number,
  halfOpeningZ: number,
  thickness: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -halfLength);
  shape.lineTo(halfWidth, -halfLength);
  shape.lineTo(halfWidth, halfLength);
  shape.lineTo(-halfWidth, halfLength);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-halfOpeningW, -halfOpeningZ);
  hole.lineTo(-halfOpeningW, halfOpeningZ);
  hole.lineTo(halfOpeningW, halfOpeningZ);
  hole.lineTo(halfOpeningW, -halfOpeningZ);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); // plan XY → plan horizontal, extrusion vers +y
  return geo;
}

export function createScene(
  canvas: HTMLCanvasElement,
  layout: Layout,
  pixelRatio: number,
  opts: { shadows: boolean; coarse: boolean; artist?: string },
): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Ambiance « jour » naturelle : exposition neutre, la lumière vient du soleil +
  // de la trémie (pas d'éclairage muséal sombre).
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const aniso = Math.min(maxAniso, opts.coarse ? 8 : 16);
  // Côté max des textures uploadées : 1024 px sur mobile (mémoire GPU), 2048 sinon.
  const texMax = opts.coarse ? 1024 : 2048;

  const scene = new THREE.Scene();
  const { zMin, zMax } = hallBounds(layout);
  const len = zMax - zMin;
  const cz = (zMin + zMax) / 2;
  // Fond = teinte du plâtre éclairé (pas de brouillard : la profondeur se lit
  // avec le mur du fond + le panneau de l'artiste, et le hall reste « naturel »).
  scene.background = new THREE.Color(0xded5c4);
  scene.fog = null;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55; // IBL douce : matériaux moins plats, reflets crédibles
  pmrem.dispose();

  // far suffisant pour voir le fond d'un hall de 150 m (near/far < 8000 reste safe en 24 bits).
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, Math.max(160, len + 60));
  camera.position.set(layout.pathX, 1.6, Z_START);
  // Le toit vit sur ROOF_LAYER : la caméra doit le voir (voir lights.ts).
  camera.layers.enable(ROOF_LAYER);

  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, opts.coarse ? HEMI.coarseIntensity : HEMI.intensity));

  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.position.set(SUN.position.x, SUN.position.y, cz + SUN.position.z);
  sun.target.position.set(0, 0, cz);
  scene.add(sun);
  scene.add(sun.target);
  if (opts.shadows) {
    sun.castShadow = true;
    const size = opts.coarse ? SUN.shadow.mapSizeCoarse : SUN.shadow.mapSize;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.camera.left = -SUN.shadow.halfX;
    sun.shadow.camera.right = SUN.shadow.halfX;
    sun.shadow.camera.top = SUN.shadow.halfZ;
    sun.shadow.camera.bottom = -SUN.shadow.halfZ;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = SUN.shadow.bias;
    sun.shadow.normalBias = SUN.shadow.normalBias;
    sun.shadow.radius = 2;
    // Le toit (couche ROOF_LAYER) doit projeter la trame de la verrière au sol.
    sun.shadow.camera.layers.enable(ROOF_LAYER);
  }

  // Ciel diffus de la trémie (RectAreaLight, desktop uniquement).
  if (SKY_FILL.enabled && !opts.coarse) {
    RectAreaLightUniformsLib.init();
    const sky = new THREE.RectAreaLight(SKY_FILL.color, SKY_FILL.intensity, SKY_FILL.width, SKY_FILL.height);
    sky.position.set(0, SKY_FILL.y, cz);
    sky.rotation.x = Math.PI / 2; // normale vers le bas
    sky.layers.set(0);
    scene.add(sky);
  }

  // Pool de spots « tableau » (6 desktop / 3 mobile) — piloté par main.ts via TableSpots.
  const spots = new TableSpots(scene, { count: opts.coarse ? 3 : 6, shadows: opts.shadows });
  const spotPool = spots.pool;

  const plasterTex = plasterTexture(aniso, len, opts.coarse);
  const plaster = new THREE.MeshStandardMaterial({
    map: plasterTex,
    bumpMap: plasterTex,
    bumpScale: 0.014,
    roughness: 0.94,
    envMapIntensity: 0.22,
  });
  const { map: floorMap, roughnessMap: floorRough } = floorTextures(aniso, len, opts.coarse);
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorMap,
    roughnessMap: floorRough,
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.35,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    map: ceilingTexture(aniso, opts.coarse),
    roughness: 1,
    envMapIntensity: 0.2,
  });
  const wood = new THREE.MeshStandardMaterial({
    map: beamTexture(aniso, 2.5, '#8a6a48', texMax),
    color: 0xd9b98f,
    roughness: 0.5,
    metalness: 0,
    envMapIntensity: 0.45,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0xece5d6, roughness: 0.9, envMapIntensity: 0.3 });
  // Bronze brossé des châssis de verrière (remplace l'ancien métal sombre plat « moche »).
  const bronze = new THREE.MeshStandardMaterial({
    map: metalTexture(aniso, texMax),
    color: 0xbfae94,
    roughness: 0.38,
    metalness: 0.9,
    envMapIntensity: 1.0,
  });
  // Poutres longitudinales en chêne sombre encadrant la verrière.
  const beamMat = new THREE.MeshStandardMaterial({
    map: beamTexture(aniso, len / 4, '#7d5f3e', texMax),
    color: 0xc9a06a,
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.4,
  });
  const rugMat = new THREE.MeshStandardMaterial({
    map: rugTexture(aniso, texMax),
    roughness: 0.95,
    envMapIntensity: 0.12,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const rugEdge = new THREE.MeshStandardMaterial({ color: 0xd9c9a4, roughness: 0.9, envMapIntensity: 0.2 });

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    o?: { cast?: boolean; layer?: number },
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = opts.shadows;
    m.castShadow = o?.cast === true && opts.shadows;
    if (o?.layer !== undefined) m.layers.set(o.layer);
    scene.add(m);
    return m;
  };

  const floor = add(new THREE.PlaneGeometry(HALL_WIDTH, len), floorMat, 0, 0, cz);
  floor.rotation.x = -Math.PI / 2;

  // ---- Tapis par salle (un par zone, sous le chemin de visite) ----
  // Chaque salle a sa teinte de tapis : la séparation entre catégories se lit au sol.
  const RUG_TINTS = [0xffffff, 0xd9c6a8, 0xb7c6cc, 0xcbb9a4, 0xa9bfa6, 0xd3b8b8];
  const RUG_X = -2.3;
  const RUG_W = 3.0;
  layout.zones.forEach((zone, zi) => {
    const rugLen = zone.zMax - zone.zMin - 1.6;
    if (rugLen < 2) return;
    const rugZ = (zone.zMin + zone.zMax) / 2;
    const geo = new THREE.PlaneGeometry(RUG_W, rugLen);
    // tuile de 2,6 m dans les deux directions (échelle UV, pas de repeat sur la texture)
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (RUG_W / RUG_TILE), uv.getY(i) * (rugLen / RUG_TILE));
    }
    uv.needsUpdate = true;
    const mat = rugMat.clone();
    mat.color.set(RUG_TINTS[zi % RUG_TINTS.length]);
    const rug = add(geo, mat, RUG_X, 0.006, rugZ);
    rug.rotation.x = -Math.PI / 2;
    // baguette de bordure (géométrie, pas dans la texture → pas de couture)
    const e = 0.045;
    add(new THREE.BoxGeometry(RUG_W + e * 2, 0.012, e), rugEdge, RUG_X, 0.007, rugZ - rugLen / 2);
    add(new THREE.BoxGeometry(RUG_W + e * 2, 0.012, e), rugEdge, RUG_X, 0.007, rugZ + rugLen / 2);
    add(new THREE.BoxGeometry(e, 0.012, rugLen), rugEdge, RUG_X - RUG_W / 2, 0.007, rugZ);
    add(new THREE.BoxGeometry(e, 0.012, rugLen), rugEdge, RUG_X + RUG_W / 2, 0.007, rugZ);
  });

  // ---- Dalle de plafond avec trémie (la lumière entre par l'ouverture) ----
  const skylightW = HALL_WIDTH * 0.42;
  const skylightL = len * 0.94;
  const ceil = add(
    ceilingWithLightwell(HALL_WIDTH / 2, len / 2, skylightW / 2, skylightL / 2, 0.06),
    ceilMat,
    0,
    HALL_HEIGHT,
    cz,
    { cast: true, layer: ROOF_LAYER },
  );
  ceil.name = 'plafond-tremie';

  // ---- Murs (l'échelle du plâtre est corrigée par les UV) ----
  const wallU = len / PLASTER_TILE;
  const endWallU = (HALL_WIDTH + 0.5) / PLASTER_TILE / wallU;
  const wallGeo = (w: number, h: number, d: number, endWall: boolean): THREE.BufferGeometry =>
    scaleUV(new THREE.BoxGeometry(w, h, d), endWall ? endWallU : 1, 1);
  add(wallGeo(0.25, HALL_HEIGHT, len, false), plaster, -HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(wallGeo(0.25, HALL_HEIGHT, len, false), plaster, HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(wallGeo(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25, true), plaster, 0, HALL_HEIGHT / 2, zMax);
  add(wallGeo(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25, true), plaster, 0, HALL_HEIGHT / 2, zMin);

  // ---- Verrière : vitre émissive (dégradé) + châssis bronze projetant ----
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(skylightW, skylightL),
    new THREE.MeshStandardMaterial({
      color: 0xe8edf2,
      emissive: 0xfffdf2,
      emissiveMap: skylightEmissiveTexture(),
      // 0,6 : sous le seuil de bloom → la verrière reste un ciel clair, sans halo ni
      // dalle blanche brûlée au fond du hall (il n'y a plus de brouillard pour voiler).
      emissiveIntensity: 0.6,
      roughness: 0.15,
      metalness: 0.05,
      envMapIntensity: 0.15,
    }),
  );
  pane.rotation.x = Math.PI / 2;
  pane.position.set(0, HALL_HEIGHT, cz);
  pane.layers.set(ROOF_LAYER);
  scene.add(pane);

  const memberY = HALL_HEIGHT - 0.05;
  // cadre périphérique de la trémie (profilés bronze affinés)
  add(new THREE.BoxGeometry(skylightW + 0.14, 0.09, 0.07), bronze, 0, memberY, cz - skylightL / 2, { cast: true, layer: ROOF_LAYER });
  add(new THREE.BoxGeometry(skylightW + 0.14, 0.09, 0.07), bronze, 0, memberY, cz + skylightL / 2, { cast: true, layer: ROOF_LAYER });
  add(new THREE.BoxGeometry(0.07, 0.09, skylightL), bronze, -skylightW / 2, memberY, cz, { cast: true, layer: ROOF_LAYER });
  add(new THREE.BoxGeometry(0.07, 0.09, skylightL), bronze, skylightW / 2, memberY, cz, { cast: true, layer: ROOF_LAYER });
  // meneaux longitudinaux (3) — ils dessinent la trame au sol
  for (let k = 1; k < 4; k++) {
    const x = -skylightW / 2 + (skylightW * k) / 4;
    add(new THREE.BoxGeometry(0.035, 0.08, skylightL), bronze, x, memberY, cz, { cast: true, layer: ROOF_LAYER });
  }
  // traverses
  for (let z = cz - skylightL / 2 + 3; z < cz + skylightL / 2 - 1; z += 3) {
    add(new THREE.BoxGeometry(skylightW, 0.08, 0.035), bronze, 0, memberY, z, { cast: true, layer: ROOF_LAYER });
  }

  // ---- Charpente en chêne : poutres transversales flanquant la verrière + sablières ----
  // (remplace les 2 longues poutres longitudinales qui se lisaient comme des rails :
  //  une vraie charpente croise la largeur ; la verrière se glisse entre les poutres)
  const beamW = HALL_WIDTH / 2 - skylightW / 2 - 0.05; // segment mur → bord de verrière
  const transTex = beamTexture(aniso, 1, '#7d5f3e', texMax);
  transTex.repeat.set(beamW / 4, 1); // veine sur ~4 m de long
  const beamTransMat = new THREE.MeshStandardMaterial({
    map: transTex,
    color: 0xc9a06a,
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.4,
  });
  for (let z = zMin + 1.7; z < zMax - 1.0; z += 3.5) {
    add(new THREE.BoxGeometry(beamW, 0.26, 0.17), beamTransMat, -(skylightW / 2 + beamW / 2 + 0.025), HALL_HEIGHT - 0.13, z, { cast: true });
    add(new THREE.BoxGeometry(beamW, 0.26, 0.17), beamTransMat, skylightW / 2 + beamW / 2 + 0.025, HALL_HEIGHT - 0.13, z, { cast: true });
  }
  // sablières longitudinales contre les murs : reçoivent les extrémités des poutres
  const sabX = HALL_WIDTH / 2 - 0.155;
  add(new THREE.BoxGeometry(0.16, 0.22, len), beamMat, -sabX, HALL_HEIGHT - 0.11, cz, { cast: true });
  add(new THREE.BoxGeometry(0.16, 0.22, len), beamMat, sabX, HALL_HEIGHT - 0.11, cz, { cast: true });

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

  // Cimaise des deux côtés (au-dessus des toiles : 2,50 > 1,55 + 0,75)
  add(new THREE.BoxGeometry(0.05, 0.06, len), trim, -HALL_WIDTH / 2 + 0.04, CIMAISE_Y, cz);
  add(new THREE.BoxGeometry(0.05, 0.06, len), trim, HALL_WIDTH / 2 - 0.04, CIMAISE_Y, cz);

  // Boiserie sur le mur DROIT (le mur gauche porte les œuvres) : chaque panneau =
  // cadre (liteaux) + panneau central légèrement en retrait. Tout est fusionné par
  // matériau → 2 draw calls pour toute la boiserie.
  const portals = portalPositions(layout);
  const portalZs = portals.map((p) => p.z);
  // tons proches du plâtre : la boiserie se lit en relief (ombre/GTAO), pas en contraste
  const panelFrame = new THREE.MeshStandardMaterial({ color: 0xcfc7b4, roughness: 0.92, envMapIntensity: 0.28 });
  const panelTone = new THREE.MeshStandardMaterial({ color: 0xdbd4c2, roughness: 0.94, envMapIntensity: 0.26 });
  {
    const frames: THREE.BufferGeometry[] = [];
    const inners: THREE.BufferGeometry[] = [];
    for (let z = zMin + 2; z < zMax - 1; z += 2.8) {
      if (portalZs.some((pz) => Math.abs(pz - z) < 1.7)) continue; // pas de panneau dans un portail
      const x = HALL_WIDTH / 2 - 0.05;
      // cadre : 4 liteaux (haut/bas pleine largeur, côtés sur la hauteur intérieure)
      for (const sy of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.07, 0.09, 2.3);
        g.translate(x, 1.15 + sy * (0.95 - 0.045), z);
        frames.push(g);
      }
      for (const sx of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.07, 1.72, 0.09);
        g.translate(x + sx * (1.115 - 0.045), 1.15, z);
        frames.push(g);
      }
      // panneau central en retrait (relief 5 cm, face à 2 cm du mur)
      const inner = new THREE.BoxGeometry(0.05, 1.72, 2.12);
      inner.translate(x - 0.01, 1.15, z);
      inners.push(inner);
    }
    const merge = (parts: THREE.BufferGeometry[]): void => {
      const g = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!g) return;
      const m = new THREE.Mesh(g, parts === frames ? panelFrame : panelTone);
      m.receiveShadow = opts.shadows;
      m.castShadow = opts.shadows;
      scene.add(m);
    };
    merge(frames);
    merge(inners);
  }

  // ---- Mobilier (bancs, socles, plantes, console) — positions partagées avec physics.ts ----
  scene.add(buildFurniture(layout, furnitureMaterials(aniso, texMax), opts.shadows));

  // ---- Panneau du artiste sur le mur du fond ----
  if (opts.artist) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.66),
      new THREE.MeshBasicMaterial({ map: wallSignTexture(opts.artist), transparent: true, depthWrite: false }),
    );
    sign.position.set(0, 2.35, zMin + 0.14);
    scene.add(sign);
  }

  // ---- Portails entre salles + plaque laiton ----
  for (const portal of portals) {
    const z = portal.z;
    const p1 = add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, -HALL_WIDTH / 2 + 0.3, HALL_HEIGHT / 2, z);
    const p2 = add(new THREE.BoxGeometry(0.35, HALL_HEIGHT, 0.35), wood, HALL_WIDTH / 2 - 0.3, HALL_HEIGHT / 2, z);
    const lintel = add(new THREE.BoxGeometry(HALL_WIDTH - 0.6, 0.45, 0.35), wood, 0, HALL_HEIGHT - 0.225, z);
    for (const m of [p1, p2, lintel]) m.castShadow = opts.shadows;
    const zone = portal.zoneIndex >= 0 ? layout.zones[portal.zoneIndex] : undefined;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.42),
      new THREE.MeshBasicMaterial({ map: plaqueTexture(zone?.name ?? '') }),
    );
    // posée SUR la face du linteau (pas dans l'ouverture), face +z = côté visiteur
    plaque.position.set(0, HALL_HEIGHT - 0.225, z + 0.18);
    plaque.userData.zoneIndex = portal.zoneIndex;
    scene.add(plaque);
  }

  return { renderer, scene, camera, sun, spotPool, spots };
}
