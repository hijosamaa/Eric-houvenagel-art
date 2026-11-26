// Mesure compacte du chrome : surfaces visibles, chevauchements, part d'écran.
// Usage: node .vibe/shotkit/measure-chrome.mjs <baseUrl>
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5212/';
const IDS = ['brand', 'minimap', 'room-banner', 'toast', 'dots', 'hud-bottom', 'big-counter', 'scroll-hint', 'free-hint', 'progress-bar', 'panel'];
const sizes = [
  [1440, 900, 'desktop'],
  [390, 844, 'mobile'],
];

const browser = await chromium.launch();
for (const [w, h, label] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gallery !== undefined, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const b = document.getElementById('btn-enter');
    if (b && !b.disabled) b.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const s = document.getElementById('scroll-spacer');
    window.scrollTo({ top: 0.45 * (s.offsetHeight - window.innerHeight), behavior: 'auto' });
  });
  await page.waitForTimeout(1600);
  const r = await page.evaluate((ids) => {
    const out = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
      if (!visible || b.width === 0) continue;
      out.push({ id, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: cs.borderRadius, f: cs.fontSize });
    }
    const ov = [];
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], c = out[j];
        if (!(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y)) ov.push(a.id + ' × ' + c.id);
      }
    // surface occupée : union approximative par somme des aires (les amas ne se recouvrent pas)
    const area = out.filter((o) => o.id !== 'panel').reduce((s, o) => s + o.w * o.h, 0);
    return { out, ov, area };
  }, IDS);
  const vw = w * h;
  console.log(`\n## ${label} ${w}×${h}`);
  for (const o of r.out) console.log(`- ${o.id.padEnd(13)} ${String(o.x).padStart(4)},${String(o.y).padStart(3)}  ${String(o.w).padStart(4)}×${String(o.h).padStart(3)}  radius:${o.r}  font:${o.f}`);
  console.log(`amas visibles: ${r.out.length} | chevauchements: ${r.ov.length}${r.ov.length ? ' → ' + r.ov.join(' ; ') : ''}`);
  console.log(`surface de chrome ≈ ${Math.round((r.area / vw) * 1000) / 10} % de l'écran`);
  await ctx.close();
}
await browser.close();
