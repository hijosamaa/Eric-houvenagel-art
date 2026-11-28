/**
 * Physique du mode libre — character controller Rapier (capsule), chargement LAZY.
 *
 * Le chunk `@dimforge/rapier3d-compat` (WASM embarqué en base64, ~1,4–1,9 Mo) n'est
 * téléchargé que via le `await import()` ci-dessous, au premier passage en mode libre
 * (voir GalleryControls.ensurePhysics). En mode guidé, aucune requête réseau rapier.
 *
 * Les colliders fixes sont reconstruits depuis `layout` + les helpers partagés
 * (`layout.walls`, `furnitureColliders`, `plantColliders`) : les mêmes fonctions
 * produisent les meshes de scene.ts, donc la physique colle toujours au visuel. Les
 * baies ne sont pas des exceptions codées à part : elles sont des **trous dans la liste
 * des murs**, donc on les traverse librement.
 *
 * Le joueur est une capsule kinématique (rotations verrouillées, gravité 0 → vol
 * stationnaire à y = EYE_Y, même hauteur que la caméra).
 *
 * `move(dx, dz)` fait un sweep `world.castShape` + glissement le long des normales
 * (3 itérations), équivalent d'un character controller : la capsule est bloquée par
 * les murs/bancs/piliers/tableaux mais glisse le long des surfaces.
 */
import { EYE_Y, WALL_T, type Layout } from './layout';

import { furnitureColliders } from './furniture';

import { plantColliders } from './plants';

type RapierModule = typeof import('@dimforge/rapier3d-compat');
type RWorld = InstanceType<RapierModule['World']>;
type RRigidBody = InstanceType<RapierModule['RigidBody']>;
type RCollider = InstanceType<RapierModule['Collider']>;
type RCapsule = InstanceType<RapierModule['Capsule']>;

export interface PhysicsWorld {
  /** Déplace la capsule de (dx, dz) avec collision + glissement ; retourne la nouvelle position. */
  move(dx: number, dz: number): { x: number; z: number };
  /** Téléporte la capsule (focusOn, retour guidé). */
  setPos(x: number, z: number): void;
  getPos(): { x: number; z: number };
  dispose(): void;
}

/** Hauteur des yeux = hauteur caméra en mode libre ; le body y est calé dessus. */
export const PLAYER_Y = EYE_Y;
/** Rayon de la capsule joueur. */
const CAPSULE_RADIUS = 0.35;
/** Demi-hauteur du cylindre de la capsule (~0.9 de haut pour le cylindre, 1.6 au total). */
const CAPSULE_HALF_HEIGHT = 0.45;
/**
 * Décalage local du collider par rapport au body : pour un body à y = 1.6, la capsule
 * s'étend en y ∈ [0.05, 1.65] — assez bas pour être bloquée par les bancs (assise
 * à 0.495) et les piliers, assez haut sous le linteau des baies (bas à 2,78).
 */
const CAPSULE_DROP = 0.75;
/** Marge gardée entre la capsule et les obstacles pendant le sweep. */
const MOVE_MARGIN = 0.02;

class RapierWorld implements PhysicsWorld {
  private readonly world: RWorld;
  private readonly body: RRigidBody;
  private readonly collider: RCollider;
  private readonly capsule: RCapsule;

  constructor(RAPIER: RapierModule, layout: Layout) {
    // gravité 0 : vol stationnaire à y = PLAYER_Y (pas de condamnation y nécessaire)
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    // collider fixe (sans rigid body) : boîte de demi-extents (hx, hy, hz) centrée en (x, y, z)
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    };

    // ---- murs : un collider par tronçon, exactement ceux de scene.ts ----
    for (const w of layout.walls) {
      const L = w.to - w.from;
      const h = w.y1 - w.y0;
      if (L < 0.02 || h < 0.02) continue;
      const hx = w.dir === 'x' ? L / 2 : WALL_T / 2;
      const hz = w.dir === 'x' ? WALL_T / 2 : L / 2;
      const x = w.dir === 'x' ? (w.from + w.to) / 2 : w.at;
      const z = w.dir === 'x' ? w.at : (w.from + w.to) / 2;
      fixed(hx, h / 2, hz, x, w.y0 + h / 2, z);
    }

    // ---- mobilier (bancs, socles, console) : positions partagées avec scene.ts ----
    for (const c of furnitureColliders(layout)) {
      fixed(c.hx, c.hy, c.hz, c.x, c.y, c.z);
    }
    // ---- plantes : même source de positions que la végétation de scene.ts ----
    for (const c of plantColliders(layout)) {
      fixed(c.hx, c.hy, c.hz, c.x, c.y, c.z);
    }

    // ---- toiles : une boîte par cadre, **tournée** comme le cadre (4 orientations) ----
    for (const p of layout.placed) {
      const q = new RAPIER.Quaternion(0, Math.sin(p.rotY / 2), 0, Math.cos(p.rotY / 2));
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((p.w + 0.16) / 2, (p.h + 0.16) / 2, 0.045)
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
    }

    // ---- joueur : rigid body kinématique (capsule), rotations verrouillées, y = EYE_Y ----
    const start = layout.at(0);
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(start.x, PLAYER_Y, start.z)
        .lockRotations(),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS).setTranslation(0, -CAPSULE_DROP, 0),
      this.body,
    );
    this.capsule = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS);
    // synchronise le query pipeline avec les colliders statiques (ils ne bougent plus ensuite)
    this.world.step();
  }

  private get capsuleCenterY(): number {
    return PLAYER_Y - CAPSULE_DROP;
  }

  move(dx: number, dz: number): { x: number; z: number } {
    const t = this.body.translation();
    let x = t.x;
    let z = t.z;
    let rx = dx;
    let rz = dz;
    const shapePos = { x, y: this.capsuleCenterY, z };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    // sweep de la capsule + glissement le long des normales (3 itérations max)
    for (let i = 0; i < 3; i++) {
      const len = Math.hypot(rx, rz);
      if (len < 1e-6) break;
      const dir = { x: rx / len, y: 0, z: rz / len };
      const hit = this.world.castShape(
        shapePos,
        rot,
        dir,
        this.capsule,
        len + MOVE_MARGIN,
        true,
        undefined,
        undefined,
        this.collider, // exclut la capsule elle-même
      );
      if (!hit) {
        x += rx;
        z += rz;
        rx = 0;
        rz = 0;
      } else {
        const toi = Math.min(len, Math.max(0, hit.toi - MOVE_MARGIN));
        x += dir.x * toi;
        z += dir.z * toi;
        shapePos.x = x;
        shapePos.z = z;
        // normal1 = normale monde du collider touché, pointant vers la capsule :
        // la composante entrante du déplacement est d < 0 → on la retire (glissement)
        const n = hit.normal1;
        const d = rx * n.x + rz * n.z;
        if (d < 0) {
          rx -= n.x * d;
          rz -= n.z * d;
        }
      }
    }
    this.body.setTranslation({ x, y: PLAYER_Y, z }, true);
    return { x, z };
  }

  setPos(x: number, z: number): void {
    this.body.setTranslation({ x, y: PLAYER_Y, z }, true);
  }

  getPos(): { x: number; z: number } {
    const t = this.body.translation();
    return { x: t.x, z: t.z };
  }

  dispose(): void {
    this.world.free();
  }
}

/**
 * Construit le monde physique (charge Rapier en lazy). Retourne null si Rapier est
 * indisponible (ou si `?nophys=1` est présent — param de test du fallback) : dans ce
 * cas GalleryControls garde ses clamps AABB manuels.
 */
export async function createPhysics(layout: Layout): Promise<PhysicsWorld | null> {
  if (new URLSearchParams(window.location.search).has('nophys')) return null;
  try {
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
    return new RapierWorld(RAPIER, layout);
  } catch (err) {
    console.warn('[physics] Rapier indisponible, fallback clamps manuels:', err);
    return null;
  }
}
