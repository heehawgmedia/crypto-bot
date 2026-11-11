/**
 * Full build-cost model: every line item the owner asked for, each with a low / expected / high
 * figure, the quantity it was multiplied by, where the unit price came from and how solid it is.
 */
import type { OptionPlan } from './types';
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
}

export interface Estimate {
  option: OptionPlan;
  quantities: Takeoff;
  items: LineItem[];
  /** Labor and materials the builder manages. */
  construction: Range;
  total: Range;
  perHeatedSf: Range;
  /** Share of the expected total that rests on published prices or official fees. */
  solidShare: number;
}

/** The unit prices the model needs. Filled from research in unitCosts.ts. */
export interface Rates {
  plans: Rate;
  engineering: Rate;
  permits: Rate;
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
  // L-shaped kitchen (about 24 ft of base run with uppers) plus a 7 ft island; a 5 ft double vanity,
  // a 3 ft vanity per other full bath and a 2 ft vanity per half bath.
  const vanityFt = 5 + Math.max(0, q.fullBaths - 1) * 3 + q.halfBaths * 2;
  return { cabinetFt: 24 + 7 + vanityFt, counterSf: Math.round((24 * 2.1 + 7 * 3.5 + vanityFt * 1.9) / 1) };
}

export function estimate(option: OptionPlan, rates: Rates, s: Settings): Estimate {
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
  line('permits', 'Before you build', 'Permits and inspections', `electrical, plumbing (${q.plumbingFixtures} fixtures), HVAC and septic permits`, [[rates.permits, 1]]);
  line('survey', 'Before you build', 'Survey and soil or perc test', 'boundary survey and septic site evaluation', [
    [rates.survey, 1],
    [rates.soilTest, 1],
  ]);

  // ---- Site and utilities
  const padSf = Math.round((q.mainSf + q.porchSf) * 1.35);
  line('sitework', 'Site and utilities', 'Site clearing and grading', `${fmt(padSf)} sq ft building pad on open pasture, gentle slope`, [[rates.sitePrepPerSf, padSf]]);
  line('driveway', 'Site and utilities', 'Driveway', `${fmt(s.roadDistanceFt)} ft of 12 ft wide gravel drive`, [[rates.drivewayPerFt, s.roadDistanceFt]]);
  line('well', 'Site and utilities', 'Well', 'new drilled well with casing, pump, pressure tank and line to the house', [[rates.well, 1]]);
  line('septic', 'Site and utilities', 'Septic', `new system sized for ${q.bedrooms} bedrooms`, [[rates.septic, 1]]);
  line('electric-run', 'Site and utilities', 'Electric service run', `${fmt(s.roadDistanceFt)} ft from the line at the road, meter base and temporary power`, [
    [rates.electricRunPerFt, s.roadDistanceFt],
    [rates.electricService, 1],
  ]);
  line('landscaping', 'Site and utilities', 'Landscaping', 'final grade, seed and straw around the house', [[rates.landscaping, 1]]);

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
  line('insulation', 'Envelope', 'Insulation', `${fmt(envelopeSf)} sq ft of walls and roof`, [[rates.insulationPerSf, envelopeSf]]);
  line('windows-doors', 'Envelope', 'Windows and doors', `${windowCount} windows, ${q.exteriorDoors} entry doors, ${q.patioDoors} patio doors`, [
    [rates.windowSingle, q.windows.single],
    [rates.windowDouble, q.windows.double],
    [rates.windowPicture, q.windows.picture],
    [rates.entryDoor, q.exteriorDoors],
    [rates.patioDoor, q.patioDoors],
  ]);
  line('gutters', 'Envelope', 'Gutters', `${fmt(q.gutterFt)} ft of gutter with downspouts`, [[rates.gutterPerFt, q.gutterFt]]);

  // ---- Systems
  line('electrical', 'Systems', 'Electrical', `${fmt(q.heatedSf)} sq ft, 200 amp panel`, [[rates.electricalPerSf, q.heatedSf]]);
  line('plumbing', 'Systems', 'Plumbing', `${q.plumbingFixtures} fixtures in ${q.wetZones} wet zone${q.wetZones > 1 ? 's' : ''}`, [[rates.plumbingPerFixture, q.plumbingFixtures + (q.wetZones - 1) * 1.5]]);
  line('hvac', 'Systems', 'HVAC', `central ducted heat pump for ${fmt(q.heatedSf)} sq ft`, [[rates.hvacPerSf, q.heatedSf]]);

  // ---- Interior
  line('framing', 'Interior', 'Framing of interior walls', `${fmt(q.interiorWallFt)} ft of partitions`, [[rates.partitionPerFt, q.interiorWallFt]]);
  line('drywall', 'Interior', 'Drywall', `${fmt(drywallSf)} sq ft of wall and ceiling board`, [[rates.drywallPerSf, drywallSf]]);
  line('flooring', 'Interior', 'Flooring', `${fmt(q.heatedSf)} sq ft`, [[rates.flooringPerSf, q.heatedSf]]);
  line('cabinets', 'Interior', 'Cabinets and counters', `${cab.cabinetFt} ft of cabinets, ${cab.counterSf} sq ft of countertop`, [
    [rates.cabinetsPerFt, cab.cabinetFt],
    [rates.countersPerSf, cab.counterSf],
  ]);
  line('appliances', 'Interior', 'Appliances', 'range, refrigerator, dishwasher, microwave, washer and dryer', [[rates.appliances, 1]]);
  line('fixtures', 'Interior', 'Fixtures', `plumbing fixtures for ${q.fullBaths} full and ${q.halfBaths} half baths and the kitchen, plus lighting`, [
    [rates.plumbingFixturesPerBath, q.fullBaths + q.halfBaths * 0.5],
    [rates.kitchenFixtures, 1],
    [rates.lightingPerSf, q.heatedSf],
  ]);
  line('paint', 'Interior', 'Paint', `${fmt(q.heatedSf)} sq ft of floor area, walls and ceilings`, [[rates.paintPerSf, q.heatedSf]]);
  line('trim', 'Interior', 'Interior doors and trim', `${q.interiorDoors} doors, ${q.casedOpenings} cased openings, baseboard and casing`, [
    [rates.interiorDoor, q.interiorDoors + q.casedOpenings * 0.5],
    [rates.trimPerSf, q.heatedSf],
  ]);

  // ---- Must-have extras
  line('storm-shelter', 'Must-have extras', 'Below-ground storm shelter', 'one outdoor in-ground shelter, installed', [[rates.stormShelter, 1]]);
  line('wood-stove', 'Must-have extras', 'Wood stove', 'freestanding stove with chimney, installed', [[rates.woodStove, 1]]);
  line('generator', 'Must-have extras', 'Generator hookup', 'inlet and transfer switch, generator not included', [[rates.generatorHookup, 1]]);
  line('network', 'Must-have extras', 'Wired internet', `${s.networkDrops} network drops`, [[rates.networkDrop, s.networkDrops]]);

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

  const total = items.reduce((sum, i) => add(sum, i.total), ZERO);
  const solid = items.filter((i) => i.confidence === 'published' || i.confidence === 'official').reduce((sum, i) => sum + i.total.mid, 0);
  return {
    option,
    quantities: q,
    items,
    construction,
    total,
    perHeatedSf: { low: Math.round(total.low / q.heatedSf), mid: Math.round(total.mid / q.heatedSf), high: Math.round(total.high / q.heatedSf) },
    solidShare: total.mid ? solid / total.mid : 0,
  };
}
