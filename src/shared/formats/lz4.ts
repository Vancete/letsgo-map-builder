// LZ4 block format (no frame header), as GFLXPACK stores its files.
export function lz4DecompressBlock(src: Uint8Array, outSize: number): Uint8Array {
  const dst = new Uint8Array(outSize);
  let si = 0;
  let di = 0;
  while (si < src.length) {
    const token = src[si++];
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b: number;
      do {
        b = src[si++];
        litLen += b;
      } while (b === 255);
    }
    dst.set(src.subarray(si, si + litLen), di);
    si += litLen;
    di += litLen;
    if (si >= src.length) break; // last sequence has literals only
    const offset = src[si] | (src[si + 1] << 8);
    si += 2;
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b: number;
      do {
        b = src[si++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4;
    let mi = di - offset;
    if (offset === 0 || mi < 0) throw new Error('lz4: bad offset');
    // byte by byte: matches may overlap their own output
    for (let k = 0; k < matchLen; k++) dst[di++] = dst[mi++];
  }
  if (di !== outSize) throw new Error(`lz4: got ${di} bytes, expected ${outSize}`);
  return dst;
}

// Greedy LZ4 block compressor (hash of 4 bytes, one candidate). Follows the format's end rules: the last 5 bytes are
// literals and no match starts in the last 12.
export function lz4CompressBlock(src: Uint8Array): Uint8Array {
  const n = src.length;
  const out = new Uint8Array(n + Math.ceil(n / 255) + 16);
  let op = 0;
  const table = new Int32Array(1 << 16).fill(-1);
  const read32 = (i: number) => src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24);
  const hash = (v: number) => (Math.imul(v, 2654435761) >>> 16) & 0xffff;
  const writeLen = (len: number) => {
    while (len >= 255) {
      out[op++] = 255;
      len -= 255;
    }
    out[op++] = len;
  };
  let anchor = 0;
  let ip = 0;
  const matchLimit = n - 12;
  while (ip < matchLimit) {
    const v = read32(ip);
    const h = hash(v);
    const ref = table[h];
    table[h] = ip;
    if (ref < 0 || ip - ref > 65535 || read32(ref) !== v) {
      ip++;
      continue;
    }
    let len = 4;
    while (ip + len < n - 5 && src[ref + len] === src[ip + len]) len++;
    const litLen = ip - anchor;
    const token = op++;
    out[token] = (Math.min(litLen, 15) << 4) | Math.min(len - 4, 15);
    if (litLen >= 15) writeLen(litLen - 15);
    out.set(src.subarray(anchor, ip), op);
    op += litLen;
    const off = ip - ref;
    out[op++] = off & 255;
    out[op++] = off >> 8;
    if (len - 4 >= 15) writeLen(len - 4 - 15);
    ip += len;
    anchor = ip;
  }
  const litLen = n - anchor;
  out[op++] = Math.min(litLen, 15) << 4;
  if (litLen >= 15) writeLen(litLen - 15);
  out.set(src.subarray(anchor), op);
  op += litLen;
  return out.slice(0, op);
}
