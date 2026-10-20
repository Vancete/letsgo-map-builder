// Editor commands shared by the toolbar, the keyboard and the window.
import { useEditor } from './store';
import { useUi } from './ui';
import { ThumbnailRenderer } from './three/thumbs';
import { clearTemplates } from './three/models';
import type { MapDocument } from '@shared/types';

const ed = () => useEditor.getState();
const ui = () => useUi.getState();

// before throwing away unsaved changes: true when it's fine to go on
export async function confirmDiscard(): Promise<boolean> {
  if (!ed().dirty) return true;
  const r = await ui().ask('Cambios sin guardar', `"${ed().doc.name}" tiene cambios sin guardar.`, [
    { label: 'Cancelar', value: 'cancel' },
    { label: 'Descartar', value: 'discard' },
    { label: 'Guardar', value: 'save', primary: true },
  ]);
  if (r === 'save') return saveMap(false);
  return r === 'discard';
}

export async function newMap() {
  if (await confirmDiscard()) ed().newMap();
}

export async function openMap(path?: string) {
  if (!(await confirmDiscard())) return;
  try {
    const r = path ? await window.api.openMapPath(path) : await window.api.openMap();
    if (!r) return;
    const missing = r.doc.objects.filter((o) => o.asset && !ed().assets.has(o.asset)).length;
    ed().loadMap(r.doc, r.path);
    ui().notify(missing ? `Mapa abierto: ${missing} objetos no están en el catálogo (se ven como cajas)` : 'Mapa abierto', missing > 0);
  } catch (e) {
    ui().notify(`No se pudo abrir: ${(e as Error).message}`, true);
  }
}

// the document with the sources of the assets it uses, so the file stands alone
function docForSave(): MapDocument {
  const { doc, assets } = ed();
  const used: MapDocument['assets'] = {};
  for (const o of doc.objects) {
    if (!o.asset) continue;
    const a = assets.get(o.asset);
    if (a) used[o.asset] = { name: a.name, category: a.category, source: a.source };
    else if (doc.assets[o.asset]) used[o.asset] = doc.assets[o.asset];
  }
  return { ...doc, assets: used };
}

export async function saveMap(as: boolean): Promise<boolean> {
  try {
    const doc = docForSave();
    const path = await window.api.saveMap(as ? null : ed().filePath, doc);
    if (!path) return false;
    ed().markSaved(path);
    ui().notify('Mapa guardado');
    return true;
  } catch (e) {
    ui().notify(`No se pudo guardar: ${(e as Error).message}`, true);
    return false;
  }
}

export async function exportMod() {
  try {
    const dir = await window.api.exportMod(docForSave());
    if (!dir) return;
    ui().notify(`Mod exportado en ${dir}`);
    const r = await ui().ask('Mod exportado', `El mapa se ha exportado como mod en:\n${dir}`, [
      { label: 'Cerrar', value: 'close' },
      { label: 'Abrir carpeta', value: 'open', primary: true },
    ]);
    if (r === 'open') window.api.openPath(dir);
  } catch (e) {
    ui().notify(`No se pudo exportar: ${(e as Error).message}`, true);
  }
}

// ---- thumbnails

let thumbRun = 0;

export async function generateThumbs(force: boolean) {
  const run = ++thumbRun;
  const { catalog } = ed();
  if (!catalog) return;
  if (force) {
    await window.api.clearThumbs();
    ed().setThumbs([], true);
  } else ed().setThumbs(await window.api.listThumbs());
  const have = ed().thumbs;
  const todo = catalog.assets.filter((a) => !have.has(a.id));
  if (!todo.length) return;
  const r = new ThumbnailRenderer();
  ui().setThumbJob({ done: 0, total: todo.length });
  let pending: string[] = [];
  const flush = () => {
    if (!pending.length) return;
    const t = new Set(ed().thumbs);
    for (const id of pending) t.add(id);
    useEditor.setState({ thumbs: t });
    pending = [];
  };
  for (let i = 0; i < todo.length; i++) {
    if (run !== thumbRun) break;
    try {
      const png = await r.render(todo[i]);
      await window.api.saveThumb(todo[i].id, png);
      pending.push(todo[i].id);
    } catch {
      /* no thumbnail: the card shows a placeholder */
    }
    if (i % 12 === 0) {
      flush();
      ui().setThumbJob({ done: i + 1, total: todo.length });
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  flush();
  r.dispose();
  if (run === thumbRun) ui().setThumbJob(null);
}

export async function rebuildCatalog() {
  const r = await ui().ask(
    'Reconstruir catálogo',
    'Se volverán a extraer todos los modelos y texturas de los archivos del juego y se regenerarán las miniaturas. Tarda alrededor de un minuto.',
    [
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Reconstruir', value: 'ok', primary: true },
    ],
  );
  if (r !== 'ok') return;
  thumbRun++;
  clearTemplates();
  await window.api.clearThumbs();
  ui().setPhase('building');
}

export async function changeGameFolder() {
  if (!(await confirmDiscard())) return;
  thumbRun++;
  ui().setPhase('setup');
}
