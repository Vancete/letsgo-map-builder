// GFLXPACK (.gfpak): Game Freak's archive. Files are named only by FNV-1a 64 hashes of their paths (full path, and the
// file name within its folder); this reader keeps the hashes and lets callers resolve names they can guess.
//
//   0x00 "GFLXPACK"  0x08 u32 version  0x0C u32 relocated  0x10 u32 fileCount  0x14 u32 folderCount
//   0x18 u64 fileTable  0x20 u64 pathHashes  0x28 u64[folderCount] folders
//   folder: u64 nameHash, u32 count, u32 pad, then count x { u64 fileNameHash, u32 index, u32 pad }
//   file entry (0x18): u16 level, u16 compression (0 none, 1 zlib, 2 lz4, 3 oodle), u32 size, u32 packedSize, u32 pad,
//                      u64 offset
import { lz4CompressBlock, lz4DecompressBlock } from './lz4.ts';

export interface GfpakFile {
  index: number;
  pathHash: bigint;
  nameHash: bigint;
  folderHash: bigint;
  compression: number;
  size: number;
  packedSize: number;
  offset: number;
}

export const FNV64_OFFSET = 0xcbf29ce484222645n;
const FNV64_PRIME = 0x00000100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function fnv1a64(s: string): bigint {
  let h = FNV64_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i) & 0xff);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h;
}

export function hashHex(h: bigint): string {
  return h.toString(16).padStart(16, '0');
}

export class Gfpak {
  readonly files: GfpakFile[] = [];
  private dv: DataView;

  readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = new TextDecoder().decode(data.subarray(0, 8));
    if (magic !== 'GFLXPACK') throw new Error('not a GFLXPACK');
    const fileCount = this.dv.getUint32(0x10, true);
    const folderCount = this.dv.getUint32(0x14, true);
    const fileTable = Number(this.dv.getBigUint64(0x18, true));
    const pathHashes = Number(this.dv.getBigUint64(0x20, true));
    for (let i = 0; i < fileCount; i++) {
      const e = fileTable + i * 0x18;
      this.files.push({
        index: i,
        pathHash: this.dv.getBigUint64(pathHashes + i * 8, true),
        nameHash: 0n,
        folderHash: 0n,
        compression: this.dv.getUint16(e + 2, true),
        size: this.dv.getUint32(e + 4, true),
        packedSize: this.dv.getUint32(e + 8, true),
        offset: Number(this.dv.getBigUint64(e + 0x10, true)),
      });
    }
    for (let f = 0; f < folderCount; f++) {
      const p = Number(this.dv.getBigUint64(0x28 + f * 8, true));
      const folderHash = this.dv.getBigUint64(p, true);
      const count = this.dv.getUint32(p + 8, true);
      for (let k = 0; k < count; k++) {
        const q = p + 0x10 + k * 0x10;
        const idx = this.dv.getUint32(q + 8, true);
        const file = this.files[idx];
        if (file) {
          file.nameHash = this.dv.getBigUint64(q, true);
          file.folderHash = folderHash;
        }
      }
    }
  }

  read(file: GfpakFile): Uint8Array {
    const raw = this.data.subarray(file.offset, file.offset + file.packedSize);
    switch (file.compression) {
      case 0:
        return raw.slice();
      case 2:
        return lz4DecompressBlock(raw, file.size);
      default:
        throw new Error(`gfpak: compression ${file.compression} not supported`);
    }
  }

  byPath(path: string): GfpakFile | undefined {
    const h = fnv1a64(path);
    return this.files.find((f) => f.pathHash === h);
  }
}

// What a file holds, from its first bytes
export function sniff(d: Uint8Array): string {
  const m4 = String.fromCharCode(d[0], d[1], d[2], d[3]);
  if (m4 === 'BNTX') return 'bntx';
  if (d.length > 8) {
    // FlatBuffers with a file identifier at 4..8 would show here; GFBMDL has none, its root table follows
    const id = String.fromCharCode(d[4], d[5], d[6], d[7]);
    if (/^[A-Z]{4}$/.test(id)) return 'fb:' + id;
  }
  return 'bin';
}

// Writes a GFLXPACK from (pathHash, nameHash, data) entries, one folder, LZ4 compressed. Keeps the layout of the game's
// packs: header, path hashes, folder table, file table, then the data (16-aligned).
export interface GfpakEntry {
  pathHash: bigint;
  nameHash: bigint;
  folderHash: bigint;
  data: Uint8Array;
}

export function writeGfpak(entries: GfpakEntry[]): Uint8Array {
  const folders = new Map<bigint, number[]>();
  entries.forEach((e, i) => {
    const l = folders.get(e.folderHash);
    l ? l.push(i) : folders.set(e.folderHash, [i]);
  });
  const packed = entries.map((e) => lz4CompressBlock(e.data));
  const align = (n: number, a: number) => (n + a - 1) & ~(a - 1);
  const headerSize = 0x28 + folders.size * 8;
  const pathHashes = headerSize;
  let p = pathHashes + entries.length * 8;
  const folderOffs: number[] = [];
  for (const [, idx] of folders) {
    folderOffs.push(p);
    p += 0x10 + idx.length * 0x10;
  }
  const fileTable = p;
  p += entries.length * 0x18;
  const dataOffs: number[] = [];
  for (const d of packed) {
    p = align(p, 16);
    dataOffs.push(p);
    p += d.length;
  }
  const out = new Uint8Array(align(p, 16));
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('GFLXPACK'));
  dv.setUint32(8, 0x1000, true);
  dv.setUint32(0x10, entries.length, true);
  dv.setUint32(0x14, folders.size, true);
  dv.setBigUint64(0x18, BigInt(fileTable), true);
  dv.setBigUint64(0x20, BigInt(pathHashes), true);
  folderOffs.forEach((o, i) => dv.setBigUint64(0x28 + i * 8, BigInt(o), true));
  entries.forEach((e, i) => dv.setBigUint64(pathHashes + i * 8, e.pathHash, true));
  [...folders].forEach(([hash, idx], fi) => {
    const o = folderOffs[fi];
    dv.setBigUint64(o, hash, true);
    dv.setUint32(o + 8, idx.length, true);
    dv.setUint32(o + 12, 0xcc, true);
    idx.forEach((i, k) => {
      dv.setBigUint64(o + 0x10 + k * 0x10, entries[i].nameHash, true);
      dv.setUint32(o + 0x18 + k * 0x10, i, true);
      dv.setUint32(o + 0x1c + k * 0x10, 0xcc, true);
    });
  });
  entries.forEach((e, i) => {
    const o = fileTable + i * 0x18;
    dv.setUint16(o, 9, true);
    dv.setUint16(o + 2, 2, true);
    dv.setUint32(o + 4, e.data.length, true);
    dv.setUint32(o + 8, packed[i].length, true);
    dv.setUint32(o + 12, 0xcc, true);
    dv.setBigUint64(o + 0x10, BigInt(dataOffs[i]), true);
    out.set(packed[i], dataOffs[i]);
  });
  return out;
}
