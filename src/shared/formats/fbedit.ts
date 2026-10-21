// Edits a FlatBuffer with no schema by appending: FlatBuffers offsets (uoffset) only point forward, so a changed
// vector or table is written again at the end of the buffer (copied from the original, with the changes) and the
// field that referenced the old one is re-pointed to the new one. Everything else stays where it was.
//
// Tables are copied byte for byte (inline fields keep their offsets and alignment); the caller says which fields hold
// offsets to children (tables, strings, vectors), which are copied too.

export type Cloner = (oldPos: number) => number;

export class FBEditor {
  buf: Uint8Array;
  len: number;
  private readonly src: DataView;

  constructor(original: Uint8Array) {
    this.buf = new Uint8Array(Math.max(1024, original.length * 2));
    this.buf.set(original);
    this.len = original.length;
    this.src = new DataView(original.buffer, original.byteOffset, original.byteLength);
  }

  get length() {
    return this.len;
  }

  get data(): Uint8Array {
    return this.buf.slice(0, (this.len + 7) & ~7);
  }

  private dv() {
    return new DataView(this.buf.buffer);
  }

  reserve(n: number, align: number, mod = 0): number {
    let p = this.len;
    while (p % align !== mod % align) p++;
    if (p + n > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, p + n + 1024));
      nb.set(this.buf);
      this.buf = nb;
    }
    this.len = p + n;
    return p;
  }

  // reads (from the current buffer: original and appended data)
  u32(p: number) {
    return this.dv().getUint32(p, true);
  }
  deref(fieldPos: number) {
    return fieldPos + this.u32(fieldPos);
  }
  vtable(tablePos: number) {
    const vt = tablePos - this.dv().getInt32(tablePos, true);
    return { vt, vs: this.dv().getUint16(vt, true), ts: this.dv().getUint16(vt + 2, true) };
  }
  fieldPos(tablePos: number, idx: number): number {
    const { vt, vs } = this.vtable(tablePos);
    const o = 4 + idx * 2;
    if (o >= vs) return 0;
    const rel = this.dv().getUint16(vt + o, true);
    return rel ? tablePos + rel : 0;
  }
  child(tablePos: number, idx: number): number {
    const f = this.fieldPos(tablePos, idx);
    return f ? this.deref(f) : 0;
  }
  vectorElems(vecPos: number): number[] {
    const n = this.u32(vecPos);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.deref(vecPos + 4 + i * 4));
    return out;
  }

  // writes
  setU32(p: number, v: number) {
    this.dv().setUint32(p, v >>> 0, true);
  }
  setF32(p: number, v: number) {
    this.dv().setFloat32(p, v, true);
  }
  setU64(p: number, v: bigint) {
    this.dv().setBigUint64(p, v, true);
  }
  // point an offset field at a position after it
  link(fieldPos: number, target: number) {
    if (target <= fieldPos) throw new Error('fbedit: offsets must point forward');
    this.setU32(fieldPos, target - fieldPos);
  }

  // copy of a table (and the children the cloners copy), at the end
  // u32Fields: scalar fields to set, added to the copy when the original has no slot for them
  cloneTable(tablePos: number, children: Record<number, Cloner> = {}, from: FBEditor = this, u32Fields: Record<number, number> = {}): number {
    const { vt, vs, ts } = from.vtable(tablePos);
    const fdv = from.dv();
    const has = (i: number) => 4 + i * 2 < vs && fdv.getUint16(vt + 4 + i * 2, true) !== 0;
    const added = Object.keys(u32Fields).map(Number).filter((i) => !has(i));
    const nvs = Math.max(vs, ...added.map((i) => 4 + (i + 1) * 2));
    const base = (ts + 3) & ~3;
    const nts = base + added.length * 4;
    const vtCopy = new Uint8Array(nvs);
    vtCopy.set(from.buf.subarray(vt, vt + vs));
    const tableCopy = new Uint8Array(nts);
    tableCopy.set(from.buf.subarray(tablePos, tablePos + ts));
    const vdv = new DataView(vtCopy.buffer);
    vdv.setUint16(0, nvs, true);
    vdv.setUint16(2, nts, true);
    added.forEach((i, k) => vdv.setUint16(4 + i * 2, base + k * 4, true));
    const nvt = this.reserve(nvs, 2);
    this.buf.set(vtCopy, nvt);
    const nt = this.reserve(nts, 8, tablePos % 8);
    this.buf.set(tableCopy, nt);
    this.dv().setInt32(nt, nt - nvt, true);
    for (const [i, v] of Object.entries(u32Fields)) this.setFieldU32(nt, Number(i), v);
    for (const [idx, clone] of Object.entries(children)) {
      const f = this.fieldPos(nt, Number(idx));
      if (!f) continue;
      const old = from.deref(tablePos + (f - nt));
      this.link(f, clone(old));
    }
    return nt;
  }

  // Deep copy of a table with no schema: each 4-byte field whose value points past the table to something that is
  // unmistakably a string, a table or a vector of tables/strings is taken for an offset and its target copied too.
  // (FlatBuffers builders write children after their parents, so a real child is always past the table's end.)
  cloneDeep(tablePos: number, depth = 0, from: FBEditor = this): number {
    if (depth > 32) throw new Error('fbedit: too deep');
    const { vt, vs, ts } = from.vtable(tablePos);
    const dv = from.dv();
    const rels: number[] = [];
    for (let o = 4; o < vs; o += 2) rels.push(dv.getUint16(vt + o, true));
    const sorted = [...new Set(rels.filter((r) => r))].sort((a, b) => a - b);
    const children: Record<number, Cloner> = {};
    rels.forEach((rel, idx) => {
      if (!rel || rel % 4) return;
      const size = (sorted.find((r) => r > rel) ?? ts) - rel;
      if (size !== 4) return;
      const f = tablePos + rel;
      const t = f + from.u32(f);
      if (t < tablePos + ts || t >= from.len || t % 4) return;
      if (from.isString(t)) children[idx] = (p) => this.cloneString(p, from);
      else if (from.isTable(t)) children[idx] = (p) => this.cloneDeep(p, depth + 1, from);
      else {
        const kind = from.vectorKind(t);
        if (kind) children[idx] = (p) => this.cloneVector(p, kind, depth + 1, from);
      }
    });
    return this.cloneTable(tablePos, children, from);
  }

  isString(p: number): boolean {
    if (p < 0 || p + 4 > this.len) return false;
    const n = this.u32(p);
    if (n < 1 || n > 4096 || p + 4 + n >= this.len || this.buf[p + 4 + n] !== 0) return false;
    for (let i = p + 4; i < p + 4 + n; i++) if (this.buf[i] < 0x20 && this.buf[i] !== 9) return false;
    return true;
  }

  isTable(p: number): boolean {
    if (p < 0 || p + 4 > this.len || p % 4) return false;
    const vt = p - this.dv().getInt32(p, true);
    if (vt < 0 || vt + 4 > this.len || vt % 2) return false;
    const vs = this.dv().getUint16(vt, true);
    const ts = this.dv().getUint16(vt + 2, true);
    if (vs < 4 || vs > 400 || vs % 2 || ts < 4 || ts > 8192 || vt + vs > this.len || p + ts > this.len) return false;
    for (let o = 4; o < vs; o += 2) if (this.dv().getUint16(vt + o, true) >= ts) return false;
    return true;
  }

  vectorKind(p: number): 'table' | 'string' | null {
    if (p < 0 || p + 4 > this.len) return null;
    const n = this.u32(p);
    if (n < 1 || n > 100000 || p + 4 + n * 4 > this.len) return null;
    let tables = true;
    let strings = true;
    for (let i = 0; i < n && (tables || strings); i++) {
      const e = p + 4 + i * 4;
      const t = e + this.u32(e);
      const ok = t > e && t < this.len;
      tables &&= ok && this.isTable(t);
      strings &&= ok && this.isString(t);
    }
    // (a table's bytes can pass for a string, rarely the other way round: strings win only when all are strings)
    return strings ? 'string' : tables ? 'table' : null;
  }

  cloneVector(p: number, kind: 'table' | 'string', depth: number, from: FBEditor = this): number {
    const elems = from.vectorElems(p);
    const v = this.reserve(4 + elems.length * 4, 4);
    this.setU32(v, elems.length);
    elems.forEach((e, i) => this.link(v + 4 + i * 4, kind === 'string' ? this.cloneString(e, from) : this.cloneDeep(e, depth, from)));
    return v;
  }

  // a new vector of tables, at the end, whose elements are the given cloners' results
  vectorOfTables(makers: (() => number)[]): number {
    const v = this.reserve(4 + makers.length * 4, 4);
    this.setU32(v, makers.length);
    makers.forEach((m, i) => this.link(v + 4 + i * 4, m()));
    return v;
  }

  string(s: string): number {
    const b = new TextEncoder().encode(s);
    const p = this.reserve(4 + b.length + 1, 4);
    this.setU32(p, b.length);
    this.buf.set(b, p + 4);
    this.buf[p + 4 + b.length] = 0;
    return p;
  }

  cloneString(pos: number, from: FBEditor = this): number {
    const n = from.u32(pos);
    return this.string(new TextDecoder().decode(from.buf.subarray(pos + 4, pos + 4 + n)));
  }

  readString(pos: number): string {
    return new TextDecoder().decode(this.buf.subarray(pos + 4, pos + 4 + this.u32(pos)));
  }

  // a byte vector (elements of `elemSize` bytes), at the end
  bytesVector(data: Uint8Array, elemSize: number, align = 4): number {
    const v = this.reserve(4 + data.length, Math.max(4, align), (4 % Math.max(4, align)) ? Math.max(4, align) - 4 : 0);
    this.setU32(v, data.length / elemSize);
    this.buf.set(data, v + 4);
    return v;
  }

  // a vector of strings, at the end
  stringVector(list: string[]): number {
    const v = this.reserve(4 + list.length * 4, 4);
    this.setU32(v, list.length);
    list.forEach((s, i) => this.link(v + 4 + i * 4, this.string(s)));
    return v;
  }

  // an empty buffer with a root offset to fill in
  static empty(): FBEditor {
    const e = new FBEditor(new Uint8Array(8));
    return e;
  }

  setRoot(tablePos: number) {
    this.setU32(0, tablePos);
  }

  // set an inline scalar field of a table that has it (false when the table has no slot for it)
  setFieldF32(tablePos: number, idx: number, v: number): boolean {
    const f = this.fieldPos(tablePos, idx);
    if (f) this.setF32(f, v);
    return !!f;
  }
  setFieldU32(tablePos: number, idx: number, v: number): boolean {
    const f = this.fieldPos(tablePos, idx);
    if (f) this.setU32(f, v);
    return !!f;
  }
  setFieldU64(tablePos: number, idx: number, v: bigint): boolean {
    const f = this.fieldPos(tablePos, idx);
    if (f) this.setU64(f, v);
    return !!f;
  }

  originalU32(p: number) {
    return this.src.getUint32(p, true);
  }
}

// A table built from scratch: fields laid out largest first, then children appended after it.
export type FieldSpec =
  | { idx: number; f32: number }
  | { idx: number; u32: number }
  | { idx: number; u8: number }
  | { idx: number; u64: bigint }
  | { idx: number; bytes: Uint8Array; align: number }
  | { idx: number; child: (ed: FBEditor) => number };

export function buildTable(ed: FBEditor, fields: FieldSpec[]): number {
  const maxIdx = Math.max(-1, ...fields.map((f) => f.idx));
  const vs = 4 + (maxIdx + 1) * 2;
  type Slot = { f: FieldSpec; size: number; align: number; rel: number };
  const slots: Slot[] = fields.map((f) => {
    if ('u64' in f) return { f, size: 8, align: 8, rel: 0 };
    if ('bytes' in f) return { f, size: f.bytes.length, align: f.align, rel: 0 };
    if ('u8' in f) return { f, size: 1, align: 1, rel: 0 };
    return { f, size: 4, align: 4, rel: 0 };
  });
  slots.sort((a, b) => b.align - a.align || b.size - a.size);
  let rel = 4;
  for (const s of slots) {
    while (rel % s.align) rel++;
    s.rel = rel;
    rel += s.size;
  }
  const ts = (rel + 3) & ~3;
  const vt = ed.reserve(vs, 2);
  const t = ed.reserve(ts, 8);
  const dv = new DataView(ed.buf.buffer);
  dv.setUint16(vt, vs, true);
  dv.setUint16(vt + 2, ts, true);
  for (let i = 0; i <= maxIdx; i++) dv.setUint16(vt + 4 + i * 2, 0, true);
  dv.setInt32(t, t - vt, true);
  for (const s of slots) {
    dv.setUint16(vt + 4 + s.f.idx * 2, s.rel, true);
    const p = t + s.rel;
    const f = s.f;
    if ('f32' in f) dv.setFloat32(p, f.f32, true);
    else if ('u32' in f) dv.setUint32(p, f.u32 >>> 0, true);
    else if ('u8' in f) dv.setUint8(p, f.u8);
    else if ('u64' in f) dv.setBigUint64(p, f.u64, true);
    else if ('bytes' in f) ed.buf.set(f.bytes, p);
  }
  for (const s of slots) if ('child' in s.f) ed.link(t + s.rel, s.f.child(ed));
  return t;
}

// ---- learned schemas: which fields of a table type hold offsets, worked out from many instances of it (a field is an
// offset if any instance points it at a string, a table or a vector of them; one that always points at a zero is an
// empty vector). Copies made with a schema leave no offset dangling.

export type FieldKind =
  | { kind: 'string' }
  | { kind: 'table'; schema: Schema }
  | { kind: 'vtables'; schema: Schema }
  | { kind: 'vstrings' }
  | { kind: 'vempty' };
export type Schema = Map<number, FieldKind>;

type Sample = { ed: FBEditor; pos: number };

export function learnSchema(samples: Sample[], depth = 0): Schema {
  const schema: Schema = new Map();
  if (depth > 16 || !samples.length) return schema;
  const by = new Map<number, { cls: string; t: number; ed: FBEditor }[]>();
  for (const { ed, pos } of samples) {
    const { vt, vs, ts } = ed.vtable(pos);
    const dv = new DataView(ed.buf.buffer);
    const rels: number[] = [];
    for (let o = 4; o < vs; o += 2) rels.push(dv.getUint16(vt + o, true));
    const sorted = [...new Set(rels.filter((r) => r))].sort((a, b) => a - b);
    rels.forEach((rel, idx) => {
      if (!rel || rel % 4) return;
      const size = (sorted.find((r) => r > rel) ?? ts) - rel;
      if (size !== 4) return;
      const f = pos + rel;
      const t = f + ed.u32(f);
      let cls = 'scalar';
      if (t >= pos + ts && t < ed.len && t % 4 === 0) {
        const k = ed.isString(t) ? null : ed.vectorKind(t);
        if (ed.isString(t)) cls = 'string';
        else if (k) cls = k === 'table' ? 'vtables' : 'vstrings';
        else if (ed.isTable(t)) cls = 'table';
        else cls = ed.u32(t) === 0 ? 'zero' : 'unknown';
      }
      let l = by.get(idx);
      if (!l) by.set(idx, (l = []));
      l.push({ cls, t, ed });
    });
  }
  for (const [idx, list] of by) {
    // an offset field points at the same kind of thing in every instance (vectors may be empty: a zero)
    const classes = new Set(list.map((x) => x.cls));
    const only = (...c: string[]) => [...classes].every((x) => c.includes(x));
    const has = (c: string) => classes.has(c);
    if (only('string')) schema.set(idx, { kind: 'string' });
    else if (only('table')) schema.set(idx, { kind: 'table', schema: learnSchema(list.filter((x) => x.cls === 'table').map((x) => ({ ed: x.ed, pos: x.t })), depth + 1) });
    else if (has('vtables') && only('vtables', 'zero'))
      schema.set(idx, {
        kind: 'vtables',
        schema: learnSchema(list.filter((x) => x.cls === 'vtables').flatMap((x) => x.ed.vectorElems(x.t).map((p) => ({ ed: x.ed, pos: p }))), depth + 1),
      });
    else if (has('vstrings') && only('vstrings', 'zero')) schema.set(idx, { kind: 'vstrings' });
    else if (only('zero')) schema.set(idx, { kind: 'vempty' });
  }
  return schema;
}

// a copy of a table (from any buffer) following a learned schema
export function cloneWithSchema(dst: FBEditor, from: FBEditor, pos: number, schema: Schema, u32Fields: Record<number, number> = {}): number {
  const children: Record<number, Cloner> = {};
  for (const [idx, k] of schema) {
    children[idx] = (p) => {
      const isEmpty = p + 4 <= from.len && from.u32(p) === 0;
      switch (k.kind) {
        case 'string':
          return dst.cloneString(p, from);
        case 'table':
          return cloneWithSchema(dst, from, p, k.schema);
        case 'vtables':
          return isEmpty ? dst.vectorOfTables([]) : dst.vectorOfTables(from.vectorElems(p).map((e) => () => cloneWithSchema(dst, from, e, k.schema)));
        case 'vstrings':
          return isEmpty ? dst.stringVector([]) : dst.stringVector(from.vectorElems(p).map((e) => from.readString(e)));
        case 'vempty':
          return dst.vectorOfTables([]);
      }
    };
  }
  return dst.cloneTable(pos, children, from, u32Fields);
}
