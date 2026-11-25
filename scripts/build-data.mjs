import { readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const REFS = path.join(ROOT, 'references');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_IMG = path.join(OUT_DIR, 'images');
const OUT_JSON = path.join(OUT_DIR, 'works.json');

const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const listJson = async (dir) => (await readdir(dir)).filter((f) => f.endsWith('.json'));

const site = await readJson(path.join(DATA, 'site.json'));

const rooms = [];
for (const f of await listJson(path.join(DATA, 'rooms'))) {
  const r = await readJson(path.join(DATA, 'rooms', f));
  rooms.push({ id: f.replace(/\.json$/, ''), name: r.name ?? f, order: r.order ?? 0 });
}
rooms.sort((a, b) => a.order - b.order);

await rm(OUT_IMG, { recursive: true, force: true });
await mkdir(OUT_IMG, { recursive: true });

const roomIndexOf = (id) => {
  const i = rooms.findIndex((r) => r.id === id);
  return i === -1 ? rooms.length : i;
};

const works = [];
for (const f of await listJson(path.join(DATA, 'works'))) {
  const w = await readJson(path.join(DATA, 'works', f));
  const id = f.replace(/\.json$/, '');
  const base = path.basename(String(w.image || ''));
  const stem = base.replace(/\.[^.]+$/, '');
  let ratio = 1;
  if (base) {
    const src = path.join(REFS, base);
    try {
      const img = sharp(src);
      const meta = await img.metadata();
      ratio = meta.width / meta.height;
      const full = meta.width > 2000 ? img.clone().resize({ width: 2000, withoutEnlargement: true }) : img.clone();
      const ext = (base.split('.').pop() || 'jpg').toLowerCase();
      if (ext === 'png') await full.png({ compressionLevel: 9 }).toFile(path.join(OUT_IMG, base));
      else if (ext === 'webp') await full.webp({ quality: 85 }).toFile(path.join(OUT_IMG, base));
      else await full.jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(OUT_IMG, base));
      await sharp(src)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(path.join(OUT_IMG, `${stem}-800.jpg`));
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
    ratio,
  });
}
works.sort((a, b) => roomIndexOf(a.room) - roomIndexOf(b.room) || a.order - b.order || a.id.localeCompare(b.id));

await writeFile(OUT_JSON, JSON.stringify({ artist: site.artist, tagline: site.tagline, rooms, works }, null, 2) + '\n');
console.log(`[build-data] ${rooms.length} salle(s), ${works.length} œuvre(s) -> public/data/`);
