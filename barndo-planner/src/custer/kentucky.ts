/** Kentucky and Breckinridge County facts that shape the build, each tied to the sources that state them. */
export interface Fact {
  text: string;
  sources: string[];
}

export interface FactGroup {
  title: string;
  facts: Fact[];
}

export const KENTUCKY_FACTS: FactGroup[] = [
  {
    title: 'Permits and inspections',
    facts: [
      { text: 'Breckinridge County has no planning and zoning outside Cloverport, Hardinsburg and Irvington.', sources: ['breck-ordinances'] },
      {
        text: 'The county does have a building inspector, Troy Mills, at (270) 302-7105. The county posts no permit fee or checklist, so call before you budget for it.',
        sources: ['breck-ordinances', 'dhbc-breck'],
      },
      { text: 'State law does not require permits or inspections for a single-family house unless a local ordinance does.', sources: ['krs-198b060'] },
      {
        text: 'Electrical: the co-op will not connect permanent power without a certificate of inspection. The state fee depends on the size of the electrical job: $125 under $8,000, $250 up to $16,500, $500 up to $25,000.',
        sources: ['kar-electrical', 'mcrecc-apply'],
      },
      { text: 'Plumbing: $50 plus $14 per fixture through the state Division of Plumbing. That is about $290 for these plans.', sources: ['kar-plumbing'] },
      { text: 'HVAC: $105 for the first system and $50 for each additional one.', sources: ['kar-hvac'] },
      {
        text: 'Order matters. The electrical inspector may not release the house for power until the health department has released the septic system.',
        sources: ['kar-electrical'],
      },
    ],
  },
  {
    title: 'Septic',
    facts: [
      {
        text: 'The Breckinridge County Health Department, 220 S Hardin St, Hardinsburg, (270) 756-5121, does the site evaluation and issues the construction permit. The state fee is $50 plus a local fee that is not posted.',
        sources: ['breck-directory', 'kar-septic', 'kar-septic-fee'],
      },
      {
        text: 'Soil depth decides the system. Rock or a restrictive layer deeper than 42 in allows a conventional system. At 24 to 42 in you need a shallow modified trench. Under 24 in you need a mound or similar. Nothing may sit within 70 ft of an open sinkhole.',
        sources: ['kar-septic'],
      },
      {
        text: 'Custer sits at about 824 ft on the plateau, not on the sinkhole plain along the county\'s eastern edge. That is my reading of the state survey, not a finding about your parcel.',
        sources: ['kgs-breck'],
      },
    ],
  },
  {
    title: 'Well and water',
    facts: [
      { text: 'Only a certified driller may construct a well. The driller files the well record with the state and gives you a copy.', sources: ['kar-well'] },
      {
        text: 'The state groundwater report says working household wells in the county are 100 to 300 ft deep, and that in upland areas most wells do not yield enough for a home. A dry or weak hole is a real risk here.',
        sources: ['kgs-breck'],
      },
      {
        text: 'About half the county was on public water in that report. I could not confirm whether a water line reaches your road. If one does, a tap may be cheaper and safer than a well.',
        sources: ['kgs-breck'],
      },
    ],
  },
  {
    title: 'Electric service',
    facts: [
      { text: 'Meade County RECC serves Breckinridge County and has a Custer substation. Confirm your parcel with its Hardinsburg office at (270) 756-5172.', sources: ['mcrecc-tariff'] },
      {
        text: 'The co-op extends its line up to 1,000 ft at no charge for a new member. About 300 ft of overhead line should carry no extension charge.',
        sources: ['mcrecc-tariff', 'kar-line-ext'],
      },
      {
        text: 'Underground costs $4.83 per ft more than overhead, about $1,450 for 300 ft, and you supply the trench and conduit.',
        sources: ['mcrecc-tariff'],
      },
      { text: 'Other co-op fees: $35 to connect, $40 for temporary construction service, $40 for a meter pole, plus a deposit.', sources: ['mcrecc-tariff', 'mcrecc-apply'] },
    ],
  },
  {
    title: 'Code, climate and storms',
    facts: [
      {
        text: 'Kentucky enforces the 2018 Kentucky Residential Code. Design values for the county are a 24 in frost depth, a 15 psf ground snow load and a 115 mph wind speed.',
        sources: ['krc-2018'],
      },
      {
        text: 'A 2026 state law creates a rebate of half the cost of a qualifying storm safe room, up to $5,000. News reports I could not open said it had no funding yet, so the cost table does not count on it.',
        sources: ['ky-sb11'],
      },
    ],
  },
  {
    title: 'Loan and taxes',
    facts: [
      {
        text: 'The national average 30-year fixed mortgage rate was 7.17 percent on 10 to 11 November 2026. Construction loans run about a point higher, charge interest only on money drawn, and usually want about 20 percent down.',
        sources: ['bankrate-rates', 'loan-rates'],
      },
      {
        text: 'Kentucky sales tax is 6 percent. Contractors pay it on the materials they install, so it is already inside a builder\'s price. A kit you buy yourself has it added.',
        sources: ['krs-sales-tax'],
      },
      { text: 'No state or county impact fee was found.', sources: ['breck-ordinances'] },
    ],
  },
];

/** What published sources say a finished barndominium or house costs, for comparison with this model. */
export const COST_ANCHORS: Fact[] = [
  { text: 'BuildMax, a Kentucky company: $125 to $150 per sq ft turnkey by local contractors.', sources: ['buildmax-ky'] },
  { text: 'BuildMax in 2024: $250,000 to $400,000 or more for a finished Kentucky barndominium of 2,000 sq ft or more.', sources: ['buildmax-ky-2024'] },
  {
    text: 'Summertown Metals, published turnkey prices: $155 to $198 per living sq ft, or $102 to $123 per sq ft under roof. Land, well, septic and utility runs are not included.',
    sources: ['summertown-huntley', 'summertown-robertson'],
  },
  { text: 'Den: $110 to $190 per sq ft in Kentucky.', sources: ['den-ky'] },
  { text: 'National guides: $65 to $160 per sq ft at Houseplans.com, and $125 to $185 as the most common range at MyBarndoPlans.', sources: ['houseplans-cost', 'mybarndo-cost'] },
  {
    text: 'Conventional houses: $80 to $140 per sq ft in Kentucky. The 2024 median contract price for custom homes was $129 per sq ft in the region that includes Kentucky, against $166 nationally.',
    sources: ['th-ky', 'nahb-sqft'],
  },
];
