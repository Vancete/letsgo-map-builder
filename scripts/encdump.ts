// node scripts/encdump.ts <encount_data.bin> <zones.txt> [table index]
import { readFileSync } from 'node:fs';
import { FBEditor } from '../src/shared/formats/fbedit.ts';
import { fnv1a64 } from '../src/shared/formats/gfpak.ts';
const ed = new FBEditor(new Uint8Array(readFileSync(process.argv[2])));
const zones = new Map(readFileSync(process.argv[3], 'utf8').split(/\r?\n/).filter(Boolean).map((z) => [fnv1a64(z), z]));
const tables = ed.vectorElems(ed.child(ed.u32(0), 0));
const which = process.argv[4] ? [Number(process.argv[4])] : tables.map((_, i) => i);
const dv = new DataView(ed.buf.buffer);
function fields(t: number) {
  const { vt, vs, ts } = ed.vtable(t);
  const rels: number[] = [];
  for (let o = 4; o < vs; o += 2) rels.push(dv.getUint16(vt + o, true));
  const sorted = [...new Set(rels.filter((r) => r))].sort((a, b) => a - b);
  return rels.map((rel, i) => (rel ? { i, rel, size: (sorted.find((r) => r > rel) ?? ts) - rel } : null)).filter(Boolean) as { i: number; rel: number; size: number }[];
}
const scalars = (t: number) => fields(t).map((f) => `${f.i}=${f.size >= 8 ? '0x' + dv.getBigUint64(t + f.rel, true).toString(16) : f.size === 1 ? dv.getUint8(t + f.rel) : dv.getInt32(t + f.rel, true)}`).join(' ');
for (const ti of which) {
  const t = tables[ti];
  const zf = ed.fieldPos(t, 0);
  const zh = zf ? dv.getBigUint64(zf, true) : 0n;
  if (process.argv[4] === undefined) { console.log(ti, zones.get(zh) ?? zh.toString(16), fields(t).map((f) => f.i).join(',')); continue; }
  console.log('zone', zones.get(zh) ?? zh.toString(16));
  for (const f of fields(t)) {
    const p = t + f.rel;
    const tgt = p + ed.u32(p);
    if (f.size === 4 && tgt > t && ed.vectorKind(tgt) === 'table') {
      const el = ed.vectorElems(tgt);
      console.log(` [${f.i}] vec[${el.length}]: ` + el.map((e) => '{' + scalars(e) + '}').join(' '));
    } else if (f.size === 4 && tgt > t && ed.isTable(tgt)) console.log(` [${f.i}] table {${scalars(tgt)}}`);
    else if (f.size === 4 && tgt > t && tgt < ed.len && ed.u32(tgt) < 1000 && ed.u32(tgt) > 0 && f.i === 4) console.log(` [${f.i}] raw vec len ${ed.u32(tgt)}: ${Array.from(ed.buf.subarray(tgt + 4, tgt + 4 + Math.min(ed.u32(tgt), 40)))}`);
    else console.log(` [${f.i}] ${f.size >= 8 ? '0x' + dv.getBigUint64(p, true).toString(16) : f.size === 1 ? dv.getUint8(p) : dv.getInt32(p, true)}`);
  }
}
