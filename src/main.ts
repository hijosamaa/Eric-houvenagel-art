import * as THREE from 'three';
import type { GalleryData } from './types';
import { computeLayout, Z_START, type PlacedWork } from './gallery/layout';
import { createScene } from './gallery/scene';
import { buildPaintings, ensureTexture, setHovered } from './gallery/paintings';
import { GalleryControls } from './gallery/controls';
import { Minimap } from './gallery/minimap';
import { initUI } from './ui';

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
  const brandName = document.getElementById('brand-name');
  if (brandName) brandName.textContent = data.artist;
  const introName = document.getElementById('intro-name');
  if (introName) introName.textContent = data.artist;
  document.title = `${data.artist} — Galerie virtuelle`;
  const og = document.querySelector('meta[property="og:image"]');
  if (og && data.works.length > 0) {
    og.setAttribute('content', location.origin + base + data.works[0].image);
  }

  const layout = computeLayout(data);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 640;
  const pixelRatio = Math.min(window.devicePixelRatio, coarse || small ? 1.5 : 2);
  const { renderer, scene, camera, spot } = createScene(canvas, layout, pixelRatio);
  const entries = buildPaintings(scene, layout);

  const spacer = document.getElementById('scroll-spacer') as HTMLDivElement;
  spacer.style.height = `${Math.round((data.works.length * 1.15 + 1.8) * 100)}vh`;

  const controls = new GalleryControls(camera, layout, canvas);
  controls.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.pickMeshes = entries.map((e) => e.imageMesh);

  const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, layout);

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

  function step(dir: 1 | -1): void {
    const idx = clampIdx(currentIndex(controls.currentZ()) + dir);
    focusWork(layout.placed[idx]);
  }

  function nav(dir: 1 | -1): void {
    if (ui.lightboxIsOpen()) {
      const w = ui.lbNav(dir);
      if (w) {
        panelWork = w;
        ui.openPanel(w);
      }
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
        ui.toast("Faites défiler pour avancer · cliquez sur un tableau pour l'observer", 8000);
      },
      onClosePanel: () => {
        panelWork = null;
      },
      onZoom: () => {
        if (panelWork) ui.openLightbox(panelWork);
      },
    },
    base,
  );
  ui.setWorks(layout.placed);
  ui.buildDots(layout.placed.length, (i) => focusWork(layout.placed[i]));

  if (!window.matchMedia('(pointer: fine)').matches) {
    (document.getElementById('btn-free') as HTMLButtonElement).style.display = 'none';
  }

  controls.onPick = (p) => focusWork(p);
  minimap.onPick = (p) => focusWork(p);

  controls.onEscape = () => {
    if (ui.lightboxIsOpen()) {
      ui.closeLightbox();
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
    }
  });

  window.addEventListener(
    'scroll',
    () => {
      if (!toastDismissed && window.scrollY > 30) {
        toastDismissed = true;
        ui.hideToast();
      }
    },
    { passive: true },
  );

  let mouseNdc: THREE.Vector2 | null = null;
  let hoverDirty = false;
  window.addEventListener('pointermove', (e) => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const rect = canvas.getBoundingClientRect();
    mouseNdc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverDirty = true;
  });

  entries.forEach((e) =>
    ensureTexture(e, base, () => {
      loaded++;
      ui.setLoader(loaded / total, loaded >= total);
    }),
  );

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
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
      const id = (hits[0]?.object.userData.workId as string | undefined) ?? null;
      setHovered(id, entries);
      canvas.style.cursor = id ? 'pointer' : 'grab';
    }
    const idx = currentIndex(camZ);
    const cur = layout.placed[idx];
    if (cur) {
      ui.setProgress(idx + 1, layout.placed.length, cur.roomName);
      ui.setActiveDot(idx);
      spot.target = entries[idx].group;
      spot.position.set(cur.x + (cur.side === 'right' ? -0.9 : 0.9), 3.15, cur.z);
    }
    ui.setProgressBar(progressT(camZ));
    const zone = layout.zones.find((z) => camZ <= z.zMax + 1.2 && camZ >= z.zMin - 1.2);
    if (zone && zone.name !== lastRoom) {
      lastRoom = zone.name;
      ui.flashRoom(zone.name);
    }
    if (ui.panelIsOpen() && panelWork && controls.mode === 'guided' && Math.abs(camZ - panelWork.z) > 3.2) {
      ui.closePanel();
      panelWork = null;
    }
    minimap.draw(camZ, cur?.work.id ?? null);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}

boot();
