import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  deriveWalls,
  EXT_WALL_T,
  footprintRect,
  INT_WALL_T,
  inwardDir,
  isShopRoom,
  isWetRoom,
  porchRects,
  rectMinus,
  roofMetrics,
  solidSpans,
  type Opening,
  type PorchRect,
  type WallSegment,
} from '../model/geometry';
import type { BuildOptions, Plan, Project, Side } from '../model/types';
import type { Collider } from './walk';

export interface BuildResult {
  group: THREE.Group;
  /** Roof, gables and ceilings: hidden for the dollhouse view. */
  roof: THREE.Group;
  labels: THREE.Group;
  colliders: Collider[];
}

const EXTERIOR_COLORS: Record<BuildOptions['exterior'], number> = {
  'metal-panel': 0xb9b3a8,
  'board-batten': 0xd9cdb2,
  'stone-wainscot': 0xb9b3a8,
  brick: 0x9e5a3c,
};
const ROOF_COLORS: Record<BuildOptions['roofing'], number> = {
  'metal-rpanel': 0x7d848a,
  'standing-seam': 0x394654,
  shingle: 0x5b4c42,
};
const FLOOR_COLORS: Record<BuildOptions['flooring'], number> = {
  'polished-concrete': 0xa9a49c,
  lvp: 0xb08a5c,
  tile: 0xd2ccc0,
  hardwood: 0x9a6a3e,
  carpet: 0xb5ac9f,
};

type Vec = [number, number, number];

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
}

interface Mats {
  exterior: THREE.Material;
  interior: THREE.Material;
  /** Six-face material arrays for exterior walls, keyed by which side of the building the wall is on. */
  extFaces: Record<Side, THREE.Material[]>;
  roof: THREE.Material;
  gable: THREE.Material;
  floor: THREE.Material;
  floorTile: THREE.Material;
  floorConcrete: THREE.Material;
  slab: THREE.Material;
  ceiling: THREE.Material;
  glass: THREE.Material;
  door: THREE.Material;
  overhead: THREE.Material;
  post: THREE.Material;
  stone: THREE.Material;
  all: THREE.Material[];
}

function makeMaterials(o: BuildOptions): Mats {
  const exterior = std(EXTERIOR_COLORS[o.exterior], { metalness: o.exterior === 'metal-panel' || o.exterior === 'stone-wainscot' ? 0.25 : 0, roughness: 0.7 });
  const interior = std(0xf2ede3);
  const metalRoof = o.roofing !== 'shingle';
  const roof = std(ROOF_COLORS[o.roofing], { side: THREE.DoubleSide, metalness: metalRoof ? 0.35 : 0, roughness: metalRoof ? 0.55 : 0.95 });
  const gable = std(EXTERIOR_COLORS[o.exterior], { side: THREE.DoubleSide, roughness: 0.7 });
  const floor = std(FLOOR_COLORS[o.flooring], { roughness: o.flooring === 'polished-concrete' ? 0.35 : 0.8 });
  const floorTile = std(FLOOR_COLORS.tile, { roughness: 0.5 });
  const floorConcrete = std(0x9b9b98, { roughness: 0.6 });
  const slab = std(0x8f8f8c);
  const ceiling = std(0xf6f3ec, { side: THREE.FrontSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc9e8, transparent: true, opacity: 0.4, roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const door = std(0x6b4a2e, { roughness: 0.6 });
  const overhead = std(0xdadad6, { metalness: 0.3, roughness: 0.5 });
  const post = std(0x8a7556);
  const stone = std(0x8c8478, { roughness: 1 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Outward face of each exterior wall gets the exterior material.
  const faces = (outward: number): THREE.Material[] => {
    const arr = [interior, interior, exterior, interior, interior, interior];
    arr[outward] = exterior;
    return arr;
  };
  return {
    exterior,
    interior,
    extFaces: { N: faces(5), S: faces(4), W: faces(1), E: faces(0) },
    roof,
    gable,
    floor,
    floorTile,
    floorConcrete,
    slab,
    ceiling,
    glass,
    door,
    overhead,
    post,
    stone,
    all: [exterior, interior, roof, gable, floor, floorTile, floorConcrete, slab, ceiling, glass, door, overhead, post, stone],
  };
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A box filling the wall between `a` and `b` along the wall, from `bottom` to `top`. */
function wallBox(seg: WallSegment, a: number, b: number, bottom: number, top: number, t: number, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const len = b - a;
  const h = top - bottom;
  const mid = (a + b) / 2;
  const y = bottom + h / 2;
  return seg.axis === 'x' ? box(len, h, t, mid, y, seg.at, mat) : box(t, h, len, seg.at, y, mid, mat);
}

function colliderFor(seg: WallSegment, a: number, b: number, t: number): Collider {
  const half = t / 2;
  return seg.axis === 'x' ? { minX: a, maxX: b, minZ: seg.at - half, maxZ: seg.at + half } : { minX: seg.at - half, maxX: seg.at + half, minZ: a, maxZ: b };
}

function plane(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = true;
  return m;
}

function pane(group: THREE.Group, seg: WallSegment, o: Opening, mat: THREE.Material): void {
  const w = Math.max(0.2, o.end - o.start - 0.1);
  const h = Math.max(0.2, o.top - o.bottom - 0.1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const y = (o.top + o.bottom) / 2;
  if (seg.axis === 'x') m.position.set((o.start + o.end) / 2, y, seg.at);
  else {
    m.position.set(seg.at, y, (o.start + o.end) / 2);
    m.rotation.y = Math.PI / 2;
  }
  group.add(m);
}

function addOpeningDetail(group: THREE.Group, colliders: Collider[], seg: WallSegment, o: Opening, t: number, mats: Mats): void {
  const w = o.end - o.start;
  const h = o.top - o.bottom;
  const dir = seg.exterior && seg.side ? inwardDir(seg.side) : 1;
  if (o.kind === 'window') {
    pane(group, seg, o, mats.glass);
    return;
  }
  if (o.kind === 'overhead') {
    // Overhead doors render closed (and block walking); use the walk-in door to enter the shop.
    group.add(wallBox(seg, o.start + 0.05, o.end - 0.05, 0.05, o.top - 0.05, 0.15, mats.overhead));
    colliders.push(colliderFor(seg, o.start, o.end, 0.3));
    return;
  }
  if (o.kind === 'door' && w > 3.6) {
    // French / sliding patio door: glass.
    pane(group, seg, o, mats.glass);
    return;
  }
  if (o.kind === 'door') {
    // Swung-open leaf hinged at the start of the opening.
    const leafW = Math.max(0.5, w - 0.15);
    const leafH = Math.max(0.5, h - 0.1);
    if (seg.axis === 'x') group.add(box(0.12, leafH, leafW, o.start + 0.1, leafH / 2, seg.at + dir * (t / 2 + leafW / 2), mats.door));
    else group.add(box(leafW, leafH, 0.12, seg.at + dir * (t / 2 + leafW / 2), leafH / 2, o.start + 0.1, mats.door));
  }
}

function pushQuad(v: number[], a: Vec, b: Vec, c: Vec, d: Vec): void {
  v.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function pushTri(v: number[], a: Vec, b: Vec, c: Vec): void {
  v.push(...a, ...b, ...c);
}

function meshFromTriangles(v: number[], mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildRoof(plan: Plan, roof: THREE.Group, mats: Mats): void {
  const m = roofMetrics(plan);
  const o = m.overhang;
  const H = plan.wallHeight;
  const { width: W, depth: D } = plan;
  const eH = m.eaveHeight;
  const rH = m.ridgeHeight;
  const slopes: number[] = [];
  const gables: number[] = [];
  if (plan.ridgeAxis === 'z') {
    pushQuad(slopes, [-o, eH, -o], [-o, eH, D + o], [W / 2, rH, D + o], [W / 2, rH, -o]);
    pushQuad(slopes, [W + o, eH, -o], [W / 2, rH, -o], [W / 2, rH, D + o], [W + o, eH, D + o]);
    pushTri(gables, [0, H, 0], [W, H, 0], [W / 2, rH, 0]);
    pushTri(gables, [0, H, D], [W / 2, rH, D], [W, H, D]);
    roof.add(box(0.8, 0.25, D + 2 * o, W / 2, rH + 0.05, D / 2, mats.roof));
  } else {
    pushQuad(slopes, [-o, eH, -o], [W + o, eH, -o], [W + o, rH, D / 2], [-o, rH, D / 2]);
    pushQuad(slopes, [-o, eH, D + o], [-o, rH, D / 2], [W + o, rH, D / 2], [W + o, eH, D + o]);
    pushTri(gables, [0, H, 0], [0, H, D], [0, rH, D / 2]);
    pushTri(gables, [W, H, 0], [W, rH, D / 2], [W, H, D]);
    roof.add(box(W + 2 * o, 0.25, 0.8, W / 2, rH + 0.05, D / 2, mats.roof));
  }
  roof.add(meshFromTriangles(slopes, mats.roof));
  roof.add(meshFromTriangles(gables, mats.gable));
}

function buildPorch(plan: Plan, p: PorchRect, group: THREE.Group, mats: Mats): void {
  const H = plan.wallHeight;
  const { width: W, depth: D } = plan;
  const attach = Math.min(H - 1, 10);
  const depth = p.side === 'N' || p.side === 'S' ? p.d : p.w;
  const outer = Math.max(attach - depth * 0.25, 7.5);
  const ov = 1;
  group.add(box(p.w, 0.5, p.d, p.x + p.w / 2, -0.25, p.z + p.d / 2, mats.slab, false));

  const v: number[] = [];
  const posts: [number, number][] = [];
  const along = (from: number, to: number, fixed: number, horizontal: boolean): void => {
    const len = to - from;
    const n = Math.max(2, Math.ceil(len / 8) + 1);
    for (let i = 0; i < n; i++) {
      const s = from + (len * i) / (n - 1);
      posts.push(horizontal ? [s, fixed] : [fixed, s]);
    }
  };
  switch (p.side) {
    case 'N':
      pushQuad(v, [p.x - ov, attach, 0], [p.x + p.w + ov, attach, 0], [p.x + p.w + ov, outer, p.z - ov], [p.x - ov, outer, p.z - ov]);
      along(p.x + 0.5, p.x + p.w - 0.5, p.z + 0.5, true);
      break;
    case 'S':
      pushQuad(v, [p.x - ov, attach, D], [p.x - ov, outer, D + p.d + ov], [p.x + p.w + ov, outer, D + p.d + ov], [p.x + p.w + ov, attach, D]);
      along(p.x + 0.5, p.x + p.w - 0.5, p.z + p.d - 0.5, true);
      break;
    case 'W':
      pushQuad(v, [0, attach, p.z - ov], [0, attach, p.z + p.d + ov], [p.x - ov, outer, p.z + p.d + ov], [p.x - ov, outer, p.z - ov]);
      along(p.z + 0.5, p.z + p.d - 0.5, p.x + 0.5, false);
      break;
    case 'E':
      pushQuad(v, [W, attach, p.z - ov], [W + p.w + ov, outer, p.z - ov], [W + p.w + ov, outer, p.z + p.d + ov], [W, attach, p.z + p.d + ov]);
      along(p.z + 0.5, p.z + p.d - 0.5, p.x + p.w - 0.5, false);
      break;
  }
  group.add(meshFromTriangles(v, mats.roof));
  for (const [x, z] of posts) group.add(box(0.5, outer, 0.5, x, outer / 2, z, mats.post));
}

export function buildBuilding(project: Project): BuildResult {
  const { plan, options } = project;
  const mats = makeMaterials(options);
  const group = new THREE.Group();
  const roof = new THREE.Group();
  const labels = new THREE.Group();
  const colliders: Collider[] = [];
  const H = plan.wallHeight;
  const { width: W, depth: D } = plan;

  // Slab and the open-area floor.
  group.add(box(W + EXT_WALL_T, 0.5, D + EXT_WALL_T, W / 2, -0.25, D / 2, mats.slab, false));
  const floor = plane(W, D, mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0.01, D / 2);
  group.add(floor);

  // Room floors and labels.
  for (const r of plan.rooms) {
    const mat = isShopRoom(r) ? mats.floorConcrete : isWetRoom(r) ? mats.floorTile : mats.floor;
    const f = plane(r.w, r.d, mat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(r.x + r.w / 2, 0.02, r.z + r.d / 2);
    group.add(f);

    const div = document.createElement('div');
    div.className = 'room-label';
    div.textContent = r.name;
    const label = new CSS2DObject(div);
    label.position.set(r.x + r.w / 2, 1.5, r.z + r.d / 2);
    labels.add(label);
  }

  // Walls.
  for (const seg of deriveWalls(plan)) {
    const t = seg.exterior ? EXT_WALL_T : INT_WALL_T;
    // Extend exterior walls by half a thickness so the corners close.
    const s = seg.exterior ? { ...seg, start: seg.start - t / 2, end: seg.end + t / 2 } : seg;
    const mat = seg.exterior && seg.side ? mats.extFaces[seg.side] : mats.interior;
    for (const [a, b] of solidSpans(s)) {
      group.add(wallBox(s, a, b, 0, H, t, mat));
      colliders.push(colliderFor(s, a, b, t));
    }
    for (const o of seg.openings) {
      if (o.top < H - 0.01) group.add(wallBox(seg, o.start, o.end, o.top, H, t, mat));
      if (o.bottom > 0.01) {
        group.add(wallBox(seg, o.start, o.end, 0, o.bottom, t, mat));
        colliders.push(colliderFor(seg, o.start, o.end, t));
      }
      addOpeningDetail(group, colliders, seg, o, t, mats);
    }
    if (seg.exterior && options.exterior === 'stone-wainscot') {
      const bandSeg = { ...s, openings: s.openings.filter((o) => o.kind !== 'window') };
      for (const [a, b] of solidSpans(bandSeg)) group.add(wallBox(s, a, b, 0, 3, t + 0.25, mats.stone));
    }
  }

  // Ceilings over everything except shop / garage space (open to the rafters).
  const shopRects = plan.rooms.filter(isShopRoom);
  for (const c of rectMinus(footprintRect(plan), shopRects)) {
    const m = plane(c.w, c.d, mats.ceiling);
    m.rotation.x = Math.PI / 2;
    m.position.set(c.x + c.w / 2, H - 0.02, c.z + c.d / 2);
    roof.add(m);
  }

  buildRoof(plan, roof, mats);
  for (const p of porchRects(plan)) buildPorch(plan, p, group, mats);

  group.add(roof);
  group.add(labels);
  group.userData.materials = mats.all;
  return { group, roof, labels, colliders };
}

export function disposeBuilding(result: BuildResult): void {
  // CSS2DObject only removes its DOM element when it is removed directly, so detach labels one by one.
  for (const label of [...result.labels.children]) {
    result.labels.remove(label);
    if (label instanceof CSS2DObject) label.element.remove();
  }
  result.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
  const mats = result.group.userData.materials as THREE.Material[] | undefined;
  for (const m of mats ?? []) m.dispose();
}
