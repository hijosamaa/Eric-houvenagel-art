/**
 * Post-processing de la galerie — audit 3D §4.1 (P0-4) + §5 (budgets).
 *
 * Chaîne, dans l'ordre imposé par l'audit (§4.0) :
 *
 *   render target HalfFloat **multisample**  ← MSAA déplacé du canvas vers le RT
 *     → RenderPass            scène en linéaire HDR (ACES **non** appliqué ici)
 *     → GTAOPass              occlusion (rayon 0,30 m) appliquée avant le bloom
 *     → UnrealBloomPass       seuil 1,00 linéaire, résolution ½
 *     → OutputPass            **unique** tone mapper : ACES + sRGB
 *     → SMAAPass              (qualité high, après l'OutputPass : entrée sRGB)
 *     → GrainPass             ±0,028 monochrome, 1 px, 24 Hz, en espace d'affichage
 *
 * Anti-aliasing — pourquoi pas de TAA :
 *  - `TAARenderPass` / `SSAARenderPass` de three sont des **accumulateurs d'images**
 *    (jitter de caméra sur N frames) sans vecteurs de vélocité ni reprojection. Sur une
 *    caméra qui coulisse en continu (cette scène), ils produisent du ghosting et non de
 *    l'anti-aliasing temporel : inutilisables ici.
 *  - Il n'existe pas de TAA par reprojection en WebGL 2 avec `EffectComposer` dans
 *    three 0.187 : la vélocité n'est écrite que par le backend WebGPU
 *    (`mrt.has('velocity')`) et `TRAANode` est un nœud TSL.
 *  ⇒ MSAA sur le render target (4× desktop / 2× mobile) + `SMAAPass` pour les hautes
 *    fréquences de luminance que le MSAA ne traite pas (lisière émissive de la verrière).
 *  Le chemin WebGPU/TSL — `pass()` + `mrt({ velocity })` + `traa()` — reste documenté
 *  (docs/design/3d-integration.md) derrière un drapeau `?gpu=1` mais n'est pas implémenté.
 *
 * Trois pièges vérifiés dans three 0.187 :
 *  - `renderer.shadowMap.autoUpdate` passe à `false` : `GTAOPass` refait un
 *    `renderer.render()` complet pour son G-buffer, ce qui relancerait sinon toutes les
 *    shadow maps une 2ᵉ fois par frame. On pose `needsUpdate = true` une fois par frame.
 *  - Ne pas brancher `GTAOPass.setGBuffer()` sur le RT du composer : il est multisample,
 *    sa profondeur n'est pas échantillonnable. GTAO crée donc son propre G-buffer.
 *  - `UnrealBloomPass.setSize()` divise déjà par 2 : lui passer la moitié = bloom en ¼.
 */
import * as THREE from 'three';

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type PostQuality = 'high' | 'low' | 'off';

export interface PostStats {
  /** Nombre de passes réellement actives dans la chaîne. */
  passes: number;
  /** Temps GPU mesuré (`EXT_disjoint_timer_query_webgl2`), si disponible. */
  gpuMs?: number;
}

export interface PostPipeline {
  render(dt: number): void;
  setSize(w: number, h: number): void;
  setQuality(q: PostQuality): void;
  readonly stats: PostStats;
  dispose(): void;
  /** Demande une mise à jour des shadow maps à la frame suivante (cadence 'auto'). */
  invalidateShadows(): void;
}

export interface PostOptions {
  /** Ombres actives sur le renderer. */
  shadows: boolean;
  /** Mobile / pointeur grossier : la chaîne démarre en 'off' (aucun buffer alloué). */
  coarse: boolean;
  /**
   * 'frame' (défaut) : shadow maps recalculées une fois par frame — correct dans tous les
   * cas. 'auto' : seulement quand la caméra a bougé de `shadowQuantum` mètres ou après
   * `invalidateShadows()` — à n'activer qu'une fois le pool de spots piloté par
   * `TableSpots` (affectation stable, donc ombres stables).
   */
  shadowCadence?: 'frame' | 'auto';
  /** Quantification (m) de la cadence 'auto'. Défaut 0,5 (aligné sur la fenêtre du soleil). */
  shadowQuantum?: number;
}

/** Réglages chiffrés (§3.1 / §5 de l'audit). Exportés : ce sont les leviers à connaître. */
export const POST_TUNING = {
  msaaHigh: 4,
  msaaLow: 2,
  ao: {
    radius: 0.45,
    distanceExponent: 1.4,
    thickness: 0.35,
    scale: 1.0,
    samples: 16,
    samplesLow: 8,
    blendIntensity: 0.72,
    /** AO en demi-résolution (le mélange se fait en UV normalisés). */
    halfRes: true,
    denoise: { rings: 3, samples: 16, radius: 6 },
  },
  bloom: {
    strength: 0.24,
    radius: 0.55,
    threshold: 1.02,
    strengthLow: 0.18,
    thresholdLow: 1.2,
  },
  grain: { amount: 0.014, hz: 24 },
  /**
   * Courbe finale (S symétrique, appliquée en sRGB après la sortie tonale).
   *
   * Le lieu est meublé de surfaces claires — chaux ivoire, chêne blond, dalle blanc cassé.
   * Après tone mapping, toutes les valeurs tombaient entre 100 et 190 : une image sans
   * blanc ni noir, qui « flotte ». Cette S de 0,26 rend les ombres (100 → 88) et pousse
   * les hautes lumières (190 → 205) sans toucher aux gris moyens ni à la chroma.
   */
  grade: { contrast: 0.26, lift: -0.008 },
  smaa: true,
} as const;

/**
 * Bruit de rotation des échantillons GTAO.
 *
 * `GTAOPass` utilise par défaut une « magic square » 5×5 : le motif se répète tous les
 * 5 texels de la cible AO, ce qui dessinait une **grille régulière** sur les murs plats
 * (visible sur toutes les captures d'avant). Un bruit aléatoire 128² de même format
 * (vecteur unitaire encodé en RGB) casse cette périodicité ; le débruiteur de Poisson
 * lave ensuite le reste. C'est la seule modification apportée au pass de three.
 */
function aoNoiseTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = (i * 2.399963229728653) % (Math.PI * 2); // suite de Fibonacci : angles bien répartis
    data[i * 4] = Math.round((Math.cos(a) * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((Math.sin(a) * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = 127;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Grain : seul shader custom du plan. Pas `FilmPass` (bruit non symétrique :
// `base + base * clamp(0.1 + noise, 0, 1)` n'éclaircit que — cf. audit §4.1).
// ---------------------------------------------------------------------------

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: POST_TUNING.grain.amount },
    uSeed: { value: 0 },
    uContrast: { value: POST_TUNING.grade.contrast },
    uLift: { value: POST_TUNING.grade.lift },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uSeed;
    uniform float uContrast;
    uniform float uLift;
    varying vec2 vUv;

    // Hash de Dave Hoskins : distribution non corrélée. L'ancienne version
    // (fract(p * vec2(443.897, 441.423))…) était périodique et dessinait une Trame
    // diagonale visible sur tous les aplats clairs — murs et passe-partout compris.
    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      // Courbe finale : S symétrique (smoothstep) + léger point noir. Appliquée AVANT le
      // grain pour que le bruit ne soit pas écrasé dans les ombres.
      vec3 g = clamp( c.rgb, 0.0, 1.0 );
      g = mix( g, g * g * ( 3.0 - 2.0 * g ), uContrast ) + uLift * ( 1.0 - g );
      c.rgb = clamp( g, 0.0, 1.0 );
      float r = hash12( gl_FragCoord.xy + vec2( uSeed * 13.7, uSeed * 7.3 ) );
      // Grain monochrome symétrique, 1 px. Pondéré par la luminance : quasi nul dans
      // les blancs (un grain marqué sur un mur clair se lit comme du bruit numérique).
      float lum = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      float w = 1.0 - smoothstep( 0.55, 0.98, lum );
      float n = ( r - 0.5 ) * 2.0;
      // Vignettage très léger : recentre l'œil sur les toiles (0 = aucun, 1 = coin noir).
      vec2 d = ( vUv - 0.5 ) * vec2( 1.0, 0.92 );
      float vig = 1.0 - 0.09 * pow( smoothstep( 0.18, 0.86, length( d ) ), 1.6 );
      gl_FragColor = vec4( ( c.rgb + n * uAmount * ( 0.35 + 0.65 * w ) ) * vig, c.a );
    }
  `,
};

// ---------------------------------------------------------------------------
// Chronomètre GPU optionnel (2 requêtes en alternance, aucune allocation par frame)
// ---------------------------------------------------------------------------

const GL_TIME_ELAPSED = 0x88bf;
const GL_GPU_DISJOINT = 0x8fbb;
const GL_QUERY_RESULT = 0x8866;
const GL_QUERY_RESULT_AVAILABLE = 0x8867;

interface TimerQueryExt {
  createQuery(): WebGLQuery;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  deleteQuery(query: WebGLQuery): void;
}

class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private ext: TimerQueryExt | null;
  private readonly queries: WebGLQuery[] = [];
  private slot = 0;
  /** idle = rien en vol, running = requête ouverte, waiting = résultat en attente. */
  private state: 'idle' | 'running' | 'waiting' = 'idle';
  lastMs = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = (this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null) ?? null;
    if (!this.ext) return;
    try {
      this.queries.push(this.ext.createQuery(), this.ext.createQuery());
    } catch {
      this.queries.length = 0;
      this.ext = null;
    }
  }

  get available(): boolean {
    return this.ext !== null && this.queries.length === 2;
  }

  begin(): void {
    const ext = this.ext;
    if (!ext) return;
    if (this.state === 'waiting') {
      const q = this.queries[this.slot];
      let ready = false;
      try {
        ready = Boolean(ext.getQueryParameter(q, GL_QUERY_RESULT_AVAILABLE));
      } catch {
        return;
      }
      if (!ready) return; // on ne réutilise pas une requête en vol
      try {
        const disjoint = Boolean(this.gl.getParameter(GL_GPU_DISJOINT));
        const ns = Number(ext.getQueryParameter(q, GL_QUERY_RESULT));
        if (!disjoint && Number.isFinite(ns) && ns >= 0) this.lastMs = ns / 1e6;
      } catch {
        /* mesure perdue */
      }
      this.slot = (this.slot + 1) % this.queries.length;
      this.state = 'idle';
    }
    if (this.state !== 'idle') return;
    try {
      ext.beginQuery(GL_TIME_ELAPSED, this.queries[this.slot]);
      this.state = 'running';
    } catch {
      this.state = 'idle';
    }
  }

  end(): void {
    const ext = this.ext;
    if (!ext || this.state !== 'running') return;
    try {
      ext.endQuery(GL_TIME_ELAPSED);
      this.state = 'waiting';
    } catch {
      this.state = 'idle';
    }
  }

  dispose(): void {
    const ext = this.ext;
    if (!ext) return;
    for (const q of this.queries) {
      try {
        ext.deleteQuery(q);
      } catch {
        /* ignore */
      }
    }
    this.queries.length = 0;
    this.ext = null;
    this.state = 'idle';
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

class ComposerPipeline implements PostPipeline {
  readonly stats: PostStats = { passes: 0 };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly timer: GpuTimer;
  private readonly cadence: 'frame' | 'auto';
  private readonly quantum: number;

  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private smaa: SMAAPass | null = null;
  private grain: ShaderPass | null = null;
  private readonly passes: { dispose?: () => void }[] = [];

  private quality: PostQuality = 'off';
  private width = 1;
  private height = 1;
  private elapsed = 0;
  private shadowZ = Number.NaN;
  private shadowsDirty = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostOptions) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.timer = new GpuTimer(renderer);
    this.cadence = opts.shadowCadence ?? 'frame';
    this.quantum = opts.shadowQuantum ?? 0.5;
    const size = renderer.getSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);
  }

  /** Construit la chaîne si nécessaire. Renvoie false si le post n'est pas possible. */
  private ensure(): boolean {
    if (this.composer) return true;
    if (this.quality === 'off') return false;
    const renderer = this.renderer;
    const dpr = renderer.getPixelRatio();
    const w = Math.max(1, Math.round(this.width * dpr));
    const h = Math.max(1, Math.round(this.height * dpr));
    const high = this.quality === 'high';
    try {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        samples: high ? POST_TUNING.msaaHigh : POST_TUNING.msaaLow,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      rt.texture.name = 'post.scene';
      const composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(dpr);
      composer.setSize(this.width, this.height);

      const renderPass = new RenderPass(this.scene, this.camera);
      composer.addPass(renderPass);
      this.passes.push(renderPass);

      const gtao = new GTAOPass(this.scene, this.camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = POST_TUNING.ao.blendIntensity;
      gtao.updateGtaoMaterial({
        radius: POST_TUNING.ao.radius,
        distanceExponent: POST_TUNING.ao.distanceExponent,
        thickness: POST_TUNING.ao.thickness,
        scale: POST_TUNING.ao.scale,
        samples: high ? POST_TUNING.ao.samples : POST_TUNING.ao.samplesLow,
        screenSpaceRadius: false,
      });
      gtao.updatePdMaterial(POST_TUNING.ao.denoise);
      // Remplace la magic square 5×5 de three (voir aoNoiseTexture).
      gtao.gtaoMaterial.uniforms.tNoise.value = aoNoiseTexture();
      gtao.gtaoMaterial.needsUpdate = true;
      composer.addPass(gtao);
      this.passes.push(gtao);

      const bloom = new UnrealBloomPass(
        new THREE.Vector2(w / 2, h / 2),
        high ? POST_TUNING.bloom.strength : POST_TUNING.bloom.strengthLow,
        POST_TUNING.bloom.radius,
        high ? POST_TUNING.bloom.threshold : POST_TUNING.bloom.thresholdLow,
      );
      composer.addPass(bloom);
      this.passes.push(bloom);

      const output = new OutputPass();
      composer.addPass(output);
      this.passes.push(output);

      let smaa: SMAAPass | null = null;
      if (POST_TUNING.smaa) {
        smaa = new SMAAPass();
        composer.addPass(smaa);
        this.passes.push(smaa);
      }

      const grain = new ShaderPass(GrainShader);
      composer.addPass(grain);
      this.passes.push(grain);

      this.composer = composer;
      this.gtao = gtao;
      this.bloom = bloom;
      this.smaa = smaa;
      this.grain = grain;
      this.applyQuality();
      this.applyResolutions();
      // GTAO refait un renderer.render() : les ombres ne doivent pas être recalculées 2×.
      renderer.shadowMap.autoUpdate = false;
      this.shadowsDirty = true;
      return true;
    } catch (err) {
      console.warn('[post] pipeline indisponible, rendu direct conservé', err);
      this.teardown();
      return false;
    }
  }

  setQuality(q: PostQuality): void {
    if (q === this.quality) return;
    const wasOff = this.quality === 'off';
    this.quality = q;
    if (q === 'off') {
      this.teardown();
      this.renderer.shadowMap.autoUpdate = true;
      return;
    }
    if (!this.composer) {
      // 'high' → 'low' (ou l'inverse) avant toute construction : il faut rebâtir le RT
      // (le nombre d'échantillons MSAA est figé à la création).
      if (!wasOff) this.teardown();
      this.ensure();
      return;
    }
    this.applyQuality();
    this.applyResolutions();
  }

  private applyQuality(): void {
    const high = this.quality === 'high';
    if (this.gtao) {
      this.gtao.enabled = high;
      this.gtao.updateGtaoMaterial({ samples: high ? POST_TUNING.ao.samples : POST_TUNING.ao.samplesLow });
    }
    if (this.bloom) {
      this.bloom.strength = high ? POST_TUNING.bloom.strength : POST_TUNING.bloom.strengthLow;
      this.bloom.threshold = high ? POST_TUNING.bloom.threshold : POST_TUNING.bloom.thresholdLow;
    }
    // SMAA actif aussi en 'low' : c'est lui qui lisse les arêtes des lignes droites
    // (cadres, cimaise) quand on se rapproche — le MSAA 2× seul laisse de l'escalier.
    if (this.smaa) this.smaa.enabled = true;
    let n = 0;
    if (this.composer) {
      for (const p of this.composer.passes) if ((p as { enabled?: boolean }).enabled !== false) n++;
    }
    this.stats.passes = n;
  }

  private applyResolutions(): void {
    if (!this.composer) return;
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.round(this.width * dpr));
    const h = Math.max(1, Math.round(this.height * dpr));
    const half = this.quality !== 'high';
    if (this.gtao && this.gtao.enabled) {
      // GTAO en demi-résolution : 1/4 des pixels, mélange correct en UV normalisés.
      if (POST_TUNING.ao.halfRes) this.gtao.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      else this.gtao.setSize(w, h);
    }
    if (this.bloom) {
      // UnrealBloomPass divise par 2 : lui passer la moitié = bloom en ¼ de résolution.
      if (half) this.bloom.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      else this.bloom.setSize(w, h);
    }
  }

  setSize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.width = w;
    this.height = h;
    if (!this.composer) return;
    const dpr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.applyResolutions();
  }

  invalidateShadows(): void {
    this.shadowsDirty = true;
  }

  render(dt: number): void {
    const composer = this.composer;
    if (!composer) {
      // 'off' ou post impossible : rendu direct, ACES porté par les matériaux.
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Une seule mise à jour des shadow maps par frame (le RenderPass la consomme).
    this.renderer.shadowMap.needsUpdate = this.needShadowUpdate();

    this.elapsed += dt;
    if (this.grain) {
      this.grain.uniforms.uSeed.value = Math.floor(this.elapsed * POST_TUNING.grain.hz) % 4096;
    }

    const timing = this.timer.available;
    if (timing) this.timer.begin();
    composer.render(dt);
    if (timing) {
      this.timer.end();
      if (this.timer.lastMs > 0) this.stats.gpuMs = this.timer.lastMs;
    }
  }

  private needShadowUpdate(): boolean {
    if (!this.renderer.shadowMap.enabled) return false;
    if (this.cadence === 'frame') return true;
    const z = this.camera.position.z;
    if (this.shadowsDirty || !Number.isFinite(this.shadowZ) || Math.abs(z - this.shadowZ) >= this.quantum) {
      this.shadowZ = z;
      this.shadowsDirty = false;
      return true;
    }
    return false;
  }

  private teardown(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    for (const p of this.passes) {
      try {
        p.dispose?.();
      } catch {
        /* ignore */
      }
    }
    this.passes.length = 0;
    this.gtao = null;
    this.bloom = null;
    this.smaa = null;
    this.grain = null;
    this.stats.passes = 0;
  }

  dispose(): void {
    this.teardown();
    this.timer.dispose();
    this.renderer.shadowMap.autoUpdate = true;
  }
}

/**
 * Crée la chaîne de post-processing.
 *
 * - `null` si le post n'est pas possible (render target float half non supporté) →
 *   l'appelant garde `renderer.render(scene, camera)`.
 * - `coarse` : la chaîne démarre en `'low'` (MSAA 2× + SMAA, AO léger) — le rendu
 *   direct sans SMAA laissait des lignes en escalier sur mobile ; `setQuality('off')`
 *   reste disponible pour les très vieux GPU.
 */
export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: PostOptions,
): PostPipeline | null {
  const hasHalfFloat =
    renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  if (!hasHalfFloat) return null;
  const pipeline = new ComposerPipeline(renderer, scene, camera, opts);
  // Mobile : chaîne 'low' (MSAA 2× + SMAA + AO léger) et non plus 'off' — sans SMAA,
  // les lignes droites des cadres sont en escalier dès qu'on se rapproche d'une œuvre.
  pipeline.setQuality(opts.coarse ? 'low' : 'high');
  return pipeline;
}
