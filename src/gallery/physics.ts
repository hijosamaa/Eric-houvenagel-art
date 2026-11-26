/**
 * Physique du mode libre — character controller Rapier (capsule), chargement LAZY.
 *
 * Le chunk `@dimforge/rapier3d-compat` (WASM embarqué en base64, ~1,4–1,9 Mo) n'est
 * téléchargé que via le `await import()` ci-dessous, au premier passage en mode libre
 * (voir GalleryControls.ensurePhysics). En mode guidé, aucune requête réseau rapier.
 *
 * Les colliders fixes sont reconstruits depuis `layout` + les constantes de layout.ts,
 * avec les mêmes positions que scene.ts (murs, bancs, portails, tableaux) — scene.ts
 * n'est pas modifié. Le joueur est une capsule kinématique (rotations verrouillées,
 * gravité 0 → vol stationnaire à y = 1.6, même hauteur que la caméra).
 *
 * `move(dx, dz)` fait un sweep `world.castShape` + glissement le long des normales
 * (3 itérations), équivalent d'un character controller : la capsule est bloquée par
 * les murs/bancs/piliers/tableaux mais glisse le long des surfaces.
 */
import { HALL_WIDTH, HALL_HEIGHT, Z_START, hallBounds, type Layout } from './layout';

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
export const PLAYER_Y = 1.6;
/** Rayon de la capsule joueur. */
const CAPSULE_RADIUS = 0.35;
/** Demi-hauteur du cylindre de la capsule (~0.9 de haut pour le cylindre, 1.6 au total). */
const CAPSULE_HALF_HEIGHT = 0.45;
/**
 * Décalage local du collider par rapport au body : pour un body à y = 1.6, la capsule
 * s'étend en y ∈ [0.05, 1.65] — assez bas pour être bloquée par les bancs (assise
 * à 0.495) et les piliers, assez haut sous le linteau des portails (bas à 2.95).
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

    const { zMin, zMax } = hallBounds(layout);
    const len = zMax - zMin;
    const cz = (zMin + zMax) / 2;

    // collider fixe (sans rigid body) : boîte de demi-extents (hx, hy, hz) centrée en (x, y, z)
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    };

    // 4 murs du hall (identiques à scene.ts : épaisseur 0.25, z = zMin/zMax)
    fixed(0.125, HALL_HEIGHT / 2, len / 2, -HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
    fixed(0.125, HALL_HEIGHT / 2, len / 2, HALL_WIDTH / 2, HALL_HEIGHT / 2, cz);
    fixed((HALL_WIDTH + 0.5) / 2, HALL_HEIGHT / 2, 0.125, 0, HALL_HEIGHT / 2, zMax);
    fixed((HALL_WIDTH + 0.5) / 2, HALL_HEIGHT / 2, 0.125, 0, HALL_HEIGHT / 2, zMin);

    // bancs (positions identiques à scene.ts)
    const benchX = -HALL_WIDTH / 2 + 0.38;
    for (let bz = zMin + 6; bz < zMax - 4; bz += 11) {
      fixed(0.25, 0.045, 0.9, benchX, 0.45, bz); // assise 0.5 x 0.09 x 1.8 à y = 0.45
      fixed(0.21, 0.2, 0.04, benchX, 0.2, bz - 0.8); // pied A
      fixed(0.21, 0.2, 0.04, benchX, 0.2, bz + 0.8); // pied B
    }

    // portails entre salles (piliers p1/p2 + linteau, identiques à scene.ts)
    for (let i = 0; i < layout.zones.length - 1; i++) {
      const z = layout.zones[i].zMax;
      fixed(0.175, HALL_HEIGHT / 2, 0.175, -(HALL_WIDTH / 2 - 0.3), HALL_HEIGHT / 2, z); // p1
      fixed(0.175, HALL_HEIGHT / 2, 0.175, HALL_WIDTH / 2 - 0.3, HALL_HEIGHT / 2, z); // p2
      fixed((HALL_WIDTH - 0.6) / 2, 0.225, 0.175, 0, HALL_HEIGHT - 0.225, z); // linteau
    }

    // un collider par tableau (mur droit) : dans le monde, après rotation.y=-π/2 du groupe,
    // la largeur p.w s'étend selon z et la profondeur 0.08 selon x → hx=0.04, hz=(p.w+0.16)/2
    for (const p of layout.placed) {
      fixed(0.04, (p.h + 0.16) / 2, (p.w + 0.16) / 2, p.x, p.y, p.z);
    }

    // joueur : rigid body kinématique (capsule), rotations verrouillées, y fixé à 1.6
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(layout.pathX, PLAYER_Y, Z_START)
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
