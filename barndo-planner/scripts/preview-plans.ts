import { mkdirSync, writeFileSync } from 'node:fs';
import { OPTIONS } from '../src/custer/options';
import { PLAN_SVG_CSS, planSvg } from '../src/custer/planSvg';
import { takeoff } from '../src/custer/takeoff';

const out = process.argv[2] ?? 'dist-preview';
mkdirSync(out, { recursive: true });
let html = `<!doctype html><meta charset="utf8"><style>body{font:14px system-ui;margin:20px;background:#eef1f3;color:#17212a}h2{margin:24px 0 6px}.wrap{max-width:900px;background:#fff;padding:12px;border:1px solid #ccd}${PLAN_SVG_CSS}</style>`;
for (const o of OPTIONS) {
  html += `<h2>${o.plan.name}</h2><div class="wrap">${planSvg(o.plan, o.plan.rooms)}</div>`;
  if (o.upper) html += `<h2>${o.plan.name}: upper level</h2><div class="wrap">${planSvg(o.plan, o.upper.rooms, { exterior: false, upperLevel: true })}</div>`;
  console.log(o.id, JSON.stringify(takeoff(o)));
}
writeFileSync(`${out}/plans.html`, html);
console.log(`wrote ${out}/plans.html`);
