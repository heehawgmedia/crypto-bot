/** Renders one level of a plan as a dimensioned SVG floor plan. Pure string output, so it runs in Node and the browser. */
import { ROOM_TYPES } from '../model/catalog';
import { deriveWalls, footprintRect, inwardDir, porchRects, rectMinus, solidSpans, type WallSegment } from '../model/geometry';
import type { Plan, Room } from '../model/types';

export interface PlanSvgOptions {
  /** Pixels per foot. */
  scale?: number;
  /** Draw porches, exterior doors and windows (main level). Off for an upper level. */
  exterior?: boolean;
  /** Shade the part of the footprint that has no upper floor (open to the great room below). */
  upperLevel?: boolean;
  title?: string;
}

const SHORT: Record<string, string> = {
  'Walk-in closet': 'WIC',
  'Half bath': '½ bath',
  'Primary bath': 'Primary bath',
  'Mechanical': 'Mech',
  'Secure storage': 'Secure storage',
  'Safe room and coats': 'Safe room',
  'Laundry and mudroom': 'Laundry / mud',
  'Mudroom entry': 'Mudroom',
  'Upstairs bath': 'Bath',
  'Attic storage': 'Attic storage',
  'Suite hall': 'Hall',
  'Upper hall': 'Hall',
  'Stair to loft': 'Stair up',
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Break a label into lines that fit `maxChars`, or return undefined when even single words do not fit. */
function wrap(label: string, maxChars: number): string[] | undefined {
  const words = label.split(' ');
  if (words.some((w) => w.length > maxChars)) return undefined;
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wallLine(seg: WallSegment, a: number, b: number, s: number, ox: number, oz: number): string {
  return seg.axis === 'x'
    ? `x1="${n(ox + a * s)}" y1="${n(oz + seg.at * s)}" x2="${n(ox + b * s)}" y2="${n(oz + seg.at * s)}"`
    : `x1="${n(ox + seg.at * s)}" y1="${n(oz + a * s)}" x2="${n(ox + seg.at * s)}" y2="${n(oz + b * s)}"`;
}

export function planSvg(plan: Plan, rooms: Room[], opts: PlanSvgOptions = {}): string {
  const s = opts.scale ?? 9;
  const exterior = opts.exterior !== false;
  const porches = exterior ? porchRects(plan) : [];
  let minX = 0;
  let maxX = plan.width;
  let minZ = 0;
  let maxZ = plan.depth;
  for (const p of porches) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z + p.d);
  }
  const mL = 34;
  const mT = 30;
  const mR = 14;
  const mB = 20;
  const ox = mL - minX * s;
  const oz = mT - minZ * s;
  const W = (maxX - minX) * s + mL + mR;
  const H = (maxZ - minZ) * s + mT + mB;
  const X = (x: number): number => ox + x * s;
  const Z = (z: number): number => oz + z * s;
  const out: string[] = [];
  const label = opts.title ?? plan.name;
  out.push(`<svg class="plan" viewBox="0 0 ${n(W)} ${n(H)}" role="img" aria-label="${esc(label)} floor plan" xmlns="http://www.w3.org/2000/svg">`);

  for (const p of porches) {
    out.push(`<rect class="plan-porch" x="${n(X(p.x))}" y="${n(Z(p.z))}" width="${n(p.w * s)}" height="${n(p.d * s)}"/>`);
  }
  for (const p of porches) {
    const horizontal = p.side === 'N' || p.side === 'S';
    const cx = X(p.x + p.w / 2);
    const cz = Z(p.z + p.d / 2);
    const depth = horizontal ? p.d : p.w;
    const text = `Covered porch, ${depth} ft deep`;
    out.push(
      horizontal
        ? `<text class="plan-porch-label" x="${n(cx)}" y="${n(cz)}">${text}</text>`
        : `<text class="plan-porch-label" x="${n(cx)}" y="${n(cz)}" transform="rotate(-90 ${n(cx)} ${n(cz)})">${text}</text>`,
    );
  }

  out.push(`<rect class="plan-floor" x="${n(X(0))}" y="${n(Z(0))}" width="${n(plan.width * s)}" height="${n(plan.depth * s)}"/>`);
  if (opts.upperLevel) {
    out.push(`<rect class="plan-void" x="${n(X(0))}" y="${n(Z(0))}" width="${n(plan.width * s)}" height="${n(plan.depth * s)}"/>`);
    for (const r of rooms) out.push(`<rect class="plan-floor" x="${n(X(r.x))}" y="${n(Z(r.z))}" width="${n(r.w * s)}" height="${n(r.d * s)}"/>`);
    const voids = rectMinus(footprintRect(plan), rooms).sort((a, b) => b.w * b.d - a.w * a.d);
    const big = voids[0];
    if (big && big.w * s > 120 && big.d * s > 30) {
      out.push(`<text class="plan-zone-label" x="${n(X(big.x + big.w / 2))}" y="${n(Z(big.z + big.d / 2))}" font-size="10">Open to the room below</text>`);
    }
  }

  for (const r of rooms) {
    const color = ROOM_TYPES[r.type].color;
    out.push(`<rect x="${n(X(r.x))}" y="${n(Z(r.z))}" width="${n(r.w * s)}" height="${n(r.d * s)}" fill="${color}" fill-opacity="${r.open ? 0.16 : 0.34}"/>`);
    if (r.type === 'stair') {
      const along = r.w >= r.d;
      const steps = Math.floor((along ? r.w : r.d) / 1);
      for (let i = 1; i < steps; i++) {
        out.push(
          along
            ? `<line class="plan-tread" x1="${n(X(r.x + i))}" y1="${n(Z(r.z))}" x2="${n(X(r.x + i))}" y2="${n(Z(r.z + r.d))}"/>`
            : `<line class="plan-tread" x1="${n(X(r.x))}" y1="${n(Z(r.z + i))}" x2="${n(X(r.x + r.w))}" y2="${n(Z(r.z + i))}"/>`,
        );
      }
    }
  }

  const level: Plan = exterior ? { ...plan, rooms } : { ...plan, rooms, exteriorDoors: [], windows: [] };
  for (const seg of deriveWalls(level)) {
    const cls = seg.exterior ? 'plan-wall-ext' : 'plan-wall-int';
    for (const [a, b] of solidSpans(seg)) out.push(`<line class="${cls}" ${wallLine(seg, a, b, s, ox, oz)}/>`);
    for (const o of seg.openings) {
      if (o.kind === 'window') {
        out.push(`<line class="plan-window" ${wallLine(seg, o.start, o.end, s, ox, oz)}/>`);
      } else if (o.kind === 'overhead') {
        out.push(`<line class="plan-overhead" ${wallLine(seg, o.start, o.end, s, ox, oz)}/>`);
      } else if (o.kind === 'door') {
        const wide = o.end - o.start > 3.6;
        if (wide) {
          out.push(`<line class="plan-glass-door" ${wallLine(seg, o.start, o.end, s, ox, oz)}/>`);
          continue;
        }
        const dir = seg.exterior && seg.side ? inwardDir(seg.side) : 1;
        const len = (o.end - o.start) * s;
        const hx = seg.axis === 'x' ? X(o.start) : X(seg.at);
        const hz = seg.axis === 'x' ? Z(seg.at) : Z(o.start);
        // Leaf drawn open at 90 degrees, with the quarter-circle swing.
        const leafX = seg.axis === 'x' ? hx : hx + dir * len;
        const leafZ = seg.axis === 'x' ? hz + dir * len : hz;
        const endX = seg.axis === 'x' ? hx + len : hx;
        const endZ = seg.axis === 'x' ? hz : hz + len;
        const sweep = (seg.axis === 'x') === dir > 0 ? 0 : 1;
        out.push(`<path class="plan-door" d="M${n(hx)} ${n(hz)} L${n(leafX)} ${n(leafZ)} A${n(len)} ${n(len)} 0 0 ${sweep} ${n(endX)} ${n(endZ)}"/>`);
      }
    }
  }

  for (const r of rooms) {
    if (r.type === 'hallway' && Math.min(r.w, r.d) < 5 && r.w * r.d < 60) continue;
    const pw = r.w * s;
    const ph = r.d * s;
    const cx = X(r.x + r.w / 2);
    const cz = Z(r.z + r.d / 2);
    const vertical = pw < 46 && ph > pw * 1.6;
    const availW = vertical ? ph : pw;
    const availH = vertical ? pw : ph;
    let fs = Math.min(12.5, Math.max(8, s * 1.25));
    let lines: string[] | undefined;
    for (const candidate of [r.name, SHORT[r.name] ?? r.name]) {
      for (const size of [fs, 9.5, 8.5, 7.5]) {
        const maxChars = Math.floor((availW - 4) / (size * 0.56));
        const wrapped = wrap(candidate, maxChars);
        if (wrapped && wrapped.length * size * 1.15 <= availH - 3) {
          lines = wrapped;
          fs = size;
          break;
        }
      }
      if (lines) break;
    }
    if (!lines) continue;
    const dims = `${r.w}′ × ${r.d}′`;
    const dimSize = Math.max(7, fs - 2);
    const showDims = !r.open && r.type !== 'stair' && dims.length * dimSize * 0.56 <= availW - 4 && (lines.length + 1) * fs * 1.2 <= availH - 2;
    const total = lines.length + (showDims ? 1 : 0);
    const startY = cz - ((total - 1) * fs * 1.15) / 2;
    const rot = vertical ? ` transform="rotate(-90 ${n(cx)} ${n(cz)})"` : '';
    const cls = r.open ? 'plan-zone-label' : 'plan-room-label';
    out.push(`<g${rot}>`);
    lines.forEach((ln, i) => out.push(`<text class="${cls}" x="${n(cx)}" y="${n(startY + i * fs * 1.15)}" font-size="${n(fs)}">${esc(ln)}</text>`));
    if (showDims) out.push(`<text class="plan-dim-label" x="${n(cx)}" y="${n(startY + lines.length * fs * 1.15)}" font-size="${n(dimSize)}">${dims}</text>`);
    out.push('</g>');
  }

  // Overall dimensions along the top and left edges.
  const dy = Z(minZ) - 12;
  out.push(`<line class="plan-dimline" x1="${n(X(0))}" y1="${n(dy)}" x2="${n(X(plan.width))}" y2="${n(dy)}"/>`);
  out.push(`<line class="plan-dimline" x1="${n(X(0))}" y1="${n(dy - 4)}" x2="${n(X(0))}" y2="${n(dy + 4)}"/><line class="plan-dimline" x1="${n(X(plan.width))}" y1="${n(dy - 4)}" x2="${n(X(plan.width))}" y2="${n(dy + 4)}"/>`);
  out.push(`<text class="plan-overall" x="${n(X(plan.width / 2))}" y="${n(dy - 5)}">${plan.width} ft</text>`);
  const dx = X(minX) - 12;
  out.push(`<line class="plan-dimline" x1="${n(dx)}" y1="${n(Z(0))}" x2="${n(dx)}" y2="${n(Z(plan.depth))}"/>`);
  out.push(`<line class="plan-dimline" x1="${n(dx - 4)}" y1="${n(Z(0))}" x2="${n(dx + 4)}" y2="${n(Z(0))}"/><line class="plan-dimline" x1="${n(dx - 4)}" y1="${n(Z(plan.depth))}" x2="${n(dx + 4)}" y2="${n(Z(plan.depth))}"/>`);
  const my = Z(plan.depth / 2);
  out.push(`<text class="plan-overall" x="${n(dx - 6)}" y="${n(my)}" transform="rotate(-90 ${n(dx - 6)} ${n(my)})">${plan.depth} ft</text>`);
  if (exterior) out.push(`<text class="plan-front" x="${n(X(plan.width / 2))}" y="${n(H - 6)}">Front (entry side)</text>`);
  out.push('</svg>');
  return out.join('');
}

/** Styles for {@link planSvg}; colors come from the host page's CSS variables. */
export const PLAN_SVG_CSS = `
.plan { display: block; width: 100%; height: auto; font-family: inherit; }
.plan text { text-anchor: middle; dominant-baseline: middle; fill: var(--ink, #17212a); }
.plan-floor { fill: var(--plan-floor, #fbfaf6); }
.plan-void { fill: var(--plan-void, #dfe4e8); }
.plan-porch { fill: var(--plan-porch, #ece6d6); stroke: var(--muted, #53616d); stroke-width: 1; stroke-dasharray: 4 3; }
.plan-porch-label { font-size: 9px; fill: var(--muted, #53616d) !important; }
.plan-wall-ext { stroke: var(--ink, #17212a); stroke-width: 4.5; stroke-linecap: square; }
.plan-wall-int { stroke: var(--ink, #17212a); stroke-width: 2.2; stroke-linecap: square; }
.plan-window { stroke: var(--plan-glass, #2f7fc1); stroke-width: 3; }
.plan-glass-door { stroke: var(--plan-glass, #2f7fc1); stroke-width: 3; stroke-dasharray: 7 2; }
.plan-overhead { stroke: var(--muted, #53616d); stroke-width: 3; stroke-dasharray: 5 3; }
.plan-door { fill: none; stroke: var(--plan-door, #8b5a2b); stroke-width: 1.2; }
.plan-tread { stroke: var(--muted, #53616d); stroke-width: 0.6; }
.plan-room-label { font-weight: 600; }
.plan-zone-label { font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; fill: var(--muted, #53616d) !important; }
.plan-dim-label { fill: var(--muted, #53616d) !important; font-variant-numeric: tabular-nums; }
.plan-dimline { stroke: var(--muted, #53616d); stroke-width: 1; }
.plan-overall { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.plan-front { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; fill: var(--muted, #53616d) !important; }
`;
