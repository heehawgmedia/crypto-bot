import { estimate } from '../src/custer/costModel';
import { OPTIONS } from '../src/custer/options';
import { RATES, SETTINGS } from '../src/custer/unitCosts';

const k = (n: number): string => `${Math.round(n / 1000)}k`;
for (const o of OPTIONS) {
  const e = estimate(o, RATES, SETTINGS);
  console.log(
    [
      o.id,
      `heated ${e.quantities.heatedSf}`,
      `likely ${k(e.total.low)} / ${k(e.total.mid)} / ${k(e.total.high)}`,
      `extremes ${k(e.extremes.low)} to ${k(e.extremes.high)}`,
      `per sf ${e.perHeatedSf.low} / ${e.perHeatedSf.mid} / ${e.perHeatedSf.high}`,
      `house only ${e.houseOnly.perSf} per sf, ${e.houseOnly.perSfUnderRoof} under roof`,
      `solid ${(e.solidShare * 100).toFixed(0)} percent`,
    ].join(' | '),
  );
}
