/**
 * Full build-cost model: every line item the owner asked for, each with a low / expected / high
 * figure, the quantity it was multiplied by, where the unit price came from and how solid it is.
 */
import type { Extras, FinishLevel, OptionPlan } from './types';
import { takeoff, type Takeoff } from './takeoff';

export interface Range {
  low: number;
  mid: number;
  high: number;
}

/** How far to trust a number. */
export type Confidence =
  | 'published' // a price or fee printed on the seller's or agency's own page
  | 'official' // an agency rule or fee schedule
  | 'guide' // a range from a cost guide, not a quote
  | 'assumption'; // my own estimate where no source gave a usable figure

export interface Rate {
  /** Dollars per `unit`. */
  range: Range;
  unit: string;
  confidence: Confidence;
  /** Ids into the SOURCES list. */
  sources: string[];
  note: string;
}

export type Group = 'Before you build' | 'Site and utilities' | 'Structure' | 'Envelope' | 'Systems' | 'Interior' | 'Must-have extras' | 'Builder, loan and risk';

export const GROUP_ORDER: Group[] = ['Before you build', 'Site and utilities', 'Structure', 'Envelope', 'Systems', 'Interior', 'Must-have extras', 'Builder, loan and risk'];

export interface LineItem {
  id: string;
  group: Group;
  label: string;
  /** Plain-words quantity, e.g. "2,000 sq ft of slab". */
  basis: string;
  total: Range;
  confidence: Confidence;
  sources: string[];
  note: string;
}

export interface Settings {
  /** Feet from the road to the build site: driveway, electric run. */
  roadDistanceFt: number;
  /** General contractor overhead and profit, percent of construction cost. */
  gcPct: Range;
  /** Contingency, percent of construction cost plus builder's fee. */
  contingencyPct: Range;
  /** Construction loan: annual rate (percent), months of construction, share of the cost borrowed, closing costs (percent of loan). */
  loanRatePct: Range;
  buildMonths: Range;
  loanShare: number;
  closingPct: Range;
  /** Builder's risk insurance, percent of construction cost. */
  builderRiskPct: Range;
  /** Number of wired network drops. */
  networkDrops: number;
  finish: FinishLevel;
  extras: Extras;
  /** Overhead electric service: free under the co-op's 1,000 ft allowance. */
  overheadElectric: boolean;
}

/** How each finish level scales the finish-driven lines, relative to the middle level. */
export const FINISH_FACTORS: Record<FinishLevel, Record<FinishKey, number>> = {
  budget: { windows: 0.85, doors: 0.85, flooring: 0.85, cabinets: 0.65, counters: 0.6, appliances: 0.65, fixtures: 0.75, lighting: 0.7, paint: 0.85, interiorDoor: 0.85, trim: 0.75, insulation: 0.8, landscaping: 0.5 },
  mid: { windows: 1, doors: 1, flooring: 1, cabinets: 1, counters: 1, appliances: 1, fixtures: 1, lighting: 1, paint: 1, interiorDoor: 1, trim: 1, insulation: 1, landscaping: 1 },
  high: { windows: 1.35, doors: 1.3, flooring: 1.4, cabinets: 1.6, counters: 1.5, appliances: 1.6, fixtures: 1.6, lighting: 1.6, paint: 1.2, interiorDoor: 1.3, trim: 1.5, insulation: 1.5, landscaping: 1.5 },
};
export type FinishKey = 'windows' | 'doors' | 'flooring' | 'cabinets' | 'counters' | 'appliances' | 'fixtures' | 'lighting' | 'paint' | 'interiorDoor' | 'trim' | 'insulation' | 'landscaping';

export const FINISH_LABEL: Record<FinishLevel, string> = {
  budget: 'Budget finishes: stock cabinets, laminate counters, basic fixtures and appliances, batt and blown insulation',
  mid: 'Middle finishes: semi-custom cabinets, mid-priced counters, fixtures and appliances',
  high: 'High finishes: custom cabinets, stone counters, upgraded fixtures, all spray foam',
};

export interface Estimate {
  option: OptionPlan;
  quantities: Takeoff;
  /** The settings actually used, after the option's own choices were applied. */
  settings: Settings;
  items: LineItem[];
  /** Labor and materials the builder manages. */
  construction: Range;
  /**
   * Expected total with a likely range. The low and high ends assume half of the possible swing:
   * every line landing at its cheapest (or dearest) at once is not realistic.
   */
  total: Range;
  /** The totals if every single line came in at its low end, or at its high end. */
  extremes: { low: number; high: number };
  perHeatedSf: Range;
  /** The house alone (structure, envelope, systems, interior) with the builder's fee: the figure most cost guides quote. */
  houseOnly: { withPorch: number; withoutPorch: number; perSf: number; perSfUnderRoof: number };
  /** Share of the expected total that rests on published prices or official fees. */
  solidShare: number;
}

/** The unit prices the model needs. Filled from research in unitCosts.ts. */
export interface Rates {
  plans: Rate;
  engineering: Rate;
  permits: Rate;
  permitsLocal: Rate;
  survey: Rate;
  soilTest: Rate;
  sitePrepPerSf: Rate;
  drivewayPerFt: Rate;
  slabPerSf: Rate;
  shellPerSf: Rate;
  erectionPerSf: Rate;
  upperFloorPerSf: Rate;
  stair: Rate;
  porchPerSf: Rate;
  insulationPerSf: Rate;
  windowSingle: Rate;
  windowDouble: Rate;
  windowPicture: Rate;
  entryDoor: Rate;
  patioDoor: Rate;
  gutterPerFt: Rate;
  electricalPerSf: Rate;
  plumbingPerFixture: Rate;
  hvacPerSf: Rate;
  well: Rate;
  septic: Rate;
  electricRunPerFt: Rate;
  electricService: Rate;
  partitionPerFt: Rate;
  drywallPerSf: Rate;
  flooringPerSf: Rate;
  cabinetsPerFt: Rate;
  countersPerSf: Rate;
  appliances: Rate;
  plumbingFixturesPerBath: Rate;
  kitchenFixtures: Rate;
  lightingPerSf: Rate;
  paintPerSf: Rate;
  interiorDoor: Rate;
  trimPerSf: Rate;
  landscaping: Rate;
  stormShelter: Rate;
  woodStove: Rate;
  generatorHookup: Rate;
  networkDrop: Rate;
}

/** Share of the all-low or all-high swing used for the likely range of a total. */
export const POOL = 0.5;
const HOUSE_GROUPS: Group[] = ['Structure', 'Envelope', 'Systems', 'Interior'];
const round = (v: number): number => Math.round(v / 10) * 10;
const times = (r: Range, q: number): Range => ({ low: round(r.low * q), mid: round(r.mid * q), high: round(r.high * q) });
const add = (a: Range, b: Range): Range => ({ low: a.low + b.low, mid: a.mid + b.mid, high: a.high + b.high });
const ZERO: Range = { low: 0, mid: 0, high: 0 };
const fmt = (v: number): string => Math.round(v).toLocaleString('en-US');
const worst = (list: Confidence[]): Confidence => {
  const order: Confidence[] = ['assumption', 'guide', 'official', 'published'];
  return order.find((c) => list.includes(c)) ?? 'guide';
};

/** Taller walls and steeper roofs need more steel, longer posts and more labor per square foot of floor. */
export function shellFactor(q: Takeoff): number {
  const height = 1 + Math.max(0, q.eaveHeight - 10) * 0.025;
  const pitch = 1 + Math.max(0, q.roofPitch - 4) * 0.02;
  return height * pitch;
}

/** Linear feet of kitchen cabinet run plus bathroom vanities, and square feet of countertop. */
export function cabinetry(q: Takeoff): { cabinetFt: number; counterSf: number } {
  // Kitchen wall run with uppers plus the island; a 5 ft double vanity, a 3 ft vanity per other
  // full bath and a 2 ft vanity per half bath.
  const vanityFt = 5 + Math.max(0, q.fullBaths - 1) * 3 + q.halfBaths * 2;
  return { cabinetFt: q.kitchenRunFt + q.kitchenIslandFt + vanityFt, counterSf: Math.round(q.kitchenRunFt * 2.1 + q.kitchenIslandFt * 3.5 + vanityFt * 1.9) };
}

/** Shared settings with one option's own choices laid over them. */
export function settingsFor(option: OptionPlan, base: Settings): Settings {
  const spec = option.spec ?? {};
  return {
    ...base,
    finish: spec.finish ?? base.finish,
    extras: { ...base.extras, ...spec.extras },
    overheadElectric: spec.overheadElectric ?? base.overheadElectric,
    networkDrops: spec.networkDrops ?? base.networkDrops,
  };
}

export function estimate(option: OptionPlan, rates: Rates, base: Settings): Estimate {
  const s = settingsFor(option, base);
  const f = FINISH_FACTORS[s.finish];
  const q = takeoff(option);
  const items: LineItem[] = [];
  const line = (id: string, group: Group, label: string, basis: string, parts: [Rate, number][], note = ''): void => {
    let total = ZERO;
    for (const [rate, qty] of parts) total = add(total, times(rate.range, qty));
    items.push({
      id,
      group,
      label,
      basis,
      total,
      confidence: worst(parts.map(([r]) => r.confidence)),
      sources: [...new Set(parts.flatMap(([r]) => r.sources))],
      note: note || parts.map(([r]) => r.note).filter(Boolean).join(' '),
    });
  };
  const k = shellFactor(q);
  const windowCount = q.windows.single + q.windows.double + q.windows.picture;
  const cab = cabinetry(q);
  // Wall and ceiling board: both faces of every partition, the inside face of the exterior walls, and the ceilings.
  const drywallSf = Math.round(q.interiorWallFt * 9 * 2 + q.extWallSf * 0.9 + q.heatedSf * 1.12);
  // Insulated envelope: exterior walls plus the roof or ceiling plane.
  const envelopeSf = q.extWallSf + q.roofSf;

  // ---- Before you build
  line('plans', 'Before you build', 'Plans and engineering', 'one plan set, drafted to these dimensions, plus a foundation and structural stamp', [
    [rates.plans, 1],
    [rates.engineering, 1],
  ]);
  line('permits', 'Before you build', 'Permits and inspections', `state electrical, plumbing (${q.plumbingFixtures} fixtures), HVAC and septic fees`, [[rates.permits, 1]]);
  line('permits-local', 'Before you build', 'County and health department fees', 'county building permit, local electrical inspector, septic site evaluation', [[rates.permitsLocal, 1]]);
  line('survey', 'Before you build', 'Survey and soil or perc test', 'boundary survey and septic site evaluation', [
    [rates.survey, 1],
    [rates.soilTest, 1],
  ]);

  // ---- Site and utilities
  const padSf = Math.round((q.mainSf + q.porchSf) * 1.35);
  line('sitework', 'Site and utilities', 'Site clearing and grading', `${fmt(padSf)} sq ft building pad on open pasture, gentle slope`, [[rates.sitePrepPerSf, padSf]]);
  line('driveway', 'Site and utilities', 'Driveway', `${fmt(s.roadDistanceFt)} ft of 12 ft wide gravel drive`, [[rates.drivewayPerFt, s.roadDistanceFt]]);
  line('well', 'Site and utilities', 'Well', 'new drilled well with casing, pump, pressure tank and line to the house', [[rates.well, 1]]);
  // The septic rate is for four bedrooms; smaller houses need a smaller tank and field.
  const septicFactor = q.bedrooms >= 4 ? 1 : q.bedrooms === 3 ? 0.75 : 0.7;
  line('septic', 'Site and utilities', 'Septic', `new system sized for ${q.bedrooms} bedrooms`, [[rates.septic, septicFactor]]);
  if (s.overheadElectric) {
    line('electric-run', 'Site and utilities', 'Electric service run', `${fmt(s.roadDistanceFt)} ft of overhead line at no extension charge, meter base and temporary power`, [[rates.electricService, 1]]);
  } else {
    line('electric-run', 'Site and utilities', 'Electric service run', `${fmt(s.roadDistanceFt)} ft underground from the line at the road, meter base and temporary power`, [
      [rates.electricRunPerFt, s.roadDistanceFt],
      [rates.electricService, 1],
    ]);
  }
  line('landscaping', 'Site and utilities', 'Landscaping', s.finish === 'budget' ? 'seed and straw only' : 'final grade, seed and straw around the house', [[rates.landscaping, f.landscaping]]);

  // ---- Structure
  line('slab', 'Structure', 'Foundation slab', `${fmt(q.mainSf)} sq ft monolithic slab with thickened edges`, [[rates.slabPerSf, q.mainSf]]);
  line(
    'shell',
    'Structure',
    'Building shell or kit',
    `${fmt(q.mainSf)} sq ft footprint, ${q.eaveHeight} ft walls, ${q.roofPitch}:12 roof${k > 1.001 ? ` (x${k.toFixed(2)} for height and pitch)` : ''}`,
    [[rates.shellPerSf, q.mainSf * k]],
  );
  line('erection', 'Structure', 'Erection labor', `${fmt(q.mainSf)} sq ft shell${k > 1.001 ? ` (x${k.toFixed(2)} for height and pitch)` : ''}`, [[rates.erectionPerSf, q.mainSf * k]]);
  if (q.upperSf > 0) {
    line('upper', 'Structure', 'Upper floor framing and stair', `${fmt(q.upperSf)} sq ft of floor system and one staircase`, [
      [rates.upperFloorPerSf, q.upperSf],
      [rates.stair, q.stairs],
    ]);
  }
  if (q.porchSf > 0) line('porches', 'Structure', 'Porches', `${fmt(q.porchSf)} sq ft covered porch: slab, posts, lean-to roof`, [[rates.porchPerSf, q.porchSf]]);

  // ---- Envelope
  line('insulation', 'Envelope', 'Insulation', `${fmt(envelopeSf)} sq ft of walls and roof`, [[rates.insulationPerSf, envelopeSf * f.insulation]]);
  line('windows-doors', 'Envelope', 'Windows and doors', `${windowCount} windows, ${q.exteriorDoors} entry doors, ${q.patioDoors} patio doors`, [
    [rates.windowSingle, q.windows.single * f.windows],
    [rates.windowDouble, q.windows.double * f.windows],
    [rates.windowPicture, q.windows.picture * f.windows],
    [rates.entryDoor, q.exteriorDoors * f.doors],
    [rates.patioDoor, q.patioDoors * f.doors],
  ]);
  line('gutters', 'Envelope', 'Gutters', `${fmt(q.gutterFt)} ft of gutter with downspouts`, [[rates.gutterPerFt, q.gutterFt]]);

  // ---- Systems
  line('electrical', 'Systems', 'Electrical', `${fmt(q.heatedSf)} sq ft, 200 amp panel`, [[rates.electricalPerSf, q.heatedSf]]);
  line('plumbing', 'Systems', 'Plumbing', `${q.plumbingFixtures} fixtures in ${q.wetZones} wet zone${q.wetZones > 1 ? 's' : ''}`, [[rates.plumbingPerFixture, q.plumbingFixtures + (q.wetZones - 1) * 1.5]]);
  line('hvac', 'Systems', 'HVAC', `central ducted heat pump for ${fmt(q.heatedSf)} sq ft`, [[rates.hvacPerSf, q.heatedSf]]);

  // ---- Interior
  line('framing', 'Interior', 'Framing of interior walls', `${fmt(q.interiorWallFt)} ft of partitions plus ${fmt(q.perimeterFt)} ft of framing inside the exterior walls`, [
    [rates.partitionPerFt, q.interiorWallFt + q.perimeterFt],
  ]);
  line('drywall', 'Interior', 'Drywall', `${fmt(drywallSf)} sq ft of wall and ceiling board`, [[rates.drywallPerSf, drywallSf]]);
  line('flooring', 'Interior', 'Flooring', `${fmt(q.heatedSf)} sq ft`, [[rates.flooringPerSf, q.heatedSf * f.flooring]]);
  line('cabinets', 'Interior', 'Cabinets and counters', `${cab.cabinetFt} ft of cabinets, ${cab.counterSf} sq ft of countertop`, [
    [rates.cabinetsPerFt, cab.cabinetFt * f.cabinets],
    [rates.countersPerSf, cab.counterSf * f.counters],
  ]);
  line('appliances', 'Interior', 'Appliances', 'range, refrigerator, dishwasher, microwave, washer and dryer', [[rates.appliances, f.appliances]]);
  line('fixtures', 'Interior', 'Fixtures', `plumbing fixtures for ${q.fullBaths} full and ${q.halfBaths} half baths and the kitchen, plus lighting`, [
    [rates.plumbingFixturesPerBath, (q.fullBaths + q.halfBaths * 0.5) * f.fixtures],
    [rates.kitchenFixtures, f.fixtures],
    [rates.lightingPerSf, q.heatedSf * f.lighting],
  ]);
  line('paint', 'Interior', 'Paint', `${fmt(q.heatedSf)} sq ft of floor area, walls and ceilings`, [[rates.paintPerSf, q.heatedSf * f.paint]]);
  line('trim', 'Interior', 'Interior doors and trim', `${q.interiorDoors} doors, ${q.casedOpenings} cased openings, baseboard and casing`, [
    [rates.interiorDoor, (q.interiorDoors + q.casedOpenings * 0.5) * f.interiorDoor],
    [rates.trimPerSf, q.heatedSf * f.trim],
  ]);

  // ---- Must-have extras
  if (s.extras.stormShelter) line('storm-shelter', 'Must-have extras', 'Below-ground storm shelter', 'one outdoor in-ground shelter, installed', [[rates.stormShelter, 1]]);
  if (s.extras.woodStove) line('wood-stove', 'Must-have extras', 'Wood stove', 'freestanding stove with chimney, installed', [[rates.woodStove, 1]]);
  if (s.extras.generatorHookup) line('generator', 'Must-have extras', 'Generator hookup', 'inlet and transfer switch, generator not included', [[rates.generatorHookup, 1]]);
  if (s.extras.network) line('network', 'Must-have extras', 'Wired internet', `${s.networkDrops} network drops`, [[rates.networkDrop, s.networkDrops]]);

  // ---- Builder, loan and risk
  const builderManaged = items.filter((i) => i.group !== 'Before you build');
  const hard = builderManaged.reduce((sum, i) => add(sum, i.total), ZERO);
  const gc: Range = { low: round((hard.low * s.gcPct.low) / 100), mid: round((hard.mid * s.gcPct.mid) / 100), high: round((hard.high * s.gcPct.high) / 100) };
  items.push({
    id: 'gc',
    group: 'Builder, loan and risk',
    label: "Builder's overhead and profit",
    basis: `${s.gcPct.low} to ${s.gcPct.high} percent of construction cost`,
    total: gc,
    confidence: 'guide',
    sources: ['gc-markup'],
    note: 'A builder does all the work, so the builder\'s fee is a real cost. It is not on your list, so I added it.',
  });
  const construction = add(hard, gc);
  const contingency: Range = {
    low: round((construction.low * s.contingencyPct.low) / 100),
    mid: round((construction.mid * s.contingencyPct.mid) / 100),
    high: round((construction.high * s.contingencyPct.high) / 100),
  };
  const soft = items.filter((i) => i.group === 'Before you build').reduce((sum, i) => add(sum, i.total), ZERO);
  const beforeFinance = add(add(construction, contingency), soft);
  const risk: Range = {
    low: round((construction.low * s.builderRiskPct.low) / 100),
    mid: round((construction.mid * s.builderRiskPct.mid) / 100),
    high: round((construction.high * s.builderRiskPct.high) / 100),
  };
  // Interest-only on the amount drawn; on average about half the loan is out over the build.
  const loan = (cost: number, rate: number, months: number, closing: number): number => {
    const principal = cost * s.loanShare;
    return round(principal * (rate / 100) * (months / 12) * 0.55 + (principal * closing) / 100);
  };
  const interest: Range = {
    low: loan(beforeFinance.low, s.loanRatePct.low, s.buildMonths.low, s.closingPct.low),
    mid: loan(beforeFinance.mid, s.loanRatePct.mid, s.buildMonths.mid, s.closingPct.mid),
    high: loan(beforeFinance.high, s.loanRatePct.high, s.buildMonths.high, s.closingPct.high),
  };
  items.push({
    id: 'loan',
    group: 'Builder, loan and risk',
    label: 'Construction loan interest and closing costs',
    basis: `${Math.round(s.loanShare * 100)} percent financed, ${s.loanRatePct.low} to ${s.loanRatePct.high} percent interest-only for ${s.buildMonths.low} to ${s.buildMonths.high} months, plus ${s.closingPct.low} to ${s.closingPct.high} percent closing`,
    total: interest,
    confidence: 'guide',
    sources: ['loan-rates'],
    note: 'Interest is charged only on money drawn, which averages a little over half the loan across the build.',
  });
  items.push({
    id: 'builders-risk',
    group: 'Builder, loan and risk',
    label: "Builder's risk insurance",
    basis: `${s.builderRiskPct.low} to ${s.builderRiskPct.high} percent of construction cost`,
    total: risk,
    confidence: 'guide',
    sources: ['builders-risk'],
    note: '',
  });
  items.push({
    id: 'contingency',
    group: 'Builder, loan and risk',
    label: 'Contingency',
    basis: `${s.contingencyPct.low} to ${s.contingencyPct.high} percent of construction cost`,
    total: contingency,
    confidence: 'assumption',
    sources: [],
    note: 'The 10 to 15 percent you asked for.',
  });

  const sum = items.reduce((acc, i) => add(acc, i.total), ZERO);
  const total: Range = { low: round(sum.mid - (sum.mid - sum.low) * POOL), mid: sum.mid, high: round(sum.mid + (sum.high - sum.mid) * POOL) };
  const solid = items.filter((i) => i.confidence === 'published' || i.confidence === 'official').reduce((acc, i) => acc + i.total.mid, 0);
  const house = items.filter((i) => HOUSE_GROUPS.includes(i.group));
  const fee = 1 + s.gcPct.mid / 100;
  const withPorch = round(house.reduce((acc, i) => acc + i.total.mid, 0) * fee);
  const withoutPorch = round(house.filter((i) => i.id !== 'porches').reduce((acc, i) => acc + i.total.mid, 0) * fee);
  return {
    option,
    quantities: q,
    settings: s,
    items,
    construction,
    total,
    extremes: { low: sum.low, high: sum.high },
    perHeatedSf: { low: Math.round(total.low / q.heatedSf), mid: Math.round(total.mid / q.heatedSf), high: Math.round(total.high / q.heatedSf) },
    houseOnly: { withPorch, withoutPorch, perSf: Math.round(withoutPorch / q.heatedSf), perSfUnderRoof: Math.round(withPorch / (q.heatedSf + q.porchSf)) },
    solidShare: sum.mid ? solid / sum.mid : 0,
  };
}
