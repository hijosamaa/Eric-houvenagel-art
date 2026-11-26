// Capture la scène 3D *sans aucun chrome* (HUD masqué par CSS injecté).
// Sert de plaque de fond pour les maquettes de redesign.
// Usage: node .vibe/shotkit/plate.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] || 'http://localhost:5212/';
const outDir = process.argv[3] || '.vibe/plates';
fs.mkdirSync(outDir, { recursive: true });

const HIDE = `
#brand,#minimap,#room-banner,#toast,#dots,#hud-bottom,#big-counter,#scroll-hint,#free-hint,
#progress-bar,#cursor,#panel,#index-overlay,#lightbox,#end,#intro,#nogl{display:none!important;}
#app::before,#app::after{display:none!important;}
.grain{display:none!important;}
html,body{background:#faf7f2;}
`;

const shots = [
  { name: 'desk-t000', w: 1440, h: 900, t: 0.0 },
  { name: 'desk-t045', w: 1440, h: 900, t: 0.45 },
  { name: 'desk-t070', w: 1440, h: 900, t: 0.7 },
  { name: 'desk-t091', w: 1440, h: 900, t: 0.91 },
  { name: 'mob-t045', w: 390, h: 844, t: 0.45 },
  { name: 'mob-t070', w: 390, h: 844, t: 0.7 },
];

const browser = await chromium.launch();
const errors = [];

for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${s.name}] ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gallery !== undefined, null, { timeout: 30000 }).catch(() => errors.push(`[${s.name}] no __gallery`));
  await page.evaluate(() => {
    const b = document.getElementById('btn-enter');
    if (b && !b.disabled) b.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate((tt) => {
    const spacer = document.getElementById('scroll-spacer');
    const max = spacer.offsetHeight - window.innerHeight;
    window.scrollTo({ top: tt * max, behavior: 'auto' });
  }, s.t);
  await page.waitForTimeout(2200);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${s.name}.png` });
  console.log('ok', s.name);
  await ctx.close();
}

await browser.close();
console.log('errors:', errors.length, errors.join(' | '));
