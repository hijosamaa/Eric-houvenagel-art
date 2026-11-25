import * as THREE from 'three';
import { HALL_WIDTH, WALL_Y, Z_START, type Layout, type PlacedWork } from './layout';

export type Mode = 'guided' | 'free';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const angDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const angLerp = (a: number, b: number, t: number): number => a + angDiff(a, b) * t;

interface FocusAnim {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export class GalleryControls {
  mode: Mode = 'guided';
  reduced = false;
  pickMeshes: THREE.Object3D[] = [];
  onPick: ((p: PlacedWork) => void) | null = null;
  onNext: (() => void) | null = null;
  onPrev: (() => void) | null = null;
  onEscape: (() => void) | null = null;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly layout: Layout;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly pos = new THREE.Vector3(0, 1.6, Z_START);
  private readonly lookVec = new THREE.Vector3(0, WALL_Y, Z_START - 4);
  private targetT = 0;
  private t = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number } | null = null;
  private focusAnim: FocusAnim | null = null;

  constructor(camera: THREE.PerspectiveCamera, layout: Layout, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.layout = layout;

    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 1.6, Z_START + 1.2)];
    for (const p of layout.placed) {
      pts.push(new THREE.Vector3(p.viewX * 0.55, 1.6, p.viewZ));
    }
    pts.push(new THREE.Vector3(0, 1.6, layout.zEnd + 1.2));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6);

    const N = 240;
    for (const p of layout.placed) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < N; i++) {
        const tt = i / (N - 1);
        const d = Math.abs(this.curve.getPointAt(tt).z - p.viewZ);
        if (d < bd) {
          bd = d;
          best = tt;
        }
      }
      p.scrollT = best;
    }

    window.addEventListener('scroll', () => this.readScroll(), { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      if (this.mode === 'free' && !this.focusAnim) {
        this.yaw -= dx * 0.0032;
        this.pitch = clamp(this.pitch - dy * 0.0028, -0.55, 0.65);
      }
    });
    window.addEventListener('pointerup', (e) => {
      const start = this.drag;
      this.drag = null;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) {
        this.tap(e.clientX, e.clientY, canvas);
      }
    });

    this.readScroll();
  }

  currentZ(): number {
    return this.pos.z;
  }

  currentT(): number {
    return this.t;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.focusAnim = null;
    if (mode === 'free') {
      this.yaw = 0;
      this.pitch = 0;
      document.documentElement.style.overflow = 'hidden';
      this.camera.position.set(this.pos.x, 1.6, this.pos.z);
    } else {
      document.documentElement.style.overflow = '';
      this.readScroll();
    }
  }

  focusOn(p: PlacedWork): void {
    const pos = this.camera.position;
    this.focusAnim = {
      x: p.viewX,
      z: p.viewZ,
      yaw: Math.atan2(-(p.x - pos.x), -(p.z - pos.z)),
      pitch: 0.03,
    };
  }

  scrollToWork(p: PlacedWork): void {
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    window.scrollTo({ top: p.scrollT * max, behavior: this.reduced ? 'auto' : 'smooth' });
  }

  update(dt: number): void {
    if (this.mode === 'guided') {
      if (this.reduced) this.t = this.targetT;
      else this.t += (this.targetT - this.t) * Math.min(1, dt * 6);
      this.curve.getPointAt(clamp(this.t, 0, 1), this.pos);
      this.camera.position.copy(this.pos);
      const idx = this.currentIndex();
      const p = this.layout.placed[idx];
      const target = p ? new THREE.Vector3(p.x, WALL_Y, p.z) : new THREE.Vector3(0, WALL_Y, this.pos.z - 4);
      const k = this.reduced ? 1 : Math.min(1, dt * 2.6);
      this.lookVec.lerp(target, k);
      this.camera.lookAt(this.lookVec);
    } else {
      const pos = this.camera.position;
      if (this.focusAnim) {
        const a = this.focusAnim;
        if (this.reduced) {
          pos.x = a.x;
          pos.z = a.z;
          this.yaw = a.yaw;
          this.pitch = a.pitch;
          this.focusAnim = null;
        } else {
          pos.x += (a.x - pos.x) * Math.min(1, dt * 5);
          pos.z += (a.z - pos.z) * Math.min(1, dt * 5);
          this.yaw = angLerp(this.yaw, a.yaw, Math.min(1, dt * 5));
          this.pitch += (a.pitch - this.pitch) * Math.min(1, dt * 5);
          if (Math.hypot(a.x - pos.x, a.z - pos.z) < 0.04 && Math.abs(angDiff(this.yaw, a.yaw)) < 0.02) {
            this.focusAnim = null;
          }
        }
      } else {
        const speed = 3.4 * dt;
        const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const r = new THREE.Vector3(-f.z, 0, f.x);
        if (this.keys.has('KeyW')) pos.addScaledVector(f, speed);
        if (this.keys.has('KeyS')) pos.addScaledVector(f, -speed);
        if (this.keys.has('KeyA')) pos.addScaledVector(r, -speed);
        if (this.keys.has('KeyD')) pos.addScaledVector(r, speed);
      }
      pos.x = clamp(pos.x, -(HALL_WIDTH / 2 - 0.8), HALL_WIDTH / 2 - 0.8);
      pos.z = clamp(pos.z, this.layout.zEnd + 1, Z_START + 1.6);
      pos.y = 1.6;
      this.pos.copy(pos);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
  }

  private currentIndex(): number {
    const ps = this.layout.placed;
    if (ps.length === 0) return 0;
    let passed = 0;
    for (const p of ps) if (p.z > this.pos.z) passed++;
    return Math.min(passed, ps.length - 1);
  }

  private readScroll(): void {
    if (this.mode !== 'guided') return;
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    this.targetT = clamp(window.scrollY / max, 0, 1);
  }

  private tap(cx: number, cy: number, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.pickMeshes, false);
    const id = hits[0]?.object.userData.workId as string | undefined;
    if (!id) return;
    const p = this.layout.placed.find((q) => q.work.id === id);
    if (p) this.onPick?.(p);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      this.onEscape?.();
      return;
    }
    if (this.mode === 'free') {
      this.keys.add(e.code);
      return;
    }
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'PageDown' || e.code === 'Space') {
      e.preventDefault();
      this.onNext?.();
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'PageUp') {
      e.preventDefault();
      this.onPrev?.();
    }
  }
}
