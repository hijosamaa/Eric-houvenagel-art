import { zoneAt, type Layout, type PlacedWork } from './layout';

/**
 * Mini-plan de la galerie — **un vrai plan**, à l'échelle.
 *
 * L'ancienne version était un rail d'une graduation par œuvre sur une ligne : lisible
 * quand le lieu était un couloir de 90 m, absurde dès qu'il devient un bâtiment. Ici les
 * quatre pièces sont des rectangles à l'échelle (40 × 27 m), les toiles sont des traits
 * posés **sur leur mur**, le parcours guidé est tracé en pointillé et la caméra a une
 * flèche qui montre où elle regarde. On comprend le lieu d'un coup d'œil, et chaque
 * pièce se clique pour s'y rendre.
 *
 * Le rendu est un SVG dans un `viewBox` en mètres : aucune conversion px ne dépend d'une
 * mesure du DOM, donc rien ne se désaligne au redimensionnement.
 */

const PAD = 0.6; // marge autour du bâti (m)

export class Minimap {
  onPick: ((p: PlacedWork) => void) | null = null;
  /** Clic sur une salle → saut à sa première œuvre. */
  onZonePick: ((zoneIndex: number) => void) | null = null;

  private readonly layout: Layout;
  private readonly svg: SVGSVGElement;
  private readonly camMark: SVGGElement;
  private readonly roomRects: SVGRectElement[] = [];
  private readonly stops = new Map<string, SVGElement>();

  constructor(root: HTMLElement, layout: Layout) {
    this.layout = layout;
    root.classList.add('plan');
    root.textContent = '';

    const B = layout.bounds;
    const w = B.x1 - B.x0 + PAD * 2;
    const h = B.z1 - B.z0 + PAD * 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${B.x0 - PAD} ${B.z0 - PAD} ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'mm-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Plan de la galerie');
    this.svg = svg;

    // ---- parcours guidé (pointillé fin, sous les salles) ----
    const route = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    route.setAttribute('points', layout.path.map((n) => `${n.x},${n.z}`).join(' '));
    route.setAttribute('class', 'mm-route');
    svg.appendChild(route);

    // ---- salles ----
    layout.rooms.forEach((room, zi) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mm-room');
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(room.rect.x0));
      rect.setAttribute('y', String(room.rect.z0));
      rect.setAttribute('width', String(room.rect.x1 - room.rect.x0));
      rect.setAttribute('height', String(room.rect.z1 - room.rect.z0));
      if (room.lobby) rect.classList.add('lobby');
      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onZonePick?.(zi);
      });
      g.appendChild(rect);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = room.lobby ? 'Entrée' : `Aller à « ${room.name} »`;
      g.appendChild(title);

      // numéro de salle : le nom complet vit dans la légende, ici on ne met que l'ordre
      if (!room.lobby) {
        const n = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const idx = layout.rooms.slice(0, zi).filter((r) => !r.lobby).length;
        n.textContent = String(idx + 1);
        n.setAttribute('x', String((room.rect.x0 + room.rect.x1) / 2));
        n.setAttribute('y', String((room.rect.z0 + room.rect.z1) / 2 + 1.1));
        n.setAttribute('class', 'mm-num');
        g.appendChild(n);
      }
      svg.appendChild(g);
      this.roomRects.push(rect);

      // ---- toiles : un trait sur le mur où elles sont accrochées ----
      for (const p of layout.placed) {
        if (p.roomId !== room.id) continue;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        // la toile est plaquée contre son mur : le trait suit sa largeur
        const tx = -p.nz;
        const tz = p.nx;
        t.setAttribute('x1', String(p.x - (tx * p.w) / 2));
        t.setAttribute('y1', String(p.z - (tz * p.w) / 2));
        t.setAttribute('x2', String(p.x + (tx * p.w) / 2));
        t.setAttribute('y2', String(p.z + (tz * p.w) / 2));
        t.setAttribute('class', 'mm-stop');
        t.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPick?.(p);
        });
        const ti = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        ti.textContent = `${p.work.title} — ${p.roomName}`;
        t.appendChild(ti);
        svg.appendChild(t);
        this.stops.set(p.work.id, t);
      }
    });

    // ---- curseur caméra : un point + un cap ----
    const cam = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cam.setAttribute('class', 'mm-cam');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '0.55');
    cam.appendChild(dot);
    const cone = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    cone.setAttribute('d', 'M 0 -0.7 L 2.2 -3.1 A 3.6 3.6 0 0 0 -2.2 -3.1 Z');
    cone.setAttribute('class', 'mm-cone');
    cam.appendChild(cone);
    svg.appendChild(cam);
    this.camMark = cam;

    root.appendChild(svg);
  }

  /** Plus rien à mesurer : le plan est en unités du monde. Conservé pour l'API de main.ts. */
  relayout(): void {
    /* no-op */
  }

  update(pos: { x: number; z: number }, yaw: number, currentId: string | null): void {
    this.camMark.setAttribute(
      'transform',
      `translate(${pos.x.toFixed(2)} ${pos.z.toFixed(2)}) rotate(${((-yaw * 180) / Math.PI).toFixed(1)})`,
    );
    for (const [id, el] of this.stops) el.classList.toggle('active', id === currentId);
    const zi = zoneAt(this.layout, pos.x, pos.z);
    this.roomRects.forEach((r, i) => r.classList.toggle('active', i === zi));
    this.svg.dataset.room = String(zi);
  }
}
