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
  /** Trait + zone de clic par œuvre, pour recalculer leur longueur minimale. */
  private readonly stopGeom: { line: SVGLineElement; hit: SVGLineElement; p: PlacedWork }[] = [];

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

    // ---- parcours : supprimé du plan ----
    //
    // Le tracé était lisible tant que le parcours suivait les murs. Depuis qu'il recule
    // entre deux toiles d'un même mur, la polyligne entre et sort de chaque pièce en
    // zigzag : sur un plan de 96 px de haut, elle dessinait une pelote de traits qui
    // masquait les murs et les toiles. Un plan de musée ne montre pas le chemin — il
    // montre les pièces, les œuvres et où l'on est.

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

        // Zone de clic : 2 px de trait ne se visent pas au doigt. Une réplique transparente
        // de 3 unités (≈ 14 px à l'échelle du plan) porte le clic et le survol.
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', t.getAttribute('x1')!);
        hit.setAttribute('y1', t.getAttribute('y1')!);
        hit.setAttribute('x2', t.getAttribute('x2')!);
        hit.setAttribute('y2', t.getAttribute('y2')!);
        hit.setAttribute('class', 'mm-hit');
        hit.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPick?.(p);
        });
        svg.appendChild(hit);
        this.stopGeom.push({ line: t, hit, p });
      }
    });

    // ---- curseur caméra : un point + un cap ----
    const cam = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cam.setAttribute('class', 'mm-cam');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '0.42');
    cam.appendChild(dot);
    // Le cône de vision a été retiré : sur un plan de 96 px de haut, il dessinait une
    // flèche plus grosse que la pièce où l'on se trouve et brouillait la lecture des
    // murs. Il reste un point, qui suffit à situer la caméra.
    svg.appendChild(cam);
    this.camMark = cam;

    root.appendChild(svg);
  }

  /**
   * Longueur minimale d'un trait de toile, en unités du monde.
   *
   * À 96 px de haut pour 29 m, une aquarelle de 1,5 m ne fait que 5 px : à l'écran, une
   * poussière. On impose 9 px et on prolonge le trait symétriquement autour du centre de
   * la toile — la position reste juste, c'est la longueur qui ment un peu.
   */
  relayout(): void {
    const box = this.svg.getBBox();
    const px = this.svg.getBoundingClientRect().height;
    if (px <= 0 || box.height <= 0) return;
    const minLen = 9 / (px / box.height);
    for (const g of this.stopGeom) {
      const w = Math.max(g.p.w, minLen);
      const tx = -g.p.nz;
      const tz = g.p.nx;
      const x1 = g.p.x - (tx * w) / 2;
      const z1 = g.p.z - (tz * w) / 2;
      const x2 = g.p.x + (tx * w) / 2;
      const z2 = g.p.z + (tz * w) / 2;
      for (const el of [g.line, g.hit]) {
        el.setAttribute('x1', String(x1));
        el.setAttribute('y1', String(z1));
        el.setAttribute('x2', String(x2));
        el.setAttribute('y2', String(z2));
      }
    }
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
