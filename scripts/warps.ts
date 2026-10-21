// all warps in placement.gfpak: node scripts/warps.ts <placement.gfpak> <placement_names.txt>
import { readFileSync } from 'node:fs';
import { Gfpak } from '../src/shared/formats/gfpak.ts';
import { FB, Table } from '../src/shared/formats/flatbuf.ts';
const pak = new Gfpak(new Uint8Array(readFileSync(process.argv[2])));
const names = new Map(readFileSync(process.argv[3], 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { const [i, p] = l.split(' '); return [Number(i), p.split('/').pop()!.replace('.bin', '')]; }));
const xf = (t: Table | null) => t ? [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => +t.f32(i).toFixed(1)) : null;
const hex = (t: Table, i: number, n: number) => { const o = t.off(i); return o ? Array.from(t.fb.u8.subarray(o, o + n)).map((b) => b.toString(16).padStart(2, '0')).join('') : '-'; };
const types = new Map<number, number>();
for (const f of pak.files) {
  const root = new FB(pak.read(f)).root();
  const area = names.get(f.index) ?? `#${f.index}`;
  for (const [zi, z] of root.tables(0).entries()) {
    const zone = z.table(0);
    for (const e of z.tables(4)) {
      const w = e.table(0)!;
      const t = w.u32(6);
      types.set(t, (types.get(t) ?? 0) + 1);
      if (process.argv[4] && !area.startsWith(process.argv[4])) continue;
      console.log(`${area}/z${zi} -> ${w.str(9)} type=${t} at=${xf(w.table(0))?.slice(0, 3)} f1=${hex(w, 1, 12)} dst=[${[2, 3, 4, 5].map((i) => w.has(i) ? w.f32(i) : '-')}] box=${xf(w.table(7))} f8=${w.has(8) ? w.u32(8) : '-'} f10+=${[10, 11, 12, 13].map((i) => w.has(i) ? hex(w, i, 4) : '-')}`);
    }
  }
}
console.log(types);
