import * as THREE from 'three';

import type { GalleryData } from './types';

import { computeLayout, Z_START, type PlacedWork } from './gallery/layout';

import { createScene } from './gallery/scene';

import { buildPaintings, ensureTexture, releaseTexture, setHovered } from './gallery/paintings';

import { GalleryControls } from './gallery/controls';

import { Minimap } from './gallery/minimap';

import { initUI, type IndexGroup, setResponsiveImg, pickUrl, webpSupported } from './ui';

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

  // Analytics Vercel uniquement en prod (dynamic import : le serveur dev ne charge
  // ni ne sert aucun script analytics).
  if (import.meta.env.PROD) {
    const { inject } = await import('@vercel/analytics');
    inject();
    const { injectSpeedInsights } = await import('@vercel/speed-insights');
    injectSpeedInsights();
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
  // Itération D — variantes images : la texture 3D (ensureTexture lit work.image)
  // passe en WebP si le navigateur le supporte, sinon on garde le JPEG existant.
  // 1ère œuvre en ~1200w (clampée sans upscale), les autres en 800w pour ne jamais
  // augmenter le poids servi.
  const webpOk = webpSupported();
  data.works.forEach((w, i) => {
    const targetW = i === 0 ? 1200 : 800;
    const u = webpOk ? pickUrl(w, 'webp', targetW) : pickUrl(w, 'jpeg', 800);
    if (u) w.image = u;
  });
  // Preload LCP : la 1ère œuvre en 1200w dès le fetch de works.json (même URL que
  // la texture de la 1ère œuvre -> hit cache, pas de double téléchargement).
  if (data.works.length > 0) {
    const lcpUrl = base + data.works[0].image;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = lcpUrl;
    link.fetchPriority = 'high';
    document.head.appendChild(link);
    const warm = new Image();
    warm.src = lcpUrl;
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
      setResponsiveImg(img, w, base, '(max-width: 640px) 72px, 96px');
      img.alt = w.title;
      img.decoding = 'async';
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
  const { renderer, scene, camera, sun, spotPool } = createScene(canvas, layout, pixelRatio, { shadows, coarse });
  const entries = buildPaintings(scene, layout, shadows);
  const texAniso = touch ? 4 : 8;

  const spacer = document.getElementById('scroll-spacer') as HTMLDivElement;
  spacer.style.height = `${Math.round((data.works.length * 1.15 + 1.8) * 100)}vh`;

  const controls = new GalleryControls(camera, layout, canvas);
  controls.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Plaques laiton des portails (userData.zoneIndex posé dans scene.ts) : rendues cliquables
  const plaqueMeshes: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (typeof o.userData.zoneIndex === 'number') plaqueMeshes.push(o);
  });
  controls.pickMeshes = [...entries.map((e) => e.imageMesh), ...plaqueMeshes];
  // Clic sur une plaque de portail -> focus sur la 1ère œuvre de la salle suivante
  controls.onZonePick = (zi) => {
    const zone = layout.zones[zi];
    const first = zone ? layout.placed.find((p) => p.roomName === zone.name) : undefined;
    if (first) focusWork(first);
  };

  const minimap = new Minimap(document.getElementById('minimap') as HTMLElement, layout);

  let panelWork: PlacedWork | null = null;
  let panelTravelUntil = 0; // F1 : le panneau reste ouvert pendant le trajet caméra programmatique
  let loaded = 0;
  let entered = false;
  let toastDismissed = false;
  const nearEntries = entries.filter((e) => Math.abs(e.placed.z - Z_START) < 16);
  const total = Math.max(1, nearEntries.length);

  const clampIdx = (i: number): number => Math.min(Math.max(i, 0), layout.placed.length - 1);

  // layout.placed est trié par z décroissant (z_i = Z_FIRST - i*SLOT_SPACING) :
  // recherche binaire du nombre d'œuvres avec z > camZ, en O(log n) au lieu de O(n).
  function currentIndex(camZ: number): number {
    const ps = layout.placed;
    if (ps.length === 0) return 0;
    let lo = 0;
    let hi = ps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ps[mid].z > camZ) lo = mid + 1;
      else hi = mid;
    }
    // nearest work : entre le candidat lo-1 (z <= camZ) et lo (z > camZ), prendre le plus
    // proche — robuste à tout epsilon d'arrêt (focus tween ou best-fit scroll à dup>=3)
    const a = lo - 1;
    const b = lo;
    if (a < 0) return 0;
    if (b >= ps.length) return ps.length - 1;
    return Math.abs(ps[a].z - camZ) <= Math.abs(ps[b].z - camZ) ? a : b;
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
    if (controls.mode === 'guided' && Math.abs(controls.currentZ() - p.z) > 3.2) {
      panelTravelUntil = performance.now() + 5000; // le panneau reste ouvert pendant le trajet
    } else {
      panelTravelUntil = 0;
    }
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
  controls.onNext = () => nav(1);
  controls.onPrev = () => nav(-1);
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
  let hitZone = false;
  let pointerSeen = false;
  const cursor = document.getElementById('cursor');
  const cursorPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const cursorTarget = { x: cursorPos.x, y: cursorPos.y };
  window.addEventListener('pointermove', (e) => {
    pointerSeen = true;
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

  // Chargement initial : uniquement le voisinage de l'entrée (le tick charge le reste en lazy)
  for (const e of nearEntries) {
    ensureTexture(e, base, texAniso, () => {
      loaded++;
      ui.setLoader(loaded / total, loaded >= total);
    });
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? Math.min(74, 62 / Math.sqrt(aspect)) : 58;
    camera.updateProjectionMatrix();
    minimap.relayout();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  window.scrollTo(0, 0);

  let lastRoom = '';
  const clock = new THREE.Clock();
  // Raycaster réutilisé pour le hover (champ unique) + BVH firstHitOnly (boundsTree sur les tableaux)
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  function tick(): void {
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update(dt);
    const camZ = controls.currentZ();
    for (const e of entries) {
      const dz = Math.abs(e.placed.z - camZ);
      if (dz < 16) ensureTexture(e, base, texAniso);
      else if (dz > 30) releaseTexture(e); // LRU : libère la mémoire GPU au-delà de 30 m
    }
    if (hoverDirty && mouseNdc && entered) {
      hoverDirty = false;
      ray.setFromCamera(mouseNdc, camera);
      const hits = ray.intersectObjects(controls.pickMeshes, false);
      const hitObj = hits[0]?.object;
      hoverId = (hitObj?.userData.workId as string | undefined) ?? null;
      hitZone = hitObj?.userData.zoneIndex !== undefined;
      setHovered(hoverId, entries);
      const clickable = hoverId !== null || hitZone;
      canvas.style.cursor = clickable ? 'pointer' : 'grab';
    }
    if (cursor && fine) {
      cursorPos.x += (cursorTarget.x - cursorPos.x) * Math.min(1, dt * 12);
      cursorPos.y += (cursorTarget.y - cursorPos.y) * Math.min(1, dt * 12);
      cursor.style.transform = `translate(${cursorPos.x}px, ${cursorPos.y}px) translate(-50%, -50%)`;
      cursor.style.opacity = pointerSeen ? '1' : '0';
      cursor.classList.toggle('big', hoverId !== null || hitZone);
    }
    const idx = currentIndex(camZ);
    const cur = layout.placed[idx];

    // Pool de spots « tableau » : les k plus proches de la caméra allument leur œuvre.
    // Sur une grille régulière (SLOT_SPACING), les 3 plus proches sont toujours dans la
    // fenêtre idx-2..idx+2 (preuve : tout i <= idx-3 ou i >= idx+2 est à plus de 2*SLOT_SPACING
    // de camZ, donc moins proche que idx-1, idx et idx+1) -> sélection O(1) au lieu d'un
    // tri O(n log n) de toutes les entries à chaque frame. Tri à taille constante sur la
    // fenêtre (stable, ordre = index) => strictement identique au tri global précédent.
    const window: number[] = [];
    for (let j = Math.max(0, idx - 2); j <= Math.min(layout.placed.length - 1, idx + 2); j++) window.push(j);
    window.sort((a, b) => Math.abs(layout.placed[a].z - camZ) - Math.abs(layout.placed[b].z - camZ));
    spotPool.forEach((s, i) => {
      const wi = window[i];
      const p = wi !== undefined ? layout.placed[wi] : undefined;
      if (!p) {
        s.intensity = 0;
        return;
      }
      s.position.set(p.x - 0.35, p.y + p.h / 2 + 1.25, p.z + 0.55);
      s.target.position.set(p.x, p.y - 0.05, p.z);
      s.target.updateMatrixWorld();
      s.intensity = 15;
      s.castShadow = shadows && i < 2; // ombre uniquement sur les 2 plus proches (desktop)
    });

    // fenêtre d'ombre du soleil follows the camera (évite les texels géants en hall long)
    if (shadows) {
      sun.shadow.camera.top = camZ + 16;
      sun.shadow.camera.bottom = camZ - 16;
      sun.shadow.camera.left = -10;
      sun.shadow.camera.right = 10;
      sun.shadow.camera.updateProjectionMatrix();
      sun.target.position.set(0, 0, camZ);
    }

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
    }
    const t = progressT(camZ);
    ui.setProgressBar(t);
    const showEndNow = controls.mode === 'guided' ? t > 0.985 : camZ <= layout.zEnd + 1.2;
    if (entered) {
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
    // auto-fermeture du panneau seulement quand la caméra est arrivée (ou après le trajet)
    if (
      ui.panelIsOpen() &&
      panelWork &&
      controls.mode === 'guided' &&
      Math.abs(camZ - panelWork.z) > 3.2 &&
      performance.now() > panelTravelUntil
    ) {
      ui.closePanel();
      panelWork = null;
    }
    if (panelWork && Math.abs(camZ - panelWork.z) <= 3.2) panelTravelUntil = 0;
    minimap.update(camZ, cur?.work.id ?? null);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  (window as unknown as { __gallery: unknown }).__gallery = {
    renderer,
    scene,
    layout,
    controls,
    perf: () => ({ render: { ...renderer.info.render }, memory: { ...renderer.info.memory } }),
  };
}

boot();
