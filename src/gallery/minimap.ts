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
    const h = this.canvas.height - 20;
    return 12 + ((zMax - z) / (zMax - zMin)) * h;
  }

  private mapX(x: number): number {
    const w = this.canvas.width - 20;
    return 10 + ((x + HALL_WIDTH / 2) / HALL_WIDTH) * w;
  }

  draw(camZ: number, currentId: string | null, timeMs: number): void {
    const { ctx, canvas } = this;
    const { zMin, zMax } = hallBounds(this.layout);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let band = 0;
    for (const zone of this.layout.zones) {
      const yTop = this.mapZ(zone.zMax);
      const yBot = this.mapZ(zone.zMin);
      ctx.fillStyle = band % 2 === 0 ? 'rgba(51, 86, 110, 0.05)' : 'rgba(51, 86, 110, 0.1)';
      ctx.fillRect(6, yTop, canvas.width - 12, yBot - yTop);
      ctx.fillStyle = '#6f6a60';
      ctx.font = '600 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(zone.name.toUpperCase(), 9, yTop + 8, canvas.width - 18);
      band++;
    }

    const x0 = this.mapX(-HALL_WIDTH / 2);
    const x1 = this.mapX(HALL_WIDTH / 2);
    ctx.strokeStyle = '#b9b1a1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, this.mapZ(zMax), x1 - x0, this.mapZ(zMin) - this.mapZ(zMax));

    ctx.fillStyle = '#8a8378';
    ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.fillText('ENTRÉE', 8, this.mapZ(zMax) - 2);

    this.layout.placed.forEach((p, i) => {
      const x = this.mapX(p.x);
      const y = this.mapZ(p.z);
      const active = p.work.id === currentId;
      ctx.beginPath();
      ctx.arc(x, y, active ? 7 : 6, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#33566e' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = active ? '#33566e' : '#8a8378';
      ctx.stroke();
      ctx.fillStyle = active ? '#ffffff' : '#6f6a60';
      ctx.font = '600 8.5px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5);
    });

    const cy = this.mapZ(camZ);
    const cx = this.mapX(0);
    const pulse = 7 + 2 * Math.sin(timeMs / 350);
    ctx.beginPath();
    ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(51, 86, 110, 0.18)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx - 5.5, cy + 4);
    ctx.lineTo(cx + 5.5, cy + 4);
    ctx.closePath();
    ctx.fillStyle = '#33566e';
    ctx.fill();
  }

  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: PlacedWork | null = null;
    let bestD = 16;
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
