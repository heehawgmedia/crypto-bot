import { EXTERIOR_DOOR_KINDS, INTERIOR_DOOR_WIDTHS, ROOM_TYPES, ROOM_TYPE_LIST, WINDOW_KINDS } from '../model/catalog';
import {
  clamp,
  deriveWalls,
  edgeLine,
  findFreeSpot,
  inwardDir,
  MIN_ROOM,
  nearestWall,
  overlapsExteriorOpening,
  porchRects,
  roomAt,
  roomFits,
  roomsOnLine,
  sanitizeDoors,
  sideLine,
  snap,
  solidSpans,
  type Opening,
  type Rect,
  type WallHit,
  type WallSegment,
} from '../model/geometry';
import { uid } from '../model/presets';
import type { Store } from '../model/store';
import type { ExteriorDoorKind, Plan, Room, RoomType, Side, WindowKind } from '../model/types';
import { button, el, isTypingTarget, selectInput } from './dom';

export type EditorMode = 'select' | 'door' | 'window' | 'room';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
interface MoveDrag {
  kind: 'move';
  id: string;
  dx: number;
  dz: number;
}
interface ResizeDrag {
  kind: 'resize';
  id: string;
  handle: Handle;
  orig: Rect;
}
type Drag = MoveDrag | ResizeDrag;

const MARGIN = 26;
const MAX_HEIGHT = 600;
const HANDLE_PX = 7;
const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Room name like "Bedroom 4" that doesn't collide with existing names. */
export function nextRoomName(plan: Plan, type: RoomType): string {
  const base = ROOM_TYPES[type].label;
  const taken = new Set(plan.rooms.map((r) => r.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return `${base} ${Date.now() % 1000}`;
}

/** Interactive top-down floor plan: drag / resize rooms, click walls to toggle doors and windows. */
export class PlanEditor {
  mode: EditorMode = 'select';
  /** `i:<width>` for an interior door / cased opening, `e:<kind>` for an exterior door. */
  doorChoice = 'i:3';
  windowChoice: WindowKind = 'single';
  roomChoice: RoomType = 'bedroom';
  selectedId: string | undefined;
  onSelect?: (id: string | undefined) => void;
  onMessage?: (msg: string) => void;
  onModeChange?: (mode: EditorMode) => void;

  private ctx: CanvasRenderingContext2D;
  private scale = 6;
  private ox = MARGIN;
  private oz = MARGIN;
  private drag?: Drag;
  private hover?: WallHit;
  private hoverRoomId?: string;
  private walls: WallSegment[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = undefined;
      this.hoverRoomId = undefined;
      this.render();
    });
    window.addEventListener('keydown', this.onKey);
    new ResizeObserver(() => this.render()).observe(canvas.parentElement ?? canvas);
  }

  select(id: string | undefined): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.onSelect?.(id);
    this.render();
  }

  setMode(mode: EditorMode): void {
    this.mode = mode;
    this.hover = undefined;
    this.canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair';
    this.onModeChange?.(mode);
    this.render();
  }

  selectedRoom(plan: Plan = this.store.get().plan): Room | undefined {
    return plan.rooms.find((r) => r.id === this.selectedId);
  }

  /** Add a room of the chosen type in the first free spot. */
  addRoom(type: RoomType = this.roomChoice): void {
    const plan = this.store.get().plan;
    const info = ROOM_TYPES[type];
    const sizes: [number, number][] = [
      [info.w, info.d],
      [Math.max(MIN_ROOM, Math.round(info.w * 0.75)), Math.max(MIN_ROOM, Math.round(info.d * 0.75))],
      [8, 8],
      [6, 6],
      [MIN_ROOM, MIN_ROOM],
    ];
    for (const [w, d] of sizes) {
      const spot = findFreeSpot(plan, w, d);
      if (spot) {
        this.insertRoom(type, { ...spot, w, d });
        return;
      }
    }
    this.msg('No free space left in the footprint. Enlarge the building or remove a room.');
  }

  deleteSelected(): void {
    const id = this.selectedId;
    if (!id) return;
    this.store.set((d) => {
      d.plan.rooms = d.plan.rooms.filter((r) => r.id !== id);
    });
    this.select(undefined);
  }

  duplicateSelected(): void {
    const room = this.selectedRoom();
    if (!room) return;
    const plan = this.store.get().plan;
    const spot = findFreeSpot(plan, room.w, room.d);
    if (!spot) {
      this.msg('No free space for a copy.');
      return;
    }
    const id = uid('room');
    this.store.set((d) => {
      d.plan.rooms.push({ ...structuredClone(room), id, name: nextRoomName(d.plan, room.type), x: spot.x, z: spot.z });
    });
    this.select(id);
  }

  private insertRoom(type: RoomType, rect: Rect): void {
    const id = uid('room');
    this.store.set((d) => {
      d.plan.rooms.push({ id, name: nextRoomName(d.plan, type), type, ...rect, doors: [] });
    });
    this.select(id);
    this.msg(`Added ${ROOM_TYPES[type].label}. Switch to the Door tool and click a wall to add a doorway.`);
  }

  private msg(text: string): void {
    this.onMessage?.(text);
  }

  // ---------------------------------------------------------------- transforms

  private layout(plan: Plan): { cssW: number; cssH: number } {
    let minX = 0;
    let maxX = plan.width;
    let minZ = 0;
    let maxZ = plan.depth;
    for (const p of porchRects(plan)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z + p.d);
    }
    const availW = Math.max(200, (this.canvas.parentElement?.clientWidth ?? 400) - 2 * MARGIN);
    const availH = MAX_HEIGHT - 2 * MARGIN;
    this.scale = clamp(Math.min(availW / (maxX - minX), availH / (maxZ - minZ)), 2, 16);
    this.ox = MARGIN - minX * this.scale;
    this.oz = MARGIN - minZ * this.scale;
    return { cssW: (maxX - minX) * this.scale + 2 * MARGIN, cssH: (maxZ - minZ) * this.scale + 2 * MARGIN };
  }

  private sx = (x: number): number => this.ox + x * this.scale;
  private sz = (z: number): number => this.oz + z * this.scale;

  private toWorld(e: PointerEvent): { x: number; z: number; px: number; py: number } {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { x: (px - this.ox) / this.scale, z: (py - this.oz) / this.scale, px, py };
  }

  private handlePositions(room: Rect): Record<Handle, [number, number]> {
    const x0 = this.sx(room.x);
    const x1 = this.sx(room.x + room.w);
    const z0 = this.sz(room.z);
    const z1 = this.sz(room.z + room.d);
    const xm = (x0 + x1) / 2;
    const zm = (z0 + z1) / 2;
    return { nw: [x0, z0], n: [xm, z0], ne: [x1, z0], e: [x1, zm], se: [x1, z1], s: [xm, z1], sw: [x0, z1], w: [x0, zm] };
  }

  private hitHandle(room: Rect, px: number, py: number): Handle | undefined {
    const pos = this.handlePositions(room);
    for (const [h, [hx, hy]] of Object.entries(pos) as [Handle, [number, number]][]) {
      if (Math.abs(hx - px) <= HANDLE_PX + 2 && Math.abs(hy - py) <= HANDLE_PX + 2) return h;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- pointer handling

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.canvas.focus?.();
    const plan = this.store.get().plan;
    const p = this.toWorld(e);
    if (this.mode === 'select') {
      const sel = this.selectedRoom(plan);
      if (sel) {
        const h = this.hitHandle(sel, p.px, p.py);
        if (h) {
          this.store.checkpoint();
          this.drag = { kind: 'resize', id: sel.id, handle: h, orig: { x: sel.x, z: sel.z, w: sel.w, d: sel.d } };
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      const room = roomAt(plan, p.x, p.z);
      if (room) {
        this.select(room.id);
        this.store.checkpoint();
        this.drag = { kind: 'move', id: room.id, dx: p.x - room.x, dz: p.z - room.z };
        this.canvas.setPointerCapture(e.pointerId);
      } else this.select(undefined);
    } else if (this.mode === 'door' || this.mode === 'window') this.toggleOpening(p.x, p.z);
    else this.placeRoomAt(p.x, p.z);
  };

  private onMove = (e: PointerEvent): void => {
    const plan = this.store.get().plan;
    const p = this.toWorld(e);
    if (this.drag) {
      if (this.drag.kind === 'move') this.applyMove(plan, this.drag, p.x, p.z);
      else this.applyResize(plan, this.drag, p.x, p.z);
      return;
    }
    if (this.mode === 'door' || this.mode === 'window') {
      const hit = nearestWall(this.walls, p.x, p.z);
      this.hover = hit && hit.dist <= 1.5 ? hit : undefined;
      this.render();
    } else if (this.mode === 'select') {
      const sel = this.selectedRoom(plan);
      const h = sel ? this.hitHandle(sel, p.px, p.py) : undefined;
      const room = roomAt(plan, p.x, p.z);
      this.canvas.style.cursor = h ? CURSORS[h] : room ? 'move' : 'default';
      if (room?.id !== this.hoverRoomId) {
        this.hoverRoomId = room?.id;
        this.render();
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.drag = undefined;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.render();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape') {
      if (this.mode !== 'select') this.setMode('select');
      else this.select(undefined);
      return;
    }
    if (!this.selectedId) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    const nudge: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const n = nudge[e.key];
    if (!n) return;
    const plan = this.store.get().plan;
    const room = this.selectedRoom(plan);
    if (!room) return;
    e.preventDefault();
    const rect = { x: room.x + n[0], z: room.z + n[1], w: room.w, d: room.d };
    if (!roomFits(plan, rect, room.id)) return;
    this.store.set((d) => {
      const r = d.plan.rooms.find((rr) => rr.id === room.id);
      if (r) {
        r.x = rect.x;
        r.z = rect.z;
      }
    });
  };

  private applyMove(plan: Plan, drag: MoveDrag, x: number, z: number): void {
    const room = plan.rooms.find((r) => r.id === drag.id);
    if (!room) return;
    const nx = clamp(snap(x - drag.dx), 0, plan.width - room.w);
    const nz = clamp(snap(z - drag.dz), 0, plan.depth - room.d);
    if (nx === room.x && nz === room.z) return;
    const size = { w: room.w, d: room.d };
    const candidates: Rect[] = [
      { x: nx, z: nz, ...size },
      { x: nx, z: room.z, ...size },
      { x: room.x, z: nz, ...size },
    ];
    const ok = candidates.find((c) => roomFits(plan, c, room.id));
    if (!ok || (ok.x === room.x && ok.z === room.z)) return;
    this.store.set(
      (d) => {
        const r = d.plan.rooms.find((rr) => rr.id === room.id);
        if (r) {
          r.x = ok.x;
          r.z = ok.z;
        }
      },
      { record: false },
    );
  }

  private applyResize(plan: Plan, drag: ResizeDrag, x: number, z: number): void {
    const room = plan.rooms.find((r) => r.id === drag.id);
    if (!room) return;
    const { orig, handle } = drag;
    let { x: rx, z: rz, w, d } = orig;
    const x2 = orig.x + orig.w;
    const z2 = orig.z + orig.d;
    const px = clamp(snap(x), 0, plan.width);
    const pz = clamp(snap(z), 0, plan.depth);
    if (handle.includes('w')) {
      rx = Math.min(px, x2 - MIN_ROOM);
      w = x2 - rx;
    }
    if (handle.includes('e')) w = Math.max(MIN_ROOM, px - orig.x);
    if (handle.includes('n')) {
      rz = Math.min(pz, z2 - MIN_ROOM);
      d = z2 - rz;
    }
    if (handle.includes('s')) d = Math.max(MIN_ROOM, pz - orig.z);
    const rect = { x: rx, z: rz, w, d };
    if (rect.x === room.x && rect.z === room.z && rect.w === room.w && rect.d === room.d) return;
    if (!roomFits(plan, rect, room.id)) return;
    this.store.set(
      (dr) => {
        const r = dr.plan.rooms.find((rr) => rr.id === room.id);
        if (r) {
          Object.assign(r, rect);
          sanitizeDoors(r);
        }
      },
      { record: false },
    );
  }

  private placeRoomAt(x: number, z: number): void {
    const plan = this.store.get().plan;
    const info = ROOM_TYPES[this.roomChoice];
    const w = Math.min(info.w, plan.width);
    const d = Math.min(info.d, plan.depth);
    const rect = { x: clamp(snap(x - w / 2), 0, plan.width - w), z: clamp(snap(z - d / 2), 0, plan.depth - d), w, d };
    if (!roomFits(plan, rect)) {
      this.msg("A room that size doesn't fit there. Try another spot, or use Add room to auto-place it.");
      return;
    }
    this.insertRoom(this.roomChoice, rect);
  }

  private exteriorKindFromChoice(): ExteriorDoorKind {
    if (this.doorChoice.startsWith('e:')) return this.doorChoice.slice(2) as ExteriorDoorKind;
    return Number(this.doorChoice.slice(2)) >= 6 ? 'french' : 'entry';
  }

  private interiorWidthFromChoice(): number {
    if (this.doorChoice.startsWith('e:')) return EXTERIOR_DOOR_KINDS[this.doorChoice.slice(2) as ExteriorDoorKind].width;
    return Number(this.doorChoice.slice(2)) || 3;
  }

  private exteriorOverlaps(plan: Plan, side: Side, offset: number, width: number): boolean {
    return overlapsExteriorOpening(plan, side, offset, width);
  }

  private toggleOpening(x: number, z: number): void {
    const plan = this.store.get().plan;
    const hit = nearestWall(this.walls, x, z);
    if (!hit || hit.dist > 1.5) {
      this.msg('Click on a wall to add or remove an opening.');
      return;
    }
    const { wall, t } = hit;
    const within = (start: number, width: number): boolean => t >= start - 0.3 && t <= start + width + 0.3;

    if (this.mode === 'window') {
      if (!wall.exterior || !wall.side) {
        this.msg('Windows can only go on exterior walls.');
        return;
      }
      const side = wall.side;
      const line = sideLine(plan, side);
      const existing = plan.windows.find((w) => w.side === side && within(line.start + w.offset, WINDOW_KINDS[w.kind].width));
      if (existing) {
        this.store.set((d) => {
          d.plan.windows = d.plan.windows.filter((w) => w.id !== existing.id);
        });
        return;
      }
      const k = WINDOW_KINDS[this.windowChoice];
      const len = line.end - line.start;
      if (len < k.width) return;
      const offset = clamp(snap(t - k.width / 2, 0.5) - line.start, 0, len - k.width);
      if (this.exteriorOverlaps(plan, side, offset, k.width)) {
        this.msg('That spot overlaps another door or window.');
        return;
      }
      const kind = this.windowChoice;
      this.store.set((d) => {
        d.plan.windows.push({ id: uid('win'), side, offset, kind });
      });
      return;
    }

    // Door tool: first look for an existing opening under the cursor and remove it.
    if (wall.exterior && wall.side) {
      const side = wall.side;
      const line = sideLine(plan, side);
      const existing = plan.exteriorDoors.find((dd) => dd.side === side && within(line.start + dd.offset, EXTERIOR_DOOR_KINDS[dd.kind].width));
      if (existing) {
        this.store.set((d) => {
          d.plan.exteriorDoors = d.plan.exteriorDoors.filter((dd) => dd.id !== existing.id);
        });
        return;
      }
    }
    const owners = roomsOnLine(plan, wall.axis, wall.at, t);
    for (const { room, side } of owners) {
      const e = edgeLine(room, side);
      const idx = room.doors.findIndex((dd) => dd.side === side && within(e.start + dd.offset, dd.width));
      if (idx >= 0) {
        this.store.set((d) => {
          d.plan.rooms.find((r) => r.id === room.id)?.doors.splice(idx, 1);
        });
        return;
      }
    }

    if (wall.exterior && wall.side) {
      const side = wall.side;
      const line = sideLine(plan, side);
      const kind = this.exteriorKindFromChoice();
      const k = EXTERIOR_DOOR_KINDS[kind];
      const len = line.end - line.start;
      if (len < k.width) return;
      const offset = clamp(snap(t - k.width / 2, 0.5) - line.start, 0, len - k.width);
      if (this.exteriorOverlaps(plan, side, offset, k.width)) {
        this.msg('That spot overlaps another door or window.');
        return;
      }
      this.store.set((d) => {
        d.plan.exteriorDoors.push({ id: uid('door'), side, offset, kind });
      });
      return;
    }

    const owner = owners[0];
    if (!owner) return;
    const e = edgeLine(owner.room, owner.side);
    const width = this.interiorWidthFromChoice();
    const len = e.end - e.start;
    if (len < width) {
      this.msg('That wall is too short for the selected opening.');
      return;
    }
    const offset = clamp(snap(t - width / 2, 0.5) - e.start, 0, len - width);
    const side = owner.side;
    this.store.set((d) => {
      d.plan.rooms.find((r) => r.id === owner.room.id)?.doors.push({ side, offset, width });
    });
  }

  // ---------------------------------------------------------------- drawing

  render(): void {
    const plan = this.store.get().plan;
    const { cssW, cssH } = this.layout(plan);
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const c = this.ctx;
    const s = this.scale;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);
    c.fillStyle = '#f4efe4';
    c.fillRect(0, 0, cssW, cssH);

    // Porches
    for (const p of porchRects(plan)) {
      c.fillStyle = '#e6ddc7';
      c.fillRect(this.sx(p.x), this.sz(p.z), p.w * s, p.d * s);
      c.strokeStyle = '#b8ab8f';
      c.lineWidth = 1;
      c.setLineDash([4, 3]);
      c.strokeRect(this.sx(p.x), this.sz(p.z), p.w * s, p.d * s);
      c.setLineDash([]);
      c.fillStyle = '#8a7d63';
      c.font = '10px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('porch', this.sx(p.x + p.w / 2), this.sz(p.z + p.d / 2));
    }

    // Footprint and grid
    c.fillStyle = '#fcfaf5';
    c.fillRect(this.sx(0), this.sz(0), plan.width * s, plan.depth * s);
    c.lineWidth = 1;
    for (let x = 0; x <= plan.width; x++) {
      c.strokeStyle = x % 5 === 0 ? 'rgba(0,0,0,0.11)' : 'rgba(0,0,0,0.05)';
      c.beginPath();
      c.moveTo(this.sx(x) + 0.5, this.sz(0));
      c.lineTo(this.sx(x) + 0.5, this.sz(plan.depth));
      c.stroke();
    }
    for (let z = 0; z <= plan.depth; z++) {
      c.strokeStyle = z % 5 === 0 ? 'rgba(0,0,0,0.11)' : 'rgba(0,0,0,0.05)';
      c.beginPath();
      c.moveTo(this.sx(0), this.sz(z) + 0.5);
      c.lineTo(this.sx(plan.width), this.sz(z) + 0.5);
      c.stroke();
    }

    // Rooms
    for (const r of plan.rooms) {
      const info = ROOM_TYPES[r.type];
      const selected = r.id === this.selectedId;
      const hovered = r.id === this.hoverRoomId && this.mode === 'select';
      c.fillStyle = rgba(info.color, selected ? 0.6 : hovered ? 0.5 : 0.4);
      c.fillRect(this.sx(r.x), this.sz(r.z), r.w * s, r.d * s);
      if (r.w * s > 34 && r.d * s > 22) {
        c.fillStyle = '#1f1f1f';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const cx = this.sx(r.x + r.w / 2);
        const cz = this.sz(r.z + r.d / 2);
        c.font = `600 ${s >= 5 ? 12 : 10}px system-ui, sans-serif`;
        c.fillText(fitText(c, r.name, r.w * s - 6), cx, cz - (r.d * s > 36 ? 7 : 0));
        if (r.d * s > 36) {
          c.font = `${s >= 5 ? 10 : 9}px system-ui, sans-serif`;
          c.fillStyle = '#4a4a4a';
          c.fillText(`${r.w}' × ${r.d}' · ${r.w * r.d} sf`, cx, cz + 8);
        }
      }
    }

    // Walls and openings
    this.walls = deriveWalls(plan);
    c.lineCap = 'butt';
    for (const seg of this.walls) {
      c.strokeStyle = '#262626';
      c.lineWidth = seg.exterior ? 5 : 3;
      for (const [a, b] of solidSpans(seg)) this.line(seg, a, b);
      for (const o of seg.openings) this.drawOpening(seg, o);
    }

    // Hover ghost for door / window tools
    if (this.hover && this.mode !== 'select') {
      const { wall, t } = this.hover;
      const width = this.mode === 'window' ? WINDOW_KINDS[this.windowChoice].width : wall.exterior ? EXTERIOR_DOOR_KINDS[this.exteriorKindFromChoice()].width : this.interiorWidthFromChoice();
      const valid = this.mode !== 'window' || wall.exterior;
      const a = clamp(t - width / 2, wall.start, Math.max(wall.start, wall.end - width));
      c.strokeStyle = valid ? 'rgba(224,164,88,0.9)' : 'rgba(224,108,108,0.9)';
      c.lineWidth = 7;
      this.line(wall, a, Math.min(wall.end, a + width));
    }

    // Selection outline and handles
    const sel = this.selectedRoom(plan);
    if (sel) {
      c.strokeStyle = '#e0a458';
      c.lineWidth = 2;
      c.strokeRect(this.sx(sel.x), this.sz(sel.z), sel.w * s, sel.d * s);
      if (this.mode === 'select') {
        for (const [hx, hy] of Object.values(this.handlePositions(sel))) {
          c.fillStyle = '#fff';
          c.fillRect(hx - HANDLE_PX / 2, hy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
          c.strokeStyle = '#c47f2a';
          c.lineWidth = 1.5;
          c.strokeRect(hx - HANDLE_PX / 2, hy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
        }
      }
    }

    // Compass and dimensions
    c.fillStyle = '#6b6b6b';
    c.font = '11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText(`${plan.width}'`, this.sx(plan.width / 2), this.sz(0) - 8);
    c.save();
    c.translate(this.sx(0) - 9, this.sz(plan.depth / 2));
    c.rotate(-Math.PI / 2);
    c.fillText(`${plan.depth}'`, 0, 0);
    c.restore();
    c.textAlign = 'left';
    c.fillText('N ↑', 4, 12);
  }

  private line(seg: WallSegment, a: number, b: number): void {
    const c = this.ctx;
    c.beginPath();
    if (seg.axis === 'x') {
      c.moveTo(this.sx(a), this.sz(seg.at));
      c.lineTo(this.sx(b), this.sz(seg.at));
    } else {
      c.moveTo(this.sx(seg.at), this.sz(a));
      c.lineTo(this.sx(seg.at), this.sz(b));
    }
    c.stroke();
  }

  private drawOpening(seg: WallSegment, o: Opening): void {
    const c = this.ctx;
    const w = o.end - o.start;
    if (o.kind === 'window') {
      c.strokeStyle = '#3f8ac4';
      c.lineWidth = seg.exterior ? 3 : 2;
      this.line(seg, o.start, o.end);
      return;
    }
    if (o.kind === 'overhead') {
      c.strokeStyle = '#7a7a7a';
      c.lineWidth = 3;
      c.setLineDash([5, 3]);
      this.line(seg, o.start, o.end);
      c.setLineDash([]);
      return;
    }
    if (o.kind === 'opening') return;
    // Door: leaf + swing arc into the building (or +x/+z for interior walls).
    const dir = seg.exterior && seg.side ? inwardDir(seg.side) : 1;
    const s = this.scale;
    const hx = seg.axis === 'x' ? this.sx(o.start) : this.sx(seg.at);
    const hz = seg.axis === 'x' ? this.sz(seg.at) : this.sz(o.start);
    const len = Math.min(w, 3.5) * s;
    c.strokeStyle = '#8b5a2b';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(hx, hz);
    if (seg.axis === 'x') c.lineTo(hx, hz + dir * len);
    else c.lineTo(hx + dir * len, hz);
    c.stroke();
    c.beginPath();
    if (seg.axis === 'x') c.arc(hx, hz, len, dir > 0 ? 0 : -Math.PI / 2, dir > 0 ? Math.PI / 2 : 0);
    else c.arc(hx, hz, len, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI);
    c.strokeStyle = 'rgba(139,90,43,0.6)';
    c.stroke();
  }
}

function fitText(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (c.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 2 && c.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Tool strip for the plan editor: mode buttons plus the per-tool option picker. */
export function createEditorToolbar(editor: PlanEditor): HTMLElement {
  const modes: { mode: EditorMode; label: string; title: string }[] = [
    { mode: 'select', label: 'Select', title: 'Click a room to select it, drag to move, drag the handles to resize' },
    { mode: 'door', label: 'Door', title: 'Click a wall to add a door or opening; click an existing door to remove it' },
    { mode: 'window', label: 'Window', title: 'Click an exterior wall to add a window; click a window to remove it' },
    { mode: 'room', label: 'Add room', title: 'Click inside the footprint to place a room of the chosen type' },
  ];
  const buttons = new Map<EditorMode, HTMLButtonElement>();
  const seg = el('div', { class: 'segmented' });
  for (const m of modes) {
    const b = button(m.label, () => editor.setMode(m.mode), { title: m.title });
    buttons.set(m.mode, b);
    seg.append(b);
  }

  const doorChoices = [
    ...INTERIOR_DOOR_WIDTHS.map((w) => ({ value: `i:${w.value}`, label: w.label })),
    ...(Object.entries(EXTERIOR_DOOR_KINDS) as [ExteriorDoorKind, { label: string }][]).map(([k, v]) => ({ value: `e:${k}`, label: `${v.label} (exterior)` })),
  ];
  const doorSel = selectInput(doorChoices, editor.doorChoice, (v) => {
    editor.doorChoice = v;
  });
  const windowSel = selectInput(
    (Object.entries(WINDOW_KINDS) as [WindowKind, { label: string }][]).map(([k, v]) => ({ value: k, label: v.label })),
    editor.windowChoice,
    (v) => {
      editor.windowChoice = v as WindowKind;
    },
  );
  const roomSel = selectInput(
    ROOM_TYPE_LIST.map((t) => ({ value: t, label: ROOM_TYPES[t].label })),
    editor.roomChoice,
    (v) => {
      editor.roomChoice = v as RoomType;
    },
  );
  const addBtn = button('+ Auto-place', () => editor.addRoom(), { class: 'primary', title: 'Add the room in the first free spot' });
  const hint = el('div', { class: 'hint tool-hint' });
  const options = el('div', { class: 'tool-options' }, [doorSel, windowSel, roomSel, addBtn]);

  const refresh = (): void => {
    for (const [mode, b] of buttons) b.classList.toggle('active', editor.mode === mode);
    doorSel.hidden = editor.mode !== 'door';
    windowSel.hidden = editor.mode !== 'window';
    roomSel.hidden = editor.mode !== 'room';
    addBtn.hidden = editor.mode !== 'room';
    hint.textContent = modes.find((m) => m.mode === editor.mode)?.title ?? '';
  };
  editor.onModeChange = refresh;
  refresh();
  return el('div', { class: 'editor-toolbar' }, [seg, options, hint]);
}
