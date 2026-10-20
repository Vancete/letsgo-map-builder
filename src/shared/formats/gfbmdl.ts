// GFBMDL: Game Freak's binary model (FlatBuffers, no file identifier). Let's Go layout, by field slot:
//   Model:    0 version, 1 bounds (6 x f32), 2 texture names, 3 shader names, 5 material names, 6 materials, 7 groups,
//             8 meshes, 9 bones
//   Material: 0 name, 1 shader, 11 texture maps {0 sampler, 1 texture index}, 13 floats {0 name, 1 value},
//             14 colors {0 name, 1 rgb}, 20 common {0 switches {0 name, 1 u8}, 1 ints {0 name, 1 i32}, 2 floats}
//   Group:    0 bone, 1 mesh, 2 bounds, 3 layer
//   Mesh:     0 polygons {0 material, 1 u16 triangle list}, 1 attributes {0 type, 1 format, 2 count}, 2 vertex data
//   Bone:     0 name, 1 type, 2 parent, 4 visible, 5 scale, 6 rotation (euler XYZ, radians), 7 translation
import { FB, Table } from './flatbuf.ts';

export interface GfMaterial {
  name: string;
  shader: string;
  textures: Record<string, string>; // sampler -> texture name
  switches: Record<string, number>;
  ints: Record<string, number>;
  floats: Record<string, number>;
  colors: Record<string, [number, number, number]>;
}

export interface GfBone {
  name: string;
  parent: number;
  scale: [number, number, number];
  rotation: [number, number, number];
  translation: [number, number, number];
}

export interface GfMesh {
  bone: number;
  vertexCount: number;
  position: Float32Array; // xyz
  normal: Float32Array | null; // xyz
  uv0: Float32Array | null;
  uv1: Float32Array | null;
  color: Uint8Array | null; // rgba
  skinned: boolean;
  polygons: { material: number; indices: Uint16Array }[];
}

export interface GfModel {
  bounds: number[];
  textures: string[];
  materials: GfMaterial[];
  bones: GfBone[];
  meshes: GfMesh[];
}

export function isGfbmdl(u8: Uint8Array): boolean {
  try {
    const r = new FB(u8).root();
    return r.fieldCount >= 10 && r.has(8) && r.has(9) && r.has(2);
  } catch {
    return false;
  }
}

// vertex attribute formats: bytes per element
const FORMAT_SIZE: Record<number, number> = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 8: 1 };

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function readElem(dv: DataView, o: number, fmt: number): number {
  switch (fmt) {
    case 0: return dv.getFloat32(o, true);
    case 1: return halfToFloat(dv.getUint16(o, true));
    case 2: return dv.getInt8(o) / 127;
    case 3: return dv.getUint8(o);
    case 4: return dv.getUint16(o, true);
    case 5: return dv.getInt16(o, true);
    case 8: return dv.getUint8(o) / 255;
    default: return 0;
  }
}

function named<T>(t: Table, slot: number, val: (e: Table) => T): Record<string, T> {
  const r: Record<string, T> = {};
  for (const e of t.tables(slot)) {
    const n = e.str(0);
    if (n) r[n] = val(e);
  }
  return r;
}

function parseMaterial(m: Table, texNames: string[]): GfMaterial {
  const common = m.table(20);
  const textures: Record<string, string> = {};
  for (const t of m.tables(11)) {
    const s = t.str(0);
    const tex = texNames[t.i32(1, 0)];
    if (s && tex) textures[s] = tex;
  }
  return {
    name: m.str(0) ?? '',
    shader: m.str(1) ?? '',
    textures,
    switches: common ? named(common, 0, (e) => e.u8(1)) : {},
    ints: common ? named(common, 1, (e) => e.i32(1)) : {},
    floats: { ...(common ? named(common, 2, (e) => e.f32(1)) : {}), ...named(m, 13, (e) => e.f32(1)) },
    colors: named(m, 14, (e) => (e.vecf(1, 3) ?? [1, 1, 1]) as [number, number, number]),
  };
}

function parseMesh(m: Table, bone: number): GfMesh {
  const attrs = m.tables(1).map((a) => ({ type: a.u32(0), fmt: a.u32(1), count: a.u32(2) }));
  const stride = attrs.reduce((n, a) => n + (FORMAT_SIZE[a.fmt] ?? 4) * a.count, 0);
  const data = m.bytes(2);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const vertexCount = stride ? Math.floor(data.length / stride) : 0;
  const mesh: GfMesh = {
    bone,
    vertexCount,
    position: new Float32Array(vertexCount * 3),
    normal: null,
    uv0: null,
    uv1: null,
    color: null,
    skinned: attrs.some((a) => a.type === 12),
    polygons: [],
  };
  let off = 0;
  for (const a of attrs) {
    const es = FORMAT_SIZE[a.fmt] ?? 4;
    const take = (n: number, into: Float32Array) => {
      for (let v = 0; v < vertexCount; v++)
        for (let k = 0; k < n; k++) into[v * n + k] = k < a.count ? readElem(dv, v * stride + off + k * es, a.fmt) : 0;
    };
    if (a.type === 0) take(3, mesh.position);
    else if (a.type === 1) take(3, (mesh.normal = new Float32Array(vertexCount * 3)));
    else if (a.type === 3) take(2, (mesh.uv0 = new Float32Array(vertexCount * 2)));
    else if (a.type === 4) take(2, (mesh.uv1 = new Float32Array(vertexCount * 2)));
    else if (a.type === 7 && a.fmt === 3) {
      const c = (mesh.color = new Uint8Array(vertexCount * 4));
      for (let v = 0; v < vertexCount; v++) for (let k = 0; k < 4; k++) c[v * 4 + k] = data[v * stride + off + k];
    }
    off += es * a.count;
  }
  for (const p of m.tables(0)) {
    const [s, n] = p.vec(1);
    const idx = new Uint16Array(n - (n % 3));
    for (let k = 0; k < idx.length; k++) idx[k] = p.fb.dv.getUint16(s + k * 2, true);
    mesh.polygons.push({ material: p.u32(0), indices: idx });
  }
  return mesh;
}

export function parseGfbmdl(u8: Uint8Array): GfModel {
  const r = new FB(u8).root();
  const textures = r.strings(2);
  const materials = r.tables(6).map((m) => parseMaterial(m, textures));
  const bones = r.tables(9).map((b) => ({
    name: b.str(0) ?? '',
    parent: b.i32(2, -1),
    scale: (b.vecf(5, 3) ?? [1, 1, 1]) as [number, number, number],
    rotation: (b.vecf(6, 3) ?? [0, 0, 0]) as [number, number, number],
    translation: (b.vecf(7, 3) ?? [0, 0, 0]) as [number, number, number],
  }));
  const meshTables = r.tables(8);
  const meshBone = new Map<number, number>();
  for (const g of r.tables(7)) meshBone.set(g.u32(1), g.u32(0));
  const meshes = meshTables.map((m, i) => parseMesh(m, meshBone.get(i) ?? 0));
  return { bounds: r.vecf(1, 6) ?? [0, 0, 0, 0, 0, 0], textures, materials, bones, meshes };
}

// ---- bone transforms (column-major 4x4, as three.js)

export type Mat4 = number[];

function compose(t: number[], r: number[], s: number[]): Mat4 {
  // rotation order XYZ (R = Rz * Ry * Rx), as Maya exports
  const [cx, cy, cz] = [Math.cos(r[0]), Math.cos(r[1]), Math.cos(r[2])];
  const [sx, sy, sz] = [Math.sin(r[0]), Math.sin(r[1]), Math.sin(r[2])];
  const m00 = cy * cz, m01 = sx * sy * cz - cx * sz, m02 = cx * sy * cz + sx * sz;
  const m10 = cy * sz, m11 = sx * sy * sz + cx * cz, m12 = cx * sy * sz - sx * cz;
  const m20 = -sy, m21 = sx * cy, m22 = cx * cy;
  return [
    m00 * s[0], m10 * s[0], m20 * s[0], 0,
    m01 * s[1], m11 * s[1], m21 * s[1], 0,
    m02 * s[2], m12 * s[2], m22 * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

export function boneWorldMatrices(bones: GfBone[]): Mat4[] {
  const out: Mat4[] = [];
  const get = (i: number, depth = 0): Mat4 => {
    if (out[i]) return out[i];
    const b = bones[i];
    const local = compose(b.translation, b.rotation, b.scale);
    const m = b.parent >= 0 && b.parent < bones.length && depth < 64 ? mul(get(b.parent, depth + 1), local) : local;
    return (out[i] = m);
  };
  bones.forEach((_, i) => get(i));
  return out;
}

export function isIdentity(m: Mat4): boolean {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return m.every((v, i) => Math.abs(v - id[i]) < 1e-5);
}

export function transformPoints(m: Mat4, p: Float32Array, isDir: boolean) {
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const w = isDir ? 0 : 1;
    p[i] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    if (isDir) {
      const l = Math.hypot(p[i], p[i + 1], p[i + 2]) || 1;
      p[i] /= l; p[i + 1] /= l; p[i + 2] /= l;
    }
  }
}
