import * as THREE from 'three';
import { isTypingTarget } from '../ui/dom';

/** Axis-aligned box in plan (XZ) coordinates used for walkthrough collision. */
export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const EYE_HEIGHT = 5.5;
const WALK_SPEED = 7;
const RUN_SPEED = 13;
const RADIUS = 0.9;
const LOOK_SPEED = 0.0022;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * First-person controls: pointer-lock mouse look, WASD / arrow movement, Shift to run,
 * touch-drag look and an external `touchMove` vector for on-screen buttons.
 */
export class WalkControls {
  readonly position = new THREE.Vector3(0, EYE_HEIGHT, 0);
  yaw = 0;
  pitch = 0;
  enabled = false;
  locked = false;
  /** Set by on-screen controls: forward/right in -1..1. */
  touchMove = { forward: 0, right: 0 };
  onLockChange?: (locked: boolean) => void;

  private keys = new Set<string>();
  private colliders: Collider[] = [];
  private bounds = 300;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    camera.rotation.order = 'YXZ';
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      this.look(e.movementX, e.movementY);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTypingTarget(e.target)) return;
      if (MOVE_KEYS.has(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Touch (or mouse without pointer lock): drag to look around.
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.locked) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.locked) return;
      this.look((e.clientX - this.lastX) * 2.5, (e.clientY - this.lastY) * 2.5);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const stop = (): void => {
      this.dragging = false;
    };
    dom.addEventListener('pointerup', stop);
    dom.addEventListener('pointercancel', stop);
  }

  setColliders(colliders: Collider[]): void {
    this.colliders = colliders;
  }

  setBounds(bounds: number): void {
    this.bounds = bounds;
  }

  lock(): void {
    if (typeof this.dom.requestPointerLock === 'function') {
      try {
        const result: unknown = this.dom.requestPointerLock();
        if (result instanceof Promise) result.catch(() => undefined);
      } catch {
        /* pointer lock unsupported */
      }
    }
  }

  unlock(): void {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  teleport(x: number, z: number, yaw = 0): void {
    this.position.set(x, EYE_HEIGHT, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.apply();
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SPEED;
    this.pitch = clamp(this.pitch - dy * LOOK_SPEED, -1.25, 1.25);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    let f = 0;
    let r = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
    f += this.touchMove.forward;
    r += this.touchMove.right;
    const len = Math.hypot(f, r);
    if (len > 1e-6) {
      f /= Math.max(1, len);
      r /= Math.max(1, len);
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // camera forward is (-sin, 0, -cos), right is (cos, 0, -sin)
      const vx = (-sin * f + cos * r) * speed;
      const vz = (-cos * f - sin * r) * speed;
      this.tryMove(vx * dt, vz * dt);
    }
    this.apply();
  }

  private tryMove(dx: number, dz: number): void {
    const p = this.position;
    const stuck = this.collides(p.x, p.z);
    const nx = clamp(p.x + dx, -this.bounds, this.bounds);
    if (stuck || !this.collides(nx, p.z)) p.x = nx;
    const nz = clamp(p.z + dz, -this.bounds, this.bounds);
    if (stuck || !this.collides(p.x, nz)) p.z = nz;
  }

  private collides(x: number, z: number): boolean {
    for (const c of this.colliders) {
      const cx = clamp(x, c.minX, c.maxX);
      const cz = clamp(z, c.minZ, c.maxZ);
      const ddx = x - cx;
      const ddz = z - cz;
      if (ddx * ddx + ddz * ddz < RADIUS * RADIUS) return true;
    }
    return false;
  }

  private apply(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
