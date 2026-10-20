import { readFileSync, readdirSync } from 'node:fs';
import { FB } from '../src/shared/formats/flatbuf.ts';
const dir = process.argv[2];
const combos = new Map<string, number>();
for (const f of readdirSync(dir)) {
  const u8 = new Uint8Array(readFileSync(dir + '/' + f));
  if (u8[0] === 0x42) continue;
  let root;
  try { root = new FB(u8).root(); } catch { continue; }
  if (root.fieldCount < 9 || !root.has(8)) continue;
  const bones = root.tables(9).map((b) => b.str(0));
  for (const m of root.tables(8)) {
    const at = m.tables(1).map((a) => `${a.u32(0)}:${a.u32(1)}x${a.u32(2)}`).join(' ');
    const fmt: Record<number, number> = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 8: 1 };
    const data = m.vecLen(2);
    const faces = m.tables(0).map((p) => p.vecLen(1));
    const maxIdx = Math.max(...m.tables(0).map((p) => { const [s, n] = p.vec(1); let mx = 0; for (let k = 0; k < n; k++) mx = Math.max(mx, p.fb.dv.getUint16(s + k * 2, true)); return mx; }));
    const key = at;
    combos.set(key, (combos.get(key) ?? 0) + 1);
    if ((combos.get(key) ?? 0) <= 1) console.log(f, 'attrs', at, 'data', data, 'maxIdx', maxIdx, 'stride~', (data / (maxIdx + 1)).toFixed(2), 'faces', faces.join(','), 'bones', bones.length, bones.slice(0, 3).join(','));
  }
}
console.log(combos);
