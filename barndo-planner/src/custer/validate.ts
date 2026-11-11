/** Checks that an option's floor plan is buildable as drawn: no overlaps, every door leads somewhere, every room is reachable. */
import { EXTERIOR_DOOR_KINDS, WINDOW_KINDS } from '../model/catalog';
import { doorInterval, EPS, roomsOverlap, sideLine, withinFootprint } from '../model/geometry';
import { SIDES, type Plan, type Room } from '../model/types';

const OPEN = '__open__';
const OUTSIDE = '__outside__';

/** Which space holds the point: a walled room's id, the open great-room area, or outside. */
function spaceAt(plan: Plan, rooms: Room[], x: number, z: number): string {
  if (x < 0 || z < 0 || x > plan.width || z > plan.depth) return OUTSIDE;
  const walled = rooms.find((r) => !r.open && x > r.x + EPS && x < r.x + r.w - EPS && z > r.z + EPS && z < r.z + r.d - EPS);
  return walled ? walled.id : OPEN;
}

export function validateLevel(plan: Plan, rooms: Room[], label: string, entry: string[] = [OPEN]): string[] {
  const problems: string[] = [];
  for (const r of rooms) {
    if (!withinFootprint(plan, r)) problems.push(`${label}: ${r.id} leaves the footprint`);
    if (!Number.isInteger(r.x) || !Number.isInteger(r.z) || !Number.isInteger(r.w) || !Number.isInteger(r.d)) problems.push(`${label}: ${r.id} is off the 1 ft grid`);
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (roomsOverlap(rooms[i], rooms[j])) problems.push(`${label}: ${rooms[i].id} overlaps ${rooms[j].id}`);
    }
  }
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)?.add(b);
    links.get(b)?.add(a);
  };
  for (const r of rooms) {
    if (r.open) continue;
    for (const d of r.doors) {
      const iv = doorInterval(r, d);
      const len = d.side === 'N' || d.side === 'S' ? r.w : r.d;
      if (d.offset < -EPS || d.offset + d.width > len + EPS) problems.push(`${label}: a door on ${r.id} runs past the end of its wall`);
      const mid = (iv.start + iv.end) / 2;
      const out = d.side === 'N' || d.side === 'W' ? -0.5 : 0.5;
      // Sample both ends of the door too, so a door half on a wall junction is caught.
      const spaces = [iv.start + 0.25, mid, iv.end - 0.25].map((t) => (iv.axis === 'x' ? spaceAt(plan, rooms, t, iv.at + out) : spaceAt(plan, rooms, iv.at + out, t)));
      if (new Set(spaces).size > 1) problems.push(`${label}: a door on ${r.id} straddles two spaces (${[...new Set(spaces)].join(', ')})`);
      else if (spaces[1] === OUTSIDE) problems.push(`${label}: a door on ${r.id} opens to the outside; list it as an exterior door instead`);
      else link(r.id, spaces[1]);
    }
  }
  const seen = new Set<string>(entry);
  const queue = [...entry];
  while (queue.length) {
    const cur = queue.pop() as string;
    for (const n of links.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  for (const r of rooms) if (!r.open && !seen.has(r.id)) problems.push(`${label}: ${r.id} cannot be reached`);
  return problems;
}

export function validateOpenings(plan: Plan, label: string): string[] {
  const problems: string[] = [];
  for (const side of SIDES) {
    const line = sideLine(plan, side);
    const len = line.end - line.start;
    const spans: [number, number, string][] = [];
    for (const d of plan.exteriorDoors) if (d.side === side) spans.push([d.offset, d.offset + EXTERIOR_DOOR_KINDS[d.kind].width, d.id]);
    for (const w of plan.windows) if (w.side === side) spans.push([w.offset, w.offset + WINDOW_KINDS[w.kind].width, w.id]);
    spans.sort((a, b) => a[0] - b[0]);
    spans.forEach(([a, b, id], i) => {
      if (a < 1 - EPS || b > len - 1 + EPS) problems.push(`${label}: ${id} is within 1 ft of a corner on the ${side} wall`);
      if (i > 0 && a < spans[i - 1][1] + 1 - EPS) problems.push(`${label}: ${id} crowds ${spans[i - 1][2]} on the ${side} wall`);
      // An opening must not sit on the end of an interior wall that meets this exterior wall.
      for (const r of plan.rooms) {
        if (r.open) continue;
        const touches = side === 'N' ? r.z < EPS : side === 'S' ? r.z + r.d > plan.depth - EPS : side === 'W' ? r.x < EPS : r.x + r.w > plan.width - EPS;
        if (!touches) continue;
        const ends = side === 'N' || side === 'S' ? [r.x, r.x + r.w] : [r.z, r.z + r.d];
        for (const e of ends) if (e > a - 0.4 && e < b + 0.4 && e > EPS && e < len - EPS) problems.push(`${label}: ${id} lands on the wall at ${e} ft on the ${side} side (${r.id})`);
      }
    });
  }
  return problems;
}

/** Plain-text picture of a level, one character per foot. For eyeballing a layout in a terminal. */
export function asciiPlan(plan: Plan, rooms: Room[]): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const grid: string[][] = Array.from({ length: plan.depth }, () => Array.from({ length: plan.width }, () => '.'));
  const key: string[] = [];
  rooms.forEach((r, i) => {
    const ch = r.open ? letters[i % 26].toLowerCase() : letters[i % 26];
    key.push(`${ch}=${r.name} ${r.w}x${r.d}`);
    for (let z = r.z; z < r.z + r.d; z++) for (let x = r.x; x < r.x + r.w; x++) if (grid[z]?.[x] !== undefined) grid[z][x] = ch;
  });
  return `${grid.map((row) => row.join('')).join('\n')}\n${key.join(' | ')}`;
}
