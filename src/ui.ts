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
  // réserve la place avant le chargement (CLS=0) : ratio connu via works.json
  if (work.ratio > 0) img.style.aspectRatio = String(work.ratio);
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
  /** Ligne « Salle 2/5 · Marines & Bretagne » au-dessus du titre du cartel. */
  setRoomLabel(text: string): void;
  /** Barre des salles (haut droit) : construit un chip par salle. */
  buildRooms(rooms: { name: string; lobby?: boolean }[], onPick: (zoneIndex: number) => void): void;
  /** Salle active dans la barre (index −1 = aucune). */
  setActiveRoom(zoneIndex: number): void;
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
  endIsOpen(): boolean;
  setLoader(ratio: number, done: boolean): void;
  /** Base sans œuvre : message explicite, commandes retirées. */
  setEmpty(message: string): void;
  /** Fondu au papier, exécution de `during` sous le voile, retour. */
  veil(during: () => void): void;
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
  /** Élément qui avait le focus avant l'ouverture de la fiche (restitution à la fermeture). */
  let lastFocus: HTMLElement | null = null;

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
    setRoomLabel(text) {
      const el = $('cap-room');
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('empty', text === '');
    },
    buildRooms(rooms, onPick) {
      const bar = $('rooms-bar');
      bar.innerHTML = '';
      // Numérotation : 1…3 pour les salles d'accrochage, le sas n'est pas numéroté (il
      // affichait « 2 » quand le cartel annonçait « Salle 1/3 »).
      let n = 0;
      rooms.forEach((r, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'room-chip';
        if (r.lobby) b.classList.add('lobby');
        b.setAttribute('aria-label', r.lobby ? "Revenir à l'entrée" : `Aller à la salle ${r.name}`);
        const num = document.createElement('span');
        num.className = 'room-num';
        if (r.lobby) {
          // une maison, pas un chiffre : sur mobile les noms sont masqués et le sas
          // restait une pastille muette
          num.innerHTML =
            '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.4 5.6 6 1.6l4.6 4M2.6 5v5.4h6.8V5"/></svg>';
        } else {
          num.textContent = String(++n);
        }
        const name = document.createElement('span');
        name.className = 'room-name';
        name.textContent = r.name;
        b.appendChild(num);
        b.appendChild(name);
        b.addEventListener('click', () => onPick(i));
        bar.appendChild(b);
      });
    },
    setActiveRoom(zoneIndex) {
      const chips = $('rooms-bar').children;
      for (let i = 0; i < chips.length; i++) {
        chips[i].classList.toggle('active', i === zoneIndex);
      }
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
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      panel.classList.add('open');
      panel.removeAttribute('aria-hidden');
      panel.setAttribute('aria-modal', 'true');
      document.getElementById('app')?.classList.add('panel-open');
      // Le focus entre dans la fiche : au clavier, elle restait un panneau fantôme qu'on
      // tabulait sans jamais y être (les 6 contrôles étaient atteignables fiche fermée).
      ($('panel-close') as HTMLButtonElement).focus({ preventScroll: true });
    },
    closePanel() {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      panel.removeAttribute('aria-modal');
      document.getElementById('app')?.classList.remove('panel-open');
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
      lastFocus = null;
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
    endIsOpen: () => !endOverlay.classList.contains('hidden'),
    setLoader(ratio, done) {
      $('loader-fill').style.width = `${Math.round(ratio * 100)}%`;
      $('loader-text').textContent = done
        ? 'Prêt. Bonne visite.'
        : `Chargement de la galerie… ${Math.round(ratio * 100)} %`;
      ($('btn-enter') as HTMLButtonElement).disabled = !done;
    },
    veil(during) {
      const v = $('veil');
      v.classList.add('on');
      window.setTimeout(() => {
        during();
        window.setTimeout(() => v.classList.remove('on'), 140);
      }, 180);
    },
    setEmpty(message) {
      // Base sans œuvre publiée : sans ce garde-fou, la barre restait à « Chargement de la
      // galerie… » et le bouton « Entrer » demeurait `disabled` — un domaine mort sans un
      // mot d'explication. On retire aussi les commandes qui ne mènent nulle part.
      $('loader-fill').style.width = '100%';
      $('loader-text').textContent = message;
      const enter = $('btn-enter') as HTMLButtonElement;
      enter.disabled = true;
      enter.textContent = 'Galerie vide';
      $('rooms-bar').classList.add('hidden');
      $('cartel').classList.add('hidden');
      $('intro').classList.add('empty');
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
