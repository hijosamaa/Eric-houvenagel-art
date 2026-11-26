import * as THREE from 'three';

/**
 * Fabrique de textures procédurales de la galerie.
 *
 * `precalcTexture(name, …)` renvoie immédiatement une texture placeholder 2×2, puis :
 *   1. tente de charger `assets/textures/ai/<name>.webp`  ← **override IA (Nano Banana…)**,
 *      déposé par l'utilisateur dans `public/assets/textures/ai/` (non commité, voir .gitignore) ;
 *   2. sinon `assets/textures/<name>.webp` (précalcul build-time, scripts/gen-textures.mjs) ;
 *   3. sinon retombe sur le générateur canvas 2D `draw` (comportement historique).
 * Dans les 3 cas, les paramètres (repeat, anisotropy, colorSpace, wrapping) sont identiques,
 * donc un remplacement d'asset ne change jamais l'échelle ni le rendu de base.
 */

export const TEX_ASSETS = `${import.meta.env.BASE_URL}assets/textures/`;

export interface TexOpts {
  repeat?: [number, number];
  aniso: number;
}

export function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  return [c, g];
}

export function precalcTexture(
  name: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
  opts: TexOpts,
  placeholder: string,
  srgb = true,
): THREE.Texture {
  const [c, g] = makeCanvas(2);
  g.fillStyle = placeholder;
  g.fillRect(0, 0, 2, 2);
  const t: THREE.Texture = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = opts.aniso;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  const loader = new THREE.TextureLoader();
  void (async () => {
    // 1. override IA, 2. texture build-time, 3. fallback procédural runtime
    let img: HTMLImageElement | HTMLCanvasElement | undefined;
    try {
      img = (await loader.loadAsync(`${TEX_ASSETS}ai/${name}.webp`)).image;
    } catch {
      try {
        img = (await loader.loadAsync(`${TEX_ASSETS}${name}.webp`)).image;
      } catch {
        const [c2, g2] = makeCanvas(size);
        draw(g2, size);
        img = c2;
      }
    }
    t.image = img;
    t.needsUpdate = true;
  })();
  return t;
}

/* ---------------------------------------------------------------------------
 * Nouvelles textures procédurales (fallback runtime ; remplaçables par IA dans
 * public/assets/textures/ai/ : beam.webp, metal.webp, rug.webp, gilt.webp).
 * ------------------------------------------------------------------------- */

/** Chêne des poutres/mobilier : veine verticale (le long de la poutre = axe v des box). */
export function beamTexture(aniso: number, repeatV = 1, base = '#6a4e32'): THREE.Texture {
  return precalcTexture('beam', 1024, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    // veines verticales (le long de la poutre)
    for (let i = 0; i < 1100; i++) {
      const x = Math.random() * s;
      const w = 1 + Math.random() * 3;
      const light = Math.random() > 0.45;
      g.fillStyle = light
        ? `rgba(216,182,132,${(0.05 + Math.random() * 0.12).toFixed(3)})`
        : `rgba(50,32,17,${(0.06 + Math.random() * 0.14).toFixed(3)})`;
      g.fillRect(x, 0, w, s);
    }
    // cernes ondulés
    for (let i = 0; i < 70; i++) {
      const x0 = Math.random() * s;
      g.strokeStyle = `rgba(40,26,14,${(0.10 + Math.random() * 0.15).toFixed(3)})`;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      for (let y = 0; y <= s; y += 32) {
        const x = x0 + Math.sin(y * 0.012 + i) * 8 + (Math.random() - 0.5) * 3;
        if (y === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // nœuds
    for (let i = 0; i < 8; i++) {
      const nx = Math.random() * s;
      const ny = Math.random() * s;
      const nr = 6 + Math.random() * 14;
      const rg = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
      rg.addColorStop(0, 'rgba(38,24,12,0.55)');
      rg.addColorStop(1, 'rgba(38,24,12,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(nx, ny, nr, 0, 7);
      g.fill();
    }
  }, { aniso, repeat: [1, repeatV] }, base);
}

/** Métal brossé vertical (bronze des châssis de verrière), non sRGB (utilisé comme map neutre). */
export function metalTexture(aniso: number): THREE.Texture {
  return precalcTexture('metal', 512, (g, s) => {
    g.fillStyle = '#4a4136';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * s;
      const l = Math.random();
      g.fillStyle = l > 0.5
        ? `rgba(196,180,152,${(Math.random() * 0.10).toFixed(3)})`
        : `rgba(18,14,10,${(Math.random() * 0.13).toFixed(3)})`;
      g.fillRect(x, 0, 1, s);
    }
  }, { aniso: Math.min(aniso, 8), repeat: [1, 1] }, '#4a4136');
}

/**
 * Tapis tissé, champ seamless (motif losangé + trame) — la bordure est posée en
 * géométrie (4 baguettes) donc pas de couture dans la texture. Tuile = 2,6 m.
 */
export function rugTexture(aniso: number): THREE.Texture {
  return precalcTexture('rug', 2048, (g, s) => {
    g.fillStyle = '#5f3c31';
    g.fillRect(0, 0, s, s);
    // trame tissée
    const step = 10;
    for (let y = 0; y < s; y += step) {
      for (let x = 0; x < s; x += step) {
        const v = 88 + (((x + y) / step) % 2 === 0 ? 13 : Math.random() * 8);
        g.fillStyle = `rgb(${v | 0},${(v * 0.60) | 0},${(v * 0.50) | 0})`;
        g.fillRect(x, y, step - 2, step - 2);
      }
    }
    // treillis de losanges (périodique → seamless)
    g.strokeStyle = 'rgba(233,221,192,0.24)';
    g.lineWidth = 5;
    const d = s / 8;
    for (let k = -8; k <= 8; k++) {
      g.beginPath();
      g.moveTo(k * d, 0);
      g.lineTo(k * d + s, s);
      g.stroke();
      g.beginPath();
      g.moveTo(k * d, 0);
      g.lineTo(k * d - s, s);
      g.stroke();
    }
    // petits motifs dans les losanges (décalés, périodiques)
    g.fillStyle = 'rgba(233,221,192,0.5)';
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const cx = (i + 0.5) * d;
        const cy = (j + 0.5) * d;
        g.beginPath();
        g.moveTo(cx, cy - 12);
        g.lineTo(cx + 12, cy);
        g.lineTo(cx, cy + 12);
        g.lineTo(cx - 12, cy);
        g.closePath();
        g.fill();
      }
    }
  }, { aniso, repeat: [1, 1] }, '#5f3c31');
}

/** Dorure des cadres : or brossé, studs chauds/froids (map + fallback IA gilt.webp). */
export function giltTexture(aniso: number): THREE.Texture {
  return precalcTexture('gilt', 512, (g, s) => {
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#dcb96e');
    grad.addColorStop(0.5, '#c9a24f');
    grad.addColorStop(1, '#b28a3e');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // brossage
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * s;
      g.fillStyle = Math.random() > 0.5
        ? `rgba(255,236,190,${(Math.random() * 0.10).toFixed(3)})`
        : `rgba(118,82,30,${(Math.random() * 0.12).toFixed(3)})`;
      g.fillRect(x, 0, 1 + Math.random() * 1.5, s);
    }
    // mouchetures
    for (let i = 0; i < 5200; i++) {
      const v = 150 + Math.random() * 105;
      g.fillStyle = `rgba(${v | 0},${(v * 0.78) | 0},${(v * 0.42) | 0},${(Math.random() * 0.08).toFixed(3)})`;
      g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }, { aniso: Math.min(aniso, 8), repeat: [1, 1] }, '#c9a24f');
}
