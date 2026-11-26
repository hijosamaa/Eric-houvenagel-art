// Capture des maquettes HTML (docs/design/proposals/*.html) en PNG.
// Usage: node .vibe/shotkit/shoot-mock.mjs <plan.json>
// plan.json : [{ "file": "a-salle-blanche.html", "w": 1440, "h": 900, "out": "a-desk-view" }]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const planPath = process.argv[2];
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const root = path.resolve('docs/design/proposals');
const outDir = path.resolve('docs/design/proposals/shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

for (const s of plan) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dsf || 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
  await page.goto('file:///' + path.join(root, s.file) + (s.q || ''), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, s.out + '.png') });
  console.log(s.out, errs.length ? 'ERR: ' + errs.join(' | ') : 'ok');
  await ctx.close();
}

await browser.close();
