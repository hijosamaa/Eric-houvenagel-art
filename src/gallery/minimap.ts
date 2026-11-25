import { hallBounds, type Layout, type PlacedWork } from './layout';

export class Minimap {
  onPick: ((p: PlacedWork) => void) | null = null;

  private readonly layout: Layout;
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly roomLabel: HTMLElement;
  private readonly stops = new Map<string, HTMLButtonElement>();

  constructor(root: HTMLElement, layout: Layout) {
    this.layout = layout;

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

    const { zMin, zMax } = hallBounds(layout);
    const span = zMax - zMin;
    layout.placed.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'mm-stop';
      b.type = 'button';
      b.textContent = String(i + 1);
      b.title = p.work.title;
      b.setAttribute('aria-label', `Œuvre ${i + 1} : ${p.work.title}`);
      b.style.top = `${((zMax - p.z) / span) * 100}%`;
      b.addEventListener('click', () => this.onPick?.(p));
      this.track.appendChild(b);
      this.stops.set(p.work.id, b);
    });

    root.appendChild(head);
    root.appendChild(this.roomLabel);
    root.appendChild(this.track);
  }

  update(camZ: number, currentId: string | null): void {
    const { zMin, zMax } = hallBounds(this.layout);
    const t = Math.min(1, Math.max(0, (zMax - camZ) / (zMax - zMin)));
    this.fill.style.height = `${t * 100}%`;
    for (const [id, el] of this.stops) {
      el.classList.toggle('active', id === currentId);
    }
    const zone = this.layout.zones.find((z) => camZ <= z.zMax + 1.2 && camZ >= z.zMin - 1.2);
    this.roomLabel.textContent = zone ? zone.name : '';
  }
}
