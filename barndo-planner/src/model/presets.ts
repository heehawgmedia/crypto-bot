import type { BuildOptions, Plan, Project, Room, RoomType, Side } from './types';

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

type DoorSpec = [Side, number, number?];

function room(name: string, type: RoomType, x: number, z: number, w: number, d: number, doors: DoorSpec[] = []): Room {
  return {
    id: uid('room'),
    name,
    type,
    x,
    z,
    w,
    d,
    doors: doors.map(([side, offset, width]) => ({ side, offset, width: width ?? 3 })),
  };
}

export function defaultOptions(): BuildOptions {
  return {
    shell: 'steel',
    foundation: 'mono-slab',
    roofing: 'metal-rpanel',
    exterior: 'metal-panel',
    insulation: 'spray-open',
    interiorFinish: 'standard',
    flooring: 'lvp',
    kitchenTier: 'mid',
    bathTier: 'mid',
    windowGrade: 'standard',
    shopFinish: 'unfinished',
    shopConditioned: false,
    hvac: 'central',
    waterHeater: 'tank',
    electricalService: '200A',
    fireplace: false,
    well: true,
    septic: true,
    cityUtilities: false,
    driveway: true,
    regionMultiplier: 1,
    contingencyPct: 10,
  };
}

/** 40×60 with a 40×16 shop, 3 bed / 2 bath, hallway, front porch on the east side. */
export function classic40x60(): Plan {
  return {
    name: 'Classic 40×60 with shop',
    width: 40,
    depth: 60,
    wallHeight: 12,
    roofPitch: 4,
    ridgeAxis: 'z',
    rooms: [
      room('Shop', 'shop', 0, 0, 40, 16, [['S', 30]]),
      room('Pantry', 'pantry', 0, 16, 5, 6, [['S', 1]]),
      room('Hallway', 'hallway', 18, 36, 4, 24, [['N', 0, 4]]),
      room('Master bath', 'bathroom', 0, 36, 10, 8, [['S', 3]]),
      room('Walk-in closet', 'closet', 10, 36, 8, 8, [['S', 2]]),
      room('Master bedroom', 'bedroom', 0, 44, 18, 16, [['E', 3]]),
      room('Bath 2', 'bathroom', 22, 36, 8, 6, [['W', 2]]),
      room('Laundry', 'laundry', 30, 36, 10, 6, [['N', 4]]),
      room('Bedroom 2', 'bedroom', 22, 42, 18, 9, [['W', 3]]),
      room('Bedroom 3', 'bedroom', 22, 51, 18, 9, [['W', 3]]),
    ],
    exteriorDoors: [
      { id: uid('door'), side: 'N', offset: 12, kind: 'overhead-16' },
      { id: uid('door'), side: 'N', offset: 34, kind: 'entry' },
      { id: uid('door'), side: 'E', offset: 24, kind: 'entry' },
      { id: uid('door'), side: 'W', offset: 24, kind: 'sliding' },
    ],
    windows: [
      { id: uid('win'), side: 'E', offset: 18, kind: 'double' },
      { id: uid('win'), side: 'E', offset: 30, kind: 'double' },
      { id: uid('win'), side: 'E', offset: 45, kind: 'single' },
      { id: uid('win'), side: 'E', offset: 54, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 18, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 38, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 50, kind: 'double' },
      { id: uid('win'), side: 'S', offset: 4, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 11, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 29, kind: 'single' },
    ],
    porches: { N: 0, S: 0, E: 8, W: 0 },
  };
}

/** 30×50 all-living starter home: 2 bed + office, 2 bath, no shop. */
export function starter30x50(): Plan {
  return {
    name: 'Starter 30×50',
    width: 30,
    depth: 50,
    wallHeight: 10,
    roofPitch: 4,
    ridgeAxis: 'z',
    rooms: [
      room('Master bath', 'bathroom', 0, 28, 8, 8, [['S', 2]]),
      room('Closet', 'closet', 8, 28, 6, 8, [['S', 1]]),
      room('Master bedroom', 'bedroom', 0, 36, 14, 14, [['E', 2]]),
      room('Hallway', 'hallway', 14, 28, 4, 22, [['N', 0, 4]]),
      room('Bath 2', 'bathroom', 18, 28, 6, 6, [['W', 1]]),
      room('Laundry', 'laundry', 24, 28, 6, 6, [['N', 1]]),
      room('Bedroom 2', 'bedroom', 18, 34, 12, 8, [['W', 2]]),
      room('Office', 'office', 18, 42, 12, 8, [['W', 2]]),
    ],
    exteriorDoors: [
      { id: uid('door'), side: 'N', offset: 13, kind: 'entry' },
      { id: uid('door'), side: 'E', offset: 10, kind: 'sliding' },
    ],
    windows: [
      { id: uid('win'), side: 'N', offset: 4, kind: 'double' },
      { id: uid('win'), side: 'N', offset: 22, kind: 'double' },
      { id: uid('win'), side: 'E', offset: 3, kind: 'single' },
      { id: uid('win'), side: 'E', offset: 36, kind: 'single' },
      { id: uid('win'), side: 'E', offset: 45, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 6, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 16, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 30, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 42, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 3, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 9, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 22, kind: 'single' },
    ],
    porches: { N: 8, S: 0, E: 0, W: 0 },
  };
}

/** 50×80 family layout with a 50×30 shop, 4 bed / 2.5 bath and a wrap-around porch. */
export function family50x80(): Plan {
  return {
    name: 'Family 50×80 with shop',
    width: 50,
    depth: 80,
    wallHeight: 14,
    roofPitch: 5,
    ridgeAxis: 'z',
    rooms: [
      room('Shop', 'shop', 0, 0, 50, 30, [['S', 40]]),
      room('Mudroom', 'mudroom', 42, 30, 8, 8, [['N', 2], ['W', 2]]),
      room('Pantry', 'pantry', 0, 30, 6, 8, [['S', 1]]),
      room('Office', 'office', 0, 38, 12, 12, [['E', 4]]),
      room('Half bath', 'half-bath', 42, 38, 8, 5, [['W', 1]]),
      room('Hallway', 'hallway', 22, 56, 4, 24, [['N', 0, 4]]),
      room('Master bedroom', 'bedroom', 0, 62, 22, 18, [['E', 4]]),
      room('Master bath', 'bathroom', 0, 50, 12, 12, [['S', 4]]),
      room('Walk-in closet', 'closet', 12, 50, 10, 12, [['S', 3]]),
      room('Laundry', 'laundry', 26, 50, 10, 6, [['N', 3]]),
      room('Bath 2', 'bathroom', 26, 56, 10, 8, [['W', 2]]),
      room('Bedroom 2', 'bedroom', 36, 50, 14, 14, [['W', 3]]),
      room('Bedroom 3', 'bedroom', 26, 64, 12, 16, [['W', 5]]),
      room('Bedroom 4', 'bedroom', 38, 64, 12, 16, [['N', 4]]),
    ],
    exteriorDoors: [
      { id: uid('door'), side: 'N', offset: 8, kind: 'overhead-16' },
      { id: uid('door'), side: 'N', offset: 30, kind: 'overhead-10' },
      { id: uid('door'), side: 'E', offset: 33, kind: 'entry' },
      { id: uid('door'), side: 'E', offset: 42, kind: 'french' },
      { id: uid('door'), side: 'W', offset: 41, kind: 'sliding' },
    ],
    windows: [
      { id: uid('win'), side: 'E', offset: 50, kind: 'picture' },
      { id: uid('win'), side: 'E', offset: 68, kind: 'double' },
      { id: uid('win'), side: 'W', offset: 34, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 54, kind: 'single' },
      { id: uid('win'), side: 'W', offset: 68, kind: 'double' },
      { id: uid('win'), side: 'S', offset: 6, kind: 'double' },
      { id: uid('win'), side: 'S', offset: 16, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 30, kind: 'single' },
      { id: uid('win'), side: 'S', offset: 42, kind: 'single' },
    ],
    porches: { N: 0, S: 10, E: 10, W: 0 },
  };
}

export function blank40x60(): Plan {
  return {
    name: 'Blank 40×60',
    width: 40,
    depth: 60,
    wallHeight: 12,
    roofPitch: 4,
    ridgeAxis: 'z',
    rooms: [],
    exteriorDoors: [{ id: uid('door'), side: 'E', offset: 28, kind: 'entry' }],
    windows: [],
    porches: { N: 0, S: 0, E: 0, W: 0 },
  };
}

export const PRESETS: { id: string; label: string; make: () => Plan }[] = [
  { id: 'classic', label: 'Classic 40×60 + shop (3 bed / 2 bath)', make: classic40x60 },
  { id: 'starter', label: 'Starter 30×50 (2 bed + office / 2 bath)', make: starter30x50 },
  { id: 'family', label: 'Family 50×80 + shop (4 bed / 2.5 bath)', make: family50x80 },
  { id: 'blank', label: 'Blank 40×60 (start from scratch)', make: blank40x60 },
];

export function makeProject(presetId = 'classic'): Project {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  return { version: 1, plan: preset.make(), options: defaultOptions() };
}
