/**
 * Every source behind the cost model and the Kentucky facts. `opened: true` means the page itself
 * was fetched and read on the research date. `opened: false` means the figure came from a search
 * extract because the site refused automated visits; treat those as weaker.
 */
export interface Source {
  id: string;
  publisher: string;
  title: string;
  url: string;
  /** The page's own date or "accessed" date. */
  date: string;
  opened: boolean;
}

const s = (id: string, publisher: string, title: string, url: string, date: string, opened = true): Source => ({ id, publisher, title, url, date, opened });

export const SOURCES: Source[] = [
  // ---- Kentucky rules, fees and site facts
  s('breck-ordinances', 'Breckinridge County', 'Ordinances: no county planning and zoning; building inspector contact', 'https://breckinridgeky.com/ordinances/', 'modified 31 May 2026'),
  s('breck-directory', 'Breckinridge County', 'County directory: inspectors, health department, E-911', 'https://breckinridgeky.com/directory/', 'accessed 11 Nov 2026'),
  s('dhbc-breck', 'Kentucky Dept. of Housing, Buildings and Construction', 'Breckinridge County inspector sheet', 'https://dhbc.ky.gov/Documents/Breckinridge%20County.pdf', 'updated 17 Jul 2025'),
  s('krs-198b060', 'Kentucky Revised Statutes', 'KRS 198B.060: single-family permits are not mandatory unless a local ordinance requires them', 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=52659', 'current statute'),
  s('kar-electrical', 'Kentucky Administrative Regulations', '815 KAR 35:020: electrical inspection fees', 'https://apps.legislature.ky.gov/law/kar/titles/815/035/020/', 'current regulation'),
  s('kar-plumbing', 'Kentucky Administrative Regulations', '815 KAR 20:050: plumbing permit fees', 'https://apps.legislature.ky.gov/law/kar/titles/815/020/050/', 'current regulation'),
  s('kar-hvac', 'Kentucky Administrative Regulations', '815 KAR 8:070: HVAC permit fees', 'https://apps.legislature.ky.gov/law/kar/titles/815/008/070/', 'current regulation'),
  s('kar-septic', 'Kentucky Administrative Regulations', '902 KAR 10:085: on-site sewage site evaluation and system types', 'https://apps.legislature.ky.gov/law/kar/titles/902/010/085/', 'current regulation'),
  s('kar-septic-fee', 'Kentucky Administrative Regulations', '902 KAR 10:110: on-site sewage permit fee', 'https://apps.legislature.ky.gov/law/kar/titles/902/010/110/', 'current regulation'),
  s('kar-well', 'Kentucky Administrative Regulations', '401 KAR 6:310: water well construction by certified drillers', 'https://apps.legislature.ky.gov/law/kar/titles/401/006/310/', 'current regulation'),
  s('kgs-breck', 'Kentucky Geological Survey', 'Groundwater Resources of Breckinridge County (OF-01-14)', 'https://kgs.uky.edu/kgsweb/download/wrs/BRECKINRIDGE.pdf', '2001'),
  s('mcrecc-tariff', 'Meade County RECC, filed with the Kentucky PSC', 'Electric tariff: service area, 1,000 ft free extension, underground cost difference', 'https://psc.ky.gov/tariffs/Electric/Meade%20County%20RECC/Tariff.pdf', 'sheets effective 2011 and 2021'),
  s('mcrecc-apply', 'Meade County RECC', 'Apply for service: inspection certificate, connection and temporary service fees', 'https://www.mcrecc.com/apply-for-service/', 'accessed 11 Nov 2026'),
  s('kar-line-ext', 'Kentucky Administrative Regulations', '807 KAR 5:041 Section 11: free 1,000 ft line extension', 'https://apps.legislature.ky.gov/law/kar/titles/807/005/041/', 'current regulation'),
  s('krc-2018', 'Kentucky Dept. of Housing, Buildings and Construction', '2018 Kentucky Residential Code: frost depth, snow and wind design values', 'https://dhbc.ky.gov/Documents/2018%20Kentucky%20Residential%20Code%20-%20CLEAN_FINAL%207.17.20.pdf', 'second edition, May 2020'),
  s('ky-sb11', 'Kentucky General Assembly', '2026 Senate Bill 11: residential safe room rebate', 'https://apps.legislature.ky.gov/law/acts/26RS/documents/0005.pdf', 'signed 23 Mar 2026'),
  s('krs-sales-tax', 'Kentucky Revised Statutes', 'KRS 139.200: 6 percent sales tax', 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=58186', 'current statute'),

  // ---- Whole-house cost anchors
  s('buildmax-ky', 'BuildMax', 'Kentucky barndominium kits: kit and turnkey cost per sq ft', 'https://buildmax.com/kentucky-barndominium-kits/', 'modified 20 Jul 2026'),
  s('buildmax-ky-build', 'BuildMax', 'Cost breakdown of a 1,575 sq ft Kentucky steel-frame build', 'https://buildmax.com/how-much-does-a-steel-frame-kit-house-cost/', 'modified 20 May 2026'),
  s('buildmax-ky-2024', 'BuildMax', 'Cost of Building a Barndominium in Kentucky in 2024', 'https://buildmax.com/?p=14222', '2 Jan 2024'),
  s('summertown-huntley', 'Summertown Metals', 'Huntley Barndominium: shell, shell plus and turnkey prices', 'https://summertownmetals.com/building-kits/huntley-barndominium/', 'accessed 11 Nov 2026'),
  s('summertown-robertson', 'Summertown Metals', 'Robertson Barndominium: shell, shell plus and turnkey prices', 'https://summertownmetals.com/building-kits/robertson-barndominium/', 'accessed 11 Nov 2026'),
  s('den-ky', 'Den', 'Building a barndominium in Kentucky', 'https://denoutdoors.com/pages/building-a-barndominium-in-kentucky', 'undated'),
  s('houseplans-cost', 'Houseplans.com', 'Barndominium cost guide', 'https://www.houseplans.com/blog/barndominium-cost', '18 Aug 2026'),
  s('mybarndo-cost', 'MyBarndoPlans', 'Barndominium cost and calculator defaults', 'https://mybarndoplans.com/barndominium-cost/', 'updated 8 May 2026'),
  s('th-ky', "Today's Homeowner", 'Cost to build a house in Kentucky', 'https://todayshomeowner.com/general/cost/how-much-does-it-cost-to-build-a-house-in-kentucky/', 'updated 4 Apr 2025'),
  s('nahb-2024', 'NAHB Eye on Housing', 'Cost of Constructing a Home in 2024', 'https://eyeonhousing.org/2025/01/cost-of-constructing-a-home-in-2024/', 'Jan 2025'),
  s('nahb-sqft', 'NAHB Eye on Housing', 'Square foot prices by region, 2024', 'https://eyeonhousing.org/2025/10/square-foot-prices-moderate-in-2024/', 'Oct 2025'),

  // ---- Structure
  s('hansen-kit', 'Hansen Pole Buildings', '40x60x12 barndominium kit, published price', 'https://www.hansenpolebuildings.com/product/40x60x12-barndominium-kit/', 'accessed 11 Nov 2026'),
  s('hansen-land', 'Hansen Pole Buildings', 'Cost to set up land for a barndominium', 'https://www.hansenpolebuildings.com/2025/01/cost-to-set-up-land-for-a-barndominium/', '23 Jan 2025'),
  s('mybarndo-kits', 'MyBarndoPlans', 'Barndominium kits: typical kit price per sq ft', 'https://mybarndoplans.com/barndominium-kits/', 'modified 28 Sep 2026'),
  s('fixr-foundation', 'Fixr', 'Concrete foundation cost', 'https://www.fixr.com/costs/concrete-foundation', '13 Feb 2026'),
  s('th-slab', "Today's Homeowner", 'Concrete slab cost', 'https://todayshomeowner.com/foundation/cost/concrete-slab-cost/', '25 Mar 2025'),
  s('fbi-1500', 'FBi Buildings', 'Cost of a 1,500 sq ft barndominium', 'https://info.fbibuildings.com/blog/1500-barndominium-cost', '3 Jun 2024'),
  s('fixr-stairs', 'Fixr', 'Interior staircase installation cost', 'https://www.fixr.com/costs/interior-staircase-installation', '31 Jan 2025'),
  s('homeguide-attic', 'HomeGuide', 'Cost to finish an attic or bonus room', 'https://homeguide.com/costs/cost-to-finish-an-attic', 'search extract', false),

  // ---- Envelope
  s('fixr-sprayfoam', 'Fixr', 'Spray foam insulation cost', 'https://www.fixr.com/costs/spray-foam-insulation', '31 Jan 2025'),
  s('fixr-insulation', 'Fixr', 'Home insulation cost', 'https://www.fixr.com/costs/home-insulation', '29 Jan 2026'),
  s('fixr-vinyl-window', 'Fixr', 'Vinyl window installation cost', 'https://www.fixr.com/costs/vinyl-window-installation', '21 Jan 2026'),
  s('fixr-picture-window', 'Fixr', 'Picture window installation cost', 'https://www.fixr.com/costs/picture-window-installation', '31 Jan 2025'),
  s('fixr-entry-door', 'Fixr', 'Entry door installation cost', 'https://www.fixr.com/costs/entry-door-installation', '31 Jan 2025'),
  s('fixr-patio-door', 'Fixr', 'Sliding patio door installation cost', 'https://www.fixr.com/costs/sliding-patio-door-installation', '31 Jan 2025'),
  s('fixr-gutters', 'Fixr', 'Gutter installation cost', 'https://www.fixr.com/costs/install-gutters', '31 Jan 2025'),

  // ---- Systems
  s('fixr-electrical', 'Fixr', 'Electrical wiring cost', 'https://www.fixr.com/costs/electrical-wiring', '31 Jan 2025'),
  s('fixr-plumbing', 'Fixr', 'Plumbing cost', 'https://www.fixr.com/costs/plumbing', '30 Jan 2025'),
  s('th-heatpump', "Today's Homeowner", 'Heat pump installation cost', 'https://todayshomeowner.com/hvac/cost/heat-pump-installation-cost/', '21 Feb 2025'),
  s('fixr-ductwork', 'Fixr', 'Ductwork cost', 'https://www.fixr.com/costs/ductwork', '29 Aug 2025'),
  s('fixr-septic', 'Fixr', 'Septic tank system cost', 'https://www.fixr.com/costs/install-septic-tank-system', '31 Jan 2025'),
  s('th-septic', "Today's Homeowner", 'Septic tank installation cost', 'https://todayshomeowner.com/plumbing/cost/septic-tank-installation-cost/', '11 Apr 2025'),
  s('fixr-house', 'Fixr', 'Cost to build a single-family house: well and trenching figures', 'https://www.fixr.com/costs/build-single-family-house', '30 Jan 2024'),
  s('homeguide-well', 'HomeGuide', 'Well drilling cost', 'https://homeguide.com/costs/well-drilling-cost', 'search extract', false),
  s('fixr-temp-power', 'Fixr', 'Temporary power cost', 'https://www.fixr.com/costs/temporary-power', '31 Jan 2025'),

  // ---- Site
  s('fixr-clearing', 'Fixr', 'Land clearing and site preparation cost', 'https://www.fixr.com/costs/land-clearing-and-building-site-preparation', '31 Jan 2025'),
  s('fbi-siteprep', 'FBi Buildings', 'Barndominium site prep', 'https://info.fbibuildings.com/blog/barndominium-site-prep', '19 May 2025'),
  s('fixr-driveway', 'Fixr', 'Gravel driveway cost', 'https://www.fixr.com/costs/build-gravel-driveway', '17 Aug 2022'),
  s('fixr-survey', 'Fixr', 'Land survey cost', 'https://www.fixr.com/costs/land-survey', '31 Jan 2025'),
  s('th-survey', "Today's Homeowner", 'Land survey cost', 'https://todayshomeowner.com/lawn-garden/cost/land-survey-cost/', '10 Apr 2025'),
  s('fixr-perc', 'Fixr', 'Perc test cost', 'https://www.fixr.com/costs/perc-test', '31 Jan 2025'),
  s('fixr-seeding', 'Fixr', 'Lawn seeding cost', 'https://www.fixr.com/costs/lawn-seeding', '31 Jan 2025'),

  // ---- Interior
  s('fixr-carpenter', 'Fixr', 'Carpenter and framing labor cost', 'https://www.fixr.com/costs/carpenter', '31 Jan 2025'),
  s('homeguide-frame-wall', 'HomeGuide', 'Cost to frame a wall', 'https://homeguide.com/costs/cost-to-frame-a-wall', 'search extract', false),
  s('fixr-drywall', 'Fixr', 'Drywall installation cost', 'https://www.fixr.com/costs/drywall-installation', '31 Jan 2025'),
  s('th-vinylplank', "Today's Homeowner", 'Vinyl plank flooring installation cost', 'https://todayshomeowner.com/flooring/cost/cost-to-install-vinyl-plank-flooring/', '9 Apr 2025'),
  s('fixr-lvp', 'Fixr', 'Luxury vinyl plank flooring cost', 'https://www.fixr.com/costs/luxury-vinyl-plank-flooring', '31 Jan 2025'),
  s('fixr-cabinets', 'Fixr', 'Cabinet installation cost', 'https://www.fixr.com/costs/cabinets-installation', '22 Jan 2026'),
  s('fixr-counters', 'Fixr', 'Kitchen countertop cost', 'https://www.fixr.com/costs/install-kitchen-countertop', '28 Jan 2026'),
  s('fixr-appliances', 'Fixr', 'Appliance costs: refrigerator, range, dishwasher, microwave, washer and dryer', 'https://www.fixr.com/costs/install-refrigerator', '31 Jan 2025'),
  s('fixr-recessed', 'Fixr', 'Recessed lighting installation cost', 'https://www.fixr.com/costs/recessed-lighting-installation', '31 Jan 2025'),
  s('fixr-paint', 'Fixr', 'Cost to paint a house interior', 'https://www.fixr.com/costs/paint-house', '31 Jan 2025'),
  s('fixr-interior-door', 'Fixr', 'Interior door installation cost', 'https://www.fixr.com/costs/install-interior-door', '31 Jan 2025'),

  // ---- Extras
  s('stormshelter', 'Storm Shelter (manufacturer)', 'How much does a storm shelter cost', 'https://stormshelter.com/blog/how-much-does-a-storm-shelter-cost/', '1 Apr 2026'),
  s('fixr-woodstove', 'Fixr', 'Wood stove versus pellet stove: installed cost', 'https://www.fixr.com/comparisons/wood-stove-vs-pellet-stove', '30 Jun 2021'),
  s('fixr-fireplace', 'Fixr', 'Fireplace installation cost', 'https://www.fixr.com/costs/fireplace-installation', '22 Jan 2026'),
  s('fixr-generator', 'Fixr', 'Portable generator hookup: interlock and transfer switch', 'https://www.fixr.com/costs/portable-generator', '31 Jan 2025'),
  s('fixr-cat6', 'Fixr', 'Cat6 cabling cost', 'https://www.fixr.com/costs/upgrading-to-cat6-cabling', '31 Jan 2025'),

  // ---- Builder, loan and risk
  s('gc-markup', 'FBi Buildings', 'Building a barndominium: DIY versus general contractor', 'https://info.fbibuildings.com/blog/building-a-barndominium-diy-vs.-general-contractor', '25 Aug 2025'),
  s('loan-rates', 'Bankrate', 'Mortgage rates and construction loans explained', 'https://www.bankrate.com/mortgages/construction-loans-explained/', 'modified 22 Oct 2026'),
  s('bankrate-rates', 'Bankrate', 'Current mortgage rates', 'https://www.bankrate.com/mortgages/mortgage-rates/', '10 to 11 Nov 2026'),
  s('bankrate-closing', 'Bankrate', 'Closing costs', 'https://www.bankrate.com/mortgages/closing-costs/', '22 Oct 2026'),
  s('builders-risk', 'NerdWallet', "Builder's risk insurance", 'https://www.nerdwallet.com/business/insurance/learn/builders-risk', 'search extract', false),
];

export const SOURCE_BY_ID: Record<string, Source> = Object.fromEntries(SOURCES.map((x) => [x.id, x]));
