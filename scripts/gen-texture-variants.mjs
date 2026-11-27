#!/usr/bin/env node
// Génère des variantes réduites des textures WebP (build-time, sharp).
//
// Les textures IA déposées dans public/assets/textures/ai/ peuvent être très
// grandes (4–7 Mo, ex. 4096²) : ingérables en mémoire GPU sur mobile. On écrit
// à côté de chaque source des variantes <name>-2048.webp et <name>-1024.webp
// (seulement si la source est plus grande que la cible). Idem pour les textures
// procédurales de base de public/assets/textures/.
//
// precalcTexture() (src/gallery/textures.ts) essaie d'abord la variante
// correspondant à la résolution cible (mobile/desktop), puis la source pleine
// taille (resizée côté client via createImageBitmap), puis le fallback canvas.
//
// Idempotent. Usage : node scripts/gen-texture-variants.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  path.join(ROOT, 'public', 'assets', 'textures', 'ai'),
  path.join(ROOT, 'public', 'assets', 'textures'),
];
const TARGETS = [2048, 1024];

let made = 0;
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.webp') || f.includes('-1024') || f.includes('-2048')) continue;
    const src = path.join(dir, f);
    const name = f.slice(0, -5);
    const meta = await sharp(src).metadata();
    const side = Math.max(meta.width ?? 0, meta.height ?? 0);
    for (const t of TARGETS) {
      if (side <= t) continue;
      const out = path.join(dir, `${name}-${t}.webp`);
      if (fs.existsSync(out)) continue;
      await sharp(src).resize(t, t, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(out);
      made++;
      console.log(`${path.relative(ROOT, out)}  (${side}px -> ${t}px, ${(fs.statSync(out).size / 1024).toFixed(0)} Ko)`);
    }
  }
}
console.log(made === 0 ? 'Variantes déjà à jour.' : `${made} variante(s) générée(s).`);
