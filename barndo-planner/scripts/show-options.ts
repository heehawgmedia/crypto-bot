import { OPTIONS } from '../src/custer/options';
import { asciiPlan, validateLevel, validateOpenings } from '../src/custer/validate';

for (const o of OPTIONS) {
  console.log(`\n=== ${o.plan.name} ===`);
  console.log(asciiPlan(o.plan, o.plan.rooms));
  const problems = [...validateLevel(o.plan, o.plan.rooms, 'main'), ...validateOpenings(o.plan, o.id)];
  if (o.upper) {
    console.log('--- upper ---');
    console.log(asciiPlan(o.plan, o.upper.rooms));
    const entry = o.upper.rooms.filter((r) => r.type === 'stair').map((r) => r.id);
    problems.push(...validateLevel(o.plan, o.upper.rooms, 'upper', entry.length ? [...entry, '__open__'] : ['__open__']));
  }
  console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'valid');
}
