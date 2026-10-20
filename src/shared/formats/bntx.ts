// BNTX: Switch texture container. Reads each texture's first mip, unswizzled from the Tegra block-linear layout, and
// decodes it to RGBA8.
import { decodeBC1, decodeBC2, decodeBC3, decodeBC4, decodeBC5, decodeBC7 } from './bcn.ts';

export interface BntxTexture {
  name: string;
  format: number; // high byte type, low byte encoding (1 unorm, 6 srgb ...)
  width: number;
  height: number;
  mipCount: number;
  blockHeightLog2: number;
  channelTypes: number;
  data: Uint8Array; // mip 0, swizzled
}

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function parseBntx(u8: Uint8Array): BntxTexture[] {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'BNTX') throw new Error('not BNTX');
  const nx = 0x20;
  const count = dv.getUint32(nx + 4, true);
  const infoPtrs = Number(dv.getBigUint64(nx + 8, true));
  const out: BntxTexture[] = [];
  for (let i = 0; i < count; i++) {
    const p = Number(dv.getBigUint64(infoPtrs + i * 8, true));
    if (String.fromCharCode(...u8.subarray(p, p + 4)) !== 'BRTI') continue;
    const mipCount = dv.getUint16(p + 0x16, true);
    const format = dv.getUint32(p + 0x1c, true);
    const width = dv.getInt32(p + 0x24, true);
    const height = dv.getInt32(p + 0x28, true);
    const layout = dv.getInt32(p + 0x34, true);
    const imageSize = dv.getUint32(p + 0x50, true);
    const channelTypes = dv.getUint32(p + 0x58, true);
    const nameOff = Number(dv.getBigUint64(p + 0x60, true));
    const ptrs = Number(dv.getBigUint64(p + 0x70, true));
    const nameLen = dv.getUint16(nameOff, true);
    const name = new TextDecoder().decode(u8.subarray(nameOff + 2, nameOff + 2 + nameLen));
    const mip0 = Number(dv.getBigUint64(ptrs, true));
    const mip1 = mipCount > 1 ? Number(dv.getBigUint64(ptrs + 8, true)) : mip0 + imageSize;
    out.push({
      name,
      format,
      width,
      height,
      mipCount,
      blockHeightLog2: layout & 7,
      channelTypes,
      data: u8.subarray(mip0, Math.min(mip1, u8.length)),
    });
  }
  return out;
}

interface FormatInfo {
  bpp: number; // bytes per block (or per pixel when blk = 1)
  blk: number; // block width/height
}

const FORMATS: Record<number, FormatInfo> = {
  0x02: { bpp: 1, blk: 1 }, // R8
  0x07: { bpp: 2, blk: 1 }, // R5G6B5
  0x09: { bpp: 2, blk: 1 }, // R8G8
  0x0b: { bpp: 4, blk: 1 }, // R8G8B8A8
  0x0c: { bpp: 4, blk: 1 }, // B8G8R8A8
  0x1a: { bpp: 8, blk: 4 }, // BC1
  0x1b: { bpp: 16, blk: 4 }, // BC2
  0x1c: { bpp: 16, blk: 4 }, // BC3
  0x1d: { bpp: 8, blk: 4 }, // BC4
  0x1e: { bpp: 16, blk: 4 }, // BC5
  0x20: { bpp: 16, blk: 4 }, // BC7
};

export function formatName(format: number): string {
  const names: Record<number, string> = {
    0x02: 'R8', 0x07: 'R5G6B5', 0x09: 'R8G8', 0x0b: 'RGBA8', 0x0c: 'BGRA8', 0x1a: 'BC1', 0x1b: 'BC2', 0x1c: 'BC3',
    0x1d: 'BC4', 0x1e: 'BC5', 0x1f: 'BC6H', 0x20: 'BC7',
  };
  return (names[format >> 8] ?? `0x${(format >> 8).toString(16)}`) + ((format & 0xff) === 6 ? '_SRGB' : '');
}

const divUp = (a: number, b: number) => Math.floor((a + b - 1) / b);
const pow2RoundUp = (x: number) => {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
};

// Tegra X1 block linear -> linear, for one 2D surface. w/h in blocks, bpp in bytes per block.
function deswizzle(w: number, h: number, bpp: number, blockHeightLog2: number, src: Uint8Array): Uint8Array {
  const blockHeight = 1 << blockHeightLog2;
  const widthInGobs = divUp(w * bpp, 64);
  const out = new Uint8Array(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const gobRowBase =
      Math.floor(y / (8 * blockHeight)) * 512 * blockHeight * widthInGobs + Math.floor((y % (8 * blockHeight)) / 8) * 512;
    const yIn = Math.floor((y % 8) / 2) * 64 + (y % 2) * 16;
    for (let x = 0; x < w; x++) {
      const xb = x * bpp;
      const addr =
        gobRowBase +
        Math.floor(xb / 64) * 512 * blockHeight +
        Math.floor((xb % 64) / 32) * 256 +
        yIn +
        Math.floor((xb % 32) / 16) * 32 +
        (xb % 16);
      const dst = (y * w + x) * bpp;
      if (addr + bpp <= src.length) out.set(src.subarray(addr, addr + bpp), dst);
    }
  }
  return out;
}

export function decodeTexture(t: BntxTexture): RgbaImage | null {
  const type = t.format >> 8;
  const fi = FORMATS[type];
  if (!fi) return null;
  const bw = divUp(t.width, fi.blk);
  const bh = divUp(t.height, fi.blk);
  let bhl = t.blockHeightLog2;
  if (pow2RoundUp(bh) < (1 << bhl) * 8) bhl = Math.max(0, bhl - 1);
  // a texture this small may sit in fewer GOBs than its header says
  while (bhl > 0 && pow2RoundUp(bh) <= (1 << (bhl - 1)) * 8) bhl--;
  const lin = deswizzle(bw, bh, fi.bpp, bhl, t.data);
  const W = t.width;
  const H = t.height;
  let rgba: Uint8Array;
  switch (type) {
    case 0x1a: rgba = decodeBC1(lin, W, H); break;
    case 0x1b: rgba = decodeBC2(lin, W, H); break;
    case 0x1c: rgba = decodeBC3(lin, W, H); break;
    case 0x1d: rgba = decodeBC4(lin, W, H); break;
    case 0x1e: rgba = decodeBC5(lin, W, H); break;
    case 0x20: rgba = decodeBC7(lin, W, H); break;
    default: {
      rgba = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const s = i * fi.bpp;
        const d = i * 4;
        if (type === 0x0b) rgba.set(lin.subarray(s, s + 4), d);
        else if (type === 0x0c) {
          rgba[d] = lin[s + 2]; rgba[d + 1] = lin[s + 1]; rgba[d + 2] = lin[s]; rgba[d + 3] = lin[s + 3];
        } else if (type === 0x02) {
          rgba[d] = rgba[d + 1] = rgba[d + 2] = lin[s]; rgba[d + 3] = 255;
        } else if (type === 0x09) {
          rgba[d] = lin[s]; rgba[d + 1] = lin[s + 1]; rgba[d + 2] = 0; rgba[d + 3] = 255;
        } else if (type === 0x07) {
          const v = lin[s] | (lin[s + 1] << 8);
          rgba[d] = ((v >> 11) & 31) * 255 / 31; rgba[d + 1] = ((v >> 5) & 63) * 255 / 63; rgba[d + 2] = (v & 31) * 255 / 31; rgba[d + 3] = 255;
        }
      }
    }
  }
  return { width: W, height: H, rgba: applyChannelSwizzle(rgba, t.channelTypes) };
}

// channelTypes: one byte per output channel (r,g,b,a) = source: 0 zero, 1 one, 2 red, 3 green, 4 blue, 5 alpha
function applyChannelSwizzle(rgba: Uint8Array, ct: number): Uint8Array {
  const sel = [ct & 0xff, (ct >> 8) & 0xff, (ct >> 16) & 0xff, (ct >> 24) & 0xff];
  if (sel[0] === 2 && sel[1] === 3 && sel[2] === 4 && sel[3] === 5) return rgba;
  if (sel.some((s) => s > 5)) return rgba;
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const s = sel[c];
      out[i + c] = s === 0 ? 0 : s === 1 ? 255 : rgba[i + s - 2];
    }
  }
  return out;
}
