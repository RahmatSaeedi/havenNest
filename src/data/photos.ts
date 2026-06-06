import data from './photos.json';

export interface Photo {
  thumb: string;
  full: string;
  w: number;
  h: number;
  alt: string;
}
export interface VideoItem {
  src: string;
  poster: string | null;
}
export interface PhotoData {
  exterior: Photo[];
  main: Photo[];
  basement: Photo[];
  construction: Photo[];
  video: VideoItem | null;
}

export type GallerySet = 'exterior' | 'main' | 'basement' | 'construction';

const photos = data as unknown as PhotoData;
export default photos;

export const getSet = (name: GallerySet): Photo[] => photos[name] ?? [];

export const getCover = (name: GallerySet, index = 0): Photo | undefined => {
  const set = getSet(name);
  if (set.length === 0) return undefined;
  return set[index % set.length] ?? set[0];
};
