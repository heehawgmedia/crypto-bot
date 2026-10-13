import { PRICING } from '../cost/pricing';
import type { Store } from '../model/store';
import type { BuildOptions, Project } from '../model/types';
import { checkboxInput, el, field, rangeInput, section, selectInput, setIfNotFocused, type Choice } from './dom';

type Key = keyof BuildOptions;

interface SelectDef {
  kind: 'select';
  key: Key;
  label: string;
  choices: Choice[];
}
interface CheckDef {
  kind: 'check';
  key: Key;
  label: string;
  hint?: string;
}
interface RangeDef {
  kind: 'range';
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}
type Def = SelectDef | CheckDef | RangeDef;

const rated = (table: Record<string, { label: string; rate: number }>, unit = '/sf'): Choice[] =>
  Object.entries(table).map(([value, v]) => ({ value, label: v.rate ? `${v.label} · $${v.rate}${unit}` : v.label }));
const priced = (table: Record<string, { label: string; cost?: number; full?: number }>): Choice[] =>
  Object.entries(table).map(([value, v]) => ({ value, label: `${v.label} · $${((v.cost ?? v.full) as number).toLocaleString()}` }));

const GROUPS: { title: string; open?: boolean; fields: Def[] }[] = [
  {
    title: 'Structure',
    fields: [
      { kind: 'select', key: 'shell', label: 'Shell & framing', choices: rated(PRICING.shell) },
      { kind: 'select', key: 'foundation', label: 'Foundation', choices: rated(PRICING.foundation) },
      { kind: 'select', key: 'roofing', label: 'Roofing', choices: rated(PRICING.roofing) },
      {
        kind: 'select',
        key: 'exterior',
        label: 'Exterior finish',
        choices: [
          { value: 'metal-panel', label: 'Metal wall panels · included' },
          { value: 'board-batten', label: `Board & batten siding · $${PRICING.exterior['board-batten'].rate}/sf` },
          { value: 'stone-wainscot', label: `Stone wainscot + metal · $${PRICING.wainscotPerLf}/lf` },
          { value: 'brick', label: `Full brick veneer · $${PRICING.exterior.brick.rate}/sf` },
        ],
      },
      { kind: 'select', key: 'insulation', label: 'Insulation', choices: rated(PRICING.insulation) },
    ],
  },
  {
    title: 'Interior',
    fields: [
      { kind: 'select', key: 'interiorFinish', label: 'Interior finish level', choices: rated(PRICING.interiorFinish) },
      { kind: 'select', key: 'flooring', label: 'Flooring (wet rooms get tile)', choices: rated(PRICING.flooring) },
      { kind: 'select', key: 'kitchenTier', label: 'Kitchen', choices: priced(PRICING.kitchen) },
      { kind: 'select', key: 'bathTier', label: 'Bathrooms (each)', choices: priced(PRICING.bath) },
      {
        kind: 'select',
        key: 'windowGrade',
        label: 'Window grade',
        choices: [
          { value: 'standard', label: 'Standard vinyl' },
          { value: 'premium', label: 'Premium (fiberglass / black frame)' },
        ],
      },
      { kind: 'select', key: 'shopFinish', label: 'Shop / garage finish', choices: rated(PRICING.shopFinish) },
      { kind: 'check', key: 'shopConditioned', label: 'Heat & cool the shop', hint: 'adds the shop to HVAC and insulation' },
    ],
  },
  {
    title: 'Systems',
    fields: [
      { kind: 'select', key: 'hvac', label: 'Heating & cooling', choices: rated(PRICING.hvac) },
      {
        kind: 'select',
        key: 'waterHeater',
        label: 'Water heater',
        choices: [
          { value: 'tank', label: `Tank · $${PRICING.plumbing.waterHeater.tank.toLocaleString()}` },
          { value: 'tankless', label: `Tankless · $${PRICING.plumbing.waterHeater.tankless.toLocaleString()}` },
        ],
      },
      {
        kind: 'select',
        key: 'electricalService',
        label: 'Electrical service',
        choices: [
          { value: '200A', label: '200 A · included' },
          { value: '400A', label: `400 A · +$${PRICING.electrical.service['400A'].toLocaleString()}` },
        ],
      },
      { kind: 'check', key: 'fireplace', label: 'Fireplace', hint: `$${PRICING.fireplace.toLocaleString()}` },
    ],
  },
  {
    title: 'Site & utilities',
    fields: [
      { kind: 'check', key: 'well', label: 'Drill a water well', hint: `$${PRICING.site.well.toLocaleString()}` },
      { kind: 'check', key: 'septic', label: 'Septic system', hint: `$${PRICING.site.septic.toLocaleString()}` },
      { kind: 'check', key: 'cityUtilities', label: 'City water & sewer taps', hint: `$${PRICING.site.cityTaps.toLocaleString()}` },
      { kind: 'check', key: 'driveway', label: 'Gravel driveway', hint: `$${PRICING.site.driveway.toLocaleString()}` },
    ],
  },
  {
    title: 'Estimate settings',
    fields: [
      { kind: 'range', key: 'regionMultiplier', label: 'Regional cost multiplier', min: 0.6, max: 1.8, step: 0.05, format: (v) => `${v.toFixed(2)}× national average` },
      { kind: 'range', key: 'contingencyPct', label: 'Contingency', min: 0, max: 30, step: 1, format: (v) => `${v}% of subtotal` },
    ],
  },
];

export function createOptionsPanel(store: Store): { el: HTMLElement; update: (p: Project) => void } {
  const controls: { def: Def; input: HTMLInputElement | HTMLSelectElement; label?: HTMLElement }[] = [];
  const o0 = store.get().options;
  const setOpt = (key: Key, value: BuildOptions[Key]): void =>
    store.set((d) => {
      (d.options as unknown as Record<string, unknown>)[key] = value;
    });

  const root = el('div', { class: 'options' });
  for (const g of GROUPS) {
    const items: HTMLElement[] = [];
    for (const def of g.fields) {
      if (def.kind === 'select') {
        const input = selectInput(def.choices, String(o0[def.key]), (v) => setOpt(def.key, v as BuildOptions[Key]));
        controls.push({ def, input });
        items.push(field(def.label, input));
      } else if (def.kind === 'check') {
        const input = checkboxInput(Boolean(o0[def.key]), (v) => setOpt(def.key, v));
        controls.push({ def, input });
        items.push(el('label', { class: 'check' }, [input, el('span', { text: def.label }), def.hint ? el('span', { class: 'hint', text: def.hint }) : null]));
      } else {
        const value = Number(o0[def.key]);
        const label = el('span', { class: 'range-value', text: def.format(value) });
        const input = rangeInput(value, def, (v) => {
          label.textContent = def.format(v);
          setOpt(def.key, v);
        });
        controls.push({ def, input, label });
        items.push(el('label', { class: 'field' }, [el('span', { class: 'field-label' }, [def.label, ' ', label]), input]));
      }
    }
    root.append(section(g.title, items, { open: g.open !== false }));
  }

  const update = (project: Project): void => {
    for (const c of controls) {
      const v = project.options[c.def.key];
      if (c.def.kind === 'check') (c.input as HTMLInputElement).checked = Boolean(v);
      else {
        setIfNotFocused(c.input, String(v));
        if (c.def.kind === 'range' && c.label) c.label.textContent = c.def.format(Number(v));
      }
    }
  };
  return { el: root, update };
}
