// node scripts/pakinfo.ts <file.gfpak> [dumpdir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Gfpak, hashHex, sniff } from '../src/shared/formats/gfpak.ts';

const pak = new Gfpak(new Uint8Array(readFileSync(process.argv[2])));
const out = process.argv[3];
if (out) mkdirSync(out, { recursive: true });
const kinds: Record<string, number> = {};
for (const f of pak.files) {
  const d = pak.read(f);
  const k = sniff(d);
  kinds[k] = (kinds[k] ?? 0) + 1;
  if (out) writeFileSync(`${out}/${f.index}_${hashHex(f.pathHash)}.${k.replace(':', '_')}`, d);
}
console.log(pak.files.length, 'files', kinds, 'folders', new Set(pak.files.map((f) => f.folderHash)).size);
