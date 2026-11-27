import { hallBounds, type Layout, type PlacedWork } from './layout';

/**
 * Le rail — plan du hall, sans carte (v4).
 *
 * La carte flottante de la v3 a disparu : le plan est devenu une graduation de
 * 1 px posée sur la ligne du cartel. Ce qui reste, et qui suffit :
 * - une graduation par œuvre, cliquable (cible de 15 px, chevauchement borné) ;
 * - un segment par salle (.mm-seg) ;
 * - le nom de la salle courante, posé à l'aplomb de sa zone et qui glisse avec la caméra ;
 * - un curseur de caméra (.mm-cam).
 * La géométrie est calculée à partir de hallBounds() : le rail couvre tout le hall,
 * les œuvres n'en occupent qu'une fraction centrale.
 */
export class Minimap {
  onPick: ((p: PlacedWork) => void) | null = null;
  /** Clic sur le segment d'une salle → saut au début de la salle. */
  onZonePick: ((zoneIndex: number) => void) | null = null;

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

    this.roomLabel = document.createElement('div');
    this.roomLabel.className = 'mm-room';
    this.track = document.createElement('div');
    this.track.className = 'mm-track';
    this.fill = document.createElement('div');
    this.fill.className = 'mm-fill';
    this.track.appendChild(this.fill);

    // segments de salles — cliquables : saut au début de la salle
    layout.zones.forEach((z, zi) => {
      const seg = document.createElement('div');
      seg.className = 'mm-seg';
      const p0 = ((zMax - z.zMax) / this.span) * 100;
      const p1 = ((zMax - z.zMin) / this.span) * 100;
      seg.style.setProperty('--z0', `${p0}%`);
      seg.style.setProperty('--z1', `${p1}%`);
      seg.title = `Aller à « ${z.name} »`;
      seg.setAttribute('role', 'button');
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onZonePick?.(zi);
      });
      this.track.appendChild(seg);
    });

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

    root.appendChild(this.roomLabel);
    root.appendChild(this.track);

    if (window.matchMedia('(pointer: coarse)').matches) root.classList.add('touch');
    this.relayout();
  }

  /**
   * Le rail n'a plus de dimension adaptative : il prend la largeur que lui donne
   * la grille du cartel. relayout() ne sert plus qu'à mesurer la place disponible
   * pour resserrer la cible de clic quand les œuvres sont nombreuses (?dup=N).
   */
  relayout(): void {
    const n = this.layout.placed.length;
    const width = this.root.getBoundingClientRect().width || 1;
    // écart horizontal entre deux graduations, en px
    const gap = n > 1 ? width / (n - 1) : width;
    this.dense = gap < 18;
    this.root.classList.toggle('dense', this.dense);
  }

  update(camZ: number, currentId: string | null): void {
    const t = Math.min(1, Math.max(0, (this.zMax - camZ) / this.span));
    this.track.style.setProperty('--fill', `${t * 100}%`);
    this.camMark.style.setProperty('--p', `${t * 100}%`);
    for (const [id, el] of this.stops) {
      el.classList.toggle('active', id === currentId);
    }
    const zone = this.layout.zones.find((z) => camZ <= z.zMax + 1.2 && camZ >= z.zMin - 1.2);
    const name = zone ? zone.name : '';
    if (this.roomLabel.textContent !== name) this.roomLabel.textContent = name;
    if (zone) {
      // à l'aplomb du début de la zone, borné pour ne jamais sortir du rail
      const p = Math.min(96, Math.max(0, ((this.zMax - zone.zMax) / this.span) * 100));
      this.roomLabel.style.setProperty('--p', `${p}%`);
    }
  }
}
