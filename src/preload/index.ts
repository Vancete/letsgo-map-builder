import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, Catalog, ExtractProgress, MapDocument } from '../shared/types';

export interface ExportResult {
  dir: string;
  warnings: string[];
  stats: { objects: number; meshes: number; materials: number; textures: number; triangles: number };
}

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
  validateGame: (p: string): Promise<boolean> => ipcRenderer.invoke('game:validate', p),
  detectGame: (): Promise<string[]> => ipcRenderer.invoke('game:detect'),
  pickGame: (file: boolean): Promise<{ path: string; valid: boolean } | null> => ipcRenderer.invoke('game:pick', file),
  getCatalog: (): Promise<Catalog | null> => ipcRenderer.invoke('catalog:get'),
  buildCatalog: (): Promise<Catalog> => ipcRenderer.invoke('catalog:build'),
  onCatalogProgress: (fn: (p: ExtractProgress) => void) => {
    const h = (_e: unknown, p: ExtractProgress) => fn(p);
    ipcRenderer.on('catalog:progress', h);
    return () => {
      ipcRenderer.off('catalog:progress', h);
    };
  },
  loadModel: (id: string): Promise<Uint8Array> => ipcRenderer.invoke('asset:model', id),
  listThumbs: (): Promise<string[]> => ipcRenderer.invoke('thumb:list'),
  saveThumb: (id: string, png: Uint8Array): Promise<void> => ipcRenderer.invoke('thumb:save', id, png),
  clearThumbs: (): Promise<void> => ipcRenderer.invoke('thumb:clear'),
  openMap: (): Promise<{ path: string; doc: MapDocument } | null> => ipcRenderer.invoke('map:open'),
  openMapPath: (path: string): Promise<{ path: string; doc: MapDocument }> => ipcRenderer.invoke('map:openPath', path),
  saveMap: (path: string | null, doc: MapDocument): Promise<string | null> => ipcRenderer.invoke('map:save', path, doc),
  pickModsDir: (): Promise<string | null> => ipcRenderer.invoke('mod:pickDir'),
  defaultModsDir: (): Promise<string> => ipcRenderer.invoke('mod:defaultDir'),
  exportMod: (doc: MapDocument, slot: string, modsDir: string): Promise<ExportResult> => ipcRenderer.invoke('mod:export', doc, slot, modsDir),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:open', p),
  setTitle: (t: string): Promise<void> => ipcRenderer.invoke('app:title', t),
  closeApp: (): Promise<void> => ipcRenderer.invoke('app:close'),
  info: (): Promise<{ version: string; cacheDir: string }> => ipcRenderer.invoke('app:info'),
  onCloseRequested: (fn: () => void) => {
    const h = () => fn();
    ipcRenderer.on('app:closeRequested', h);
    return () => {
      ipcRenderer.off('app:closeRequested', h);
    };
  },
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
