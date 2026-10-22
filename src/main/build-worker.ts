// Worker thread: builds a map into a Let's Go Recomp mod (shared/mapbuild.ts) and writes it to the mods folder.
import { parentPort, workerData } from 'node:worker_threads';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openGameFS } from '../shared/formats/gamefs.ts';
import { buildMapMod, DEFAULT_ENTRANCE } from '../shared/mapbuild.ts';
import type { Catalog, MapDocument } from '../shared/types.ts';
import { exportMod } from './files.ts';

interface Job {
  gamePath: string;
  cacheDir: string;
  modsDir: string;
  doc: MapDocument;
  slot: string;
  version: string;
}

const job = workerData as Job;
try {
  const fs = openGameFS(job.gamePath);
  if (!fs) throw new Error("The game's files were not found");
  const catalog = JSON.parse(readFileSync(join(job.cacheDir, 'catalog.json'), 'utf8')) as Catalog;
  const result = buildMapMod({
    fs,
    doc: job.doc,
    assets: new Map(catalog.assets.map((a) => [a.id, a])),
    selection: (id) => {
      const p = join(job.cacheDir, 'models', `${id}.sel`);
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
    slot: job.slot,
    entrance: DEFAULT_ENTRANCE,
    log: (s) => parentPort?.postMessage({ type: 'log', message: s }),
  });
  const root = exportMod(job.modsDir, job.doc, job.version, { slot: job.slot, entrance: DEFAULT_ENTRANCE });
  for (const f of result.files) {
    const out = join(root, 'romfs', f.path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, f.data);
  }
  parentPort?.postMessage({ type: 'done', dir: root, warnings: result.warnings, stats: result.stats });
} catch (e) {
  parentPort?.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
}
