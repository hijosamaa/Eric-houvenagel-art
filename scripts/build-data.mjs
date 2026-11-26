import { readdir, readFile, mkdir, rm, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const REFS = path.join(ROOT, 'references');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_IMG = path.join(OUT_DIR, 'images');
const OUT_JSON = path.join(OUT_DIR, 'works.json');

// Itération D — pipeline images : WebP/AVIF multi-tailles + LQIP, JPEG full/-800 conservés (fallback).
const TARGET_WIDTHS = [480, 800, 1200, 2000]; // sans upscale : clampées à la largeur source
const WEBP_Q = 80;
const AVIF_Q = 70;
const AVIF_EFFORT = 3; // compromis vitesse/poids pour le build
const LQIP_SIZE = 16;

const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const listJson = async (dir) => (await readdir(dir)).filter((f) => f.endsWith('.json'));

const dirSize = async (dir) => {
  try {
    let total = 0;
    for (const f of await readdir(dir)) {
      const s = await stat(path.join(dir, f));
      if (s.isFile()) total += s.size;
    }
    return total;
  } catch {
    return 0;
  }
};

const fmtKo = (b) => `${(b / 1024).toFixed(1)} Ko`;

// Poids "avant" : état actuel de public/data (peut être absent au premier build)
const beforeImg = await dirSize(OUT_IMG);
let beforeJson = 0;
try {
  beforeJson = (await stat(OUT_JSON)).size;
} catch {}

const site = await readJson(path.join(DATA, 'site.json'));

const rooms = [];
for (const f of await listJson(path.join(DATA, 'rooms'))) {
  const r = await readJson(path.join(DATA, 'rooms', f));
  rooms.push({ id: f.replace(/\.json$/, ''), name: r.name ?? f, order: r.order ?? 0 });
}
rooms.sort((a, b) => a.order - b.order);

// On ne supprime PAS le dossier en entrée : on génère par-dessus, on nettoie les orphelins
// en fin de run et on écrit works.json atomiquement (tmp + rename) pour que public/data/
// reste lisible/fonctionnel à chaque instant par les autres agents qui buildent en parallèle.
await mkdir(OUT_IMG, { recursive: true });

const roomIndexOf = (id) => {
  const i = rooms.findIndex((r) => r.id === id);
  return i === -1 ? rooms.length : i;
};

const rel = (f) => `data/images/${f}`;

const works = [];
const generatedFiles = new Set(); // noms de fichiers produits par ce run (pour le nettoyage)

for (const f of await listJson(path.join(DATA, 'works'))) {
  const w = await readJson(path.join(DATA, 'works', f));
  const id = f.replace(/\.json$/, '');
  const base = path.basename(String(w.image || ''));
  const stem = base.replace(/\.[^.]+$/, '');
  let ratio = 1;
  let images = [];
  let lqip = '';
  if (base) {
    const src = path.join(REFS, base);
    try {
      const meta = await sharp(src).metadata();
      const srcW = meta.width || 1080;
      ratio = meta.width / meta.height;

      const jobs = [];
      // 1) JPEG full (fallback) — comportement existant conservé
      const full = meta.width > 2000 ? sharp(src).resize({ width: 2000, withoutEnlargement: true }) : sharp(src);
      const ext = (base.split('.').pop() || 'jpg').toLowerCase();
      if (ext === 'png') jobs.push(full.png({ compressionLevel: 9 }).toFile(path.join(OUT_IMG, base)));
      else if (ext === 'webp') jobs.push(full.webp({ quality: 85 }).toFile(path.join(OUT_IMG, base)));
      else jobs.push(full.jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(OUT_IMG, base)));
      generatedFiles.add(base);

      // 2) -800.jpg existant (fallback src des <img>)
      jobs.push(
        sharp(src)
          .resize({ width: 800, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(path.join(OUT_IMG, `${stem}-800.jpg`)),
      );
      generatedFiles.add(`${stem}-800.jpg`);

      // 3) WebP q80 + AVIF q70 à chaque largeur cible (clampée à la source, dédupliquée)
      const widths = [...new Set(TARGET_WIDTHS.map((t) => Math.min(t, srcW)))].sort((a, b) => a - b);
      for (const width of widths) {
        const webpName = `${stem}-${width}.webp`;
        const avifName = `${stem}-${width}.avif`;
        jobs.push(
          sharp(src)
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: WEBP_Q })
            .toFile(path.join(OUT_IMG, webpName)),
        );
        jobs.push(
          sharp(src)
            .resize({ width, withoutEnlargement: true })
            .avif({ quality: AVIF_Q, effort: AVIF_EFFORT })
            .toFile(path.join(OUT_IMG, avifName)),
        );
        generatedFiles.add(webpName);
        generatedFiles.add(avifName);
        images.push({
          width,
          webp: rel(webpName),
          avif: rel(avifName),
          // JPEG uniquement là où un JPEG existe déjà (800 + full) — jamais de nouvel encodage JPEG
          jpeg: width === 800 ? rel(`${stem}-800.jpg`) : width === srcW ? rel(base) : '',
        });
      }

      // 4) LQIP : 16px flouté en data-URL base64
      const lqipBuf = await sharp(src)
        .resize({ width: LQIP_SIZE, withoutEnlargement: true })
        .blur(1.5)
        .webp({ quality: 60 })
        .toBuffer();
      lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

      await Promise.all(jobs);
    } catch (e) {
      console.warn(`[build-data] image introuvable pour "${id}" : references/${base} (${e.message})`);
    }
  }
  works.push({
    id,
    title: w.title ?? id,
    year: w.year ?? 0,
    medium: w.medium ?? '',
    dimensions: w.dimensions ?? '',
    description: w.description ?? '',
    room: w.room ?? '',
    order: w.order ?? 0,
    image: base ? `data/images/${stem}-800.jpg` : '',
    imageFull: base ? `data/images/${base}` : '',
    images,
    lqip,
    ratio,
  });
}
works.sort((a, b) => roomIndexOf(a.room) - roomIndexOf(b.room) || a.order - b.order || a.id.localeCompare(b.id));

// Nettoyage des orphelins (fichiers qui ne font plus partie du build) — après génération, jamais avant
try {
  for (const f of await readdir(OUT_IMG)) {
    if (!generatedFiles.has(f)) await rm(path.join(OUT_IMG, f), { force: true });
  }
} catch {}

// works.json en atomique (tmp + rename)
const payload = JSON.stringify({ artist: site.artist, tagline: site.tagline, rooms, works }, null, 2) + '\n';
const tmpJson = `${OUT_JSON}.tmp`;
await writeFile(tmpJson, payload);
await rename(tmpJson, OUT_JSON);

// Poids après
const afterImg = await dirSize(OUT_IMG);
const afterJson = Buffer.byteLength(payload);
const files = (await readdir(OUT_IMG)).length;
console.log(`[build-data] ${rooms.length} salle(s), ${works.length} œuvre(s) -> public/data/`);
console.log(
  `[build-data] poids images: avant ${fmtKo(beforeImg)} -> après ${fmtKo(afterImg)} (${files} fichiers, ${works.length} LQIP dans works.json)`,
);
console.log(`[build-data] works.json: avant ${fmtKo(beforeJson)} -> après ${fmtKo(afterJson)}`);
console.log(
  `[build-data] formats générés par œuvre: ${TARGET_WIDTHS.join('/')}px (clampés sans upscale) en webp q${WEBP_Q} + avif q${AVIF_Q}, JPEG full + -800.jpg conservés`,
);
