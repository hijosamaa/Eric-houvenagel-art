import type { PlacedWork } from './gallery/layout';

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
  setProgress(cur: number, total: number, room: string): void;
  setProgressBar(t: number): void;
  flashRoom(name: string): void;
  toast(msg: string, ms?: number): void;
  hideToast(): void;
  buildDots(n: number, onPick: (i: number) => void): void;
  setActiveDot(i: number): void;
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
  closeLightbox(): void;
  lightboxIsOpen(): boolean;
  showEnd(v: boolean): void;
  setLoader(ratio: number, done: boolean): void;
  hideIntro(): void;
  setFreeLabel(active: boolean): void;
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
  let roomTimer: number | undefined;
  let toastTimer: number | undefined;
  let works: PlacedWork[] = [];
  let lbId: string | null = null;
  let zoom = 1;

  $('btn-prev').addEventListener('click', cb.onPrev);
  $('btn-next').addEventListener('click', cb.onNext);
  $('btn-free').addEventListener('click', cb.onFreeToggle);
  $('btn-enter').addEventListener('click', cb.onEnter);
  $('btn-index').addEventListener('click', () => {
    indexOverlay.classList.contains('hidden') ? indexOverlay.classList.remove('hidden') : indexOverlay.classList.add('hidden');
  });
  $('index-close').addEventListener('click', () => indexOverlay.classList.add('hidden'));
  $('panel-close').addEventListener('click', () => {
    panel.classList.remove('open');
    cb.onClosePanel();
  });
  $('panel-prev').addEventListener('click', cb.onPrev);
  $('panel-next').addEventListener('click', cb.onNext);
  $('panel-zoom').addEventListener('click', cb.onZoom);
  $('lb-close').addEventListener('click', () => lightbox.classList.add('hidden'));
  $('lb-prev').addEventListener('click', cb.onPrev);
  $('lb-next').addEventListener('click', cb.onNext);
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

  function showLightbox(p: PlacedWork): void {
    lbId = p.work.id;
    zoom = 1;
    lbImg.style.transform = 'scale(1)';
    lbImg.style.cursor = 'zoom-in';
    lbImg.src = baseUrl + p.work.image;
    lbImg.alt = p.work.title;
    $('lb-title').textContent = p.work.title;
    const bits = [p.work.year > 0 ? String(p.work.year) : null, p.work.medium, p.work.dimensions || null]
      .filter(Boolean)
      .join(' · ');
    $('lb-meta').textContent = bits;
    lightbox.classList.remove('hidden');
  }

  return {
    setProgress(cur, total, room) {
      $('p-cur').textContent = String(cur);
      $('p-total').textContent = String(total);
      $('p-room').textContent = room ? `— ${room}` : '';
    },
    setProgressBar(t) {
      $('progress-fill').style.width = `${Math.round(t * 100)}%`;
    },
    flashRoom(name) {
      const b = $('room-banner');
      b.textContent = name;
      b.classList.add('show');
      window.clearTimeout(roomTimer);
      roomTimer = window.setTimeout(() => b.classList.remove('show'), 2400);
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
    buildDots(n, onPick) {
      const box = $('dots');
      box.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const b = document.createElement('button');
        b.className = 'dot';
        b.textContent = String(i + 1);
        b.setAttribute('aria-label', `Aller à l'œuvre ${i + 1}`);
        b.addEventListener('click', () => onPick(i));
        box.appendChild(b);
      }
    },
    setActiveDot(i) {
      const dots = $('dots').children;
      for (let k = 0; k < dots.length; k++) {
        dots[k].classList.toggle('active', k === i);
      }
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
          const img = document.createElement('img');
          img.src = base + p.work.image;
          img.alt = p.work.title;
          img.loading = 'lazy';
          const t = document.createElement('span');
          t.className = 'index-card-title';
          t.textContent = p.work.title;
          const m = document.createElement('span');
          m.className = 'index-card-meta';
          m.textContent = [p.work.year > 0 ? String(p.work.year) : null, p.work.medium].filter(Boolean).join(' · ');
          card.appendChild(img);
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
      img.src = baseUrl + p.work.image;
      img.alt = p.work.title;
      $('panel-title').textContent = p.work.title;
      const bits = [p.work.year > 0 ? String(p.work.year) : null, p.work.medium, p.work.dimensions || null]
        .filter(Boolean)
        .join(' · ');
      $('panel-meta').textContent = bits;
      $('panel-desc').textContent = p.work.description;
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
    closeLightbox() {
      lightbox.classList.add('hidden');
      lbId = null;
    },
    lightboxIsOpen: () => !lightbox.classList.contains('hidden'),
    showEnd(v) {
      endOverlay.classList.toggle('hidden', !v);
    },
    setLoader(ratio, done) {
      $('loader-fill').style.width = `${Math.round(ratio * 100)}%`;
      $('loader-text').textContent = done ? 'Prêt — bonne visite' : `Chargement de la galerie… ${Math.round(ratio * 100)} %`;
      ($('btn-enter') as HTMLButtonElement).disabled = !done;
    },
    hideIntro() {
      intro.style.opacity = '0';
      window.setTimeout(() => intro.classList.add('hidden'), 460);
    },
    setFreeLabel(active) {
      $('btn-free').textContent = active ? 'Visite guidée' : 'Explorer librement';
    },
  };
}
