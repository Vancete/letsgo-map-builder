// node scripts/coldump.ts <file.gfbcol> [max vertices]: a collision file's meshes (names, attributes, vertices, triangles)
import { readFileSync } from 'node:fs';
import { FBEditor } from '../src/shared/formats/fbedit.ts';
const ed = new FBEditor(new Uint8Array(readFileSync(process.argv[2])));
const max = Number(process.argv[3] ?? 40);
const r = ed.u32(0);
const dv = new DataView(ed.buf.buffer);
const names = ed.child(r, 0) ? ed.vectorElems(ed.child(r, 0)).map((t) => ed.readString(ed.child(t, 0))) : [];
console.log('names', names);
const meshes = ed.child(r, 2) ? ed.vectorElems(ed.child(r, 2)) : [];
meshes.forEach((m, mi) => {
  const attrs = ed.vectorElems(ed.child(m, 1)).map((a) => [0, 1, 2].map((i) => { const f = ed.fieldPos(a, i); return f ? ed.u32(f) : 0; }));
  const size = (fmt: number) => ({ 0: 4, 1: 2, 2: 1, 3: 1 } as Record<number, number>)[fmt] ?? 4;
  const stride = attrs.reduce((n, [, fmt, c]) => n + size(fmt) * c, 0);
  const data = ed.child(m, 2);
  const nb = ed.u32(data);
  const nv = nb / stride;
  console.log(`mesh ${mi}: attrs ${JSON.stringify(attrs)} stride ${stride} vertices ${nv}`);
  for (let v = 0; v < Math.min(nv, max); v++) {
    let off = data + 4 + v * stride;
    const parts: string[] = [];
    for (const [type, fmt, c] of attrs) {
      const vals: number[] = [];
      for (let k = 0; k < c; k++) vals.push(fmt === 0 ? +dv.getFloat32(off + k * 4, true).toFixed(2) : fmt === 3 || fmt === 2 ? dv.getUint8(off + k) : dv.getUint16(off + k * 2, true));
      off += size(fmt) * c;
      parts.push(`t${type}:${vals.join(',')}`);
    }
    console.log('  v' + v, parts.join(' '));
  }
  ed.vectorElems(ed.child(m, 0)).forEach((p, pi) => {
    const ids = ed.child(p, 1);
    const n = ed.u32(ids);
    const list: number[] = [];
    for (let i = 0; i < n; i++) list.push(dv.getUint16(ids + 4 + i * 2, true));
    const other = [0, 2, 3, 4].map((i) => { const f = ed.fieldPos(p, i); return f ? `${i}=${ed.u32(f)}` : ''; }).join(' ');
    console.log(`  poly ${pi} [${other}] ${n} idx: ${list.slice(0, max * 3).join(',')}`);
  });
});
