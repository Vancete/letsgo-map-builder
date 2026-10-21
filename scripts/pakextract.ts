// node scripts/pakextract.ts <pak> <inner path> <out>: one file of a .gfpak, by its path
import { readFileSync, writeFileSync } from 'node:fs';
import { Gfpak } from '../src/shared/formats/gfpak.ts';
const [pak, path, out] = process.argv.slice(2);
const p = new Gfpak(new Uint8Array(readFileSync(pak)));
const f = p.byPath(path);
if (!f) throw new Error('not found');
writeFileSync(out, p.read(f));
