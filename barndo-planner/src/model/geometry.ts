import { EXTERIOR_DOOR_KINDS, INTERIOR_DOOR_HEIGHT, ROOM_TYPES, WINDOW_KINDS } from './catalog';
import { SIDES, type Plan, type Room, type RoomDoor, type Side } from './types';

export const EPS = 1e-6;
/** Exterior wall thickness, feet (8" girts + panels). */
export const EXT_WALL_T = 0.67;
/** Interior partition thickness, feet (2x4 + drywall). */
export const INT_WALL_T = 0.42;
export const ROOF_OVERHANG = 1.5;
export const MIN_ROOM = 4;

export type Axis = 'x' | 'z';

/** An axis-aligned line in plan: `axis` is the direction the line runs, `at` its fixed coordinate. */
export interface Line {
  axis: Axis;
  at: number;
  start: number;
  end: number;
}

export type OpeningKind = 'door' | 'opening' | 'window' | 'overhead';

export interface Opening {
  start: number;
  end: number;
  bottom: number;
  top: number;
  kind: OpeningKind;
}

export interface WallSegment extends Line {
  exterior: boolean;
  side?: Side;
  openings: Opening[];
}

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const snap = (v: number, step = 1): number => Math.round(v / step) * step;

export const roomArea = (r: Rect): number => r.w * r.d;
export const isShopRoom = (r: Room): boolean => ROOM_TYPES[r.type].shop === true;
export const isWetRoom = (r: Room): boolean => ROOM_TYPES[r.type].wet === true;

export function roomsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;
}

export function withinFootprint(plan: Plan, r: Rect): boolean {
  return r.x >= -EPS && r.z >= -EPS && r.x + r.w <= plan.width + EPS && r.z + r.d <= plan.depth + EPS;
}

export function roomFits(plan: Plan, r: Rect, ignoreId?: string): boolean {
  if (r.w < MIN_ROOM - EPS || r.d < MIN_ROOM - EPS) return false;
  if (!withinFootprint(plan, r)) return false;
  return !plan.rooms.some((o) => o.id !== ignoreId && roomsOverlap(o, r));
}

export function roomAt(plan: Plan, x: number, z: number): Room | undefined {
  return plan.rooms.find((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);
}

/** Scan the footprint for the first spot where a w×d room fits. */
export function findFreeSpot(plan: Plan, w: number, d: number): { x: number; z: number } | undefined {
  for (let z = 0; z + d <= plan.depth + EPS; z += 1) {
    for (let x = 0; x + w <= plan.width + EPS; x += 1) {
      if (roomFits(plan, { x, z, w, d })) return { x, z };
    }
  }
  return undefined;
}

export function edgeLine(r: Rect, side: Side): Line {
  switch (side) {
    case 'N':
      return { axis: 'x', at: r.z, start: r.x, end: r.x + r.w };
    case 'S':
      return { axis: 'x', at: r.z + r.d, start: r.x, end: r.x + r.w };
    case 'W':
      return { axis: 'z', at: r.x, start: r.z, end: r.z + r.d };
    case 'E':
      return { axis: 'z', at: r.x + r.w, start: r.z, end: r.z + r.d };
  }
}

export const footprintRect = (plan: Plan): Rect => ({ x: 0, z: 0, w: plan.width, d: plan.depth });
export const sideLine = (plan: Plan, side: Side): Line => edgeLine(footprintRect(plan), side);
export const edgeLength = (r: Rect, side: Side): number => (side === 'N' || side === 'S' ? r.w : r.d);

export function doorInterval(r: Rect, door: RoomDoor): Line {
  const e = edgeLine(r, door.side);
  return { axis: e.axis, at: e.at, start: e.start + door.offset, end: e.start + door.offset + door.width };
}

/** If the line lies on the building perimeter, return which side. */
export function perimeterSide(plan: Plan, axis: Axis, at: number): Side | undefined {
  if (axis === 'x') {
    if (near(at, 0)) return 'N';
    if (near(at, plan.depth)) return 'S';
  } else {
    if (near(at, 0)) return 'W';
    if (near(at, plan.width)) return 'E';
  }
  return undefined;
}

/** Direction (+1/-1 along the perpendicular axis) that points into the building from a perimeter side. */
export function inwardDir(side: Side): number {
  return side === 'N' || side === 'W' ? 1 : -1;
}

export function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = list
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number])
    .filter(([a, b]) => b - a > EPS)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

const KIND_RANK: Record<OpeningKind, number> = { overhead: 3, door: 2, opening: 1, window: 0 };

function mergeOpenings(list: Opening[]): Opening[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Opening[] = [];
  for (const o of sorted) {
    const last = out[out.length - 1];
    if (last && o.start < last.end - EPS) {
      last.end = Math.max(last.end, o.end);
      last.bottom = Math.min(last.bottom, o.bottom);
      last.top = Math.max(last.top, o.top);
      if (KIND_RANK[o.kind] > KIND_RANK[last.kind]) last.kind = o.kind;
    } else out.push({ ...o });
  }
  return out;
}

interface LineAcc {
  axis: Axis;
  at: number;
  intervals: [number, number][];
  openings: Opening[];
  exterior: boolean;
  side?: Side;
}

/**
 * Derive every wall in the plan: the four exterior walls plus de-duplicated interior partitions
 * along room edges, each with its door and window openings.
 */
export function deriveWalls(plan: Plan): WallSegment[] {
  const lines = new Map<string, LineAcc>();
  const get = (axis: Axis, at: number): LineAcc => {
    const key = `${axis}:${at.toFixed(3)}`;
    let l = lines.get(key);
    if (!l) {
      l = { axis, at, intervals: [], openings: [], exterior: false };
      lines.set(key, l);
    }
    return l;
  };

  for (const side of SIDES) {
    const l = sideLine(plan, side);
    const acc = get(l.axis, l.at);
    acc.intervals.push([l.start, l.end]);
    acc.exterior = true;
    acc.side = side;
  }

  const doorTop = Math.min(INTERIOR_DOOR_HEIGHT, plan.wallHeight - 0.5);
  for (const room of plan.rooms) {
    for (const side of SIDES) {
      const e = edgeLine(room, side);
      if (!perimeterSide(plan, e.axis, e.at)) get(e.axis, e.at).intervals.push([e.start, e.end]);
    }
    for (const door of room.doors) {
      const di = doorInterval(room, door);
      get(di.axis, di.at).openings.push({
        start: di.start,
        end: di.end,
        bottom: 0,
        top: doorTop,
        kind: door.width > 3.5 ? 'opening' : 'door',
      });
    }
  }

  for (const d of plan.exteriorDoors) {
    const l = sideLine(plan, d.side);
    const k = EXTERIOR_DOOR_KINDS[d.kind];
    get(l.axis, l.at).openings.push({
      start: l.start + d.offset,
      end: l.start + d.offset + k.width,
      bottom: 0,
      top: Math.min(k.height, plan.wallHeight - 1),
      kind: d.kind.startsWith('overhead') ? 'overhead' : 'door',
    });
  }

  for (const w of plan.windows) {
    const l = sideLine(plan, w.side);
    const k = WINDOW_KINDS[w.kind];
    const top = Math.min(k.sill + k.height, plan.wallHeight - 0.75);
    get(l.axis, l.at).openings.push({
      start: l.start + w.offset,
      end: l.start + w.offset + k.width,
      bottom: Math.min(k.sill, top - 1),
      top,
      kind: 'window',
    });
  }

  const out: WallSegment[] = [];
  for (const L of lines.values()) {
    const merged = mergeIntervals(L.intervals);
    const openings = mergeOpenings(L.openings);
    for (const [s, e] of merged) {
      const ops = openings
        .filter((o) => o.end > s + EPS && o.start < e - EPS)
        .map((o) => ({ ...o, start: Math.max(o.start, s), end: Math.min(o.end, e) }));
      out.push({ axis: L.axis, at: L.at, start: s, end: e, exterior: L.exterior, side: L.side, openings: ops });
    }
  }
  return out;
}

/** The solid (non-opening) spans of a wall segment. */
export function solidSpans(seg: WallSegment): [number, number][] {
  const out: [number, number][] = [];
  let cur = seg.start;
  for (const o of seg.openings) {
    if (o.start > cur + EPS) out.push([cur, o.start]);
    cur = Math.max(cur, o.end);
  }
  if (seg.end > cur + EPS) out.push([cur, seg.end]);
  return out;
}

export interface WallHit {
  wall: WallSegment;
  /** Position along the wall's axis. */
  t: number;
  dist: number;
}

export function nearestWall(walls: WallSegment[], x: number, z: number): WallHit | undefined {
  let best: WallHit | undefined;
  for (const wall of walls) {
    const along = wall.axis === 'x' ? x : z;
    const perp = wall.axis === 'x' ? z : x;
    const t = clamp(along, wall.start, wall.end);
    const dist = Math.hypot(along - t, perp - wall.at);
    if (!best || dist < best.dist) best = { wall, t, dist };
  }
  return best;
}

/** Rooms that have an edge on the given line covering position t. */
export function roomsOnLine(plan: Plan, axis: Axis, at: number, t: number): { room: Room; side: Side }[] {
  const out: { room: Room; side: Side }[] = [];
  for (const room of plan.rooms) {
    for (const side of SIDES) {
      const e = edgeLine(room, side);
      if (e.axis === axis && near(e.at, at) && t >= e.start - EPS && t <= e.end + EPS) out.push({ room, side });
    }
  }
  return out;
}

/** Keep doors inside their wall after a room is moved or resized; drop the ones that can no longer fit. */
export function sanitizeDoors(room: Room): void {
  room.doors = room.doors
    .filter((d) => edgeLength(room, d.side) >= d.width - EPS)
    .map((d) => ({ ...d, offset: clamp(d.offset, 0, edgeLength(room, d.side) - d.width) }));
}

/** Shrink / move a room so it stays inside the footprint (used when the footprint changes). */
export function clampRoomToFootprint(plan: Plan, room: Room): void {
  room.w = clamp(room.w, MIN_ROOM, Math.max(MIN_ROOM, plan.width));
  room.d = clamp(room.d, MIN_ROOM, Math.max(MIN_ROOM, plan.depth));
  room.x = clamp(room.x, 0, Math.max(0, plan.width - room.w));
  room.z = clamp(room.z, 0, Math.max(0, plan.depth - room.d));
  sanitizeDoors(room);
}

export interface RoofMetrics {
  overhang: number;
  /** Distance across the building perpendicular to the ridge. */
  span: number;
  /** Length of the building along the ridge. */
  length: number;
  slope: number;
  ridgeHeight: number;
  eaveHeight: number;
  rafterLength: number;
  /** Total roof surface, square feet. */
  area: number;
}

export function roofMetrics(plan: Plan): RoofMetrics {
  const overhang = ROOF_OVERHANG;
  const span = plan.ridgeAxis === 'x' ? plan.depth : plan.width;
  const length = plan.ridgeAxis === 'x' ? plan.width : plan.depth;
  const slope = plan.roofPitch / 12;
  const ridgeHeight = plan.wallHeight + (span / 2) * slope;
  const halfRun = span / 2 + overhang;
  const rafterLength = halfRun * Math.sqrt(1 + slope * slope);
  return {
    overhang,
    span,
    length,
    slope,
    ridgeHeight,
    eaveHeight: plan.wallHeight - overhang * slope,
    rafterLength,
    area: 2 * rafterLength * (length + 2 * overhang),
  };
}

/** Exterior wall surface including the two gable triangles. */
export function exteriorWallArea(plan: Plan): number {
  const m = roofMetrics(plan);
  const perimeter = 2 * (plan.width + plan.depth);
  const gables = m.span * (m.ridgeHeight - plan.wallHeight);
  return perimeter * plan.wallHeight + gables;
}

export interface PorchRect extends Rect {
  side: Side;
}

/** Porch slabs per side; porches on adjacent sides wrap around the corner. */
export function porchRects(plan: Plan): PorchRect[] {
  const p = plan.porches;
  const out: PorchRect[] = [];
  const x0 = p.W > 0 ? -p.W : 0;
  const x1 = p.E > 0 ? plan.width + p.E : plan.width;
  if (p.N > 0) out.push({ side: 'N', x: x0, z: -p.N, w: x1 - x0, d: p.N });
  if (p.S > 0) out.push({ side: 'S', x: x0, z: plan.depth, w: x1 - x0, d: p.S });
  if (p.W > 0) out.push({ side: 'W', x: -p.W, z: 0, w: p.W, d: plan.depth });
  if (p.E > 0) out.push({ side: 'E', x: plan.width, z: 0, w: p.E, d: plan.depth });
  return out;
}

export const porchArea = (plan: Plan): number => porchRects(plan).reduce((s, r) => s + r.w * r.d, 0);

/** Decompose `outer` minus `holes` into non-overlapping rectangles (strip decomposition). */
export function rectMinus(outer: Rect, holes: Rect[]): Rect[] {
  const zs = new Set<number>([outer.z, outer.z + outer.d]);
  const clipped = holes
    .map((h) => ({
      x: Math.max(h.x, outer.x),
      z: Math.max(h.z, outer.z),
      x2: Math.min(h.x + h.w, outer.x + outer.w),
      z2: Math.min(h.z + h.d, outer.z + outer.d),
    }))
    .filter((h) => h.x2 - h.x > EPS && h.z2 - h.z > EPS);
  for (const h of clipped) {
    zs.add(h.z);
    zs.add(h.z2);
  }
  const zList = [...zs].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i < zList.length - 1; i++) {
    const z0 = zList[i];
    const z1 = zList[i + 1];
    if (z1 - z0 < EPS) continue;
    const covered = mergeIntervals(
      clipped.filter((h) => h.z < z1 - EPS && h.z2 > z0 + EPS).map((h) => [h.x, h.x2] as [number, number]),
    );
    let cur = outer.x;
    for (const [a, b] of covered) {
      if (a > cur + EPS) out.push({ x: cur, z: z0, w: a - cur, d: z1 - z0 });
      cur = Math.max(cur, b);
    }
    if (outer.x + outer.w > cur + EPS) out.push({ x: cur, z: z0, w: outer.x + outer.w - cur, d: z1 - z0 });
  }
  return out;
}

export interface AreaSummary {
  footprint: number;
  living: number;
  shop: number;
  /** Living area not enclosed by any room (the open great room). */
  open: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
}

export function areaSummary(plan: Plan): AreaSummary {
  const footprint = plan.width * plan.depth;
  let shop = 0;
  let roomsLiving = 0;
  let bedrooms = 0;
  let fullBaths = 0;
  let halfBaths = 0;
  for (const r of plan.rooms) {
    if (isShopRoom(r)) shop += roomArea(r);
    else roomsLiving += roomArea(r);
    if (r.type === 'bedroom') bedrooms++;
    if (r.type === 'bathroom') fullBaths++;
    if (r.type === 'half-bath') halfBaths++;
  }
  return { footprint, living: footprint - shop, shop, open: footprint - shop - roomsLiving, bedrooms, fullBaths, halfBaths };
}

/** A sensible spot to start a walkthrough: the middle of the largest open living rectangle, else the largest living room, else anywhere. */
export function spawnPoint(plan: Plan): { x: number; z: number } {
  const open = rectMinus(footprintRect(plan), plan.rooms).filter((r) => r.w >= 3 && r.d >= 3);
  const living = plan.rooms.filter((r) => !isShopRoom(r));
  const byArea = (list: Rect[]): Rect | undefined => [...list].sort((a, b) => roomArea(b) - roomArea(a))[0];
  const pick = byArea(open) ?? byArea(living) ?? byArea(plan.rooms);
  if (!pick) return { x: plan.width / 2, z: plan.depth / 2 };
  return { x: pick.x + pick.w / 2, z: pick.z + pick.d / 2 };
}

/** Every opening interval already on one exterior side: exterior doors, windows and room doors that sit on that side. */
export function exteriorOpeningIntervals(plan: Plan, side: Side): [number, number][] {
  const out: [number, number][] = [];
  for (const d of plan.exteriorDoors) if (d.side === side) out.push([d.offset, d.offset + EXTERIOR_DOOR_KINDS[d.kind].width]);
  for (const w of plan.windows) if (w.side === side) out.push([w.offset, w.offset + WINDOW_KINDS[w.kind].width]);
  const line = sideLine(plan, side);
  for (const r of plan.rooms) {
    for (const d of r.doors) {
      const di = doorInterval(r, d);
      if (perimeterSide(plan, di.axis, di.at) === side) out.push([di.start - line.start, di.end - line.start]);
    }
  }
  return out;
}

export function overlapsExteriorOpening(plan: Plan, side: Side, offset: number, width: number, extra: [number, number][] = []): boolean {
  const a = offset;
  const b = offset + width;
  return [...exteriorOpeningIntervals(plan, side), ...extra].some(([s, e]) => a < e - EPS && s < b - EPS);
}

export const SIDE_LABELS: Record<Side, string> = { N: 'North', S: 'South', E: 'East', W: 'West' };

/** Evenly space windows along every exterior wall, skipping doors and rooms that shouldn't have windows. */
export function autoWindows(plan: Plan, makeId: () => string): import('./types').WindowSpec[] {
  const out: import('./types').WindowSpec[] = [];
  for (const side of SIDES) {
    const line = sideLine(plan, side);
    const len = line.end - line.start;
    const n = Math.floor((len - 4) / 10);
    const placed: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const center = (len / (n + 1)) * (i + 1);
      const probe =
        side === 'N' ? { x: center, z: 0.5 } : side === 'S' ? { x: center, z: plan.depth - 0.5 } : side === 'W' ? { x: 0.5, z: center } : { x: plan.width - 0.5, z: center };
      const room = roomAt(plan, probe.x, probe.z);
      if (room && ROOM_TYPES[room.type].noWindows) continue;
      const kind: import('./types').WindowKind = !room || room.type === 'living' || room.type === 'kitchen' || room.type === 'dining' ? 'double' : 'single';
      const w = WINDOW_KINDS[kind].width;
      const offset = clamp(snap(center - w / 2, 0.5), 0, len - w);
      if (overlapsExteriorOpening(plan, side, offset, w, placed)) continue;
      placed.push([offset, offset + w]);
      out.push({ id: makeId(), side, offset, kind });
    }
  }
  return out;
}
