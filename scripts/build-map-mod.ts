// node scripts/build-map-mod.ts <map.lgmap> <catalog cache dir> <game path> <mods dir> [mod name]
// Builds the map into a Let's Go Recomp mod (test slot + teleporter in Pallet Town), as the editor's export does.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { openGameFS } from '../src/shared/formats/gamefs.ts';
import { buildMapMod } from '../src/shared/mapbuild.ts';
import type { Catalog, MapDocument } from '../src/shared/types.ts';

const [mapPath, cacheDir, gamePath, modsDir, name = 'LGMapTest'] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(mapPath, 'utf8')) as MapDocument;
const catalog = JSON.parse(readFileSync(join(cacheDir, 'catalog.json'), 'utf8')) as Catalog;
const fs = openGameFS(gamePath)!;
void inflateSync;
const t0 = Date.now();
const r = buildMapMod({
  fs,
  doc,
  assets: new Map(catalog.assets.map((a) => [a.id, a])),
  selection: (id) => {
    const p = join(cacheDir, 'models', `${id}.sel`);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  },
  baseGround: process.env.BASE_GROUND !== '0', // BASE_GROUND=0: without the slot's ground
  log: console.log,
});
for (const f of r.files) {
  const out = join(modsDir, name, 'romfs', f.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, f.data);
  console.log(f.path, f.data.length);
}
console.log('warnings', r.warnings.filter((w) => !w.includes('baldosas')), r.warnings.length);
console.log('stats', r.stats, 'spawn', r.spawn, ((Date.now() - t0) / 1000).toFixed(1) + 's');
