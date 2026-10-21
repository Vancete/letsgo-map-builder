// node scripts/fbdump.ts <file> [maxDepth] [maxElems]: guesses the shape of a FlatBuffer with no schema
import { readFileSync } from 'node:fs';

const u8 = new Uint8Array(readFileSync(process.argv[2]));
const maxDepth = Number(process.argv[3] ?? 4);
const maxElems = Number(process.argv[4] ?? 1);
const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const N = u8.length;

function tableAt(p: number): { vt: number; vs: number; ts: number } | null {
  if (p <= 0 || p + 4 > N || p % 4) return null;
  const vt = p - dv.getInt32(p, true);
  if (vt < 0 || vt + 4 > N || vt % 2) return null;
  const vs = dv.getUint16(vt, true);
  const ts = dv.getUint16(vt + 2, true);
  if (vs < 4 || vs > 400 || vs % 2 || ts < 4 || ts > 4096 || vt + vs > N) return null;
  for (let i = 4; i < vs; i += 2) if (dv.getUint16(vt + i, true) >= ts) return null;
  return { vt, vs, ts };
}
function strAt(p: number): string | null {
  if (p + 4 > N) return null;
  const n = dv.getUint32(p, true);
  if (n < 1 || n > 1024 || p + 4 + n >= N || u8[p + 4 + n] !== 0) return null;
  const s = u8.subarray(p + 4, p + 4 + n);
  for (const c of s) if (c < 0x20 || c > 0x7e) return null;
  return new TextDecoder().decode(s);
}

function dumpTable(p: number, depth: number, ind: string) {
  const t = tableAt(p)!;
  const offs: number[] = [];
  for (let i = 4; i < t.vs; i += 2) offs.push(dv.getUint16(t.vt + i, true));
  const sorted = [...new Set(offs.filter((o) => o))].sort((a, b) => a - b);
  offs.forEach((rel, i) => {
    if (!rel) return;
    const o = p + rel;
    const next = sorted.find((x) => x > rel) ?? t.ts;
    const size = next - rel;
    const pre = `${ind}[${i}]`;
    if (size === 1 || size === 2 && false) return console.log(`${pre} u8=${u8[o]}`);
    if (size === 2 || size === 3) return console.log(`${pre} u16=${dv.getUint16(o, true)}`);
    if (size >= 8 && (o % 8 === 0) && size < 12) {
      const v = dv.getBigUint64(o, true);
      return console.log(`${pre} u64=0x${v.toString(16)} (f32 ${dv.getFloat32(o, true).toPrecision(5)}, ${dv.getFloat32(o + 4, true).toPrecision(5)})`);
    }
    if (size >= 12) {
      const fl: string[] = [];
      for (let k = 0; k + 4 <= size && k < 64; k += 4) fl.push(dv.getFloat32(o + k, true).toPrecision(5));
      return console.log(`${pre} struct(${size}) f32=[${fl.join(', ')}]`);
    }
    const raw = dv.getUint32(o, true);
    const tgt = o + raw;
    const f = dv.getFloat32(o, true);
    const asNum = `u32=${raw} i32=${dv.getInt32(o, true)} f32=${f.toPrecision(6)}`;
    if (raw > 0 && raw < N && tgt < N && raw % 4 === 0 || (raw > 0 && tgt < N && strAt(tgt))) {
      // vector?
      const len = tgt + 4 <= N ? dv.getUint32(tgt, true) : -1;
      const s = strAt(tgt);
      if (s !== null && s.length >= 1 && !(len <= 4 && tableAt(tgt + 4 + dv.getUint32(tgt + 4, true)))) return console.log(`${pre} str "${s}"`);
      if (tableAt(tgt) && depth > 0) {
        console.log(`${pre} table @${tgt}`);
        return dumpTable(tgt, depth - 1, ind + '  ');
      }
      if (len === 0) return console.log(`${pre} vec[0]`);
      if (len > 0 && len < 100000 && tgt + 4 + len * 4 <= N) {
        const e0 = tgt + 4;
        const first = e0 + dv.getUint32(e0, true);
        if (tableAt(first)) {
          console.log(`${pre} vec<table>[${len}]`);
          if (depth > 0)
            for (let k = 0; k < Math.min(len, maxElems); k++) {
              console.log(`${ind}  #${k}`);
              dumpTable(e0 + k * 4 + dv.getUint32(e0 + k * 4, true), depth - 1, ind + '    ');
            }
          return;
        }
        if (strAt(first) !== null) {
          const ss: string[] = [];
          for (let k = 0; k < Math.min(len, 6); k++) ss.push(strAt(e0 + k * 4 + dv.getUint32(e0 + k * 4, true)) ?? '?');
          return console.log(`${pre} vec<str>[${len}] ${ss.join(' | ')}`);
        }
        const bytes = Array.from(u8.subarray(e0, Math.min(N, e0 + 24))).map((x) => x.toString(16).padStart(2, '0')).join('');
        return console.log(`${pre} vec?[${len}] ${bytes}   (or ${asNum})`);
      }
    }
    console.log(`${pre} ${asNum}`);
  });
}

dumpTable(dv.getUint32(0, true), maxDepth, '');
