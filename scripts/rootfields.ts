// node scripts/rootfields.ts <game path> <map>...: the placement root's scalar fields of each map
import { openGameFS } from '../src/shared/formats/gamefs.ts';
import { Gfpak } from '../src/shared/formats/gfpak.ts';
import { FBEditor } from '../src/shared/formats/fbedit.ts';
import { placementPath } from '../src/shared/placement.ts';
const [game, ...maps] = process.argv.slice(2);
const fs = openGameFS(game)!;
const pak = new Gfpak(fs.read('bin/archive/field/placement.gfpak'));
for (const m of maps) {
  const f = pak.byPath(placementPath(m));
  if (!f) { console.log(m, 'missing'); continue; }
  const ed = new FBEditor(pak.read(f));
  const r = ed.u32(0);
  const { vt, vs, ts } = ed.vtable(r);
  const dv = new DataView(ed.buf.buffer);
  const rels: number[] = [];
  for (let o = 4; o < vs; o += 2) rels.push(dv.getUint16(vt + o, true));
  const sorted = [...new Set(rels.filter((x) => x))].sort((a, b) => a - b);
  const out = rels.map((rel, i) => {
    if (!rel) return null;
    const size = (sorted.find((x) => x > rel) ?? ts) - rel;
    const p = r + rel;
    if (size >= 8 && p % 8 === 0) return `${i}:0x${dv.getBigUint64(p, true).toString(16)}`;
    if (size === 1) return `${i}:u8 ${dv.getUint8(p)}`;
    if (size === 2) return `${i}:u16 ${dv.getUint16(p, true)}`;
    const u = dv.getUint32(p, true), fl = dv.getFloat32(p, true);
    return `${i}:${Math.abs(fl) > 1e-6 && Math.abs(fl) < 1e7 ? +fl.toPrecision(6) + 'f' : u}`;
  }).filter(Boolean);
  console.log(m.padEnd(12), `vs=${vs} ts=${ts}`, out.join(' '));
}
