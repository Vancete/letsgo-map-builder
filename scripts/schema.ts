// print the learned material schema of a set of models: node scripts/schema.ts <pak> [<pak>...]
import { readFileSync } from 'node:fs';
import { Gfpak } from '../src/shared/formats/gfpak.ts';
import { FBEditor, learnSchema, type Schema } from '../src/shared/formats/fbedit.ts';
import { isGfbmdl } from '../src/shared/formats/gfbmdl.ts';
const samples: { ed: FBEditor; pos: number }[] = [];
for (const p of process.argv.slice(2)) {
  const pak = new Gfpak(new Uint8Array(readFileSync(p)));
  for (const f of pak.files) {
    const d = pak.read(f);
    if (!isGfbmdl(d)) continue;
    const ed = new FBEditor(d);
    for (const m of ed.vectorElems(ed.child(ed.u32(0), 6))) samples.push({ ed, pos: m });
  }
}
const show = (s: Schema, ind = '') => {
  for (const [i, k] of [...s].sort((a, b) => a[0] - b[0])) {
    console.log(`${ind}[${i}] ${k.kind}`);
    if (k.kind === 'table' || k.kind === 'vtables') show(k.schema, ind + '  ');
  }
};
console.log(samples.length, 'materials');
show(learnSchema(samples));
