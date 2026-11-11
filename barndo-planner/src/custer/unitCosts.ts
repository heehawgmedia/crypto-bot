/**
 * Unit prices for the Custer build, set from the research of 11 November 2026.
 *
 * How the figures were chosen: national cost-guide ranges give the low and high ends. The expected
 * figure leans toward the lower-middle of each range, then the whole house was checked against two
 * regional anchors: BuildMax's Kentucky turnkey figure and Summertown Metals' published turnkey
 * prices. No trade-by-trade Kentucky price index could be found.
 */
import type { Rate, Rates, Settings } from './costModel';

const rate = (low: number, mid: number, high: number, unit: string, confidence: Rate['confidence'], sources: string[], note: string): Rate => ({
  range: { low, mid, high },
  unit,
  confidence,
  sources,
  note,
});

export const RATES: Rates = {
  plans: rate(1400, 2400, 4500, 'each', 'published', ['buildmax-ky'], 'Published plan sets cost $850 to $1,813. These layouts are original, so the expected figure adds a modification or drafting fee.'),
  engineering: rate(500, 1200, 2000, 'each', 'guide', ['buildmax-ky'], 'Kentucky does not require an engineer\'s stamp statewide, and post-frame kit sellers often include one.'),
  permits: rate(568, 693, 993, 'set', 'official', ['kar-electrical', 'kar-plumbing', 'kar-hvac', 'kar-septic-fee'], 'State fee schedules: electrical inspection $125 to $500 by job size, plumbing $50 plus $14 a fixture, HVAC $105, septic $50.'),
  permitsLocal: rate(150, 800, 2000, 'set', 'assumption', ['breck-ordinances', 'dhbc-breck'], 'Not published: the county building permit fee, the local electrical inspector\'s fee and the health department\'s fees. This is an allowance until you call them.'),
  survey: rate(500, 1200, 2500, 'each', 'guide', ['fixr-survey', 'th-survey'], 'May be zero if the land was surveyed when you bought it.'),
  soilTest: rate(300, 725, 1200, 'each', 'guide', ['fixr-perc', 'kar-septic'], 'In Kentucky the health department\'s site evaluation does this job. Its fee is not published.'),
  sitePrepPerSf: rate(1.2, 2.0, 3.6, 'sq ft of pad', 'guide', ['fixr-clearing', 'fbi-siteprep', 'buildmax-ky-2024'], 'Works out to about $5,000 to $15,000, the range BuildMax gives for Kentucky.'),
  drivewayPerFt: rate(12, 22, 36, 'ft', 'guide', ['fixr-driveway'], 'Stone is $1 to $3 per sq ft for materials on a 2022 page. No per-foot installed price was found.'),
  slabPerSf: rate(6, 8, 11, 'sq ft', 'guide', ['fixr-foundation', 'th-slab', 'buildmax-ky-build'], 'A Kentucky owner-builder paid about $7 per sq ft. Footings go to the 24 in frost depth.'),
  shellPerSf: rate(21, 27, 37, 'sq ft', 'published', ['hansen-kit', 'mybarndo-kits', 'buildmax-ky'], 'Published kit prices run $18 to $45 per sq ft. Includes metal roof and siding, trusses, freight and 6 percent sales tax. Windows, doors and porches are priced on their own lines.'),
  erectionPerSf: rate(8, 11.5, 17, 'sq ft', 'guide', ['buildmax-ky-build', 'mybarndo-cost', 'houseplans-cost'], 'From $8.25 on a Kentucky build to $17 as a kit seller\'s default.'),
  upperFloorPerSf: rate(12, 18, 26, 'sq ft', 'assumption', ['homeguide-attic'], 'No opened source prices a loft floor system alone. With finishes, the loft lands inside the $50 to $150 per sq ft that HomeGuide gives for finishing an attic.'),
  stair: rate(2000, 3600, 5500, 'each', 'guide', ['fixr-stairs', 'buildmax-ky-build'], ''),
  porchPerSf: rate(28, 38, 55, 'sq ft', 'guide', ['hansen-land', 'fbi-1500', 'mybarndo-cost'], 'Hansen gives $35 per sq ft owner-built with the slab. FBi gives $200 to $250 per running foot of porch.'),
  insulationPerSf: rate(1.6, 2.6, 4.5, 'sq ft', 'guide', ['fixr-sprayfoam', 'fixr-insulation'], 'Batts in the walls and blown insulation over flat ceilings, with spray foam under the vaulted roof. All spray foam is the high figure.'),
  windowSingle: rate(400, 600, 850, 'each', 'guide', ['fixr-vinyl-window'], ''),
  windowDouble: rate(750, 1100, 1600, 'each', 'guide', ['fixr-vinyl-window'], ''),
  windowPicture: rate(900, 1300, 1900, 'each', 'guide', ['fixr-picture-window'], ''),
  entryDoor: rate(975, 1350, 1775, 'each', 'guide', ['fixr-entry-door'], ''),
  patioDoor: rate(2000, 2750, 4000, 'each', 'guide', ['fixr-patio-door'], ''),
  gutterPerFt: rate(7, 10, 13, 'ft', 'guide', ['fixr-gutters'], ''),
  electricalPerSf: rate(4.5, 6.5, 9, 'sq ft', 'guide', ['fixr-electrical', 'buildmax-ky-build'], 'A Kentucky build paid $6.41 per sq ft with finish lighting.'),
  plumbingPerFixture: rate(500, 650, 950, 'fixture', 'guide', ['fixr-plumbing', 'buildmax-ky-build'], 'Rough-in and finish labor. The fixtures themselves are on the Fixtures line.'),
  hvacPerSf: rate(5, 6.75, 9, 'sq ft', 'guide', ['th-heatpump', 'fixr-ductwork', 'houseplans-cost'], 'A heat pump with new ductwork runs $10,000 to $15,000 for 2,000 sq ft.'),
  well: rate(6500, 12000, 22000, 'each', 'guide', ['kgs-breck', 'fixr-house', 'homeguide-well'], 'The state survey says working wells in the county are 100 to 300 ft deep and that many upland wells fail. No per-foot price could be confirmed on an opened page.'),
  septic: rate(6500, 10500, 20000, 'each', 'guide', ['fixr-septic', 'th-septic', 'kar-septic'], 'Conventional systems run $4,500 to $9,000 for three bedrooms. The high figure covers a mound or aerobic system if the site evaluation finds shallow rock.'),
  electricRunPerFt: rate(0, 8.5, 22, 'ft', 'official', ['mcrecc-tariff', 'kar-line-ext'], 'The co-op extends overhead line up to 1,000 ft at no charge. Going underground adds $4.83 per ft plus your own trench and conduit.'),
  electricService: rate(115, 600, 2500, 'set', 'guide', ['mcrecc-apply', 'fixr-temp-power'], 'Co-op fees are $35 to connect, $40 for temporary service and $40 for a meter pole.'),
  partitionPerFt: rate(14, 22, 32, 'ft', 'guide', ['homeguide-frame-wall', 'fixr-carpenter'], 'Also covers the stud framing inside the exterior walls that a post-frame shell needs before drywall.'),
  drywallPerSf: rate(1.5, 2.1, 3.0, 'sq ft of board', 'guide', ['fixr-drywall', 'houseplans-cost'], ''),
  flooringPerSf: rate(4.5, 6, 8.5, 'sq ft', 'guide', ['th-vinylplank', 'fixr-lvp'], 'Luxury vinyl plank, with tile in the baths.'),
  cabinetsPerFt: rate(160, 280, 480, 'ft', 'guide', ['fixr-cabinets'], 'Stock at the low end, semi-custom at the high end.'),
  countersPerSf: rate(35, 65, 105, 'sq ft', 'guide', ['fixr-counters'], 'Laminate at the low end, quartz at the high end.'),
  appliances: rate(3300, 6000, 10900, 'set', 'guide', ['fixr-appliances', 'buildmax-ky-build'], ''),
  plumbingFixturesPerBath: rate(1500, 2300, 4200, 'bath', 'guide', ['fixr-plumbing', 'fbi-1500'], 'Tub or shower, toilet, vanity top, sink and faucet.'),
  kitchenFixtures: rate(1700, 2600, 4200, 'set', 'assumption', ['buildmax-ky-build'], 'Kitchen sink, faucet, disposal and water heater. My estimate.'),
  lightingPerSf: rate(0.6, 1.0, 1.8, 'sq ft', 'guide', ['fixr-recessed'], ''),
  paintPerSf: rate(2.2, 3.5, 5.5, 'sq ft', 'guide', ['buildmax-ky-build', 'fbi-1500', 'fixr-paint'], 'Sources range from $1.90 to more than $10 per sq ft.'),
  interiorDoor: rate(300, 450, 650, 'each', 'guide', ['fixr-interior-door'], ''),
  trimPerSf: rate(1.5, 2.5, 4, 'sq ft', 'assumption', [], 'Baseboard, casing and closet shelving. My estimate.'),
  landscaping: rate(1500, 3500, 6000, 'set', 'guide', ['fbi-1500', 'fixr-seeding'], ''),
  stormShelter: rate(6000, 8500, 12000, 'each', 'published', ['stormshelter', 'ky-sb11'], 'A manufacturer\'s installed price range. A 2026 Kentucky law creates a rebate of half the cost up to $5,000, but it was not yet funded.'),
  woodStove: rate(3500, 5500, 8500, 'each', 'guide', ['fixr-woodstove', 'fixr-fireplace'], 'The only opened wood stove figure dates from 2021.'),
  generatorHookup: rate(450, 900, 1800, 'each', 'guide', ['fixr-generator'], ''),
  networkDrop: rate(125, 200, 475, 'drop', 'guide', ['fixr-cat6'], ''),
};

export const SETTINGS: Settings = {
  roadDistanceFt: 300,
  gcPct: { low: 12, mid: 18, high: 25 },
  contingencyPct: { low: 10, mid: 12, high: 15 },
  loanRatePct: { low: 7.5, mid: 8.2, high: 9 },
  buildMonths: { low: 8, mid: 10, high: 12 },
  loanShare: 0.8,
  closingPct: { low: 2, mid: 3, high: 5 },
  builderRiskPct: { low: 1, mid: 1.5, high: 4 },
  networkDrops: 8,
};
