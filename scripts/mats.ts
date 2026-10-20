import { readFileSync } from 'node:fs';
import { FB } from '../src/shared/formats/flatbuf.ts';
const r = new FB(new Uint8Array(readFileSync(process.argv[2]))).root();
const tex = r.strings(2);
for (const m of r.tables(6).slice(0, Number(process.argv[3] ?? 50))) {
  const maps = m.tables(11).map((t) => `${t.str(0)}=${tex[t.i32(1, 0)]}`);
  const common = m.table(20);
  const sw = common ? common.tables(0).map((t) => `${t.str(0)}:${t.u8(1)}`).join(' ') : '';
  const vals = m.tables(13).map((t) => `${t.str(0)}=${t.f32(1).toFixed(2)}`).join(' ');
  const cols = m.tables(14).map((t) => `${t.str(0)}=${t.vecf(1, 3)?.map((x) => x.toFixed(2))}`).join(' ');
  const cs = common ? common.tables(1).map((t) => `${t.str(0)}=${t.i32(1)}`).join(' ') : '';
  console.log(`MAT ${m.str(0)} sh=${m.str(1)} f2=${m.u32(2)} f3=${m.u8(3)} f4=${m.u8(4)} f5=${m.u32(5)} f7=${m.u32(7)} f9=${m.i32(9)} f12=${m.u32(12)} f15=${m.u8(15)} f16=${m.u8(16)}\n  maps: ${maps.join(' ')}\n  sw: ${sw}\n  ints: ${cs}\n  vals: ${vals}\n  cols: ${cols}`);
}
