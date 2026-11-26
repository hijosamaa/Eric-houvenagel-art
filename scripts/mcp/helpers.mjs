// Helpers pour le serveur MCP de la galerie virtuelle.
// Tout est en .mjs, exécuté par Node directement — rien n'entre dans le bundle client.
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHOTKIT_SHOOT = path.join(ROOT, '.vibe', 'shotkit', 'shoot.mjs');
export const STATE_FILE = path.join(ROOT, '.vibe', 'mcp-state.json');
export const WORKS_DIR = path.join(ROOT, 'data', 'works');
export const WORKS_JSON_OUT = path.join(ROOT, 'public', 'data', 'works.json');
// Forme native Windows obligatoire pour l'env var (un chemin /c/... serait traité comme UNC \\c\...)
export const BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  || 'C:\\Users\\Hijo\\AppData\\Local\\ms-playwright';

// playwright n'est installé que dans .vibe/shotkit/node_modules : on résout via ce dossier.
const shotkitRequire = createRequire(path.join(ROOT, '.vibe', 'shotkit', 'shoot.mjs'));
export function loadPlaywright() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;
  return shotkitRequire('playwright');
}

// ---------- état persistant (pid dev, port, dernières erreurs console) ----------
export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
export function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}
export function devPort() {
  return readState().devPort ?? 5199;
}
export function baseUrl(port = devPort()) {
  return `http://localhost:${port}/`;
}

// ---------- process helpers ----------
export function run(cmd, args, { cwd = ROOT, env = {}, timeoutMs = 300000, shell = false } = {}) {
  return new Promise((resolve) => {
    const child = shell
      ? spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true })
      : spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut: false }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr, timedOut }); });
  });
}

export function tail(text, lines = 40) {
  const arr = String(text).replace(/\r/g, '').split('\n');
  return arr.slice(-lines).join('\n');
}

export async function waitForPort(port, { timeoutMs = 90000, expectDown = false } = {}) {
  // vite écoute sur localhost (souvent ::1 seulement en IPv6) : sonder localhost ET 127.0.0.1
  const urls = [`http://localhost:${port}/`, `http://127.0.0.1:${port}/`];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let anyUp = false;
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.status > 0) anyUp = true;
      } catch { /* host non atteignable */ }
    }
    if (anyUp !== expectDown) return { ok: true, ms: Date.now() - t0 };
    if (expectDown && !anyUp) return { ok: true, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, ms: Date.now() - t0 };
}

// ---------- build / dev ----------
export async function build() {
  const r = await run('npm', ['run', 'build'], { shell: true, timeoutMs: 600000 });
  return { exitCode: r.code, timedOut: r.timedOut, tail: tail(r.stdout + '\n' + r.stderr, 40) };
}

let devChild = null;

export async function devStart(port = 5199) {
  const state = readState();
  if (state.devPid && state.devPort === port) {
    const alive = await waitForPort(port, { timeoutMs: 3000 });
    if (alive.ok) return { started: false, alreadyRunning: true, port, pid: state.devPid, url: baseUrl(port) };
  }
  // Arrêt propre d'une éventuelle instance précédente gérée par ce serveur
  if (devChild) { try { devChild.kill('SIGKILL'); } catch {} devChild = null; }
  else if (state.devPid) { try { process.kill(state.devPid, 'SIGKILL'); } catch {} }

  // predev (build-data.mjs) explicitement, puis vite directement via node :
  // PID propre, sans wrapper shell npm, donc dev_stop fiable.
  const pre = await run(process.execPath, [path.join(ROOT, 'scripts', 'build-data.mjs')], { timeoutMs: 300000 });
  if (pre.code !== 0) {
    return { started: false, error: 'build-data.mjs (predev) a échoué', exitCode: pre.code, tail: tail(pre.stdout + pre.stderr, 20) };
  }
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  // --bypass-lock : un processus vite fantôme d'une session précédente peut tenir le lock projet
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort', '--bypass-lock'], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOut = '';
  child.stdout.on('data', (d) => { childOut += d; });
  child.stderr.on('data', (d) => { childOut += d; });
  devChild = child;
  child.on('close', () => {
    if (devChild === child) devChild = null;
    const s = readState();
    if (s.devPid === child.pid) writeState({ devPid: null, devPort: null });
  });
  const wait = await waitForPort(port, { timeoutMs: 90000 });
  if (!wait.ok) {
    try { child.kill('SIGKILL'); } catch {}
    if (devChild === child) devChild = null;
    return { started: false, error: `le port ${port} ne répond pas après ${wait.ms} ms`, port, pid: child.pid, childOutput: tail(childOut, 20) };
  }
  writeState({ devPid: child.pid, devPort: port });
  return { started: true, port, pid: child.pid, url: baseUrl(port), waitedMs: wait.ms, predev: 'build-data.mjs ok' };
}

export async function devStop() {
  const state = readState();
  const pid = devChild?.pid ?? state.devPid ?? null;
  let killed = false;
  if (devChild) { try { devChild.kill('SIGKILL'); killed = true; } catch {} devChild = null; }
  if (pid) {
    try { process.kill(pid, 'SIGKILL'); killed = true; } catch { /* déjà mort */ }
    // fallback Windows : tuer l'arbre éventuel
    const r = await run('taskkill', ['/pid', String(pid), '/T', '/F']);
    killed = killed || r.code === 0;
  }
  const port = state.devPort ?? 5199;
  const wait = await waitForPort(port, { timeoutMs: 15000, expectDown: true });
  writeState({ devPid: null, devPort: null });
  return { stopped: killed, pid, port, portFree: wait.ok };
}

// ---------- shoot (harness existant) ----------
export async function shoot(specs, outDir = '.vibe/shots-mcp', port = devPort()) {
  const absOut = path.resolve(ROOT, outDir);
  fs.mkdirSync(absOut, { recursive: true });
  const args = [SHOTKIT_SHOOT, baseUrl(port), outDir, ...specs];
  const r = await run(process.execPath, args, {
    cwd: ROOT,
    timeoutMs: 600000,
    env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
  });
  let pngs = [];
  let consoleErrors = [];
  try {
    pngs = fs.readdirSync(absOut).filter((f) => f.endsWith('.png')).sort().map((f) => `${outDir}/${f}`);
  } catch {}
  try {
    consoleErrors = JSON.parse(fs.readFileSync(path.join(absOut, 'errors.json'), 'utf8'));
  } catch {
    const m = r.stdout.match(/CONSOLE ERRORS: (\d+)/);
    consoleErrors = m ? [`${m[1]} erreur(s) console (voir ${outDir}/errors.json ou la sortie)`] : [];
  }
  writeState({ lastConsoleErrors: consoleErrors, lastShoot: { specs, outDir, port, at: new Date().toISOString() } });
  return {
    exitCode: r.code,
    timedOut: r.timedOut,
    base: baseUrl(port),
    outDir,
    pngCount: pngs.length,
    pngs,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    tail: tail(r.stdout + '\n' + r.stderr, 30),
  };
}

// ---------- playwright direct (perf / verify_dup) ----------
async function openGalleryPage(browser, port, { width, height, dup = 1 }) {
  loadPlaywright(); // pose PLAYWRIGHT_BROWSERS_PATH avant le launch
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(`${baseUrl(port)}?dup=${dup}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window).__gallery !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => { const b = document.getElementById('btn-enter'); if (b && !b.disabled) b.click(); });
  await page.waitForTimeout(900);
  return { ctx, page, consoleErrors };
}

export async function perf(port = devPort()) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const { ctx, page, consoleErrors } = await openGalleryPage(browser, port, { width: 1440, height: 900 });
    const info = await page.evaluate(() => (window).__gallery.perf());
    const fps = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const loop = () => {
        frames++;
        const dt = performance.now() - t0;
        if (dt < 2000) requestAnimationFrame(loop);
        else resolve(frames / (dt / 1000));
      };
      requestAnimationFrame(loop);
    }));
    const cam = await page.evaluate(() => ({
      z: (window).__gallery.controls.currentZ(),
      zEnd: (window).__gallery.layout.zEnd,
    }));
    await ctx.close();
    return {
      url: `${baseUrl(port)}?dup=1`,
      viewport: '1440x900',
      fps: Math.round(fps * 10) / 10,
      rendererInfo: info,
      camera: cam,
      consoleErrorCount: consoleErrors.length,
      consoleErrors,
    };
  } finally {
    await browser.close();
  }
}

export async function verifyDup(n = 3, outDir = '.vibe/shots-mcp/verify-dup', port = devPort()) {
  const { chromium } = loadPlaywright();
  const absOut = path.resolve(ROOT, outDir);
  fs.mkdirSync(absOut, { recursive: true });
  const browser = await chromium.launch();
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const results = [];
  let allConsoleErrors = [];
  try {
    for (const vp of viewports) {
      const { ctx, page, consoleErrors } = await openGalleryPage(browser, port, { ...vp, dup: n });
      const steps = [];
      const violations = [];
      let minZ = Infinity;
      let zEnd = null;
      const STEPS = 24;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        await page.evaluate((tt) => {
          const spacer = document.getElementById('scroll-spacer');
          const max = spacer.offsetHeight - window.innerHeight;
          window.scrollTo({ top: tt * max, behavior: 'auto' });
        }, t);
        await page.waitForTimeout(150);
        const s = await page.evaluate(() => ({
          z: (window).__gallery.controls.currentZ(),
          zEnd: (window).__gallery.layout.zEnd,
        }));
        zEnd = s.zEnd;
        minZ = Math.min(minZ, s.z);
        if (s.z < s.zEnd - 1e-6) violations.push({ t: Math.round(t * 100) / 100, z: s.z, zEnd: s.zEnd });
        steps.push({ t: Math.round(t * 100) / 100, z: Math.round(s.z * 1000) / 1000 });
        if (i === Math.round(STEPS * 0.45)) {
          await page.screenshot({ path: path.join(absOut, `dup${n}-${vp.name}-t045.png`) });
        }
      }
      await page.screenshot({ path: path.join(absOut, `dup${n}-${vp.name}-end.png`) });
      await ctx.close();
      allConsoleErrors = allConsoleErrors.concat(consoleErrors.map((e) => `[${vp.name}] ${e}`));
      results.push({
        viewport: `${vp.name} ${vp.width}x${vp.height}`,
        consoleErrorCount: consoleErrors.length,
        consoleErrors,
        zEnd,
        minZ: Math.round(minZ * 1000) / 1000,
        cameraBehindWall: violations.length,
        violations: violations.slice(0, 10),
        samples: steps.filter((_, i) => i % 6 === 0),
      });
    }
  } finally {
    await browser.close();
  }
  writeState({ lastConsoleErrors: allConsoleErrors, lastVerifyDup: { n, port, at: new Date().toISOString() } });
  const violationsTotal = results.reduce((a, r) => a + r.cameraBehindWall, 0);
  const consoleErrorCount = allConsoleErrors.length;
  return {
    ok: violationsTotal === 0 && consoleErrorCount === 0,
    dup: n,
    url: `${baseUrl(port)}?dup=${n}`,
    outDir,
    consoleErrorCount,
    consoleErrors: allConsoleErrors,
    violationsTotal,
    viewports: results,
    shots: fs.readdirSync(absOut).filter((f) => f.endsWith('.png')).map((f) => `${outDir}/${f}`),
  };
}

export function consoleErrorsLast() {
  const s = readState();
  const errors = Array.isArray(s.lastConsoleErrors) ? s.lastConsoleErrors : [];
  return {
    count: errors.length,
    errors,
    source: s.lastShoot ? `shoot ${s.lastShoot.outDir} (${s.lastShoot.at})` : s.lastVerifyDup ? `verify_dup dup=${s.lastVerifyDup.n} (${s.lastVerifyDup.at})` : 'aucun run',
  };
}

// ---------- CRUD data/works ----------
const WORK_KEYS = ['title', 'year', 'medium', 'dimensions', 'description', 'room', 'order', 'image'];
const ID_RE = /^[A-Za-z0-9_-]+$/;

function idOk(id) { return typeof id === 'string' && ID_RE.test(id); }

export async function worksList() {
  const files = (await fsp.readdir(WORKS_DIR)).filter((f) => f.endsWith('.json')).sort();
  const works = [];
  for (const f of files) {
    const w = JSON.parse(await fsp.readFile(path.join(WORKS_DIR, f), 'utf8'));
    works.push({ id: f.replace(/\.json$/, ''), ...w });
  }
  works.sort((a, b) => (a.room ?? '').localeCompare(b.room ?? '') || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  return { count: works.length, works };
}

export async function worksGet(id) {
  if (!idOk(id)) throw new Error(`id invalide: ${JSON.stringify(id)}`);
  const file = path.join(WORKS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    const ids = (await fsp.readdir(WORKS_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    throw new Error(`work "${id}" introuvable. ids connus: ${ids.join(', ')}`);
  }
  const work = JSON.parse(await fsp.readFile(file, 'utf8'));
  return { id, file: `data/works/${id}.json`, work };
}

export async function worksUpdate(id, patch) {
  if (!idOk(id)) throw new Error(`id invalide: ${JSON.stringify(id)}`);
  const file = path.join(WORKS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`work "${id}" introuvable`);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch doit être un objet');
  const unknown = Object.keys(patch).filter((k) => !WORK_KEYS.includes(k));
  if (unknown.length) throw new Error(`clés inconnues: ${unknown.join(', ')} (schéma: ${WORK_KEYS.join(', ')})`);
  const current = JSON.parse(await fsp.readFile(file, 'utf8'));
  const next = { ...current, ...patch };
  // préserve le style CRLF des fichiers data/works/*.json
  const text = JSON.stringify(next, null, 2).replace(/\n/g, '\r\n') + '\r\n';
  await fsp.writeFile(file, text, 'utf8');
  const r = await run(process.execPath, [path.join(ROOT, 'scripts', 'build-data.mjs')], { timeoutMs: 300000 });
  if (r.code !== 0) {
    return { updated: true, id, file: `data/works/${id}.json`, work: next, buildDataExitCode: r.code, buildDataTail: tail(r.stdout + r.stderr, 30), error: 'build-data.mjs a échoué' };
  }
  const worksJson = JSON.parse(await fsp.readFile(WORKS_JSON_OUT, 'utf8'));
  return { updated: true, id, file: `data/works/${id}.json`, work: next, buildDataExitCode: 0, worksJson };
}
