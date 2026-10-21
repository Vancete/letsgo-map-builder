// node scripts/listdump.ts <placement.bin> <zone> <list> [depth] [max]: one object list of a zone, element by element
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FBEditor, buildTable } from '../src/shared/formats/fbedit.ts';
const [file, zone, list, depth = '5', max = '3'] = process.argv.slice(2);
const ed = new FBEditor(new Uint8Array(readFileSync(file)));
const z = ed.vectorElems(ed.child(ed.u32(0), 0))[Number(zone)];
const elems = ed.vectorElems(ed.child(z, Number(list)));
console.log(`zone ${zone} list ${list}: ${elems.length} elements`);
const tmp = mkdtempSync(process.env.TMP + '/ld');
elems.slice(0, Number(max)).forEach((e, i) => {
  // each element as a buffer of its own (deep copy) for fbdump
  const out = new FBEditor(new Uint8Array(8));
  const c = out.cloneDeep(e, 0, ed);
  out.setRoot(c);
  writeFileSync(`${tmp}/e.bin`, out.data);
  console.log(`#${i}`);
  console.log(execFileSync(process.execPath, [new URL('./fbdump.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), `${tmp}/e.bin`, depth, '4']).toString());
});
