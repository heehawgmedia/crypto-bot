/**
 * Small binary-image toolkit used by the plan importer: masks, separable morphology,
 * connected components and the largest inscribed rectangle. Everything works on flat
 * Uint8Array masks (1 = set) so it runs in Node tests as well as the browser.
 */

export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

export interface Box {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

export const boxW = (b: Box): number => b.x1 - b.x0;
export const boxH = (b: Box): number => b.y1 - b.y0;
export const boxArea = (b: Box): number => boxW(b) * boxH(b);

export function makeMask(w: number, h: number): Mask {
  return { w, h, data: new Uint8Array(w * h) };
}

function pass1D(src: Mask, r: number, horizontal: boolean, mode: 'min' | 'max'): Mask {
  const { w, h } = src;
  const out = makeMask(w, h);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const prefix = new Int32Array(len + 1);
  const win = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    prefix[0] = 0;
    for (let i = 0; i < len; i++) {
      const idx = horizontal ? l * w + i : i * w + l;
      prefix[i + 1] = prefix[i] + src.data[idx];
    }
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - r);
      const hi = Math.min(len - 1, i + r);
      const s = prefix[hi + 1] - prefix[lo];
      const idx = horizontal ? l * w + i : i * w + l;
      out.data[idx] = mode === 'max' ? (s > 0 ? 1 : 0) : s === win ? 1 : 0;
    }
  }
  return out;
}

/** Grow set pixels by a (2r+1) square. */
export const dilate = (m: Mask, r: number): Mask => (r <= 0 ? m : pass1D(pass1D(m, r, true, 'max'), r, false, 'max'));
/** Shrink set pixels by a (2r+1) square (pixels outside the image count as unset). */
export const erode = (m: Mask, r: number): Mask => (r <= 0 ? m : pass1D(pass1D(m, r, true, 'min'), r, false, 'min'));
/** Remove features thinner than ~2r. */
export const open = (m: Mask, r: number): Mask => dilate(erode(m, r), r);
/** Fill gaps narrower than ~2r. */
export const close = (m: Mask, r: number): Mask => erode(dilate(m, r), r);

export function invert(m: Mask): Mask {
  const out = makeMask(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) out.data[i] = m.data[i] ? 0 : 1;
  return out;
}

/** Keep only pixels inside `box` (exclusive bounds). */
export function clipToBox(m: Mask, box: Box): Mask {
  const out = makeMask(m.w, m.h);
  for (let y = Math.max(0, box.y0); y < Math.min(m.h, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x < Math.min(m.w, box.x1); x++) out.data[y * m.w + x] = m.data[y * m.w + x];
  }
  return out;
}

export function countIn(m: Mask, box: Box): number {
  let n = 0;
  for (let y = Math.max(0, box.y0); y < Math.min(m.h, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x < Math.min(m.w, box.x1); x++) n += m.data[y * m.w + x];
  }
  return n;
}

export interface Component extends Box {
  label: number;
  area: number;
  touchesBorder: boolean;
}

/** 4-connected components of set pixels. `labels` holds the component index per pixel, -1 for unset. */
export function components(m: Mask): { labels: Int32Array; comps: Component[] } {
  const { w, h, data } = m;
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const comps: Component[] = [];
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start] !== -1) continue;
    const label = comps.length;
    const c: Component = { label, area: 0, x0: w, y0: h, x1: 0, y1: 0, touchesBorder: false };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (y < c.y0) c.y0 = y;
      if (x + 1 > c.x1) c.x1 = x + 1;
      if (y + 1 > c.y1) c.y1 = y + 1;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.touchesBorder = true;
      if (x > 0 && data[p - 1] && labels[p - 1] === -1) {
        labels[p - 1] = label;
        stack[sp++] = p - 1;
      }
      if (x < w - 1 && data[p + 1] && labels[p + 1] === -1) {
        labels[p + 1] = label;
        stack[sp++] = p + 1;
      }
      if (y > 0 && data[p - w] && labels[p - w] === -1) {
        labels[p - w] = label;
        stack[sp++] = p - w;
      }
      if (y < h - 1 && data[p + w] && labels[p + w] === -1) {
        labels[p + w] = label;
        stack[sp++] = p + w;
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Largest axis-aligned rectangle of set pixels (classic histogram / stack method). */
export function largestRectangle(m: Mask): Box | undefined {
  const { w, h, data } = m;
  const heights = new Int32Array(w + 1);
  const stack = new Int32Array(w + 2);
  let best: Box | undefined;
  let bestArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = data[y * w + x] ? heights[x] + 1 : 0;
    heights[w] = 0;
    let sp = 0;
    for (let x = 0; x <= w; x++) {
      while (sp > 0 && heights[stack[sp - 1]] >= heights[x]) {
        const top = stack[--sp];
        const height = heights[top];
        const left = sp > 0 ? stack[sp - 1] + 1 : 0;
        const area = height * (x - left);
        if (area > bestArea) {
          bestArea = area;
          best = { x0: left, y0: y - height + 1, x1: x, y1: y + 1 };
        }
      }
      stack[sp++] = x;
    }
  }
  return best;
}

/** Mask of one component, cropped to its bounding box. */
export function cropComponent(labels: Int32Array, w: number, c: Component): Mask {
  const out = makeMask(boxW(c), boxH(c));
  for (let y = c.y0; y < c.y1; y++) {
    for (let x = c.x0; x < c.x1; x++) out.data[(y - c.y0) * out.w + (x - c.x0)] = labels[y * w + x] === c.label ? 1 : 0;
  }
  return out;
}

/** Greedily carve a region into rectangles, largest first. */
export function decomposeIntoRects(region: Mask, minSide: number, maxRects = 6): Box[] {
  const work: Mask = { w: region.w, h: region.h, data: new Uint8Array(region.data) };
  const out: Box[] = [];
  for (let i = 0; i < maxRects; i++) {
    const r = largestRectangle(work);
    if (!r || boxW(r) < minSide || boxH(r) < minSide) break;
    out.push(r);
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) work.data[y * work.w + x] = 0;
  }
  return out;
}
