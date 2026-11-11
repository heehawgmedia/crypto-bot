/**
 * Optional text recognition for room labels and dimension strings, powered by Tesseract.js loaded
 * on demand from a CDN. Needs an internet connection the first time; fails gracefully without one.
 */
import type { RoomType } from '../model/types';

export interface OcrWord {
  text: string;
  /** Bounding box in the pixels of the image that was recognized. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

interface TesseractWorker {
  recognize(image: HTMLCanvasElement): Promise<{ data: { words?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>;
  terminate(): Promise<unknown>;
}
interface TesseractModule {
  createWorker(lang: string, oem?: number, options?: { logger?: (m: { status: string; progress: number }) => void }): Promise<TesseractWorker>;
}

const TESSERACT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not download the text-recognition library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

export async function recognizeWords(canvas: HTMLCanvasElement, onProgress?: (status: string, progress: number) => void): Promise<OcrWord[]> {
  await loadScript(TESSERACT_URL);
  const T = (window as unknown as { Tesseract?: TesseractModule }).Tesseract;
  if (!T) throw new Error('Text recognition library failed to initialise.');
  const worker = await T.createWorker('eng', 1, { logger: (m) => onProgress?.(m.status, m.progress) });
  try {
    const { data } = await worker.recognize(canvas);
    return (data.words ?? [])
      .filter((w) => w.text.trim().length > 0)
      .map((w) => ({ text: w.text.trim(), confidence: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }));
  } finally {
    await worker.terminate();
  }
}

const KEYWORDS: [RegExp, RoomType, string?][] = [
  [/\b(master|primary|owner'?s?)\b.*\b(bath|ba)\b|\b(bath|ba)\b.*\b(master|primary)\b/i, 'bathroom', 'Master bath'],
  [/\b(master|primary|owner'?s?)\b/i, 'bedroom', 'Master bedroom'],
  [/\b(powder|half\s*bath|1\/2\s*ba)/i, 'half-bath'],
  [/\b(bath|bathroom|ba|bth)\b/i, 'bathroom'],
  [/\b(bed|bedroom|bdrm|br|bdr)\b/i, 'bedroom'],
  [/\b(kitchen|kit|kitch)\b/i, 'kitchen'],
  [/\b(great|living|family|liv|lvg|lounge)\b/i, 'living'],
  [/\b(dining|din|dinette|nook|breakfast)\b/i, 'dining'],
  [/\b(office|study|den|flex|bonus)\b/i, 'office'],
  [/\b(laundry|laun|ldry|lndry|util|utility|mech|mechanical)\b/i, 'laundry'],
  [/\b(mud|mudroom|entry|foyer)\b/i, 'mudroom'],
  [/\b(closet|clo|wic|w\.i\.c|walk-?in|cl)\b/i, 'closet'],
  [/\b(pantry|pan|pntry)\b/i, 'pantry'],
  [/\b(hall|hallway|corridor)\b/i, 'hallway'],
  [/\b(shop|workshop|barn|rv|bay)\b/i, 'shop'],
  [/\b(garage|gar|carport)\b/i, 'garage'],
];

/** Guess a room type and name from the words found inside it. */
export function classifyLabel(text: string): { type: RoomType; name: string } | undefined {
  const clean = text.replace(/[^\w'./ -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  for (const [re, type, name] of KEYWORDS) {
    if (re.test(clean)) {
      const number = clean.match(/\b([2-9]|#\s*\d)\b/);
      const base = name ?? (type === 'half-bath' ? 'Half bath' : type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' '));
      return { type, name: number && !name ? `${base} ${number[1].replace('#', '').trim()}` : base };
    }
  }
  return undefined;
}

/** Numbers that look like overall dimensions in feet (40', 40'-0", 40 ft, 40x60). */
export function dimensionCandidates(words: OcrWord[]): number[] {
  const out: number[] = [];
  const joined = words.map((w) => w.text).join(' ');
  for (const m of joined.matchAll(/(\d{2,3})\s*(?:['′’]|ft|x|×)/gi)) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 200) out.push(n);
  }
  for (const m of joined.matchAll(/\b(\d{2,3})\s*[x×]\s*(\d{2,3})\b/gi)) {
    for (const n of [Number(m[1]), Number(m[2])]) if (n >= 16 && n <= 200) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => b - a);
}
