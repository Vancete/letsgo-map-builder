// zones of a map in a placement.gfpak: node scripts/zones.ts <placement.gfpak> <map>
import { readFileSync } from 'node:fs';
import { Gfpak } from '../src/shared/formats/gfpak.ts';
import { FB, Table } from '../src/shared/formats/flatbuf.ts';
const pak = new Gfpak(new Uint8Array(readFileSync(process.argv[2])));
const r = new FB(pak.read(pak.byPath(`bin/field/param/placement/${process.argv[3]}.bin`)!)).root();
const present = (t: Table) => Array.from({ length: t.fieldCount }, (_, k) => (t.has(k) ? k : null)).filter((x) => x !== null).join(',');
r.tables(0).forEach((z, i) => {
  const inf = z.table(0)!;
  const lists = Array.from({ length: 29 }, (_, k) => (k && z.has(k) ? `${k}:${z.vecLen(k)}` : '')).filter(Boolean).join(' ');
  console.log(`zone ${i} ${inf.u64(1).toString(16)} ${inf.str(3)} info[${present(inf)}] t[${present(inf.table(0)!)}] id=${inf.table(0)!.u64(9).toString(16)} | ${lists}`);
  for (const e of z.tables(5)) {
    const o = e.table(0)!;
    console.log(`   patch obj[${present(o)}] ${o.str(1)} ${o.str(2)} t[${present(o.table(0)!)}] ${[0, 1, 2].map((k) => o.table(0)!.f32(k))} ${o.f32(3)} ${o.f32(4)}`);
  }
});
