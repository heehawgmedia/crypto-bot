/**
 * Builds the research and cost report for the Custer, Kentucky barndominium as one HTML fragment
 * (dist-report/custer-report.html). Every number on the page is computed by the same cost model
 * and floor plan data the app uses.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { estimate, GROUP_ORDER, type Confidence, type Estimate, type Range } from '../src/custer/costModel';
import { COST_ANCHORS, KENTUCKY_FACTS } from '../src/custer/kentucky';
import { OPTIONS } from '../src/custer/options';
import { PLAN_SVG_CSS, planSvg } from '../src/custer/planSvg';
import { KIT_OFFERS, RESEARCH_DATE, STOCK_PLANS, UNREACHABLE } from '../src/custer/research';
import { SOURCES } from '../src/custer/sources';
import type { OptionPlan } from '../src/custer/types';
import { RATES, SETTINGS } from '../src/custer/unitCosts';
import { scoreWants, WANTS, type Met, type OptionId } from '../src/custer/wants';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const int = (n: number): string => Math.round(n).toLocaleString('en-US');
const usd = (n: number): string => `$${int(n)}`;
/** Rounded to the nearest thousand for headline figures. */
const usdK = (n: number): string => `$${int(Math.round(n / 1000) * 1000)}`;
const link = (url: string, text: string): string => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

const srcNumber = new Map(SOURCES.map((s, i) => [s.id, i + 1]));
const refs = (ids: string[]): string =>
  ids.length
    ? `<span class="refs">${ids
        .map((id) => srcNumber.get(id))
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b)
        .map((n) => `<a href="#src-${n}">${n}</a>`)
        .join(' ')}</span>`
    : '';

const FLAG: Record<Confidence, [label: string, cls: string]> = {
  published: ['Published price', 'solid'],
  official: ['Official fee', 'solid'],
  guide: ['Cost guide', 'rough'],
  assumption: ['My estimate', 'guess'],
};
const flag = (c: Confidence): string => `<span class="flag ${FLAG[c][1]}">${FLAG[c][0]}</span>`;

const estimates = OPTIONS.map((o) => estimate(o, RATES, SETTINGS));
const byId = (id: string): Estimate => estimates.find((e) => e.option.id === id) as Estimate;
const letter = (o: OptionPlan): string => o.id.toUpperCase();
const footprint = (o: OptionPlan): string => `${o.plan.depth} x ${o.plan.width} ft`;

// ---------------------------------------------------------------- variations used for "what moves the total"
function frontPorchOnly(o: OptionPlan): OptionPlan {
  return { ...o, plan: { ...o.plan, porches: { N: 0, S: o.plan.porches.S, E: 0, W: 0 } } };
}
function withoutLoft(o: OptionPlan): OptionPlan {
  return { ...o, upper: undefined, plan: { ...o.plan, wallHeight: 10, roofPitch: 4, rooms: o.plan.rooms.filter((r) => r.type !== 'stair') } };
}
const saving = (base: Estimate, variant: OptionPlan, settings = SETTINGS): number => base.total.mid - estimate(variant, RATES, settings).total.mid;

// ---------------------------------------------------------------- sections
function summaryTable(): string {
  const rows = estimates
    .map((e) => {
      const o = e.option;
      const w = scoreWants(o.id as OptionId);
      const levels = o.upper ? `${int(e.quantities.mainSf)} main + ${int(e.quantities.upperSf)} up` : 'one level';
      return `<tr>
        <th scope="row"><a href="#option-${o.id}">${letter(o)}. ${esc(o.name)}</a><span class="sub">${footprint(o)}, ${levels}</span></th>
        <td class="num">${int(e.quantities.heatedSf)}</td>
        <td class="num strong">${usdK(e.total.mid)}</td>
        <td class="num">${usdK(e.total.low)} to ${usdK(e.total.high)}</td>
        <td class="num strong">$${e.perHeatedSf.mid}</td>
        <td class="num">${w.mustMet} of ${w.mustTotal}</td>
        <td class="num">${w.niceMet} of ${w.niceTotal}</td>
      </tr>`;
    })
    .join('');
  return `<div class="scroll"><table class="data">
    <thead><tr><th>Option</th><th class="num">Heated sq ft</th><th class="num">Expected total</th><th class="num">Likely range</th><th class="num">Per sq ft</th><th class="num">Must-haves met</th><th class="num">Nice-to-haves met</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function takeaways(): string {
  const a = byId('a');
  const b = byId('b');
  const c = byId('c');
  const d = byId('d');
  const lowHouse = Math.min(...estimates.map((e) => e.houseOnly.perSf));
  const highHouse = Math.max(...estimates.map((e) => e.houseOnly.perSf));
  const extra = c.total.mid - a.total.mid;
  const extraSf = c.quantities.heatedSf - a.quantities.heatedSf;
  return `<ul class="points">
    <li><b>Lowest total:</b> option A at about ${usdK(a.total.mid)}. It is the smallest slab that holds your four bedrooms, office and 2.5 baths.</li>
    <li><b>Lowest cost per square foot:</b> option B at about $${b.perHeatedSf.mid}. Its bonus loft adds ${int(b.quantities.upperSf)} sq ft under a roof you are already paying for.</li>
    <li><b>Most space for the least added money:</b> option C gives ${int(extraSf)} more sq ft than A for about ${usdK(extra)} more, because three bedrooms sit above the main level. That is the trade against your one-level must-have.</li>
    <li><b>Most of your nice-to-haves:</b> option D, all on one level, at about ${usdK(d.total.mid)}.</li>
    <li><b>Why this is more than the $125 to $150 per sq ft you see quoted:</b> that figure covers the house alone. This model's house alone comes to $${lowHouse} to $${highHouse} per sq ft, which agrees with it. The totals above add the wraparound porch, well, septic, driveway, your must-have extras, the builder's fee on all of that, contingency and loan costs.</li>
  </ul>`;
}

function tiers(): string {
  const ceilings = [450000, 500000, 550000, 600000, 650000, 700000];
  const rows = ceilings
    .map((cap) => {
      const fits = estimates.filter((e) => e.total.mid <= cap).map((e) => letter(e.option));
      const maybe = estimates.filter((e) => e.total.mid > cap && e.total.low <= cap).map((e) => letter(e.option));
      return `<tr><th scope="row" class="num">${usd(cap)}</th><td>${fits.length ? fits.join(', ') : 'None'}</td><td>${maybe.length ? maybe.join(', ') : 'None'}</td></tr>`;
    })
    .join('');
  return `<div class="scroll"><table class="data narrow">
    <thead><tr><th class="num">Budget ceiling</th><th>Fits at the expected cost</th><th>Possible only if costs run low</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function levers(): string {
  const a = byId('a');
  const b = byId('b');
  const porchA = saving(a, frontPorchOnly(a.option));
  const porchD = saving(byId('d'), frontPorchOnly(byId('d').option));
  const loftB = saving(b, withoutLoft(b.option));
  const gc = a.items.find((i) => i.id === 'gc')?.total.mid ?? 0;
  const well = a.items.find((i) => i.id === 'well')?.total;
  const septic = a.items.find((i) => i.id === 'septic')?.total;
  const loftPerSf = Math.round(loftB / b.quantities.upperSf);
  return `<ul class="points">
    <li><b>The wraparound porch.</b> Keeping the front porch and dropping the end porch saves about ${usdK(porchA)} on option A and ${usdK(porchD)} on option D. It is your must-have, so it stays in every total, but it is the largest single choice on the list.</li>
    <li><b>The bonus loft in option B.</b> It costs about ${usdK(loftB)} all-in, or $${loftPerSf} per sq ft of loft. That is the cheapest floor area in any option.</li>
    <li><b>The builder's fee.</b> About ${usdK(gc)} on option A at 18 percent. You chose to have a builder do everything, so it is included. Doing some finish work yourself would reduce it.</li>
    <li><b>Water.</b> The well is ${well ? `${usdK(well.low)} to ${usdK(well.high)}` : ''} and carries a real chance of a weak hole. If a county water line reaches your road, ask about a tap before you drill.</li>
    <li><b>Septic.</b> ${septic ? `${usdK(septic.low)} to ${usdK(septic.high)}` : ''}. The health department's site evaluation decides which end you land on, so get it done before you fix the house location.</li>
  </ul>`;
}

const SIZED_LIKE: Record<string, string[]> = {
  a: ['405136FDC'],
  b: ['BM2334', '405051FDC'],
  c: ['80860', '1115-1'],
  d: ['405051FDC', 'BCO-40205'],
};

function optionSection(e: Estimate): string {
  const o = e.option;
  const q = e.quantities;
  const w = scoreWants(o.id as OptionId);
  const idx = ['a', 'b', 'c', 'd'].indexOf(o.id);
  const missed = WANTS.filter((x) => x.rank === 'nice' && x.met && (x.met[idx] === 'no' || x.met[idx] === 'part'));
  const partMust = WANTS.filter((x) => x.rank === 'must' && x.met && x.met[idx] !== 'yes');
  const like = (SIZED_LIKE[o.id] ?? [])
    .map((num) => STOCK_PLANS.find((p) => p.number === num))
    .filter((p): p is (typeof STOCK_PLANS)[number] => Boolean(p))
    .map((p) => `${link(p.url, `${p.seller} ${p.number}`)} (${esc(p.footprint)}, ${int(p.heatedSf)} sq ft)`)
    .join(' and ');
  const facts: [string, string][] = [
    ['Footprint', `${footprint(o)}, ${o.plan.wallHeight} ft walls, ${o.plan.roofPitch}:12 roof`],
    ['Heated area', o.upper ? `${int(q.heatedSf)} sq ft (${int(q.mainSf)} main, ${int(q.upperSf)} upper)` : `${int(q.heatedSf)} sq ft`],
    ['Covered porch', `${int(q.porchSf)} sq ft`],
    ['Bedrooms', o.beds.upper ? `${o.beds.main} main, ${o.beds.upper} upper` : `${o.beds.main}, all on the main level`],
    ['Baths', `${o.baths.full} full, ${o.baths.half} half`],
    ['Hallway', `${int(q.hallSf)} sq ft`],
    ['Wet zones', String(q.wetZones)],
    ['Expected total', `${usdK(e.total.mid)} (${usdK(e.total.low)} to ${usdK(e.total.high)})`],
    ['Per heated sq ft', `$${e.perHeatedSf.mid}`],
    ['Checklist', `${w.mustMet} of ${w.mustTotal} must-haves, ${w.niceMet} of ${w.niceTotal} nice-to-haves`],
  ];
  const upper = o.upper
    ? `<figure class="plan-fig"><figcaption>Upper level${o.upper.kind === 'bonus' ? ': enclosed bonus room' : ''}</figcaption><div class="plan-scroll">${planSvg(o.plan, o.upper.rooms, { exterior: false, upperLevel: true, title: `${o.plan.name} upper level` })}</div></figure>`
    : '';
  const mark = (m: Met): string => (m === 'part' ? 'partly' : 'not included');
  return `<section class="option" id="option-${o.id}">
    <div class="option-head"><h3>${letter(o)}. ${esc(o.name)}</h3><p class="tagline">${esc(o.tagline)}</p></div>
    <div class="option-grid">
      <div class="plans">
        <figure class="plan-fig"><figcaption>Main level</figcaption><div class="plan-scroll">${planSvg(o.plan, o.plan.rooms, { title: `${o.plan.name} main level` })}</div></figure>
        ${upper}
      </div>
      <div class="option-text">
        <p>${esc(o.concept)}</p>
        <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <ul class="points small">${o.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        ${like ? `<p class="small">Sized like ${like}. The layout is my own and copies neither.</p>` : ''}
        ${partMust.length ? `<p class="small"><b>Must-have only partly met:</b> ${partMust.map((x) => `${esc(x.label)}. ${esc(x.note ?? '')}`).join(' ')}</p>` : ''}
        <details><summary>Nice-to-haves this option leaves out (${missed.length})</summary>
          <ul class="points small">${missed.map((x) => `<li>${esc(x.label)} <span class="muted">(${mark((x.met as Met[])[idx])})</span></li>`).join('')}</ul>
        </details>
      </div>
    </div>
  </section>`;
}

function costMatrix(): string {
  const head = `<thead><tr><th>Line item</th>${estimates.map((e) => `<th class="num">${letter(e.option)}. ${esc(e.option.name)}</th>`).join('')}<th>How solid</th></tr></thead>`;
  let body = '';
  for (const g of GROUP_ORDER) {
    const ids = [...new Set(estimates.flatMap((e) => e.items.filter((i) => i.group === g).map((i) => i.id)))];
    if (!ids.length) continue;
    const sub = estimates.map((e) => e.items.filter((i) => i.group === g).reduce((s, i) => s + i.total.mid, 0));
    body += `<tr class="group"><th scope="row">${g}</th>${sub.map((v) => `<td class="num">${usd(v)}</td>`).join('')}<td></td></tr>`;
    for (const id of ids) {
      const sample = estimates.map((e) => e.items.find((i) => i.id === id)).find(Boolean);
      if (!sample) continue;
      body += `<tr><th scope="row" class="item">${esc(sample.label)}</th>${estimates
        .map((e) => {
          const it = e.items.find((i) => i.id === id);
          return `<td class="num">${it ? usd(it.total.mid) : '<span class="muted">none</span>'}</td>`;
        })
        .join('')}<td>${flag(sample.confidence)}</td></tr>`;
    }
  }
  const row = (label: string, cell: (e: Estimate) => string, cls = ''): string => `<tr class="${cls}"><th scope="row">${label}</th>${estimates.map((e) => `<td class="num">${cell(e)}</td>`).join('')}<td></td></tr>`;
  const foot = `<tfoot>
    ${row('Expected total', (e) => usd(e.total.mid), 'total')}
    ${row('Likely range', (e) => `${usdK(e.total.low)} to ${usdK(e.total.high)}`)}
    ${row('If every line hit its low or high', (e) => `${usdK(e.extremes.low)} to ${usdK(e.extremes.high)}`, 'muted-row')}
    ${row('Per heated sq ft', (e) => `$${e.perHeatedSf.low} / <b>$${e.perHeatedSf.mid}</b> / $${e.perHeatedSf.high}`)}
    ${row('House alone, with the builder\'s fee', (e) => `$${e.houseOnly.perSf} per sq ft`)}
    ${row('Resting on published prices or official fees', (e) => `${Math.round(e.solidShare * 100)} percent`)}
  </tfoot>`;
  return `<div class="scroll"><table class="data matrix">${head}<tbody>${body}</tbody>${foot}</table></div>`;
}

function costDetail(e: Estimate): string {
  const r = (x: Range): string => `<td class="num">${usd(x.low)}</td><td class="num strong">${usd(x.mid)}</td><td class="num">${usd(x.high)}</td>`;
  let body = '';
  for (const g of GROUP_ORDER) {
    const items = e.items.filter((i) => i.group === g);
    if (!items.length) continue;
    body += `<tr class="group"><th scope="row" colspan="6">${g}</th></tr>`;
    for (const i of items) {
      body += `<tr><th scope="row" class="item">${esc(i.label)}<span class="sub">${esc(i.basis)}${i.note ? `. ${esc(i.note)}` : ''}</span></th>${r(i.total)}<td>${flag(i.confidence)}</td><td>${refs(i.sources)}</td></tr>`;
    }
  }
  return `<details class="detail"><summary>${letter(e.option)}. ${esc(e.option.name)}: every line with low, expected and high</summary>
    <div class="scroll"><table class="data detail-table">
      <thead><tr><th>Line item and what it is based on</th><th class="num">Low</th><th class="num">Expected</th><th class="num">High</th><th>How solid</th><th>Sources</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="total"><th scope="row">Sum of lines</th><td class="num">${usd(e.extremes.low)}</td><td class="num">${usd(e.total.mid)}</td><td class="num">${usd(e.extremes.high)}</td><td colspan="2"></td></tr>
      <tr><th scope="row">Likely range</th><td class="num">${usd(e.total.low)}</td><td class="num">${usd(e.total.mid)}</td><td class="num">${usd(e.total.high)}</td><td colspan="2"></td></tr></tfoot>
    </table></div></details>`;
}

function plansTable(): string {
  const rows = STOCK_PLANS.map(
    (p) => `<tr>
      <th scope="row">${link(p.url, `${p.seller} ${p.number}`)}<span class="sub">${esc(p.name)}</span></th>
      <td>${esc(p.footprint)}</td>
      <td class="num">${int(p.heatedSf)}${p.levels ? `<span class="sub">${esc(p.levels)}</span>` : ''}</td>
      <td class="num">${esc(p.beds)} / ${esc(p.baths)}</td>
      <td>${esc(p.porch)}</td>
      <td>${esc(p.garage)}</td>
      <td class="num">$${p.price.toLocaleString('en-US')}<span class="sub">${esc(p.priceNote)}</span></td>
      <td>${esc(p.matches)}</td>
      <td>${esc(p.misses)}</td>
    </tr>`,
  ).join('');
  return `<div class="scroll"><table class="data wide">
    <thead><tr><th>Plan</th><th>Overall size</th><th class="num">Heated sq ft</th><th class="num">Bed / bath</th><th>Porch sq ft</th><th>Garage</th><th class="num">Plan price</th><th>Matches</th><th>Misses</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function kitsTable(): string {
  const rows = KIT_OFFERS.map(
    (k) => `<tr>
      <th scope="row">${link(k.url, k.provider)}<span class="sub">${esc(k.model)}</span></th>
      <td>${esc(k.route)}</td>
      <td>${esc(k.size)}</td>
      <td>${esc(k.price)}<span class="sub">${esc(k.perSf)}</span></td>
      <td>${esc(k.includes)}</td>
      <td>${esc(k.excludes)}</td>
      <td>${esc(k.kentucky)}</td>
      <td>${esc(k.fit)}${k.caveat ? `<span class="sub warn">${esc(k.caveat)}</span>` : ''}</td>
    </tr>`,
  ).join('');
  return `<div class="scroll"><table class="data wide">
    <thead><tr><th>Provider</th><th>What you buy</th><th>Size</th><th>Published price</th><th>Includes</th><th>Leaves out</th><th>Kentucky</th><th>Fit for you</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function factsSection(): string {
  return KENTUCKY_FACTS.map((g) => `<div class="fact-group"><h3>${g.title}</h3><ul class="points">${g.facts.map((f) => `<li>${esc(f.text)} ${refs(f.sources)}</li>`).join('')}</ul></div>`).join('');
}

function sourcesList(): string {
  return `<ol class="sources">${SOURCES.map(
    (s, i) => `<li id="src-${i + 1}"><span class="src-pub">${esc(s.publisher)}.</span> ${link(s.url, s.title)}. <span class="muted">${esc(s.date)}.</span>${s.opened ? '' : ' <span class="flag guess">Not opened: search extract only</span>'}</li>`,
  ).join('')}</ol>`;
}

const ASSUMPTIONS: string[] = [
  'Nothing in this report is a quote for your job. "Published price" means a seller or agency posted that figure for a comparable product or fee. Only bids from builders will settle the real number.',
  'Unit prices come from national cost guides. No trade-by-trade Kentucky price index could be found, so the expected figures lean toward the lower-middle of each range and the house as a whole was checked against two regional figures: BuildMax for Kentucky and Summertown Metals\' published turnkey prices.',
  'The likely range for each total takes half the swing between the expected figure and the sum of every line at its low or high. Every line landing at its extreme at once is not realistic. The all-low and all-high sums are shown beside it.',
  'Finishes are priced at a middle level: vinyl plank floors with tile in the baths, semi-custom cabinets, mid-priced counters and appliances.',
  'The structure is a post-frame shell on a slab with white board-and-batten profile steel siding and a dark screw-down metal roof. Standing seam, stone wainscot and exposed beams are add-ons, not in the totals.',
  'You chose "single story with a loft" and also marked a loft that overlooks the great room as a don\'t-want. I read that as an enclosed upper room, so option B has a closed bonus room and option C has closed bedrooms upstairs.',
  'You answered no attached shop and marked a detached shop later as a must. The four shop items you marked nice-to-have are held for that later building and are not scored or priced.',
  '"Wraparound porch" is drawn as the full front plus one end, 8 ft deep, and 10 ft deep on the front of option D.',
  'I added the builder\'s overhead and profit, at 12 to 25 percent of construction cost, because a builder is doing all the work. It was not on your list.',
  'The loan line assumes 80 percent financed at 7.5 to 9 percent, interest-only for 8 to 12 months with about 55 percent drawn on average, plus 2 to 5 percent closing costs.',
  'The well is priced as one successful drilled well. The septic expected figure is a conventional system, and only the high figure covers a mound or aerobic system.',
  'The expected electric figure assumes underground service for the 300 ft run. Overhead would be nearly free under the co-op\'s 1,000 ft allowance.',
  'Summertown Metals\' prices were shown for its Alabama and Tennessee stores, not its Hopkinsville, Kentucky store, and exclude tax and shipping.',
  'HomeGuide, Angi and HomeAdvisor refused automated visits. A few figures from them came from search extracts only and are marked "Not opened" in the source list. The search allowance also ran out before some Kentucky builders could be found.',
  'Bedrooms are drawn with their closets inside the room rectangle, so a 10 x 14 ft bedroom has about 10 x 12 ft of clear floor.',
  'The view direction is unknown. Every plan can be mirrored or turned on the site so the great room glass faces it.',
];

const QUESTIONS: string[] = [
  'Which direction is your best view, and which side faces the road? I will turn the 3D models to match.',
  'Is option C still in the running with three bedrooms upstairs, or should I replace it with another one-level layout?',
  'Do you want all four options modeled in 3D, or only the ones you would actually build?',
  'Is there a county water line at your road? If so I will add a water tap as an alternative to the well.',
];

// ---------------------------------------------------------------- page
const css = `
/* Layout: an estimator's report. One reading column under a drawing-style title block; wide tables scroll inside their own frames. */
:root {
  --bg: #e9edf0;
  --surface: #ffffff;
  --field: #f4f6f8;
  --ink: #17212a;
  --muted: #53616d;
  --line: #c9d2d9;
  --accent: #1d4f91;
  --solid: #1b6838;
  --solid-bg: #dbeee1;
  --rough: #7a5000;
  --rough-bg: #f4e6c0;
  --guess: #982a2a;
  --guess-bg: #f4dad7;
  --plan-floor: #fbfaf6;
  --plan-void: #dde3e8;
  --plan-porch: #ece6d6;
  --plan-glass: #2f7fc1;
  --plan-door: #8b5a2b;
  --display: "Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
  --body: "Barlow", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #11171c; --surface: #1a222a; --field: #222c35; --ink: #e5eaee; --muted: #9ba9b5; --line: #323e49; --accent: #86b6f2;
    --solid: #86d6a0; --solid-bg: #163423; --rough: #ebc76e; --rough-bg: #3a2e10; --guess: #f2a09a; --guess-bg: #421d1c;
    --plan-floor: #222b33; --plan-void: #141a20; --plan-porch: #2b2a22; --plan-glass: #6fb3ea; --plan-door: #d0a273;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #11171c; --surface: #1a222a; --field: #222c35; --ink: #e5eaee; --muted: #9ba9b5; --line: #323e49; --accent: #86b6f2;
  --solid: #86d6a0; --solid-bg: #163423; --rough: #ebc76e; --rough-bg: #3a2e10; --guess: #f2a09a; --guess-bg: #421d1c;
  --plan-floor: #222b33; --plan-void: #141a20; --plan-porch: #2b2a22; --plan-glass: #6fb3ea; --plan-door: #d0a273;
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.5; }
.sheet { max-width: 1080px; margin: 0 auto; padding-inline: 16px; padding-block: 20px 56px; display: flex; flex-direction: column; gap: 34px; }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; line-height: 1.1; }
h1 { font-size: clamp(2rem, 6.5vw, 3rem); font-weight: 700; text-transform: uppercase; letter-spacing: 0.01em; }
h2 { font-size: 1.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
h3 { font-size: 1.3rem; font-weight: 600; letter-spacing: 0.02em; }
p { margin: 0; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.prose { max-width: 72ch; }
.muted { color: var(--muted); }
.small { font-size: 0.9rem; }
.titleblock { background: var(--surface); border: 2px solid var(--ink); display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
.tb-main { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.eyebrow { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }
.tb-cells { margin: 0; border-left: 2px solid var(--ink); display: grid; min-width: 0; }
.tb-cells > div { padding: 10px 14px; border-bottom: 1px solid var(--line); min-width: 0; }
.tb-cells > div:last-child { border-bottom: 0; }
.tb-cells dt { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.tb-cells dd { margin: 2px 0 0; font-weight: 500; }
.toc { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.95rem; }
section.block { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.points { margin: 0; padding-left: 1.15em; display: flex; flex-direction: column; gap: 7px; max-width: 78ch; }
.points.small { font-size: 0.9rem; gap: 4px; }
.scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); }
table.data { border-collapse: collapse; width: 100%; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
table.data th, table.data td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
table.data thead th { font-size: 0.76rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); border-bottom: 2px solid var(--ink); white-space: nowrap; background: var(--surface); }
table.data tbody th { font-weight: 600; }
table.data th.item { font-weight: 400; padding-left: 20px; }
table.data .num { text-align: right; white-space: nowrap; }
table.data .strong, table.data b { font-weight: 600; }
table.data tr.group th, table.data tr.group td { background: var(--field); font-weight: 600; }
table.data tfoot th, table.data tfoot td { border-bottom: 1px solid var(--line); }
table.data tr.total th, table.data tr.total td { border-top: 2px solid var(--ink); font-weight: 700; font-size: 1rem; }
table.data tr.muted-row th, table.data tr.muted-row td { color: var(--muted); font-weight: 400; }
table.data.narrow { max-width: 640px; }
table.data.wide { min-width: 1180px; }
table.data.wide td, table.data.wide th { font-size: 0.86rem; }
table.data.matrix { min-width: 820px; }
table.data.detail-table { min-width: 860px; }
.sub { display: block; font-weight: 400; font-size: 0.82rem; color: var(--muted); white-space: normal; }
.sub.warn { color: var(--rough); }
.flag { display: inline-block; font-size: 0.74rem; font-weight: 600; padding: 2px 7px; border-radius: 3px; white-space: nowrap; }
.flag.solid { color: var(--solid); background: var(--solid-bg); }
.flag.rough { color: var(--rough); background: var(--rough-bg); }
.flag.guess { color: var(--guess); background: var(--guess-bg); }
.legend { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 0.9rem; }
.legend span.item { display: inline-flex; gap: 6px; align-items: center; }
.refs { font-size: 0.78rem; white-space: nowrap; }
.refs a { margin-right: 3px; }
details { background: var(--surface); border: 1px solid var(--line); }
details > summary { cursor: pointer; padding: 10px 14px; font-weight: 600; }
details > .scroll { border: 0; border-top: 1px solid var(--line); }
details > ul { padding: 4px 14px 12px 2.2em; }
.option { display: flex; flex-direction: column; gap: 12px; padding-top: 18px; border-top: 2px solid var(--ink); min-width: 0; }
.option-head { display: flex; flex-direction: column; gap: 4px; }
.tagline { color: var(--muted); max-width: 70ch; }
.option-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.plans { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.plan-fig { margin: 0; background: var(--surface); border: 1px solid var(--line); padding: 8px; min-width: 0; }
.plan-fig figcaption { font-size: 0.76rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 2px 4px 6px; }
.plan-scroll { overflow-x: auto; }
.plan-scroll svg.plan { min-width: 560px; }
.option-text { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.facts { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr); border-top: 1px solid var(--line); }
.facts > div { display: grid; grid-template-columns: 9.5em minmax(0, 1fr); gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.fact-group { display: flex; flex-direction: column; gap: 8px; }
.sources { margin: 0; padding-left: 2.2em; font-size: 0.88rem; display: flex; flex-direction: column; gap: 5px; }
.sources li { overflow-wrap: anywhere; }
.src-pub { font-weight: 600; }
@media (max-width: 820px) {
  .titleblock { grid-template-columns: minmax(0, 1fr); }
  .tb-cells { border-left: 0; border-top: 2px solid var(--ink); }
  .option-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
${PLAN_SVG_CSS}`;

const html = `<title>Custer Barndo Cost Report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap">
<style>${css}</style>
<div class="sheet">
  <header class="titleblock">
    <div class="tb-main">
      <p class="eyebrow">Steps 2 to 4 of 6 &middot; research, cost model, floor plans</p>
      <h1>Research and cost report</h1>
      <p class="prose">${STOCK_PLANS.length} published plans, ${KIT_OFFERS.length} kit and shell providers, Kentucky rules and fees, a line-by-line cost model and four original floor plans. Nothing here is a quote. Every number names its source and how far to trust it.</p>
    </div>
    <dl class="tb-cells">
      <div><dt>Project</dt><dd>4 bed / 2.5 bath barndominium, no attached shop</dd></div>
      <div><dt>Site</dt><dd>7 acres near Custer, Breckinridge County, Kentucky</dd></div>
      <div><dt>Researched</dt><dd>${RESEARCH_DATE}</dd></div>
    </dl>
  </header>

  <nav class="toc" aria-label="Sections">
    <a href="#answer">Short answer</a><a href="#tiers">Budget tiers</a><a href="#plans">Floor plans</a><a href="#costs">Cost table</a><a href="#published">Published plans</a><a href="#kits">Kits and shells</a><a href="#kentucky">Kentucky facts</a><a href="#assumptions">Assumptions</a><a href="#questions">Questions for you</a><a href="#sources">Sources</a>
  </nav>

  <section class="block" id="answer">
    <h2>The short answer</h2>
    ${summaryTable()}
    ${takeaways()}
  </section>

  <section class="block" id="tiers">
    <h2>Budget tiers</h2>
    <p class="prose">You said your budget is not set, so here is what each ceiling buys. Totals are all-in: house, porch, site work, well, septic, builder's fee, contingency and loan costs.</p>
    ${tiers()}
    <h3>What moves the total most</h3>
    ${levers()}
  </section>

  <section class="block" id="plans">
    <h2>Four original floor plans</h2>
    <p class="prose">Each is a plain rectangle on a standard 36 or 40 ft truss span, sized like the published plans that came closest to your checklist. No published plan combined four bedrooms, an office with a door, a wraparound porch and no garage, so these fill that gap. Blue marks are windows and glass doors. Every plan can be mirrored or turned to face your view.</p>
    ${estimates.map(optionSection).join('')}
  </section>

  <section class="block" id="costs">
    <h2>Cost table</h2>
    <p class="prose">Expected cost of every line for each option. Open an option below the table for the low and high of each line, what it was multiplied by, and its sources.</p>
    <div class="legend">
      <span class="item">${flag('published')} a seller's own posted price for a comparable product</span>
      <span class="item">${flag('official')} a state fee schedule or utility tariff</span>
      <span class="item">${flag('guide')} a range from a cost guide, not a quote</span>
      <span class="item">${flag('assumption')} my own figure where no source gave one</span>
    </div>
    ${costMatrix()}
    <p class="prose small">Only about ${Math.round(Math.min(...estimates.map((e) => e.solidShare)) * 100)} to ${Math.round(Math.max(...estimates.map((e) => e.solidShare)) * 100)} percent of each total rests on published prices or official fees. The rest are cost-guide ranges, so treat every total as a planning figure until builders bid on it.</p>
    ${estimates.map(costDetail).join('')}
    <h3>How these totals compare with published figures</h3>
    <ul class="points">${COST_ANCHORS.map((f) => `<li>${esc(f.text)} ${refs(f.sources)}</li>`).join('')}</ul>
  </section>

  <section class="block" id="published">
    <h2>Published plans I found</h2>
    <p class="prose">All ${STOCK_PLANS.length} pages were live on ${RESEARCH_DATE}, and I re-checked each plan number, size and price on the page myself. Links go to the sellers. No drawing is reproduced here.</p>
    ${plansTable()}
    <ul class="points">
      <li>True 4 bed / 2.5 bath plans on one level run 2,096 to 2,400 sq ft. Most four-bedroom barndominium plans carry three full baths instead.</li>
      <li>Common footprints are 40 x 50, 40 x 60 and 50 x 50 ft before porches.</li>
      <li>Plan sets cost $850 to $1,813. Editable CAD sets run $2,100 to $2,600.</li>
      <li>Seven of the fourteen have a wraparound porch. None pairs it with four bedrooms, an office with a door and no garage.</li>
    </ul>
  </section>

  <section class="block" id="kits">
    <h2>Kits and shell providers</h2>
    <p class="prose">Every page was live on ${RESEARCH_DATE}. "Kit only" means materials delivered and you hire the crew. "Erected shell" means the seller builds the outside for you.</p>
    ${kitsTable()}
    <p class="prose small">Could not be opened, so not used: ${UNREACHABLE.map(esc).join('; ')}.</p>
  </section>

  <section class="block" id="kentucky">
    <h2>Kentucky rules and facts</h2>
    ${factsSection()}
  </section>

  <section class="block" id="assumptions">
    <h2>Assumptions I made</h2>
    <ol class="points">${ASSUMPTIONS.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>
  </section>

  <section class="block" id="questions">
    <h2>Questions for you before the 3D models</h2>
    <ol class="points">${QUESTIONS.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>
  </section>

  <section class="block" id="sources">
    <h2>Sources</h2>
    <p class="prose small">Numbers in the tables point here. Plan and kit pages are linked in their own tables above.</p>
    ${sourcesList()}
  </section>
</div>
`;

const outDir = process.argv[2] ?? 'dist-report';
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/custer-report.html`, html);
console.log(`wrote ${outDir}/custer-report.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
for (const e of estimates) console.log(`${e.option.id}: ${usdK(e.total.low)} / ${usdK(e.total.mid)} / ${usdK(e.total.high)}  $${e.perHeatedSf.mid}/sf`);
