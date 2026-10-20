import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { Gfpak } from '../src/shared/formats/gfpak.ts';
import { FB } from '../src/shared/formats/flatbuf.ts';
const root = process.argv[2];
const paks: string[] = [];
(function walk(d: string) { for (const f of readdirSync(d)) { const p = d + '/' + f; if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.gfpak')) paks.push(p); } })(root);
const names = new Map<string, Set<string>>();
let models = 0;
const lines: string[] = [];
for (const p of paks) {
  const pak = new Gfpak(new Uint8Array(readFileSync(p)));
  for (const f of pak.files) {
    const d = pak.read(f);
    if (d[0] !== 0x20 && d[0] !== 0x1c && d[0] !== 0x24) {}
    let r; try { r = new FB(d).root(); if (r.fieldCount < 10 || !r.has(8) || !r.has(9)) continue; r.tables(9); } catch { continue; }
    models++;
    const bones = r.tables(9);
    const groups = r.tables(7);
    const depth = (i: number) => { let d = 0; let b = bones[i]; while (b && b.i32(2, -1) >= 0 && d < 20) { b = bones[b.i32(2, -1)]; d++; } return d; };
    const top = bones.map((b, i) => ({ n: b.str(0) ?? '', d: depth(i) })).filter((x) => x.d <= 1 && !/^[0-9a-f]{18,}$/.test(x.n));
    lines.push(`${p.split('/field/')[1]}#${f.index} ${bones[0]?.str(0)} meshes=${r.vecLen(8)}: ` + top.map((x) => (x.d ? '  ' : '') + x.n).join(' | '));
  }
}
writeFileSync(process.argv[3], lines.join('\n'));
console.log('paks', paks.length, 'models', models);
