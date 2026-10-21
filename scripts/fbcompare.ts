// structural compare of two flatbuffers (deep, by detected strings/tables): node scripts/fbcompare.ts a b
import { readFileSync } from 'node:fs';
import { FBEditor } from '../src/shared/formats/fbedit.ts';
const load = (p: string) => new FBEditor(new Uint8Array(readFileSync(p)));
function walk(ed: FBEditor, t: number, out: string[], path: string, d = 0) {
  if (d > 30) return;
  const { vt, vs } = ed.vtable(t);
  const dv = new DataView(ed.buf.buffer);
  for (let o = 4, i = 0; o < vs; o += 2, i++) {
    const rel = dv.getUint16(vt + o, true);
    if (!rel) continue;
    const f = t + rel;
    const tgt = f + ed.u32(f);
    if (rel % 4 === 0 && tgt > f && tgt < ed.buf.length && ed.isString(tgt)) out.push(`${path}.${i}=s:${new TextDecoder().decode(ed.buf.subarray(tgt + 4, tgt + 4 + ed.u32(tgt)))}`);
    else if (rel % 4 === 0 && tgt > f && tgt < ed.buf.length && ed.isTable(tgt)) walk(ed, tgt, out, `${path}.${i}`, d + 1);
    else out.push(`${path}.${i}=${ed.u32(f)}`);
  }
}
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const oa: string[] = [], ob: string[] = [];
walk(a, a.u32(0), oa, 'r');
walk(b, b.u32(0), ob, 'r');
console.log(oa.length, ob.length);
const sa = new Set(oa);
console.log('only in b:', ob.filter((x) => !sa.has(x)).slice(0, 20));
