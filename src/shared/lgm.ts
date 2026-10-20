// LGM: the editor's cached model. "LGM2", u32 header length, JSON header, padding to 4, then the buffers the header
// points into (byte offsets from the start of the buffer section). Positions and UVs f32, normals i8 (normalized),
// colors u8, indices u16 or u32. The cache stores it deflated (main process inflates it before handing it over).

export interface LgmMaterial {
  name: string;
  map: string | null; // texture name (cache/textures/<name>.png)
  map2: string | null; // second texture blended in by vertex color (ground shaders)
  uvSet: number;
  uvScale: [number, number];
  alphaTest: number; // 0 = none
  blend: boolean;
  doubleSided: boolean;
  color: [number, number, number];
  vertexColor: boolean;
}

interface LgmMeshHeader {
  material: number;
  vertexCount: number;
  indexCount: number;
  index32: boolean;
  position: number;
  normal: number | null;
  uv0: number | null;
  uv1: number | null;
  color: number | null;
  index: number;
}

interface LgmHeader {
  bounds: [number, number, number, number, number, number];
  materials: LgmMaterial[];
  meshes: LgmMeshHeader[];
}

export interface LgmMeshData {
  material: number;
  position: Float32Array;
  normal: Int8Array | null;
  uv0: Float32Array | null;
  uv1: Float32Array | null;
  color: Uint8Array | null;
  index: Uint16Array | Uint32Array;
}

export interface LgmModel {
  bounds: [number, number, number, number, number, number];
  materials: LgmMaterial[];
  meshes: LgmMeshData[];
}

const align4 = (n: number) => (n + 3) & ~3;

export function quantizeNormals(n: Float32Array): Int8Array {
  const o = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) o[i] = Math.max(-127, Math.min(127, Math.round(n[i] * 127)));
  return o;
}

export function packIndices(idx: ArrayLike<number>, vertexCount: number): Uint16Array | Uint32Array {
  return vertexCount <= 65535 ? Uint16Array.from(idx) : Uint32Array.from(idx);
}

export function encodeLgm(m: LgmModel): Uint8Array {
  const parts: Uint8Array[] = [];
  let off = 0;
  const push = (a: ArrayBufferView | null): number | null => {
    if (!a) return null;
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const at = off;
    parts.push(u);
    off += u.length;
    const pad = align4(off) - off;
    if (pad) {
      parts.push(new Uint8Array(pad));
      off += pad;
    }
    return at;
  };
  const meshes: LgmMeshHeader[] = m.meshes.map((d) => ({
    material: d.material,
    vertexCount: d.position.length / 3,
    indexCount: d.index.length,
    index32: d.index instanceof Uint32Array,
    position: push(d.position)!,
    normal: push(d.normal),
    uv0: push(d.uv0),
    uv1: push(d.uv1),
    color: push(d.color),
    index: push(d.index)!,
  }));
  const header: LgmHeader = { bounds: m.bounds, materials: m.materials, meshes };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headLen = align4(8 + json.length);
  const out = new Uint8Array(headLen + off);
  out.set([0x4c, 0x47, 0x4d, 0x32]);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let o = headLen;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function decodeLgm(input: ArrayBuffer | Uint8Array): LgmModel {
  // own, aligned copy
  const u8 = input instanceof Uint8Array ? input.slice() : new Uint8Array(input.slice(0));
  if (u8[0] !== 0x4c || u8[1] !== 0x47 || u8[2] !== 0x4d || u8[3] !== 0x32) throw new Error('not an LGM2 model');
  const jsonLen = new DataView(u8.buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jsonLen))) as LgmHeader;
  const ab = u8.buffer;
  const b0 = align4(8 + jsonLen);
  return {
    bounds: header.bounds,
    materials: header.materials,
    meshes: header.meshes.map((m) => ({
      material: m.material,
      position: new Float32Array(ab, b0 + m.position, m.vertexCount * 3),
      normal: m.normal === null ? null : new Int8Array(ab, b0 + m.normal, m.vertexCount * 3),
      uv0: m.uv0 === null ? null : new Float32Array(ab, b0 + m.uv0, m.vertexCount * 2),
      uv1: m.uv1 === null ? null : new Float32Array(ab, b0 + m.uv1, m.vertexCount * 2),
      color: m.color === null ? null : new Uint8Array(ab, b0 + m.color, m.vertexCount * 4),
      index: m.index32 ? new Uint32Array(ab, b0 + m.index, m.indexCount) : new Uint16Array(ab, b0 + m.index, m.indexCount),
    })),
  };
}
