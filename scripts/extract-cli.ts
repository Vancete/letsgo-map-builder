// node scripts/extract-cli.ts <game path> <cache dir>: builds the catalog without the UI (for testing)
import { extractCatalog } from '../src/shared/extract.ts';

const t0 = Date.now();
let last = '';
const cat = extractCatalog({
  gamePath: process.argv[2],
  cacheDir: process.argv[3],
  onProgress: (p) => {
    const line = `${p.phase} ${p.done}/${p.total} ${p.message ?? ''}`;
    if (p.phase !== last) console.log(line);
    last = p.phase;
  },
});
const by: Record<string, number> = {};
for (const a of cat.assets) by[a.category] = (by[a.category] ?? 0) + 1;
console.log(cat.assets.length, 'assets', by, ((Date.now() - t0) / 1000).toFixed(1) + 's');
