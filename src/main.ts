import * as THREE from 'three';

import type { GalleryData } from './types';

import { computeLayout, zoneAt, type PlacedWork } from './gallery/layout';

import { updateSunShadow } from './gallery/lights';

import { createScene } from './gallery/scene';

import { buildPaintings, ensureTexture, releaseTexture, setHovered } from './gallery/paintings';

import { GalleryControls } from './gallery/controls';

import { Minimap } from './gallery/minimap';

import { createPost, type PostPipeline } from './gallery/post';

import { initUI, metaLine, type IndexGroup, setResponsiveImg, pickUrl, webpSupported } from './ui';

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
  // `?dup=N` : outil de mise en scène (jamais en prod) pour préfigurer une trentaine
  // d'œuvres. Les copies sont **réparties en tourniquet** sur les salles, sinon elles
  // s'empilent dans la première et l'on juge une salle de 50 m au lieu d'une suite
  // équilibrée.
  const dupParam = Number(new URLSearchParams(location.search).get('dup') || '0');
  if (dupParam > 1 && data.works.length > 0) {
    const baseWorks = [...data.works];
    const roomIds = [...data.rooms].sort((a, b) => a.order - b.order).map((r) => r.id);
    const roomIndex = (id: string): number => Math.max(0, roomIds.indexOf(id));
    for (let k = 2; k <= dupParam; k++) {
      for (const w of baseWorks) {
        const room = roomIds.length > 0
          ? roomIds[(roomIndex(w.room) + (k - 1)) % roomIds.length]
          : w.room;
        data.works.push({ ...w, id: `${w.id}-${k}`, room, order: w.order + (k - 1) * 100 });
      }
    }
  }
  // Itération D — variantes images : la texture 3D (ensureTexture lit work.image)
  // passe en WebP si le navigateur le supporte, sinon on garde le JPEG existant.
  // 1ère œuvre en ~1200w (clampée sans upscale), les autres en 800w pour ne jamais
  // augmenter le poids servi.
  const webpOk = webpSupported();
  data.works.forEach((w) => {
    // Les masters du projet plafonnent à 1080 px : servir du 800 px pour 29 œuvres sur 30
    // agrandissait la toile de 1,9× dans le cadre (c'était l'élément le plus flou de
    // l'image). On prend donc la plus grande variante disponible — sauf sur petit écran,
    // où 30 textures de 1080² coûteraient 140 Mo de VRAM pour des toiles de 200 px.
    const smallScreen = window.matchMedia('(pointer: coarse)').matches
      || Math.min(window.innerWidth, window.innerHeight) < 640;
    const targetW = smallScreen ? 800 : 1080;
    const u = webpOk ? pickUrl(w, 'webp', targetW) : pickUrl(w, 'jpeg', targetW);
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
  const viewDist = touch ? 4.2 : 2.85;
  const layout = computeLayout(data, viewDist);
  // dpr 2 partout (y compris mobile) : c'est la densité de pixels qui lisse les lignes
  // droites (cadres, cimaise) quand on se rapproche d'une œuvre.
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  const shadows = !coarse;
  const { renderer, scene, camera, sun, spots, plants } = createScene(canvas, layout, pixelRatio, {
    shadows,
    coarse,
    artist: data.artist,
    tagline: data.tagline,
  });
  const entries = buildPaintings(scene, layout, shadows);
  const texAniso = 8;

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
    if (ui.endIsOpen()) return; // l'écran de fin laisse passer les clics (pointer-events:none)
    const zone = layout.rooms[zi];
    const first = zone ? layout.placed.find((p) => p.roomId === zone.id) : undefined;
    if (first) focusWork(first);
  };

  const minimap = new Minimap(document.getElementById('minimap') as HTMLElement, layout);

  let panelWork: PlacedWork | null = null;
  let panelTravelUntil = 0; // F1 : le panneau reste ouvert pendant le trajet caméra programmatique
  let loaded = 0;
  let entered = false;
  let toastDismissed = false;
  const startPose = layout.at(0);
  const nearEntries = entries.filter(
    (e) => Math.hypot(e.placed.viewX - startPose.x, e.placed.viewZ - startPose.z) < 22,
  );
  const total = Math.max(1, nearEntries.length);

  const clampIdx = (i: number): number => Math.min(Math.max(i, 0), layout.placed.length - 1);
  /**
   * Œuvre « courante ». En guidé, c'est celle dont le palier de parcours est le plus
   * proche : le long d'un tracé en U, la distance à vol d'oiseau désignerait la toile du
   * mur d'en face qu'on ne regarde pas. En visite libre, on reprend la distance réelle.
   */
  function currentIndex(): number {
    const ps = layout.placed;
    if (ps.length === 0) return 0;
    if (controls.mode === 'guided') {
      const u = controls.currentT();
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < ps.length; i++) {
        const d = Math.abs(ps[i].scrollT - u);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    }
    const pos = controls.currentPos();
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const d = Math.hypot(ps[i].viewX - pos.x, ps[i].viewZ - pos.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  let navTarget: number | null = null;
  /** Dernière œuvre visée explicitement (flèches, clic, salle) : évite de « sauter » la
   *  première œuvre quand on part du sas, où `currentIndex` renvoie déjà 0. */
  let focusedIdx: number | null = null;
  function step(dir: 1 | -1): void {
    const ps = layout.placed;
    // Depuis le sas, la caméra est *avant* la première œuvre : « suivante » doit donc
    // l'y emmener (l'ancien code partait de `currentIndex`, déjà égal à 0, et sautait la
    // première toile).
    const beforeFirst = ps.length > 0 && controls.currentT() < ps[0].scrollT - 0.004;
    const idx = navTarget ?? focusedIdx ?? (beforeFirst ? -1 : currentIndex());
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
    focusedIdx = targetIdx;
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
    focusedIdx = layout.placed.indexOf(p);
    if (controls.mode === 'guided' && Math.abs(controls.currentT() - p.scrollT) > 0.012) {
      panelTravelUntil = performance.now() + 5000; // le panneau reste ouvert pendant le trajet
    } else {
      panelTravelUntil = 0;
    }
    ui.openPanel(p);
    if (controls.mode === 'guided') controls.scrollToWork(p);
    else controls.focusOn(p);
  }

  /**
   * Saut au début d'une salle (barre « Salles », segment de la minimap, touche 1–9,
   * plaque de portail) : ferme les overlays, puis scroll/focus sur la 1ère œuvre
   * de la zone — jamais de traversée des 150 m du hall d'un bloc.
   */
  function goToZone(zi: number): void {
    const zone = layout.rooms[zi];
    if (!zone) return;
    // le sas n'a pas d'œuvre : « Entrée » ramène simplement en haut de page
    if (zone.lobby) {
      if (ui.lightboxIsOpen()) ui.closeLightbox();
      if (ui.indexIsOpen()) ui.closeIndex();
      controls.scrollToT(0);
      return;
    }
    const first = layout.placed.find((p) => p.roomId === zone.id);
    if (!first) return;
    focusedIdx = layout.placed.indexOf(first);
    if (ui.lightboxIsOpen()) ui.closeLightbox();
    if (ui.indexIsOpen()) ui.closeIndex();
    if (ui.panelIsOpen()) {
      ui.closePanel();
      panelWork = null;
    }
    if (controls.mode === 'guided') controls.scrollToWork(first);
    else controls.focusOn(first);
  }

  function progressT(): number {
    if (controls.mode === 'guided') {
      const spacerEl = document.getElementById('scroll-spacer');
      const max = spacerEl ? spacerEl.offsetHeight - window.innerHeight : 0;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    }
    const pos = controls.currentPos();
    return controls.tForPos(pos.x, pos.z);
  }

  const ui = initUI(
    {
      onPrev: () => nav(-1),
      onNext: () => nav(1),
      onFreeToggle: () => {
        const free = controls.mode === 'free';
        controls.setMode(free ? 'guided' : 'free');
        ui.setFreeLabel(!free);
        // La visite libre se lance depuis l'index : sans fermer l'index, rien ne semble
        // se passer et l'on ne devine pas les touches.
        if (!free) {
          if (ui.indexIsOpen()) ui.closeIndex();
          if (ui.panelIsOpen()) ui.closePanel();
          ui.toast('Visite libre : ZQSD ou glisser pour se déplacer · Échap pour revenir au parcours', 9000);
        } else {
          ui.toast('Retour au parcours guidé.', 4000);
        }
      },
      onEnter: () => {
        entered = true;
        ui.hideIntro();
        document.getElementById('app')?.classList.add('ready');
        ui.toast('Faites défiler pour avancer. Cliquez sur un tableau pour l’observer.', 8000);
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

  const groups: IndexGroup[] = layout.rooms
    .map((z) => ({
      name: z.name,
      works: layout.placed.filter((p) => p.roomId === z.id),
    }))
    .filter((g) => g.works.length > 0);
  ui.buildIndex(groups, base, (p) => focusWork(p));
  ui.buildRooms(layout.rooms.map((z) => ({ name: z.name })), (zi) => goToZone(zi));
  minimap.onZonePick = (zi) => goToZone(zi);

  if (!fine) {
    (document.getElementById('btn-free') as HTMLButtonElement).style.display = 'none';
  }

  controls.onPick = (p) => {
    if (ui.endIsOpen()) return; // écran de fin affiché : on ne rouvre pas de fiche par-dessus
    focusWork(p);
  };
  controls.onNext = () => nav(1);
  controls.onPrev = () => nav(-1);
  minimap.onPick = (p) => focusWork(p);
  // Clic « à côté » d'un tableau (desktop uniquement) → désélectionne la fiche ouverte.
  controls.onMiss = () => {
    if (!fine) return;
    if (ui.panelIsOpen()) {
      ui.closePanel();
      panelWork = null;
    }
  };

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
    // touches 1–9 : saut direct à la salle N
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const zi = Number(digit[1]) - 1;
      if (zi < layout.rooms.length) goToZone(zi);
      return;
    }
    if (ui.lightboxIsOpen()) {
      if (e.code === 'Equal' || e.code === 'NumpadAdd') ui.lbZoom(1);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') ui.lbZoom(-1);
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
  let hoverId: string | null = null;
  let hitZone = false;
  // Curseur custom « Voir » (desktop fine uniquement) : pastille qui suit la souris
  // et grossit au-dessus d'un tableau cliquable.
  const hintEl = document.getElementById('cursor-hint');
  let mouseClientX = window.innerWidth / 2;
  let mouseClientY = window.innerHeight / 2;
  let hintX = mouseClientX;
  let hintY = mouseClientY;
  let hintScale = 0.55;
  window.addEventListener('pointermove', (e) => {
    if (!fine) return;
    mouseClientX = e.clientX;
    mouseClientY = e.clientY;
    const rect = canvas.getBoundingClientRect();
    mouseNdc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverDirty = true;
  });

  // Chargement initial : uniquement le voisinage de l'entrée (le tick charge le reste en lazy)
  for (const e of nearEntries) {
    ensureTexture(e, base, texAniso, () => {
      loaded++;
      ui.setLoader(loaded / total, loaded >= total);
    });
  }

  // Post-processing (audit 3D §4.1) : AO → bloom → sortie ACES → SMAA → grain.
  // createPost() renvoie null si la cible HalfFloat n'existe pas (très vieux GPU) :
  // le rendu direct reste alors utilisé, sans dégradation fonctionnelle.
  const post: PostPipeline | null = createPost(renderer, scene, camera, { shadows, coarse });

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? Math.min(70, 56 / Math.sqrt(aspect)) : 52;
    camera.updateProjectionMatrix();
    minimap.relayout();
    post?.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  window.scrollTo(0, 0);

  let captionIdx = -1;
  let activeZoneIdx = -2;
  const clock = new THREE.Clock();
  let elapsed = 0;
  // Raycaster réutilisé pour le hover (champ unique) + BVH firstHitOnly (boundsTree sur les tableaux)
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  function tick(): void {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    controls.update(dt);
    // végétation : souffle de quelques millimètres (coupé si prefers-reduced-motion)
    plants.update(elapsed, controls.reduced);
    const cam = controls.currentPos();
    const pose = controls.currentPose();
    for (const e of entries) {
      const dz = Math.hypot(e.placed.viewX - cam.x, e.placed.viewZ - cam.z);
      // Entre 16 et 30 m, une œuvre n'était NI chargée NI libérée : elle restait un cadre
      // vide (25 toiles sur 30 dans une salle de 30 m). On charge donc **toute la salle**
      // et on libère une salle plus loin.
      const loadD = touch ? 34 : 75;
      const dropD = touch ? 50 : 110;
      if (dz < loadD) ensureTexture(e, base, texAniso);
      else if (dz > dropD) releaseTexture(e);
    }
    // overlay = tout ce qui couvre la scène et doit rendre le curseur natif (fiche, lightbox, index, fin)
    const overlayOpen = ui.panelIsOpen() || ui.lightboxIsOpen() || ui.indexIsOpen() || ui.endIsOpen();
    if (hoverDirty && mouseNdc && entered) {
      hoverDirty = false;
      ray.setFromCamera(mouseNdc, camera);
      const hits = ray.intersectObjects(controls.pickMeshes, false);
      const hitObj = hits[0]?.object;
      hoverId = (hitObj?.userData.workId as string | undefined) ?? null;
      hitZone = hitObj?.userData.zoneIndex !== undefined;
      setHovered(hoverId, entries);
      const clickable = hoverId !== null || hitZone;
      // au-dessus d'un tableau (sans overlay) : curseur natif masqué, remplacé par la pastille « Voir »
      canvas.style.cursor = hoverId && !overlayOpen ? 'none' : clickable ? 'pointer' : 'grab';
    }
    if (fine && hintEl) {
      hintX += (mouseClientX - hintX) * Math.min(1, dt * 14);
      hintY += (mouseClientY - hintY) * Math.min(1, dt * 14);
      const show = hoverId !== null && entered && !overlayOpen;
      hintScale += ((show ? 1 : 0.55) - hintScale) * Math.min(1, dt * 14);
      hintEl.style.transform = `translate(${hintX.toFixed(1)}px, ${hintY.toFixed(1)}px) scale(${hintScale.toFixed(3)})`;
      hintEl.classList.toggle('on', show);
      document.body.classList.toggle('cursor-view', show);
    }
    const idx = currentIndex();
    const cur = layout.placed[idx];

    // Pool de spots « tableau » : TableSpots (lights.ts) choisit les k œuvres les plus
    // proches, avec hystérésis et fondu de 350 ms — plus de téléport du pool.
    spots.hoverIndex = hoverId ? layout.placed.findIndex((q) => q.work.id === hoverId) : -1;
    spots.update(cam, layout.placed, dt);

    // fenêtre d'ombre du soleil : suit la caméra avec quantification 0,5 m (anti shadow
    // swimming, P1-2) via le helper de lights.ts
    if (shadows) updateSunShadow(sun, cam);

    if (cur && idx !== captionIdx && !ui.panelIsOpen()) {
      captionIdx = idx;
      ui.setCaption(cur.work.title, metaLine(cur.work));
    }
    const t = progressT();
    ui.setProgressBar(t);
    const end = layout.at(1);
    const showEndNow =
      controls.mode === 'guided' ? t > 0.985 : Math.hypot(cam.x - end.x, cam.z - end.z) < 2.6;
    if (entered) {
      if (showEndNow && ui.panelIsOpen()) {
        ui.closePanel();
        panelWork = null;
      }
      ui.showEnd(showEndNow);
    }
    // auto-fermeture du panneau seulement quand la caméra est arrivée (ou après le trajet)
    if (
      ui.panelIsOpen() &&
      panelWork &&
      controls.mode === 'guided' &&
      Math.abs(controls.currentT() - panelWork.scrollT) > 0.012 &&
      performance.now() > panelTravelUntil
    ) {
      ui.closePanel();
      panelWork = null;
    }
    if (panelWork && Math.abs(controls.currentT() - panelWork.scrollT) <= 0.012) panelTravelUntil = 0;
    minimap.update(cam, pose.yaw, cur?.work.id ?? null);
    // indicateur de salle (cartel + chip actif) — même logique de zone que minimap.update
    const zi = zoneAt(layout, cam.x, cam.z);
    if (zi !== activeZoneIdx) {
      activeZoneIdx = zi;
      const zone = layout.rooms[zi];
      ui.setActiveRoom(zi);
      // numérotation sur les salles d'accrochage : le sas s'appelle « Entrée », il n'est
      // pas « Salle 1 » (l'index dit 3 salles, le cartel doit dire la même chose)
      if (zone?.lobby) ui.setRoomLabel('Entrée');
      else {
        const ri = layout.rooms.slice(0, zi).filter((z) => !z.lobby).length;
        ui.setRoomLabel(
          `Salle ${ri + 1}/${Math.max(1, layout.rooms.filter((z) => !z.lobby).length)} · ${zone?.name ?? ''}`,
        );
      }
    }
    if (post) post.render(dt);
    else renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  (window as unknown as { __gallery: unknown }).__gallery = {
    renderer,
    scene,
    camera,
    layout,
    controls,
    perf: () => ({
      render: { ...renderer.info.render },
      memory: { ...renderer.info.memory },
      post: post ? { ...post.stats } : null,
    }),
    post,
  };
}

boot();
