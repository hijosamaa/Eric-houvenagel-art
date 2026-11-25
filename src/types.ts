export interface RoomDef {
  id: string;
  name: string;
  order: number;
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
  ratio: number;
}

export interface GalleryData {
  artist: string;
  tagline: string;
  rooms: RoomDef[];
  works: Work[];
}
