/** Compass side of a rectangle or of the building footprint. */
export type Side = 'N' | 'S' | 'E' | 'W';
export const SIDES: Side[] = ['N', 'S', 'E', 'W'];

export type RoomType =
  | 'bedroom'
  | 'bathroom'
  | 'half-bath'
  | 'kitchen'
  | 'living'
  | 'dining'
  | 'office'
  | 'laundry'
  | 'mudroom'
  | 'closet'
  | 'pantry'
  | 'hallway'
  | 'utility'
  | 'shop'
  | 'garage';

/** A door (or cased opening) in one wall of a room. Offsets are feet from the wall's start (west or north end). */
export interface RoomDoor {
  side: Side;
  offset: number;
  width: number;
}

/** An axis-aligned room inside the footprint. All dimensions are feet. */
export interface Room {
  id: string;
  name: string;
  type: RoomType;
  x: number;
  z: number;
  w: number;
  d: number;
  doors: RoomDoor[];
}

export type ExteriorDoorKind = 'entry' | 'french' | 'sliding' | 'overhead-10' | 'overhead-16';
export type WindowKind = 'single' | 'double' | 'picture';

export interface ExteriorDoor {
  id: string;
  side: Side;
  offset: number;
  kind: ExteriorDoorKind;
}

export interface WindowSpec {
  id: string;
  side: Side;
  offset: number;
  kind: WindowKind;
}

export interface Plan {
  name: string;
  /** East-west dimension (x axis), feet. */
  width: number;
  /** North-south dimension (z axis), feet. */
  depth: number;
  /** Eave / sidewall height, feet. */
  wallHeight: number;
  /** Roof pitch as rise per 12 (e.g. 4 = 4:12). */
  roofPitch: number;
  /** Axis the ridge runs along. */
  ridgeAxis: 'x' | 'z';
  rooms: Room[];
  exteriorDoors: ExteriorDoor[];
  windows: WindowSpec[];
  /** Covered porch depth per side in feet (0 = none). */
  porches: Record<Side, number>;
}

export interface BuildOptions {
  shell: 'steel' | 'post-frame' | 'wood-frame';
  foundation: 'mono-slab' | 'stem-wall' | 'piers';
  roofing: 'metal-rpanel' | 'standing-seam' | 'shingle';
  exterior: 'metal-panel' | 'board-batten' | 'stone-wainscot' | 'brick';
  insulation: 'batt' | 'spray-open' | 'spray-closed' | 'rigid';
  interiorFinish: 'basic' | 'standard' | 'premium' | 'luxury';
  flooring: 'polished-concrete' | 'lvp' | 'tile' | 'hardwood' | 'carpet';
  kitchenTier: 'basic' | 'mid' | 'high' | 'luxury';
  bathTier: 'basic' | 'mid' | 'high';
  windowGrade: 'standard' | 'premium';
  shopFinish: 'unfinished' | 'liner' | 'finished';
  shopConditioned: boolean;
  hvac: 'central' | 'mini-split' | 'geothermal';
  waterHeater: 'tank' | 'tankless';
  electricalService: '200A' | '400A';
  fireplace: boolean;
  well: boolean;
  septic: boolean;
  cityUtilities: boolean;
  driveway: boolean;
  /** Multiplier applied to every line (1.0 = national average). */
  regionMultiplier: number;
  /** Contingency added on top of the subtotal, percent. */
  contingencyPct: number;
}

export interface Project {
  version: 1;
  plan: Plan;
  options: BuildOptions;
}
