// The editor's 3D view: the map's objects, the grid, camera controls and the transform gizmo. Driven by the store
// (sync) and reporting edits back to it.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GRASS_ASSET, STAIRS_ASSET, TERRAIN_ASSET, cellRect, defaultGrass, defaultStairs, defaultTerrain, grassRect, type MapDocument, type MapGrid, type MapObject } from '@shared/types';
import { buildTerrain, stairsDir, stairsSize, type Surface, type TerrainShape } from '@shared/terrain';
import { getTemplate, getTexture, placeholder } from './models';
import type { SnapSettings, Tool } from '../store';

const DEG = Math.PI / 180;

export interface SceneCallbacks {
  select(ids: string[], additive: boolean): void;
  beginEdit(): void;
  liveEdit(patches: { id: string; patch: Partial<MapObject> }[]): void;
  place(assetId: string, position: [number, number, number]): void;
  hoverCell(cell: [number, number] | null, world: [number, number, number] | null): void;
}

interface NodeInfo {
  node: THREE.Group;
  obj: MapObject;
  loaded: boolean;
  grassKey?: string; // what a grass zone's tufts were laid out for
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private gizmo: TransformControls;
  private root = new THREE.Group();
  private nodes = new Map<string, NodeInfo>();
  private gridGroup = new THREE.Group();
  private terrainGroup = new THREE.Group(); // raised ground, stairs and the ring around the map, as the game will draw them
  private terrainKey = '';
  private hoverQuad: THREE.Mesh;
  private ghost: THREE.Object3D | null = null;
  private ghostAsset: string | null = null;
  private selBoxes = new Map<string, THREE.BoxHelper>();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private container: HTMLElement;
  private cb: SceneCallbacks;
  private resizeObs: ResizeObserver;

  private doc: MapDocument | null = null;
  private selection: string[] = [];
  private snap: SnapSettings = { enabled: true, move: 50, rotate: 90, scale: 0.25 };
  private armed: string | null = null;
  private dragging = false;
  private dragStart = new Map<string, THREE.Vector3>();
  private downAt: { x: number; y: number } | null = null;
  private topView = false;

  constructor(container: HTMLElement, cb: SceneCallbacks) {
    this.container = container;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x8fb8de);
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6b5f4a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(0.6, 1, 0.45);
    this.scene.add(sun);

    this.persp = new THREE.PerspectiveCamera(50, 1, 5, 200000);
    this.persp.position.set(1400, 1600, 1800);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.ortho.position.set(0, 10000, 0);
    this.ortho.up.set(0, 0, -1);
    this.ortho.zoom = 0.4;
    this.camera = this.persp;

    this.controls = new OrbitControls(this.persp, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.update();

    this.gizmo = new TransformControls(this.persp, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => this.onGizmoDragging(!!e.value));
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());

    this.scene.add(this.root);
    this.scene.add(this.gridGroup);
    this.scene.add(this.terrainGroup);
    this.hoverQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.hoverQuad.visible = false;
    this.hoverQuad.renderOrder = 2;
    this.scene.add(this.hoverQuad);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', () => {
      this.hoverQuad.visible = false;
      if (this.ghost) this.ghost.visible = false;
      this.cb.hoverCell(null, null);
    });
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-lgasset')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.updateHover(e.clientX, e.clientY);
      }
    });
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('application/x-lgasset');
      if (!id) return;
      e.preventDefault();
      const p = this.placementPoint(e.clientX, e.clientY);
      if (p) this.cb.place(id, p);
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.gizmo.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---- state from the store

  sync(doc: MapDocument, selection: string[]) {
    const gridChanged = !this.doc || JSON.stringify(this.doc.grid) !== JSON.stringify(doc.grid);
    this.doc = doc;
    if (gridChanged) this.buildGrid(doc.grid);
    const ids = new Set(doc.objects.map((o) => o.id));
    for (const [id, info] of this.nodes)
      if (!ids.has(id)) {
        info.node.removeFromParent();
        this.nodes.delete(id);
      }
    for (const o of doc.objects) {
      let info = this.nodes.get(o.id);
      if (!info) {
        const node = new THREE.Group();
        node.userData.objectId = o.id;
        info = { node, obj: o, loaded: false };
        this.nodes.set(o.id, info);
        this.loadContent(info);
      }
      info.obj = o;
      if (!this.dragging || !this.selection.includes(o.id)) {
        info.node.position.set(...o.position);
        info.node.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, 'XYZ');
        info.node.scale.set(...o.scale);
      }
      info.node.name = o.name;
      if (o.asset === GRASS_ASSET) {
        info.node.rotation.set(0, 0, 0); // grass zones follow the grid's cells
        this.layoutGrass(info);
      }
    }
    // parents (after every node exists)
    for (const o of doc.objects) {
      const info = this.nodes.get(o.id)!;
      const parent = (o.parent && this.nodes.get(o.parent)?.node) || this.root;
      if (info.node.parent !== parent) parent.add(info.node);
    }
    for (const o of doc.objects) {
      const info = this.nodes.get(o.id)!;
      info.node.visible = o.visible;
    }
    this.layoutTerrain();
    this.setSelection(selection);
  }

  // the cells of a raised block or stairs object, from its node's place in the world
  private shapeOf(info: NodeInfo): TerrainShape | null {
    if (!this.doc) return null;
    const g = this.doc.grid;
    const p = info.node.getWorldPosition(new THREE.Vector3());
    if (info.obj.asset === TERRAIN_ASSET) {
      const t = info.obj.terrain ?? defaultTerrain();
      return { kind: 'terrain', ...cellRect(p.x - g.originX, p.z - g.originZ, t.w, t.d, g.cellSize), base: p.y, terrain: t };
    }
    const st = info.obj.stairs ?? defaultStairs();
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(info.node.matrixWorld);
    const dir = Math.abs(fwd.z) >= Math.abs(fwd.x) ? (fwd.z < 0 ? 0 : 2) : fwd.x > 0 ? 1 : 3;
    const sz = stairsSize(st, dir);
    return { kind: 'stairs', ...cellRect(p.x - g.originX, p.z - g.originZ, sz.w, sz.d, g.cellSize), base: p.y, stairs: st, dir };
  }

  // raised ground and stairs (shared/terrain.ts, as the export builds them), and the ring of ground around the map
  private layoutTerrain() {
    if (!this.doc) return;
    const g = this.doc.grid;
    this.root.updateMatrixWorld(true);
    const items: { info: NodeInfo; shape: TerrainShape }[] = [];
    for (const info of this.nodes.values()) {
      if (info.obj.asset !== TERRAIN_ASSET && info.obj.asset !== STAIRS_ASSET) continue;
      if (!this.isVisibleChain(info.node)) continue;
      const shape = this.shapeOf(info);
      if (shape) items.push({ info, shape });
    }
    const key = JSON.stringify([g, this.doc.border ?? null, items.map((i) => i.shape)]);
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    for (const c of [...this.terrainGroup.children]) {
      c.removeFromParent();
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    const t = buildTerrain({ width: g.width, depth: g.depth, cell: g.cellSize }, items.map((i) => i.shape));
    const byTex = new Map<string, Surface[]>();
    const put = (tex: string, q: Surface) => {
      let l = byTex.get(tex);
      if (!l) byTex.set(tex, (l = []));
      l.push(q);
    };
    for (const { texture, q } of t.surfaces) put(texture, q);
    const b = this.doc.border;
    if (b?.texture && b.cells > 0) {
      const W = g.width * g.cellSize, D = g.depth * g.cellSize, r = b.cells * 100;
      for (const [x0, z0, x1, z1] of [[-r, -r, W + r, 0], [-r, D, W + r, D + r], [-r, 0, 0, D], [W, 0, W + r, D]])
        put(b.texture, { p: [[x0, -0.5, z0], [x1, -0.5, z0], [x1, -0.5, z1], [x0, -0.5, z1]], uv: [[x0 / 100, z0 / 100], [x1 / 100, z0 / 100], [x1 / 100, z1 / 100], [x0 / 100, z1 / 100]], n: [0, 1, 0] });
    }
    for (const [tex, quads] of byTex) {
      const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
      for (const q of quads) {
        const v = pos.length / 3;
        q.p.forEach((c, i) => {
          pos.push(c[0] + g.originX, c[1], c[2] + g.originZ);
          nrm.push(...q.n);
          uv.push(q.uv[i][0], q.uv[i][1]);
        });
        const e1 = [0, 1, 2].map((k) => q.p[1][k] - q.p[0][k]), e2 = [0, 1, 2].map((k) => q.p[2][k] - q.p[0][k]);
        const front = (e1[1] * e2[2] - e1[2] * e2[1]) * q.n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * q.n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * q.n[2] > 0;
        idx.push(...(front ? [v, v + 1, v + 2, v, v + 2, v + 3] : [v, v + 2, v + 1, v, v + 3, v + 2]));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: getTexture(tex) }));
      this.terrainGroup.add(mesh);
    }
    // each object: a box to pick it by (invisible) and its outline
    for (const { info, shape } of items) {
      for (const c of [...info.node.children]) c.removeFromParent();
      const p = info.node.getWorldPosition(new THREE.Vector3());
      const top = shape.terrain?.height ?? shape.stairs?.height ?? 50;
      const W = shape.w * g.cellSize, D = shape.d * g.cellSize;
      const center = new THREE.Vector3(g.originX + (shape.cx0 + shape.w / 2) * g.cellSize, p.y + top / 2, g.originZ + (shape.cz0 + shape.d / 2) * g.cellSize);
      const holder = new THREE.Group();
      holder.position.copy(info.node.worldToLocal(center.clone()));
      holder.quaternion.copy(info.node.getWorldQuaternion(new THREE.Quaternion()).invert());
      const box = new THREE.Mesh(new THREE.BoxGeometry(W, Math.max(top, 4), D), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, Math.max(top, 4), D)), new THREE.LineBasicMaterial({ color: info.obj.asset === STAIRS_ASSET ? 0xffe08a : 0xc8a06a, transparent: true, opacity: 0.6 }));
      holder.add(box, edge);
      info.node.add(holder);
      info.loaded = true;
    }
    this.refreshSelBoxes();
  }

  // a grass zone: the game's tuft on each of its cells, over a translucent patch
  private layoutGrass(info: NodeInfo) {
    if (!this.doc) return;
    const g = this.doc.grid;
    const z = info.obj.grass ?? defaultGrass();
    const p = info.node.position;
    const r = grassRect(p.x - g.originX, p.z - g.originZ, z, g.cellSize);
    const key = `${r.cx0},${r.cz0},${r.w},${r.d},${p.x},${p.z}`;
    if (info.grassKey === key) return;
    info.grassKey = key;
    for (const c of [...info.node.children]) c.removeFromParent();
    const x0 = g.originX + r.cx0 * g.cellSize - p.x;
    const z0 = g.originZ + r.cz0 * g.cellSize - p.z;
    const W = r.w * g.cellSize;
    const D = r.d * g.cellSize;
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3fa34d, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    patch.position.set(x0 + W / 2, 3, z0 + D / 2);
    patch.renderOrder = 1;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 4, D)),
      new THREE.LineBasicMaterial({ color: 0x9cff8a }),
    );
    edge.position.copy(patch.position);
    info.node.add(patch, edge);
    getTemplate('bm.enc_grass01')
      .then((t) => {
        if (info.grassKey !== key) return;
        for (let i = 0; i < r.w; i++)
          for (let k = 0; k < r.d; k++) {
            const tuft = t.clone();
            tuft.position.set(x0 + (i + 0.5) * g.cellSize, 0, z0 + (k + 0.5) * g.cellSize);
            info.node.add(tuft);
          }
        this.refreshSelBoxes();
      })
      .catch(() => {});
    info.loaded = true;
    this.refreshSelBoxes();
  }

  private loadContent(info: NodeInfo) {
    const assetId = info.obj.asset;
    if (!assetId || assetId === GRASS_ASSET || assetId === TERRAIN_ASSET || assetId === STAIRS_ASSET) return;
    getTemplate(assetId)
      .then((t) => {
        if (!this.nodes.has(info.obj.id)) return;
        info.node.add(t.clone());
        info.loaded = true;
        this.refreshSelBoxes();
      })
      .catch(() => {
        info.node.add(placeholder());
      });
  }

  private setSelection(sel: string[]) {
    this.selection = sel.filter((id) => this.nodes.has(id));
    const primary = this.selection[this.selection.length - 1];
    const info = primary ? this.nodes.get(primary) : undefined;
    if (info && !info.obj.locked) {
      if (this.gizmo.object !== info.node) this.gizmo.attach(info.node);
    } else this.gizmo.detach();
    this.refreshSelBoxes();
  }

  private refreshSelBoxes() {
    for (const [id, b] of this.selBoxes)
      if (!this.selection.includes(id)) {
        b.removeFromParent();
        b.geometry.dispose();
        this.selBoxes.delete(id);
      }
    for (const id of this.selection) {
      const info = this.nodes.get(id);
      if (!info) continue;
      let b = this.selBoxes.get(id);
      if (!b) {
        b = new THREE.BoxHelper(info.node, id === this.selection[this.selection.length - 1] ? 0xffcc33 : 0x66ccff);
        (b.material as THREE.LineBasicMaterial).depthTest = false;
        b.renderOrder = 3;
        this.scene.add(b);
        this.selBoxes.set(id, b);
      }
      b.setFromObject(info.node);
    }
  }

  setTool(t: Tool) {
    this.gizmo.setMode(t);
  }

  setSnap(s: SnapSettings) {
    this.snap = s;
    this.gizmo.setTranslationSnap(null); // snapped by hand, to cell centers
    this.gizmo.setRotationSnap(s.enabled && s.rotate ? s.rotate * DEG : null);
    this.gizmo.setScaleSnap(s.enabled && s.scale ? s.scale : null);
  }

  setGridVisible(v: boolean) {
    this.gridGroup.visible = v;
  }

  setArmed(assetId: string | null) {
    this.armed = assetId;
    if (this.ghost) {
      this.ghost.removeFromParent();
      this.ghost = null;
    }
    this.ghostAsset = assetId;
    if (!assetId) return;
    getTemplate(assetId)
      .then((t) => {
        if (this.ghostAsset !== assetId) return;
        const g = t.clone();
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = (o.material as THREE.Material).clone();
            m.transparent = true;
            m.opacity = 0.55;
            m.depthWrite = false;
            o.material = m;
          }
        });
        g.visible = false;
        this.ghost = g;
        this.scene.add(g);
      })
      .catch(() => {});
  }

  setTopView(top: boolean) {
    this.topView = top;
    const target = this.controls.target.clone();
    this.controls.object = top ? this.ortho : this.persp;
    this.camera = top ? this.ortho : this.persp;
    (this.gizmo as unknown as { camera: THREE.Camera }).camera = this.camera;
    if (top) {
      this.ortho.position.set(target.x, 10000, target.z);
      this.controls.enableRotate = false;
      this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      this.controls.screenSpacePanning = true;
    } else {
      this.controls.enableRotate = true;
      this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      this.controls.screenSpacePanning = false;
    }
    this.controls.target.copy(target);
    this.controls.update();
    this.resize();
  }

  focusSelection() {
    const box = new THREE.Box3();
    for (const id of this.selection) {
      const n = this.nodes.get(id);
      if (n) box.expandByObject(n.node);
    }
    if (box.isEmpty() && this.doc) {
      const g = this.doc.grid;
      box.set(new THREE.Vector3(g.originX, 0, g.originZ), new THREE.Vector3(g.originX + g.width * g.cellSize, 300, g.originZ + g.depth * g.cellSize));
    }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(200, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = this.persp.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(c);
    this.persp.position.copy(c).addScaledVector(dir, r * 2.2);
    this.ortho.position.set(c.x, 10000, c.z);
    this.ortho.zoom = Math.min(4, (this.container.clientHeight / (r * 2.4)) || 1);
    this.ortho.updateProjectionMatrix();
    this.controls.update();
  }

  // ---- grid

  private buildGrid(g: MapGrid) {
    for (const c of [...this.gridGroup.children]) {
      c.removeFromParent();
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    const W = g.width * g.cellSize;
    const D = g.depth * g.cellSize;
    const x0 = g.originX;
    const z0 = g.originZ;
    const minor: number[] = [];
    const major: number[] = [];
    for (let i = 0; i <= g.width; i++) {
      const x = x0 + i * g.cellSize;
      (i % 10 === 0 || i === g.width ? major : minor).push(x, 0, z0, x, 0, z0 + D);
    }
    for (let j = 0; j <= g.depth; j++) {
      const z = z0 + j * g.cellSize;
      (j % 10 === 0 || j === g.depth ? major : minor).push(x0, 0, z, x0 + W, 0, z);
    }
    const lines = (pts: number[], color: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      l.position.y = 1.5;
      l.renderOrder = 1;
      return l;
    };
    this.gridGroup.add(lines(minor, 0xffffff, 0.22), lines(major, 0xffffff, 0.55));
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3b4a3a, transparent: true, opacity: 0.85, depthWrite: true }),
    );
    floor.position.set(x0 + W / 2, -1, z0 + D / 2);
    floor.renderOrder = -1;
    floor.userData.floor = true;
    this.gridGroup.add(floor);
    // axes at the world origin
    const ax = new THREE.BufferGeometry();
    ax.setAttribute('position', new THREE.Float32BufferAttribute([0, 2, 0, 300, 2, 0, 0, 2, 0, 0, 2, 300], 3));
    ax.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.3, 0.3, 1, 0.3, 0.3, 0.3, 0.5, 1, 0.3, 0.5, 1], 3));
    this.gridGroup.add(new THREE.LineSegments(ax, new THREE.LineBasicMaterial({ vertexColors: true })));
    this.hoverQuad.scale.set(g.cellSize, 1, g.cellSize);
  }

  // ---- picking and placement

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const { node, obj } of this.nodes.values()) if (obj.visible && !obj.locked && obj.asset) out.push(node);
    return out;
  }

  private pick(x: number, y: number): { id: string | null; point: THREE.Vector3 | null; flat: boolean } {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.objectId) o = o.parent;
      if (o && this.isVisibleChain(o)) {
        const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
        return { id: o.userData.objectId as string, point: h.point, flat: !!n && Math.abs(n.y) > 0.92 };
      }
    }
    return { id: null, point: null, flat: false };
  }

  private isVisibleChain(o: THREE.Object3D) {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  private groundPoint(x: number, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  snapXZ(v: number, axis: 'x' | 'z'): number {
    if (!this.snap.enabled || !this.snap.move || !this.doc) return v;
    const g = this.doc.grid;
    const step = this.snap.move;
    // whole cells snap to cell centers; finer steps to multiples from the grid origin
    const origin = axis === 'x' ? g.originX : g.originZ;
    const off = step >= g.cellSize ? origin + g.cellSize / 2 : origin;
    return Math.round((v - off) / step) * step + off;
  }

  private snapY(v: number): number {
    if (!this.snap.enabled) return v;
    return Math.round(v / 5) * 5;
  }

  // where a new object goes: on a flat surface under the cursor (a floor, a platform), else on the ground, snapped
  private placementPoint(x: number, y: number): [number, number, number] | null {
    const hit = this.pick(x, y);
    const onTop = hit.point && hit.flat;
    const p = onTop ? hit.point : this.groundPoint(x, y);
    if (!p) return null;
    return [this.snapXZ(p.x, 'x'), onTop ? Math.max(0, this.snapY(p.y)) : 0, this.snapXZ(p.z, 'z')];
  }

  private updateHover(x: number, y: number) {
    if (!this.doc) return;
    const p = this.groundPoint(x, y);
    const g = this.doc.grid;
    if (!p) {
      this.hoverQuad.visible = false;
      return;
    }
    const cx = Math.floor((p.x - g.originX) / g.cellSize);
    const cz = Math.floor((p.z - g.originZ) / g.cellSize);
    const inside = cx >= 0 && cz >= 0 && cx < g.width && cz < g.depth;
    this.hoverQuad.visible = inside;
    this.hoverQuad.position.set(g.originX + (cx + 0.5) * g.cellSize, 2, g.originZ + (cz + 0.5) * g.cellSize);
    this.cb.hoverCell(inside ? [cx, cz] : null, [Math.round(p.x), 0, Math.round(p.z)]);
    if (this.ghost) {
      const at = this.placementPoint(x, y);
      this.ghost.visible = !!at;
      if (at) this.ghost.position.set(...at);
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 4 || this.dragging || (this.gizmo as unknown as { axis: string | null }).axis) return;
    if (this.armed) {
      const p = this.placementPoint(e.clientX, e.clientY);
      if (p) this.cb.place(this.armed, p);
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    this.cb.select(hit.id ? [hit.id] : [], e.ctrlKey || e.shiftKey);
  };

  private onPointerMove = (e: PointerEvent) => {
    this.updateHover(e.clientX, e.clientY);
  };

  // ---- gizmo edits

  private onGizmoDragging(d: boolean) {
    this.controls.enabled = !d;
    this.dragging = d;
    if (d) {
      this.cb.beginEdit();
      this.dragStart.clear();
      for (const id of this.selection) {
        const n = this.nodes.get(id);
        if (n) this.dragStart.set(id, n.node.position.clone());
      }
    }
  }

  private onGizmoChange() {
    const node = this.gizmo.object;
    if (!node) return;
    const primary = node.userData.objectId as string;
    if (this.gizmo.mode === 'translate') {
      // snap the primary to the grid, then move the rest of the selection by the same amount
      if (this.snap.enabled) {
        node.position.x = this.snapXZ(node.position.x, 'x');
        node.position.z = this.snapXZ(node.position.z, 'z');
        node.position.y = this.snapY(node.position.y);
      }
      const start = this.dragStart.get(primary);
      if (start) {
        const delta = node.position.clone().sub(start);
        for (const id of this.selection) {
          if (id === primary) continue;
          const n = this.nodes.get(id);
          const s = this.dragStart.get(id);
          if (n && s && !n.obj.locked) n.node.position.copy(s).add(delta);
        }
      }
    }
    const patches = this.selection
      .map((id) => this.nodes.get(id))
      .filter((n): n is NodeInfo => !!n)
      .map((n) => ({
        id: n.obj.id,
        patch: {
          position: n.node.position.toArray().map(r2) as [number, number, number],
          rotation: [n.node.rotation.x / DEG, n.node.rotation.y / DEG, n.node.rotation.z / DEG].map(r2) as [number, number, number],
          scale: n.node.scale.toArray().map(r4) as [number, number, number],
        },
      }));
    this.cb.liveEdit(patches);
    this.refreshSelBoxes();
  }

  // ---- frame

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.ortho.left = -w / 2;
    this.ortho.right = w / 2;
    this.ortho.top = h / 2;
    this.ortho.bottom = -h / 2;
    this.ortho.updateProjectionMatrix();
  }

  private frame() {
    this.controls.update();
    if (this.dragging) for (const [id, b] of this.selBoxes) b.setFromObject(this.nodes.get(id)!.node);
    this.renderer.render(this.scene, this.camera);
  }

  // world position of a cell's center
  cellCenter(cx: number, cz: number): [number, number, number] {
    const g = this.doc!.grid;
    return [g.originX + (cx + 0.5) * g.cellSize, 0, g.originZ + (cz + 0.5) * g.cellSize];
  }

  // the point at the middle of the view, on the ground, snapped
  viewCenter(): [number, number, number] {
    const t = this.controls.target;
    return [this.snapXZ(t.x, 'x'), 0, this.snapXZ(t.z, 'z')];
  }

  isTopView() {
    return this.topView;
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
