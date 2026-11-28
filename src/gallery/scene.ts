import * as THREE from 'three';

import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import {
  DOOR_W,
  EYE_Y,
  SAS_HALF,
  WALL_T,
  edgeRuns,
  roomEdges,
  type Layout,
  type Rect,
} from './layout';

import { HEMI, ROOF_LAYER, SKY_FILL, SUN, TableSpots } from './lights';

import { metalTexture, precalcTexture, paintedWoodTexture } from './textures';

import { buildFurniture, furnitureColliders, furnitureMaterials } from './furniture';

import { buildPlants, plantColliders, plantMaterials, type PlantsBuild } from './plants';

import { buildCeilings } from './ceiling';

import { buildContactShadows } from './contact';

import { chamferedSection, extrudedPrism } from './wood';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  spotPool: THREE.SpotLight[];
  /** Ciel diffus de la trémie, déplacé par `main.ts` dans la pièce courante. */
  skyFill: THREE.RectAreaLight | null;
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
const PLASTER_TILE = 1.7;
/**
 * Dimensions (m) de la tuile de parquet, renseignées par `floorTextures()`.
 * Le sol n'a plus besoin d'être découpé en 56 lames : l'asset porte les lames, on ne
 * garde de la géométrie qu'un maillage régulier pour l'occlusion de contact au pied
 * des murs (une couleur de sommet par sommet).
 */
const FLOOR_TILE: [number, number] = [2.1, 3.6];
/**
 * Hauteur de la cimaise (filet d'accrochage au-dessus des toiles). Elle court dans toutes
 * les salles à la même hauteur : c'est la seule ligne continue du lieu, et c'est elle qui
 * fait qu'on se sent dans une galerie et non dans quatre pièces.
 */
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
  const shell = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 44), lit(0xb0aaa0));
  shell.position.y = 2.4;
  env.add(shell);

  // zénith : la verrière (bande longue et très lumineuse)
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 38),
    // 3,4 linéaire, et c'est la **dorure** qui a son propre multiplicateur (envMapIntensity
    // 3,5) : monter l'enveloppe à 7,0 éclairait aussi les murs (moyenne +30 niveaux). Un
    // matériau métallique doit chercher sa réserve dans son envMapIntensity, pas imposer
    // un ciel surexposé à tout le lieu.
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 3.5, 3.65) }),
  );
  sky.rotation.x = Math.PI / 2;
  sky.position.set(0, 3.6, 0);
  env.add(sky);

  // sol : parquet chêne, rebond chaud mais **désaturé**. À (0,5 / 0,4 / 0,3) le rebond
  // était si orange que les sous-faces (dalle, solives, linteaux) viraient au brun
  // « contreplaqué » : un plafond peint ne peut pas être plus chaud que ses murs.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 44),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.47, 0.42) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  env.add(ground);

  return env;
}

/** Plâtre 2048 : grain fin + grandes marbrures douces. Les UV sont cuits en mètres. */
function plasterTexture(aniso: number, coarse = false, extraGrade = '', slot = 'plaster'): THREE.Texture {
  return precalcTexture(slot, 2048, (g, s) => {
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
    // contrastés ; adoucis, ils deviennent des nuances de badigeon. Mais un contraste de
    // 0,68 tirait *toute* la texture vers le gris moyen : sur un mur, 242 devenait 205,
    // et la chaux crème virait au béton (murs mesurés à 154 de luminance moyenne, p05 124
    // — aucun ancrage sombre dans l'image). 0,88 garde le badigeon et sa couleur.
    grade: `saturate(1.04) brightness(1.02) contrast(0.94) ${extraGrade}`.trim(),
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
    grade: 'saturate(0.3) brightness(1.06) contrast(1.0)',
    // Miroir conservé : sans lui, la jointure de tuile se lit comme une bande sombre en
    // travers du parquet (l'asset ne boucle pas parfaitement). La tuile est passée de
    // 1,4 × 2,4 à 2,1 × 3,6 m, donc les paires inversées s'éloignent de 50 %.
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
  return { map, roughnessMap: rough };
}

/** Plaque de salle en laiton, 512×128. */
/**
 * Texte de salle, **peint sur le mur** (graphisme de musée), pas une plaque de laiton.
 *
 * Une plaque métallique de 60 cm sur un trumeau de 80 cm, vue de biais, devenait une
 * tache sombre illisible. Un lettrage fin, posé à hauteur de regard, se lit dans le
 * mouvement et ne concurrence pas les œuvres.
 */
function plaqueTexture(text: string): THREE.CanvasTexture {
  // 2048 × 384 et non 1024 × 192 : le nom de salle est lu à 8-12 m, et à 1024 px de large
  // il ne restait que 35 px d'écran — le texte devenait un gris sale.
  const w = 2048;
  const h = 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(38,36,33,0.95)';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  // numéro de salle au-dessus, nom en dessous
  g.font = '500 68px Inter, system-ui, sans-serif';
  g.letterSpacing = '24px';
  g.fillText('SALLE', 12, 96);
  g.font = 'italic 400 168px Georgia, serif';
  g.letterSpacing = '0px';
  g.fillText(text, 8, 292, w - 32);
  g.fillStyle = 'rgba(46,44,40,0.3)';
  g.fillRect(12, 328, 300, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** Mur du fond : nom de l'artiste + sous-titre, comme un texte de salle. */
function wallSignTexture(name: string, tagline: string): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  g.clearRect(0, 0, w, h);
  // Le dessin est écrit pour un canvas de 1024 × 512 : on le met à l'échelle 2× pour le
  // rendre net sur 2048 × 1024 (le mur du nom se lit à 6 m, face à l'entrée).
  g.scale(w / 1024, h / 512);

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

  spaced(name.toUpperCase(), 190, '500 74px Georgia, serif', 'rgba(48,43,37,0.96)', 16);
  g.fillStyle = 'rgba(58,52,44,0.35)';
  g.fillRect(w / 2 - 150, 252, 300, 2);
  spaced(tagline.toUpperCase(), 304, '400 30px Georgia, serif', 'rgba(74,67,57,0.9)', 10);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/* `entryTextTexture` a été retirée avec le cartouche qu'elle dessinait (voir plus bas). */

/** Profil de moulure extrudé (plinthe). */
function moldingGeometry(profile: [number, number][], len: number, footGradient = false): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 4 });
  if (footGradient) {
    // occlusions de pied : 0,86 au sol → 1,00 à 11 cm (le profil de plinthe)
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const top = Math.max(...profile.map((p) => p[1]));
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / Math.max(0.001, top)));
      const k = 0.86 + 0.14 * Math.pow(t, 0.7);
      col[i * 3] = k;
      col[i * 3 + 1] = k * 0.998;
      col[i * 3 + 2] = k * 0.99;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}


/**
 * Parquet d'une pièce.
 *
 * Une lame tous les 20 cm, des abouts tous les 1,25 m, une teinte de lame (±4 %) et un
 * joint cuit dans les **couleurs de sommet** : c'est la seule façon de garder des joints
 * lisibles quand le sol est vu à 20° d'incidence (le GPU moyenne trois ou quatre lames
 * en anisotrope, et le parquet redevient un aplat de couleur).
 *
 * Les lames suivent la profondeur de la pièce — on entre dans le fil du bois. Les UV sont
 * en coordonnées **monde** pour que le calepinage se poursuive d'une pièce à l'autre sans
 * raccord visible dans les baies.
 */
function floorGeometry(rect: Rect, axis: 'x' | 'z'): THREE.BufferGeometry {
  const width = axis === 'z' ? rect.x1 - rect.x0 : rect.z1 - rect.z0;
  const length = axis === 'z' ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
  const halfW = width / 2;
  const halfL = length / 2;
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const planks = Math.max(6, Math.round(width / 0.2));
  const w = width / planks;
  const rows = Math.max(4, Math.round(length / 1.25));
  let seed = (Math.round(cx * 7) * 73856093) ^ (Math.round(cz * 11) * 19349663) ^ 987654321;
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
  const push = (a: number, l: number, k: number): void => {
    const x = axis === 'z' ? cx + a : cx + l;
    const z = axis === 'z' ? cz + l : cz + a;
    pos.push(x, 0, z);
    uv.push(
      (axis === 'z' ? x : z) / FLOOR_TILE[0],
      (axis === 'z' ? z : x) / FLOOR_TILE[1],
    );
    col.push(k, k * 0.997, k * 0.99);
  };
  /** Occlusion de pied de mur : la lame s'assombrit sur les 1,6 derniers mètres. */
  const wall = (a: number, l: number): number => {
    const d = Math.min(halfW - Math.abs(a), halfL - Math.abs(l));
    return 0.9 + 0.1 * Math.min(1, Math.pow(Math.min(Math.max(d, 0), 8) / 1.6, 0.75));
  };
  for (let p = 0; p < planks; p++) {
    const a0 = -halfW + p * w;
    const tone = 0.96 + rnd() * 0.08;
    for (let k = 0; k < across.length - 1; k++) {
      const [xa, fa] = across[k];
      const [xb, fb] = across[k + 1];
      const A = a0 + xa;
      const B = a0 + xb;
      for (let j = 0; j < rows; j++) {
        const L0 = -halfL + (j / rows) * length;
        const L1 = -halfL + ((j + 1) / rows) * length;
        const ka = tone * fa * wall(A, (L0 + L1) / 2);
        const kb = tone * fb * wall(B, (L0 + L1) / 2);
        // ordre horaire vu du dessus → normale +Y. Le repère local est retourné quand les
        // lames courent selon x : on inverse alors le sens des triangles.
        if (axis === 'z') {
          push(A, L0, ka);
          push(A, L1, ka);
          push(B, L1, kb);
          push(A, L0, ka);
          push(B, L1, kb);
          push(B, L0, kb);
        } else {
          push(A, L0, ka);
          push(B, L1, kb);
          push(A, L1, ka);
          push(A, L0, ka);
          push(B, L0, kb);
          push(B, L1, kb);
        }
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
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = opts.shadows;
  // PCFShadowMap utilise `shadow.radius` (Vogel disk + hardware PCF) : c'est le seul
  // filtre de three qui permette une pénombre réglable. PCFSoft a un noyau fixe, d'où
  // l'arête « au couteau » des taches de soleil sous la verrière.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const aniso = Math.min(maxAniso, opts.coarse ? 8 : 16);
  const texMax = opts.coarse ? 1024 : 2048;

  const scene = new THREE.Scene();
  const B = layout.bounds;
  // Plus de « longueur de hall » : le bâti est un plan de 40 × 27 m. On garde une brume
  // d'air très légère, calée sur la plus grande diagonale — elle ne sert qu'à reculer le
  // fond d'une salle vue de l'autre, pas à noyer le lieu.
  const span = Math.max(B.x1 - B.x0, B.z1 - B.z0);
  scene.background = new THREE.Color(0xd9d0bf);
  scene.fog = new THREE.FogExp2(0xdcd6ca, 0.3 / Math.max(24, span));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = buildEnvironmentScene();
  scene.environment = pmrem.fromScene(envScene, 0.25).texture;
  scene.environmentIntensity = 0.34;
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  pmrem.dispose();

  // near relevé à 0,14 m : la reconstruction de profondeur du GTAO y gagne assez de
  // précision pour ne plus bruiter les murs plats (l'ancien 0,05 m bruitait l'AO).
  const camera = new THREE.PerspectiveCamera(52, 1, 0.14, Math.max(120, span + 40));
  const p0 = layout.at(0);
  camera.position.set(p0.x, EYE_Y, p0.z);
  camera.layers.enable(ROOF_LAYER);

  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, opts.coarse ? HEMI.coarseIntensity : HEMI.intensity));

  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.position.set(SUN.position.x, SUN.position.y, SUN.position.z);
  sun.target.position.set(0, 0, 0);
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

  let skyFill: THREE.RectAreaLight | null = null;
  if (SKY_FILL.enabled && !opts.coarse) {
    RectAreaLightUniformsLib.init();
    skyFill = new THREE.RectAreaLight(SKY_FILL.color, 0, 1, 1);
    // à plat sous la dalle, éclairant vers le bas ; updateSkyFill() la déplace ensuite.
    skyFill.rotation.x = -Math.PI / 2;
    skyFill.layers.set(0);
    skyFill.name = 'ciel-verriere';
    scene.add(skyFill);
  }

  const spots = new TableSpots(scene, { count: opts.coarse ? 3 : 12, shadows: opts.shadows });
  const spotPool = spots.pool;

  // ---- matériaux ----
  const plasterTex = plasterTexture(aniso, opts.coarse);
  // La dalle a ses UV en tuiles de 3,4 m (voir ceiling.ts) : repeat 1.
  // Désaturée à 35 % : l'enduit crème, vu en sous-face sous un rebond chaud, tirait sur
  // le kraft ; un plafond peint lit gris-blanc, même dans une salle très chaude.
  const ceilingTex = plasterTexture(
    Math.min(aniso, 4),
    opts.coarse,
    'saturate(0.35) brightness(1.04)',
    'ceiling',
  );
  const plaster = new THREE.MeshStandardMaterial({
    map: plasterTex,
    // Un blanc chaud de 1 %, pas plus : à 0xfff4e6 la chaux virait au beige kaki sur
    // toute la surface des murs (le lieu est déjà chaud par sa texture et son IBL).
    color: 0xfffdf8,
    bumpMap: plasterTex,
    // 3,5 mm : à 1,8 mm les taloches ne lisaient plus du tout à 2 m.
    bumpScale: 0.0035,
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
    color: 0xc2b49f,
    // Vernis très discret (0,04) : à 20° d'incidence, un clearcoat même faible prend
    // toute la place via Fresnel et le sol devient un miroir brun lisse — les lames et
    // le fil de l'asset disparaissent purement et simplement. Le parquet est donc
    // mat (0,68) et ne réfléchit presque pas l'environnement.
    // 0,50 + un clearcoat réel : mesuré à 45 % de saturation et sans aucune réflexion,
    // le parquet lisait « orange plat ». Il reste mat, mais il accroche la verrière.
    roughness: 0.5,
    clearcoat: 0.28,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.55,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    // Même enduit que les murs (l'asset `ceiling` dédié montre des stries qui lisent
    // comme du contreplaqué une fois étirées sur la dalle) mais un ton plus clair.
    map: ceilingTex,
    // Quasi blanc : une sous-face ne reçoit que le rebond. Avec un ton crème elle virait
    // au « contreplaqué » sur toute la surface du plafond, qui occupe un tiers de l'image.
    color: 0xfcf8f1,
    bumpMap: ceilingTex,
    // 1,5 mm : une sous-face ne montre pas de relief à 3 m, un bump plus fort ne fait
    // qu'ajouter du bruit de shading sur toute la surface.
    bumpScale: 0.0015,
    roughness: 0.95,
    // La dalle ne voit aucune source directe (elle regarde le sol) : c'est l'IBL qui la
    // tient, et il ne rend que le premier rebond. Un studio réel reçoit 3 à 4 rebonds sur
    // une sous-face ; on les remplace par une faible émission neutre (0,13), qui relève le
    // plafond **sans le teinter** et le ramène à ~90 % de la valeur des murs, comme sur
    // une photo. Sans elle, la dalle lisait « contreplaqué » sur un tiers de l'image.
    envMapIntensity: 1.7,
    emissive: 0xfffaf2,
    // mobile : pas de RectAreaLight de ciel ni de GTAO, donc moins de rebond perçu — on
    // compense l'émission de la dalle pour que le plafond ne vire pas au kraft.
    emissiveIntensity: opts.coarse ? 0.12 : 0.05,
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
  // Plinthe : même enduit, mais elle **reçoit le dégradé de pied de mur** (couleurs de
  // sommet). Sans lui, la plinthe restait 10-15 niveaux plus claire que le mur qu'elle
  // borde, avec un filet spéculaire sur l'arête : le détail qui trahit une maquette.
  const trimBase = new THREE.MeshStandardMaterial({
    map: plasterTex,
    color: 0xdfd8ca,
    bumpMap: plasterTex,
    bumpScale: 0.003,
    roughness: 0.9,
    envMapIntensity: 0.15,
    vertexColors: true,
  });
  // Meneaux : acier laqué **anthracite chaud**, pas du bronze noir. L'asset `metal` est
  // sombre (moyenne 74/57/34) : multiplié par une teinte bronze, il donnait des membres
  // quasi noirs, et la verrière se lisait comme un caisson de bois.
  const bronze = new THREE.MeshStandardMaterial({
    map: metalTexture(aniso, texMax),
    color: 0xcfc9c0,
    roughness: 0.66,
    metalness: 0.22,
    envMapIntensity: 0.25,
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

  // ---- Sol : un parquet par pièce ----
  //
  // Pourquoi de la géométrie alors que l'asset porte déjà les lames : à 1,9 m de haut,
  // un parquet est vu à ~20°, soit un rapport d'anisotropie de 10 à 30:1. Même en
  // filtrage anisotrope 16×, le GPU moyenne les joints sur 3 ou 4 lames et le sol
  // redevient un aplat de couleur (vérifié : écart-type 1,5 sur une zone de 400 px).
  // Une gorge réelle, elle, ne se fait pas moyenner : on cuit donc dans les couleurs de
  // sommet l'assombrissement du joint (1,2 cm de chaque côté) et la teinte de chaque
  // lame, et on laisse l'asset fournir le fil, les nœuds et les abouts.
  //
  // Les lames **suivent la profondeur de la pièce** (l'axe du parcours) : on entre dans
  // le fil du bois, ce qui creuse la perspective au lieu de la barrer.
  floorMat.vertexColors = true;
  for (const room of layout.rooms) {
    const axis: 'x' | 'z' = room.inZ !== 0 ? 'z' : 'x';
    const f = add(floorGeometry(room.rect, axis), floorMat, 0, 0, 0);
    f.name = `sol-${room.id}`;
  }

  /**
   * Mur : boîte + UV en mètres + **dégradé vertical en couleur de sommet**.
   *
   * C'est la lumière du ciel qui décroît du haut vers le bas ; sans ce dégradé, un mur
   * vertical sous une verrière est un aplat, et un aplat ne se lit pas comme un lieu.
   * Les UV sont exprimées en mètres absolus (U le long du mur, V en altitude) pour qu'un
   * linteau et le mur qu'il surmonte ne montrent pas deux trames de badigeon.
   */
  const wallGeo = (
    w: number,
    h: number,
    d: number,
    dimU: number,
    y0 = 0,
    yTop = h,
  ): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) * dimU) / PLASTER_TILE, (y0 + uv.getY(i) * h) / PLASTER_TILE);
    }
    uv.needsUpdate = true;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const ref = Math.max(0.2, yTop);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getY(i) + h / 2 + y0) / ref));
      // 0,80 au sol → 1,04 sous la sablière, en courbe douce (approximation du ciel)
      const v = 0.8 + 0.24 * Math.pow(t, 0.75);
      col[i * 3] = v;
      col[i * 3 + 1] = v;
      col[i * 3 + 2] = v * 0.995;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };

  // ---- Murs ----
  // UV **en mètres** (tuile de PLASTER_TILE dans les deux directions : l'ancien
  // `repeat: [len/13, 1]` étirait l'enduit 3,8:1 et fabriquait des stries verticales).
  // Et un **dégradé vertical en couleur de sommet** : c'est la lumière du ciel qui
  // décroît du haut vers le bas. Sans lui, un mur vertical sous une verrière est un
  // aplat, et un aplat ne se lit pas comme un lieu.
  //
  // Les murs viennent de `layout.walls` — les **mêmes** tronçons que ceux de la
  // physique : murs mitoyens fusionnés, baies percées, linteaux posés. Le visuel ne peut
  // donc pas diverger des collisions.
  for (const w of layout.walls) {
    const L = w.to - w.from;
    const h = w.y1 - w.y0;
    if (L < 0.02 || h < 0.02) continue;
    const g =
      w.dir === 'x'
        ? wallGeo(L, h, WALL_T, L, w.y0, w.y1)
        : wallGeo(WALL_T, h, L, L, w.y0, w.y1);
    const px = w.dir === 'x' ? (w.from + w.to) / 2 : w.at;
    const pz = w.dir === 'x' ? w.at : (w.from + w.to) / 2;
    const mesh = add(g, plaster, px, w.y0 + h / 2, pz, { cast: true });
    mesh.name = w.outer ? 'mur-facade' : 'mur';
  }

  // ---- Plafonds + verrières, salle par salle (ceiling.ts) ----
  const ceiling = buildCeilings(layout, { painted, plaster: ceilMat, bronze }, opts.shadows);
  scene.add(ceiling.group);

  // ---- Plinthes + cimaise, par pièce et par côté, interrompues aux baies ----
  //
  // Elles ne sont plus deux lignes filantes le long d'un hall : chaque pièce a son tour
  // complet, et le passage d'une baie les coupe net. C'est ce qui donne à chaque salle
  // ses limites, sans moulure qui traverse une ouverture.
  const skirtProfile: [number, number][] = [
    [0, 0], [0.045, 0], [0.045, 0.018], [0.022, 0.042], [0.036, 0.115], [0, 0.115],
  ];
  for (const room of layout.rooms) {
    for (const e of roomEdges(room.rect)) {
      const rot = Math.atan2(-e.nz, e.nx);
      const tx = Math.sin(rot);
      const tz = Math.cos(rot);
      const alongX = e.dir === 'x';
      const dirSign = tx * (alongX ? 1 : 0) + tz * (alongX ? 0 : 1);
      for (const [a, b] of edgeRuns(e, layout.openings)) {
        const L = Math.abs(b - a);
        if (L < 0.25) continue;
        const startAt = dirSign > 0 ? Math.min(a, b) : Math.max(a, b);
        const px = alongX ? startAt : e.at + e.nx * (WALL_T / 2);
        const pz = alongX ? e.at + e.nz * (WALL_T / 2) : startAt;

        const skirt = new THREE.Mesh(moldingGeometry(skirtProfile, L, true), trimBase);
        skirt.rotation.y = rot;
        skirt.position.set(px, 0, pz);
        skirt.receiveShadow = opts.shadows;
        skirt.name = 'plinthe';
        scene.add(skirt);

        if (room.height > CIMAISE_Y + 0.3) {
          const cim = new THREE.Mesh(
            extrudedPrism(chamferedSection(0.03, 0.05, 0.006), L, { tileV: 3 }),
            trim,
          );
          cim.rotation.y = rot;
          cim.position.set(px, CIMAISE_Y, pz);
          cim.name = 'cimaise';
          scene.add(cim);
        }
      }
    }
  }

  // ---- Mobilier ----
  scene.add(buildFurniture(layout, furnitureMaterials(aniso, texMax), opts.shadows));

  // ---- Végétation ----
  const plants = buildPlants(layout, plantMaterials(aniso), opts.shadows);
  scene.add(plants.group);

  // ---- Ombres de contact : bancs, socles, console, pots ----
  // À 1,6 m de haut, le GTAO ne tient pas un meuble au sol au-delà de 4 m ; ces taches
  // radiales (4 mm au-dessus du parquet) sont ce qui « pose » le mobilier.
  {
    const boxes = [
      ...furnitureColliders(layout).map((c) => ({ x: c.x, z: c.z, hx: c.hx, hz: c.hz, strength: 1 })),
      ...plantColliders(layout).map((c) => ({ x: c.x, z: c.z, hx: c.hx, hz: c.hz, strength: 0.75 })),
    ];
    scene.add(buildContactShadows(boxes, opts.shadows));
  }

  // ---- Le mur du nom ----
  //
  // Face à l'entrée, dans le sas : c'est la première chose qu'on voit en arrivant et la
  // dernière en repartant. Le parcours se termine pile devant lui.
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
    sign.position.set(0, 2.05, SAS_HALF - WALL_T / 2 - 0.004);
    sign.rotation.y = Math.PI;
    sign.name = 'texte-salle';
    scene.add(sign);

  }

  // ---- Cartouche d'entrée : SUPPRIMÉ ----
  //
  // Il y avait ici un texte de 2,1 × 1,05 m au-dessus de la baie nord (nom, sous-titre,
  // liste des salles, « salle d'entrée »). Quatre raisons de le retirer : il répétait le
  // mot-symbole déjà présent en haut à gauche de l'écran ; lu à 12 m, son canvas de
  // 1024 px ne donnait que des lignes grises ; posé en aplat translucide, il flottait
  // devant le mur au lieu d'être peint dessus ; et un cartouche d'exposition se pose à
  // hauteur de regard, pas à 3,44 m. Le mur du nom, face à l'entrée, porte déjà
  // l'identité — une seule fois, à sa taille réelle.

  // ---- Plaque de salle, peinte à côté de chaque baie, côté sas ----
  //
  // Plus d'écriteau sur les poutres (c'est ce qui « faisait moche ») : le nom est sur le
  // mur, à hauteur de regard, là où l'on arrive. Cliquable : il mène à la salle.
  layout.rooms.forEach((room, zi) => {
    if (room.lobby) return;
    const nx = -room.inX;
    const nz = -room.inZ;
    // tangente de la baie, choisie pour poser la plaque du même côté dans toutes les salles
    const tx = -nz;
    const tz = nx;
    const off = DOOR_W / 2 + 1.0;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.62, 0.304),
      new THREE.MeshStandardMaterial({
        map: plaqueTexture(room.name),
        transparent: true,
        roughness: 0.9,
        envMapIntensity: 0.1,
        depthWrite: false,
      }),
    );
    plaque.position.set(
      room.doorX + nx * (WALL_T / 2 + 0.006) + tx * off,
      1.52,
      room.doorZ + nz * (WALL_T / 2 + 0.006) + tz * off,
    );
    plaque.rotation.y = Math.atan2(nx, nz);
    plaque.userData.zoneIndex = zi;
    plaque.name = 'plaque';
    scene.add(plaque);
  });

  return { renderer, scene, camera, sun, spotPool, skyFill, spots, plants };
}
