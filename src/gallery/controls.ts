import * as THREE from 'three';
import { Tween, Easing, Group } from '@tweenjs/tween.js';

import { EYE_Y, WALL_T, createDwellCurve, type Layout, type PlacedWork, type Room } from './layout';

import { createPhysics, type PhysicsWorld } from './physics';

export type Mode = 'guided' | 'free';

/** Durée du trajet caméra « focus » en mode libre (ms) — easing Cubic.Out (voir focusOn). */
const FOCUS_DURATION_MS = 700;
/** Rayon de sécurité du fallback AABB (capsule 0,35 m + marge). */
const BODY_R = 0.36;

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

export interface CameraPose {
  x: number;
  z: number;
  yaw: number;
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
  /** Courbe de « dwell » : arrêts devant chaque œuvre. Repli linéaire si `reduced`. */
  private readonly dwell: (t: number) => number;
  private readonly pos: THREE.Vector3;
  private readonly raycaster = new THREE.Raycaster();
  private targetT = 0;
  private t = 0;
  /** Cap effectivement appliqué (le tracé donne la consigne, la caméra la rejoint). */
  private viewYaw = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number; ox: number; oy: number; dist: number } | null = null;
  private focusTween: Tween<FocusState> | null = null;
  // Groupe tween.js dédié (v25 : new Tween(obj) sans groupe n'est PAS ajouté au groupe global)
  private readonly tweenGroup = new Group();
  // Physique du mode libre (Rapier, chargement lazy au 1er setMode('free')) — null = fallback
  private physics: PhysicsWorld | null = null;
  private physicsPromise: Promise<PhysicsWorld | null> | null = null;

  constructor(camera: THREE.PerspectiveCamera, layout: Layout, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.layout = layout;
    // Raycaster réutilisé (créé une seule fois) + BVH : ne garde que le 1er hit
    this.raycaster.firstHitOnly = true;

    const start = layout.at(0);
    this.pos = new THREE.Vector3(start.x, EYE_Y, start.z);
    this.viewYaw = start.yaw;
    this.dwell = createDwellCurve(layout.placed.map((p) => p.scrollT));

    window.addEventListener('scroll', () => this.readScroll(), { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Origine **immuable** du geste : l'ancienne version réécrivait `drag.x/y` à chaque
    // `pointermove`, donc la distance testée au relâchement était toujours ~0 et un
    // glissement de 70 px ouvrait la fiche du tableau survolé.
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, dist: 0 };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.dist = Math.hypot(e.clientX - this.drag.ox, e.clientY - this.drag.oy);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.mode === 'free' && !this.focusTween) {
        this.yaw -= dx * 0.0032;
        this.pitch = clamp(this.pitch - dy * 0.0028, -0.55, 0.65);
      }
    });
    window.addEventListener('pointerup', (e) => {
      const start2 = this.drag;
      this.drag = null;
      if (!start2) return;
      if (Math.hypot(e.clientX - start2.ox, e.clientY - start2.oy) < 8) {
        this.tap(e.clientX, e.clientY, canvas, start2.dist);
      }
    });

    this.readScroll();
  }

  /** Position courante de la caméra (mode guidé ou libre). */
  currentPos(): { x: number; z: number } {
    return { x: this.pos.x, z: this.pos.z };
  }

  /** Avancement du parcours guidé, 0..1 (suit le scroll). */
  currentT(): number {
    return this.t;
  }

  /** Instantané du cap appliqué (utilisé par les tests et l'indicateur de salle). */
  currentPose(): CameraPose {
    return { x: this.pos.x, z: this.pos.z, yaw: this.viewYaw };
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.focusTween?.stop();
    this.focusTween = null;
    if (mode === 'free') {
      this.yaw = this.viewYaw;
      this.pitch = 0;
      document.documentElement.style.overflow = 'hidden';
      this.camera.position.set(this.pos.x, EYE_Y, this.pos.z);
      // chargement lazy du chunk rapier au premier passage en mode libre
      void this.ensurePhysics();
    } else {
      document.documentElement.style.overflow = '';
      // Retour au guidé : on **reprojette la position courante sur le parcours** avant de
      // relire le scroll. Sans cela, la caméra sautait à l'entrée en quittant la libre.
      const t = this.tForPos(this.pos.x, this.pos.z);
      this.t = t;
      this.targetT = t;
      const spacer = document.getElementById('scroll-spacer');
      const max = spacer ? spacer.offsetHeight - window.innerHeight : 0;
      if (max > 0) window.scrollTo({ top: t * max, behavior: 'auto' });
      this.readScroll();
    }
  }

  /** Charge Rapier une seule fois (au 1er mode libre) ; en cas d'échec, physics reste null. */
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

  /**
   * Projection d'une position libre sur le parcours : on cherche l'échantillon le plus
   * proche, puis on inverse la courbe de dwell pour retrouver le t de scroll
   * correspondant (dwell est monotone, une dichotomie de 40 tours suffit).
   */
  tForPos(x: number, z: number): number {
    const path = this.layout.path;
    if (path.length === 0) return 0;
    let best = path[0];
    let bd = Infinity;
    for (const n of path) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    const u = clamp(best.s / Math.max(1e-6, this.layout.length), 0, 1);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.dwell(mid) < u) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  focusOn(p: PlacedWork): void {
    const pos = this.camera.position;
    // en mode libre, téléporte aussi la capsule physique sur la cible du focus
    if (this.mode === 'free') this.physics?.setPos(p.viewX, p.viewZ);
    const targetYaw = this.yaw + angDiff(this.yaw, Math.atan2(-(p.x - pos.x), -(p.z - pos.z)));
    const target: FocusState = { x: p.viewX, z: p.viewZ, yaw: targetYaw, pitch: 0.03 };
    this.focusTween?.stop();
    if (this.reduced) {
      pos.x = target.x;
      pos.z = target.z;
      this.yaw = target.yaw;
      this.pitch = target.pitch;
      this.focusTween = null;
      return;
    }
    // Un seul tronçon : les salles sont traversées par les baies, dans l'axe. Si la cible
    // est dans une autre pièce, on passe par le centre du sas — jamais à travers un mur.
    const inSameRoom = this.layout.rooms.some(
      (r) =>
        p.viewX > r.rect.x0 && p.viewX < r.rect.x1 && p.viewZ > r.rect.z0 && p.viewZ < r.rect.z1 &&
        pos.x > r.rect.x0 && pos.x < r.rect.x1 && pos.z > r.rect.z0 && pos.z < r.rect.z1,
    );
    const legs: FocusState[] = inSameRoom
      ? [target]
      : [{ x: 0, z: 0, yaw: Math.atan2(-(0 - pos.x), -(0 - pos.z)), pitch: this.pitch }, target];
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
    this.scrollToT(p.scrollT);
  }

  /** Déplace le scroll pour amener le parcours guidé au point t. */
  scrollToT(u: number): void {
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const max = spacer.offsetHeight - window.innerHeight;
    if (max <= 0) return;
    window.scrollTo({ top: clamp(u, 0, 1) * max, behavior: this.reduced ? 'auto' : 'smooth' });
  }

  update(dt: number): void {
    // Pilote les tweens du groupe dédié (Group.update() sans argument = now()).
    this.tweenGroup.update();

    if (this.mode === 'guided') {
      if (this.reduced) this.t = this.targetT;
      else this.t += (this.targetT - this.t) * Math.min(1, dt * 7.5);
      // Rythme « dwell » : u = dwell(t) — la caméra s'arrête devant chaque œuvre.
      const tt = clamp(this.t, 0, 1);
      const u = this.reduced ? tt : this.dwell(tt);
      const pose = this.layout.at(u);
      this.pos.set(pose.x, EYE_Y, pose.z);
      this.camera.position.copy(this.pos);
      // Le cap suit le tracé ; on amortit la rotation sur 70 ms pour que les virages
      // restent des virages et non des à-coups (sans jamais décaler la position).
      this.viewYaw += angDiff(this.viewYaw, pose.yaw) * (this.reduced ? 1 : Math.min(1, dt * 14));
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(0, this.viewYaw, 0);
    } else {
      const pos = this.camera.position;
      if (!this.focusTween) {
        // mouvement clavier (WASD / ZQSD) uniquement hors trajet focus
        const speed = 3.4 * dt;
        const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const r = new THREE.Vector3(-f.z, 0, f.x);
        let dx = 0;
        let dz = 0;
        if (this.keys.has('KeyW') || this.keys.has('KeyZ')) { dx += f.x * speed; dz += f.z * speed; }
        if (this.keys.has('KeyS')) { dx -= f.x * speed; dz -= f.z * speed; }
        if (this.keys.has('KeyA') || this.keys.has('KeyQ')) { dx -= r.x * speed; dz -= r.z * speed; }
        if (this.keys.has('KeyD')) { dx += r.x * speed; dz += r.z * speed; }
        if (this.physics) {
          const np = this.physics.move(dx, dz);
          pos.x = np.x;
          pos.z = np.z;
        } else {
          // fallback (Rapier indisponible, ex. ?nophys=1) : résolution AABB sur layout.walls
          const np = this.resolveWalls(pos.x + dx, pos.z + dz);
          pos.x = np.x;
          pos.z = np.z;
        }
      }
      pos.y = EYE_Y;
      this.pos.copy(pos);
      this.viewYaw = this.yaw;
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
  }

  /**
   * Repli sans Rapier : pousse la position hors des murs (boîtes de `layout.walls`,
   * gonflées du rayon du corps). Les baies sont des trous dans cette liste, donc on les
   * franchit sans code particulier.
   */
  private resolveWalls(x: number, z: number): { x: number; z: number } {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const w of this.layout.walls) {
        const L = w.to - w.from;
        const hx = (w.dir === 'x' ? L / 2 : WALL_T / 2) + BODY_R;
        const hz = (w.dir === 'x' ? WALL_T / 2 : L / 2) + BODY_R;
        const cx = w.dir === 'x' ? (w.from + w.to) / 2 : w.at;
        const cz = w.dir === 'x' ? w.at : (w.from + w.to) / 2;
        const dx = x - cx;
        const dz = z - cz;
        if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue;
        const ox = hx - Math.abs(dx);
        const oz = hz - Math.abs(dz);
        if (ox < oz) x += Math.sign(dx || 1) * ox;
        else z += Math.sign(dz || 1) * oz;
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /** Salle contenant la caméra (pour l'affichage du nom). */
  currentRoom(): Room {
    const { x, z } = this.pos;
    for (const r of this.layout.rooms) {
      if (x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1) return r;
    }
    return this.layout.rooms[0];
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
      this.onFreeKey?.(e.code);
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

  /** Touche pressée en visite libre (main.ts s'en sert pour l'aide au clavier). */
  onFreeKey: ((code: string) => void) | null = null;
}
