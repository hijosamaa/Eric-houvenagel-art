export interface RoomDef {
  id: string;
  name: string;
  order: number;
}

/** Une variante responsive d'une œuvre : chemins relatifs (base = BASE_URL) par format. */
export interface WorkImage {
  width: number;
  webp: string;
  avif: string;
  /** JPEG existant à cette largeur ('' si aucun) — sert de fallback `src`. */
  jpeg: string;
}

export interface Work {
  id: string;
  title: string;
  year: number;
  medium: string;
  dimensions: string;
  description: string;
  room: string;
  order: number;
  image: string;
  imageFull: string;
  /** Variantes WebP/AVIF/JPEG triées par largeur croissante (itération D). */
  images: WorkImage[];
  /** Data-URL base64 d'un aperçu 16px flouté (LQIP) pour le fond pendant le chargement. */
  lqip: string;
  ratio: number;
}

export interface GalleryData {
  artist: string;
  tagline: string;
  rooms: RoomDef[];
  works: Work[];
}
