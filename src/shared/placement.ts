// The game's placement data (bin/archive/field/placement.gfpak, one FlatBuffer per map at
// bin/field/param/placement/<map>.bin), as far as the editor needs it.
//
//   Map (root):   0 zones, 1 u64 FNV-1a 64 of the map name ("area02", "test_chr01"), 5 transform, 13..18 bounds
//   Zone:         0 info {0 transform, 1 u64 zone name hash ("town001"), 3 zone shape (.gfbcol path)},
//                 1..28 object lists; 4 = warps
//   Warp element: 0 warp
//   Warp:         0 transform (where the trigger is), 1 {u64 destination zone hash, u32}, 2..4 arrival position,
//                 5 arrival rotation Y (degrees), 6 kind (2 doors and map edges), 7 trigger box (transform: 0..2 offset,
//                 3..5 rotation, 6..8 size; rotation Y = the direction the player walks in), 9 destination map name,
//                 10..13 door parameters (optional)
//   Transform:    0..2 position, 3..5 rotation (degrees), 6..8 scale, 9 u64 object id hash, 10, 11 u64 (empty hash)
import { FB } from './formats/flatbuf.ts';
import { FBEditor, buildTable, type FieldSpec } from './formats/fbedit.ts';
import { FNV64_OFFSET, fnv1a64 } from './formats/gfpak.ts';

export const placementPath = (map: string) => `bin/field/param/placement/${map}.bin`;

export interface ZoneInfo {
  index: number;
  hash: bigint;
  warps: { dest: string; at: number[] }[];
}

export function readZones(file: Uint8Array): ZoneInfo[] {
  const root = new FB(file).root();
  return root.tables(0).map((z, index) => ({
    index,
    hash: z.table(0)?.u64(1) ?? 0n,
    warps: z.tables(4).map((e) => {
      const w = e.table(0)!;
      const t = w.table(0);
      return { dest: w.str(9) ?? '', at: t ? [t.f32(0), t.f32(1), t.f32(2)] : [] };
    }),
  }));
}

export interface WarpSpec {
  id: string; // unique name, hashed into the trigger's object id
  at: [number, number, number]; // trigger position
  box: [number, number, number]; // trigger size (x, height, depth)
  walkRotY: number; // the direction the player walks into it (0 = +Z, 180 = -Z)
  destMap: string; // "test_chr01"
  destZone: string; // zone name inside it ("test_chr01", "town001")
  arrive: [number, number, number];
  arriveRotY: number;
}

function transform(pos: number[], rot: number[], scale: number[], id: bigint | null): FieldSpec[] {
  const f: FieldSpec[] = [];
  [...pos, ...rot].forEach((v, i) => v && f.push({ idx: i, f32: v }));
  scale.forEach((v, i) => f.push({ idx: 6 + i, f32: v }));
  if (id !== null) f.push({ idx: 9, u64: id });
  f.push({ idx: 10, u64: FNV64_OFFSET }, { idx: 11, u64: FNV64_OFFSET });
  return f;
}

// The map file with one more warp in one of its zones (the zone's warp list is written again at the end).
export function addWarp(file: Uint8Array, zoneIndex: number, w: WarpSpec | null): Uint8Array {
  const ed = new FBEditor(file);
  const root = ed.u32(0);
  const zones = ed.vectorElems(ed.child(root, 0));
  const zone = zones[zoneIndex];
  if (zone === undefined) throw new Error(`placement: no zone ${zoneIndex}`);
  const field = ed.fieldPos(zone, 4);
  if (!field) throw new Error('placement: the zone has no warp list');
  const old = ed.vectorElems(ed.deref(field));

  const cloneElem = (p: number) => ed.cloneDeep(p);

  const newElem = (w: WarpSpec) => () =>
    buildTable(ed, [
      {
        idx: 0,
        child: () =>
          buildTable(ed, [
            { idx: 0, child: () => buildTable(ed, transform(w.at, [0, 0, 0], [1, 1, 1], fnv1a64(w.id))) },
            { idx: 1, u64: fnv1a64(w.destZone) },
            { idx: 2, f32: w.arrive[0] },
            { idx: 3, f32: w.arrive[1] },
            { idx: 4, f32: w.arrive[2] },
            { idx: 5, f32: w.arriveRotY },
            { idx: 6, u32: 2 },
            { idx: 7, child: () => buildTable(ed, transform([0, 0, 0], [0, w.walkRotY, 0], w.box, null)) },
            { idx: 9, child: () => ed.string(w.destMap) },
          ]),
      },
    ]);

  const vec = ed.vectorOfTables([...old.map((p) => () => cloneElem(p)), ...(w ? [newElem(w)] : [])]);
  ed.link(field, vec);
  return ed.data;
}

// ---- generic: append elements to one of a zone's lists (the list is written again at the end of the file)

export function editZoneList(file: Uint8Array, zoneIndex: number, list: number, add: ((ed: FBEditor) => number)[], keep = true): Uint8Array {
  const ed = new FBEditor(file);
  const zones = ed.vectorElems(ed.child(ed.u32(0), 0));
  const zone = zones[zoneIndex];
  if (zone === undefined) throw new Error(`placement: no zone ${zoneIndex}`);
  const field = ed.fieldPos(zone, list);
  if (!field) throw new Error(`placement: the zone has no list ${list}`);
  const old = keep ? ed.vectorElems(ed.deref(field)) : [];
  const vec = ed.vectorOfTables([...old.map((p) => () => ed.cloneDeep(p)), ...add.map((a) => () => a(ed))]);
  ed.link(field, vec);
  return ed.data;
}

export function zoneIndexOf(file: Uint8Array, zoneName: string): number {
  return readZones(file).findIndex((z) => z.hash === fnv1a64(zoneName));
}

// ---- teleporter: Saffron Gym's teleport pad (list 25) under the warp tile model (list 2), as templates

export const LIST_OBJECTS = 2;
export const LIST_WARPS = 4;
export const LIST_PADS = 25;

export interface TeleporterSpec {
  id: string;
  at: [number, number, number];
  destMap: string;
  destZone: string;
  arrive: [number, number, number];
  box?: [number, number, number]; // trigger size (default: the pad's, 50 x 100 x 50)
}

export class Templates {
  readonly ed: FBEditor;
  readonly object: number; // list 2 element: warp01.gfbmdl
  readonly pad: number; // list 25 element

  // the Saffron Gym's placement (t011gym)
  constructor(gymFile: Uint8Array) {
    this.ed = new FBEditor(gymFile);
    const zone = this.ed.vectorElems(this.ed.child(this.ed.u32(0), 0))[0];
    const objects = this.ed.vectorElems(this.ed.child(zone, LIST_OBJECTS));
    const obj = objects.find((e) => {
      const o = this.ed.child(e, 0);
      const s = o && this.ed.child(o, 1);
      return s && this.ed.readString(s).endsWith('/warp01.gfbmdl');
    });
    const pads = this.ed.vectorElems(this.ed.child(zone, LIST_PADS));
    if (obj === undefined || !pads.length) throw new Error('placement: no teleport pad template in t011gym');
    this.object = obj;
    this.pad = pads[0];
  }
}

function setTransform(ed: FBEditor, t: number, pos: number[], id: bigint | null) {
  pos.forEach((v, i) => {
    if (!ed.setFieldF32(t, i, v) && v) throw new Error('placement: the template has no slot for a position axis');
  });
  if (id !== null) ed.setFieldU64(t, 9, id);
}

export function teleporterMakers(tpl: Templates, s: TeleporterSpec): { object: (ed: FBEditor) => number; pad: (ed: FBEditor) => number } {
  return {
    object: (ed) => {
      const e = ed.cloneDeep(tpl.object, 0, tpl.ed);
      const o = ed.child(e, 0);
      setTransform(ed, ed.child(o, 0), s.at, fnv1a64(`${s.id}_model`));
      return e;
    },
    pad: (ed) => {
      const e = ed.cloneDeep(tpl.pad, 0, tpl.ed);
      const p = ed.child(e, 0);
      setTransform(ed, ed.child(p, 0), [s.at[0], s.at[1] + 5, s.at[2]], fnv1a64(s.id));
      ed.link(ed.fieldPos(p, 1), ed.string(s.destMap));
      ed.setFieldU64(p, 2, fnv1a64(s.destZone));
      s.arrive.forEach((v, i) => ed.setFieldF32(p, 3 + i, v));
      if (s.box) s.box.forEach((v, i) => ed.setFieldF32(ed.child(p, 8), 6 + i, v));
      return e;
    },
  };
}

// The warp tile's model (list 2) with a map-changing warp on it (list 4). (The game's own teleport pads, list 25, only
// move the player within the same map.)
export function addTeleporter(file: Uint8Array, zoneIndex: number, tpl: Templates, s: TeleporterSpec): Uint8Array {
  const m = teleporterMakers(tpl, s);
  let f = editZoneList(file, zoneIndex, LIST_OBJECTS, [m.object]);
  // a warp fires when the player walks into it in its box's direction: one per direction
  for (const rot of [0, 90, 180, 270])
    f = addWarp(f, zoneIndex, {
      id: `${s.id}_${rot}`,
      at: s.at,
      box: s.box ?? [100, 100, 100],
      walkRotY: rot,
      destMap: s.destMap,
      destZone: s.destZone,
      arrive: s.arrive,
      arriveRotY: 0,
    });
  return f;
}
