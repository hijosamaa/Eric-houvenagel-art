import * as THREE from 'three';
import { HALL_WIDTH, WALL_Y, Z_START, type Layout, type PlacedWork } from './layout';

export type Mode = 'guided' | 'free';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export class GalleryControls {
  mode: Mode = 'guided';
  pickMeshes: THREE.Object3D[] = [];
  onPick: ((p: PlacedWork) => void) | null = null;
  onNext: (() => void) | null = null;
  onPrev: (() => void) | null = null;
  onEscape: (() => void) | null = null;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly layout: Layout;
  private targetZ = Z_START;
  private camZ = Z_START;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera, layout: Layout, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.layout = layout;

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
      if (this.mode === 'free') {
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
    return this.mode === 'guided' ? this.camZ : this.camera.position.z;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === 'free') {
      this.yaw = 0;
      this.pitch = 0;
      document.documentElement.style.overflow = 'hidden';
      this.camera.position.set(this.camera.position.x, 1.6, this.camZ);
    } else {
      document.documentElement.style.overflow = '';
      this.readScroll();
    }
  }

  scrollToWork(p: PlacedWork): void {
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    window.scrollTo({ top: p.scrollT * max, behavior: 'smooth' });
  }

  update(dt: number): void {
    if (this.mode === 'guided') {
      this.camZ += (this.targetZ - this.camZ) * Math.min(1, dt * 7);
      this.camera.position.set(0, 1.6, this.camZ);
      const t = this.lookTarget();
      this.camera.lookAt(t.x, t.y, t.z);
    } else {
      const speed = 3.4 * dt;
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const pos = this.camera.position;
      if (this.keys.has('KeyW')) pos.addScaledVector(f, speed);
      if (this.keys.has('KeyS')) pos.addScaledVector(f, -speed);
      if (this.keys.has('KeyA')) pos.addScaledVector(r, -speed);
      if (this.keys.has('KeyD')) pos.addScaledVector(r, speed);
      pos.x = clamp(pos.x, -(HALL_WIDTH / 2 - 0.8), HALL_WIDTH / 2 - 0.8);
      pos.z = clamp(pos.z, this.layout.zEnd + 1, Z_START + 1.6);
      pos.y = 1.6;
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
  }

  private readScroll(): void {
    if (this.mode !== 'guided') return;
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    const t = clamp(window.scrollY / max, 0, 1);
    this.targetZ = Z_START + (this.layout.zEnd - Z_START) * t;
  }

  private lookTarget(): THREE.Vector3 {
    const ps = this.layout.placed;
    const ahead = 2.4;
    if (ps.length === 0) return new THREE.Vector3(0, WALL_Y, this.camZ - 5);
    if (this.camZ >= ps[0].z) return new THREE.Vector3(ps[0].x, WALL_Y, ps[0].z - ahead * 0.4);
    const last = ps[ps.length - 1];
    if (this.camZ <= last.z) return new THREE.Vector3(last.x, WALL_Y, last.z);
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i];
      const b = ps[i + 1];
      if (this.camZ <= a.z && this.camZ >= b.z) {
        const t = (a.z - this.camZ) / (a.z - b.z);
        return new THREE.Vector3(a.x + (b.x - a.x) * t, WALL_Y, this.camZ - ahead);
      }
    }
    return new THREE.Vector3(0, WALL_Y, this.camZ - ahead);
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
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'PageDown') this.onNext?.();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'PageUp') this.onPrev?.();
  }
}
