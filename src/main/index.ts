import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import createExtractWorker from './extract-worker?nodeWorker';
import createBuildWorker from './build-worker?nodeWorker';
import { CATALOG_VERSION, type AppSettings, type Catalog, type MapDocument } from '../shared/types.ts';
import { addRecent, detectGamePaths, guessModsPath, loadSettings, readMap, saveSettings, validGamePath, writeMap } from './files.ts';

protocol.registerSchemesAsPrivileged([
  { scheme: 'lgcache', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// testing through the DevTools protocol (scripts/cdp.ts): keep painting while the window is covered
if (app.commandLine.hasSwitch('remote-debugging-port')) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

const userDir = app.getPath('userData');
// not 'cache': on Windows that's Chromium's own Cache folder, which it clears
const cacheDir = join(userDir, 'library');
const settingsFile = join(userDir, 'settings.json');
let settings: AppSettings = loadSettings(settingsFile);
let win: BrowserWindow | null = null;
let building = false;

function setSettings(patch: Partial<AppSettings>) {
  settings = { ...settings, ...patch };
  saveSettings(settingsFile, settings);
  return settings;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1b1d23',
    title: "Let's Go Map Builder",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: !app.commandLine.hasSwitch('remote-debugging-port'),
    },
  });
  win.on('close', (e) => {
    // the renderer asks first when the map has unsaved changes
    if (!(win as BrowserWindow & { forceClose?: boolean }).forceClose) {
      e.preventDefault();
      win?.webContents.send('app:closeRequested');
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

function readCatalog(): Catalog | null {
  const p = join(cacheDir, 'catalog.json');
  if (!existsSync(p)) return null;
  try {
    const c = JSON.parse(readFileSync(p, 'utf8')) as Catalog;
    return c.version === CATALOG_VERSION ? c : null;
  } catch {
    return null;
  }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => setSettings(patch));

  ipcMain.handle('game:validate', (_e, p: string) => validGamePath(p));
  ipcMain.handle('game:detect', () => detectGamePaths(homedir()));
  ipcMain.handle('game:pick', async (_e, file: boolean) => {
    const r = await dialog.showOpenDialog(win!, {
      title: file ? 'Selecciona romfs.bin' : 'Selecciona la carpeta del juego (romfs, extracción o instalación de Let\'s Go Recomp)',
      properties: file ? ['openFile'] : ['openDirectory'],
      filters: file ? [{ name: 'RomFS', extensions: ['bin', 'romfs'] }] : undefined,
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    return { path: p, valid: validGamePath(p) };
  });

  ipcMain.handle('catalog:get', () => readCatalog());
  ipcMain.handle('catalog:build', () => {
    if (building) return Promise.reject(new Error('Ya se está generando el catálogo'));
    if (!validGamePath(settings.gamePath)) return Promise.reject(new Error('Carpeta del juego no válida'));
    building = true;
    mkdirSync(cacheDir, { recursive: true });
    return new Promise<Catalog>((resolve, reject) => {
      const w = createExtractWorker({ workerData: { gamePath: settings.gamePath, cacheDir } });
      w.on('message', (m: { type: string; progress?: unknown; message?: string }) => {
        if (m.type === 'progress') win?.webContents.send('catalog:progress', m.progress);
        else if (m.type === 'done') {
          building = false;
          const c = readCatalog();
          c ? resolve(c) : reject(new Error('El catálogo no se pudo leer'));
        } else if (m.type === 'error') {
          building = false;
          reject(new Error(m.message));
        }
      });
      w.on('error', (e) => {
        building = false;
        reject(e);
      });
    });
  });

  ipcMain.handle('asset:model', (_e, id: string) => {
    const p = join(cacheDir, 'models', id + '.lgm');
    return new Uint8Array(inflateSync(readFileSync(p)));
  });

  ipcMain.handle('thumb:list', () => {
    const d = join(cacheDir, 'thumbs');
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)) : [];
  });
  ipcMain.handle('thumb:save', (_e, id: string, png: Uint8Array) => {
    const d = join(cacheDir, 'thumbs');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, id + '.png'), png);
  });
  ipcMain.handle('thumb:clear', () => {
    rmSync(join(cacheDir, 'thumbs'), { recursive: true, force: true });
  });

  const mapFilters = [{ name: "Mapa de Let's Go", extensions: ['lgmap'] }];
  ipcMain.handle('map:open', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Abrir mapa', filters: mapFilters, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const doc = readMap(r.filePaths[0]);
    setSettings(addRecent(settings, r.filePaths[0]));
    return { path: r.filePaths[0], doc };
  });
  ipcMain.handle('map:openPath', (_e, path: string) => {
    const doc = readMap(path);
    setSettings(addRecent(settings, path));
    return { path, doc };
  });
  ipcMain.handle('map:save', async (_e, path: string | null, doc: MapDocument) => {
    let target = path;
    if (!target) {
      const r = await dialog.showSaveDialog(win!, { title: 'Guardar mapa', filters: mapFilters, defaultPath: `${doc.name || 'mapa'}.lgmap` });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    writeMap(target, doc);
    setSettings(addRecent(settings, target));
    return target;
  });
  ipcMain.handle('mod:pickDir', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Carpeta mods/ de Let's Go Recomp",
      defaultPath: settings.modsPath || guessModsPath(settings.gamePath) || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    setSettings({ modsPath: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('mod:defaultDir', () => settings.modsPath || guessModsPath(settings.gamePath) || '');
  ipcMain.handle('mod:export', (_e, doc: MapDocument, slot: string, modsDir: string) => {
    if (!validGamePath(settings.gamePath)) return Promise.reject(new Error('Carpeta del juego no válida'));
    mkdirSync(modsDir, { recursive: true });
    setSettings({ modsPath: modsDir });
    return new Promise((resolve, reject) => {
      const w = createBuildWorker({ workerData: { gamePath: settings.gamePath, cacheDir, modsDir, doc, slot, version: app.getVersion() } });
      w.on('message', (m: { type: string; message?: string }) => {
        if (m.type === 'log') win?.webContents.send('mod:log', m.message);
        else if (m.type === 'done') resolve(m);
        else if (m.type === 'error') reject(new Error(m.message));
      });
      w.on('error', reject);
    });
  });
  ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p));
  ipcMain.handle('app:close', () => {
    if (win) {
      (win as BrowserWindow & { forceClose?: boolean }).forceClose = true;
      win.close();
    }
  });
  ipcMain.handle('app:title', (_e, t: string) => win?.setTitle(t));
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), cacheDir }));
}

app.whenReady().then(() => {
  protocol.handle('lgcache', (req) => {
    const u = new URL(req.url);
    const file = join(cacheDir, u.hostname, decodeURIComponent(u.pathname));
    if (!file.startsWith(cacheDir)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
