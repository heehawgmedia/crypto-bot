/** Loading plan files (images or PDF pages) into an upright canvas the detector and the editor can use. */

export interface PlanRaster {
  name: string;
  /** Upright, rotation applied. */
  canvas: HTMLCanvasElement;
  /** Original decoded source, before rotation. */
  source: HTMLCanvasElement;
  rotation: 0 | 90 | 180 | 270;
  pageCount: number;
  page: number;
}

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const isPdf = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

export async function loadImageFile(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file).catch(() => undefined);
  if (bitmap) {
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return c;
  }
  // Fallback for formats createImageBitmap rejects (older browsers, SVG).
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('That file is not an image the browser can read.'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')?.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function rotateCanvas(src: HTMLCanvasElement, rotation: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (rotation === 0) return src;
  const c = document.createElement('canvas');
  const swap = rotation === 90 || rotation === 270;
  c.width = swap ? src.height : src.width;
  c.height = swap ? src.width : src.height;
  const ctx = c.getContext('2d');
  if (!ctx) return src;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Downscale so the longest side is at most `maxSide`; returns the pixels and the scale factor applied. */
export function toWorkingImage(src: HTMLCanvasElement, maxSide = 1400): { image: GrayImage; factor: number } {
  const factor = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * factor));
  const h = Math.max(1, Math.round(src.height * factor));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  return { image: { width: w, height: h, data: id.data }, factor };
}
