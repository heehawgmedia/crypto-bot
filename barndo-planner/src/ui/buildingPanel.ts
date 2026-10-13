import { EXTERIOR_DOOR_KINDS, WINDOW_KINDS } from '../model/catalog';
import { areaSummary, clampRoomToFootprint, porchArea, roofMetrics, roomsOverlap, SIDE_LABELS } from '../model/geometry';
import type { Store } from '../model/store';
import { SIDES, type Plan, type Project, type Side } from '../model/types';
import { el, field, numberInput, section, selectInput, setIfNotFocused, textInput } from './dom';
import { fmtInt, fmtSf } from './format';

function sideLength(plan: Plan, side: Side): number {
  return side === 'N' || side === 'S' ? plan.width : plan.depth;
}

/** Keep rooms and openings valid after the footprint shrinks. */
function reconcileAfterResize(plan: Plan): void {
  for (const r of plan.rooms) clampRoomToFootprint(plan, r);
  const kept: Plan['rooms'] = [];
  for (const r of plan.rooms) if (!kept.some((k) => roomsOverlap(k, r))) kept.push(r);
  plan.rooms = kept;
  plan.exteriorDoors = plan.exteriorDoors.filter((d) => d.offset + EXTERIOR_DOOR_KINDS[d.kind].width <= sideLength(plan, d.side));
  plan.windows = plan.windows.filter((w) => w.offset + WINDOW_KINDS[w.kind].width <= sideLength(plan, w.side));
}

export function createBuildingPanel(store: Store): { el: HTMLElement; update: (p: Project) => void } {
  const p0 = store.get().plan;
  const name = textInput(p0.name, (v) =>
    store.set((d) => {
      d.plan.name = v;
    }),
  );
  const setDim = (key: 'width' | 'depth') => (v: number) =>
    store.set((d) => {
      d.plan[key] = v;
      reconcileAfterResize(d.plan);
    });
  const width = numberInput(p0.width, { min: 16, max: 200, step: 1 }, setDim('width'));
  const depth = numberInput(p0.depth, { min: 16, max: 200, step: 1 }, setDim('depth'));
  const wallHeight = numberInput(p0.wallHeight, { min: 8, max: 20, step: 1 }, (v) =>
    store.set((d) => {
      d.plan.wallHeight = v;
    }),
  );
  const pitch = numberInput(p0.roofPitch, { min: 1, max: 12, step: 1 }, (v) =>
    store.set((d) => {
      d.plan.roofPitch = v;
    }),
  );
  const ridge = selectInput(
    [
      { value: 'z', label: 'North–south (gable ends on N & S)' },
      { value: 'x', label: 'East–west (gable ends on E & W)' },
    ],
    p0.ridgeAxis,
    (v) =>
      store.set((d) => {
        d.plan.ridgeAxis = v as 'x' | 'z';
      }),
  );
  const porchInputs = {} as Record<Side, HTMLInputElement>;
  for (const s of SIDES) {
    porchInputs[s] = numberInput(p0.porches[s], { min: 0, max: 16, step: 1 }, (v) =>
      store.set((d) => {
        d.plan.porches[s] = v;
      }),
    );
  }
  const stats = el('div', { class: 'stats' });

  const root = section('Building', [
    field('Plan name', name),
    el('div', { class: 'grid2' }, [field('Width (E–W), ft', width), field('Depth (N–S), ft', depth), field('Eave height, ft', wallHeight), field('Roof pitch (rise : 12)', pitch)]),
    field('Ridge runs', ridge),
    el('div', { class: 'field-label', text: 'Covered porch depth, ft (0 = none)' }),
    el(
      'div',
      { class: 'grid4' },
      SIDES.map((s) => field(SIDE_LABELS[s], porchInputs[s])),
    ),
    stats,
  ]);

  const stat = (label: string, value: string): HTMLElement => el('div', { class: 'stat' }, [el('span', { class: 'stat-value', text: value }), el('span', { class: 'stat-label', text: label })]);

  const update = (project: Project): void => {
    const plan = project.plan;
    setIfNotFocused(name, plan.name);
    setIfNotFocused(width, String(plan.width));
    setIfNotFocused(depth, String(plan.depth));
    setIfNotFocused(wallHeight, String(plan.wallHeight));
    setIfNotFocused(pitch, String(plan.roofPitch));
    setIfNotFocused(ridge, plan.ridgeAxis);
    for (const s of SIDES) setIfNotFocused(porchInputs[s], String(plan.porches[s]));
    const a = areaSummary(plan);
    const roof = roofMetrics(plan);
    stats.replaceChildren(
      stat('footprint', fmtSf(a.footprint)),
      stat('living', fmtSf(a.living)),
      stat('shop / garage', fmtSf(a.shop)),
      stat('open living', fmtSf(a.open)),
      stat('roof', fmtSf(roof.area)),
      stat('ridge height', `${roof.ridgeHeight.toFixed(1)} ft`),
      stat('porch', fmtSf(porchArea(plan))),
      stat('bed / bath', `${fmtInt(a.bedrooms)} / ${a.fullBaths + (a.halfBaths ? a.halfBaths * 0.5 : 0)}`),
    );
  };
  update(store.get());
  return { el: root, update };
}
