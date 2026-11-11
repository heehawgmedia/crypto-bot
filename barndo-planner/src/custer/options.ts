/**
 * Four original floor plan options for a 4 bed / 2.5 bath barndominium near Custer, Kentucky.
 *
 * Coordinates are feet. x runs west to east along the ridge, z runs north (back) to south (front).
 * Every footprint is a plain rectangle on a standard truss span (36 or 40 ft) with a length that
 * divides into 8, 10 or 12 ft bays. Wet rooms are grouped so supply and drain runs stay short.
 * These layouts are original; they are sized like published plans but copy none of them.
 */
import type { ExteriorDoor, ExteriorDoorKind, Room, RoomType, Side, WindowKind, WindowSpec } from '../model/types';
import type { OptionPlan } from './types';

type DoorSpec = [side: Side, offset: number, width?: number];

function room(id: string, name: string, type: RoomType, x: number, z: number, w: number, d: number, doors: DoorSpec[] = []): Room {
  return { id, name, type, x, z, w, d, doors: doors.map(([side, offset, width]) => ({ side, offset, width: width ?? 3 })) };
}
function zone(id: string, name: string, type: RoomType, x: number, z: number, w: number, d: number): Room {
  return { id, name, type, x, z, w, d, doors: [], open: true };
}
const doors = (prefix: string, list: [Side, number, ExteriorDoorKind][]): ExteriorDoor[] => list.map(([side, offset, kind], i) => ({ id: `${prefix}-door-${i + 1}`, side, offset, kind }));
const windows = (prefix: string, list: [Side, number, WindowKind][]): WindowSpec[] => list.map(([side, offset, kind], i) => ({ id: `${prefix}-win-${i + 1}`, side, offset, kind }));

/** A. 40 x 50, one level. Great room at the east gable end, bedroom block to the west. */
const pastureRanch: OptionPlan = {
  id: 'a',
  name: 'Pasture Ranch',
  tagline: 'Smallest slab that holds four bedrooms, an office and 2.5 baths on one level.',
  concept:
    'Great room across the east gable end. Bedrooms line the front, the primary suite and office sit at the back, and one short hall serves all of them. The primary bath, laundry, hall bath, half bath and kitchen share one wet core.',
  plan: {
    name: 'A. Pasture Ranch 40 x 50',
    width: 50,
    depth: 40,
    wallHeight: 10,
    roofPitch: 4,
    ridgeAxis: 'x',
    rooms: [
      room('a-primary', 'Primary bedroom', 'bedroom', 0, 0, 15, 12, [['S', 9.5]]),
      room('a-wic', 'Walk-in closet', 'closet', 15, 0, 6, 12, [['W', 4]]),
      room('a-pbath', 'Primary bath', 'bathroom', 21, 0, 9, 12, [['W', 4]]),
      room('a-office', 'Office', 'office', 0, 12, 9, 10, [['E', 3]]),
      room('a-stub', 'Suite hall', 'hallway', 9, 12, 4, 10, [['S', 0, 4]]),
      room('a-bath2', 'Hall bath', 'bathroom', 13, 12, 5, 10, [['S', 1]]),
      room('a-laundry', 'Laundry', 'laundry', 18, 12, 6, 10, [['S', 1.5]]),
      room('a-pantry', 'Pantry', 'pantry', 24, 12, 6, 6, [['E', 1.5]]),
      room('a-half', 'Half bath', 'half-bath', 24, 18, 6, 4, [['S', 1.5]]),
      room('a-linen', 'Linen', 'closet', 0, 22, 4, 4, [['E', 0.5]]),
      room('a-hall', 'Hall', 'hallway', 4, 22, 26, 4, [['E', 0, 4]]),
      room('a-bed2', 'Bedroom 2', 'bedroom', 0, 26, 10, 14, [['N', 5.5]]),
      room('a-bed3', 'Bedroom 3', 'bedroom', 10, 26, 10, 14, [['N', 1]]),
      room('a-bed4', 'Bedroom 4', 'bedroom', 20, 26, 10, 14, [['N', 1]]),
      zone('a-kitchen', 'Kitchen', 'kitchen', 30, 0, 20, 13),
      zone('a-dining', 'Dining', 'dining', 30, 13, 20, 9),
      zone('a-living', 'Living', 'living', 30, 22, 20, 18),
    ],
    exteriorDoors: doors('a', [
      ['S', 33.5, 'entry'],
      ['N', 46, 'entry'],
      ['E', 26, 'sliding'],
    ]),
    windows: windows('a', [
      ['N', 4, 'double'],
      ['N', 24, 'single'],
      ['N', 34, 'double'],
      ['W', 4, 'single'],
      ['W', 15.5, 'single'],
      ['W', 31, 'double'],
      ['S', 3, 'single'],
      ['S', 12, 'double'],
      ['S', 22, 'double'],
      ['S', 40, 'picture'],
      ['E', 3, 'picture'],
      ['E', 14, 'picture'],
      ['E', 34, 'single'],
    ]),
    porches: { N: 0, S: 8, E: 8, W: 0 },
  },
  beds: { main: 4, upper: 0 },
  baths: { full: 2, half: 1 },
  notes: [
    'Five 10 ft bays on a 40 ft truss span.',
    'All plumbing sits within about 15 ft of the kitchen wall.',
    'The primary suite shares the bedroom block, so it is quieter than the front bedrooms but not on the opposite side of the house.',
  ],
};

/** B. 40 x 60, one level with a bonus loft. Great room in the middle, bedroom wings at both ends. */
const splitWing: OptionPlan = {
  id: 'b',
  name: 'Split-Wing Ranch',
  tagline: 'Primary suite and the other bedrooms at opposite ends, with an enclosed bonus loft over the bedroom wing.',
  concept:
    'Great room through the middle with glass front and back. Three bedrooms, the hall bath and the office fill the west wing. The primary suite, pantry, laundry and half bath fill the east wing with no hallway at all. A closed stair leads to a bonus room that does not look down on the great room.',
  plan: {
    name: 'B. Split-Wing Ranch 40 x 60',
    width: 60,
    depth: 40,
    wallHeight: 12,
    roofPitch: 6,
    ridgeAxis: 'x',
    rooms: [
      room('b-bed2', 'Bedroom 2', 'bedroom', 0, 0, 11, 18, [['S', 7.5]]),
      room('b-bed3', 'Bedroom 3', 'bedroom', 11, 0, 11, 18, [['S', 1]]),
      room('b-hall', 'Hall', 'hallway', 0, 18, 22, 4, [['E', 0, 4]]),
      room('b-bed4', 'Bedroom 4', 'bedroom', 0, 22, 11, 18, [['N', 7.5]]),
      room('b-bath2', 'Hall bath', 'bathroom', 11, 22, 11, 8, [['N', 4]]),
      room('b-office', 'Office', 'office', 11, 30, 11, 10, [['E', 3]]),
      room('b-pantry', 'Pantry', 'pantry', 46, 0, 6, 14, [['W', 10]]),
      room('b-pbath', 'Primary bath', 'bathroom', 52, 0, 8, 14, [['S', 3]]),
      room('b-laundry', 'Laundry', 'laundry', 46, 14, 7, 6, [['W', 1.5]]),
      room('b-half', 'Half bath', 'half-bath', 46, 20, 7, 4, [['W', 0.5]]),
      room('b-wic', 'Walk-in closet', 'closet', 53, 14, 7, 10, [['S', 2]]),
      room('b-primary', 'Primary bedroom', 'bedroom', 46, 24, 14, 16, [['W', 2]]),
      zone('b-stair', 'Stair to loft', 'stair', 22, 2, 4, 14),
      zone('b-kitchen', 'Kitchen', 'kitchen', 30, 0, 16, 13),
      zone('b-dining', 'Dining', 'dining', 26, 13, 20, 9),
      zone('b-living', 'Living', 'living', 22, 22, 24, 18),
    ],
    exteriorDoors: doors('b', [
      ['S', 32, 'entry'],
      ['S', 37, 'sliding'],
      ['N', 26.5, 'french'],
    ]),
    windows: windows('b', [
      ['N', 2.5, 'double'],
      ['N', 13.5, 'double'],
      ['N', 36, 'double'],
      ['N', 54, 'single'],
      ['W', 6, 'single'],
      ['W', 28, 'single'],
      ['S', 2.5, 'double'],
      ['S', 13.5, 'double'],
      ['S', 23, 'picture'],
      ['S', 50, 'double'],
      ['E', 5, 'single'],
      ['E', 28, 'double'],
    ]),
    porches: { N: 0, S: 8, E: 8, W: 0 },
  },
  upper: {
    kind: 'bonus',
    finishedSf: 528,
    rooms: [room('b-bonus', 'Bonus room', 'living', 0, 8, 22, 24, [['E', 5]])],
  },
  beds: { main: 4, upper: 0 },
  baths: { full: 2, half: 1 },
  notes: [
    'Six 10 ft bays on a 40 ft truss span. 12 ft walls and a 6:12 roof make headroom for the loft.',
    'Only 88 sq ft of hallway on the main level.',
    'Two wet zones: kitchen, pantry, laundry, half bath and primary bath on the east side, hall bath on the west.',
  ],
};

/** C. 36 x 44 story-and-a-half. Primary suite down, three bedrooms up. */
const storyAndHalf: OptionPlan = {
  id: 'c',
  name: 'Story-and-a-Half',
  tagline: 'The most finished floor area per dollar: daily living downstairs, three bedrooms and a bath under the roof.',
  concept:
    'Great room across the east gable end. The primary suite, office, laundry, half bath, pantry and a mudroom entry fill the main level. Three bedrooms and a full bath stack above them, so one slab and one roof cover two floors. The upstairs bath sits directly over the laundry and half bath.',
  plan: {
    name: 'C. Story-and-a-Half 36 x 44',
    width: 44,
    depth: 36,
    wallHeight: 17,
    roofPitch: 6,
    ridgeAxis: 'x',
    rooms: [
      room('c-primary', 'Primary bedroom', 'bedroom', 0, 0, 13, 14, [['S', 9]]),
      room('c-pbath', 'Primary bath', 'bathroom', 13, 0, 9, 8, [['W', 2.5]]),
      room('c-wic', 'Walk-in closet', 'closet', 13, 8, 4, 6, [['W', 1.5]]),
      room('c-pantry', 'Pantry', 'pantry', 17, 8, 5, 6, [['E', 1.5]]),
      room('c-linen', 'Linen', 'closet', 0, 14, 4, 4, [['E', 0.5]]),
      room('c-hall', 'Hall', 'hallway', 4, 14, 18, 4, [['E', 0, 4]]),
      room('c-office', 'Office', 'office', 0, 18, 10, 11, [['N', 5]]),
      room('c-half', 'Half bath', 'half-bath', 10, 18, 5, 5, [['N', 1]]),
      room('c-stair', 'Stair', 'stair', 15, 18, 7, 9, [['N', 0.5, 4]]),
      room('c-laundry', 'Laundry', 'laundry', 10, 23, 5, 8, [['E', 4.5]]),
      room('c-mud', 'Mudroom entry', 'mudroom', 15, 27, 7, 9, [['E', 1.5, 4]]),
      room('c-mech', 'Mechanical', 'utility', 10, 31, 5, 5, [['E', 1]]),
      room('c-storage', 'Secure storage', 'closet', 0, 29, 10, 7, [['N', 6]]),
      zone('c-kitchen', 'Kitchen', 'kitchen', 22, 0, 22, 12),
      zone('c-dining', 'Dining', 'dining', 22, 12, 22, 8),
      zone('c-living', 'Living', 'living', 22, 20, 22, 16),
    ],
    exteriorDoors: doors('c', [
      ['S', 17, 'entry'],
      ['S', 25, 'sliding'],
      ['E', 15, 'french'],
      ['N', 40, 'entry'],
    ]),
    windows: windows('c', [
      ['N', 3.5, 'double'],
      ['N', 16, 'single'],
      ['N', 28, 'double'],
      ['W', 5, 'single'],
      ['W', 21, 'double'],
      ['S', 34, 'picture'],
      ['E', 3, 'picture'],
      ['E', 25, 'picture'],
    ]),
    porches: { N: 0, S: 8, E: 8, W: 0 },
  },
  upper: {
    kind: 'bedrooms',
    finishedSf: 729,
    rooms: [
      room('c-bed3', 'Bedroom 3', 'bedroom', 0, 0, 11, 14, [['S', 8]]),
      room('c-bed4', 'Bedroom 4', 'bedroom', 11, 0, 11, 14, [['S', 1]]),
      room('c-landing', 'Landing', 'hallway', 0, 14, 8, 13, [['E', 0, 4]]),
      room('c-hallup', 'Upper hall', 'hallway', 8, 14, 14, 4, [['S', 7.5, 4]]),
      room('c-bathup', 'Upstairs bath', 'bathroom', 8, 18, 7, 9, [['N', 2]]),
      room('c-stairup', 'Stair', 'stair', 15, 18, 7, 9, []),
      room('c-bed2', 'Bedroom 2', 'bedroom', 0, 27, 15, 9, [['N', 2.5]]),
      room('c-attic', 'Attic storage', 'closet', 15, 27, 7, 9, [['W', 3]]),
    ],
  },
  beds: { main: 1, upper: 3 },
  baths: { full: 2, half: 1 },
  notes: [
    'A 36 ft truss span over a 44 ft length. 17 ft walls give the upstairs rooms 6.5 ft knee walls.',
    'One slab and one roof for 2,313 sq ft of finished floor.',
    'Three of the four bedrooms are upstairs. Everything the owners use daily stays on the main level.',
  ],
};

/** D. 40 x 72, one level. The roomy version of the split-wing layout. */
const longPorch: OptionPlan = {
  id: 'd',
  name: 'Long Porch Ranch',
  tagline: 'Everything on one level with room for most of the nice-to-haves.',
  concept:
    'The split-wing layout stretched to 72 ft. Larger bedrooms, a laundry and mudroom with its own back door, a reinforced safe room by the entry, a bigger pantry and a 10 ft deep front porch.',
  plan: {
    name: 'D. Long Porch Ranch 40 x 72',
    width: 72,
    depth: 40,
    wallHeight: 10,
    roofPitch: 4,
    ridgeAxis: 'x',
    rooms: [
      room('d-bed2', 'Bedroom 2', 'bedroom', 0, 0, 12, 18, [['S', 8.5]]),
      room('d-bed3', 'Bedroom 3', 'bedroom', 12, 0, 12, 18, [['S', 1]]),
      room('d-hall', 'Hall', 'hallway', 0, 18, 24, 4, [['E', 0, 4]]),
      room('d-bed4', 'Bedroom 4', 'bedroom', 0, 22, 12, 18, [['N', 8.5]]),
      room('d-bath2', 'Hall bath', 'bathroom', 12, 22, 12, 8, [['N', 4.5]]),
      room('d-office', 'Office', 'office', 12, 30, 12, 10, [['E', 3.5]]),
      room('d-pantry', 'Pantry', 'pantry', 52, 0, 7, 10, [['S', 2]]),
      room('d-laundry', 'Laundry and mudroom', 'laundry', 59, 0, 13, 10, [['S', 1]]),
      room('d-suitehall', 'Suite hall', 'hallway', 52, 10, 12, 4, [['W', 0, 4]]),
      room('d-linen', 'Linen', 'closet', 64, 10, 8, 4, [['W', 0.5]]),
      room('d-half', 'Half bath', 'half-bath', 52, 14, 6, 5, [['N', 1.5]]),
      room('d-safe', 'Safe room and coats', 'closet', 52, 19, 6, 5, [['W', 1]]),
      room('d-wic', 'Walk-in closet', 'closet', 58, 14, 6, 10, [['S', 1.5]]),
      room('d-pbath', 'Primary bath', 'bathroom', 64, 14, 8, 10, [['S', 2.5]]),
      room('d-primary', 'Primary bedroom', 'bedroom', 52, 24, 20, 16, [['W', 2]]),
      zone('d-dining', 'Dining', 'dining', 24, 0, 12, 13),
      zone('d-kitchen', 'Kitchen', 'kitchen', 36, 0, 16, 13),
      zone('d-living', 'Living', 'living', 24, 13, 28, 27),
    ],
    exteriorDoors: doors('d', [
      ['S', 36, 'entry'],
      ['S', 42, 'sliding'],
      ['N', 27, 'french'],
      ['N', 66, 'entry'],
    ]),
    windows: windows('d', [
      ['N', 3, 'double'],
      ['N', 15, 'double'],
      ['N', 40, 'double'],
      ['N', 61, 'single'],
      ['W', 7, 'single'],
      ['W', 29, 'single'],
      ['S', 3, 'double'],
      ['S', 15, 'double'],
      ['S', 25.5, 'picture'],
      ['S', 57, 'double'],
      ['S', 66, 'single'],
      ['E', 17, 'single'],
      ['E', 29, 'double'],
    ]),
    porches: { N: 0, S: 10, E: 8, W: 0 },
  },
  beds: { main: 4, upper: 0 },
  baths: { full: 2, half: 1 },
  notes: [
    'Six 12 ft bays on a 40 ft truss span.',
    'A back door into the laundry and mudroom keeps boots out of the great room.',
    'The safe room is a reinforced closet on the slab. The below-ground shelter you marked as a must is priced separately for every option.',
  ],
};

/**
 * E. 26 x 36, one level, three bedrooms and two baths. Drawn to a $250,000 all-in ceiling:
 * the smallest split-bedroom layout that still has a walk-in pantry, a laundry room and a vaulted great room.
 */
const starterFarmhouse: OptionPlan = {
  id: 'e',
  name: 'Starter Farmhouse',
  tagline: 'Three bedrooms and two baths on one level, cut to fit a $250,000 all-in ceiling.',
  concept:
    'The split-wing layout at its smallest. Two bedrooms and the hall bath sit on the west side with one 18 sq ft vestibule and no hallway. The primary suite, pantry and laundry sit on the east side. The vaulted great room runs front to back between them. Bedroom 3 has a door and a closet, so it serves as the office.',
  plan: {
    name: 'E. Starter Farmhouse 26 x 36',
    width: 36,
    depth: 26,
    wallHeight: 10,
    roofPitch: 4,
    ridgeAxis: 'x',
    rooms: [
      room('e-bed2', 'Bedroom 2', 'bedroom', 0, 0, 10, 10, [['S', 7]]),
      room('e-bath2', 'Hall bath', 'bathroom', 0, 10, 7, 6, [['E', 1.5]]),
      room('e-vest', 'Hall', 'hallway', 7, 10, 3, 6, [['E', 1, 4]]),
      room('e-bed3', 'Bedroom 3 or office', 'bedroom', 0, 16, 10, 10, [['N', 7]]),
      room('e-pantry', 'Pantry', 'pantry', 25, 0, 5, 8, [['W', 5]]),
      room('e-pbath', 'Primary bath', 'bathroom', 30, 0, 6, 8, [['S', 1.5]]),
      room('e-laundry', 'Laundry', 'laundry', 25, 8, 5, 6, [['W', 1.5]]),
      room('e-wic', 'Walk-in closet', 'closet', 30, 8, 6, 6, [['S', 1.5]]),
      room('e-primary', 'Primary bedroom', 'bedroom', 25, 14, 11, 12, [['W', 2]]),
      zone('e-kitchen', 'Kitchen', 'kitchen', 10, 0, 15, 9),
      zone('e-dining', 'Dining', 'dining', 10, 9, 15, 6),
      zone('e-living', 'Living', 'living', 10, 15, 15, 11),
    ],
    exteriorDoors: doors('e', [
      ['S', 11, 'entry'],
      ['N', 10.5, 'entry'],
    ]),
    windows: windows('e', [
      ['N', 2, 'double'],
      ['N', 16.5, 'double'],
      ['N', 31.5, 'single'],
      ['W', 3.5, 'single'],
      ['W', 19.5, 'single'],
      ['S', 2, 'double'],
      ['S', 15.5, 'picture'],
      ['S', 27.5, 'double'],
      ['E', 18.5, 'single'],
    ]),
    porches: { N: 0, S: 6, E: 0, W: 0 },
  },
  beds: { main: 3, upper: 0 },
  baths: { full: 2, half: 0 },
  notes: [
    'Three 12 ft bays on a 26 ft truss span.',
    'Only 18 sq ft of hallway.',
    'Bedrooms 2 and 3 are 10 x 10 ft with the closet inside that, so about 10 x 8 ft of clear floor.',
    'The east gable end is left clear so the porch can wrap around it later.',
  ],
  spec: {
    finish: 'budget',
    extras: { stormShelter: false, woodStove: false },
    overheadElectric: true,
    networkDrops: 4,
    kitchen: { runFt: 16, islandFt: 6 },
  },
};

export const OPTIONS: OptionPlan[] = [pastureRanch, splitWing, storyAndHalf, longPorch, starterFarmhouse];
