import { HALL_WIDTH, hallBounds, type Layout, type PlacedWork } from './layout';

export class Minimap {
  onPick: ((p: PlacedWork) => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout: Layout;

  constructor(canvas: HTMLCanvasElement, layout: Layout) {
    this.canvas = canvas;
    this.layout = layout;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexte 2D indisponible');
    this.ctx = ctx;
    canvas.addEventListener('click', (e) => this.onClick(e));
  }

  private mapZ(z: number): number {
    const { zMin, zMax } = hallBounds(this.layout);
    const h = this.canvas.height - 16;
    return 8 + ((zMax - z) / (zMax - zMin)) * h;
  }

  private mapX(x: number): number {
    const w = this.canvas.width - 16;
    return 8 + ((x + HALL_WIDTH / 2) / HALL_WIDTH) * w;
  }

  draw(camZ: number, currentId: string | null): void {
    const { ctx, canvas } = this;
    const { zMin, zMax } = hallBounds(this.layout);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(250,247,242,0.92)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let band = 0;
    for (const zone of this.layout.zones) {
      const yTop = this.mapZ(zone.zMax);
      const yBot = this.mapZ(zone.zMin);
      ctx.fillStyle = band % 2 === 0 ? 'rgba(51, 86, 110, 0.06)' : 'rgba(51, 86, 110, 0.11)';
      ctx.fillRect(4, yTop, canvas.width - 8, yBot - yTop);
      ctx.fillStyle = '#8a8378';
      ctx.font = '8px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(zone.name, 6, yTop + 9, canvas.width - 12);
      band++;
    }

    const x0 = this.mapX(-HALL_WIDTH / 2);
    const x1 = this.mapX(HALL_WIDTH / 2);
    ctx.strokeStyle = '#c9c2b4';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, this.mapZ(zMax), x1 - x0, this.mapZ(zMin) - this.mapZ(zMax));

    ctx.fillStyle = '#6f6a60';
    ctx.font = '8px Inter, system-ui, sans-serif';
    ctx.fillText('Entrée', 6, this.mapZ(zMax) - 4 + 8);

    for (const p of this.layout.placed) {
      const x = this.mapX(p.x);
      const y = this.mapZ(p.z);
      const active = p.work.id === currentId;
      ctx.fillStyle = active ? '#33566e' : '#8a8378';
      ctx.beginPath();
      ctx.arc(x, y, active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = '#33566e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const cy = this.mapZ(camZ);
    const cx = this.mapX(0);
    ctx.fillStyle = '#33566e';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx - 5, cy + 4);
    ctx.lineTo(cx + 5, cy + 4);
    ctx.closePath();
    ctx.fill();
  }

  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: PlacedWork | null = null;
    let bestD = 14;
    for (const p of this.layout.placed) {
      const d = Math.hypot(this.mapX(p.x) - mx, this.mapZ(p.z) - my);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.onPick?.(best);
  }
}
