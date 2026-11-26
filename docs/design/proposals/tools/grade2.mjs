// Variantes d'étalonnage + bloom (simulation de post-processing) sur la plaque
// réelle de la scène. AO et TAA ne sont pas simulables depuis une capture :
// la planche ne montre donc que le grade, le bloom et le grain.
// Usage: node .vibe/shotkit/grade2.mjs
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'docs/design/proposals/refs/plate-wall-wide.jpg';
const OUT = 'docs/design/proposals/3d';
fs.mkdirSync(OUT, { recursive: true });

const W = 1440;
const H = 900;

const baseBuf = await sharp(SRC).resize(W, H, { fit: 'cover' }).removeAlpha().raw().toBuffer();
const N = W * H;

const lum = new Float32Array(N);
for (let i = 0; i < N; i++) {
  lum[i] = (0.2126 * baseBuf[i * 3] + 0.7152 * baseBuf[i * 3 + 1] + 0.0722 * baseBuf[i * 3 + 2]) / 255;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** masque de hautes lumières ne gardant que ce qui dépasse `th` */
function highlightMask(th, knee) {
  const g = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const m = smoothstep(th, th + knee, lum[i]) * lum[i];
    const v = Math.round(Math.min(255, m * 255));
    g[i * 3] = g[i * 3 + 1] = g[i * 3 + 2] = v;
  }
  return g;
}

async function blurred(grayBuf, radius) {
  const r = await sharp(grayBuf, { raw: { width: W, height: H, channels: 3 } })
    .blur(radius)
    .raw()
    .toBuffer();
  return r;
}

// halo calculé une seule fois, réutilisé
const bloomMask = await blurred(highlightMask(0.8, 0.18), 34);

let seed = 1337;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function clamp255(x) {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

function render({ name, exposure, contrast, saturation, warm, bloom, vig, grain }) {
  const out = Buffer.alloc(N * 3);
  const cx = W / 2;
  const cy = H * 0.46;
  const maxR = Math.hypot(cx, cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 3;

      // exposition
      let r = baseBuf[o] * exposure;
      let g = baseBuf[o + 1] * exposure;
      let b = baseBuf[o + 2] * exposure;

      // bloom : screen d'une version seuillée et floutée
      if (bloom > 0) {
        const bl = (bloomMask[o] / 255) * bloom;
        r = 255 - (255 - r) * (1 - bl);
        g = 255 - (255 - g) * (1 - bl);
        b = 255 - (255 - b) * (1 - bl);
      }

      // contraste autour du pivot 0.46
      r = (r - 117) * contrast + 117;
      g = (g - 117) * contrast + 117;
      b = (b - 117) * contrast + 117;

      // saturation
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;

      // balance chaude (les blancs de galerie tirent vers le papier)
      if (warm) {
        r *= 1 + warm * 0.012;
        g *= 1 + warm * 0.004;
        b *= 1 - warm * 0.014;
      }

      // vignette
      if (vig > 0) {
        const d = Math.hypot(x - cx, y - cy) / maxR;
        const v = 1 - vig * smoothstep(0.55, 1.05, d);
        r *= v;
        g *= v;
        b *= v;
      }

      // grain (monochrome, proportionnel à la racine de la luminance)
      if (grain > 0) {
        const n = (rnd() - 0.5) * grain * 255 * (0.35 + Math.min(1, l / 255));
        r += n; g += n; b += n;
      }

      out[o] = clamp255(r);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(b);
    }
  }

  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toFile(`${OUT}/${name}.jpg`);
}

await sharp(baseBuf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toFile(`${OUT}/00-head-actuel.jpg`);

// V1 — Pellicule : rendu « photographié », aucune exagération
await render({ name: '01-pellicule', exposure: 1.03, contrast: 1.1, saturation: 1.05, warm: 0.35, bloom: 0.3, vig: 0.16, grain: 0.055 });

// V2 — Chiaroscuro : salle du soir, spot pool assumé, contraste profond
await render({ name: '02-chiaroscuro', exposure: 0.95, contrast: 1.2, saturation: 1.08, warm: 0.9, bloom: 0.52, vig: 0.34, grain: 0.075 });

// V3 — Papier & encre : clair, mat, grain de papier visible
await render({ name: '03-papier-encre', exposure: 1.06, contrast: 1.03, saturation: 0.96, warm: 0.2, bloom: 0.16, vig: 0.1, grain: 0.11 });

// ---- planche de comparaison 2 × 2 -----------------------------------------
const cells = ['00-head-actuel', '01-pellicule', '02-chiaroscuro', '03-papier-encre'];
const labels = ['HEAD — rendu actuel', 'V1 — Pellicule', 'V2 — Chiaroscuro', 'V3 — Papier &amp; encre'];
const cw = 880;
const ch = 550;
const pad = 26;
const lab = 34;
const sheetW = cw * 2 + pad * 3;
const sheetH = (ch + lab) * 2 + pad * 3;

const layer = [];
for (let i = 0; i < 4; i++) {
  const x = pad + (i % 2) * (cw + pad);
  const y = pad + Math.floor(i / 2) * (ch + lab + pad);
  layer.push({ input: await sharp(`${OUT}/${cells[i]}.jpg`).resize(cw, ch, { fit: 'cover' }).toBuffer(), left: x, top: y + lab });
  layer.push({
    input: Buffer.from(`<svg width="${cw}" height="${lab}" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="24" font-family="Georgia, serif" font-size="19" fill="#20242a">${labels[i]}</text></svg>`),
    left: x,
    top: y,
  });
}

await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#faf7f2' } })
  .composite(layer)
  .jpeg({ quality: 90 })
  .toFile(`${OUT}/planche-comparaison.jpg`);

console.log('ok');
