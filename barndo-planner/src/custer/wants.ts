/**
 * The owner's checklist answers (saved 11 Nov 2026) and how each floor plan option meets them.
 * 'yes' = built into the base plan and price, 'part' = partly met, 'no' = not in the base plan,
 * 'addon' = available as a priced add-on, not counted as met.
 */
export type Met = 'yes' | 'part' | 'no' | 'addon';
export type OptionId = 'a' | 'b' | 'c' | 'd';

export interface Want {
  id: string;
  label: string;
  rank: 'must' | 'nice' | 'no';
  /** How options a, b, c, d meet it, in that order. Omitted when the want is not scored. */
  met?: [Met, Met, Met, Met];
  /** Why a want is left out of the scoring, or a note on how it is met. */
  note?: string;
}

const ALL: [Met, Met, Met, Met] = ['yes', 'yes', 'yes', 'yes'];
const NONE: [Met, Met, Met, Met] = ['no', 'no', 'no', 'no'];
const ADDON: [Met, Met, Met, Met] = ['addon', 'addon', 'addon', 'addon'];

export const WANTS: Want[] = [
  // ---- Must-haves (18)
  { id: 'r-primary-suite', rank: 'must', label: 'Primary bedroom with its own bathroom', met: ALL },
  { id: 'p-wrap', rank: 'must', label: 'Wraparound porch', met: ALL, note: 'Porch wraps the front and one end of every option.' },
  { id: 's-later', rank: 'must', label: 'Detached shop later, not part of this build', met: ALL, note: 'No shop is priced. Each plan leaves both gable ends free for a later building.' },
  { id: 'c-vault', rank: 'must', label: 'Vaulted great room', met: ALL },
  { id: 'k-island', rank: 'must', label: 'Large island with seating', met: ALL },
  { id: 'k-pantry', rank: 'must', label: 'Walk-in pantry', met: ALL },
  { id: 'k-ushape', rank: 'must', label: 'U-shaped or L-shaped kitchen with more counter', met: ALL, note: 'L-shaped kitchen plus island in every option.' },
  { id: 'k-window', rank: 'must', label: 'Window over the sink', met: ALL },
  { id: 'o-room', rank: 'must', label: 'Office with a door', met: ALL },
  { id: 'o-wired', rank: 'must', label: 'Wired internet run to the office', met: ALL, note: 'Priced as network drops to the office and main rooms.' },
  { id: 'ss-underground', rank: 'must', label: 'Below-ground shelter outside or under the garage floor', met: ALL, note: 'Priced as an outdoor in-ground shelter, since there is no garage.' },
  { id: 'a-onelevel', rank: 'must', label: 'Everything I use daily on one level', met: ['yes', 'yes', 'part', 'yes'], note: 'Option C keeps the primary suite, kitchen, laundry and office downstairs but puts three bedrooms upstairs.' },
  { id: 'h-heatpump', rank: 'must', label: 'Central electric heat pump with ducts', met: ALL },
  { id: 'h-wood', rank: 'must', label: 'Wood stove or fireplace', met: ALL, note: 'Priced as a freestanding wood stove with a chimney.' },
  { id: 'h-generator', rank: 'must', label: 'Generator hookup for outages', met: ALL, note: 'Priced as an inlet and transfer switch, not the generator itself.' },
  { id: 'e-bb', rank: 'must', label: 'Board-and-batten or wood accents', met: ALL, note: 'Board-and-batten profile steel siding with wood porch posts.' },
  { id: 'e-farm', rank: 'must', label: 'White farmhouse look with a dark roof', met: ALL },
  { id: 'e-glass', rank: 'must', label: 'Big windows or glass doors on the view side', met: ALL, note: 'Each plan can be mirrored or turned so the glass faces your view.' },

  // ---- Nice-to-haves that the plans can be scored on (33)
  { id: 'r-primary-wic', rank: 'nice', label: 'Walk-in closet in the primary bedroom', met: ['yes', 'yes', 'part', 'yes'], note: 'Option C has a small 4 x 6 ft closet.' },
  { id: 'r-split', rank: 'nice', label: 'Split bedrooms, primary on the opposite side', met: ['part', 'yes', 'yes', 'yes'] },
  { id: 'r-open', rank: 'nice', label: 'Open kitchen, dining, and living in one great room', met: ALL },
  { id: 'r-dining', rank: 'nice', label: 'Separate dining room', met: ['no', 'no', 'no', 'part'], note: 'Dining is open to the great room. Option D gives it its own bay.' },
  { id: 'r-laundry', rank: 'nice', label: 'Laundry room with a door', met: ALL },
  { id: 'r-mudroom', rank: 'nice', label: 'Mudroom', met: ['no', 'no', 'yes', 'yes'] },
  { id: 'r-bonus', rank: 'nice', label: 'Second living area or bonus room', met: ['no', 'yes', 'part', 'no'] },
  { id: 'r-nohall', rank: 'nice', label: 'Shortest possible hallways', met: ['part', 'yes', 'part', 'yes'] },
  { id: 'p-front', rank: 'nice', label: 'Covered front porch', met: ALL },
  { id: 'p-back', rank: 'nice', label: 'Covered back porch or patio', met: NONE, note: 'Not in the base plans. A back porch is a priced add-on.' },
  { id: 'p-screen', rank: 'nice', label: 'Screened porch', met: NONE, note: 'Not in the base plans. Screening the end porch is a priced add-on.' },
  { id: 'p-deep', rank: 'nice', label: 'Porch deep enough for a table, 10 ft or more', met: ['no', 'no', 'no', 'yes'] },
  { id: 'st-coat', rank: 'nice', label: 'Coat and linen closets', met: ['yes', 'no', 'yes', 'yes'] },
  { id: 'st-attic', rank: 'nice', label: 'Storage loft above the shop or bedrooms', met: ['no', 'yes', 'yes', 'no'] },
  { id: 'st-mech', rank: 'nice', label: 'Mechanical room', met: ['part', 'part', 'yes', 'part'], note: 'Where there is no separate room, the water heater and air handler share the laundry.' },
  { id: 'st-safe', rank: 'nice', label: 'Secure closet for valuables or a gun safe', met: ['no', 'no', 'yes', 'yes'] },
  { id: 'st-freezer', rank: 'nice', label: 'Space for a chest freezer or second refrigerator', met: ['part', 'yes', 'part', 'yes'] },
  { id: 'o-guest', rank: 'nice', label: 'Office that doubles as a guest room', met: ALL },
  { id: 'ss-saferoom', rank: 'nice', label: 'Reinforced safe room on the slab', met: ['no', 'no', 'part', 'yes'] },
  { id: 'ss-basement', rank: 'nice', label: 'Basement', met: NONE, note: 'Left out of every option. It works against the lowest-cost goal.' },
  { id: 'a-nostep', rank: 'nice', label: 'No-step entry', met: ALL },
  { id: 'a-doors', rank: 'nice', label: '36 inch doors and wide halls', met: ALL },
  { id: 'a-shower', rank: 'nice', label: 'Curbless walk-in shower', met: ALL },
  { id: 'a-blocking', rank: 'nice', label: 'Wall blocking for future grab bars', met: ALL },
  { id: 'e-metal', rank: 'nice', label: 'All-metal siding', met: ALL },
  { id: 'h-minisplit', rank: 'nice', label: 'Ductless mini-splits', met: ['no', 'part', 'no', 'no'], note: 'Only the bonus loft in option B uses one.' },
  { id: 'c-beams', rank: 'nice', label: 'Exposed trusses or beams', met: ADDON },
  { id: 'k-gas', rank: 'nice', label: 'Propane gas range', met: ADDON },
  { id: 'k-custom', rank: 'nice', label: 'Custom cabinets instead of stock sizes', met: ADDON, note: 'Part of the high finish level.' },
  { id: 'h-radiant', rank: 'nice', label: 'In-slab radiant floor heat', met: ADDON },
  { id: 'e-wainscot', rank: 'nice', label: 'Stone or brick wainscot', met: ADDON },
  { id: 'e-cupola', rank: 'nice', label: 'Cupolas, dormers, or decorative gables', met: ADDON },
  { id: 'e-seam', rank: 'nice', label: 'Standing-seam roof', met: ADDON },

  // ---- Nice-to-haves not scored: they conflict with a must-have or belong to the later shop (9)
  { id: 'c-flat9', rank: 'nice', label: 'Flat 9 ft ceilings throughout', note: 'Overridden by the vaulted great room must-have. Bedrooms and baths get flat 9 ft ceilings.' },
  { id: 'c-10', rank: 'nice', label: '10 ft ceilings in the main rooms', note: 'Overridden by the vaulted great room must-have.' },
  { id: 'k-onewall', rank: 'nice', label: 'One-wall kitchen plus an island', note: 'Overridden by the L-shaped kitchen must-have.' },
  { id: 'o-nook', rank: 'nice', label: 'Desk nook in a shared room', note: 'Overridden by the office-with-a-door must-have.' },
  { id: 'e-dark', rank: 'nice', label: 'Dark modern look', note: 'Overridden by the white farmhouse must-have.' },
  { id: 's-attached', rank: 'nice', label: 'Shop under the same roof as the house', note: 'You answered no attached shop and marked a detached shop later as a must. Shop wants are held for that building.' },
  { id: 's-garage', rank: 'nice', label: 'Everyday garage bays for cars', note: 'Held for the later detached shop.' },
  { id: 's-heated', rank: 'nice', label: 'Shop insulated and heated', note: 'Held for the later detached shop.' },
  { id: 's-bath', rank: 'nice', label: 'Half bath or utility sink in the shop', note: 'Held for the later detached shop.' },

  // ---- Don't-wants (6): every option avoids all of them
  { id: 'r-guest', rank: 'no', label: 'Extra guest or flex room beyond my bedroom count' },
  { id: 's-tall', rank: 'no', label: 'Tall overhead door for a camper, RV, or tractor' },
  { id: 's-lift', rank: 'no', label: 'Slab thick enough for a vehicle lift' },
  { id: 'c-loft', rank: 'no', label: 'Loft that overlooks the great room' },
  { id: 'h-propane', rank: 'no', label: 'Propane furnace or dual-fuel system' },
  { id: 'h-geo', rank: 'no', label: 'Geothermal heat pump' },
];

const INDEX: Record<OptionId, number> = { a: 0, b: 1, c: 2, d: 3 };

export interface WantScore {
  mustMet: number;
  mustTotal: number;
  niceMet: number;
  niceTotal: number;
}

/** Counts met wants for one option. A partly met want counts as half. */
export function scoreWants(option: OptionId): WantScore {
  const i = INDEX[option];
  const value = (m: Met): number => (m === 'yes' ? 1 : m === 'part' ? 0.5 : 0);
  const musts = WANTS.filter((w) => w.rank === 'must' && w.met);
  const nices = WANTS.filter((w) => w.rank === 'nice' && w.met);
  return {
    mustMet: musts.reduce((s, w) => s + value((w.met as Met[])[i]), 0),
    mustTotal: musts.length,
    niceMet: nices.reduce((s, w) => s + value((w.met as Met[])[i]), 0),
    niceTotal: nices.length,
  };
}
