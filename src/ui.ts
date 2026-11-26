import type { PlacedWork } from './gallery/layout';
import type { Work } from './types';

// ---------- Itération D : images responsives (WebP/AVIF + srcset + LQIP) ----------

export type ImgFormat = 'avif' | 'webp' | 'jpeg';

/** Détection canvas : le navigateur sait-il encoder/décoder ce mime ? */
export function detectFormat(mime: string): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL(mime).startsWith(`data:${mime}`);
  } catch {
    return false;
  }
}

export function webpSupported(): boolean {
  return detectFormat('image/webp');
}

let preferredCache: ImgFormat | null = null;
/** Format servi dans le srcset du DOM : AVIF > WebP > JPEG. */
export function preferredFormat(): ImgFormat {
  if (preferredCache) return preferredCache;
  preferredCache = detectFormat('image/avif') ? 'avif' : detectFormat('image/webp') ? 'webp' : 'jpeg';
  return preferredCache;
}

/** srcset "N w" pour un format donné, toutes largeurs disponibles. */
export function srcsetFor(work: Work, format: ImgFormat): string {
  return (work.images ?? [])
    .filter((i) => i[format])
    .map((i) => `${i[format]} ${i.width}w`)
    .join(', ');
}

/** URL du meilleur candidat ≤ maxWidth pour un format (le plus grand sinon). */
export function pickUrl(work: Work, format: ImgFormat, maxWidth = Infinity): string {
  const all = (work.images ?? []).filter((i) => i[format]);
  const cands = all.filter((i) => i.width <= maxWidth);
  const pool = cands.length > 0 ? cands : all;
  return pool.length > 0 ? pool[pool.length - 1][format] : '';
}

/** JPEG de secours pour l'attribut `src` (800w de préférence). */
export function fallbackSrc(work: Work): string {
  const imgs = work.images ?? [];
  return imgs.find((i) => i.jpeg && i.width === 800)?.jpeg ?? imgs.find((i) => i.jpeg)?.jpeg ?? work.image ?? work.imageFull;
}

/** Pose srcset/sizes (format préféré) + LQIP en fond pendant le chargement. */
export function setResponsiveImg(img: HTMLImageElement, work: Work, base: string, sizes: string): void {
  img.sizes = sizes;
  const ss = srcsetFor(work, preferredFormat());
  if (ss) img.srcset = ss;
  img.src = base + fallbackSrc(work);
  if (work.lqip) {
    img.style.backgroundImage = `url("${work.lqip}")`;
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';
    img.style.backgroundRepeat = 'no-repeat';
    img.addEventListener(
      'load',
      () => {
        img.style.backgroundImage = '';
        img.style.backgroundSize = '';
        img.style.backgroundPosition = '';
        img.style.backgroundRepeat = '';
      },
      { once: true },
    );
  }
}
// -------------------------------------------------------------------------------

export interface IndexGroup {
  name: string;
  works: PlacedWork[];
}

export interface UICallbacks {
  onPrev: () => void;
  onNext: () => void;
  onFreeToggle: () => void;
  onEnter: () => void;
  onClosePanel: () => void;
  onZoom: () => void;
  onEndRestart: () => void;
  onEndIndex: () => void;
}

export interface UI {
  /** Légende du cartel : titre de l'œuvre courante + méta en une ligne. */
  setCaption(title: string, meta: string): void;
  setProgressBar(t: number): void;
  toast(msg: string, ms?: number): void;
  hideToast(): void;
  setWorks(works: PlacedWork[]): void;
  buildIndex(groups: IndexGroup[], baseUrl: string, onPick: (p: PlacedWork) => void): void;
  openIndex(): void;
  closeIndex(): void;
  indexIsOpen(): boolean;
  openPanel(p: PlacedWork): void;
  closePanel(): void;
  panelIsOpen(): boolean;
  openLightbox(p: PlacedWork): void;
  lbNav(dir: 1 | -1): PlacedWork | null;
  lbZoom(dir: 1 | -1): void;
  closeLightbox(): void;
  lightboxIsOpen(): boolean;
  showEnd(v: boolean): void;
  setLoader(ratio: number, done: boolean): void;
  hideIntro(): void;
  setFreeLabel(active: boolean): void;
}

/** Une ligne de méta factuelle : « 2026, Acrylique sur bois, 80 x 80 cm ». */
export function metaLine(w: Work): string {
  return [w.year > 0 ? String(w.year) : null, w.medium || null, w.dimensions || null]
    .filter(Boolean)
    .join(', ');
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} introuvable`);
  return el as T;
};

export function initUI(cb: UICallbacks, baseUrl: string): UI {
  const panel = $('panel');
  const lightbox = $('lightbox');
  const lbImg = $('lightbox-img') as HTMLImageElement;
  const intro = $('intro');
  const indexOverlay = $('index-overlay');
  const endOverlay = $('end');
  let toastTimer: number | undefined;
  let works: PlacedWork[] = [];
  let lbId: string | null = null;
  let zoom = 1;

  $('btn-prev').addEventListener('click', cb.onPrev);
  $('btn-next').addEventListener('click', cb.onNext);
  $('btn-free').addEventListener('click', cb.onFreeToggle);
  $('btn-enter').addEventListener('click', cb.onEnter);
  $('btn-index').addEventListener('click', () => {
    if (indexOverlay.classList.contains('hidden')) {
      indexOverlay.classList.remove('hidden');
      panel.classList.remove('open');
    } else {
      indexOverlay.classList.add('hidden');
    }
  });
  $('index-close').addEventListener('click', () => indexOverlay.classList.add('hidden'));
  $('panel-close').addEventListener('click', () => {
    panel.classList.remove('open');
    cb.onClosePanel();
  });
  $('panel-prev').addEventListener('click', cb.onPrev);
  $('panel-next').addEventListener('click', cb.onNext);
  $('panel-zoom').addEventListener('click', cb.onZoom);
  $('panel-index').addEventListener('click', () => {
    panel.classList.remove('open');
    cb.onClosePanel();
    indexOverlay.classList.remove('hidden');
  });
  $('panel-back').addEventListener('click', () => {
    panel.classList.remove('open');
    cb.onClosePanel();
  });
  ($('panel-img') as HTMLImageElement).addEventListener('click', cb.onZoom);
  $('lb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    lightbox.classList.add('hidden');
  });
  $('lb-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    cb.onPrev();
  });
  $('lb-next').addEventListener('click', (e) => {
    e.stopPropagation();
    cb.onNext();
  });
  lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));
  $('end-restart').addEventListener('click', cb.onEndRestart);
  $('end-index').addEventListener('click', cb.onEndIndex);

  lightbox.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = Math.min(3, Math.max(1, zoom - e.deltaY * 0.0012));
      lbImg.style.transform = `scale(${zoom})`;
      lbImg.style.cursor = zoom > 1 ? 'zoom-out' : 'zoom-in';
    },
    { passive: false },
  );
  lbImg.addEventListener('click', (e) => {
    e.stopPropagation();
    if (zoom > 1) {
      zoom = 1;
      lbImg.style.transform = 'scale(1)';
      lbImg.style.cursor = 'zoom-in';
    }
  });

  let touchX = 0;
  let touchY = 0;
  lightbox.addEventListener(
    'touchstart',
    (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    },
    { passive: true },
  );
  lightbox.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) cb.onNext();
        else cb.onPrev();
      }
    },
    { passive: true },
  );

  function applyZoom(): void {
    lbImg.style.transform = `scale(${zoom})`;
    lbImg.style.cursor = zoom > 1 ? 'zoom-out' : 'zoom-in';
  }

  function showLightbox(p: PlacedWork): void {
    lbId = p.work.id;
    zoom = 1;
    applyZoom();
    setResponsiveImg(lbImg, p.work, baseUrl, '92vw');
    lbImg.alt = p.work.title;
    $('lb-title').textContent = p.work.title;
    $('lb-meta').textContent = metaLine(p.work);
    lightbox.classList.remove('hidden');
    ($('lb-close') as HTMLButtonElement).focus();
  }

  return {
    setCaption(title, meta) {
      const t = $('cap-title');
      const m = $('cap-meta');
      if (t.textContent !== title) t.textContent = title;
      if (m.textContent !== meta) m.textContent = meta;
    },
    setProgressBar(t) {
      $('progress-fill').style.width = `${Math.round(t * 100)}%`;
    },
    toast(msg, ms = 6000) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
    },
    hideToast() {
      window.clearTimeout(toastTimer);
      $('toast').classList.remove('show');
    },
    setWorks(w) {
      works = w;
    },
    buildIndex(groups, base, onPick) {
      const body = $('index-body');
      body.innerHTML = '';
      for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'index-room';
        const h = document.createElement('h3');
        h.textContent = group.name;
        section.appendChild(h);
        const grid = document.createElement('div');
        grid.className = 'index-grid';
        for (const p of group.works) {
          const card = document.createElement('button');
          card.className = 'index-card';
          card.type = 'button';
          const frame = document.createElement('span');
          frame.className = 'index-card-frame';
          const img = document.createElement('img');
          setResponsiveImg(img, p.work, base, '(max-width: 640px) 42vw, 260px');
          img.alt = p.work.title;
          img.loading = 'lazy';
          img.decoding = 'async';
          frame.appendChild(img);
          const t = document.createElement('span');
          t.className = 'index-card-title';
          t.textContent = p.work.title;
          const m = document.createElement('span');
          m.className = 'index-card-meta';
          m.textContent = metaLine(p.work);
          card.appendChild(frame);
          card.appendChild(t);
          card.appendChild(m);
          card.addEventListener('click', () => {
            indexOverlay.classList.add('hidden');
            onPick(p);
          });
          grid.appendChild(card);
        }
        section.appendChild(grid);
        body.appendChild(section);
      }
    },
    openIndex() {
      indexOverlay.classList.remove('hidden');
    },
    closeIndex() {
      indexOverlay.classList.add('hidden');
    },
    indexIsOpen: () => !indexOverlay.classList.contains('hidden'),
    openPanel(p) {
      const img = $('panel-img') as HTMLImageElement;
      setResponsiveImg(img, p.work, baseUrl, '(max-width: 720px) 88vw, 380px');
      img.alt = p.work.title;
      $('panel-title').textContent = p.work.title;
      $('m-year').textContent = p.work.year > 0 ? String(p.work.year) : '—';
      $('m-medium').textContent = p.work.medium || '—';
      $('m-dims').textContent = p.work.dimensions || '—';
      $('m-room').textContent = p.roomName;
      $('panel-desc').textContent = p.work.description;
      $('cap-title').textContent = p.work.title;
      $('cap-meta').textContent = metaLine(p.work);
      panel.scrollTop = 0;
      panel.classList.add('open');
    },
    closePanel() {
      panel.classList.remove('open');
    },
    panelIsOpen: () => panel.classList.contains('open'),
    openLightbox(p) {
      showLightbox(p);
    },
    lbNav(dir) {
      if (lbId === null || works.length === 0) return null;
      const idx = works.findIndex((w) => w.work.id === lbId);
      if (idx === -1) return null;
      const next = works[(idx + dir + works.length) % works.length];
      showLightbox(next);
      return next;
    },
    lbZoom(dir) {
      zoom = Math.min(3, Math.max(1, zoom + dir * 0.5));
      applyZoom();
    },
    closeLightbox() {
      lightbox.classList.add('hidden');
      lbId = null;
    },
    lightboxIsOpen: () => !lightbox.classList.contains('hidden'),
    showEnd(v) {
      endOverlay.classList.toggle('hidden', !v);
      const thumb = $('end-thumb') as HTMLImageElement;
      if (v && works.length > 0) {
        const last = works[works.length - 1].work;
        if (thumb.dataset.workId !== last.id) {
          thumb.dataset.workId = last.id;
          setResponsiveImg(thumb, last, baseUrl, '(max-width: 640px) 128px, 168px');
          thumb.alt = last.title;
        }
      }
    },
    setLoader(ratio, done) {
      $('loader-fill').style.width = `${Math.round(ratio * 100)}%`;
      $('loader-text').textContent = done
        ? 'Prêt. Bonne visite.'
        : `Chargement de la galerie… ${Math.round(ratio * 100)} %`;
      ($('btn-enter') as HTMLButtonElement).disabled = !done;
    },
    hideIntro() {
      intro.style.opacity = '0';
      window.setTimeout(() => intro.classList.add('hidden'), 460);
    },
    setFreeLabel(active) {
      $('btn-free').textContent = active ? 'Visite guidée' : 'Explorer librement';
      document.body.classList.toggle('free', active);
    },
  };
}
