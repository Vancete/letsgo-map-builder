import { readFileSync } from 'node:fs';
import { FB } from '../src/shared/formats/flatbuf.ts';
const root = new FB(new Uint8Array(readFileSync(process.argv[2]))).root();
const bones = root.tables(9);
const groups = root.tables(7);
const meshBone = new Map<number, number>();
groups.forEach((g) => meshBone.set(g.u32(1), g.u32(0)));
bones.forEach((b, i) => {
  const ms = groups.filter((g) => g.u32(0) === i).map((g) => g.u32(1));
  console.log(i, b.str(0), 'type', b.u32(1), 'parent', b.i32(2, -1), 'T', b.vecf(7, 3)?.map((x) => x.toFixed(1)).join(','), 'R', b.vecf(6, 3)?.map((x) => x.toFixed(2)).join(','), 'S', b.vecf(5, 3)?.map((x) => x.toFixed(2)).join(','), 'meshes', ms.join(','));
});
console.log('materials', root.strings(5).join(' '));
