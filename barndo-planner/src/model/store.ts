import { SIDES, type Project } from './types';

export type Listener = (project: Project) => void;

const STORAGE_KEY = 'barndo-planner:v1';
const HISTORY_LIMIT = 100;

/** Tiny immutable-ish state container with undo/redo and localStorage persistence. */
export class Store {
  private state: Project;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(initial: Project) {
    this.state = initial;
  }

  get(): Project {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Apply a mutation to a copy of the state. Pass `record: false` for intermediate drag
   * updates after calling `checkpoint()` once at the start of the gesture.
   */
  set(mutate: (draft: Project) => void, opts: { record?: boolean } = {}): void {
    const next = structuredClone(this.state);
    mutate(next);
    if (opts.record !== false) this.pushUndo(this.state);
    this.state = next;
    this.emit();
  }

  replace(project: Project): void {
    this.pushUndo(this.state);
    this.state = structuredClone(project);
    this.emit();
  }

  /** Record the current state as an undo point (start of a drag gesture). */
  checkpoint(): void {
    this.pushUndo(this.state);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state);
    this.state = prev;
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state);
    this.state = next;
    this.emit();
  }

  private pushUndo(p: Project): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && JSON.stringify(top) === JSON.stringify(p)) return;
    this.undoStack.push(structuredClone(p));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
    if (typeof localStorage === 'undefined') return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        /* storage may be unavailable (private mode, quota) */
      }
    }, 250);
  }

  static load(): Project | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      return validateProject(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  static clearSaved(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Light structural validation for imported / persisted projects. */
export function validateProject(input: unknown): Project | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const p = input as Partial<Project>;
  if (p.version !== 1 || !p.plan || !p.options) return undefined;
  const plan = p.plan;
  if (typeof plan.width !== 'number' || typeof plan.depth !== 'number' || !Array.isArray(plan.rooms)) return undefined;
  plan.exteriorDoors ??= [];
  plan.windows ??= [];
  plan.porches ??= { N: 0, S: 0, E: 0, W: 0 };
  for (const s of SIDES) plan.porches[s] = Number(plan.porches[s]) || 0;
  for (const r of plan.rooms) r.doors ??= [];
  return p as Project;
}
