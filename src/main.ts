import * as THREE from 'three';
import type { GalleryData } from './types';
import { computeLayout, type PlacedWork } from './gallery/layout';
import { createScene } from './gallery/scene';
import { buildPaintings, ensureTexture } from './gallery/paintings';
import { GalleryControls } from './gallery/controls';
import { Minimap } from './gallery/minimap';
import { initUI } from './ui';

async function boot(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas) return;
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
  document.title = `${data.artist} — Galerie`;

  const layout = computeLayout(data);
  const { renderer, scene, camera } = createScene(canvas, layout);
  const entries = buildPaintings(scene, layout);

  const spacer = document.getElementById('scroll-spacer') as HTMLDivElement;
  spacer.style.height = `${Math.round((data.works.length * 1.15 + 1.8) * 100)}vh`;

  const controls = new GalleryControls(camera, layout, canvas);
  controls.pickMeshes = entries.map((e) => e.imageMesh);

  const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, layout);

  let panelWork: PlacedWork | null = null;
  let loaded = 0;
  const total = entries.length;

  function currentIndex(camZ: number): number {
    const ps = layout.placed;
    let passed = 0;
    for (const p of ps) if (p.z > camZ) passed++;
    return Math.min(passed, ps.length - 1);
  }

  function step(dir: 1 | -1): void {
    const idx = Math.min(Math.max(currentIndex(controls.currentZ()) + dir, 0), layout.placed.length - 1);
    const p = layout.placed[idx];
    controls.scrollToWork(p);
    panelWork = p;
    ui.openPanel(p);
  }

  const ui = initUI({
    onPrev: () => step(-1),
    onNext: () => step(1),
    onFreeToggle: () => {
      const free = controls.mode === 'free';
      controls.setMode(free ? 'guided' : 'free');
      ui.setFreeLabel(!free);
    },
    onEnter: () => ui.hideIntro(),
    onClosePanel: () => {
      panelWork = null;
    },
    onZoom: () => {
      if (panelWork) ui.openLightbox(panelWork, base);
    },
  });

  if (!window.matchMedia('(pointer: fine)').matches) {
    (document.getElementById('btn-free') as HTMLButtonElement).style.display = 'none';
  }

  controls.onPick = (p) => {
    panelWork = p;
    ui.openPanel(p);
    controls.scrollToWork(p);
  };
  minimap.onPick = controls.onPick;

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
  resize();

  let lastRoom = '';
  const clock = new THREE.Clock();
  function tick(): void {
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update(dt);
    const camZ = controls.currentZ();
    for (const e of entries) {
      if (Math.abs(e.placed.z - camZ) < 16) ensureTexture(e, base);
    }
    const idx = currentIndex(camZ);
    const cur = layout.placed[idx];
    ui.setProgress(idx + 1, layout.placed.length, cur?.roomName ?? '');
    const zone = layout.zones.find((z) => camZ <= z.zMax + 1.2 && camZ >= z.zMin - 1.2);
    if (zone && zone.name !== lastRoom) {
      lastRoom = zone.name;
      ui.flashRoom(zone.name);
    }
    minimap.draw(camZ, cur?.work.id ?? null);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}

boot();
