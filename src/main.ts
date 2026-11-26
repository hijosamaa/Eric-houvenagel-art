import * as THREE from 'three';
import type { GalleryData } from './types';
import { computeLayout, Z_START, type PlacedWork } from './gallery/layout';
import { createScene } from './gallery/scene';
import { buildPaintings, ensureTexture, setHovered } from './gallery/paintings';
import { GalleryControls } from './gallery/controls';
import { Minimap } from './gallery/minimap';
import { initUI, type IndexGroup } from './ui';

async function boot(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const canvasEl = document.getElementById('scene');
  if (!(canvasEl instanceof HTMLCanvasElement)) return;
  const canvas = canvasEl;
  let webgl = true;
  try {
    webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webgl = false;
  }
  if (!webgl) {
    document.getElementById('nogl')?.classList.remove('hidden');
    return;
  }

  const res = await fetch(`${base}data/works.json`);
  const data = (await res.json()) as GalleryData;
  const dupParam = Number(new URLSearchParams(location.search).get('dup') || '0');
  if (dupParam > 1 && data.works.length > 0) {
    const baseWorks = [...data.works];
    for (let k = 2; k <= dupParam; k++) {
      for (const w of baseWorks) {
        data.works.push({ ...w, id: `${w.id}-${k}`, order: w.order + (k - 1) * 100 });
      }
    }
  }
  const brandName = document.getElementById('brand-name');
  if (brandName) brandName.textContent = data.artist;
  const introName = document.getElementById('intro-name');
  if (introName) introName.textContent = data.artist;
  document.title = `${data.artist} — Galerie virtuelle`;
  const og = document.querySelector('meta[property="og:image"]');
  if (og && data.works.length > 0) {
    og.setAttribute('content', location.origin + base + (data.works[0].imageFull || data.works[0].image));
  }

  const strip = document.getElementById('intro-strip');
  if (strip) {
    for (const w of data.works.slice(0, 3)) {
      const img = document.createElement('img');
      img.src = base + w.image;
      img.alt = w.title;
      strip.appendChild(img);
    }
  }

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 640;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const touch = coarse || small;
  const viewDist = touch ? 4.2 : 2.6;
  const layout = computeLayout(data, viewDist);
  const pixelRatio = Math.min(window.devicePixelRatio, touch ? 1.5 : 2);
  const shadows = !coarse;
  const { renderer, scene, camera, spot } = createScene(canvas, layout, pixelRatio, { shadows });
  const entries = buildPaintings(scene, layout, shadows);

  const spacer = document.getElementById('scroll-spacer') as HTMLDivElement;
  spacer.style.height = `${Math.round((data.works.length * 1.15 + 1.8) * 100)}vh`;

  const controls = new GalleryControls(camera, layout, canvas);
  controls.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.pickMeshes = entries.map((e) => e.imageMesh);

  const minimap = new Minimap(document.getElementById('minimap') as HTMLElement, layout);

  let panelWork: PlacedWork | null = null;
  let loaded = 0;
  let entered = false;
  let toastDismissed = false;
  const total = entries.length;

  const clampIdx = (i: number): number => Math.min(Math.max(i, 0), layout.placed.length - 1);

  function currentIndex(camZ: number): number {
    const ps = layout.placed;
    if (ps.length === 0) return 0;
    let passed = 0;
    for (const p of ps) if (p.z > camZ) passed++;
    return Math.min(passed, ps.length - 1);
  }

  let navTarget: number | null = null;
  function step(dir: 1 | -1): void {
    const ps = layout.placed;
    const idx = navTarget ?? currentIndex(controls.currentZ());
    if (dir === 1 && idx >= ps.length - 1) {
      navTarget = null;
      if (ui.panelIsOpen()) {
        ui.closePanel();
        panelWork = null;
      }
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: controls.reduced ? 'auto' : 'smooth' });
      return;
    }
    if (dir === -1 && idx <= 0) {
      navTarget = null;
      window.scrollTo({ top: 0, behavior: controls.reduced ? 'auto' : 'smooth' });
      return;
    }
    const targetIdx = clampIdx(idx + dir);
    navTarget = targetIdx;
    setTimeout(() => {
      if (navTarget === targetIdx) navTarget = null;
    }, 1600);
    const target = ps[targetIdx];
    if (ui.panelIsOpen()) focusWork(target);
    else if (controls.mode === 'free') controls.focusOn(target);
    else controls.scrollToWork(target);
  }

  function nav(dir: 1 | -1): void {
    if (ui.lightboxIsOpen()) {
      ui.lbNav(dir);
      return;
    }
    step(dir);
  }

  function focusWork(p: PlacedWork): void {
    panelWork = p;
    ui.openPanel(p);
    if (controls.mode === 'guided') controls.scrollToWork(p);
    else controls.focusOn(p);
  }

  function progressT(camZ: number): number {
    if (controls.mode === 'guided') {
      const spacerEl = document.getElementById('scroll-spacer');
      const max = spacerEl ? spacerEl.offsetHeight - window.innerHeight : 0;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    }
    return Math.min(1, Math.max(0, (Z_START - camZ) / (Z_START - layout.zEnd)));
  }

  const ui = initUI(
    {
      onPrev: () => nav(-1),
      onNext: () => nav(1),
      onFreeToggle: () => {
        const free = controls.mode === 'free';
        controls.setMode(free ? 'guided' : 'free');
        ui.setFreeLabel(!free);
      },
      onEnter: () => {
        entered = true;
        ui.hideIntro();
        document.getElementById('app')?.classList.add('ready');
        scrollHint?.classList.add('show');
        ui.toast("Faites défiler pour avancer · cliquez sur un tableau ou son numéro pour l'observer", 8000);
      },
      onClosePanel: () => {
        panelWork = null;
      },
      onZoom: () => {
        if (panelWork) ui.openLightbox(panelWork);
      },
      onEndRestart: () => {
        ui.showEnd(false);
        window.scrollTo({ top: 0, behavior: controls.reduced ? 'auto' : 'smooth' });
      },
      onEndIndex: () => {
        ui.showEnd(false);
        ui.closePanel();
        panelWork = null;
        ui.openIndex();
      },
    },
    base,
  );
  ui.setWorks(layout.placed);
  ui.buildDots(layout.placed.length, (i) => focusWork(layout.placed[i]));

  const groups: IndexGroup[] = layout.zones
    .map((z) => ({
      name: z.name,
      works: layout.placed.filter((p) => p.roomName === z.name),
    }))
    .filter((g) => g.works.length > 0);
  ui.buildIndex(groups, base, (p) => focusWork(p));

  if (!fine) {
    (document.getElementById('btn-free') as HTMLButtonElement).style.display = 'none';
  }

  controls.onPick = (p) => focusWork(p);
  minimap.onPick = (p) => focusWork(p);

  controls.onEscape = () => {
    if (ui.lightboxIsOpen()) {
      ui.closeLightbox();
      return;
    }
    if (ui.indexIsOpen()) {
      ui.closeIndex();
      return;
    }
    if (ui.panelIsOpen()) {
      ui.closePanel();
      panelWork = null;
      return;
    }
    if (controls.mode === 'free') {
      controls.setMode('guided');
      ui.setFreeLabel(false);
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !entered) {
      const b = document.getElementById('btn-enter') as HTMLButtonElement | null;
      if (b && !b.disabled) b.click();
      return;
    }
    if (ui.lightboxIsOpen()) {
      if (e.code === 'Equal' || e.code === 'NumpadAdd') ui.lbZoom(1);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') ui.lbZoom(-1);
    }
  });

  const hudBottom = document.getElementById('hud-bottom');
  const scrollHint = document.getElementById('scroll-hint');
  let idleTimer: number | undefined;
  window.addEventListener(
    'scroll',
    () => {
      if (!toastDismissed && window.scrollY > 30) {
        toastDismissed = true;
        ui.hideToast();
        scrollHint?.classList.remove('show');
      }
      hudBottom?.classList.remove('idle');
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (fine && entered) hudBottom?.classList.add('idle');
      }, 2400);
    },
    { passive: true },
  );

  let mouseNdc: THREE.Vector2 | null = null;
  let hoverDirty = false;
  let hoverId: string | null = null;
  const cursor = document.getElementById('cursor');
  const cursorPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const cursorTarget = { x: cursorPos.x, y: cursorPos.y };
  window.addEventListener('pointermove', (e) => {
    cursorTarget.x = e.clientX;
    cursorTarget.y = e.clientY;
    if (!fine) return;
    const rect = canvas.getBoundingClientRect();
    mouseNdc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverDirty = true;
  });
  window.addEventListener('mouseleave', () => {
    if (cursor) cursor.style.opacity = '0';
  });

  entries.forEach((e) =>
    ensureTexture(e, base, () => {
      loaded++;
      ui.setLoader(loaded / total, loaded >= total);
    }),
  );

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? Math.min(74, 62 / Math.sqrt(aspect)) : 58;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  window.scrollTo(0, 0);

  let lastRoom = '';
  const clock = new THREE.Clock();
  const ray = new THREE.Raycaster();
  function tick(): void {
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update(dt);
    const camZ = controls.currentZ();
    for (const e of entries) {
      if (Math.abs(e.placed.z - camZ) < 16) ensureTexture(e, base);
    }
    if (hoverDirty && mouseNdc && entered) {
      hoverDirty = false;
      ray.setFromCamera(mouseNdc, camera);
      const hits = ray.intersectObjects(controls.pickMeshes, false);
      hoverId = (hits[0]?.object.userData.workId as string | undefined) ?? null;
      setHovered(hoverId, entries);
      canvas.style.cursor = hoverId ? 'pointer' : 'grab';
    }
    if (cursor && fine) {
      cursorPos.x += (cursorTarget.x - cursorPos.x) * Math.min(1, dt * 12);
      cursorPos.y += (cursorTarget.y - cursorPos.y) * Math.min(1, dt * 12);
      cursor.style.transform = `translate(${cursorPos.x}px, ${cursorPos.y}px) translate(-50%, -50%)`;
      cursor.style.opacity = '1';
      cursor.classList.toggle('big', hoverId !== null);
    }
    const idx = currentIndex(camZ);
    const cur = layout.placed[idx];
    const bc = document.getElementById('big-counter');
    if (bc && cur) {
      const near = Math.abs(camZ - cur.z) < 3;
      bc.classList.toggle('show', entered && near);
      const bcCur = document.getElementById('bc-cur');
      const bcTotal = document.getElementById('bc-total');
      if (bcCur) bcCur.textContent = String(idx + 1).padStart(2, '0');
      if (bcTotal) bcTotal.textContent = String(layout.placed.length).padStart(2, '0');
    }
    if (cur) {
      ui.setProgress(idx + 1, layout.placed.length, cur.roomName);
      ui.setActiveDot(idx);
      spot.target = entries[idx].group;
      spot.position.set(cur.x - 0.9, 3.15, cur.z);
    }
    const t = progressT(camZ);
    ui.setProgressBar(t);
    if (entered && controls.mode === 'guided') {
      const showEndNow = t > 0.985;
      if (showEndNow && ui.panelIsOpen()) {
        ui.closePanel();
        panelWork = null;
      }
      ui.showEnd(showEndNow);
    }
    const zone = layout.zones.find((z) => camZ <= z.zMax + 1.2 && camZ >= z.zMin - 1.2);
    if (zone && zone.name !== lastRoom) {
      lastRoom = zone.name;
      ui.flashRoom(zone.name);
    }
    if (ui.panelIsOpen() && panelWork && controls.mode === 'guided' && Math.abs(camZ - panelWork.z) > 3.2) {
      ui.closePanel();
      panelWork = null;
    }
    minimap.update(camZ, cur?.work.id ?? null);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  (window as unknown as { __gallery: unknown }).__gallery = { renderer, scene, layout, controls };
}

boot();
