/**
 * Unit pricing used by the estimator. These are rough US national averages for a
 * contractor-built barndominium (2026 dollars) and are meant as a starting point:
 * adjust them to local bids, or use the regional multiplier in the UI.
 *
 * All "rate" values are dollars per square foot unless the key says otherwise.
 */
export const PRICING = {
  site: {
    prepPerSf: 2.5,
    permitsBase: 4500,
    permitsPerSf: 0.75,
    well: 12000,
    septic: 9500,
    cityTaps: 6500,
    driveway: 5500,
    serviceDrop: 3500,
  },
  foundation: {
    'mono-slab': { label: 'Monolithic slab', rate: 7.5 },
    'stem-wall': { label: 'Slab with stem wall', rate: 10.5 },
    piers: { label: 'Pier & beam (post-frame)', rate: 6 },
  },
  shell: {
    steel: { label: 'Pre-engineered steel frame', rate: 24 },
    'post-frame': { label: 'Post-frame (pole barn)', rate: 19 },
    'wood-frame': { label: 'Conventional wood frame', rate: 30 },
  },
  /** Shell cost grows ~3 % per foot of eave height above 10 ft. */
  shellBaseHeight: 10,
  shellHeightPremiumPerFt: 0.03,
  roofing: {
    'metal-rpanel': { label: 'Metal R-panel', rate: 4.75 },
    'standing-seam': { label: 'Standing-seam metal', rate: 9.5 },
    shingle: { label: 'Architectural shingles', rate: 5.75 },
  },
  roofBasePitch: 4,
  roofPitchPremiumPerPoint: 0.025,
  exterior: {
    'metal-panel': { label: 'Metal wall panels (included in shell)', rate: 0 },
    'board-batten': { label: 'Board & batten siding', rate: 7 },
    'stone-wainscot': { label: 'Stone wainscot + metal panels', rate: 0 },
    brick: { label: 'Full brick veneer', rate: 16 },
  },
  /** Stone wainscot: dollars per linear foot of perimeter (3 ft tall band). */
  wainscotPerLf: 96,
  insulation: {
    batt: { label: 'Fiberglass batt', rate: 1.85 },
    'spray-open': { label: 'Open-cell spray foam', rate: 3.4 },
    'spray-closed': { label: 'Closed-cell spray foam', rate: 5.75 },
    rigid: { label: 'Rigid board', rate: 2.6 },
  },
  windows: {
    single: { standard: 650, premium: 1150 },
    double: { standard: 1100, premium: 1900 },
    picture: { standard: 1500, premium: 2600 },
  },
  exteriorDoors: {
    entry: 1800,
    french: 3400,
    sliding: 2600,
    'overhead-10': 2400,
    'overhead-16': 4200,
  },
  interiorDoor: 475,
  casedOpening: 350,
  interiorFinish: {
    basic: { label: 'Basic', rate: 40, detail: 'drywall, paint, basic trim & fixtures' },
    standard: { label: 'Standard', rate: 58, detail: 'drywall, paint, trim, closets, mid lighting' },
    premium: { label: 'Premium', rate: 88, detail: 'upgraded trim, tongue & groove accents, lighting' },
    luxury: { label: 'Luxury', rate: 135, detail: 'custom millwork, vaulted ceilings, designer fixtures' },
  },
  shopFinish: {
    unfinished: { label: 'Unfinished (bare frame)', rate: 0 },
    liner: { label: 'Metal liner panel', rate: 9 },
    finished: { label: 'Drywall & paint', rate: 22 },
  },
  flooring: {
    'polished-concrete': { label: 'Polished concrete', rate: 4 },
    lvp: { label: 'Luxury vinyl plank', rate: 6.5 },
    tile: { label: 'Tile', rate: 12 },
    hardwood: { label: 'Hardwood', rate: 14 },
    carpet: { label: 'Carpet', rate: 5 },
  },
  wetRoomTileRate: 12,
  shopFloorRate: 2,
  kitchen: {
    basic: { label: 'Basic', cost: 18000 },
    mid: { label: 'Mid-range', cost: 36000 },
    high: { label: 'High-end', cost: 68000 },
    luxury: { label: 'Luxury', cost: 115000 },
  },
  bath: {
    basic: { label: 'Basic', full: 9500 },
    mid: { label: 'Mid-range', full: 17000 },
    high: { label: 'High-end', full: 30000 },
  },
  halfBathFactor: 0.5,
  plumbing: {
    base: 6500,
    perFullBath: 2400,
    perHalfBath: 1400,
    kitchen: 1600,
    laundry: 900,
    waterHeater: { tank: 1700, tankless: 3400 },
  },
  electrical: {
    livingPerSf: 7.75,
    shopPerSf: 4.25,
    service: { '200A': 0, '400A': 3200 },
  },
  hvac: {
    central: { label: 'Central heat pump (ducted)', rate: 9.5 },
    'mini-split': { label: 'Ductless mini-splits', rate: 7.25 },
    geothermal: { label: 'Geothermal', rate: 23 },
  },
  hvacMinimum: 6000,
  porchPerSf: 40,
  fireplace: 7000,
} as const;
