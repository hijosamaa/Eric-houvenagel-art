import { zoneAt, type Layout, type PlacedWork } from './layout';

/**
 * Mini-plan de la galerie.
 *
 * Remplace le « rail » de 1 px (une graduation par œuvre sur une ligne) par un **plan** :
 * les salles sont des boîtes accolées, à l'échelle de leur longueur réelle, séparées par
 * les murs de seuil, nommées, et la salle courante est teintée. Les œuvres restent des
 * graduations (cliquables) et un curseur montre la caméra.
 *
 * Un plan se lit d'un coup d'œil là où un rail demande d'avoir compris le code de la
 * graduation — et avec 30 œuvres réparties en quatre volumes, c'est le plan qui donne
 * l'échelle du lieu.
 */
export class Minimap {
  onPick: ((p: PlacedWork) => void) | null = null;
  /** Clic sur une salle → saut à son début. */
  onZonePick: ((zoneIndex: number) => void) | null = null;

  private readonly layout: Layout;
  private readonly root: HTMLElement;
  private readonly plan: HTMLElement;
  private readonly camMark: HTMLElement;
  private readonly fills: HTMLElement[] = [];
  private readonly roomBoxes: HTMLElement[] = [];
  private readonly stops = new Map<string, HTMLButtonElement>();
  private readonly span: number;
  private readonly zMax: number;

  constructor(root: HTMLElement, layout: Layout) {
    this.layout = layout;
    this.root = root;
    root.classList.add('plan');
    root.textContent = '';

    const { zMin, zMax } = { zMin: layout.zBack, zMax: layout.zFront };
    this.zMax = zMax;
    this.span = Math.max(0.001, zMax - zMin);

    this.plan = document.createElement('div');
    this.plan.className = 'mm-plan';

    // --- salles (boîtes) ---
    // Les largeurs sont **normalisées sur la somme réelle** des zones, pas sur la portée
    // totale : les zones se touchent (elles se partagent la frontière du seuil), donc
    // `(z1−z0)/span` les faisait plus larges que le plan et la dernière sortait de la
    // colonne — elle recouvrait alors les boutons précédent/suivant.
    const lengths = layout.zones.map((z) => Math.max(0.001, z.zMax - z.zMin));
    const total = lengths.reduce((a, b) => a + b, 0);
    let cursor = 0;
    layout.zones.forEach((zone, zi) => {
      const z0 = Math.max(zone.zMin, zMin);
      const z1 = Math.min(zone.zMax, zMax);
      if (z1 - z0 <= 0.05) return;
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'mm-room';
      if (zone.lobby) box.classList.add('lobby');
      const w = (lengths[zi] / total) * 100;
      box.style.setProperty('--l', `${cursor}%`);
      box.style.setProperty('--w', `${w}%`);
      cursor += w;
      box.title = zone.lobby ? 'Entrée' : `Aller à « ${zone.name} »`;
      box.setAttribute('aria-label', zone.lobby ? 'Entrée' : `Aller à la salle ${zone.name}`);
      const fill = document.createElement('span');
      fill.className = 'mm-room-fill';
      box.appendChild(fill);
      this.fills.push(fill);
      // le sas n'affiche pas de nom : sa boîte fait 2 m sur 88, le libellé serait tronqué
      if (!zone.lobby) {
        const name = document.createElement('span');
        name.className = 'mm-room-name';
        name.textContent = zone.name;
        box.appendChild(name);
      }
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onZonePick?.(zi);
      });
      this.plan.appendChild(box);
      this.roomBoxes.push(box);

      // graduations des œuvres de cette salle
      for (const p of layout.placed) {
        if (p.z > z1 || p.z < z0) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mm-stop';
        b.title = `${p.work.title} — ${p.roomName}`;
        b.setAttribute('aria-label', `Œuvre : ${p.work.title}`);
        b.style.setProperty('--p', `${((zMax - p.z) / this.span) * 100}%`);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPick?.(p);
        });
        this.plan.appendChild(b);
        this.stops.set(p.work.id, b);
      }
    });

    // --- curseur caméra ---
    this.camMark = document.createElement('div');
    this.camMark.className = 'mm-cam';
    this.plan.appendChild(this.camMark);

    this.root.appendChild(this.plan);

    // clic sur le fond du plan → œuvre la plus proche
    this.plan.addEventListener('click', (e) => {
      const rect = this.plan.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const targetZ = zMax - f * this.span;
      let best: PlacedWork | null = null;
      let bd = Infinity;
      for (const p of this.layout.placed) {
        const d = Math.abs(p.z - targetZ);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) this.onPick?.(best);
    });
  }

  /** Plus rien à mesurer : le plan est en pourcentages. Conservé pour l'API de main.ts. */
  relayout(): void {
    /* no-op */
  }

  update(camZ: number, currentId: string | null): void {
    const t = Math.min(1, Math.max(0, (this.zMax - camZ) / this.span));
    this.camMark.style.setProperty('--p', `${t * 100}%`);
    for (const [id, el] of this.stops) el.classList.toggle('active', id === currentId);

    // remplissage progressif de la salle courante
    const zi = zoneAt(this.layout, camZ);
    this.roomBoxes.forEach((box, i) => {
      const zone = this.layout.zones[i];
      box.classList.toggle('active', i === zi);
      const fill = this.fills[i];
      if (!fill) return;
      const z0 = Math.min(zone.zMin, zone.zMax);
      const z1 = Math.max(zone.zMin, zone.zMax);
      const len = Math.max(0.001, z1 - z0);
      const p = i === zi ? Math.min(1, Math.max(0, (z1 - camZ) / len)) : i < zi ? 1 : 0;
      fill.style.setProperty('--fill', `${p * 100}%`);
    });
  }
}
