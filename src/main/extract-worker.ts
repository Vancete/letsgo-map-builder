// Worker thread: builds the catalog off the main process, posting progress.
import { parentPort, workerData } from 'node:worker_threads';
import { extractCatalog } from '../shared/extract.ts';

const { gamePath, cacheDir } = workerData as { gamePath: string; cacheDir: string };
try {
  let last = 0;
  const catalog = extractCatalog({
    gamePath,
    cacheDir,
    onProgress: (p) => {
      const now = Date.now();
      if (now - last > 80 || p.done === p.total) {
        last = now;
        parentPort?.postMessage({ type: 'progress', progress: p });
      }
    },
  });
  parentPort?.postMessage({ type: 'done', count: catalog.assets.length });
} catch (e) {
  parentPort?.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
}
