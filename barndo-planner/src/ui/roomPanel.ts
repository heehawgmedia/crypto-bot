import { INTERIOR_DOOR_WIDTHS, ROOM_TYPES, ROOM_TYPE_LIST } from '../model/catalog';
import { edgeLength, roomFits, sanitizeDoors, SIDE_LABELS } from '../model/geometry';
import type { Store } from '../model/store';
import { SIDES, type Project, type Room, type RoomType, type Side } from '../model/types';
import { button, el, field, numberInput, section, selectInput, setIfNotFocused, textInput } from './dom';
import { fmtSf } from './format';
import type { PlanEditor } from './planEditor';

interface Opts {
  onWalkTo: (room: Room) => void;
  onMessage: (msg: string) => void;
}

export function createRoomPanel(store: Store, editor: PlanEditor, opts: Opts): { el: HTMLElement; update: (p: Project) => void } {
  const body = el('div');
  const root = section('Selected room', [body]);
  let renderedKey = '';
  let fields: { name: HTMLInputElement; type: HTMLSelectElement; dims: Record<'x' | 'z' | 'w' | 'd', HTMLInputElement>; doors: { side: HTMLSelectElement; offset: HTMLInputElement; width: HTMLSelectElement }[] } | undefined;

  const mutateRoom = (id: string, fn: (r: Room) => void): void =>
    store.set((d) => {
      const r = d.plan.rooms.find((rr) => rr.id === id);
      if (r) fn(r);
    });

  const build = (room: Room): void => {
    const plan = store.get().plan;
    const name = textInput(room.name, (v) => mutateRoom(room.id, (r) => (r.name = v)));
    const type = selectInput(
      ROOM_TYPE_LIST.map((t) => ({ value: t, label: ROOM_TYPES[t].label })),
      room.type,
      (v) => mutateRoom(room.id, (r) => (r.type = v as RoomType)),
    );
    const dims = {} as Record<'x' | 'z' | 'w' | 'd', HTMLInputElement>;
    const dimLabels: Record<'x' | 'z' | 'w' | 'd', string> = { x: 'From west wall, ft', z: 'From north wall, ft', w: 'Width, ft', d: 'Depth, ft' };
    for (const k of ['x', 'z', 'w', 'd'] as const) {
      dims[k] = numberInput(room[k], { min: k === 'w' || k === 'd' ? 4 : 0, max: 200, step: 1 }, (v) => {
        const cur = store.get().plan.rooms.find((rr) => rr.id === room.id);
        if (!cur) return;
        const rect = { x: cur.x, z: cur.z, w: cur.w, d: cur.d, [k]: v };
        if (!roomFits(store.get().plan, rect, room.id)) {
          opts.onMessage('That size or position overlaps another room or leaves the footprint.');
          dims[k].value = String(cur[k]);
          return;
        }
        mutateRoom(room.id, (r) => {
          Object.assign(r, rect);
          sanitizeDoors(r);
        });
      });
    }

    const doorRows: typeof fields extends infer F ? (F extends { doors: infer D } ? D : never) : never = [];
    const doorList = el('div', { class: 'list' });
    room.doors.forEach((door, i) => {
      const side = selectInput(
        SIDES.map((s) => ({ value: s, label: `${SIDE_LABELS[s]} wall` })),
        door.side,
        (v) =>
          mutateRoom(room.id, (r) => {
            r.doors[i].side = v as Side;
            sanitizeDoors(r);
          }),
      );
      const offset = numberInput(door.offset, { min: 0, max: 200, step: 0.5 }, (v) =>
        mutateRoom(room.id, (r) => {
          r.doors[i].offset = v;
          sanitizeDoors(r);
        }),
      );
      const width = selectInput(
        INTERIOR_DOOR_WIDTHS.map((w) => ({ value: String(w.value), label: w.label })),
        String(door.width),
        (v) =>
          mutateRoom(room.id, (r) => {
            r.doors[i].width = Number(v);
            sanitizeDoors(r);
          }),
      );
      const remove = button('✕', () => mutateRoom(room.id, (r) => r.doors.splice(i, 1)), { class: 'icon danger', title: 'Remove door' });
      doorRows.push({ side, offset, width });
      doorList.append(el('div', { class: 'row' }, [side, offset, width, remove]));
    });
    if (!room.doors.length) doorList.append(el('div', { class: 'hint', text: 'No doors yet: use the Door tool on a wall, or add one here.' }));

    const addSide = selectInput(
      SIDES.map((s) => ({ value: s, label: `${SIDE_LABELS[s]} wall` })),
      'N',
      () => undefined,
    );
    const addDoor = button('+ Add door', () => {
      const s = addSide.value as Side;
      const cur = store.get().plan.rooms.find((rr) => rr.id === room.id);
      if (!cur) return;
      const len = edgeLength(cur, s);
      if (len < 3) return;
      mutateRoom(room.id, (r) => r.doors.push({ side: s, offset: Math.max(0, Math.round(len / 2 - 1.5)), width: 3 }));
    });

    body.replaceChildren(
      field('Name', name),
      field('Type', type),
      el('div', { class: 'grid2' }, (['x', 'z', 'w', 'd'] as const).map((k) => field(dimLabels[k], dims[k]))),
      el('div', { class: 'hint', text: `${fmtSf(room.w * room.d)} · doors are measured from the west / north end of the wall` }),
      el('div', { class: 'field-label', text: 'Doors & openings' }),
      doorList,
      el('div', { class: 'row' }, [addSide, addDoor]),
      el('div', { class: 'row actions' }, [
        button('🚶 Walk here', () => opts.onWalkTo(room), { class: 'primary' }),
        button('Duplicate', () => editor.duplicateSelected()),
        button('Delete', () => editor.deleteSelected(), { class: 'danger' }),
      ]),
    );
    fields = { name, type, dims, doors: doorRows };
    void plan;
  };

  const update = (project: Project): void => {
    const room = project.plan.rooms.find((r) => r.id === editor.selectedId);
    if (!room) {
      renderedKey = '';
      fields = undefined;
      body.replaceChildren(el('div', { class: 'hint empty', text: 'Click a room in the floor plan to edit it. Drag to move it, drag the handles to resize, or use the Door and Window tools on its walls.' }));
      return;
    }
    const key = `${room.id}:${room.doors.length}`;
    if (key !== renderedKey || !fields) {
      renderedKey = key;
      build(room);
      return;
    }
    setIfNotFocused(fields.name, room.name);
    setIfNotFocused(fields.type, room.type);
    for (const k of ['x', 'z', 'w', 'd'] as const) setIfNotFocused(fields.dims[k], String(room[k]));
    room.doors.forEach((door, i) => {
      const row = fields?.doors[i];
      if (!row) return;
      setIfNotFocused(row.side, door.side);
      setIfNotFocused(row.offset, String(door.offset));
      setIfNotFocused(row.width, String(door.width));
    });
    const sfHint = body.querySelector('.hint');
    if (sfHint) sfHint.textContent = `${fmtSf(room.w * room.d)} · doors are measured from the west / north end of the wall`;
  };

  update(store.get());
  return { el: root, update };
}

/** Compact clickable list of every room, with area; selecting one highlights it in the plan. */
export function createRoomList(store: Store, editor: PlanEditor): { el: HTMLElement; update: (p: Project) => void } {
  const list = el('div', { class: 'room-list' });
  const update = (project: Project): void => {
    list.replaceChildren(
      ...project.plan.rooms.map((r) =>
        button(`${r.name} · ${r.w * r.d} sf`, () => editor.select(r.id), {
          class: `chip ${r.id === editor.selectedId ? 'active' : ''}`,
          style: `--chip: ${ROOM_TYPES[r.type].color}`,
        }),
      ),
    );
    if (!project.plan.rooms.length) list.append(el('span', { class: 'hint', text: 'No rooms yet. Use "Add room" above.' }));
  };
  update(store.get());
  return { el: list, update };
}
