import type { Plan, Room } from '../model/types';

export type FinishLevel = 'budget' | 'mid' | 'high';

/** Priced extras that can be built now or left for later. */
export interface Extras {
  stormShelter: boolean;
  woodStove: boolean;
  generatorHookup: boolean;
  network: boolean;
}

/** Choices that belong to one option and override the shared cost settings. */
export interface OptionSpec {
  finish?: FinishLevel;
  extras?: Partial<Extras>;
  /** Overhead electric service from the road instead of underground. */
  overheadElectric?: boolean;
  networkDrops?: number;
  /** Feet of kitchen cabinet run along the walls, and feet of island. */
  kitchen?: { runFt: number; islandFt: number };
}

/** One of the original floor plan options for the Custer, Kentucky site. */
export interface OptionPlan {
  id: string;
  name: string;
  /** One line: what this option is for. */
  tagline: string;
  /** Layout concept in a sentence or two. */
  concept: string;
  plan: Plan;
  /** Finished space above the main level, in the same coordinates as the main level. */
  upper?: {
    kind: 'bedrooms' | 'bonus';
    /** Finished floor area of the upper level, sq ft (stair opening already excluded). */
    finishedSf: number;
    rooms: Room[];
  };
  /** Bedrooms and baths on each level, for the comparison table. */
  beds: { main: number; upper: number };
  baths: { full: number; half: number };
  /** Design notes worth showing next to the plan. */
  notes: string[];
  spec?: OptionSpec;
}
