import { readFileSync, readdirSync } from 'node:fs';
import { FB, Table } from '../src/shared/formats/flatbuf.ts';
const dir = process.argv[2];
const xs: number[] = [];
function isXform(t: Table) { return t.fieldCount >= 9 && t.f32(6, 0) !== 0 && t.has(6) && t.has(7) && t.has(8); }
function walk(t: Table, d: number, seen: Set<number>) {
  if (d > 6 || seen.has(t.pos)) return; seen.add(t.pos);
  for (let i = 0; i < t.fieldCount; i++) {
    const o = t.off(i); if (!o) continue;
    const raw = t.fb.dv.getUint32(o, true); const tgt = o + raw;
    if (tgt + 8 > t.fb.u8.length) continue;
    try {
      const sub = new Table(t.fb, tgt);
      if (sub.vtSize >= 4 && sub.vtSize < 100 && sub.vt > 0) {
        if (i === 0 && isXform(sub) && Math.abs(sub.f32(7)-1)<1e-6) { xs.push(sub.f32(0), sub.f32(2)); }
        walk(sub, d + 1, seen);
      }
    } catch {}
    try {
      const n = t.fb.dv.getUint32(tgt, true);
      if (n > 0 && n < 5000) for (let k = 0; k < n; k++) { const e = tgt + 4 + k * 4; const p = e + t.fb.dv.getUint32(e, true); if (p + 8 < t.fb.u8.length) { const s = new Table(t.fb, p); if (s.vt > 0 && s.vtSize >= 4 && s.vtSize < 100) walk(s, d + 1, seen); } }
    } catch {}
  }
}
for (const f of readdirSync(dir)) { try { walk(new FB(new Uint8Array(readFileSync(dir + '/' + f))).root(), 0, new Set()); } catch {} }
console.log('n', xs.length);
for (const g of [10, 12.5, 25, 37.5, 50, 75, 100, 150]) console.log(g, (xs.filter((x) => Math.abs(x / g - Math.round(x / g)) < 1e-3).length / xs.length).toFixed(3));
