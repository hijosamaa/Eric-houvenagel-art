import * as THREE from 'three';

import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import { HALL_HEIGHT, HALL_WIDTH, Z_START, hallBounds, portalPositions, type Layout } from './layout';

import { HEMI, ROOF_LAYER, SKY_FILL, SUN, TableSpots } from './lights';

import { metalTexture, precalcTexture, paintedWoodTexture } from './textures';

import { buildFurniture, furnitureMaterials } from './furniture';

import { buildPlants, plantMaterials, type PlantsBuild } from './plants';

import { buildCeiling } from './ceiling';

import { chamferedSection, extrudedPrism, timberX, timberY } from './wood';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  spotPool: THREE.SpotLight[];
  /** Contrôleur du pool de spots (hystérésis + fondu). `main.ts` l'appelle par frame. */
  spots: TableSpots;
  /** Végétation (oscillation) — `main.ts` appelle `plants.update(elapsed, reduced)`. */
  plants: PlantsBuild;
}

/**
 * Échelle de texture du plâtre : 1 tuile = **3,4 m** dans les deux directions.
 *
 * C'était 6,8 m, soit 300 px de texture par mètre : à 1 m d'un mur (≈800 px/m à l'écran)
 * la chaux était agrandie 2,7× et lisait comme une lavasse floue. À 3,4 m on est à
 * 600 px/m, la trame de badigeon garde sa finesse sans montrer la tuile (répétition en
 * miroir, `mirror: true` dans plasterTexture).
 */
const PLASTER_TILE = 3.4;
/**
 * Dimensions (m) de la tuile de parquet, renseignées par `floorTextures()`.
 * Le sol n'a plus besoin d'être découpé en 56 lames : l'asset porte les lames, on ne
 * garde de la géométrie qu'un maillage régulier pour l'occlusion de contact au pied
 * des murs (une couleur de sommet par sommet).
 */
const FLOOR_TILE: [number, number] = [1.4, 2.4];
/** Hauteur de la cimaise (filet d'accrochage au-dessus des toiles). */
const CIMAISE_Y = 2.52;

/**
 * Environnement d'éclairage **de la pièce**, pas d'un studio.
 *
 * `RoomEnvironment` (le décor de démonstration de three) est une boîte dont les seules
 * surfaces émissives sont dans l'hémisphère **haut** : toute face dont la normale pointe
 * vers le bas — la dalle de plafond, la sous-face des solives et des poutres — n'y
 * trouve aucune irradiance. C'est très exactement ce qui rendait la charpente « sombre »
 * et obligeait à la repeindre en blanc à 96 % pour la sauver.
 *
 * Ici l'environnement décrit le hall : une **bande de ciel** très lumineuse à 3,4 m,
 * des parois à l'albédo du plâtre, et surtout un **sol chaud** à 35 % du zénith qui
 * renvoie la lumière du parquet vers les faces descendantes. Les métaux (dorure,
 * laiton, bronze) y trouvent des reflets qui ressemblent au lieu, pas à des softbox.
 */
function buildEnvironmentScene(): THREE.Scene {
  const env = new THREE.Scene();
  const lit = (c: THREE.ColorRepresentation): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide });

  // enveloppe : parois à l'albédo du plâtre (0,62 linéaire)
  const shell = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 44), lit(0x9d978c));
  shell.position.y = 2.4;
  env.add(shell);

  // zénith : la verrière (bande longue et très lumineuse)
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 38),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 3.25, 3.6) }),
  );
  sky.rotation.x = Math.PI / 2;
  sky.position.set(0, 3.6, 0);
  env.add(sky);

  // sol : parquet chêne, rebond chaud mais **désaturé**. À (0,5 / 0,4 / 0,3) le rebond
  // était si orange que les sous-faces (dalle, solives, linteaux) viraient au brun
  // « contreplaqué » : un plafond peint ne peut pas être plus chaud que ses murs.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 44),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.52, 0.47, 0.41) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  env.add(ground);

  return env;
}

/** Plâtre 2048 : grain fin + grandes marbrures douces. Les UV sont cuits en mètres. */
function plasterTexture(aniso: number, coarse = false): THREE.Texture {
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
  }, {
    aniso,
    repeat: [1, 1],
    maxSize: coarse ? 1024 : 2048,
    // grade : l'asset est une chaux trowelée dont les coups de taloche sont très
    // contrastés ; adoucis, ils deviennent des nuances de badigeon.
    grade: 'saturate(0.8) brightness(1.06) contrast(0.78)',
    // miroir : sur 3,4 m de tuile, une répétition simple aligne les taloches en colonnes
    mirror: true,
  }, '#ece5d8');
}

/**
 * Parquet chêne. La tuile fait **1,40 m de large sur 2,4 m de long** : l'asset `floor`
 * (Nano Banana) contient 7 lames par largeur, ce qui donne des lames de 20 cm — la
 * largeur réelle d'un parquet à l'anglaise. Le fil court dans l'axe du hall.
 *
 * L'asset est **étalonné à l'upload** (`saturate`) : il sort de génération très orangé
 * (« photo de catalogue »), alors que le hall est un camaïeu de gris chauds. Et il est
 * répété **en miroir** : sur 12 × 25 m, une tuile de 1,4 m se repère immédiatement en
 * répétition simple (les nœuds reviennent en file).
 */
function floorTextures(aniso: number, coarse: boolean): { map: THREE.Texture; roughnessMap: THREE.Texture } {
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
      const lg = g.createLinearGradient(0, y * plankH, 0, (y + 1) * plankH);
      lg.addColorStop(0, 'rgba(255,244,224,0.10)');
      lg.addColorStop(1, 'rgba(70,46,22,0.10)');
      g.fillStyle = lg;
      g.fillRect(0, y * plankH, s, plankH);
      g.strokeStyle = 'rgba(58,38,18,0.55)';
      g.lineWidth = Math.max(2, s / 1024);
      g.beginPath();
      g.moveTo(0, y * plankH);
      g.lineTo(s, y * plankH);
      g.stroke();
      const off = ((y % 2) * s) / 3 + Math.random() * s * 0.2;
      g.strokeStyle = 'rgba(58,38,18,0.5)';
      g.beginPath();
      g.moveTo(off % s, y * plankH);
      g.lineTo(off % s, (y + 1) * plankH);
      g.stroke();
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
  // repeat 1 : les UV du sol sont DÉJÀ en tuiles (u = lames/4, v = m/2,4). Les multiplier
  // une seconde fois par repeat donnait 196 répétitions sur la largeur : le filtrage
  // mip retombait sur la couleur moyenne de l'asset, c'est-à-dire un aplat (std 1,5).
  }, {
    aniso,
    repeat: [1, 1],
    maxSize: coarse ? 1024 : 2048,
    // grade : -45 % de saturation, +6 % de luminosité. Sans lui, le sol virait à
    // l'orange boueux dès qu'il recevait le soleil de la verrière.
    grade: 'saturate(0.45) brightness(1.05) contrast(1.02)',
    mirror: true,
  }, '#8a6c46');

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
  }, { aniso: Math.min(aniso, 8), repeat: [1, 1], maxSize: 1024, mirror: true }, '#b8b8b8', false);
  // Bornes physiques de la tuile (m), partagées avec la géométrie du sol.
  FLOOR_TILE[0] = 1.4;
  FLOOR_TILE[1] = 2.4;
  return { map, roughnessMap: rough };
}

/** Plaque de salle en laiton, 512×128. */
function plaqueTexture(text: string): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#a08f74');
  grad.addColorStop(0.5, '#8f8069');
  grad.addColorStop(1, '#7c6e59');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(92,74,40,0.75)';
  g.lineWidth = 3;
  g.strokeRect(7, 7, w - 14, h - 14);
  g.fillStyle = '#40382c';
  g.font = 'italic 600 44px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Mur du fond : nom de l'artiste + sous-titre, comme un texte de salle. */
function wallSignTexture(name: string, tagline: string): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.clearRect(0, 0, w, h);

  const spaced = (text: string, y: number, font: string, color: string, tracking: number): void => {
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    const widths = [...text].map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
    let x = (w - total) / 2;
    [...text].forEach((ch, i) => {
      g.fillText(ch, x, y);
      x += widths[i] + tracking;
    });
  };

  spaced(name.toUpperCase(), 190, '500 74px Georgia, serif', 'rgba(58,52,44,0.92)', 16);
  g.fillStyle = 'rgba(58,52,44,0.35)';
  g.fillRect(w / 2 - 150, 252, 300, 2);
  spaced(tagline.toUpperCase(), 304, '400 30px Georgia, serif', 'rgba(90,82,70,0.8)', 10);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Cartouche d'entrée : le mur des toiles est nu sur les premiers mètres (la première
 * œuvre est à 4 m de l'entrée). Un texte de salle — comme à l'entrée de toute expo —
 * donne une échelle, une intention et une raison à ce vide.
 */
function entryTextTexture(artist: string, tagline: string, rooms: string[]): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.clearRect(0, 0, w, h);
  const spaced = (text: string, y: number, font: string, color: string, tracking: number): void => {
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    const widths = [...text].map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, text.length - 1);
    let x = (w - total) / 2;
    [...text].forEach((ch, i) => {
      g.fillText(ch, x, y);
      x += widths[i] + tracking;
    });
  };
  spaced(artist.toUpperCase(), 150, '500 62px Georgia, serif', 'rgba(48,44,38,0.95)', 12);
  g.fillStyle = 'rgba(60,54,46,0.30)';
  g.fillRect(w / 2 - 120, 202, 240, 2);
  spaced(tagline.toUpperCase(), 250, '400 26px Georgia, serif', 'rgba(84,76,64,0.9)', 8);
  g.font = '400 26px Georgia, serif';
  g.fillStyle = 'rgba(74,68,58,0.75)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const list = rooms.join('   ·   ');
  g.fillText(list, w / 2, 330, w - 90);
  spaced('GALERIE VIRTUELLE', 408, '400 20px Inter, system-ui, sans-serif', 'rgba(110,102,90,0.7)', 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Profil de moulure extrudé (plinthe). */
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
  opts: { shadows: boolean; coarse: boolean; artist?: string; tagline?: string },
): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  // Khronos PBR Neutral plutôt qu'ACES : ACES désature fortement dès 0,6 de luminance,
  // et c'est exactement ce qui transformait le parquet chêne en aplat gris-blanc (une
  // teinte chaude à 0,75 de luminance ressortait à +11 de rouge). Neutral tient la
  // chroma jusque dans les hautes lumières et ne casse un blanc qu'au-delà de 1,0.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.shadowMap.enabled = opts.shadows;
  // PCFShadowMap utilise `shadow.radius` (Vogel disk + hardware PCF) : c'est le seul
  // filtre de three qui permette une pénombre réglable. PCFSoft a un noyau fixe, d'où
  // l'arête « au couteau » des taches de soleil sous la verrière.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const aniso = Math.min(maxAniso, opts.coarse ? 8 : 16);
  const texMax = opts.coarse ? 1024 : 2048;

  const scene = new THREE.Scene();
  const { zMin, zMax } = hallBounds(layout);
  const len = zMax - zMin;
  const cz = (zMin + zMax) / 2;
  scene.background = new THREE.Color(0xd9d0bf);
  // Brume d'air (pas de brouillard) : elle ne sert qu'à faire perdre du contraste au fond
  // du hall, ce qui est le seul repère de profondeur à 25 m et au-delà.
  scene.fog = new THREE.FogExp2(0xdcd6ca, 0.32 / Math.max(20, len));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = buildEnvironmentScene();
  scene.environment = pmrem.fromScene(envScene, 0.25).texture;
  scene.environmentIntensity = 0.58;
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  pmrem.dispose();

  // near relevé à 0,14 m : la reconstruction de profondeur du GTAO y gagne assez de
  // précision pour ne plus bruiter les murs plats (l'ancien 0,05 m bruitait l'AO).
  const camera = new THREE.PerspectiveCamera(52, 1, 0.14, Math.max(160, len + 40));
  camera.position.set(layout.pathX, 1.6, Z_START);
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
    sun.shadow.camera.far = 42;
    sun.shadow.bias = SUN.shadow.bias;
    sun.shadow.normalBias = SUN.shadow.normalBias;
    sun.shadow.radius = SUN.shadow.radius;
    sun.shadow.camera.layers.enable(ROOF_LAYER);
  }

  if (SKY_FILL.enabled && !opts.coarse) {
    RectAreaLightUniformsLib.init();
    const sky = new THREE.RectAreaLight(SKY_FILL.color, SKY_FILL.intensity, SKY_FILL.width, SKY_FILL.height);
    sky.position.set(0, SKY_FILL.y, cz);
    sky.rotation.x = Math.PI / 2;
    sky.layers.set(0);
    scene.add(sky);
  }

  const spots = new TableSpots(scene, { count: opts.coarse ? 3 : 6, shadows: opts.shadows });
  const spotPool = spots.pool;

  // ---- matériaux ----
  const plasterTex = plasterTexture(aniso, opts.coarse);
  // La dalle a ses UV en tuiles de 6,4 m : repeat 1 (sinon l'enduit est étiré en stries).
  const ceilingTex = plasterTexture(aniso, opts.coarse);
  const plaster = new THREE.MeshStandardMaterial({
    map: plasterTex,
    bumpMap: plasterTex,
    bumpScale: 0.004,
    roughness: 0.94,
    envMapIntensity: 0.2,
    vertexColors: true,
  });
  const { map: floorMap, roughnessMap: floorRough } = floorTextures(aniso, opts.coarse);
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorMap,
    roughnessMap: floorRough,
    // relief des lames : sans bump, les joints ne lisent plus à l'ombre
    bumpMap: floorMap,
    bumpScale: 0.007,
    // Le parquet reste **plus foncé que les murs** d'environ un tiers : c'est ce
    // rapport-là qui fait lire une pièce plutôt qu'un studio blanc. 0xbfb5a3 laisse
    // l'asset lisible (lames, nœuds) tout en le ramenant dans le camaïeu du hall.
    color: 0xbfb5a3,
    // Vernis très discret (0,04) : à 20° d'incidence, un clearcoat même faible prend
    // toute la place via Fresnel et le sol devient un miroir brun lisse — les lames et
    // le fil de l'asset disparaissent purement et simplement. Le parquet est donc
    // mat (0,68) et ne réfléchit presque pas l'environnement.
    roughness: 0.68,
    clearcoat: 0.04,
    clearcoatRoughness: 0.62,
    envMapIntensity: 0.22,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    // Même enduit que les murs (l'asset `ceiling` dédié montre des stries qui lisent
    // comme du contreplaqué une fois étirées sur la dalle) mais un ton plus clair.
    map: ceilingTex,
    color: 0xf4efe6,
    bumpMap: ceilingTex,
    bumpScale: 0.003,
    roughness: 0.95,
    // La dalle ne voit aucune source directe (elle regarde le sol) : c'est l'IBL qui la
    // tient. Sans cela elle tombait dans un gris-brun sale au-dessus des toiles.
    envMapIntensity: 1.0,
  });
  // Bois peint de la charpente et des portiques : le relief et l'ombre font le travail.
  const paintedTex = paintedWoodTexture(aniso, 1, texMax);
  const painted = new THREE.MeshStandardMaterial({
    map: paintedTex,
    color: 0xe7e2d8,
    roughness: 0.68,
    metalness: 0,
    envMapIntensity: 0.3,
  });
  // Menuiseries (plinthes, cimaise, filet) : même enduit que le mur, 4 % plus sombre.
  // Une plinthe 20 % plus claire que son mur est l'un des détails qui « trahissent ».
  const trim = new THREE.MeshStandardMaterial({
    map: plasterTex,
    color: 0xe6dfd1,
    bumpMap: plasterTex,
    bumpScale: 0.003,
    roughness: 0.9,
    envMapIntensity: 0.2,
  });
  // Meneaux : acier laqué **anthracite chaud**, pas du bronze noir. L'asset `metal` est
  // sombre (moyenne 74/57/34) : multiplié par une teinte bronze, il donnait des membres
  // quasi noirs, et la verrière se lisait comme un caisson de bois.
  const bronze = new THREE.MeshStandardMaterial({
    map: metalTexture(aniso, texMax),
    color: 0xcfc9c0,
    roughness: 0.5,
    metalness: 0.55,
    envMapIntensity: 1.1,
  });

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

  // Sol : 60 lames de 20 cm (12 m / 60), soit exactement 7 lames par tuile de texture
  // (1,40 m) — les joints de la géométrie tombent donc pile sur ceux de l'asset.
  //
  // Pourquoi de la géométrie alors que l'asset porte déjà les lames : à 1,9 m de haut,
  // un parquet est vu à ~20°, soit un rapport d'anisotropie de 10 à 30:1. Même en
  // filtrage anisotrope 16×, le GPU moyenne les joints sur 3 ou 4 lames et le sol
  // redevient un aplat de couleur (vérifié : écart-type 1,5 sur une zone de 400 px).
  // Une gorge réelle, elle, ne se fait pas moyenner : on cuit donc dans les couleurs de
  // sommet l'assombrissement du joint (1,2 cm de chaque côté) et la teinte de chaque
  // lame, et on laisse l'asset fournir le fil, les nœuds et les abouts.
  const floorGeo = (() => {
    const planks = 60;
    const rows = 20;
    const halfW = HALL_WIDTH / 2;
    const halfL = len / 2;
    const w = HALL_WIDTH / planks;
    let seed = 987654321;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    // Profil en travers d'une lame : [position (m), facteur d'occlusion]
    const across: [number, number][] = [
      [0, 0.7], [0.005, 0.79], [0.014, 0.92], [0.03, 0.99],
      [w - 0.03, 0.99], [w - 0.014, 0.92], [w - 0.005, 0.79], [w, 0.7],
    ];
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const push = (x: number, z: number, k: number): void => {
      pos.push(x, 0, z);
      uv.push((x + halfW) / FLOOR_TILE[0], (z + halfL) / FLOOR_TILE[1]);
      col.push(k, k * 0.997, k * 0.99);
    };
    for (let p = 0; p < planks; p++) {
      const px = -halfW + p * w;
      // teinte de lame : ±4 %, comme un vrai calepinage (l'asset en porte déjà une,
      // on ne fait qu'éviter que deux lames voisines soient identiques)
      const tone = 0.96 + rnd() * 0.08;
      for (let a = 0; a < across.length - 1; a++) {
        const [xa, fa] = across[a];
        const [xb, fb] = across[a + 1];
        for (let j = 0; j < rows; j++) {
          const z0 = -halfL + (j / rows) * len;
          const z1 = -halfL + ((j + 1) / rows) * len;
          // occlusion murale, en plus : la lame s'assombrit au pied de la plinthe
          const wall = (z: number): number => {
            const dz = Math.max(0, halfL - Math.abs(z));
            return 0.9 + 0.1 * Math.min(1, Math.pow(Math.min(dz, 8) / 1.6, 0.75));
          };
          const ka = tone * fa * wall(z0);
          const kb = tone * fb * wall(z1);
          // Ordre horaire vu du dessus → normale +Y (le back-face culling supprimait
          // le sol entier quand l'ordre était inversé).
          push(px + xa, z0, ka);
          push(px + xa, z1, ka);
          push(px + xb, z1, kb);
          push(px + xa, z0, ka);
          push(px + xb, z1, kb);
          push(px + xb, z0, kb);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const nrm = new Float32Array((pos.length / 3) * 3);
    for (let i = 0; i < pos.length / 3; i++) nrm[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    return g;
  })();
  floorMat.vertexColors = true;
  const floor = add(floorGeo, floorMat, 0, 0, cz);
  floor.name = 'sol';

  // ---- Murs ----
  // UV **en mètres** (tuile de PLASTER_TILE dans les deux directions : l'ancien
  // `repeat: [len/13, 1]` étirait l'enduit 3,8:1 et fabriquait des stries verticales).
  // Et un **dégradé vertical en couleur de sommet** : c'est la lumière du ciel qui
  // décroît du haut vers le bas. Sans lui, un mur vertical sous une verrière est un
  // aplat, et un aplat ne se lit pas comme un lieu.
  const wallGeo = (w: number, h: number, d: number, dimU: number): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) * dimU) / PLASTER_TILE, (uv.getY(i) * h) / PLASTER_TILE);
    }
    uv.needsUpdate = true;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getY(i) + h / 2) / h));
      // 0,86 au sol → 1,12 sous la sablière, en courbe douce (approximation du ciel)
      const v = 0.8 + 0.24 * Math.pow(t, 0.75);
      col[i * 3] = v;
      col[i * 3 + 1] = v;
      col[i * 3 + 2] = v * 0.995;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  add(wallGeo(0.25, HALL_HEIGHT, len, len), plaster, -HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(wallGeo(0.25, HALL_HEIGHT, len, len), plaster, HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
  add(wallGeo(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25, HALL_WIDTH + 0.5), plaster, 0, HALL_HEIGHT / 2, zMax);
  add(wallGeo(HALL_WIDTH + 0.5, HALL_HEIGHT, 0.25, HALL_WIDTH + 0.5), plaster, 0, HALL_HEIGHT / 2, zMin);

  // ---- Charpente + verrière (ceiling.ts) ----
  const ceiling = buildCeiling(layout, { painted, plaster: ceilMat, bronze }, opts.shadows);
  scene.add(ceiling.group);

  // ---- Plinthes extrudées (profil réel, pas une boîte) ----
  const inner = HALL_WIDTH / 2 - 0.125;
  const skirtProfile: [number, number][] = [
    [0, 0], [0.045, 0], [0.045, 0.018], [0.022, 0.042], [0.036, 0.115], [0, 0.115],
  ];
  const skirtGeo = moldingGeometry(skirtProfile, len);
  const skirtR = new THREE.Mesh(skirtGeo, trim);
  skirtR.rotation.y = Math.PI;
  skirtR.position.set(inner, 0, zMax);
  skirtR.receiveShadow = opts.shadows;
  skirtR.name = 'plinthe';
  scene.add(skirtR);
  const skirtL = new THREE.Mesh(skirtGeo, trim);
  skirtL.position.set(-inner, 0, zMin);
  skirtL.receiveShadow = opts.shadows;
  scene.add(skirtL);

  // ---- Filet en creux sur le mur droit : une ligne d'ombre à 1,05 m suffit à donner
  // une échelle au grand aplomb qui fait face aux toiles (sans le boiserie-à-colonnes
  // de la version précédente). Deux petits plats encadrent la gorge.
  {
    const grooveY = 1.05;
    const x = HALL_WIDTH / 2 - 0.125;
    const g = extrudedPrism(chamferedSection(0.016, 0.03, 0.003), len, { tileV: 3 });
    const m = add(g, trim, x - 0.008, grooveY, cz);
    m.name = 'filet-mur-droit';
  }

  // ---- Cimaise (filet d'accrochage) sur les deux longs murs ----
  for (const sx of [-1, 1]) {
    const g = extrudedPrism(chamferedSection(0.03, 0.05, 0.006), len, { tileV: 3 });
    const m = add(g, trim, sx * (HALL_WIDTH / 2 - 0.125), CIMAISE_Y, cz);
    m.name = 'cimaise';
  }

  // ---- Mobilier ----
  scene.add(buildFurniture(layout, furnitureMaterials(aniso, texMax), opts.shadows));

  // ---- Végétation ----
  const plants = buildPlants(layout, plantMaterials(aniso), opts.shadows);
  scene.add(plants.group);

  // ---- Texte de salle sur le mur du fond ----
  if (opts.artist) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.9, 1.95),
      new THREE.MeshStandardMaterial({
        map: wallSignTexture(opts.artist, opts.tagline ?? 'Huile & aquarelle'),
        transparent: true,
        roughness: 0.95,
        envMapIntensity: 0.1,
        depthWrite: false,
      }),
    );
    sign.position.set(0, 2.05, zMin + 0.135);
    sign.name = 'texte-salle';
    scene.add(sign);
  }

  // ---- Cartouche d'entrée, sur le mur des toiles, avant la première œuvre ----
  {
    const zEntry = Z_START - 1.15;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.7),
      new THREE.MeshStandardMaterial({
        map: entryTextTexture(
          opts.artist ?? '',
          opts.tagline ?? 'Huile & aquarelle',
          layout.zones.map((zn) => zn.name),
        ),
        transparent: true,
        roughness: 0.95,
        envMapIntensity: 0.1,
        depthWrite: false,
      }),
    );
    panel.position.set(-HALL_WIDTH / 2 + 0.136, 1.62, zEntry);
    panel.rotation.y = Math.PI / 2;
    panel.name = 'cartouche-entree';
    scene.add(panel);
  }

  // ---- Portiques entre salles (bois peint) + plaque laiton ----
  const portals = portalPositions(layout);
  const pierX = HALL_WIDTH / 2 - 0.3;
  for (const portal of portals) {
    const z = portal.z;
    // piliers : fût chanfreiné + base en retrait (le pilier « pose » sur le sol)
    for (const sx of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.4), painted);
      base.position.set(sx * pierX, 0.045, z);
      base.receiveShadow = opts.shadows;
      scene.add(base);
      const shaft = new THREE.Mesh(timberY({ length: HALL_HEIGHT - 0.09, width: 0.34, height: 0.34, chamfer: 0.014 }), painted);
      shaft.position.set(sx * pierX, 0.09, z);
      shaft.castShadow = opts.shadows;
      shaft.receiveShadow = opts.shadows;
      scene.add(shaft);
    }
    // linteau
    const lintel = new THREE.Mesh(
      timberX({ length: HALL_WIDTH - 0.6, width: 0.34, height: 0.45, chamfer: 0.016 }),
      painted,
    );
    lintel.position.set(0, HALL_HEIGHT - 0.225, z);
    lintel.castShadow = opts.shadows;
    lintel.receiveShadow = opts.shadows;
    scene.add(lintel);

    const zone = portal.zoneIndex >= 0 ? layout.zones[portal.zoneIndex] : undefined;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.288),
      new THREE.MeshStandardMaterial({
        map: plaqueTexture(zone?.name ?? ''),
        roughness: 0.35,
        metalness: 0.6,
        envMapIntensity: 0.9,
      }),
    );
    plaque.position.set(0, HALL_HEIGHT - 0.225, z + 0.172);
    plaque.userData.zoneIndex = portal.zoneIndex;
    plaque.name = 'plaque';
    scene.add(plaque);
  }

  return { renderer, scene, camera, sun, spotPool, spots, plants };
}
