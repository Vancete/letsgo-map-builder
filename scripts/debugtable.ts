import { readFileSync } from 'node:fs';
import { FB } from '../src/shared/formats/flatbuf.ts';
const r = new FB(new Uint8Array(readFileSync(process.argv[2]))).root();
for (const a of r.tables(0)) {
  const name = a.str(0);
  if (process.argv[3] && !name?.startsWith(process.argv[3])) continue;
  for (const z of a.tables(1)) console.log(name, z.u64(0).toString(16), new TextDecoder().decode(z.bytes(1)), [2, 3, 4, 5].map((i) => (z.has(i) ? z.f32(i) : '-')).join(','));
}
