// node scripts/mdlinfo.ts <file.gfbmdl>: a model's materials (shader, textures) and meshes (bounds, polygons)
import { readFileSync } from 'node:fs';
import { parseGfbmdl } from '../src/shared/formats/gfbmdl.ts';
import { FB } from '../src/shared/formats/flatbuf.ts';
const data = new Uint8Array(readFileSync(process.argv[2]));
const m = parseGfbmdl(data);
const root = new FB(data).root();
console.log('textures', root.strings(2));
m.materials.forEach((x, i) => console.log('mat', i, x.name, x.shader, JSON.stringify((x as any).textures ?? '')));
root.tables(7).forEach((g, i) => console.log('group', i, 'bone', g.u32(0), 'mesh', g.u32(1)));
m.meshes.forEach((x: any, i) => console.log('mesh', i, x.polygons.map((p: any) => `mat${p.material}:${p.indices.length / 3}`).join(' '), x.box ?? ''));
console.log('bones', m.bones.map((b: any) => b.name).join(' '));
