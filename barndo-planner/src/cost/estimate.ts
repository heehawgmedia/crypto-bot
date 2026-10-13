import { EXTERIOR_DOOR_KINDS, WINDOW_KINDS } from '../model/catalog';
import {
  areaSummary,
  exteriorWallArea,
  isShopRoom,
  isWetRoom,
  perimeterSide,
  porchArea,
  doorInterval,
  roofMetrics,
  roomArea,
} from '../model/geometry';
import type { Project } from '../model/types';
import { PRICING } from './pricing';

export type Category =
  | 'Site & permits'
  | 'Foundation'
  | 'Shell & framing'
  | 'Roofing'
  | 'Exterior finish'
  | 'Insulation'
  | 'Windows & doors'
  | 'Interior finish'
  | 'Flooring'
  | 'Kitchen & baths'
  | 'Plumbing'
  | 'Electrical'
  | 'HVAC'
  | 'Porches & extras';

export const CATEGORY_ORDER: Category[] = [
  'Site & permits',
  'Foundation',
  'Shell & framing',
  'Roofing',
  'Exterior finish',
  'Insulation',
  'Windows & doors',
  'Interior finish',
  'Flooring',
  'Kitchen & baths',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Porches & extras',
];

export interface LineItem {
  category: Category;
  label: string;
  detail: string;
  amount: number;
}

export interface EstimateMetrics {
  footprintSf: number;
  livingSf: number;
  shopSf: number;
  openSf: number;
  conditionedSf: number;
  roofSf: number;
  wallSf: number;
  porchSf: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
  windows: number;
  exteriorDoors: number;
  interiorDoors: number;
  costPerSf: number;
  costPerLivingSf: number;
}

export interface Estimate {
  items: LineItem[];
  subtotal: number;
  contingency: number;
  total: number;
  metrics: EstimateMetrics;
  warnings: string[];
}

const money = (n: number): number => Math.round(n);

export function estimate(project: Project): Estimate {
  const { plan, options: o } = project;
  const mult = o.regionMultiplier > 0 ? o.regionMultiplier : 1;
  const areas = areaSummary(plan);
  const fp = areas.footprint;
  const livingSf = areas.living;
  const shopSf = areas.shop;
  const conditionedSf = livingSf + (o.shopConditioned ? shopSf : 0);
  const roof = roofMetrics(plan);
  const wallSf = exteriorWallArea(plan);
  const porchSf = porchArea(plan);
  const perimeter = 2 * (plan.width + plan.depth);
  const items: LineItem[] = [];
  const warnings: string[] = [];

  const add = (category: Category, label: string, amount: number, detail = ''): void => {
    items.push({ category, label, detail, amount: money(amount * mult) });
  };

  // --- Site & permits ---------------------------------------------------
  add('Site & permits', 'Site prep & grading', fp * PRICING.site.prepPerSf, `${fp.toLocaleString()} sf footprint`);
  add('Site & permits', 'Permits, plans & engineering', PRICING.site.permitsBase + fp * PRICING.site.permitsPerSf);
  add('Site & permits', 'Electrical service drop', PRICING.site.serviceDrop);
  if (o.well) add('Site & permits', 'Water well', PRICING.site.well);
  if (o.septic) add('Site & permits', 'Septic system', PRICING.site.septic);
  if (o.cityUtilities) add('Site & permits', 'City water & sewer taps', PRICING.site.cityTaps);
  if (o.driveway) add('Site & permits', 'Gravel driveway', PRICING.site.driveway);

  // --- Foundation --------------------------------------------------------
  const fnd = PRICING.foundation[o.foundation];
  add('Foundation', fnd.label, fp * fnd.rate, `${fp.toLocaleString()} sf × $${fnd.rate}/sf`);

  // --- Shell -------------------------------------------------------------
  const shell = PRICING.shell[o.shell];
  const heightFactor = 1 + Math.max(0, plan.wallHeight - PRICING.shellBaseHeight) * PRICING.shellHeightPremiumPerFt;
  add(
    'Shell & framing',
    `${shell.label}, ${plan.wallHeight} ft eave`,
    fp * shell.rate * heightFactor,
    `${fp.toLocaleString()} sf × $${shell.rate}/sf${heightFactor > 1 ? ` × ${heightFactor.toFixed(2)} height factor` : ''}`,
  );

  // --- Roofing -----------------------------------------------------------
  const roofing = PRICING.roofing[o.roofing];
  const pitchFactor = 1 + Math.max(0, plan.roofPitch - PRICING.roofBasePitch) * PRICING.roofPitchPremiumPerPoint;
  add(
    'Roofing',
    `${roofing.label}, ${plan.roofPitch}:12 pitch`,
    roof.area * roofing.rate * pitchFactor,
    `${Math.round(roof.area).toLocaleString()} sf roof × $${roofing.rate}/sf${pitchFactor > 1 ? ` × ${pitchFactor.toFixed(2)} pitch factor` : ''}`,
  );

  // --- Exterior finish ---------------------------------------------------
  const ext = PRICING.exterior[o.exterior];
  if (o.exterior === 'stone-wainscot') {
    add('Exterior finish', ext.label, perimeter * PRICING.wainscotPerLf, `${perimeter} lf × $${PRICING.wainscotPerLf}/lf`);
  } else {
    add('Exterior finish', ext.label, wallSf * ext.rate, ext.rate ? `${Math.round(wallSf).toLocaleString()} sf wall × $${ext.rate}/sf` : 'no upcharge');
  }

  // --- Insulation --------------------------------------------------------
  const ins = PRICING.insulation[o.insulation];
  const insulatedFraction = o.shopConditioned || o.shopFinish !== 'unfinished' || shopSf === 0 ? 1 : livingSf / fp;
  const envelopeSf = (wallSf + roof.area) * insulatedFraction;
  add(
    'Insulation',
    ins.label,
    envelopeSf * ins.rate,
    `${Math.round(envelopeSf).toLocaleString()} sf envelope × $${ins.rate}/sf${insulatedFraction < 1 ? ' (shop left uninsulated)' : ''}`,
  );

  // --- Windows & doors ---------------------------------------------------
  let windowCost = 0;
  for (const w of plan.windows) windowCost += PRICING.windows[w.kind][o.windowGrade];
  if (plan.windows.length) {
    add('Windows & doors', `${plan.windows.length} windows (${o.windowGrade})`, windowCost, plan.windows.map((w) => WINDOW_KINDS[w.kind].label).join(', '));
  }
  let extDoorCost = 0;
  const extLabels: string[] = [];
  for (const d of plan.exteriorDoors) {
    extDoorCost += PRICING.exteriorDoors[d.kind];
    extLabels.push(EXTERIOR_DOOR_KINDS[d.kind].label);
  }
  let interiorDoors = 0;
  let casedOpenings = 0;
  let roomExteriorDoors = 0;
  for (const r of plan.rooms) {
    for (const d of r.doors) {
      const di = doorInterval(r, d);
      if (perimeterSide(plan, di.axis, di.at)) {
        roomExteriorDoors++;
        extDoorCost += PRICING.exteriorDoors.entry;
      } else if (d.width > 3.5) casedOpenings++;
      else interiorDoors++;
    }
  }
  const exteriorDoorCount = plan.exteriorDoors.length + roomExteriorDoors;
  if (exteriorDoorCount) {
    add('Windows & doors', `${exteriorDoorCount} exterior doors`, extDoorCost, [...extLabels, ...(roomExteriorDoors ? [`${roomExteriorDoors} room door(s) on exterior wall`] : [])].join(', '));
  }
  if (interiorDoors) add('Windows & doors', `${interiorDoors} interior doors`, interiorDoors * PRICING.interiorDoor, `$${PRICING.interiorDoor} each, hung & trimmed`);
  if (casedOpenings) add('Windows & doors', `${casedOpenings} cased openings`, casedOpenings * PRICING.casedOpening, `$${PRICING.casedOpening} each`);

  // --- Interior finish ---------------------------------------------------
  const fin = PRICING.interiorFinish[o.interiorFinish];
  add('Interior finish', `${fin.label} finish, living area`, livingSf * fin.rate, `${livingSf.toLocaleString()} sf × $${fin.rate}/sf: ${fin.detail}`);
  if (shopSf > 0) {
    const sf = PRICING.shopFinish[o.shopFinish];
    add('Interior finish', `Shop / garage: ${sf.label}`, shopSf * sf.rate, sf.rate ? `${shopSf.toLocaleString()} sf × $${sf.rate}/sf` : `${shopSf.toLocaleString()} sf left open`);
  }

  // --- Flooring ----------------------------------------------------------
  const floor = PRICING.flooring[o.flooring];
  let wetSf = 0;
  for (const r of plan.rooms) if (!isShopRoom(r) && isWetRoom(r)) wetSf += roomArea(r);
  const wetRate = o.flooring === 'polished-concrete' ? floor.rate : PRICING.wetRoomTileRate;
  const drySf = livingSf - wetSf;
  add('Flooring', `${floor.label}, living areas`, drySf * floor.rate, `${drySf.toLocaleString()} sf × $${floor.rate}/sf`);
  if (wetSf > 0) add('Flooring', wetRate === floor.rate ? `${floor.label}, wet rooms` : 'Tile, wet rooms', wetSf * wetRate, `${wetSf.toLocaleString()} sf (baths, kitchen, laundry, mudroom) × $${wetRate}/sf`);
  if (shopSf > 0) add('Flooring', 'Sealed concrete, shop', shopSf * PRICING.shopFloorRate, `${shopSf.toLocaleString()} sf × $${PRICING.shopFloorRate}/sf`);

  // --- Kitchen & baths ---------------------------------------------------
  const kitchens = Math.max(1, plan.rooms.filter((r) => r.type === 'kitchen').length);
  const kitchen = PRICING.kitchen[o.kitchenTier];
  add('Kitchen & baths', `${kitchens > 1 ? `${kitchens} kitchens` : 'Kitchen'}: ${kitchen.label}`, kitchens * kitchen.cost, 'cabinets, counters, appliances, fixtures');
  const bath = PRICING.bath[o.bathTier];
  if (areas.fullBaths) add('Kitchen & baths', `${areas.fullBaths} full bath${areas.fullBaths > 1 ? 's' : ''}: ${bath.label}`, areas.fullBaths * bath.full, `$${bath.full.toLocaleString()} each`);
  if (areas.halfBaths) add('Kitchen & baths', `${areas.halfBaths} half bath${areas.halfBaths > 1 ? 's' : ''}: ${bath.label}`, areas.halfBaths * bath.full * PRICING.halfBathFactor);
  if (!areas.fullBaths && !areas.halfBaths) warnings.push('No bathrooms in the plan: add a Full bath or Half bath room.');
  if (!areas.bedrooms) warnings.push('No bedrooms in the plan.');

  // --- Plumbing ----------------------------------------------------------
  const laundries = plan.rooms.filter((r) => r.type === 'laundry').length;
  const pl = PRICING.plumbing;
  const plumbing = pl.base + areas.fullBaths * pl.perFullBath + areas.halfBaths * pl.perHalfBath + kitchens * pl.kitchen + laundries * pl.laundry;
  add('Plumbing', 'Rough-in & supply/drain lines', plumbing, `base + ${areas.fullBaths} full, ${areas.halfBaths} half bath, ${kitchens} kitchen, ${laundries} laundry`);
  add('Plumbing', o.waterHeater === 'tankless' ? 'Tankless water heater' : 'Tank water heater', pl.waterHeater[o.waterHeater]);

  // --- Electrical --------------------------------------------------------
  const el = PRICING.electrical;
  add('Electrical', 'Wiring, panel, fixtures & devices', livingSf * el.livingPerSf + shopSf * el.shopPerSf, `${livingSf.toLocaleString()} sf living × $${el.livingPerSf} + ${shopSf.toLocaleString()} sf shop × $${el.shopPerSf}`);
  if (el.service[o.electricalService]) add('Electrical', `${o.electricalService} service upgrade`, el.service[o.electricalService]);

  // --- HVAC --------------------------------------------------------------
  const hv = PRICING.hvac[o.hvac];
  add('HVAC', hv.label, Math.max(PRICING.hvacMinimum, conditionedSf * hv.rate), `${conditionedSf.toLocaleString()} sf conditioned × $${hv.rate}/sf${o.shopConditioned ? ' (incl. shop)' : ''}`);

  // --- Porches & extras --------------------------------------------------
  if (porchSf > 0) add('Porches & extras', 'Covered porch', porchSf * PRICING.porchPerSf, `${porchSf.toLocaleString()} sf × $${PRICING.porchPerSf}/sf (slab, posts, roof)`);
  if (o.fireplace) add('Porches & extras', 'Fireplace', PRICING.fireplace);

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const contingency = money(subtotal * (o.contingencyPct / 100));
  const total = subtotal + contingency;

  return {
    items,
    subtotal,
    contingency,
    total,
    warnings,
    metrics: {
      footprintSf: fp,
      livingSf,
      shopSf,
      openSf: areas.open,
      conditionedSf,
      roofSf: Math.round(roof.area),
      wallSf: Math.round(wallSf),
      porchSf,
      bedrooms: areas.bedrooms,
      fullBaths: areas.fullBaths,
      halfBaths: areas.halfBaths,
      windows: plan.windows.length,
      exteriorDoors: exteriorDoorCount,
      interiorDoors: interiorDoors + casedOpenings,
      costPerSf: fp ? total / fp : 0,
      costPerLivingSf: livingSf ? total / livingSf : 0,
    },
  };
}
