/** Quantity takeoff: turns an option's geometry into the measured quantities the cost model prices. */
import { deriveWalls, doorInterval, exteriorWallArea, perimeterSide, porchArea, roofMetrics } from '../model/geometry';
import type { Plan, Room } from '../model/types';
import type { OptionPlan } from './types';

export interface Takeoff {
  mainSf: number;
  upperSf: number;
  /** Heated, finished floor area on both levels. */
  heatedSf: number;
  porchSf: number;
  /** Main roof surface, including overhangs and pitch. */
  roofSf: number;
  /** Lean-to roof over the porches. */
  porchRoofSf: number;
  extWallSf: number;
  perimeterFt: number;
  /** Eave edges that need gutters: both long sides, plus porch eaves in place of the walls they cover. */
  gutterFt: number;
  /** Interior partition length on both levels. */
  interiorWallFt: number;
  interiorDoors: number;
  casedOpenings: number;
  exteriorDoors: number;
  patioDoors: number;
  windows: { single: number; double: number; picture: number };
  fullBaths: number;
  halfBaths: number;
  bedrooms: number;
  /** Sinks, toilets, tubs and showers, washer box, dishwasher, water heater, hose bibs. */
  plumbingFixtures: number;
  /** Groups of wet rooms that touch each other; fewer means shorter plumbing runs. */
  wetZones: number;
  hallSf: number;
  stairs: number;
  eaveHeight: number;
  roofPitch: number;
  /** Feet of kitchen wall cabinets and of island. */
  kitchenRunFt: number;
  kitchenIslandFt: number;
}

const WET = new Set(['bathroom', 'half-bath', 'kitchen', 'laundry']);

function touching(a: Room, b: Room): boolean {
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const gapZ = Math.max(a.z, b.z) - Math.min(a.z + a.d, b.z + b.d);
  // Share a wall (or a corner pocket within 6 ft through a closet or pantry).
  return gapX <= 6 && gapZ <= 6 && !(gapX > 0 && gapZ > 0);
}

function wetZones(rooms: Room[]): number {
  const wet = rooms.filter((r) => WET.has(r.type));
  const parent = wet.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < wet.length; i++) for (let j = i + 1; j < wet.length; j++) if (touching(wet[i], wet[j])) parent[find(i)] = find(j);
  return new Set(wet.map((_, i) => find(i))).size;
}

function interiorWallFt(plan: Plan, rooms: Room[]): number {
  const level: Plan = { ...plan, rooms, exteriorDoors: [], windows: [] };
  return deriveWalls(level)
    .filter((w) => !w.exterior)
    .reduce((s, w) => s + (w.end - w.start), 0);
}

export function takeoff(option: OptionPlan): Takeoff {
  const plan = option.plan;
  const upperRooms = option.upper?.rooms ?? [];
  const allRooms = [...plan.rooms, ...upperRooms];
  const mainSf = plan.width * plan.depth;
  const upperSf = option.upper?.finishedSf ?? 0;
  const roof = roofMetrics(plan);
  const porchSf = porchArea(plan);
  let interiorDoors = 0;
  let casedOpenings = 0;
  for (const r of allRooms) {
    if (r.open) continue;
    for (const d of r.doors) {
      const iv = doorInterval(r, d);
      if (perimeterSide(plan, iv.axis, iv.at)) continue;
      if (d.width > 3.5) casedOpenings++;
      else interiorDoors++;
    }
  }
  const windows = { single: 0, double: 0, picture: 0 };
  for (const w of plan.windows) windows[w.kind]++;
  // One egress window per upstairs bedroom, plus one for a bonus room.
  for (const r of upperRooms) if (r.type === 'bedroom' || r.type === 'living') windows.single++;
  const patioDoors = plan.exteriorDoors.filter((d) => d.kind === 'french' || d.kind === 'sliding').length;
  const fullBaths = allRooms.filter((r) => r.type === 'bathroom').length;
  const halfBaths = allRooms.filter((r) => r.type === 'half-bath').length;
  const primaryBaths = allRooms.filter((r) => r.type === 'bathroom' && /primary/i.test(r.name)).length;
  // Full bath: tub or shower, toilet, sink. Primary bath adds a second sink. Half bath: toilet, sink.
  // Kitchen: sink, dishwasher, refrigerator line. Laundry: washer box, utility sink. Plus water heater and two hose bibs.
  const plumbingFixtures = fullBaths * 3 + primaryBaths + halfBaths * 2 + 3 + 2 + 1 + 2;
  const ridgeAlongX = plan.ridgeAxis === 'x';
  const eaveLen = ridgeAlongX ? plan.width : plan.depth;
  const porchOnEaves = ridgeAlongX ? plan.porches.N + plan.porches.S : plan.porches.E + plan.porches.W;
  const porchOnGables = ridgeAlongX ? [plan.porches.E, plan.porches.W] : [plan.porches.N, plan.porches.S];
  const gableLen = ridgeAlongX ? plan.depth : plan.width;
  const gutterFt = 2 * (eaveLen + 3) + porchOnGables.filter((p) => p > 0).length * gableLen + (porchOnEaves > 0 ? 0 : 0);
  return {
    mainSf,
    upperSf,
    heatedSf: mainSf + upperSf,
    porchSf,
    roofSf: Math.round(roof.area),
    porchRoofSf: Math.round(porchSf * 1.06),
    extWallSf: Math.round(exteriorWallArea(plan)),
    perimeterFt: 2 * (plan.width + plan.depth),
    gutterFt,
    interiorWallFt: Math.round(interiorWallFt(plan, plan.rooms) + (upperRooms.length ? interiorWallFt(plan, upperRooms) : 0)),
    interiorDoors,
    casedOpenings,
    exteriorDoors: plan.exteriorDoors.length - patioDoors,
    patioDoors,
    windows,
    fullBaths,
    halfBaths,
    bedrooms: option.beds.main + option.beds.upper,
    plumbingFixtures,
    wetZones: wetZones(plan.rooms),
    hallSf: allRooms.filter((r) => r.type === 'hallway').reduce((s, r) => s + r.w * r.d, 0),
    stairs: option.upper ? 1 : 0,
    eaveHeight: plan.wallHeight,
    roofPitch: plan.roofPitch,
    kitchenRunFt: option.spec?.kitchen?.runFt ?? 24,
    kitchenIslandFt: option.spec?.kitchen?.islandFt ?? 7,
  };
}
