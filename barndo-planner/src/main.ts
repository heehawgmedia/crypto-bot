import './styles.css';
import { makeProject, PRESETS } from './model/presets';
import { Store, validateProject } from './model/store';
import type { Project, Room } from './model/types';
import { Viewer } from './three/viewer';
import { createBuildingPanel } from './ui/buildingPanel';
import { createCostPanel } from './ui/costPanel';
import { button, checkboxInput, el, isTypingTarget, selectInput } from './ui/dom';
import { fmtMoney } from './ui/format';
import { createOpeningsPanel } from './ui/openingsPanel';
import { createOptionsPanel } from './ui/optionsPanel';
import { createEditorToolbar, PlanEditor } from './ui/planEditor';
import { createRoomList, createRoomPanel } from './ui/roomPanel';

const store = new Store(Store.load() ?? makeProject('classic'));
const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

// ------------------------------------------------------------------ toast
const toast = el('div', { class: 'toast', hidden: true });
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string): void {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3500);
}

// ------------------------------------------------------------------ 3D viewport
const viewport = el('section', { class: 'viewport' });
const glHost = el('div', { class: 'gl-host' });
viewport.append(glHost);

function createViewer(): Viewer {
  try {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('WebGL is not available');
    return new Viewer(glHost);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    glHost.replaceChildren(
      el('div', { class: 'gl-fallback' }, [
        el('strong', { text: '3D view unavailable' }),
        el('span', { text: `Your browser could not start WebGL (${msg}). The floor plan editor and cost estimate still work. Try Chrome, Edge or Firefox with hardware acceleration enabled.` }),
      ]),
    );
    throw err;
  }
}
const viewer = createViewer();

const hudRoom = el('div', { class: 'hud-room', text: '' });
const hudHint = el('div', { class: 'hud-hint', text: 'Drag to orbit · scroll to zoom · right-drag to pan' });
const hud = el('div', { class: 'hud' }, [hudRoom, hudHint]);

const lockOverlay = el('div', { class: 'lock-overlay', hidden: true }, [
  el('div', { class: 'lock-card' }, [
    el('strong', { text: 'Click to walk around' }),
    el('span', { text: 'W A S D / arrows to move · mouse to look · Shift to run · Esc to release the mouse' }),
  ]),
]);
lockOverlay.addEventListener('click', () => viewer.walk.lock());

const touchPad = el('div', { class: 'touchpad', hidden: true });
const padBtn = (label: string, f: number, r: number, cls: string): HTMLButtonElement => {
  const b = el('button', { type: 'button', class: `pad ${cls}`, text: label });
  const press = (e: Event): void => {
    e.preventDefault();
    viewer.walk.touchMove = { forward: f, right: r };
  };
  const release = (): void => {
    viewer.walk.touchMove = { forward: 0, right: 0 };
  };
  b.addEventListener('pointerdown', press);
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('pointerleave', release);
  return b;
};
touchPad.append(padBtn('▲', 1, 0, 'up'), padBtn('◀', 0, -1, 'left'), padBtn('▼', -1, 0, 'down'), padBtn('▶', 0, 1, 'right'));

const modeOrbit = button('Overview', () => setViewMode('orbit'), { class: 'active' });
const modeWalk = button('Walk through', () => setViewMode('walk'));
const roofToggle = checkboxInput(true, (v) => viewer.setRoofVisible(v));
const labelsToggle = checkboxInput(true, (v) => viewer.setLabelsVisible(v));
const gotoSelect = selectInput([{ value: '', label: 'Go to room…' }], '', (v) => {
  const room = store.get().plan.rooms.find((r) => r.id === v);
  if (room) walkTo(room);
  gotoSelect.value = '';
});
const resetView = button('⟲ Reset view', () => {
  if (viewer.mode === 'walk') viewer.respawn();
  else viewer.frameBuilding();
});
const viewControls = el('div', { class: 'view-controls' }, [
  el('div', { class: 'segmented' }, [modeOrbit, modeWalk]),
  el('label', { class: 'check small', title: 'Hide the roof and ceilings to look inside from above' }, [roofToggle, el('span', { text: 'Roof' })]),
  el('label', { class: 'check small' }, [labelsToggle, el('span', { text: 'Labels' })]),
  gotoSelect,
  resetView,
]);
viewport.append(viewControls, hud, lockOverlay, touchPad, toast);

const hasPointerLock = 'requestPointerLock' in HTMLElement.prototype;
const isTouch = matchMedia('(pointer: coarse)').matches;
const canLock = (): boolean => hasPointerLock && viewer.walk.lockSupported && !isTouch;
const DRAG_HINT = 'Drag to look around · W A S D / arrows to move · Shift to run';

function setViewMode(mode: 'orbit' | 'walk'): void {
  viewer.setMode(mode);
  modeOrbit.classList.toggle('active', mode === 'orbit');
  modeWalk.classList.toggle('active', mode === 'walk');
  const walking = mode === 'walk';
  lockOverlay.hidden = !walking || !canLock() || viewer.walk.locked;
  touchPad.hidden = !walking || !isTouch;
  hudHint.textContent = walking
    ? isTouch
      ? 'Drag to look around · use the arrows to move'
      : canLock()
        ? 'W A S D to move · mouse to look · Shift to run · Esc to release the mouse'
        : DRAG_HINT
    : 'Drag to orbit · scroll to zoom · right-drag to pan · uncheck Roof to look inside';
  if (!walking) hudRoom.textContent = '';
}

viewer.walk.onLockChange = (locked) => {
  if (viewer.mode !== 'walk') return;
  lockOverlay.hidden = locked || !canLock();
  if (!canLock() && !isTouch) hudHint.textContent = DRAG_HINT;
};
viewer.onRoomChange = ({ room, where }) => {
  hudRoom.textContent = where === 'room' && room ? `${room.name} · ${room.w}' × ${room.d}' · ${room.w * room.d} sf` : where === 'open' ? 'Open living area' : 'Outside';
};

function walkTo(room: Room): void {
  viewer.teleportToRoom(room);
  setViewMode('walk');
  if (canLock()) viewer.walk.lock();
}

// ------------------------------------------------------------------ left column: plan editor
const planCanvas = el('canvas', { class: 'plan-canvas', tabindex: '0' });
const editor = new PlanEditor(planCanvas, store);
editor.onMessage = showToast;
const toolbar = createEditorToolbar(editor);
const roomList = createRoomList(store, editor);
const buildingPanel = createBuildingPanel(store);
const roomPanel = createRoomPanel(store, editor, { onWalkTo: walkTo, onMessage: showToast });
const openingsPanel = createOpeningsPanel(store, showToast);

const left = el('aside', { class: 'sidebar left' }, [
  el('details', { class: 'section', open: true }, [
    el('summary', { text: 'Floor plan' }),
    el('div', { class: 'section-body' }, [toolbar, el('div', { class: 'plan-wrap' }, [planCanvas]), roomList.el]),
  ]),
  roomPanel.el,
  buildingPanel.el,
  openingsPanel.el,
]);

// ------------------------------------------------------------------ right column: options & cost
const optionsPanel = createOptionsPanel(store);
const costPanel = createCostPanel();
const right = el('aside', { class: 'sidebar right' }, [costPanel.el, el('h2', { text: 'Build options' }), optionsPanel.el]);

// ------------------------------------------------------------------ header
const headerTotal = el('span', { class: 'header-total' });
const headerSub = el('span', { class: 'header-sub' });
const presetSelect = selectInput([{ value: '', label: 'Load a preset…' }, ...PRESETS.map((p) => ({ value: p.id, label: p.label }))], '', (v) => {
  if (!v) return;
  if (store.get().plan.rooms.length && !confirm('Replace the current plan with this preset? (Undo is available.)')) {
    presetSelect.value = '';
    return;
  }
  store.replace({ ...makeProject(v), options: store.get().options });
  editor.select(undefined);
  presetSelect.value = '';
});
const undoBtn = button('↶ Undo', () => store.undo(), { title: 'Ctrl+Z' });
const redoBtn = button('↷ Redo', () => store.redo(), { title: 'Ctrl+Shift+Z' });
const exportBtn = button('⬇ Export', () => {
  const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${store.get().plan.name.replace(/[^\w-]+/g, '_') || 'barndo'}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}, { title: 'Download the plan as JSON' });
const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const project = validateProject(JSON.parse(await f.text()));
    if (!project) throw new Error('not a Barndo Planner file');
    store.replace(project);
    editor.select(undefined);
    showToast(`Loaded ${project.plan.name}`);
  } catch (err) {
    showToast(`Could not import: ${(err as Error).message}`);
  }
});
const importBtn = button('⬆ Import', () => fileInput.click(), { title: 'Load a plan JSON file' });
const resetBtn = button('Reset', () => {
  if (!confirm('Reset to the default plan and options? This clears your saved work.')) return;
  Store.clearSaved();
  store.replace(makeProject('classic'));
  editor.select(undefined);
}, { class: 'danger', title: 'Start over' });

const header = el('header', { class: 'topbar' }, [
  el('div', { class: 'brand' }, [el('span', { class: 'brand-icon', text: '🏠' }), el('span', { text: 'Barndo Planner' })]),
  el('div', { class: 'toolbar' }, [presetSelect, undoBtn, redoBtn, exportBtn, importBtn, fileInput, resetBtn]),
  el('div', { class: 'header-cost' }, [headerTotal, headerSub]),
]);

app.append(header, el('main', { class: 'layout' }, [left, viewport, right]));

// ------------------------------------------------------------------ wiring
let rafPending = false;
function refresh(project: Project): void {
  editor.render();
  roomList.update(project);
  roomPanel.update(project);
  buildingPanel.update(project);
  openingsPanel.update(project);
  optionsPanel.update(project);
  const est = costPanel.update(project);
  headerTotal.textContent = fmtMoney(est.total);
  headerSub.textContent = `${fmtMoney(est.metrics.costPerSf)}/sf · ${est.metrics.footprintSf.toLocaleString()} sf`;
  undoBtn.disabled = !store.canUndo();
  redoBtn.disabled = !store.canRedo();
  const current = gotoSelect.value;
  gotoSelect.replaceChildren(el('option', { value: '', text: 'Go to room…' }), ...project.plan.rooms.map((r) => el('option', { value: r.id, text: r.name })));
  gotoSelect.value = current && project.plan.rooms.some((r) => r.id === current) ? current : '';
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      viewer.setProject(store.get());
    });
  }
}
store.subscribe(refresh);
editor.onSelect = () => {
  const p = store.get();
  roomPanel.update(p);
  roomList.update(p);
};
refresh(store.get());
setViewMode('orbit');

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  }
});

// Handy for debugging and browser automation: window.__barndo.store.get()
declare global {
  interface Window {
    __barndo?: { store: Store; editor: PlanEditor; viewer: Viewer };
  }
}
window.__barndo = { store, editor, viewer };
