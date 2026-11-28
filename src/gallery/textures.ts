import * as THREE from 'three';

/**
 * Fabrique de textures procédurales de la galerie.
 *
 * `precalcTexture(name, …)` renvoie immédiatement une texture placeholder 2×2, puis :
 *   1. tente de charger `assets/textures/ai/<name>-<maxSize>.webp` (variante réduite,
 *      générée par scripts/gen-texture-variants.mjs) puis `ai/<name>.webp`, puis les
 *      mêmes en `.jpg` (fallback universel si le WebP est bloqué/non décodé)
 *      ← **override IA (Nano Banana…)**, déposé par l'utilisateur dans
 *      `public/assets/textures/ai/` ;
 *   2. sinon `assets/textures/<name>-<maxSize>.webp` puis `<name>.webp`
 *      (précalcul build-time, scripts/gen-textures.mjs) ;
 *   3. sinon retombe sur le générateur canvas 2D `draw` (comportement historique).
 *
 * Toute image dépassant `opts.maxSize` est **resizée côté client** via
 * `createImageBitmap(blob, { resize… })` : sur mobile (maxSize 1024) on ne décode ni
 * n'upload jamais une texture de 2048²/4096² en mémoire GPU (c'était la cause des
 * textures noires / non chargées sur mobile). Dans tous les cas, les paramètres
 * (repeat, anisotropy, colorSpace, wrapping) sont identiques : un remplacement
 * d'asset ne change jamais l'échelle ni le rendu de base.
 */

export const TEX_ASSETS = `${import.meta.env.BASE_URL}assets/textures/`;
/**
 * Dossier des textures générées (Nano Banana & co). **Source de vérité unique** :
 * `public/assets/textures/ai/` — chaque asset y existe en pleine résolution (`.webp` et
 * `.jpg`, 2048²) et en variante `-1024` (mobile). Un ancien doublon `public/tex/`
 * servait les mêmes 21 Mo une seconde fois : supprimé.
 */
export const TEX_AI = `${import.meta.env.BASE_URL}assets/textures/ai/`;

export interface TexOpts {
  repeat?: [number, number];
  aniso: number;
  /** Côté max (px) de la texture uploadée vers le GPU — 1024 mobile / 2048 desktop. */
  maxSize?: number;
  /**
   * Dessine le motif procédural **tout de suite**, au lieu d'un placeholder 2×2.
   * À utiliser pour les slots qui n'ont pas encore d'asset (`oak`, `painted`, `leaf`) :
   * sans cela, la texture reste une couleur unie jusqu'à ce que les 6 candidats aient
   * échoué (soit plusieurs frames pendant lesquelles le mobilier est plat).
   */
  eager?: boolean;
  /**
   * Étalonnage CSS appliqué à l'asset pendant son transfert dans la texture
   * (`saturate(0.6) brightness(1.05)`…). Un asset Nano Banana arrive souvent saturé
   * « photo de catalogue » : on le ramène dans le nuancier de la galerie plutôt que de
   * le refuser. Si le navigateur ne connaît pas `ctx.filter`, l'image passe telle quelle.
   */
  grade?: string;
  /** Répétition en miroir : masque la tuile sur les grands aplats (sol, enduit). */
  mirror?: boolean;
}

/**
 * Charge une image via `<img src>` direct (mécanisme le plus compatible —
 * certains environnements bloquent fetch→blob→createImageBitmap sur le WebP),
 * resizée à `maxSize` via un canvas 2D si nécessaire.
 */
async function loadImageCapped(url: string, maxSize: number): Promise<HTMLImageElement | HTMLCanvasElement | undefined> {
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed: " + url));
      el.src = url;
    });
  } catch {
    return undefined;
  }
  const side = Math.max(img.naturalWidth, img.naturalHeight);
  if (side > maxSize && side > 0) {
    const sc = maxSize / side;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * sc));
    c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    const g = c.getContext("2d");
    if (g) {
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
      return c;
    }
  }
  return img;
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
  // Le canvas de repli ne doit JAMAIS dépasser `maxSize` : la texture est d'abord
  // allouée à cette taille, puis ré-uploadée avec l'asset (lui-même plafonné à
  // `maxSize`). Un canvas 4096 ré-uploadé en 2048 déclenchait
  // « glTexSubImage2D: Offset overflows texture dimensions » et le GPU gardait une
  // texture vide — le sol restait donc un aplat gris sans la moindre lame.
  const px = Math.max(2, Math.min(size, opts.maxSize ?? 2048));
  let c: HTMLCanvasElement;
  let g: CanvasRenderingContext2D;
  if (opts.eager) {
    [c, g] = makeCanvas(px);
    draw(g, px);
  } else {
    [c, g] = makeCanvas(2);
    g.fillStyle = placeholder;
    g.fillRect(0, 0, 2, 2);
  }
  const t: THREE.Texture = new THREE.CanvasTexture(c);
  t.wrapS = opts.mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  t.wrapT = opts.mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = opts.aniso;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  const maxSize = opts.maxSize ?? 2048;
  // Ordre des candidats : la RÉSOLUTION MAXIMALE disponible d'abord, la variante réduite
  // seulement en repli. (Avant : `-1024` était essayé avant la source pleine taille, donc
  // le desktop affichait les textures IA en 1024 alors que les sources 2048 existaient.)
  // Liste courte et ordonnée par qualité : source pleine taille d'abord (elle est
  // recadrée côté client à `maxSize`), variante réduite en repli, puis textures
  // procédurales précalculées du build. Chaque candidat manquant coûte une requête.
  // Pleine résolution d'abord (les assets sont en 2048² : c'est la HD demandée, et le
  // clamp `maxSize` ne fait que la réduire sur mobile). WebP avant JPEG à taille égale :
  // mêmes pixels, 1 Mo au lieu de 1,2. La variante `-1024` n'est essayée qu'en repli, ou
  // **en premier** si la cible est mobile — alors elle évite de décoder une 2048² juste
  // pour la réduire.
  const small = maxSize <= 1024;
  const full = [`${TEX_AI}${name}.webp`, `${TEX_AI}${name}.jpg`];
  const half = [`${TEX_AI}${name}-1024.webp`, `${TEX_AI}${name}-1024.jpg`];
  const candidates = [
    ...(small ? half : full),
    ...(small ? full : half),
    `${TEX_ASSETS}${name}-${maxSize}.webp`,
    `${TEX_ASSETS}${name}.webp`,
  ];
  void (async () => {
    // 1. override IA, 2. texture build-time, 3. fallback procédural runtime
    let img: ImageBitmap | HTMLImageElement | HTMLCanvasElement | undefined;
    for (const url of candidates) {
      img = await loadImageCapped(url, maxSize);
      if (img) break;
    }
    if (!img) {
      const [c2, g2] = makeCanvas(px);
      draw(g2, px);
      img = c2;
    }
    if (opts.grade) {
      const [cg, gg] = makeCanvas(px);
      try {
        gg.filter = opts.grade;
      } catch {
        /* filtre inconnu : on garde l'image brute */
      }
      gg.drawImage(img as CanvasImageSource, 0, 0, px, px);
      img = cg;
    }
    t.image = img;
    // `dispose()` AVANT `needsUpdate` : three alloue les textures en stockage **immuable**
    // (`texStorage2D`) à la taille du premier téléversement, c'est-à-dire ici le
    // placeholder 2×2. Remplacer ensuite l'image par une 2048 déclenchait
    // « glTexSubImage2D: Offset overflows texture dimensions » et le GPU gardait le
    // placeholder : **tous** les assets IA (sol, enduit, chêne, métal, dorure) étaient
    // silencieusement ignorés. Libérer la texture force une réallocation complète à la
    // bonne dimension au rendu suivant.
    t.dispose();
    t.needsUpdate = true;
  })();
  return t;
}

/* ---------------------------------------------------------------------------
 * Nouvelles textures procédurales (fallback runtime ; remplaçables par IA dans
 * public/assets/textures/ai/ : beam.webp, metal.webp, rug.webp, gilt.webp).
 * ------------------------------------------------------------------------- */

/** Chêne des poutres/mobilier : veine verticale (le long de la poutre = axe v des box). */
export function beamTexture(aniso: number, repeatV = 1, base = '#6a4e32', maxSize = 2048): THREE.Texture {
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
  }, { aniso, repeat: [1, repeatV], maxSize }, base);
}

/** Métal brossé vertical (bronze des châssis de verrière), non sRGB (utilisé comme map neutre). */
export function metalTexture(aniso: number, maxSize = 2048): THREE.Texture {
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
  }, { aniso: Math.min(aniso, 8), repeat: [1, 1], maxSize }, '#4a4136');
}

/**
 * Tapis tissé, champ seamless (motif losangé + trame) — la bordure est posée en
 * géométrie (4 baguettes) donc pas de couture dans la texture. Tuile = 2,6 m.
 */
export function rugTexture(aniso: number, maxSize = 2048): THREE.Texture {
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
  }, { aniso, repeat: [1, 1], maxSize }, '#5f3c31');
}

/** Dorure des cadres : or brossé, studs chauds/froids (map + fallback IA gilt.webp). */
export function giltTexture(aniso: number, maxSize = 1024): THREE.Texture {
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
  }, {
    aniso: Math.min(aniso, 8),
    repeat: [1, 1],
    maxSize,
    // grade : l'asset est une feuille d'or froissée aux plis très marqués. Sur une
    // moulure de 70 mm, ces plis se répétaient en chevrons réguliers (« ruban rayé »).
    // Écrasé à 30 % de contraste, il ne reste qu'une variation de teinte et de brillance
    // — ce qu'on voit réellement d'une dorure à 1,50 m.
    grade: 'contrast(0.62) saturate(1.05) brightness(1.16)',
  }, '#c9a24f');
}

/**
 * Chêne clair (mobilier : bancs, consoles, socles) — slot `oak`, veine verticale.
 * Le fallback procédural est déjà bon ; un asset IA (`public/tex/oak.jpg`, voir
 * docs/prompts-nano-banana.md) prendra le dessus automatiquement.
 */
export function oakTexture(aniso: number, repeatV = 1, maxSize = 2048): THREE.Texture {
  return precalcTexture('oak', 1024, (g, s) => {
    g.fillStyle = '#b48a5c';
    g.fillRect(0, 0, s, s);
    // variation de teinte par bandes larges (débit sur quartier)
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s;
      const w = 12 + Math.random() * s * 0.16;
      g.fillStyle = Math.random() > 0.5 ? 'rgba(214,178,132,0.10)' : 'rgba(108,72,40,0.09)';
      g.fillRect(x, 0, w, s);
    }
    // veines longues et douces
    for (let i = 0; i < 520; i++) {
      const x0 = Math.random() * s;
      const dark = Math.random() > 0.42;
      g.strokeStyle = dark
        ? `rgba(96,62,32,${(0.05 + Math.random() * 0.13).toFixed(3)})`
        : `rgba(226,196,152,${(0.04 + Math.random() * 0.12).toFixed(3)})`;
      g.lineWidth = 0.8 + Math.random() * 2.4;
      g.beginPath();
      for (let y = 0; y <= s; y += 24) {
        const x = x0 + Math.sin(y * 0.006 + i * 0.7) * (6 + (i % 7) * 2) + (Math.random() - 0.5) * 2;
        if (y === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // nœuds discrets
    for (let i = 0; i < 4; i++) {
      const nx = Math.random() * s;
      const ny = Math.random() * s;
      const nr = 4 + Math.random() * 9;
      const rg = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
      rg.addColorStop(0, 'rgba(78,48,24,0.5)');
      rg.addColorStop(0.55, 'rgba(120,80,44,0.22)');
      rg.addColorStop(1, 'rgba(120,80,44,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(nx, ny, nr, 0, 7);
      g.fill();
    }
  }, { aniso, repeat: [1, repeatV], maxSize, eager: true }, '#b48a5c');
}

/**
 * Bois peint (charpente, portiques, menuiseries) — slot `painted` : off-white chaud avec
 * un grain de bois à peine perceptible. C'est ce qui remplace les poutres chêne sombre :
 * la structure se lit en relief et en ombre, jamais en contraste.
 */
export function paintedWoodTexture(aniso: number, repeatV = 1, maxSize = 2048): THREE.Texture {
  return precalcTexture('painted', 1024, (g, s) => {
    g.fillStyle = '#efe9de';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 340; i++) {
      const x0 = Math.random() * s;
      g.strokeStyle = Math.random() > 0.5
        ? `rgba(255,255,255,${(0.05 + Math.random() * 0.10).toFixed(3)})`
        : `rgba(196,184,166,${(0.05 + Math.random() * 0.10).toFixed(3)})`;
      g.lineWidth = 0.8 + Math.random() * 2.2;
      g.beginPath();
      for (let y = 0; y <= s; y += 28) {
        const x = x0 + Math.sin(y * 0.007 + i) * (5 + (i % 5) * 2);
        if (y === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // micro-grain de peinture
    for (let i = 0; i < 9000; i++) {
      const v = 226 + Math.random() * 22;
      g.fillStyle = `rgba(${v | 0},${(v - 4) | 0},${(v - 12) | 0},${(Math.random() * 0.06).toFixed(3)})`;
      g.fillRect(Math.random() * s, Math.random() * s, 1.4, 1.4);
    }
  }, { aniso, repeat: [1, repeatV], maxSize, eager: true }, '#efe9de');
}

/**
 * Ciel de verrière : dégradé froid + nuages très diffus. Utilisé comme `emissiveMap`
 * du vitrage (aucune dépendance à un HDRI, aucun éclairage).
 */
export function skyTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Contexte 2D indisponible');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#f4f9ff');
  grad.addColorStop(0.55, '#e8f1fb');
  grad.addColorStop(1, '#f6f3ec');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // nuages diffus (taches douces, périodiques horizontalement pour rester raccordable)
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.9;
    const rx = 40 + Math.random() * 150;
    const ry = 14 + Math.random() * 40;
    const rg = g.createRadialGradient(x, y, 0, x, y, rx);
    rg.addColorStop(0, `rgba(255,255,255,${(0.10 + Math.random() * 0.22).toFixed(3)})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.beginPath();
    g.arc(0, 0, rx, 0, 7);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Fibre de feuille : carte de **luminance** quasi neutre (fibres, nervures, micro-
 * variegation), et non une couleur verte.
 *
 * Les feuilles portent leur teinte en couleur de sommet ; multiplier deux verts
 * (texture × couleur) donnait un feuillage presque noir dès qu'il était à l'ombre.
 */
export function leafTexture(aniso: number): THREE.Texture {
  return precalcTexture('leaf', 512, (g, s) => {
    g.fillStyle = '#d9d9d2';
    g.fillRect(0, 0, s, s);
    // fibres obliques
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const light = Math.random() > 0.5;
      g.strokeStyle = light
        ? `rgba(255,255,250,${(0.05 + Math.random() * 0.14).toFixed(3)})`
        : `rgba(120,124,104,${(0.04 + Math.random() * 0.12).toFixed(3)})`;
      g.lineWidth = 1 + Math.random() * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 26, y + 14 + Math.random() * 26);
      g.stroke();
    }
    // petites taches de variegation
    for (let i = 0; i < 240; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 4 + Math.random() * 16;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(255,255,255,${(0.05 + Math.random() * 0.1).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
  }, { aniso: Math.min(aniso, 4), repeat: [1, 1], maxSize: 512, eager: true }, '#d9d9d2');
}
