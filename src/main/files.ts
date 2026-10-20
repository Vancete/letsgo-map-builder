// Settings, game folder detection, map files and mod export.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { openGameFS } from '../shared/formats/gamefs.ts';
import type { AppSettings, MapDocument } from '../shared/types.ts';

export function loadSettings(file: string): AppSettings {
  const def: AppSettings = { gamePath: '', modsPath: '', recent: [] };
  try {
    return { ...def, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return def;
  }
}

export function saveSettings(file: string, s: AppSettings) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2));
}

export function validGamePath(p: string): boolean {
  return !!p && !!openGameFS(p);
}

// Let's Go Recomp installs and extracted dumps in the usual places: drive roots and the user's folders, two levels down
export function detectGamePaths(home: string): string[] {
  const roots: string[] = [];
  for (const d of 'CDEFGH') if (existsSync(`${d}:\\`)) roots.push(`${d}:\\`);
  roots.push(home, join(home, 'Documents'), join(home, 'Downloads'), join(home, 'Desktop'), join(home, 'Games'));
  const found: string[] = [];
  const looks = /let.?s.?go|letsgo|pokemon|pok[eé]mon|010003F003A34000|0100187003A36000|lgpe/i;
  const tryDir = (p: string) => {
    if (found.length < 8 && validGamePath(p)) found.push(p);
  };
  for (const r of roots) {
    let entries: string[] = [];
    try {
      entries = readdirSync(r);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!looks.test(e)) continue;
      const p = join(r, e);
      try {
        if (!statSync(p).isDirectory()) continue;
      } catch {
        continue;
      }
      tryDir(p);
      try {
        for (const e2 of readdirSync(p)) {
          const p2 = join(p, e2);
          if (statSync(p2).isDirectory()) tryDir(p2);
        }
      } catch {
        /* unreadable */
      }
    }
  }
  return [...new Set(found)];
}

// The mods folder of the Let's Go Recomp install the game files come from (<install>/mods next to LetsGoRecomp.exe)
export function guessModsPath(gamePath: string): string {
  let p = gamePath;
  for (let i = 0; i < 4 && p; i++) {
    if (existsSync(join(p, 'LetsGoRecomp.exe'))) return join(p, 'mods');
    const parent = dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return '';
}

export function readMap(path: string): MapDocument {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as MapDocument;
  if (doc.format !== 'letsgo-map') throw new Error('No es un archivo de mapa de Let\'s Go Map Builder');
  return doc;
}

export function writeMap(path: string, doc: MapDocument) {
  // indented, with number arrays (positions, rotations...) on one line
  const json = JSON.stringify(doc, null, 1).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (_m, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`);
  writeFileSync(path, json);
}

export function safeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mapa';
}

// A mod Let's Go Recomp lists (a folder with romfs/): the map rides in the RomFS at bin/lgmap/<name>.lgmap, a path the
// game itself never reads, for the runtime's map loader to pick up through the mods' LayeredFS.
export function exportMod(modsDir: string, doc: MapDocument, editorVersion: string): string {
  const name = safeName(doc.name);
  const root = join(modsDir, name);
  const mapDir = join(root, 'romfs', 'bin', 'lgmap');
  mkdirSync(mapDir, { recursive: true });
  writeMap(join(mapDir, `${name}.lgmap`), doc);
  const manifest = {
    type: 'letsgo-map-mod',
    name: doc.name,
    author: doc.author,
    description: doc.description,
    map: `romfs/bin/lgmap/${name}.lgmap`,
    romfsPath: `bin/lgmap/${name}.lgmap`,
    objects: doc.objects.length,
    editor: `letsgo-map-builder ${editorVersion}`,
    exportedAt: new Date().toISOString(),
  };
  writeFileSync(join(root, 'mapmod.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(root, 'README.txt'),
    `${doc.name}${doc.author ? ` - ${doc.author}` : ''}\r\n\r\n${doc.description}\r\n\r\n` +
      `Mapa creado con Let's Go Map Builder. Copia esta carpeta en la carpeta mods/ de Let's Go Recomp.\r\n` +
      `El mapa está en romfs/bin/lgmap/${name}.lgmap (formato JSON documentado en el editor).\r\n`,
  );
  return root;
}

export function addRecent(s: AppSettings, path: string): AppSettings {
  const recent = [path, ...s.recent.filter((r) => r !== path)].slice(0, 10);
  return { ...s, recent };
}

export { basename };
