// node scripts/fbdump.ts <file> [maxDepth]: guesses the shape of a FlatBuffer with no schema
import { readFileSync } from 'node:fs';
import { FB, Table } from '../src/shared/formats/flatbuf.ts';

const u8 = new Uint8Array(readFileSync(process.argv[2]));
const maxDepth = Number(process.argv[3] ?? 4);
const fb = new FB(u8);
const dv = fb.dv;
const seen = new Set<number>();

function looksTable(p: number): boolean {
  if (p <= 0 || p + 4 > u8.length) return false;
  const vt = p - dv.getInt32(p, true);
  if (vt < 0 || vt + 4 > u8.length) return false;
  const vs = dv.getUint16(vt, true);
  const ts = dv.getUint16(vt + 2, true);
  return vs >= 4 && vs < 200 && (vs & 1) === 0 && ts >= 4 && ts < 4096;
}
function looksString(p: number): string | null {
  if (p + 4 > u8.length) return null;
  const n = dv.getUint32(p, true);
  if (n === 0 || n > 512 || p + 4 + n >= u8.length || u8[p + 4 + n] !== 0) return null;
  const s = u8.subarray(p + 4, p + 4 + n);
  for (const c of s) if (c < 0x20 || c > 0x7e) return null;
  return new TextDecoder().decode(s);
}

function dump(t: Table, depth: number, ind: string) {
  if (seen.has(t.pos)) return console.log(ind + '(seen)');
  seen.add(t.pos);
  const n = t.fieldCount;
  const slots: number[] = [];
  for (let i = 0; i < n; i++) slots.push(t.off(i));
  const sorted = slots.filter((x) => x).sort((a, b) => a - b);
  const tableSize = dv.getUint16(t.vt + 2, true);
  for (let i = 0; i < n; i++) {
    const o = slots[i];
    if (!o) {
      console.log(`${ind}[${i}] -`);
      continue;
    }
    const next = sorted.find((x) => x > o) ?? t.pos + tableSize;
    const size = next - o;
    const raw = dv.getUint32(o, true);
    let desc = `size<=${size} u32=${raw} f32=${dv.getFloat32(o, true).toPrecision(5)}`;
    const tgt = o + raw;
    if (size >= 4 && raw > 0 && tgt < u8.length) {
      const s = looksString(tgt);
      if (s !== null) {
        console.log(`${ind}[${i}] str "${s}"`);
        continue;
      }
      if (looksTable(tgt) && depth > 0) {
        console.log(`${ind}[${i}] table @${tgt}`);
        dump(new Table(fb, tgt), depth - 1, ind + '  ');
        continue;
      }
      const len = tgt + 4 <= u8.length ? dv.getUint32(tgt, true) : 0;
      if (len > 0 && len < 1e7 && tgt + 4 + len * 1 <= u8.length && depth > 0) {
        const e0 = tgt + 4;
        const s0 = e0 + 4 <= u8.length ? looksString(e0 + dv.getUint32(e0, true)) : null;
        if (s0 !== null) {
          const strs: string[] = [];
          for (let k = 0; k < Math.min(len, 8); k++) {
            const e = e0 + k * 4;
            strs.push(looksString(e + dv.getUint32(e, true)) ?? '?');
          }
          console.log(`${ind}[${i}] vec<str> x${len}: ${strs.join(', ')}`);
          continue;
        }
        if (e0 + 4 <= u8.length && looksTable(e0 + dv.getUint32(e0, true))) {
          console.log(`${ind}[${i}] vec<table> x${len}`);
          dump(new Table(fb, e0 + dv.getUint32(e0, true)), depth - 1, ind + '  ');
          continue;
        }
        console.log(`${ind}[${i}] vec? len=${len} first=${Array.from(u8.subarray(e0, e0 + 16)).map((x) => x.toString(16).padStart(2, '0')).join('')}`);
        continue;
      }
    }
    if (size >= 12 && size <= 64) {
      const fl: string[] = [];
      for (let k = 0; k < size / 4; k++) fl.push(dv.getFloat32(o + k * 4, true).toPrecision(4));
      desc += ` floats=[${fl.join(', ')}]`;
    }
    console.log(`${ind}[${i}] ${desc}`);
  }
}

dump(fb.root(), maxDepth, '');
