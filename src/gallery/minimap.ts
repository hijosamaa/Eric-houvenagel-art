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
    ctx.fillStyle = 'rgba(250,247,242,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const x0 = this.mapX(-HALL_WIDTH / 2);
    const x1 = this.mapX(HALL_WIDTH / 2);
    const yTop = this.mapZ(zMax);
    const yBot = this.mapZ(zMin);
    ctx.strokeStyle = '#c9c2b4';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
    ctx.strokeStyle = '#e3dccd';
    ctx.lineWidth = 1;
    for (const zone of this.layout.zones) {
      const y = this.mapZ(zone.zMax);
      ctx.beginPath();
      ctx.moveTo(6, y);
      ctx.lineTo(canvas.width - 6, y);
      ctx.stroke();
    }
    for (const p of this.layout.placed) {
      const x = this.mapX(p.x);
      const y = this.mapZ(p.z);
      const active = p.work.id === currentId;
      ctx.fillStyle = active ? '#33566e' : '#8a8378';
      ctx.beginPath();
      ctx.arc(x, y, active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
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
