// The game's RomFS, either extracted to a folder (bin/...) or as the romfs.bin image Let's Go Recomp keeps in
// <install>/extracted. Paths are RomFS paths ("bin/archive/field/buildmodel.gfpak").
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface GameFS {
  readonly label: string;
  exists(path: string): boolean;
  read(path: string): Uint8Array;
  // files directly in a directory (names only), and subdirectories
  list(dir: string): { files: string[]; dirs: string[] };
}

class FolderFS implements GameFS {
  readonly label: string;
  private root: string;
  constructor(root: string) {
    this.root = root;
    this.label = root;
  }
  exists(p: string) {
    return existsSync(join(this.root, p));
  }
  read(p: string) {
    return new Uint8Array(readFileSync(join(this.root, p)));
  }
  list(dir: string) {
    const files: string[] = [];
    const dirs: string[] = [];
    const base = join(this.root, dir);
    if (!existsSync(base)) return { files, dirs };
    for (const e of readdirSync(base)) (statSync(join(base, e)).isDirectory() ? dirs : files).push(e);
    return { files, dirs };
  }
}

interface RomDir {
  dirs: Map<string, RomDir>;
  files: Map<string, { off: number; size: number }>;
}

// RomFS level 3 image: 0x50 header (u64 pairs: dir hash, dir meta, file hash, file meta, then data offset)
class RomfsImageFS implements GameFS {
  readonly label: string;
  private fd: number;
  private root: RomDir = { dirs: new Map(), files: new Map() };

  constructor(path: string) {
    this.label = path;
    this.fd = openSync(path, 'r');
    const head = this.pread(0, 0x50);
    const dv = new DataView(head.buffer);
    const u64 = (o: number) => Number(dv.getBigUint64(o, true));
    const dirMetaOff = u64(0x18);
    const dirMetaSize = u64(0x20);
    const fileMetaOff = u64(0x38);
    const fileMetaSize = u64(0x40);
    const dataOff = u64(0x48);
    const dm = this.pread(dirMetaOff, dirMetaSize);
    const fm = this.pread(fileMetaOff, fileMetaSize);
    const ddv = new DataView(dm.buffer);
    const fdv = new DataView(fm.buffer);
    const td = new TextDecoder();
    const NONE = 0xffffffff;
    const walkFiles = (first: number, into: RomDir) => {
      for (let f = first; f !== NONE; ) {
        const off = Number(fdv.getBigUint64(f + 8, true));
        const size = Number(fdv.getBigUint64(f + 16, true));
        const nlen = fdv.getUint32(f + 28, true);
        into.files.set(td.decode(fm.subarray(f + 32, f + 32 + nlen)), { off: dataOff + off, size });
        f = fdv.getUint32(f + 4, true);
      }
    };
    const walkDir = (d: number, into: RomDir) => {
      walkFiles(ddv.getUint32(d + 12, true), into);
      for (let c = ddv.getUint32(d + 8, true); c !== NONE; ) {
        const nlen = ddv.getUint32(c + 20, true);
        const sub: RomDir = { dirs: new Map(), files: new Map() };
        into.dirs.set(td.decode(dm.subarray(c + 24, c + 24 + nlen)), sub);
        walkDir(c, sub);
        c = ddv.getUint32(c + 4, true);
      }
    };
    walkDir(0, this.root);
  }

  private pread(off: number, size: number): Uint8Array {
    const b = Buffer.alloc(size);
    let done = 0;
    while (done < size) {
      const n = readSync(this.fd, b, done, Math.min(size - done, 1 << 30), off + done);
      if (n <= 0) throw new Error('romfs: short read');
      done += n;
    }
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }

  private dir(path: string): RomDir | undefined {
    let d: RomDir | undefined = this.root;
    for (const part of path.split('/').filter(Boolean)) d = d?.dirs.get(part);
    return d;
  }

  private file(path: string) {
    const i = path.lastIndexOf('/');
    return this.dir(path.slice(0, Math.max(0, i)))?.files.get(path.slice(i + 1));
  }

  exists(p: string) {
    return !!this.file(p) || !!this.dir(p);
  }
  read(p: string) {
    const f = this.file(p);
    if (!f) throw new Error(`romfs: ${p} not found`);
    return this.pread(f.off, f.size);
  }
  list(dir: string) {
    const d = this.dir(dir);
    return { files: d ? [...d.files.keys()] : [], dirs: d ? [...d.dirs.keys()] : [] };
  }
  close() {
    closeSync(this.fd);
  }
}

const MARK = 'bin/archive/field/buildmodel.gfpak';

// Accepts: a romfs folder (holding bin/), a folder holding romfs/ (or a Let's Go Recomp install: extracted/romfs.bin),
// an extracted dump folder holding a title-id folder with bin/, or the romfs.bin file itself.
export function openGameFS(path: string): GameFS | null {
  if (!path || !existsSync(path)) return null;
  const st = statSync(path);
  if (st.isFile()) {
    try {
      const fs = new RomfsImageFS(path);
      return fs.exists(MARK) ? fs : null;
    } catch {
      return null;
    }
  }
  const candidates = [path, join(path, 'romfs'), join(path, 'extracted', 'romfs.bin'), join(path, 'romfs.bin')];
  try {
    for (const e of readdirSync(path)) {
      const p = join(path, e);
      if (statSync(p).isDirectory()) candidates.push(p, join(p, 'romfs'), join(p, 'extracted', 'romfs.bin'));
    }
  } catch {
    /* unreadable */
  }
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (statSync(c).isDirectory()) {
      if (existsSync(join(c, MARK))) return new FolderFS(c);
    } else {
      const fs = openGameFS(c);
      if (fs) return fs;
    }
  }
  return null;
}
