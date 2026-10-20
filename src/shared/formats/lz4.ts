// LZ4 block decompression (no frame header), as GFLXPACK stores its files.
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
