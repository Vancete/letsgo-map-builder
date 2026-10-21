import { create } from 'zustand';
import { GRASS_ASSET, SIGN_ASSET, STAIRS_ASSET, TERRAIN_ASSET, defaultGrass, defaultStairs, defaultTerrain, emptyMap, type AssetEntry, type Catalog, type MapDocument, type MapGrid, type MapObject } from '@shared/types';

export type Tool = 'translate' | 'rotate' | 'scale';

export interface SnapSettings {
  enabled: boolean;
  move: number; // game units
  rotate: number; // degrees
  scale: number;
}

interface EditorState {
  catalog: Catalog | null;
  assets: Map<string, AssetEntry>;
  thumbs: Set<string>;
  thumbVersion: number;

  doc: MapDocument;
  filePath: string | null;
  dirty: boolean;
  past: MapDocument[];
  future: MapDocument[];

  selection: string[];
  tool: Tool;
  snap: SnapSettings;
  showGrid: boolean;
  topView: boolean;
  armedAsset: string | null;
  hoverCell: [number, number] | null;
  status: string;

  setCatalog(c: Catalog | null): void;
  setThumbs(ids: Iterable<string>, bump?: boolean): void;
  addThumb(id: string): void;

  newMap(): void;
  loadMap(doc: MapDocument, path: string | null): void;
  markSaved(path: string): void;
  setMapInfo(p: Partial<Pick<MapDocument, 'name' | 'author' | 'description' | 'slotGround' | 'border'>>): void;
  fillTexture: string; // the ground texture "Rellenar" uses
  fillGround(texture: string): void;
  setGrid(g: Partial<MapGrid>): void;

  addObject(assetId: string | null, position: [number, number, number], opts?: { name?: string; parent?: string | null; rotation?: [number, number, number] }): string;
  updateObject(id: string, patch: Partial<MapObject>, history?: boolean): void;
  updateObjects(patches: { id: string; patch: Partial<MapObject> }[], history?: boolean): void;
  commit(): void; // push the state before a live edit (gizmo drag) to history
  removeSelected(): void;
  duplicateSelected(): void;
  groupSelected(): void;
  reparent(id: string, parent: string | null, before?: string | null): void;

  select(ids: string[], additive?: boolean): void;
  setTool(t: Tool): void;
  setSnap(s: Partial<SnapSettings>): void;
  toggleGrid(): void;
  toggleTopView(): void;
  arm(assetId: string | null): void;
  setHoverCell(c: [number, number] | null): void;
  setStatus(s: string): void;
  undo(): void;
  redo(): void;
}

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return `o${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const HISTORY = 200;

// descendants of id (not including it)
export function descendants(objects: MapObject[], id: string): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const o of objects) if (o.parent && frontier.includes(o.parent) && !out.has(o.id)) {
      out.add(o.id);
      next.push(o.id);
    }
    frontier = next;
  }
  return out;
}

export const useEditor = create<EditorState>((set, get) => {
  // record the current document in history, then apply a new one
  const apply = (doc: MapDocument, history = true) => {
    const s = get();
    if (history) set({ past: [...s.past.slice(-HISTORY + 1), s.doc], future: [], doc, dirty: true });
    else set({ doc, dirty: true });
  };
  const withObjects = (objects: MapObject[]): MapDocument => ({ ...get().doc, objects });

  return {
    catalog: null,
    assets: new Map(),
    thumbs: new Set(),
    thumbVersion: 0,

    doc: emptyMap(),
    filePath: null,
    dirty: false,
    past: [],
    future: [],

    selection: [],
    tool: 'translate',
    snap: { enabled: true, move: 50, rotate: 90, scale: 0.25 },
    showGrid: true,
    topView: false,
    armedAsset: null,
    hoverCell: null,
    status: '',

    setCatalog: (c) => set({ catalog: c, assets: new Map((c?.assets ?? []).map((a) => [a.id, a])) }),
    setThumbs: (ids, bump) => set((s) => ({ thumbs: new Set(ids), thumbVersion: bump ? s.thumbVersion + 1 : s.thumbVersion })),
    addThumb: (id) =>
      set((s) => {
        const t = new Set(s.thumbs);
        t.add(id);
        return { thumbs: t };
      }),

    newMap: () => set({ doc: emptyMap(), filePath: null, dirty: false, past: [], future: [], selection: [] }),
    loadMap: (doc, path) => set({ doc, filePath: path, dirty: false, past: [], future: [], selection: [] }),
    markSaved: (path) => set({ filePath: path, dirty: false }),
    setMapInfo: (p) => apply({ ...get().doc, ...p }, false),
    setGrid: (g) => apply({ ...get().doc, grid: { ...get().doc.grid, ...g } }),
    fillTexture: 'grass01_com',
    // 4 x 4 tiles of a texture wherever the grid has no ground tile yet, in a folder of their own (locked)
    fillGround: (texture) => {
      const s = get();
      const g = s.doc.grid;
      const tile = [...s.assets.values()].find((a) => a.source.kind === 'tile' && a.source.texture === texture && a.source.cells === 4);
      if (!tile) return;
      const covered = new Set<string>();
      const byId = new Map(s.doc.objects.map((o) => [o.id, o]));
      for (const o of s.doc.objects) {
        const a = o.asset ? s.assets.get(o.asset) : undefined;
        if (a?.source.kind !== 'tile') continue;
        // (tiles at the top level or in folders that are not moved)
        let x = o.position[0], z = o.position[2];
        for (let p = o.parent ? byId.get(o.parent) : undefined; p; p = p.parent ? byId.get(p.parent) : undefined) {
          x += p.position[0];
          z += p.position[2];
        }
        const n = a.source.cells;
        const cx0 = Math.round((x - g.originX) / g.cellSize - n / 2), cz0 = Math.round((z - g.originZ) / g.cellSize - n / 2);
        for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) covered.add(`${cx0 + i},${cz0 + k}`);
      }
      const folder = newId();
      const added: MapObject[] = [];
      for (let cx = 0; cx + 4 <= g.width; cx += 4)
        for (let cz = 0; cz + 4 <= g.depth; cz += 4) {
          let free = true;
          for (let i = 0; i < 4 && free; i++) for (let k = 0; k < 4 && free; k++) if (covered.has(`${cx + i},${cz + k}`)) free = false;
          if (!free) continue;
          added.push({
            id: newId(),
            name: tile.name,
            asset: tile.id,
            parent: folder,
            position: [g.originX + (cx + 2) * g.cellSize, 0, g.originZ + (cz + 2) * g.cellSize],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            visible: true,
            locked: false,
          });
        }
      if (!added.length) return;
      const group: MapObject = { id: folder, name: `Suelo (${texture})`, asset: null, parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, locked: true };
      apply(withObjects([...s.doc.objects, group, ...added]));
    },

    addObject: (assetId, position, opts) => {
      const s = get();
      const asset = assetId ? s.assets.get(assetId) : null;
      const id = newId();
      const obj: MapObject = {
        id,
        name: opts?.name ?? asset?.name ?? 'Grupo',
        asset: assetId,
        parent: opts?.parent ?? null,
        position,
        rotation: opts?.rotation ?? [0, 0, 0],
        scale: [1, 1, 1],
        visible: true,
        locked: false,
        ...(assetId === GRASS_ASSET ? { grass: defaultGrass() } : {}),
        ...(assetId === TERRAIN_ASSET ? { terrain: defaultTerrain() } : {}),
        ...(assetId === STAIRS_ASSET ? { stairs: defaultStairs() } : {}),
        ...(assetId === SIGN_ASSET ? { sign: { text: 'Escribe aquí el texto del cartel.' } } : {}),
      };
      apply(withObjects([...s.doc.objects, obj]));
      set({ selection: [id] });
      return id;
    },

    updateObject: (id, patch, history = true) => get().updateObjects([{ id, patch }], history),
    updateObjects: (patches, history = true) => {
      const map = new Map(patches.map((p) => [p.id, p.patch]));
      apply(
        withObjects(get().doc.objects.map((o) => (map.has(o.id) ? { ...o, ...map.get(o.id) } : o))),
        history,
      );
    },
    commit: () => {
      const s = get();
      set({ past: [...s.past.slice(-HISTORY + 1), s.doc], future: [] });
    },

    removeSelected: () => {
      const s = get();
      if (!s.selection.length) return;
      const gone = new Set(s.selection);
      for (const id of s.selection) for (const d of descendants(s.doc.objects, id)) gone.add(d);
      apply(withObjects(s.doc.objects.filter((o) => !gone.has(o.id))));
      set({ selection: [] });
    },

    duplicateSelected: () => {
      const s = get();
      if (!s.selection.length) return;
      const objs = s.doc.objects;
      const copies: MapObject[] = [];
      const newSel: string[] = [];
      const roots = s.selection.filter((id) => !s.selection.some((other) => other !== id && descendants(objs, other).has(id)));
      for (const rootId of roots) {
        const ids = [rootId, ...descendants(objs, rootId)];
        const remap = new Map(ids.map((i) => [i, newId()]));
        for (const o of objs)
          if (remap.has(o.id)) {
            const isRoot = o.id === rootId;
            copies.push({
              ...o,
              id: remap.get(o.id)!,
              parent: isRoot ? o.parent : remap.get(o.parent!) ?? o.parent,
              position: isRoot ? [o.position[0] + s.doc.grid.cellSize, o.position[1], o.position[2]] : o.position,
              name: isRoot ? `${o.name}` : o.name,
            });
          }
        newSel.push(remap.get(rootId)!);
      }
      apply(withObjects([...objs, ...copies]));
      set({ selection: newSel });
    },

    groupSelected: () => {
      const s = get();
      const id = newId();
      const group: MapObject = {
        id,
        name: 'Grupo',
        asset: null,
        parent: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visible: true,
        locked: false,
      };
      const sel = new Set(s.selection);
      const objects = s.doc.objects.map((o) => (sel.has(o.id) && !o.parent ? { ...o, parent: id } : o));
      apply(withObjects([...objects, group]));
      set({ selection: [id] });
    },

    reparent: (id, parent, before) => {
      const s = get();
      if (id === parent || (parent && descendants(s.doc.objects, id).has(parent))) return;
      const objs = s.doc.objects.filter((o) => o.id !== id);
      const moved = { ...s.doc.objects.find((o) => o.id === id)!, parent };
      const at = before ? objs.findIndex((o) => o.id === before) : -1;
      if (at >= 0) objs.splice(at, 0, moved);
      else objs.push(moved);
      apply(withObjects(objs));
    },

    select: (ids, additive) =>
      set((s) => {
        if (!additive) return { selection: ids };
        const cur = new Set(s.selection);
        for (const id of ids) (cur.has(id) ? cur.delete(id) : cur.add(id));
        return { selection: [...cur] };
      }),
    setTool: (t) => set({ tool: t }),
    setSnap: (sn) => set((s) => ({ snap: { ...s.snap, ...sn } })),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleTopView: () => set((s) => ({ topView: !s.topView })),
    arm: (a) => set({ armedAsset: a }),
    setHoverCell: (c) => set({ hoverCell: c }),
    setStatus: (st) => set({ status: st }),

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      const ids = new Set(prev.objects.map((o) => o.id));
      set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true, selection: s.selection.filter((i) => ids.has(i)) });
    },
    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      const ids = new Set(next.objects.map((o) => o.id));
      set({ doc: next, past: [...s.past, s.doc], future: s.future.slice(1), dirty: true, selection: s.selection.filter((i) => ids.has(i)) });
    },
  };
});
