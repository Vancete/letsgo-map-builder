// Block-compressed texture decoders (BC1-BC5, BC7) to RGBA8. Input: linear blocks, row major.

function rgb565(v: number, out: number[], o: number) {
  const r = (v >> 11) & 31;
  const g = (v >> 5) & 63;
  const b = v & 31;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 2) | (g >> 4);
  out[o + 2] = (b << 3) | (b >> 2);
}

// colors of a BC1 block into pal (4 x rgba); returns false-free
function bc1Palette(src: Uint8Array, s: number, pal: number[], forceFour: boolean) {
  const c0 = src[s] | (src[s + 1] << 8);
  const c1 = src[s + 2] | (src[s + 3] << 8);
  rgb565(c0, pal, 0);
  rgb565(c1, pal, 4);
  pal[3] = pal[7] = 255;
  if (c0 > c1 || forceFour) {
    for (let c = 0; c < 3; c++) {
      pal[8 + c] = Math.round((2 * pal[c] + pal[4 + c]) / 3);
      pal[12 + c] = Math.round((pal[c] + 2 * pal[4 + c]) / 3);
    }
    pal[11] = pal[15] = 255;
  } else {
    for (let c = 0; c < 3; c++) {
      pal[8 + c] = (pal[c] + pal[4 + c]) >> 1;
      pal[12 + c] = 0;
    }
    pal[11] = 255;
    pal[15] = 0;
  }
}

function forBlocks(w: number, h: number, bytes: number, fn: (bi: number, px: number, py: number) => void) {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) fn((by * bw + bx) * bytes, bx * 4, by * 4);
}

function put(out: Uint8Array, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x >= w || y >= h) return;
  const o = (y * w + x) * 4;
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = a;
}

export function decodeBC1(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const pal = new Array<number>(16).fill(0);
  forBlocks(w, h, 8, (s, px, py) => {
    bc1Palette(src, s, pal, false);
    const idx = src[s + 4] | (src[s + 5] << 8) | (src[s + 6] << 16) | (src[s + 7] << 24);
    for (let i = 0; i < 16; i++) {
      const k = ((idx >>> (2 * i)) & 3) * 4;
      put(out, w, h, px + (i & 3), py + (i >> 2), pal[k], pal[k + 1], pal[k + 2], pal[k + 3]);
    }
  });
  return out;
}

function alphaPalette(a0: number, a1: number, pal: number[]) {
  pal[0] = a0;
  pal[1] = a1;
  if (a0 > a1) for (let i = 1; i < 7; i++) pal[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
  else {
    for (let i = 1; i < 5; i++) pal[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
    pal[6] = 0;
    pal[7] = 255;
  }
}

// 16 3-bit indices of an alpha block starting at s+2
function alphaIndices(src: Uint8Array, s: number, out: number[]) {
  let lo = src[s + 2] | (src[s + 3] << 8) | (src[s + 4] << 16);
  let hi = src[s + 5] | (src[s + 6] << 8) | (src[s + 7] << 16);
  for (let i = 0; i < 8; i++) {
    out[i] = lo & 7;
    lo >>= 3;
    out[i + 8] = hi & 7;
    hi >>= 3;
  }
}

export function decodeBC2(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const pal = new Array<number>(16).fill(0);
  forBlocks(w, h, 16, (s, px, py) => {
    bc1Palette(src, s + 8, pal, true);
    const idx = src[s + 12] | (src[s + 13] << 8) | (src[s + 14] << 16) | (src[s + 15] << 24);
    for (let i = 0; i < 16; i++) {
      const k = ((idx >>> (2 * i)) & 3) * 4;
      const a4 = (src[s + (i >> 1)] >> ((i & 1) * 4)) & 15;
      put(out, w, h, px + (i & 3), py + (i >> 2), pal[k], pal[k + 1], pal[k + 2], a4 * 17);
    }
  });
  return out;
}

export function decodeBC3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const pal = new Array<number>(16).fill(0);
  const apal = new Array<number>(8).fill(0);
  const aidx = new Array<number>(16).fill(0);
  forBlocks(w, h, 16, (s, px, py) => {
    alphaPalette(src[s], src[s + 1], apal);
    alphaIndices(src, s, aidx);
    bc1Palette(src, s + 8, pal, true);
    const idx = src[s + 12] | (src[s + 13] << 8) | (src[s + 14] << 16) | (src[s + 15] << 24);
    for (let i = 0; i < 16; i++) {
      const k = ((idx >>> (2 * i)) & 3) * 4;
      put(out, w, h, px + (i & 3), py + (i >> 2), pal[k], pal[k + 1], pal[k + 2], apal[aidx[i]]);
    }
  });
  return out;
}

export function decodeBC4(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const apal = new Array<number>(8).fill(0);
  const aidx = new Array<number>(16).fill(0);
  forBlocks(w, h, 8, (s, px, py) => {
    alphaPalette(src[s], src[s + 1], apal);
    alphaIndices(src, s, aidx);
    for (let i = 0; i < 16; i++) {
      const v = apal[aidx[i]];
      put(out, w, h, px + (i & 3), py + (i >> 2), v, v, v, 255);
    }
  });
  return out;
}

export function decodeBC5(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const rp = new Array<number>(8).fill(0);
  const gp = new Array<number>(8).fill(0);
  const ri = new Array<number>(16).fill(0);
  const gi = new Array<number>(16).fill(0);
  forBlocks(w, h, 16, (s, px, py) => {
    alphaPalette(src[s], src[s + 1], rp);
    alphaIndices(src, s, ri);
    alphaPalette(src[s + 8], src[s + 9], gp);
    alphaIndices(src, s + 8, gi);
    for (let i = 0; i < 16; i++) {
      const r = rp[ri[i]];
      const g = gp[gi[i]];
      const nx = r / 127.5 - 1;
      const ny = g / 127.5 - 1;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      put(out, w, h, px + (i & 3), py + (i >> 2), r, g, Math.round((nz * 0.5 + 0.5) * 255), 255);
    }
  });
  return out;
}

// ---- BC7

// mode: subsets, partition bits, rotation bits, index selection bit, color bits, alpha bits, endpoint pbits,
// shared pbits, index bits, secondary index bits
const BC7_MODES = [
  [3, 4, 0, 0, 4, 0, 1, 0, 3, 0],
  [2, 6, 0, 0, 6, 0, 0, 1, 3, 0],
  [3, 6, 0, 0, 5, 0, 0, 0, 2, 0],
  [2, 6, 0, 0, 7, 0, 1, 0, 2, 0],
  [1, 0, 2, 1, 5, 6, 0, 0, 2, 3],
  [1, 0, 2, 0, 7, 8, 0, 0, 2, 2],
  [1, 0, 0, 0, 7, 7, 1, 0, 4, 0],
  [2, 6, 0, 0, 5, 5, 1, 0, 2, 0],
];

const P2 = [
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0,
  0xf000, 0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0,
  0x718e, 0x399c, 0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996,
  0xc33c, 0x9966, 0x0660, 0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718,
  0xccf0, 0x0fcc, 0x7744, 0xee22,
];

const P3 = [
  '0011001102210222', '0001001122112221', '0000200122112211', '0222002200110111', '0000000011221122', '0011001100220022',
  '0022002211111111', '0011001122112211', '0000000011112222', '0000111111112222', '0000111122222222', '0012001200120012',
  '0112011201120112', '0122012201220122', '0011011211221222', '0011200122002220', '0001001101121122', '0111001120012200',
  '0000112211221122', '0022002200221111', '0111011102220222', '0001000122212221', '0000001101220122', '0000110022102210',
  '0122012200110000', '0012001211222222', '0110122112210110', '0000011012211221', '0022110211020022', '0110011020022222',
  '0011012201220011', '0000200022112221', '0000000211221222', '0222002200120011', '0011001200220222', '0120012001200120',
  '0000111122220000', '0120120120120120', '0120201212010120', '0011220011220011', '0011112222000011', '0101010122222222',
  '0000000021212121', '0022112200221122', '0022001100220011', '0220122102201221', '0101222222220101', '0000212121212121',
  '0101010101012222', '0222011102220111', '0002111200021112', '0000211221122112', '0222011101110222', '0002111211120002',
  '0110011001102222', '0000000021122112', '0110011022222222', '0022001100110022', '0022112211220022', '0000000000002112',
  '0002000100020001', '0222122202221222', '0101222222222222', '0111201122012220',
].map((s) => Array.from(s, (c) => c.charCodeAt(0) - 48));

const A2 = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2, 15, 15,
  6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
];
const A3a = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15, 8, 15, 3, 5, 6, 10,
  8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
];
const A3b = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8, 15, 3,
  15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
];

const W2 = [0, 21, 43, 64];
const W3 = [0, 9, 18, 27, 37, 46, 55, 64];
const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
const weights = (bits: number) => (bits === 2 ? W2 : bits === 3 ? W3 : W4);

export function decodeBC7(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const ep = new Int32Array(6 * 4); // endpoints x rgba
  const subsetOf = new Int32Array(16);
  const idx1 = new Int32Array(16);
  const idx2 = new Int32Array(16);
  forBlocks(w, h, 16, (s, px, py) => {
    let bit = 0;
    const read = (n: number) => {
      let v = 0;
      for (let i = 0; i < n; i++, bit++) v |= ((src[s + (bit >> 3)] >> (bit & 7)) & 1) << i;
      return v;
    };
    let mode = 0;
    while (mode < 8 && !((src[s] >> mode) & 1)) mode++;
    if (mode >= 8) {
      for (let i = 0; i < 16; i++) put(out, w, h, px + (i & 3), py + (i >> 2), 0, 0, 0, 0);
      return;
    }
    bit = mode + 1;
    const [ns, pb, rb, isb, cb, ab, epb, spb, ib, ib2] = BC7_MODES[mode];
    const part = read(pb);
    const rot = read(rb);
    const sel = read(isb);
    const ne = ns * 2;
    for (let c = 0; c < 3; c++) for (let e = 0; e < ne; e++) ep[e * 4 + c] = read(cb);
    for (let e = 0; e < ne; e++) ep[e * 4 + 3] = ab ? read(ab) : 255;
    let cbits = cb;
    let abits = ab;
    if (epb) {
      for (let e = 0; e < ne; e++) {
        const p = read(1);
        for (let c = 0; c < 4; c++) if (c < 3 || ab) ep[e * 4 + c] = (ep[e * 4 + c] << 1) | p;
      }
      cbits++;
      if (ab) abits++;
    } else if (spb) {
      for (let sub = 0; sub < ns; sub++) {
        const p = read(1);
        for (const e of [sub * 2, sub * 2 + 1]) for (let c = 0; c < 3; c++) ep[e * 4 + c] = (ep[e * 4 + c] << 1) | p;
      }
      cbits++;
    }
    for (let e = 0; e < ne; e++) {
      for (let c = 0; c < 3; c++) {
        const v = ep[e * 4 + c];
        ep[e * 4 + c] = (v << (8 - cbits)) | (v >> (2 * cbits - 8));
      }
      if (ab) {
        const v = ep[e * 4 + 3];
        ep[e * 4 + 3] = (v << (8 - abits)) | (v >> (2 * abits - 8));
      }
    }
    // subsets and anchors
    let anchor1 = -1;
    let anchor2 = -1;
    for (let i = 0; i < 16; i++) subsetOf[i] = ns === 1 ? 0 : ns === 2 ? (P2[part] >> i) & 1 : P3[part][i];
    if (ns === 2) anchor1 = A2[part];
    else if (ns === 3) {
      anchor1 = A3a[part];
      anchor2 = A3b[part];
    }
    for (let i = 0; i < 16; i++) {
      const anchor = i === 0 || i === anchor1 || i === anchor2;
      idx1[i] = read(anchor ? ib - 1 : ib);
    }
    if (ib2) for (let i = 0; i < 16; i++) idx2[i] = read(i === 0 ? ib2 - 1 : ib2);
    for (let i = 0; i < 16; i++) {
      const sub = subsetOf[i];
      const e0 = sub * 2 * 4;
      const e1 = e0 + 4;
      let cw: number;
      let aw: number;
      if (ib2) {
        if (sel) {
          cw = weights(ib2)[idx2[i]];
          aw = weights(ib)[idx1[i]];
        } else {
          cw = weights(ib)[idx1[i]];
          aw = weights(ib2)[idx2[i]];
        }
      } else cw = aw = weights(ib)[idx1[i]];
      let r = ((64 - cw) * ep[e0] + cw * ep[e1] + 32) >> 6;
      let g = ((64 - cw) * ep[e0 + 1] + cw * ep[e1 + 1] + 32) >> 6;
      let b = ((64 - cw) * ep[e0 + 2] + cw * ep[e1 + 2] + 32) >> 6;
      let a = ((64 - aw) * ep[e0 + 3] + aw * ep[e1 + 3] + 32) >> 6;
      if (rot === 1) [r, a] = [a, r];
      else if (rot === 2) [g, a] = [a, g];
      else if (rot === 3) [b, a] = [a, b];
      put(out, w, h, px + (i & 3), py + (i >> 2), r, g, b, a);
    }
  });
  return out;
}
