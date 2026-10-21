// Wild Pokémon for a map's tall-grass zones, in the game's own terms:
//
//  - Each grass zone is a zone of its own (a map is split in zones, each with a shape: <zone>.gfbcol, a list of
//    objects in the placement data, scripts, and one table of wild Pokémon).
//  - The grass itself is a vegetation patch (placement list 5): a position, a shape (.gfbcol, cells around that
//    position) and the tuft model the game fills the shape with (enc_grass01.gfbmdl); wild Pokémon appear in it.
//  - The table (bin/field/param/encount/encount_data_p.bin for Pikachu, _e for Eevee: one FlatBuffer table per zone):
//    0 zone hash; ground: 4 max spawns, 5 interval, 6 ?, 7 min level, 8 max level, 9 ?, 10 slots {0 rate %, 1 species}
//    (10 slots); water 12..18; sky 35..41.
import { FBEditor, buildTable, cloneWithSchema, learnSchema, type Schema } from './formats/fbedit.ts';
import { FNV64_OFFSET, fnv1a64 } from './formats/gfpak.ts';
import type { WildTable } from './types.ts';

export const ENCOUNT_FILES = ['bin/field/param/encount/encount_data_p.bin', 'bin/field/param/encount/encount_data_e.bin'];
export const ZONE_NAME_TABLE = 'bin/field/param/placement/table/ZoneNameHashTable.tbl';

const GROUND_SLOTS = 10;
const WATER_SLOTS = 5;
const SKY_SLOTS = 4;

// The encounter file with tables for more zones, made from a template zone's table (its counts and timings) with the
// ground slots and levels replaced, and no water or sky Pokémon.
export function addEncounterTables(file: Uint8Array, templateZone: string, tables: { zone: string; wild: WildTable }[]): Uint8Array {
  const ed = new FBEditor(file);
  const root = ed.u32(0);
  const field = ed.fieldPos(root, 0);
  const old = ed.vectorElems(ed.deref(field));
  const schema = learnSchema(old.map((pos) => ({ ed, pos })));
  const zoneOf = (t: number) => ed.buf.subarray(ed.fieldPos(t, 0), ed.fieldPos(t, 0) + 8);
  const want = new Uint8Array(new BigUint64Array([fnv1a64(templateZone)]).buffer);
  const tpl = old.find((t) => zoneOf(t).every((b, i) => b === want[i]));
  if (tpl === undefined) throw new Error(`encounters: no table for ${templateZone}`);
  const replaced = new Set(tables.map((t) => fnv1a64(t.zone)));
  const keep = old.filter((t) => !replaced.has(new DataView(ed.buf.buffer).getBigUint64(ed.fieldPos(t, 0), true)));

  const slots = (e: FBEditor, list: { species: number; rate: number }[], n: number) =>
    e.vectorOfTables(
      Array.from({ length: n }, (_, i) => () => {
        const s = list[i];
        return s && s.species && s.rate ? buildTable(e, [{ idx: 0, u32: Math.round(s.rate) }, { idx: 1, u32: s.species }]) : buildTable(e, []);
      }),
    );
  const make = (t: { zone: string; wild: WildTable }) => () => {
    const n = cloneWithSchema(ed, ed, tpl, schema);
    ed.setU64(ed.fieldPos(n, 0), fnv1a64(t.zone));
    ed.setFieldU32(n, 7, Math.max(1, Math.min(100, t.wild.minLevel)));
    ed.setFieldU32(n, 8, Math.max(t.wild.minLevel, Math.min(100, t.wild.maxLevel)));
    ed.link(ed.fieldPos(n, 10), slots(ed, t.wild.slots, GROUND_SLOTS));
    if (ed.fieldPos(n, 18)) ed.link(ed.fieldPos(n, 18), slots(ed, [], WATER_SLOTS));
    if (ed.fieldPos(n, 41)) ed.link(ed.fieldPos(n, 41), slots(ed, [], SKY_SLOTS));
    return n;
  };
  const vec = ed.vectorOfTables([...keep.map((p) => () => cloneWithSchema(ed, ed, p, schema)), ...tables.map(make)]);
  ed.link(field, vec);
  return ed.data;
}

// AHTB name table (bin/field/param/placement/table/*.tbl): "AHTB", u32 count, then per name: u64 FNV-1a 64, u16 length
// with the terminating zero, the name and the zero.
export function addHashNames(tbl: Uint8Array, names: string[]): Uint8Array {
  const dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  const count = dv.getUint32(4, true);
  const have = new Set<bigint>();
  let p = 8;
  for (let i = 0; i < count && p + 10 <= tbl.length; i++) {
    have.add(dv.getBigUint64(p, true));
    p += 10 + dv.getUint16(p + 8, true);
  }
  const add = names.filter((n) => !have.has(fnv1a64(n)));
  const enc = new TextEncoder();
  const extra = add.reduce((s, n) => s + 10 + enc.encode(n).length + 1, 0);
  const out = new Uint8Array(p + extra + (tbl.length - p));
  out.set(tbl.subarray(0, p));
  const odv = new DataView(out.buffer);
  odv.setUint32(4, count + add.length, true);
  let q = p;
  for (const n of add) {
    const b = enc.encode(n);
    odv.setBigUint64(q, fnv1a64(n), true);
    odv.setUint16(q + 8, b.length + 1, true);
    out.set(b, q + 10);
    q += 10 + b.length + 1;
  }
  out.set(tbl.subarray(p), q);
  return out;
}

// A new zone in a map's placement, copied from one of its zones with every list emptied: its name and shape changed.
// Returns the file and the new zone's index.
export function addZone(file: Uint8Array, fromZone: number, name: string, shapePath: string, schema: Schema): { data: Uint8Array; index: number } {
  const ed = new FBEditor(file);
  const root = ed.u32(0);
  const field = ed.fieldPos(root, 0);
  const zones = ed.vectorElems(ed.deref(field));
  const make = () => {
    const z = cloneWithSchema(ed, ed, zones[fromZone], schema);
    for (let list = 1; list <= 28; list++) {
      const f = ed.fieldPos(z, list);
      if (f) ed.link(f, ed.vectorOfTables([]));
    }
    const info = ed.child(z, 0);
    ed.setFieldU64(info, 1, fnv1a64(name));
    const t = ed.child(info, 0); // the zone's own object id
    if (t) ed.setFieldU64(t, 9, fnv1a64(`${name}_zone`));
    ed.link(ed.fieldPos(info, 3), ed.string(shapePath));
    return z;
  };
  const vec = ed.vectorOfTables([...zones.map((p) => () => cloneWithSchema(ed, ed, p, schema)), make]);
  ed.link(field, vec);
  return { data: ed.data, index: zones.length };
}

// A vegetation patch entry (placement list 5) from a template entry: position, shape and model replaced.
export function grassPatchMaker(tplEd: FBEditor, tplElem: number, at: [number, number, number], shapePath: string, model: string, id: string) {
  // the entries' layout, learned from every vegetation patch of the template's map
  const zones = tplEd.vectorElems(tplEd.child(tplEd.u32(0), 0));
  const samples = zones.flatMap((z) => (tplEd.child(z, 5) ? tplEd.vectorElems(tplEd.child(z, 5)) : [])).map((pos) => ({ ed: tplEd, pos }));
  const schema = learnSchema(samples);
  return (ed: FBEditor) => {
    const e = cloneWithSchema(ed, tplEd, tplElem, schema);
    const o = ed.child(e, 0);
    const t = ed.child(o, 0);
    at.forEach((v, i) => ed.setFieldF32(t, i, v));
    ed.setFieldU64(t, 9, fnv1a64(id));
    ed.link(ed.fieldPos(o, 1), ed.string(shapePath));
    ed.link(ed.fieldPos(o, 2), ed.string(model));
    return e;
  };
}

// cells (cx, cz) of size `cell` as quads, around (ox, oz): vertices and triangles for a .gfbcol
export function cellsMesh(cells: [number, number][], cell: number, ox: number, oz: number): { verts: number[]; idx: number[] } {
  const verts: number[] = [];
  const idx: number[] = [];
  for (const [cx, cz] of cells) {
    const x0 = cx * cell - ox, z0 = cz * cell - oz;
    const b = verts.length / 3;
    verts.push(x0, 0, z0, x0 + cell, 0, z0, x0, 0, z0 + cell, x0 + cell, 0, z0 + cell);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  return { verts, idx };
}

export { FNV64_OFFSET };
