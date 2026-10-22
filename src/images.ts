// Image sources: Lorem Picsum (free Unsplash photos) and the user's own files.

export interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
  url: string;
}

const API = 'https://picsum.photos';
/** Longest side of the working image used to cut pieces. */
export const MAX_SIDE = 2048;

export async function listPhotos(page: number, limit = 24): Promise<PicsumPhoto[]> {
  const res = await fetch(`${API}/v2/list?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Picsum list failed: ${res.status}`);
  return res.json();
}

export const thumbUrl = (id: string, size = 240) => `${API}/id/${id}/${size}/${size}`;

export function fullUrl(p: PicsumPhoto): string {
  const s = Math.min(1, MAX_SIDE / Math.max(p.width, p.height));
  return `${API}/id/${p.id}/${Math.round(p.width * s)}/${Math.round(p.height * s)}`;
}

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
