// Image sources: Lorem Picsum (free Unsplash photos), Wikimedia Commons
// featured pictures (bright, colourful themes) and the user's own files.

/** A photo from one of the online sources, ready for the gallery. */
export interface RemotePhoto {
  id: string;
  width: number;
  height: number;
  thumb: string;
  full: string;
  /** Shown on the finish screen and saved with the game. */
  credit: string;
  label: string;
}

export interface PhotoSource {
  id: string;
  name: string;
  /** Wikimedia Commons category searched (with subcategories); Picsum when absent. */
  category?: string;
}

export const SOURCES: PhotoSource[] = [
  { id: 'photos', name: 'Photos' },
  { id: 'flowers', name: 'Flowers', category: 'Featured_pictures_of_flowers' },
  { id: 'landscapes', name: 'Landscapes', category: 'Featured_pictures_of_landscapes' },
  { id: 'sunsets', name: 'Sunsets', category: 'Featured_pictures_of_sunsets' },
  { id: 'animals', name: 'Animals', category: 'Featured_pictures_of_animals' },
  { id: 'space', name: 'Space', category: 'Featured_pictures_of_astronomy' },
  { id: 'art', name: 'Art', category: 'Featured_pictures_of_paintings' },
];

/** Longest side of the working image used to cut pieces. */
export const MAX_SIDE = 2048;

// ---- Lorem Picsum -------------------------------------------------------

const PICSUM = 'https://picsum.photos';

interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
}

const picsumThumb = (id: string, size = 240) => `${PICSUM}/id/${id}/${size}/${size}`;

export async function listPicsum(page: number, limit = 24): Promise<RemotePhoto[]> {
  const res = await fetch(`${PICSUM}/v2/list?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Picsum list failed: ${res.status}`);
  const photos: PicsumPhoto[] = await res.json();
  return photos.map((p) => {
    const s = Math.min(1, MAX_SIDE / Math.max(p.width, p.height));
    return {
      id: `picsum:${p.id}`,
      width: p.width,
      height: p.height,
      thumb: picsumThumb(p.id),
      full: `${PICSUM}/id/${p.id}/${Math.round(p.width * s)}/${Math.round(p.height * s)}`,
      credit: `Photo by ${p.author} on Unsplash`,
      label: `Photo by ${p.author}`,
    };
  });
}

// ---- Wikimedia Commons --------------------------------------------------

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
/** Commons only serves thumbnails at these standard widths. */
const THUMB_WIDTH = 330;

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: {
    width: number;
    height: number;
    thumburl?: string;
    extmetadata?: Record<string, { value: string } | undefined>;
  }[];
}

/** Commons metadata fields hold HTML; keep just the text. */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Picks a standard Commons thumbnail width whose longest side is close to MAX_SIDE. */
export function commonsFullWidth(width: number, height: number): number {
  const target = (MAX_SIDE * width) / Math.max(width, height);
  const fits = [960, 1280, 1920].filter((w) => w <= width);
  // Smallest standard width that still covers the target, else the largest available.
  return fits.find((w) => w >= target * 0.9) ?? fits[fits.length - 1] ?? 960;
}

export async function listCommons(category: string, limit = 24): Promise<RemotePhoto[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `deepcat:${category} filetype:bitmap`,
    gsrsort: 'random',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName',
    iiurlwidth: String(THUMB_WIDTH),
  });
  const res = await fetch(`${COMMONS}?${params}`);
  if (!res.ok) throw new Error(`Commons search failed: ${res.status}`);
  const data: { query?: { pages?: CommonsPage[] } } = await res.json();
  const photos: RemotePhoto[] = [];
  for (const page of data.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    const thumb = info?.thumburl;
    if (!info || !thumb?.includes(`/${THUMB_WIDTH}px-`)) continue;
    const { width, height } = info;
    // Skip small images and long panoramas, which make poor puzzles.
    if (Math.min(width, height) < 1000 || Math.max(width, height) > 2.5 * Math.min(width, height)) {
      continue;
    }
    const meta = info.extmetadata ?? {};
    const artist = plainText(meta.Artist?.value ?? '') || 'Unknown author';
    const license = plainText(meta.LicenseShortName?.value ?? '');
    const full = thumb.replace(`/${THUMB_WIDTH}px-`, `/${commonsFullWidth(width, height)}px-`);
    photos.push({
      id: `commons:${page.pageid}`,
      width,
      height,
      thumb,
      full,
      credit: `${artist}${license ? ` · ${license}` : ''} · Wikimedia Commons`,
      label: page.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
    });
  }
  return photos;
}

// ---- shared -------------------------------------------------------------

export async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  return res.blob();
}

/**
 * Decodes an image (honouring EXIF orientation), scales it down to
 * MAX_SIDE and re-encodes it, so saved games reload the exact same pixels.
 */
export async function prepareImage(source: Blob): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const decoded = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
  const w = Math.round(decoded.width * s);
  const h = Math.round(decoded.height * s);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded, 0, 0, w, h);
  decoded.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92),
  );
  return { blob, bitmap: await createImageBitmap(blob) };
}
