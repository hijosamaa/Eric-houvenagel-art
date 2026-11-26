import { hallBounds, type Layout, type PlacedWork } from './layout';

/**
 * Minimap v3 — robuste en grand nombre d'œuvres (?dup=N) :
 * - piste à taille adaptative (hauteur dynamique desktop, largeur mobile),
 * - stops de taille adaptative (--sz), numéros masqués en mode dense (classe .mini),
 * - segments de salles (.mm-seg), marqueur caméra (.mm-cam), butées début/fin (.mm-cap),
 * - mode tactile dense : les stops deviennent non-cliquables et un clic sur la piste
 *   choisit l'œuvre la plus proche (plus de tap ambigu).
 */
export class Minimap {
  onPick: ((p: PlacedWork) => void) | null = null;

  private readonly layout: Layout;
  private readonly root: HTMLElement;
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly roomLabel: HTMLElement;
  private readonly camMark: HTMLElement;
  private readonly stops = new Map<string, HTMLButtonElement>();
  private readonly stopList: { el: HTMLButtonElement; p: PlacedWork; pct: number }[] = [];
  private readonly span: number;
  private readonly zMax: number;
  private dense = false;

  constructor(root: HTMLElement, layout: Layout) {
    this.layout = layout;
    this.root = root;
    const { zMin, zMax } = hallBounds(layout);
    this.zMax = zMax;
    this.span = zMax - zMin;

    const head = document.createElement('div');
    head.className = 'mm-head';
    head.textContent = 'Plan';
    this.roomLabel = document.createElement('div');
    this.roomLabel.className = 'mm-room';
    this.track = document.createElement('div');
    this.track.className = 'mm-track';
    this.fill = document.createElement('div');
    this.fill.className = 'mm-fill';
    this.track.appendChild(this.fill);

    // segments de salles
    for (const z of layout.zones) {
      const seg = document.createElement('div');
      seg.className = 'mm-seg';
      const p0 = ((zMax - z.zMax) / this.span) * 100;
      const p1 = ((zMax - z.zMin) / this.span) * 100;
      seg.style.setProperty('--z0', `${p0}%`);
      seg.style.setProperty('--z1', `${p1}%`);
      seg.title = z.name;
      this.track.appendChild(seg);
    }

    // stops
    layout.placed.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'mm-stop';
      b.type = 'button';
      b.title = `${i + 1} — ${p.work.title} (${p.roomName})`;
      b.setAttribute('aria-label', `Œuvre ${i + 1} : ${p.work.title}`);
      const pct = ((zMax - p.z) / this.span) * 100;
      b.style.setProperty('--p', `${pct}%`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick?.(p);
      });
      this.track.appendChild(b);
      this.stops.set(p.work.id, b);
      this.stopList.push({ el: b, p, pct });
    });

    // marqueur caméra + butées
    this.camMark = document.createElement('div');
    this.camMark.className = 'mm-cam';
    this.track.appendChild(this.camMark);
    const capA = document.createElement('div');
    capA.className = 'mm-cap start';
    const capB = document.createElement('div');
    capB.className = 'mm-cap end';
    this.track.appendChild(capA);
    this.track.appendChild(capB);

    // clic piste → œuvre la plus proche (utile en dense tactile)
    this.track.addEventListener('click', (e) => {
      const rect = this.track.getBoundingClientRect();
      const horizontal = rect.width > rect.height;
      const f = horizontal
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      const target = Math.min(100, Math.max(0, f * 100));
      let best: PlacedWork | null = null;
      let bd = Infinity;
      for (const s of this.stopList) {
        const d = Math.abs(s.pct - target);
        if (d < bd) {
          bd = d;
          best = s.p;
        }
      }
      if (best) this.onPick?.(best);
    });

    root.appendChild(head);
    root.appendChild(this.roomLabel);
    root.appendChild(this.track);

    if (window.matchMedia('(pointer: coarse)').matches) root.classList.add('touch');
    this.relayout();
  }

  /** Recalcule la taille de la piste et des stops selon la place disponible et N. */
  relayout(): void {
    const n = this.layout.placed.length;
    const horizontal = window.innerWidth <= 640;
    // fraction du hall réellement occupée par les œuvres (les marges de hallBounds ne comptent pas)
    const zs = this.layout.placed.map((p) => p.z);
    const workSpan = Math.max(1, Math.max(...zs) - Math.min(...zs));
    const fraction = Math.min(1, workSpan / this.span);
    let trackLen: number;
    if (horizontal) {
      trackLen = Math.min(window.innerWidth * 0.7, 320);
      this.track.style.width = `${Math.round(trackLen)}px`;
      this.track.style.height = '';
    } else {
      // assez haut pour viser un écart de 28 px entre stops quand c'est possible
      // (28 = 24 px de stop + marge pour le scale 1.25 du stop actif)
      trackLen = Math.min(460, Math.max(180, ((n - 1) * 28) / fraction));
      this.track.style.height = `${Math.round(trackLen)}px`;
      this.track.style.width = '';
    }
    const gap = n > 1 ? (trackLen * fraction) / (n - 1) : trackLen;
    const stopSize = Math.max(8, Math.min(24, Math.round(gap - 2)));
    const showNum = stopSize >= 14 && gap >= 20;
    this.dense = n > 1 && gap < 26;
    this.track.classList.toggle('dense', this.dense);
    this.root.classList.toggle('dense', this.dense);
    // scale du stop actif plafonné pour ne jamais chevaucher ses voisins
    const activeScale = n > 1 ? Math.min(1.25, (gap / stopSize) * 0.98) : 1.25;
    this.track.style.setProperty('--as', activeScale.toFixed(3));
    this.stopList.forEach((s, i) => {
      s.el.style.setProperty('--sz', `${stopSize}px`);
      s.el.classList.toggle('mini', !showNum);
      s.el.textContent = showNum ? String(i + 1) : '';
    });
  }

  update(camZ: number, currentId: string | null): void {
    const t = Math.min(1, Math.max(0, (this.zMax - camZ) / this.span));
    this.track.style.setProperty('--fill', `${t * 100}%`);
    this.camMark.style.setProperty('--p', `${t * 100}%`);
    for (const [id, el] of this.stops) {
      el.classList.toggle('active', id === currentId);
    }
    const zone = this.layout.zones.find((z) => camZ <= z.zMax + 1.2 && camZ >= z.zMin - 1.2);
    this.roomLabel.textContent = zone ? zone.name : '';
  }
}
