#!/usr/bin/env node
// Génération BUILD-TIME des textures procédurales de la galerie 3D.
//
// Reproduit fidèlement les générateurs canvas 2D de src/gallery/scene.ts
// (plaster 2048², floor 4096² + floor-rough 1024², ceiling 2048², runner 1024²)
// et écrit des fichiers statiques WebP (q90) dans public/assets/textures/.
//
// Méthode :
//   1. WebGPU en Node via le package "webgpu" (Dawn) : compute shaders WGSL,
//      exécutés dans un petit processus enfant (le binding natif Dawn win32-x64
//      peut SIGSEGV de façon reproductible dans un gros processus Node).
//   2. Fallback build-time CPU si Dawn est indisponible : même logique calculée
//      en JS pur (pixel par pixel dans un Buffer), encodée via sharp.
//
// La méthode effectivement utilisée est loguée. Idempotent : graines
// déterministes → octets identiques d'un run à l'autre. < 30 s.
// Usage : node scripts/gen-textures.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'textures');

const SPECS = [
  { name: 'plaster', size: 2048 },
  { name: 'floor', size: 4096 },
  { name: 'floor-rough', size: 1024 },
  { name: 'ceiling', size: 2048 },
  { name: 'runner', size: 1024 },
];

/* ============================ Shaders WGSL (Dawn) ============================ */
const WGSL_COMMON = /* wgsl */`
fn hash1(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return f32((x ^ (x >> 22u)) & 0xFFFFFFu) / 16777216.0;
}
fn h2(a: u32, b: u32) -> f32 {
  return hash1((a * 0x9E3779B1u) ^ (b + 0x85EBCA6Bu) ^ 0xC2B2AE35u);
}
fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = h / 60.0;
  let x = c * (1.0 - abs(hp - floor(hp / 2.0) * 2.0 - 1.0));
  var rgb = vec3f(0.0);
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + (l - c * 0.5);
}
fn pack(c: vec3f) -> u32 {
  let r = u32(clamp(c.r, 0.0, 1.0) * 255.0 + 0.5);
  let g = u32(clamp(c.g, 0.0, 1.0) * 255.0 + 0.5);
  let b = u32(clamp(c.b, 0.0, 1.0) * 255.0 + 0.5);
  return r | (g << 8u) | (b << 16u) | 0xFF000000u;
}
fn unpack(v: u32) -> vec3f {
  return vec3f(f32(v & 255u), f32((v >> 8u) & 255u), f32((v >> 16u) & 255u)) / 255.0;
}
fn segDist(px: f32, py: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
  let vx = x2 - x1; let vy = y2 - y1;
  let wx = px - x1; let wy = py - y1;
  let t = clamp((wx * vx + wy * vy) / max(vx * vx + vy * vy, 1e-6), 0.0, 1.0);
  let dx = wx - vx * t; let dy = wy - vy * t;
  return sqrt(dx * dx + dy * dy);
}
`;

// Scatter de "speckles" (fillRect aléatoires) : un thread par speckle, atomicMax
// sur deux tampons fixed-point (assombrissement / éclaircissement).
function wgslSpeckleScatter({ count, size, sizeMax, alphaMax, seed }) {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> dark: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> light: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= ${count}u) { return; }
  let s = ${size}.0; let S = ${size}u;
  let x = h2(idx, ${seed}u + 1u) * s;
  let y = h2(idx, ${seed}u + 2u) * s;
  let r = 1.0 + h2(idx, ${seed}u + 3u) * ${sizeMax.toFixed(1)};
  let a = h2(idx, ${seed}u + 4u) * ${alphaMax};
  let isLight = h2(idx, ${seed}u + 5u) > 0.5;
  let val = u32(a * 65535.0);
  let x0 = u32(clamp(floor(x), 0.0, s - 1.0));
  let y0 = u32(clamp(floor(y), 0.0, s - 1.0));
  let x1 = u32(clamp(ceil(x + r) - 1.0, 0.0, s - 1.0));
  let y1 = u32(clamp(ceil(y + r) - 1.0, 0.0, s - 1.0));
  for (var yy = y0; yy <= y1; yy++) {
    for (var xx = x0; xx <= x1; xx++) {
      if (isLight) { atomicMax(&light[yy * S + xx], val); }
      else { atomicMax(&dark[yy * S + xx], val); }
    }
  }
}
`;
}

// Plâtre / plafond : combine = base + speckles + marbrures radiales (22 / 10).
function wgslPlasterLike({ size, base, darkC, lightC, marbCount, marbC, marbRMin, marbRVar, marbAMin, marbAVar, seed }) {
  const baseV = `vec3f(${base.join(',')}) / 255.0`;
  const darkV = `vec3f(${darkC.join(',')}) / 255.0`;
  const lightV = `vec3f(${lightC.join(',')}) / 255.0`;
  const marbV = `vec3f(${marbC.join(',')}) / 255.0`;
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@group(0) @binding(1) var<storage, read_write> dark: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> light: array<atomic<u32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = ${size}.0; let S = ${size}u;
  if (id.x >= S || id.y >= S) { return; }
  let n = id.x + id.y * S;
  var col = ${baseV};
  let d = f32(atomicLoad(&dark[n])) / 65535.0;
  let l = f32(atomicLoad(&light[n])) / 65535.0;
  col = mix(col, ${darkV}, d);
  col = mix(col, ${lightV}, l);
  let px = f32(id.x); let py = f32(id.y);
  for (var i = 0u; i < ${marbCount}u; i++) {
    let b = i * 7919u + ${seed}u;
    let x = h2(b + 1u, 11u) * s;
    let y = h2(b + 2u, 11u) * s;
    let r = s * (${marbRMin} + h2(b + 3u, 11u) * ${marbRVar});
    let a = ${marbAMin} + h2(b + 4u, 11u) * ${marbAVar};
    let dd = distance(vec2f(px, py), vec2f(x, y));
    if (dd < r) {
      col = mix(col, ${marbV}, a * (1.0 - dd / r));
    }
  }
  out[n] = pack(col);
}
`;
}

// Parquet, passe 1 : teinte par lame (hsl), dégradé linéaire, joints horizontaux et de bout.
function wgslFloorBase({ size, rows }) {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = ${size}.0; let S = ${size}u;
  if (id.x >= S || id.y >= S) { return; }
  let n = id.x + id.y * S;
  let plankH = s / ${rows}.0;
  let row = min(f32(${rows}u - 1u), floor(f32(id.y) / plankH));
  let ri = u32(row);
  let luma = 0.52 + h2(ri, 11u) * 0.2;
  let hue = 24.0 + h2(ri, 12u) * 9.0;
  let sat = (34.0 + h2(ri, 13u) * 12.0) / 100.0;
  var col = hsl2rgb(hue, sat, luma);
  let t = (f32(id.y) - row * plankH) / plankH;
  let gc = mix(vec3f(255.0, 244.0, 224.0), vec3f(70.0, 46.0, 22.0), t) / 255.0;
  col = col * 0.90 + gc * 0.10;
  let lw = max(2.0, s / 1024.0);
  let jointC = vec3f(58.0, 38.0, 18.0) / 255.0;
  let k = clamp(round(f32(id.y) / plankH), 0.0, f32(${rows}u - 1u));
  if (abs(f32(id.y) - k * plankH) < lw * 0.5) { col = mix(col, jointC, 0.55); }
  let off = (f32(ri % 2u) * s) / 3.0 + h2(ri, 21u) * s * 0.2;
  if (abs(f32(id.x) - off) < lw * 0.5) { col = mix(col, jointC, 0.5); }
  out[n] = pack(col);
}
`;
}

// Parquet, passe 2 (scatter) : veines = courbes de Bézier estampillées (atomicMax).
function wgslFloorVeins({ size, rows, veinsPerRow }) {
  const total = rows * veinsPerRow;
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> dark: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= ${total}u) { return; }
  let s = ${size}.0; let S = ${size}u;
  let plankH = s / ${rows}.0;
  let row = f32(idx / ${veinsPerRow}u);
  let gx = h2(idx, 31u) * s;
  let gy = row * plankH + h2(idx, 32u) * plankH;
  let w = 1.0 + h2(idx, 33u) * (s / 1400.0);
  let a = h2(idx, 34u) * 0.2;
  let p0 = vec2f(gx, gy);
  let p1 = vec2f(gx + s * 0.05, gy + 3.0);
  let p2 = vec2f(gx + s * 0.16, gy - 3.0);
  let p3 = vec2f(gx + s * 0.3, gy + 4.0);
  let rad = w * 0.5;
  for (var k = 0u; k < 512u; k++) {
    let t = f32(k) / 511.0;
    let it = 1.0 - t;
    let p = it * it * it * p0 + 3.0 * it * it * t * p1 + 3.0 * it * t * t * p2 + t * t * t * p3;
    let x0 = u32(clamp(floor(p.x - rad), 0.0, s - 1.0));
    let y0 = u32(clamp(floor(p.y - rad), 0.0, s - 1.0));
    let x1 = u32(clamp(ceil(p.x + rad) - 1.0, 0.0, s - 1.0));
    let y1 = u32(clamp(ceil(p.y + rad) - 1.0, 0.0, s - 1.0));
    for (var yy = y0; yy <= y1; yy++) {
      for (var xx = x0; xx <= x1; xx++) {
        let d = distance(vec2f(f32(xx) + 0.5, f32(yy) + 0.5), p);
        if (d <= rad) {
          atomicMax(&dark[yy * S + xx], u32(a * (1.0 - d / rad) * 65535.0));
        }
      }
    }
  }
}
`;
}

// Parquet, passe 3 : combine veines + nœuds (dégradés radiaux par lame).
function wgslFloorCombine({ size, rows }) {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@group(0) @binding(1) var<storage, read_write> dark: array<atomic<u32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = ${size}.0; let S = ${size}u;
  if (id.x >= S || id.y >= S) { return; }
  let n = id.x + id.y * S;
  let veinC = hsl2rgb(28.0, 0.32, 0.26);
  var col = mix(unpack(out[n]), veinC, f32(atomicLoad(&dark[n])) / 65535.0);
  let px = f32(id.x); let py = f32(id.y);
  let plankH = s / ${rows}.0;
  for (var k = 0u; k < ${rows}u; k++) {
    if (h2(k * 31u + 5u, 41u) < 0.3) {
      let nx = h2(k * 31u + 1u, 42u) * s;
      let ny = f32(k) * plankH + plankH * (0.3 + h2(k * 31u + 2u, 43u) * 0.4);
      let nr = s * (0.008 + h2(k * 31u + 3u, 44u) * 0.012);
      let d = distance(vec2f(px, py), vec2f(nx, ny));
      if (d < nr) {
        col = mix(col, vec3f(70.0, 46.0, 22.0) / 255.0, 0.5 * (1.0 - d / nr));
      }
    }
  }
  out[n] = pack(col);
}
`;
}

// Roughness map, passe 1 : base grise + joints (lw 3, alpha 0.8).
function wgslRoughBase({ size, rows }) {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = ${size}.0; let S = ${size}u;
  if (id.x >= S || id.y >= S) { return; }
  let n = id.x + id.y * S;
  let plankH = s / ${rows}.0;
  var col = vec3f(184.0, 184.0, 184.0) / 255.0;
  let jointC = vec3f(70.0, 70.0, 70.0) / 255.0;
  let row = min(f32(${rows}u - 1u), floor(f32(id.y) / plankH));
  let ri = u32(row);
  let k = clamp(round(f32(id.y) / plankH), 0.0, f32(${rows}u - 1u));
  if (abs(f32(id.y) - k * plankH) < 1.5) { col = mix(col, jointC, 0.8); }
  let off = (f32(ri % 2u) * s) / 3.0 + h2(ri, 21u) * s * 0.2;
  if (abs(f32(id.x) - off) < 1.5) { col = mix(col, jointC, 0.8); }
  out[n] = pack(col);
}
`;
}

// Roughness, passe 2 (scatter) : micro-rayures = segments inclinés.
function wgslRoughStreaks({ size, rows, streaksPerRow }) {
  const total = rows * streaksPerRow;
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> dark: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= ${total}u) { return; }
  let s = ${size}.0; let S = ${size}u;
  let plankH = s / ${rows}.0;
  let row = f32(idx / ${streaksPerRow}u);
  let gx = h2(idx, 51u) * s;
  let gy = row * plankH + h2(idx, 52u) * plankH;
  let w = 1.0 + h2(idx, 53u) * 2.0;
  let a = h2(idx, 54u) * 0.5;
  let p0 = vec2f(gx, gy);
  let p1 = vec2f(gx + s * 0.25, gy + 4.0);
  let rad = w * 0.5;
  for (var k = 0u; k < 256u; k++) {
    let t = f32(k) / 255.0;
    let p = mix(p0, p1, t);
    let x0 = u32(clamp(floor(p.x - rad), 0.0, s - 1.0));
    let y0 = u32(clamp(floor(p.y - rad), 0.0, s - 1.0));
    let x1 = u32(clamp(ceil(p.x + rad) - 1.0, 0.0, s - 1.0));
    let y1 = u32(clamp(ceil(p.y + rad) - 1.0, 0.0, s - 1.0));
    for (var yy = y0; yy <= y1; yy++) {
      for (var xx = x0; xx <= x1; xx++) {
        let d = distance(vec2f(f32(xx) + 0.5, f32(yy) + 0.5), p);
        if (d <= rad) {
          atomicMax(&dark[yy * S + xx], u32(a * (1.0 - d / rad) * 65535.0));
        }
      }
    }
  }
}
`;
}

// Roughness, passe 3 : combine vers la teinte des rayures (90,90,90).
function wgslRoughCombine({ size }) {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@group(0) @binding(1) var<storage, read_write> dark: array<atomic<u32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let S = ${size}u;
  if (id.x >= S || id.y >= S) { return; }
  let n = id.x + id.y * S;
  let col = mix(unpack(out[n]), vec3f(90.0, 90.0, 90.0) / 255.0, f32(atomicLoad(&dark[n])) / 65535.0);
  out[n] = pack(col);
}
`;
}

// Tapis : trame croisée 8px + liserés (strokeRect) — tout est analytique, une passe.
function wgslRunner({ size }) {
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = ${size}.0; let S = ${size}u;
  if (id.x >= S || id.y >= S) { return; }
  let n = id.x + id.y * S;
  let px = f32(id.x); let py = f32(id.y);
  var col = vec3f(205.0, 194.0, 173.0) / 255.0; // #cdc2ad
  let cx = id.x / 8u; let cy = id.y / 8u;
  if (id.x % 8u < 7u && id.y % 8u < 7u) {
    let checker = (cx + cy) % 16u == 0u;
    let v = 190.0 + select(h2(n, 51u) * 16.0, 22.0, checker);
    col = vec3f(v, v - 8.0, v - 26.0) / 255.0;
  }
  // liseré périphérique : strokeRect(13,13,s-26,s-26), lineWidth 26, #a89a7e
  let o = s - 13.0;
  let dOuter = min(
    min(segDist(px, py, 13.0, 13.0, 13.0, o), segDist(px, py, 13.0, o, o, o)),
    min(segDist(px, py, o, o, o, 13.0), segDist(px, py, o, 13.0, 13.0, 13.0)));
  if (dOuter <= 13.0) { col = vec3f(168.0, 154.0, 126.0) / 255.0; }
  // liseré intérieur : strokeRect(48,48,s-96,s-96), lineWidth 4, rgba(120,108,84,0.8)
  let i2 = 48.0; let i2e = s - 48.0;
  let dInner = min(
    min(segDist(px, py, i2, i2, i2, i2e), segDist(px, py, i2, i2e, i2e, i2e)),
    min(segDist(px, py, i2e, i2e, i2e, i2), segDist(px, py, i2e, i2, i2, i2)));
  if (dInner <= 2.0) { col = mix(col, vec3f(120.0, 108.0, 84.0) / 255.0, 0.8); }
  out[n] = pack(col);
}
`;
}

/* =====================================================================================
   Orchestration GPU : chaque texture est rendue par un PETIT processus enfant
   (node --input-type=module -e WORKER_SRC <manifeste.json>). Le parent n'importe
   jamais Dawn, ce qui isole le bug de SIGSEGV du binding natif win32-x64.
   Si l'enfant plante (signal) ou si Dawn est indisponible → fallback CPU.
   ===================================================================================== */

// Passes WGSL d'une texture : { label, code, bindings: ['out'|'dark'|'light', ...], wx, wy }
function buildPasses(spec) {
  const S = spec.size;
  const wg = Math.ceil(S / 8);
  switch (spec.name) {
    case 'plaster':
      return [
        { label: 'scatter', code: wgslSpeckleScatter({ count: 26000, size: S, sizeMax: 1.6, alphaMax: 0.05, seed: 1000 }), bindings: ['dark', 'light'], wx: Math.ceil(26000 / 64), wy: 1 },
        { label: 'combine', code: wgslPlasterLike({ size: S, base: [242, 237, 228], darkC: [208, 202, 190], lightC: [255, 249, 237], marbCount: 22, marbC: [206, 196, 176], marbRMin: 0.08, marbRVar: 0.2, marbAMin: 0.05, marbAVar: 0.06, seed: 77 }), bindings: ['out', 'dark', 'light'], wx: wg, wy: wg },
      ];
    case 'ceiling':
      return [
        { label: 'scatter', code: wgslSpeckleScatter({ count: 9000, size: S, sizeMax: 1.5, alphaMax: 0.045, seed: 2000 }), bindings: ['dark', 'light'], wx: Math.ceil(9000 / 64), wy: 1 },
        { label: 'combine', code: wgslPlasterLike({ size: S, base: [250, 248, 243], darkC: [214, 210, 200], lightC: [255, 251, 241], marbCount: 10, marbC: [216, 210, 196], marbRMin: 0.1, marbRVar: 0.18, marbAMin: 0.04, marbAVar: 0.05, seed: 88 }), bindings: ['out', 'dark', 'light'], wx: wg, wy: wg },
      ];
    case 'floor':
      return [
        { label: 'base', code: wgslFloorBase({ size: S, rows: 18 }), bindings: ['out'], wx: wg, wy: wg },
        { label: 'veins', code: wgslFloorVeins({ size: S, rows: 18, veinsPerRow: 110 }), bindings: ['dark'], wx: Math.ceil(18 * 110 / 64), wy: 1 },
        { label: 'combine', code: wgslFloorCombine({ size: S, rows: 18 }), bindings: ['out', 'dark'], wx: wg, wy: wg },
      ];
    case 'floor-rough':
      return [
        { label: 'base', code: wgslRoughBase({ size: S, rows: 18 }), bindings: ['out'], wx: wg, wy: wg },
        { label: 'streaks', code: wgslRoughStreaks({ size: S, rows: 18, streaksPerRow: 90 }), bindings: ['dark'], wx: Math.ceil(18 * 90 / 64), wy: 1 },
        { label: 'combine', code: wgslRoughCombine({ size: S }), bindings: ['out', 'dark'], wx: wg, wy: wg },
      ];
    case 'runner':
      return [{ label: 'all', code: wgslRunner({ size: S }), bindings: ['out'], wx: wg, wy: wg }];
    default:
      throw new Error(`texture inconnue: ${spec.name}`);
  }
}

// Source du processus enfant : rendu WebGPU autonome d'une texture.
// Manifeste JSON (argv[2]) : { size, out, passes: [{ wgsl, bindings, wx, wy }] }.
// Les shaders sont lus depuis des fichiers .wgsl écrits par le parent.
const WORKER_SRC = `import fs from 'node:fs';
const m = await import('webgpu');
Object.assign(globalThis, m.globals);
const man = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const gpu = m.create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) { console.error('no adapter'); process.exit(3); }
const device = await adapter.requestDevice();
device.addEventListener?.('uncapturederror', (e) => { console.error('uncaptured:', e.error?.message ?? e); });
const S = man.size, n = S * S, bytes = n * 4;
const ST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
const bufs = {};
for (const name of ['out', 'dark', 'light']) bufs[name] = device.createBuffer({ size: bytes, usage: ST });
device.queue.writeBuffer(bufs.dark, 0, new Uint32Array(n));
device.queue.writeBuffer(bufs.light, 0, new Uint32Array(n));
for (const p of man.passes) {
  const code = fs.readFileSync(p.wgsl, 'utf8');
  const module = device.createShaderModule({ code });
  device.pushErrorScope('validation');
  const pipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const err = await device.popErrorScope();
  if (err) { console.error('pipeline error:', err.message); process.exit(4); }
  const entries = p.bindings.map((b, i) => ({ binding: i, resource: { buffer: bufs[b] } }));
  const bindGroup = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(p.wx, p.wy, 1);
  pass.end();
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
}
const dst = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
const enc = device.createCommandEncoder();
enc.copyBufferToBuffer(bufs.out, 0, dst, 0, bytes);
device.queue.submit([enc.finish()]);
await dst.mapAsync(GPUMapMode.READ);
fs.writeFileSync(man.out, Buffer.from(dst.getMappedRange().slice(0, bytes)));
process.exit(0);
`;

function runGpuWorker(spec, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const passes = buildPasses(spec).map((p) => {
    const wgslPath = path.join(workDir, `${spec.name}-${p.label}.wgsl`);
    fs.writeFileSync(wgslPath, WGSL_COMMON + p.code);
    return { wgsl: wgslPath, bindings: p.bindings, wx: p.wx, wy: p.wy };
  });
  const rawPath = path.join(workDir, `${spec.name}.raw`);
  const manifestPath = path.join(workDir, `${spec.name}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({ size: spec.size, out: rawPath, passes }));
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', WORKER_SRC, manifestPath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0 || !fs.existsSync(rawPath)) {
    const why = res.signal ? `signal ${res.signal}` : `exit ${res.status}: ${String(res.stderr || '').slice(0, 300)}`;
    throw new Error(`worker GPU en échec (${why})`);
  }
  const buf = fs.readFileSync(rawPath);
  return new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

function renderSpec(spec, workDir, allowGpu) {
  if (allowGpu) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return { pixels: runGpuWorker(spec, workDir), method: 'dawn-webgpu' };
      } catch (e) {
        console.error(`[gen-textures] ${spec.name}: tentative GPU ${attempt}/2 échouée (${e.message})`);
      }
    }
    console.error(`[gen-textures] ${spec.name}: fallback CPU.`);
  }
  return { pixels: cpuRender(spec), method: 'cpu-js' };
}

/* ============================ Fallback CPU (JS pur) ============================ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r, g, b;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Tampon RGBA 8 bits + composition source-over (équivalent fillRect canvas).
class Pix {
  constructor(s) {
    this.s = s;
    this.buf = new Uint8ClampedArray(s * s * 4);
  }
  fill(r, g, b) {
    const b4 = this.buf;
    for (let i = 0; i < b4.length; i += 4) { b4[i] = r; b4[i + 1] = g; b4[i + 2] = b; b4[i + 3] = 255; }
  }
  over(x0, y0, x1, y1, r, g, b, a) {
    const s = this.s, buf = this.buf;
    const xa = Math.max(0, Math.floor(x0)), ya = Math.max(0, Math.floor(y0));
    const xb = Math.min(s - 1, Math.ceil(x1)), yb = Math.min(s - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const i = (y * s + x) * 4;
        buf[i] = buf[i] * (1 - a) + r * a;
        buf[i + 1] = buf[i + 1] * (1 - a) + g * a;
        buf[i + 2] = buf[i + 2] * (1 - a) + b * a;
      }
    }
  }
  radial(cx, cy, rad, r, g, b, a) {
    const s = this.s, buf = this.buf;
    const xa = Math.max(0, Math.floor(cx - rad)), ya = Math.max(0, Math.floor(cy - rad));
    const xb = Math.min(s - 1, Math.ceil(cx + rad)), yb = Math.min(s - 1, Math.ceil(cy + rad));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < rad) {
          const i = (y * s + x) * 4, aa = a * (1 - d / rad);
          buf[i] = buf[i] * (1 - aa) + r * aa;
          buf[i + 1] = buf[i + 1] * (1 - aa) + g * aa;
          buf[i + 2] = buf[i + 2] * (1 - aa) + b * aa;
        }
      }
    }
  }
  stamp(px, py, rad, r, g, b, a) {
    this.over(px - rad, py - rad, px + rad, py + rad, r, g, b, a);
  }
  toPacked() {
    const out = new Uint32Array(this.s * this.s);
    const buf = this.buf;
    for (let i = 0, j = 0; i < buf.length; i += 4, j++) {
      out[j] = buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | 0xFF000000;
    }
    return out;
  }
}

function cpuPlasterLike(size, { base, speckles, sizeMax, alphaMax, seed, marbCount, marbC, marbRMin, marbRVar, marbAMin, marbAVar }) {
  const p = new Pix(size);
  p.fill(...base);
  const rnd = mulberry32(seed);
  for (let i = 0; i < speckles; i++) {
    const v = rnd() > 0.5 ? 255 : (base[0] < 250 ? 208 : 214);
    const a = rnd() * alphaMax;
    const r = 1 + rnd() * sizeMax;
    p.over(rnd() * size, rnd() * size, rnd() * size + r, rnd() * size + r, v, v - (base[0] < 250 ? 6 : 4), v - (base[0] < 250 ? 18 : 14), a);
  }
  for (let i = 0; i < marbCount; i++) {
    const r = size * (marbRMin + rnd() * marbRVar);
    p.radial(rnd() * size, rnd() * size, r, ...marbC, marbAMin + rnd() * marbAVar);
  }
  return p.toPacked();
}

function cpuFloor(size) {
  const p = new Pix(size);
  const rows = 18;
  const plankH = size / rows;
  const rnd = mulberry32(4242);
  const veinC = hslToRgb(28, 0.32, 0.26);
  const lw = Math.max(2, size / 1024);
  for (let y = 0; y < rows; y++) {
    const luma = 0.52 + rnd() * 0.2;
    const hue = 24 + rnd() * 9;
    const sat = (34 + rnd() * 12) / 100;
    const base = hslToRgb(hue, sat, luma);
    for (let py = Math.floor(y * plankH); py < Math.min(size, Math.ceil((y + 1) * plankH)); py++) {
      const t = (py - y * plankH) / plankH;
      const gc = [255 + (70 - 255) * t, 244 + (46 - 244) * t, 224 + (22 - 224) * t];
      for (let px = 0; px < size; px++) {
        const i = (py * size + px) * 4;
        p.buf[i] = base[0] * 0.9 + gc[0] * 0.1;
        p.buf[i + 1] = base[1] * 0.9 + gc[1] * 0.1;
        p.buf[i + 2] = base[2] * 0.9 + gc[2] * 0.1;
        p.buf[i + 3] = 255;
      }
    }
  }
  for (let k = 0; k < rows; k++) p.over(0, k * plankH - lw / 2, size, k * plankH + lw / 2, 58, 38, 18, 0.55);
  for (let y = 0; y < rows; y++) {
    const off = ((y % 2) * size) / 3 + rnd() * size * 0.2;
    p.over(off - lw / 2, y * plankH, off + lw / 2, (y + 1) * plankH, 58, 38, 18, 0.5);
    for (let i = 0; i < 110; i++) {
      const gx = rnd() * size;
      const gy = y * plankH + rnd() * plankH;
      const w = 1 + rnd() * (size / 1400);
      const a = rnd() * 0.2;
      const p0 = [gx, gy], p1 = [gx + size * 0.05, gy + 3], p2 = [gx + size * 0.16, gy - 3], p3 = [gx + size * 0.3, gy + 4];
      for (let k2 = 0; k2 <= 160; k2++) {
        const t = k2 / 160, it = 1 - t;
        const bx = it ** 3 * p0[0] + 3 * it * it * t * p1[0] + 3 * it * t * t * p2[0] + t ** 3 * p3[0];
        const by = it ** 3 * p0[1] + 3 * it * it * t * p1[1] + 3 * it * t * t * p2[1] + t ** 3 * p3[1];
        p.stamp(bx, by, w / 2, ...veinC, a);
      }
    }
    if (rnd() < 0.3) {
      const nr = size * (0.008 + rnd() * 0.012);
      p.radial(rnd() * size, y * plankH + plankH * (0.3 + rnd() * 0.4), nr, 70, 46, 22, 0.5);
    }
  }
  return p.toPacked();
}

function cpuFloorRough(size) {
  const p = new Pix(size);
  p.fill(184, 184, 184);
  const rows = 18;
  const plankH = size / rows;
  const rnd = mulberry32(5150);
  for (let k = 0; k < rows; k++) p.over(0, k * plankH - 1.5, size, k * plankH + 1.5, 70, 70, 70, 0.8);
  for (let y = 0; y < rows; y++) {
    const off = ((y % 2) * size) / 3 + rnd() * size * 0.2;
    p.over(off - 1.5, y * plankH, off + 1.5, (y + 1) * plankH, 70, 70, 70, 0.8);
    for (let i = 0; i < 90; i++) {
      const gx = rnd() * size;
      const gy = y * plankH + rnd() * plankH;
      const w = 1 + rnd() * 2;
      const a = rnd() * 0.5;
      for (let k2 = 0; k2 <= 64; k2++) {
        const t = k2 / 64;
        p.stamp(gx + size * 0.25 * t, gy + 4 * t, w / 2, 90, 90, 90, a);
      }
    }
  }
  return p.toPacked();
}

function cpuRunner(size) {
  const p = new Pix(size);
  p.fill(205, 194, 173); // #cdc2ad
  const rnd = mulberry32(6060);
  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const v = 190 + ((x + y) % 16 === 0 ? 22 : rnd() * 16);
      p.over(x, y, x + step - 1, y + step - 1, v | 0, (v - 8) | 0, (v - 26) | 0, 1);
    }
  }
  // liserés : bandes centrées sur le tracé du strokeRect
  const paintBorder = (x0, y0, w, h, lw, r, g, b, a) => {
    const x1 = x0 + w, y1 = y0 + h, hw = lw / 2;
    p.over(x0 - hw, y0 - hw, x1 + hw, y0 - hw + lw, r, g, b, a); // haut
    p.over(x0 - hw, y1 - hw, x1 + hw, y1 + hw, r, g, b, a);       // bas
    p.over(x0 - hw, y0, x0 + hw, y1, r, g, b, a);                   // gauche
    p.over(x1 - hw, y0, x1 + hw, y1, r, g, b, a);                   // droite
  };
  paintBorder(13, 13, size - 26, size - 26, 26, 168, 154, 126, 1);
  paintBorder(48, 48, size - 96, size - 96, 4, 120, 108, 84, 0.8);
  return p.toPacked();
}

function cpuRender(spec) {
  switch (spec.name) {
    case 'plaster':
      return cpuPlasterLike(spec.size, { base: [242, 237, 228], speckles: 26000, sizeMax: 1.6, alphaMax: 0.05, seed: 1234, marbCount: 22, marbC: [206, 196, 176], marbRMin: 0.08, marbRVar: 0.2, marbAMin: 0.05, marbAVar: 0.06 });
    case 'ceiling':
      return cpuPlasterLike(spec.size, { base: [250, 248, 243], speckles: 9000, sizeMax: 1.5, alphaMax: 0.045, seed: 9876, marbCount: 10, marbC: [216, 210, 196], marbRMin: 0.1, marbRVar: 0.18, marbAMin: 0.04, marbAVar: 0.05 });
    case 'floor':
      return cpuFloor(spec.size);
    case 'floor-rough':
      return cpuFloorRough(spec.size);
    case 'runner':
      return cpuRunner(spec.size);
    default:
      throw new Error(`texture inconnue: ${spec.name}`);
  }
}


/* ============================ Encodage + main ============================ */

async function encodeWebp(pixels, size, file) {
  const raw = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const buf = await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 90 })
    .toBuffer();
  fs.writeFileSync(file, buf);
  return buf.length;
}

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Sonde : Dawn fonctionne dans un enfant ? (le parent n'importe pas webgpu)
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-tex-wgpu-'));
  let allowGpu = true;
  try {
    runGpuWorker({ name: 'runner', size: 64 }, path.join(workDir, 'probe'));
  } catch {
    allowGpu = false;
  }
  console.log(`[gen-textures] méthode : ${allowGpu ? 'Dawn/WebGPU — compute shaders WGSL (package "webgpu", processus enfant)' : 'CPU build-time — JS pur pixel par pixel + sharp'}`);

  const summary = [];
  for (const spec of SPECS) {
    const t = Date.now();
    const { pixels, method } = renderSpec(spec, path.join(workDir, spec.name), allowGpu);
    const file = path.join(OUT_DIR, `${spec.name}.webp`);
    const bytes = await encodeWebp(pixels, spec.size, file);
    const ms = Date.now() - t;
    console.log(`[gen-textures] ${spec.name}.webp  ${spec.size}x${spec.size}  ${(bytes / 1024).toFixed(0)} Ko  ${ms} ms  [${method}]`);
    summary.push({ name: spec.name, size: spec.size, bytes, ms, method });
  }
  fs.rmSync(workDir, { recursive: true, force: true });
  const totalMs = Date.now() - t0;
  console.log(`[gen-textures] total ${totalMs} ms`);
  console.log(JSON.stringify({ method: allowGpu ? 'dawn-webgpu' : 'cpu-js', totalMs, files: summary }, null, 2));
}

main().catch((e) => {
  console.error('[gen-textures] ÉCHEC:', e);
  process.exit(1);
});
