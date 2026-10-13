import { EXTERIOR_DOOR_KINDS, WINDOW_KINDS } from '../model/catalog';
import { autoWindows, overlapsExteriorOpening, SIDE_LABELS } from '../model/geometry';
import { uid } from '../model/presets';
import type { Store } from '../model/store';
import { SIDES, type ExteriorDoorKind, type Plan, type Project, type Side, type WindowKind } from '../model/types';
import { button, el, numberInput, section, selectInput, setIfNotFocused } from './dom';

const sideChoices = SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }));
const doorKindChoices = (Object.entries(EXTERIOR_DOOR_KINDS) as [ExteriorDoorKind, { label: string }][]).map(([k, v]) => ({ value: k, label: v.label }));
const windowKindChoices = (Object.entries(WINDOW_KINDS) as [WindowKind, { label: string }][]).map(([k, v]) => ({ value: k, label: v.label }));

function sideLength(plan: Plan, side: Side): number {
  return side === 'N' || side === 'S' ? plan.width : plan.depth;
}

/** First offset on `side` where an opening of `width` fits without overlapping anything. */
function firstFreeOffset(plan: Plan, side: Side, width: number): number | undefined {
  const len = sideLength(plan, side);
  for (let off = 2; off + width <= len - 2; off += 1) if (!overlapsExteriorOpening(plan, side, off, width)) return off;
  return undefined;
}

export function createOpeningsPanel(store: Store, onMessage: (m: string) => void): { el: HTMLElement; update: (p: Project) => void } {
  const doorList = el('div', { class: 'list' });
  const windowList = el('div', { class: 'list' });
  let renderedKey = '';
  let doorRows: { side: HTMLSelectElement; offset: HTMLInputElement; kind: HTMLSelectElement }[] = [];
  let windowRows: { side: HTMLSelectElement; offset: HTMLInputElement; kind: HTMLSelectElement }[] = [];

  const addDoor = button('+ Exterior door', () => {
    const plan = store.get().plan;
    for (const side of ['E', 'S', 'W', 'N'] as Side[]) {
      const off = firstFreeOffset(plan, side, EXTERIOR_DOOR_KINDS.entry.width);
      if (off !== undefined) {
        store.set((d) => {
          d.plan.exteriorDoors.push({ id: uid('door'), side, offset: off, kind: 'entry' });
        });
        return;
      }
    }
    onMessage('No free wall space for another door.');
  });
  const addWindow = button('+ Window', () => {
    const plan = store.get().plan;
    for (const side of ['E', 'S', 'W', 'N'] as Side[]) {
      const off = firstFreeOffset(plan, side, WINDOW_KINDS.single.width);
      if (off !== undefined) {
        store.set((d) => {
          d.plan.windows.push({ id: uid('win'), side, offset: off, kind: 'single' });
        });
        return;
      }
    }
    onMessage('No free wall space for another window.');
  });
  const auto = button('✨ Auto-place windows', () => {
    store.set((d) => {
      d.plan.windows = [];
      d.plan.windows = autoWindows(d.plan, () => uid('win'));
    });
    onMessage('Windows placed every ~10 ft along exterior walls (skipping shop, closets, baths without exterior walls, and doors).');
  }, { title: 'Replace all windows with an evenly spaced layout' });

  const root = section(
    'Exterior doors & windows',
    [
      el('div', { class: 'hint', text: 'Offsets are feet from the west end (N/S walls) or north end (E/W walls). Tip: the Door and Window tools in the floor plan place these by clicking.' }),
      el('div', { class: 'field-label', text: 'Exterior doors' }),
      doorList,
      el('div', { class: 'field-label', text: 'Windows' }),
      windowList,
      el('div', { class: 'row actions' }, [addDoor, addWindow, auto]),
    ],
    { open: false },
  );

  const build = (plan: Plan): void => {
    doorRows = [];
    windowRows = [];
    doorList.replaceChildren(
      ...plan.exteriorDoors.map((d) => {
        const side = selectInput(sideChoices, d.side, (v) =>
          store.set((s) => {
            const x = s.plan.exteriorDoors.find((dd) => dd.id === d.id);
            if (x) {
              x.side = v as Side;
              x.offset = Math.min(x.offset, Math.max(0, sideLength(s.plan, x.side) - EXTERIOR_DOOR_KINDS[x.kind].width));
            }
          }),
        );
        const offset = numberInput(d.offset, { min: 0, max: 200, step: 0.5 }, (v) =>
          store.set((s) => {
            const x = s.plan.exteriorDoors.find((dd) => dd.id === d.id);
            if (x) x.offset = Math.min(v, Math.max(0, sideLength(s.plan, x.side) - EXTERIOR_DOOR_KINDS[x.kind].width));
          }),
        );
        const kind = selectInput(doorKindChoices, d.kind, (v) =>
          store.set((s) => {
            const x = s.plan.exteriorDoors.find((dd) => dd.id === d.id);
            if (x) {
              x.kind = v as ExteriorDoorKind;
              x.offset = Math.min(x.offset, Math.max(0, sideLength(s.plan, x.side) - EXTERIOR_DOOR_KINDS[x.kind].width));
            }
          }),
        );
        const remove = button('✕', () =>
          store.set((s) => {
            s.plan.exteriorDoors = s.plan.exteriorDoors.filter((dd) => dd.id !== d.id);
          }), { class: 'icon danger', title: 'Remove' });
        doorRows.push({ side, offset, kind });
        return el('div', { class: 'row' }, [side, offset, kind, remove]);
      }),
    );
    if (!plan.exteriorDoors.length) doorList.append(el('div', { class: 'hint', text: 'No exterior doors.' }));
    windowList.replaceChildren(
      ...plan.windows.map((w) => {
        const side = selectInput(sideChoices, w.side, (v) =>
          store.set((s) => {
            const x = s.plan.windows.find((ww) => ww.id === w.id);
            if (x) {
              x.side = v as Side;
              x.offset = Math.min(x.offset, Math.max(0, sideLength(s.plan, x.side) - WINDOW_KINDS[x.kind].width));
            }
          }),
        );
        const offset = numberInput(w.offset, { min: 0, max: 200, step: 0.5 }, (v) =>
          store.set((s) => {
            const x = s.plan.windows.find((ww) => ww.id === w.id);
            if (x) x.offset = Math.min(v, Math.max(0, sideLength(s.plan, x.side) - WINDOW_KINDS[x.kind].width));
          }),
        );
        const kind = selectInput(windowKindChoices, w.kind, (v) =>
          store.set((s) => {
            const x = s.plan.windows.find((ww) => ww.id === w.id);
            if (x) {
              x.kind = v as WindowKind;
              x.offset = Math.min(x.offset, Math.max(0, sideLength(s.plan, x.side) - WINDOW_KINDS[x.kind].width));
            }
          }),
        );
        const remove = button('✕', () =>
          store.set((s) => {
            s.plan.windows = s.plan.windows.filter((ww) => ww.id !== w.id);
          }), { class: 'icon danger', title: 'Remove' });
        windowRows.push({ side, offset, kind });
        return el('div', { class: 'row' }, [side, offset, kind, remove]);
      }),
    );
    if (!plan.windows.length) windowList.append(el('div', { class: 'hint', text: 'No windows yet.' }));
  };

  const update = (project: Project): void => {
    const plan = project.plan;
    const key = `${plan.exteriorDoors.map((d) => d.id).join(',')}|${plan.windows.map((w) => w.id).join(',')}`;
    if (key !== renderedKey) {
      renderedKey = key;
      build(plan);
      return;
    }
    plan.exteriorDoors.forEach((d, i) => {
      const r = doorRows[i];
      if (!r) return;
      setIfNotFocused(r.side, d.side);
      setIfNotFocused(r.offset, String(d.offset));
      setIfNotFocused(r.kind, d.kind);
    });
    plan.windows.forEach((w, i) => {
      const r = windowRows[i];
      if (!r) return;
      setIfNotFocused(r.side, w.side);
      setIfNotFocused(r.offset, String(w.offset));
      setIfNotFocused(r.kind, w.kind);
    });
  };
  update(store.get());
  return { el: root, update };
}
