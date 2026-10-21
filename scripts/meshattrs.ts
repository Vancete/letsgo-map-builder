// node scripts/meshattrs.ts <file.gfbmdl> [mesh] [n]: a mesh's vertex layout, its first vertices and the values seen
import { readFileSync } from 'node:fs';
import { FB } from '../src/shared/formats/flatbuf.ts';

const data = new Uint8Array(readFileSync(process.argv[2]));
const root = new FB(data).root();
const mi = Number(process.argv[3] ?? 0);
const n = Number(process.argv[4] ?? 8);
const mt = root.tables(8)[mi];
const SZ: Record<number, number> = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 8: 1 };
const layout = mt.tables(1).map((a) => ({ type: a.u32(0), fmt: a.u32(1), count: a.u32(2) }));
const stride = layout.reduce((s, a) => s + SZ[a.fmt] * a.count, 0);
const bytes = mt.bytes(2);
console.log(JSON.stringify(layout), 'stride', stride, 'verts', bytes.length / stride);
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const half = (h: number) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  return !e ? s * 2 ** -14 * (f / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + f / 1024);
};
const seen = new Map<string, Set<string>>();
for (let v = 0; v < bytes.length / stride; v++) {
  let o = v * stride;
  const parts: string[] = [];
  for (const a of layout) {
    const vals: number[] = [];
    for (let k = 0; k < a.count; k++) {
      const p = o + k * SZ[a.fmt];
      vals.push(a.fmt === 0 ? +dv.getFloat32(p, true).toFixed(1) : a.fmt === 1 ? +half(dv.getUint16(p, true)).toFixed(3) : SZ[a.fmt] === 1 ? dv.getUint8(p) : dv.getUint16(p, true));
    }
    o += SZ[a.fmt] * a.count;
    parts.push(`t${a.type}:${vals.join(',')}`);
    if (a.type !== 0) {
      const k = `t${a.type}`;
      if (!seen.has(k)) seen.set(k, new Set());
      if (seen.get(k)!.size < 30) seen.get(k)!.add(vals.join(','));
    }
  }
  if (v < n) console.log(' ', parts.join(' '));
}
for (const [k, s] of seen) console.log(k, [...s].join(' | '));
