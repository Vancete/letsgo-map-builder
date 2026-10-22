// Settings, game folder detection, map files and mod export.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  if (doc.format !== 'letsgo-map') throw new Error('Not a Let\'s Go Map Builder map file');
  return doc;
}

export function writeMap(path: string, doc: MapDocument) {
  // indented, with number arrays (positions, rotations...) on one line
  const json = JSON.stringify(doc, null, 1).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (_m, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`);
  writeFileSync(path, json);
}

export function safeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'map';
}

// The mod folder Let's Go Recomp lists (it has a romfs/): the game files the map builds into go under romfs/ (written by
// the caller); the map itself rides along at romfs/bin/lgmap/<name>.lgmap, a path the game never reads, to open it
// again in the editor.
export function exportMod(
  modsDir: string,
  doc: MapDocument,
  editorVersion: string,
  game: { slot: string; entrance: { map: string; zone: string; at: number[] } },
): string {
  const name = safeName(doc.name);
  const root = join(modsDir, name);
  if (existsSync(join(root, 'romfs'))) rmSync(join(root, 'romfs'), { recursive: true, force: true });
  const mapDir = join(root, 'romfs', 'bin', 'lgmap');
  mkdirSync(mapDir, { recursive: true });
  writeMap(join(mapDir, `${name}.lgmap`), doc);
  const manifest = {
    type: 'letsgo-map-mod',
    name: doc.name,
    author: doc.author,
    description: doc.description,
    map: `romfs/bin/lgmap/${name}.lgmap`,
    slot: game.slot,
    entrance: game.entrance,
    objects: doc.objects.length,
    editor: `letsgo-map-builder ${editorVersion}`,
    exportedAt: new Date().toISOString(),
  };
  writeFileSync(join(root, 'mapmod.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(root, 'README.txt'),
    `${doc.name}${doc.author ? ` - ${doc.author}` : ''}

${doc.description}

` +
      `A map made with Let's Go Map Builder, for Let's Go Recomp. Enable this mod in the launcher's Mods tab.
` +
      `A teleport pad appears in Pallet Town (on the path between the northern houses) that leads to the map;
` +
      `in the map, the exit pad takes you back to Pallet Town.
` +
      `It replaces placement.gfpak and script_amx.gfpak: don't combine it with other mods that change those files.
`,
  );
  return root;
}

export function addRecent(s: AppSettings, path: string): AppSettings {
  const recent = [path, ...s.recent.filter((r) => r !== path)].slice(0, 10);
  return { ...s, recent };
}

export { basename };
