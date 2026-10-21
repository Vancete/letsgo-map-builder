// guess the paths of a gfpak's files: node scripts/pakhash.ts <pak> <names file>
import { readFileSync } from 'node:fs';
import { Gfpak, fnv1a64, hashHex } from '../src/shared/formats/gfpak.ts';
const pak = new Gfpak(new Uint8Array(readFileSync(process.argv[2])));
const names = readFileSync(process.argv[3], 'utf8').split(/\r?\n/).filter(Boolean);
const dirs = ['bin/field/param/placement/', 'bin/field/param/placement/zone/', 'bin/field/placement/', 'bin/field/param/', 'bin/archive/field/placement/', 'field/param/placement/', 'bin/field/param/placement/data/', ''];
const exts = ['.bin', '.bfbs', '.fbs', '_placement.bin', '.prmb', '.gfbpmcatalog', ''];
const byPath = new Map(pak.files.map((f) => [f.pathHash, f.index]));
const byName = new Map(pak.files.map((f) => [f.nameHash, f.index]));
const folders = new Set(pak.files.map((f) => hashHex(f.folderHash)));
console.log('folders', [...folders]);
let hits = 0;
for (const n of names) for (const e of exts) {
  const fn = n + e;
  if (byName.has(fnv1a64(fn))) { console.log('name', byName.get(fnv1a64(fn)), fn); hits++; }
  for (const d of dirs) if (byPath.has(fnv1a64(d + fn))) { console.log('path', byPath.get(fnv1a64(d + fn)), d + fn); hits++; }
}
for (const d of dirs) for (const x of [d, d.replace(/\/$/, '')]) if (folders.has(hashHex(fnv1a64(x)))) console.log('folder', x);
console.log('hits', hits);
