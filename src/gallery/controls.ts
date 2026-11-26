import * as THREE from 'three';
import { Tween, Easing, Group } from '@tweenjs/tween.js';

import { HALL_WIDTH, WALL_Y, Z_START, type Layout, type PlacedWork } from './layout';

import { createPhysics, type PhysicsWorld } from './physics';

export type Mode = 'guided' | 'free';

/** Durée du trajet caméra « focus » en mode libre (ms) — easing Cubic.Out (voir focusOn). */
const FOCUS_DURATION_MS = 700;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const angDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** État animé par le tween de focus : position caméra (x, z) + angles. */
interface FocusState {
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
  onZonePick: ((zoneIndex: number) => void) | null = null;
  onNext: (() => void) | null = null;
  onPrev: (() => void) | null = null;
  onEscape: (() => void) | null = null;
  /** Clic/tap sur la scène sans toucher d'œuvre ni de plaque (ex. « à côté » d'un tableau). */
  onMiss: (() => void) | null = null;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly layout: Layout;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly pos: THREE.Vector3;
  private readonly lookVec = new THREE.Vector3(-HALL_WIDTH / 2, WALL_Y, Z_START - 4);
  private readonly raycaster = new THREE.Raycaster();
  private targetT = 0;
  private t = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number; dist: number } | null = null;
  private focusTween: Tween<FocusState> | null = null;
  // Groupe tween.js dédié (v25 : new Tween(obj) sans groupe n'est PAS ajouté au groupe global)
  private readonly tweenGroup = new Group();
  // Physique du mode libre (Rapier, chargement lazy au 1er setMode('free')) — null = fallback clamps
  private physics: PhysicsWorld | null = null;
  private physicsPromise: Promise<PhysicsWorld | null> | null = null;

  constructor(camera: THREE.PerspectiveCamera, layout: Layout, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.layout = layout;
    // Raycaster réutilisé (créé une seule fois) + BVH : ne garde que le 1er hit
    // (voir three-mesh-bvh dans paintings.ts, acceleratedRaycast).
    this.raycaster.firstHitOnly = true;

    this.pos = new THREE.Vector3(layout.pathX, 1.6, Z_START);
    const pts: THREE.Vector3[] = [new THREE.Vector3(layout.pathX, 1.6, Z_START + 1.2)];
    for (const p of layout.placed) {
      pts.push(new THREE.Vector3(layout.pathX, 1.6, p.viewZ));
    }
    pts.push(new THREE.Vector3(layout.pathX, 1.6, layout.zEnd + 1.2));
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
      this.drag = { x: e.clientX, y: e.clientY, dist: 0 };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.dist += Math.hypot(dx, dy);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.mode === 'free' && !this.focusTween) {
        this.yaw -= dx * 0.0032;
        this.pitch = clamp(this.pitch - dy * 0.0028, -0.55, 0.65);
      }
    });
    window.addEventListener('pointerup', (e) => {
      const start = this.drag;
      this.drag = null;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) {
        this.tap(e.clientX, e.clientY, canvas, start.dist);
      }
    });

    this.readScroll();
  }

  currentZ(): number {
    return this.pos.z;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    // tue tout tween de focus en cours (équivalent de l'ancien focusAnim = null)
    this.focusTween?.stop();
    this.focusTween = null;
    if (mode === 'free') {
      this.yaw = 0;
      this.pitch = 0;
      document.documentElement.style.overflow = 'hidden';
      this.camera.position.set(this.pos.x, 1.6, this.pos.z);
      // chargement lazy du chunk rapier au premier passage en mode libre
      void this.ensurePhysics();
    } else {
      document.documentElement.style.overflow = '';
      // resynchronise this.pos depuis la caméra (le mode guidé repart du point courant)
      this.pos.copy(this.camera.position);
      this.readScroll();
    }
  }

  /** Charge Rapier une seule fois (au 1er mode libre) ; en cas d'échec, physics reste null → clamps. */
  private async ensurePhysics(): Promise<void> {
    if (this.physics || this.physicsPromise) return;
    this.physicsPromise = createPhysics(this.layout);
    try {
      this.physics = await this.physicsPromise;
    } catch {
      this.physics = null;
    }
    // resynchronise la capsule sur la position caméra courante
    if (this.physics) this.physics.setPos(this.pos.x, this.pos.z);
  }

  focusOn(p: PlacedWork): void {
    const pos = this.camera.position;
    // en mode libre, téléporte aussi la capsule physique sur la cible du focus
    if (this.mode === 'free') this.physics?.setPos(p.viewX, p.viewZ);
    let targetYaw = Math.atan2(-(p.x - pos.x), -(p.z - pos.z));
    // chemin angulaire le plus court (comme l'ancien angLerp)
    targetYaw = this.yaw + angDiff(this.yaw, targetYaw);
    const target: FocusState = { x: p.viewX, z: p.viewZ, yaw: targetYaw, pitch: 0.03 };
    this.focusTween?.stop();
    if (this.reduced) {
      // prefers-reduced-motion : saut direct, aucune animation (duration 0)
      pos.x = target.x;
      pos.z = target.z;
      this.yaw = target.yaw;
      this.pitch = target.pitch;
      this.focusTween = null;
      return;
    }
    // En mode libre, si la cible est de l'autre côté du hall, passer par un waypoint
    // (pathX, p.z) : sinon le trajet en ligne droite traverse les portails/mobilier.
    const legs: FocusState[] =
      this.mode === 'free' && Math.abs(pos.x - p.viewX) > 2.5
        ? [{ x: this.layout.pathX, z: p.viewZ, yaw: 0, pitch: this.pitch }, target]
        : [target];
    let leg = 0;
    const startLeg = (): void => {
      const from: FocusState = { x: pos.x, z: pos.z, yaw: this.yaw, pitch: this.pitch };
      this.focusTween = new Tween(from, this.tweenGroup)
        .to(legs[leg], FOCUS_DURATION_MS)
        .easing(Easing.Cubic.Out)
        .onUpdate((s) => {
          pos.x = s.x;
          pos.z = s.z;
          this.yaw = s.yaw;
          this.pitch = s.pitch;
        })
        .onComplete(() => {
          leg++;
          if (leg < legs.length) startLeg();
          else this.focusTween = null;
        })
        .start();
    };
    startLeg();
  }

  scrollToWork(p: PlacedWork): void {
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    window.scrollTo({ top: p.scrollT * max, behavior: this.reduced ? 'auto' : 'smooth' });
  }

  update(dt: number): void {
    // Pilote les tweens du groupe dédié (Group.update() sans argument = now()) — appelé à
    // chaque frame depuis la boucle tick() de main.ts via controls.update(dt).
    this.tweenGroup.update();

    if (this.mode === 'guided') {
      if (this.reduced) this.t = this.targetT;
      else this.t += (this.targetT - this.t) * Math.min(1, dt * 7.5);
      this.curve.getPointAt(clamp(this.t, 0, 1), this.pos);
      // défense en profondeur : jamais derrière le mur du fond
      this.pos.z = Math.max(this.pos.z, this.layout.zEnd + 1);
      this.camera.position.copy(this.pos);
      const k = this.reduced ? 1 : Math.min(1, dt * 3);
      this.lookVec.lerp(this.lookTarget(), k);
      this.camera.lookAt(this.lookVec);
    } else {
      const pos = this.camera.position;
      if (!this.focusTween) {
        // mouvement clavier (WASD) uniquement hors trajet focus
        const speed = 3.4 * dt;
        const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const r = new THREE.Vector3(-f.z, 0, f.x);
        let dx = 0;
        let dz = 0;
        if (this.keys.has('KeyW')) { dx += f.x * speed; dz += f.z * speed; }
        if (this.keys.has('KeyS')) { dx -= f.x * speed; dz -= f.z * speed; }
        if (this.keys.has('KeyA')) { dx -= r.x * speed; dz -= r.z * speed; }
        if (this.keys.has('KeyD')) { dx += r.x * speed; dz += r.z * speed; }
        if (this.physics) {
          // character controller Rapier : collisions murs/bancs/portails/tableaux + glissement
          const np = this.physics.move(dx, dz);
          pos.x = np.x;
          pos.z = np.z;
        } else {
          // fallback (Rapier indisponible, ex. ?nophys=1) : clamps AABB manuels
          pos.x += dx;
          pos.z += dz;
        }
      }
      // clamp de secours, aligné sur les bornes physiques (mur intérieur ±(HALL_WIDTH/2-0.125),
      // capsule r=0.35, marge 0.02 → ±5.505) pour que fallback et physics aient les mêmes limites
      const xLimit = HALL_WIDTH / 2 - 0.5;
      pos.x = clamp(pos.x, -xLimit, xLimit);
      pos.z = clamp(pos.z, this.layout.zEnd + 1, Z_START + 1.6);
      pos.y = 1.6;
      this.pos.copy(pos);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
  }

  private lookTarget(): THREE.Vector3 {
    const ps = this.layout.placed;
    if (ps.length === 0) return new THREE.Vector3(0, WALL_Y, this.pos.z - 4);
    let best = ps[0];
    let bd = Infinity;
    for (const p of ps) {
      const d = Math.abs(p.z - this.pos.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return new THREE.Vector3(best.x, WALL_Y, best.z);
  }

  private readScroll(): void {
    if (this.mode !== 'guided') return;
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    this.targetT = clamp(window.scrollY / max, 0, 1);
  }

  private tap(cx: number, cy: number, canvas: HTMLCanvasElement, dragDist = 0): void {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    const obj = hits[0]?.object;
    const id = obj?.userData.workId as string | undefined;
    if (id) {
      const p = this.layout.placed.find((q) => q.work.id === id);
      if (p) this.onPick?.(p);
      return;
    }
    // plaque laiton d'un portail : saute à la 1ère œuvre de la salle suivante
    const zi = obj?.userData.zoneIndex as number | undefined;
    if (zi !== undefined) {
      this.onZonePick?.(zi);
      return;
    }
    // aucun hit : clic « à côté » → désélection éventuelle (deselect géré par main.ts).
    // Un micro-drag de visée en mode libre (> 3 px) ne doit pas déclencher le deselect.
    if (dragDist < 3) this.onMiss?.();
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
