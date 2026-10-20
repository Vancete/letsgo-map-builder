// Minimal FlatBuffers reader: tables are read by field slot, as the GF formats ship no schema file.
export class FB {
  readonly dv: DataView;
  readonly u8: Uint8Array;

  constructor(u8: Uint8Array) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }

  root(): Table {
    return new Table(this, this.dv.getUint32(0, true));
  }
}

const td = new TextDecoder();

export class Table {
  readonly fb: FB;
  readonly pos: number;
  readonly vt: number;
  readonly vtSize: number;

  constructor(fb: FB, pos: number) {
    this.fb = fb;
    this.pos = pos;
    this.vt = pos - fb.dv.getInt32(pos, true);
    this.vtSize = fb.dv.getUint16(this.vt, true);
  }

  get fieldCount(): number {
    return (this.vtSize - 4) >> 1;
  }

  // byte offset of field slot i inside the buffer, or 0 if absent
  off(i: number): number {
    const o = 4 + i * 2;
    if (o >= this.vtSize) return 0;
    const rel = this.fb.dv.getUint16(this.vt + o, true);
    return rel ? this.pos + rel : 0;
  }

  has(i: number): boolean {
    return this.off(i) !== 0;
  }

  u8(i: number, d = 0): number {
    const o = this.off(i);
    return o ? this.fb.dv.getUint8(o) : d;
  }
  bool(i: number, d = false): boolean {
    const o = this.off(i);
    return o ? this.fb.dv.getUint8(o) !== 0 : d;
  }
  u16(i: number, d = 0): number {
    const o = this.off(i);
    return o ? this.fb.dv.getUint16(o, true) : d;
  }
  u32(i: number, d = 0): number {
    const o = this.off(i);
    return o ? this.fb.dv.getUint32(o, true) : d;
  }
  i32(i: number, d = 0): number {
    const o = this.off(i);
    return o ? this.fb.dv.getInt32(o, true) : d;
  }
  f32(i: number, d = 0): number {
    const o = this.off(i);
    return o ? this.fb.dv.getFloat32(o, true) : d;
  }
  u64(i: number, d = 0n): bigint {
    const o = this.off(i);
    return o ? this.fb.dv.getBigUint64(o, true) : d;
  }
  // inline struct of n floats
  vecf(i: number, n: number): number[] | null {
    const o = this.off(i);
    if (!o) return null;
    const r: number[] = [];
    for (let k = 0; k < n; k++) r.push(this.fb.dv.getFloat32(o + k * 4, true));
    return r;
  }

  private indirect(i: number): number {
    const o = this.off(i);
    return o ? o + this.fb.dv.getUint32(o, true) : 0;
  }

  str(i: number): string | null {
    const p = this.indirect(i);
    if (!p) return null;
    const len = this.fb.dv.getUint32(p, true);
    return td.decode(this.fb.u8.subarray(p + 4, p + 4 + len));
  }

  table(i: number): Table | null {
    const p = this.indirect(i);
    return p ? new Table(this.fb, p) : null;
  }

  // vector: [start of elements, length]
  vec(i: number): [number, number] {
    const p = this.indirect(i);
    if (!p) return [0, 0];
    return [p + 4, this.fb.dv.getUint32(p, true)];
  }

  vecLen(i: number): number {
    return this.vec(i)[1];
  }

  tables(i: number): Table[] {
    const [s, n] = this.vec(i);
    const r: Table[] = [];
    for (let k = 0; k < n; k++) {
      const e = s + k * 4;
      r.push(new Table(this.fb, e + this.fb.dv.getUint32(e, true)));
    }
    return r;
  }

  strings(i: number): string[] {
    const [s, n] = this.vec(i);
    const r: string[] = [];
    for (let k = 0; k < n; k++) {
      const e = s + k * 4;
      const p = e + this.fb.dv.getUint32(e, true);
      const len = this.fb.dv.getUint32(p, true);
      r.push(td.decode(this.fb.u8.subarray(p + 4, p + 4 + len)));
    }
    return r;
  }

  bytes(i: number): Uint8Array {
    const [s, n] = this.vec(i);
    return this.fb.u8.subarray(s, s + n);
  }
}
