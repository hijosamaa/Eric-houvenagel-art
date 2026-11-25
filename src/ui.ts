import type { PlacedWork } from './gallery/layout';

export interface UICallbacks {
  onPrev: () => void;
  onNext: () => void;
  onFreeToggle: () => void;
  onEnter: () => void;
  onClosePanel: () => void;
  onZoom: () => void;
}

export interface UI {
  setProgress(cur: number, total: number, room: string): void;
  flashRoom(name: string): void;
  openPanel(p: PlacedWork): void;
  closePanel(): void;
  panelIsOpen(): boolean;
  openLightbox(p: PlacedWork, baseUrl: string): void;
  closeLightbox(): void;
  lightboxIsOpen(): boolean;
  setLoader(ratio: number, done: boolean): void;
  hideIntro(): void;
  setFreeLabel(active: boolean): void;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} introuvable`);
  return el as T;
};

export function initUI(cb: UICallbacks): UI {
  const panel = $('panel');
  const lightbox = $('lightbox');
  let roomTimer: number | undefined;

  $('btn-prev').addEventListener('click', cb.onPrev);
  $('btn-next').addEventListener('click', cb.onNext);
  $('btn-free').addEventListener('click', cb.onFreeToggle);
  $('btn-enter').addEventListener('click', cb.onEnter);
  $('panel-close').addEventListener('click', () => {
    panel.classList.remove('open');
    cb.onClosePanel();
  });
  $('panel-zoom').addEventListener('click', cb.onZoom);
  lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));

  return {
    setProgress(cur, total, room) {
      $('p-cur').textContent = String(cur);
      $('p-total').textContent = String(total);
      $('p-room').textContent = room ? `— ${room}` : '';
    },
    flashRoom(name) {
      const b = $('room-banner');
      b.textContent = name;
      b.classList.add('show');
      window.clearTimeout(roomTimer);
      roomTimer = window.setTimeout(() => b.classList.remove('show'), 2200);
    },
    openPanel(p) {
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
    openLightbox(p, baseUrl) {
      const img = $('lightbox-img') as HTMLImageElement;
      img.src = baseUrl + p.work.image;
      img.alt = p.work.title;
      lightbox.classList.remove('hidden');
    },
    closeLightbox() {
      lightbox.classList.add('hidden');
    },
    lightboxIsOpen: () => !lightbox.classList.contains('hidden'),
    setLoader(ratio, done) {
      $('loader-fill').style.width = `${Math.round(ratio * 100)}%`;
      $('loader-text').textContent = done ? 'Prêt' : `Chargement… ${Math.round(ratio * 100)} %`;
      ($('btn-enter') as HTMLButtonElement).disabled = !done;
    },
    hideIntro() {
      $('intro').classList.add('hidden');
    },
    setFreeLabel(active) {
      $('btn-free').textContent = active ? 'Visite guidée' : 'Explorer librement';
    },
  };
}
