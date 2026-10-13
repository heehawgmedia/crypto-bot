import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { roomAt, spawnPoint } from '../model/geometry';
import type { Plan, Project, Room } from '../model/types';
import { buildBuilding, disposeBuilding, type BuildResult } from './builder';
import { WalkControls } from './walk';

export type ViewMode = 'orbit' | 'walk';

export interface Whereabouts {
  room?: Room;
  where: 'room' | 'open' | 'outside';
}

/** Owns the Three.js scene: lighting, ground, cameras, orbit + walk controls and the current building. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly orbitCam: THREE.PerspectiveCamera;
  readonly walkCam: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly walk: WalkControls;
  mode: ViewMode = 'orbit';
  onRoomChange?: (info: Whereabouts) => void;

  private built?: BuildResult;
  private plan?: Plan;
  private sun: THREE.DirectionalLight;
  private clock = new THREE.Clock();
  private roofVisible = true;
  private labelsVisible = true;
  private lastRoomKey = '';
  private framed = false;
  private walkPlaced = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'gl-canvas';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color(0xcfe0f2);
    this.scene.fog = new THREE.Fog(0xcfe0f2, 250, 900);

    this.orbitCam = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.walkCam = new THREE.PerspectiveCamera(72, 1, 0.05, 1000);
    this.orbit = new OrbitControls(this.orbitCam, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 500;
    this.walk = new WalkControls(this.walkCam, this.renderer.domElement);
    this.walk.enabled = false;

    this.scene.add(new THREE.HemisphereLight(0xe8f1fb, 0x6c7a4e, 1.1));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    // Shadow-less fill lights so interior walls facing different directions read differently.
    const fill1 = new THREE.DirectionalLight(0xfff6ea, 0.55);
    fill1.position.set(-1, 0.8, -0.6);
    const fill2 = new THREE.DirectionalLight(0xe6eeff, 0.35);
    fill2.position.set(0.7, 0.5, 1);
    this.scene.add(fill1, fill2);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x7c9a5c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(1400, 140, 0x5f7a45, 0x5f7a45);
    grid.position.y = -0.49;
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.22;
    this.scene.add(grid);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setProject(project: Project): void {
    if (this.built) {
      this.scene.remove(this.built.group);
      disposeBuilding(this.built);
    }
    this.built = buildBuilding(project);
    this.applyRoofVisibility();
    this.applyLabelVisibility();
    this.scene.add(this.built.group);
    this.walk.setColliders(this.built.colliders);

    const plan = project.plan;
    const sizeChanged = !this.plan || this.plan.width !== plan.width || this.plan.depth !== plan.depth;
    this.plan = plan;
    const cx = plan.width / 2;
    const cz = plan.depth / 2;
    const ext = Math.max(plan.width, plan.depth);
    this.sun.position.set(cx + ext * 0.8, ext * 1.1 + 40, cz - ext * 0.5);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = ext * 4 + 200;
    sc.updateProjectionMatrix();
    this.walk.setBounds(ext * 3);
    if (!this.framed || sizeChanged) this.frameBuilding();
    if (!this.walkPlaced) {
      const s = spawnPoint(plan);
      this.walk.teleport(s.x, s.z, 0);
      this.walkPlaced = true;
    }
    this.lastRoomKey = '';
  }

  frameBuilding(): void {
    if (!this.plan) return;
    const { width: W, depth: D } = this.plan;
    const ext = Math.max(W, D);
    this.orbit.target.set(W / 2, 4, D / 2);
    this.orbitCam.position.set(W / 2 + ext * 0.85, ext * 0.7 + 12, D / 2 + ext * 1.05);
    this.orbit.update();
    this.framed = true;
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.walk.enabled = mode === 'walk';
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') this.walk.unlock();
    this.applyRoofVisibility();
    this.applyLabelVisibility();
    this.lastRoomKey = '';
  }

  setRoofVisible(v: boolean): void {
    this.roofVisible = v;
    this.applyRoofVisibility();
  }

  setLabelsVisible(v: boolean): void {
    this.labelsVisible = v;
    this.applyLabelVisibility();
  }

  private applyLabelVisibility(): void {
    // Labels float through walls, so they only make sense from the overview; the HUD names the room while walking.
    if (this.built) this.built.labels.visible = this.labelsVisible && this.mode === 'orbit';
  }

  /** Put the walker in the middle of a room, facing north, and switch to walk mode. */
  teleportToRoom(room: Room): void {
    this.walk.teleport(room.x + room.w / 2, room.z + room.d / 2, 0);
    this.walkPlaced = true;
    this.setMode('walk');
  }

  respawn(): void {
    if (!this.plan) return;
    const s = spawnPoint(this.plan);
    this.walk.teleport(s.x, s.z, 0);
  }

  private applyRoofVisibility(): void {
    // Inside the house the roof and ceilings always render; the dollhouse toggle only applies to the overview.
    if (this.built) this.built.roof.visible = this.mode === 'walk' || this.roofVisible;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    for (const cam of [this.orbitCam, this.walkCam]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.mode === 'walk') {
      this.walk.update(dt);
      this.detectRoom();
    } else this.orbit.update();
    const cam = this.mode === 'walk' ? this.walkCam : this.orbitCam;
    this.renderer.render(this.scene, cam);
    this.labelRenderer.render(this.scene, cam);
  }

  private detectRoom(): void {
    if (!this.plan) return;
    const { x, z } = this.walk.position;
    const room = roomAt(this.plan, x, z);
    const inside = x >= 0 && x <= this.plan.width && z >= 0 && z <= this.plan.depth;
    const key = room ? room.id : inside ? 'open' : 'outside';
    if (key === this.lastRoomKey) return;
    this.lastRoomKey = key;
    this.onRoomChange?.({ room, where: room ? 'room' : inside ? 'open' : 'outside' });
  }
}
