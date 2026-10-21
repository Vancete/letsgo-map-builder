// Builds the editor's asset catalog from the game files: decoded models (LGM) and textures (PNG) in a cache folder.
//
//  - Objects the game places by itself (bin/archive/field/buildmodel.gfpak: grass, flowers, cuttable trees, boulders,
//    street lights, doors...), whole.
//  - Pieces cut out of every zone model. Zone models are baked: each group ("tree001", "bldg_pc", "town010_00_build01")
//    holds all its instances merged, in world coordinates. A group's triangles are split into connected components,
//    components that touch are clustered into instances, and the distinct instances become assets moved to the origin.
//  - Each zone model whole, to build on an existing map.
//  - Ground tiles: one cell textured with each ground texture the zones use.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openGameFS, type GameFS } from './formats/gamefs.ts';
import { Gfpak, fnv1a64 } from './formats/gfpak.ts';
import { isGfbmdl, parseGfbmdl, boneWorldMatrices, isIdentity, transformPoints, type GfModel, type GfMaterial } from './formats/gfbmdl.ts';
import { parseBntx, decodeTexture, type BntxTexture } from './formats/bntx.ts';
import { encodePng } from './formats/png.ts';
import { encodeLgm, packIndices, quantizeNormals, type LgmMaterial, type LgmMeshData, type LgmModel } from './lgm.ts';
import { deflateSync } from 'node:zlib';
import { CATALOG_VERSION, type AssetEntry, type Catalog, type Category, type ExtractProgress } from './types.ts';

const FIELD = 'bin/archive/field';

export interface ExtractOptions {
  gamePath: string;
  cacheDir: string;
  onProgress?: (p: ExtractProgress) => void;
  maxInstancesPerFamily?: number;
}

// ---- naming and categories

const HASHY = /^[0-9a-f]{12,}$/i;

const CATEGORY_RULES: [RegExp, Category][] = [
  [/(^|_)(bldg_)?pc([_\d\s]|$)|pc_machine|pokecen/i, 'pc'],
  [/shop|mart|department/i, 'shop'],
  [/gym/i, 'gym'],
  [/door|doorway|iriguti|entrance/i, 'door'],
  [/gake|cliff|step|kaidan|dan(_|$)|ledge|nidan|sandan|ichidan/i, 'ledge'],
  [/tree|iaigiri|miki|wood|bush/i, 'tree'],
  [/enc_grass|grass|kusa|shiba/i, 'grass'],
  [/flower|plant|kadan|gardening|flower_bed|hana/i, 'flower'],
  [/rock|iwa|stone|kairiki|boulder/i, 'rock'],
  [/fence|fance|saku|wall|gate/i, 'fence'],
  [/bench|benchi|lamp|light|sign|keiziban|board|post|manhole|fountain|bike|bollard|container|truck|hydrant|firehid|statue|machine|goods|vent|chair|paper/i, 'street'],
  [/bldg|build|house|minka|museum|labo|tower|center|kakutou|buil|cave_gate|combldg|bridge|hasi|brige|port|ship/i, 'building'],
  [/sea|umi|water|river|wave|kaitei/i, 'water'],
  [/yuka|ground|floor|tile|road|blend|concrete|plane|terrain|field|bloc|douro|whiteline|green/i, 'ground'],
  [/warp|gimmick|fossil|amber|scope|harness|curtain|beard|fireboard|dendo|windmill/i, 'gimmick'],
];

export function categorize(...names: string[]): Category {
  const s = names.join(' ');
  for (const [re, c] of CATEGORY_RULES) if (re.test(s)) return c;
  return 'other';
}

const SKIP_FAMILY = /sky|cloud|shadow_1|Transparency_Flag|DepthBuffer|_col$|collision|dummy/i;

function safeId(s: string) {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

// ---- materials

const EXCLUDED_SAMPLER = /shadow|toon|lightproj|depth|blend|border|mask|hikari|hilight|normal|sphere|env|cube|noise|flow|wave|light|rim|ramp|spec|emi|shine/i;
const PREFERRED_SAMPLERS = ['Texture01', 'TextureMap01', 'BaseColorMap', 'ColorMap', 'Col0Tex', 'GrassTex01', 'GroundTex01', 'CliffTex01', 'Texture', 'Tex01'];

function chooseMap(m: GfMaterial): string | null {
  for (const s of PREFERRED_SAMPLERS) if (m.textures[s]) return m.textures[s];
  for (const [s, t] of Object.entries(m.textures)) if (!EXCLUDED_SAMPLER.test(s) && !EXCLUDED_SAMPLER.test(t)) return t;
  return null;
}

// Tree shaders 04/05 light the leaves in the shader: Texture01 is the shadowed leaf (and its alpha), Texture02 a color
// ramp, Texture03 a highlight mask. The editor gets a pre-lit texture made from the three.
const composites = new Map<string, { base: string; ramp: string; hi: string | null }>();

function toLgmMaterial(m: GfMaterial): LgmMaterial {
  const discard = m.switches.DiscardEnable === 1 || m.switches.TextureAlphaTestEnable === 1;
  const alphaTest = discard ? Math.min(0.5, Math.max(0.05, m.floats.DiscardValuie ?? m.floats.DiscardValue ?? 0.5)) : 0;
  const uvSet = m.ints.Tex01_UV ?? m.ints.UV_tex0 ?? m.ints.UVSet0 ?? m.ints.Tex00_UV ?? 0;
  const su = m.floats.Tex01_Scale_U ?? m.floats.Tex00_Scale_U ?? 1;
  const sv = m.floats.Tex01_Scale_V ?? m.floats.Tex00_Scale_V ?? 1;
  let map = chooseMap(m);
  if (/FieldTreeShader0[45]/.test(m.shader) && m.textures.Texture01 && m.textures.Texture02) {
    map = `${m.textures.Texture01}__lit`;
    composites.set(map, { base: m.textures.Texture01, ramp: m.textures.Texture02, hi: m.textures.Texture03 ?? null });
  }
  return {
    name: m.name,
    map,
    map2: null,
    uvSet: uvSet === 1 ? 1 : 0,
    uvScale: [su || 1, sv || 1],
    alphaTest,
    blend: (m.ints.BlendMode ?? 0) !== 0,
    doubleSided: (m.ints.CullMode ?? 0) !== 0 || alphaTest > 0,
    color: [1, 1, 1],
    vertexColor: false,
  };
}

// ---- geometry helpers

interface Tri {
  mesh: number;
  poly: number;
  k: number; // triangle number in the polygon's index list
  a: number;
  b: number;
  c: number;
}

// Which triangles of the source model make a piece: u32 count, then u16 mesh, u16 polygon, u32 triangle (the map
// exporter rebuilds the piece from the game's own vertex data).
function encodeSelection(tris: Tri[]): Uint8Array {
  const out = new Uint8Array(4 + tris.length * 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, tris.length, true);
  tris.forEach((t, i) => {
    dv.setUint16(4 + i * 8, t.mesh, true);
    dv.setUint16(6 + i * 8, t.poly, true);
    dv.setUint32(8 + i * 8, t.k, true);
  });
  return out;
}

export function decodeSelection(u8: Uint8Array): { mesh: number; poly: number; k: number }[] {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(0, true);
  const out: { mesh: number; poly: number; k: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ mesh: dv.getUint16(4 + i * 8, true), poly: dv.getUint16(6 + i * 8, true), k: dv.getUint32(8 + i * 8, true) });
  return out;
}

class UnionFind {
  p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[ra] = rb;
  }
}

type Box = [number, number, number, number, number, number];
const emptyBox = (): Box => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
function grow(b: Box, x: number, y: number, z: number) {
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (z < b[2]) b[2] = z;
  if (x > b[3]) b[3] = x;
  if (y > b[4]) b[4] = y;
  if (z > b[5]) b[5] = z;
}
function merge(a: Box, b: Box) {
  grow(a, b[0], b[1], b[2]);
  grow(a, b[3], b[4], b[5]);
}
function overlaps(a: Box, b: Box, m: number) {
  return a[0] - m <= b[3] && b[0] - m <= a[3] && a[1] - m <= b[4] && b[1] - m <= a[4] && a[2] - m <= b[5] && b[2] - m <= a[5];
}

// Triangles of a model's meshes with every vertex in model space (rigid meshes moved by their bone)
function bakeBones(model: GfModel) {
  const mats = boneWorldMatrices(model.bones);
  for (const mesh of model.meshes) {
    const m = mats[mesh.bone];
    if (!m || mesh.skinned || isIdentity(m)) continue;
    transformPoints(m, mesh.position, false);
    if (mesh.normal) transformPoints(m, mesh.normal, true);
  }
}

// One LGM from a set of triangles (grouped by mesh+material), vertices offset by -pivot
function buildLgm(model: GfModel, tris: Tri[], pivot: [number, number, number], materialsOut: LgmMaterial[], matIndex: Map<number, number>): LgmModel {
  const groups = new Map<string, Tri[]>();
  for (const t of tris) {
    const mat = model.meshes[t.mesh].polygons[t.poly].material;
    const k = `${t.mesh}:${mat}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(t);
  }
  const meshes: LgmMeshData[] = [];
  const box = emptyBox();
  for (const [k, ts] of groups) {
    const [mi, mat] = k.split(':').map(Number);
    const src = model.meshes[mi];
    const remap = new Map<number, number>();
    const order: number[] = [];
    const index = new Uint32Array(ts.length * 3);
    let n = 0;
    for (const t of ts)
      for (const v of [t.a, t.b, t.c]) {
        let r = remap.get(v);
        if (r === undefined) {
          r = order.length;
          remap.set(v, r);
          order.push(v);
        }
        index[n++] = r;
      }
    let li = matIndex.get(mat);
    if (li === undefined) {
      li = materialsOut.length;
      matIndex.set(mat, li);
      materialsOut.push(toLgmMaterial(model.materials[mat] ?? { name: '?', shader: '', textures: {}, switches: {}, ints: {}, floats: {}, colors: {} }));
    }
    const lm = materialsOut[li];
    const position = new Float32Array(order.length * 3);
    const normal = src.normal ? new Float32Array(order.length * 3) : null;
    const uv0 = src.uv0 ? new Float32Array(order.length * 2) : null;
    const uv1 = src.uv1 && lm.uvSet === 1 ? new Float32Array(order.length * 2) : null;
    const color = src.color && lm.vertexColor ? new Uint8Array(order.length * 4) : null;
    order.forEach((v, i) => {
      for (let c = 0; c < 3; c++) position[i * 3 + c] = src.position[v * 3 + c] - pivot[c];
      grow(box, position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      if (normal) for (let c = 0; c < 3; c++) normal[i * 3 + c] = src.normal![v * 3 + c];
      if (uv0) for (let c = 0; c < 2; c++) uv0[i * 2 + c] = src.uv0![v * 2 + c];
      if (uv1) for (let c = 0; c < 2; c++) uv1[i * 2 + c] = src.uv1![v * 2 + c];
      if (color) for (let c = 0; c < 4; c++) color[i * 4 + c] = src.color![v * 4 + c];
    });
    meshes.push({
      material: li,
      position,
      normal: normal && quantizeNormals(normal),
      uv0,
      uv1,
      color,
      index: packIndices(index, order.length),
    });
  }
  if (!isFinite(box[0])) box.splice(0, 6, 0, 0, 0, 0, 0, 0);
  return { bounds: box, materials: materialsOut, meshes };
}

function allTris(model: GfModel, meshIdx: number[]): Tri[] {
  const out: Tri[] = [];
  for (const mi of meshIdx)
    model.meshes[mi].polygons.forEach((p, pi) => {
      for (let k = 0; k + 2 < p.indices.length; k += 3) out.push({ mesh: mi, poly: pi, k: k / 3, a: p.indices[k], b: p.indices[k + 1], c: p.indices[k + 2] });
    });
  return out;
}

// Instances in a family of meshes: connected components, clustered when their boxes touch
function instances(model: GfModel, meshIdx: number[], margin: number): { tris: Tri[]; box: Box }[] {
  interface Comp {
    tris: Tri[];
    box: Box;
  }
  const comps: Comp[] = [];
  for (const mi of meshIdx) {
    const mesh = model.meshes[mi];
    const uf = new UnionFind(mesh.vertexCount);
    for (const p of mesh.polygons)
      for (let k = 0; k + 2 < p.indices.length; k += 3) {
        uf.union(p.indices[k], p.indices[k + 1]);
        uf.union(p.indices[k], p.indices[k + 2]);
      }
    const byRoot = new Map<number, Comp>();
    mesh.polygons.forEach((p, pi) => {
      for (let k = 0; k + 2 < p.indices.length; k += 3) {
        const a = p.indices[k], b = p.indices[k + 1], c = p.indices[k + 2];
        if (a >= mesh.vertexCount || b >= mesh.vertexCount || c >= mesh.vertexCount) continue;
        const r = uf.find(a);
        let comp = byRoot.get(r);
        if (!comp) byRoot.set(r, (comp = { tris: [], box: emptyBox() }));
        comp.tris.push({ mesh: mi, poly: pi, k: k / 3, a, b, c });
        for (const v of [a, b, c]) grow(comp.box, mesh.position[v * 3], mesh.position[v * 3 + 1], mesh.position[v * 3 + 2]);
      }
    });
    comps.push(...byRoot.values());
  }
  // cluster touching components (spatial hash on XZ)
  const uf = new UnionFind(comps.length);
  const CELL = 400;
  const grid = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const x0 = Math.floor((c.box[0] - margin) / CELL), x1 = Math.floor((c.box[3] + margin) / CELL);
    const z0 = Math.floor((c.box[2] - margin) / CELL), z1 = Math.floor((c.box[5] + margin) / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) return; // huge: stays alone
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = `${x},${z}`;
        const list = grid.get(k);
        if (list) {
          for (const j of list) if (uf.find(i) !== uf.find(j) && overlaps(c.box, comps[j].box, margin)) uf.union(i, j);
          list.push(i);
        } else grid.set(k, [i]);
      }
  });
  const clusters = new Map<number, { tris: Tri[]; box: Box }>();
  comps.forEach((c, i) => {
    const r = uf.find(i);
    let cl = clusters.get(r);
    if (!cl) clusters.set(r, (cl = { tris: [], box: emptyBox() }));
    cl.tris.push(...c.tris);
    merge(cl.box, c.box);
  });
  return [...clusters.values()];
}

// ---- textures

class TextureStore {
  private written = new Set<string>();
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.png')) this.written.add(f.slice(0, -4));
  }
  has(name: string) {
    return this.written.has(name);
  }
  writeLeaves(name: string, base: BntxTexture, ramp: BntxTexture, hi: BntxTexture | undefined) {
    if (this.written.has(name)) return;
    this.written.add(name);
    try {
      const b = decodeTexture(base);
      const r = decodeTexture(ramp);
      const h = hi ? decodeTexture(hi) : null;
      if (!b || !r) return;
      // the ramp's lit color: its upper part, where the leaves catch the light
      const acc = [0, 0, 0, 0];
      for (let y = 0; y < Math.max(1, Math.floor(r.height * 0.45)); y++)
        for (let x = 0; x < r.width; x++) {
          const o = (y * r.width + x) * 4;
          const a = r.rgba[o + 3] / 255;
          acc[0] += r.rgba[o] * a;
          acc[1] += r.rgba[o + 1] * a;
          acc[2] += r.rgba[o + 2] * a;
          acc[3] += a;
        }
      const lit = acc[3] ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] : [80, 170, 70];
      const out = new Uint8Array(b.rgba.length);
      for (let i = 0; i < b.width * b.height; i++) {
        const o = i * 4;
        let hv = 0;
        if (h) {
          const hx = Math.floor(((i % b.width) / b.width) * h.width);
          const hy = Math.floor((Math.floor(i / b.width) / b.height) * h.height);
          hv = h.rgba[(hy * h.width + hx) * 4] / 255;
        }
        const k = 0.5 + 0.5 * hv;
        for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.round(lit[c] * k * 0.72 + b.rgba[o + c] * 0.6));
        out[o + 3] = b.rgba[o + 3];
      }
      writeFileSync(join(this.dir, safeId(name) + '.png'), encodePng(b.width, b.height, out));
    } catch {
      /* leave untextured */
    }
  }

  write(t: BntxTexture) {
    if (this.written.has(t.name)) return;
    this.written.add(t.name);
    try {
      const img = decodeTexture(t);
      if (!img) return;
      // keep the cache light: halve anything above 1024
      let { width, height, rgba } = img;
      while (width > 1024 || height > 1024) {
        const w2 = width >> 1, h2 = height >> 1;
        const out = new Uint8Array(w2 * h2 * 4);
        for (let y = 0; y < h2; y++)
          for (let x = 0; x < w2; x++)
            for (let c = 0; c < 4; c++) {
              const s = (yy: number, xx: number) => rgba[((y * 2 + yy) * width + x * 2 + xx) * 4 + c];
              out[(y * w2 + x) * 4 + c] = (s(0, 0) + s(0, 1) + s(1, 0) + s(1, 1)) >> 2;
            }
        width = w2;
        height = h2;
        rgba = out;
      }
      writeFileSync(join(this.dir, safeId(t.name) + '.png'), encodePng(width, height, rgba));
    } catch {
      /* undecodable format: the material shows untextured */
    }
  }
}

interface PakContents {
  models: { index: number; model: GfModel; pathName: string | null }[];
  textures: Map<string, BntxTexture>;
}

function readPak(fs: GameFS, path: string, knownPaths: Map<bigint, string>): PakContents {
  const pak = new Gfpak(fs.read(path));
  const out: PakContents = { models: [], textures: new Map() };
  for (const f of pak.files) {
    let d: Uint8Array;
    try {
      d = pak.read(f);
    } catch {
      continue;
    }
    if (d[0] === 0x42 && d[1] === 0x4e && d[2] === 0x54 && d[3] === 0x58) {
      try {
        for (const t of parseBntx(d)) out.textures.set(t.name, t);
      } catch {
        /* skip */
      }
    } else if (isGfbmdl(d)) {
      try {
        out.models.push({ index: f.index, model: parseGfbmdl(d), pathName: knownPaths.get(f.pathHash) ?? null });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

// Textures by name across every archive: a zone's model takes most of its textures from its area's pack
// (area01.gfpak for area01/*.gfpak), shared ones from others.
class TextureLookup {
  private index = new Map<string, string>();
  private cache = new Map<string, Map<string, BntxTexture>>();
  private fs: GameFS;
  constructor(fs: GameFS, paks: string[], progress: (p: ExtractProgress) => void) {
    this.fs = fs;
    paks.forEach((p, i) => {
      progress({ phase: 'Indexando texturas', done: i, total: paks.length, message: p.slice(FIELD.length + 1) });
      for (const name of this.load(p, false).keys()) if (!this.index.has(name)) this.index.set(name, p);
    });
  }
  private load(pakPath: string, keep: boolean): Map<string, BntxTexture> {
    const hit = this.cache.get(pakPath);
    if (hit) return hit;
    const m = new Map<string, BntxTexture>();
    try {
      const pak = new Gfpak(this.fs.read(pakPath));
      for (const f of pak.files) {
        const d = pak.read(f);
        if (d[0] === 0x42 && d[1] === 0x4e && d[2] === 0x54 && d[3] === 0x58) for (const t of parseBntx(d)) m.set(t.name, t);
      }
    } catch {
      /* unreadable pack */
    }
    if (keep) {
      this.cache.set(pakPath, m);
      if (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
    }
    return m;
  }
  get(name: string, local: Map<string, BntxTexture>): BntxTexture | undefined {
    const l = local.get(name);
    if (l) return l;
    const p = this.index.get(name);
    return p ? this.load(p, true).get(name) : undefined;
  }
}

// RomFS paths the placement data names (to name buildmodel's files, which are only hashes in the archive)
function knownPaths(fs: GameFS): Map<bigint, string> {
  const m = new Map<bigint, string>();
  const p = `${FIELD}/placement.gfpak`;
  if (!fs.exists(p)) return m;
  const pak = new Gfpak(fs.read(p));
  const td = new TextDecoder('latin1');
  for (const f of pak.files) {
    const s = td.decode(pak.read(f));
    for (const x of s.matchAll(/bin\/[\x21-\x7e]+?\.(gfbmdl|gfbcol|gfbanmcfg|gfblt|ptcl)/g)) m.set(fnv1a64(x[0]), x[0]);
  }
  return m;
}

function listPaks(fs: GameFS, dir: string): string[] {
  const out: string[] = [];
  const { files, dirs } = fs.list(dir);
  for (const f of files) if (f.endsWith('.gfpak')) out.push(`${dir}/${f}`);
  for (const d of dirs) out.push(...listPaks(fs, `${dir}/${d}`));
  return out.sort();
}

function round(b: Box): Box {
  return b.map((v) => Math.round(v * 10) / 10) as Box;
}

export function extractCatalog(opts: ExtractOptions): Catalog {
  const progress = opts.onProgress ?? (() => {});
  const fs = openGameFS(opts.gamePath);
  if (!fs) throw new Error('No se encuentran los archivos del juego (bin/archive/field) en esa carpeta');
  const maxPer = opts.maxInstancesPerFamily ?? 6;
  const modelsDir = join(opts.cacheDir, 'models');
  if (existsSync(modelsDir)) rmSync(modelsDir, { recursive: true, force: true });
  mkdirSync(modelsDir, { recursive: true });
  const texStore = new TextureStore(join(opts.cacheDir, 'textures'));
  const assets: AssetEntry[] = [];
  const seen = new Set<string>();
  const groundTextures = new Set<string>();

  progress({ phase: 'Leyendo índice del juego', done: 0, total: 1 });
  const known = knownPaths(fs);
  const paks = listPaks(fs, FIELD).filter((p) => !/placement\.gfpak$|test_chr/.test(p));
  const texLookup = new TextureLookup(fs, paks, progress);

  const save = (entry: AssetEntry, lgm: LgmModel, textures: Map<string, BntxTexture>) => {
    for (const m of lgm.materials) {
      for (const t of [m.map, m.map2]) {
        if (!t) continue;
        const comp = composites.get(t);
        if (comp) {
          const base = texLookup.get(comp.base, textures);
          const ramp = texLookup.get(comp.ramp, textures);
          if (base && ramp) texStore.writeLeaves(t, base, ramp, comp.hi ? texLookup.get(comp.hi, textures) : undefined);
          else if (!texStore.has(t)) m.map = base ? comp.base : null;
          if (base && !ramp) texStore.write(base);
          continue;
        }
        const tex = texLookup.get(t, textures);
        if (tex) texStore.write(tex);
        else if (!texStore.has(t)) m.map === t ? (m.map = null) : (m.map2 = null);
      }
    }
    writeFileSync(join(modelsDir, entry.id + '.lgm'), deflateSync(encodeLgm(lgm), { level: 6 }));
    assets.push(entry);
  };

  paks.forEach((pakPath, pi) => {
    const rel = pakPath.slice(FIELD.length + 1).replace(/\.gfpak$/, '');
    progress({ phase: 'Extrayendo modelos', done: pi, total: paks.length, message: rel });
    let contents: PakContents;
    try {
      contents = readPak(fs, pakPath, known);
    } catch {
      return;
    }
    const isObjects = rel === 'buildmodel';
    for (const { index, model, pathName } of contents.models) {
      bakeBones(model);
      // fake shadow casters: invisible in the game's color pass
      for (const mesh of model.meshes)
        mesh.polygons = mesh.polygons.map((p) =>
          /ShadowOnly/i.test(model.materials[p.material]?.shader ?? '') ? { ...p, indices: new Uint16Array(0) } : p,
        ); // (emptied, not removed: polygon numbers stay the model's)
      const rootName = model.bones[0]?.name || `model${index}`;
      const allMeshes = model.meshes.map((_, i) => i);
      if (isObjects) {
        const name = pathName ? pathName.split('/').pop()!.replace(/\.gfbmdl$/, '') : rootName;
        if (SKIP_FAMILY.test(name)) continue;
        const mats: LgmMaterial[] = [];
        const lgm = buildLgm(model, allTris(model, allMeshes), [0, 0, 0], mats, new Map());
        save(
          {
            id: safeId(`bm.${name}`),
            name,
            category: categorize(name),
            zone: null,
            source: { kind: 'model', pak: pakPath, path: pathName, fileIndex: index },
            bounds: round(lgm.bounds as Box),
            triangles: lgm.meshes.reduce((n, m) => n + m.index.length / 3, 0),
          },
          lgm,
          contents.textures,
        );
        continue;
      }

      const zone = rel.split('/').pop()!;
      const zoneKey = safeId(rel.replace(/\//g, '.')) + (contents.models.length > 1 ? `.${index}` : '');
      // the whole zone
      {
        const tris = allTris(
          model,
          allMeshes.filter((mi) => !SKIP_FAMILY.test(model.bones[model.meshes[mi].bone]?.name ?? '')),
        );
        const lgm = buildLgm(model, tris, [0, 0, 0], [], new Map());
        if (lgm.meshes.length)
          save(
            {
              id: `zn.${zoneKey}`,
              name: rootName,
              category: 'zone',
              zone,
              source: { kind: 'zone', pak: pakPath, fileIndex: index },
              bounds: round(lgm.bounds as Box),
              triangles: tris.length,
            },
            lgm,
            contents.textures,
          );
      }

      // families: the group each mesh belongs to
      const depthChain = (b: number): number[] => {
        const chain: number[] = [];
        for (let i = b, n = 0; i >= 0 && i < model.bones.length && n < 64; i = model.bones[i].parent, n++) chain.unshift(i);
        return chain;
      };
      const families = new Map<string, { meshes: number[]; container: string }>();
      model.meshes.forEach((mesh, mi) => {
        let chain = depthChain(mesh.bone);
        if (chain.length > 1 && model.bones[chain[0]].name === rootName) chain = chain.slice(1);
        const d0 = model.bones[chain[0]]?.name ?? rootName;
        const d1 = chain.length > 1 ? model.bones[chain[1]].name : null;
        const stem = d0.replace(/_group$/i, '');
        let family = d0;
        if (d1 && !HASHY.test(d1) && !d1.startsWith(stem + '_')) family = d1;
        if (SKIP_FAMILY.test(family) || SKIP_FAMILY.test(d0)) return;
        let f = families.get(family);
        if (!f) families.set(family, (f = { meshes: [], container: d0 }));
        f.meshes.push(mi);
        const mat = model.materials[mesh.polygons[0]?.material ?? -1];
        if (mat && /Ground|Cliff/i.test(mat.shader)) {
          for (const s of ['GrassTex01', 'GroundTex01', 'GroundTex02', 'GrassTex02', 'Texture01', 'CliffTex01'])
            if (mat.textures[s]) {
              const tex = texLookup.get(mat.textures[s], contents.textures);
              if (!tex) continue;
              groundTextures.add(mat.textures[s]);
              texStore.write(tex);
            }
        }
      });

      for (const [family, { meshes, container }] of families) {
        const display = family.replace(new RegExp(`^${zone.replace(/_00$/, '')}(_00)?_`), '');
        const category = categorize(family, container);
        if (category === 'water') continue;
        const inst = instances(model, meshes, 15)
          .filter((c) => c.box[3] - c.box[0] < 4000 && c.box[5] - c.box[2] < 4000 && c.tris.length > 0)
          .sort((a, b) => b.tris.length - a.tris.length);
        let kept = 0;
        for (const c of inst) {
          if (kept >= maxPer) break;
          const dims = [c.box[3] - c.box[0], c.box[5] - c.box[2]].sort((a, b) => a - b);
          const sig = `${display.replace(/_?\d+$/, '')}|${c.tris.length}|${Math.round(dims[0] / 5)}|${Math.round(dims[1] / 5)}|${Math.round((c.box[4] - c.box[1]) / 5)}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          const pivot: [number, number, number] = [(c.box[0] + c.box[3]) / 2, c.box[1], (c.box[2] + c.box[5]) / 2];
          const lgm = buildLgm(model, c.tris, pivot, [], new Map());
          if (!lgm.meshes.length) continue;
          writeFileSync(join(modelsDir, safeId(`zp.${zoneKey}.${family}.${kept}`) + '.sel'), encodeSelection(c.tris));
          save(
            {
              id: safeId(`zp.${zoneKey}.${family}.${kept}`),
              name: kept ? `${display} ${kept + 1}` : display,
              category,
              zone,
              source: { kind: 'zonePiece', pak: pakPath, fileIndex: index, family, pivot, instance: kept },
              bounds: round(lgm.bounds as Box),
              triangles: c.tris.length,
            },
            lgm,
            contents.textures,
          );
          kept++;
        }
      }
    }
  });

  // ground tiles
  progress({ phase: 'Generando baldosas de suelo', done: 0, total: groundTextures.size });
  for (const tex of groundTextures) {
    for (const cells of [1, 4]) {
      const s = 100 * cells;
      const h = s / 2;
      const lgm: LgmModel = {
        bounds: [-h, 0, -h, h, 0, h],
        materials: [{ name: tex, map: tex, map2: null, uvSet: 0, uvScale: [1, 1], alphaTest: 0, blend: false, doubleSided: false, color: [1, 1, 1], vertexColor: false }],
        meshes: [
          {
            material: 0,
            position: new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
            normal: new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0]),
            uv0: new Float32Array([0, 0, cells, 0, cells, cells, 0, cells]),
            uv1: null,
            color: null,
            index: new Uint16Array([0, 2, 1, 0, 3, 2]),
          },
        ],
      };
      writeFileSync(join(modelsDir, safeId(`tile.${tex}.${cells}`) + '.lgm'), deflateSync(encodeLgm(lgm)));
      assets.push({
        id: safeId(`tile.${tex}.${cells}`),
        name: `${tex} ${cells}x${cells}`,
        category: 'ground',
        zone: null,
        source: { kind: 'tile', texture: tex, cells },
        bounds: lgm.bounds,
        triangles: 2,
      });
    }
  }

  // the map's markers: where the player arrives (an arrow) and the teleporter back (the game's warp tile)
  {
    const arrow: LgmModel = {
      bounds: [-40, 0, -50, 40, 2, 60],
      materials: [{ name: 'spawn', map: null, map2: null, uvSet: 0, uvScale: [1, 1], alphaTest: 0, blend: false, doubleSided: true, color: [0.2, 0.75, 1], vertexColor: false }],
      meshes: [
        {
          material: 0,
          position: new Float32Array([-40, 2, -50, 40, 2, -50, 0, 2, 60, -15, 2, -50, 15, 2, -50, -15, 2, -50]),
          normal: new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0]),
          uv0: null,
          uv1: null,
          color: null,
          index: new Uint16Array([0, 2, 1]),
        },
      ],
    };
    writeFileSync(join(modelsDir, 'lg.spawn.lgm'), deflateSync(encodeLgm(arrow)));
    assets.unshift({ id: 'lg.spawn', name: 'Punto de llegada', category: 'marker', zone: null, source: { kind: 'marker', marker: 'spawn' }, bounds: arrow.bounds, triangles: 1 });
    // a tall-grass zone (drawn by the editor as tufts over its cells; its thumbnail is the game's tuft)
    const tuft = assets.find((a) => a.id === 'bm.enc_grass01');
    if (tuft && existsSync(join(modelsDir, 'bm.enc_grass01.lgm'))) {
      writeFileSync(join(modelsDir, 'lg.grass.lgm'), readFileSync(join(modelsDir, 'bm.enc_grass01.lgm')));
      assets.unshift({ id: 'lg.grass', name: 'Zona de hierba alta (Pokémon salvajes)', category: 'grass', zone: null, source: { kind: 'marker', marker: 'grass' }, bounds: tuft.bounds, triangles: tuft.triangles });
    }
    // raised ground and stairs (drawn by the editor from their settings; these models are their thumbnails)
    const flat = (name: string, map: string | null, color: [number, number, number]): LgmMaterial => ({ name, map, map2: null, uvSet: 0, uvScale: [1, 1], alphaTest: 0, blend: false, doubleSided: true, color, vertexColor: false });
    const boxMesh = (material: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: 'top' | 'sides'): LgmMeshData => {
      const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
      const q = (p: number[][], n: number[]) => {
        const b = pos.length / 3;
        p.forEach((v, i) => {
          pos.push(...v);
          nrm.push(n[0] * 127, n[1] * 127, n[2] * 127);
          uv.push([0, 1, 1, 0][i], [0, 0, 1, 1][i]);
        });
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      };
      if (faces === 'top') q([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
      else {
        q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
        q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
        q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
        q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
      }
      return { material, position: new Float32Array(pos), normal: new Int8Array(nrm), uv0: new Float32Array(uv), uv1: null, color: null, index: new Uint16Array(idx) };
    };
    const has = (t: string) => texStore.has(t);
    const block: LgmModel = {
      bounds: [-150, 0, -100, 150, 50, 100],
      materials: [flat('top', has('grass01_com') ? 'grass01_com' : null, [0.4, 0.7, 0.3]), flat('side', has('cliff04_com') ? 'cliff04_com' : null, [0.55, 0.4, 0.25])],
      meshes: [boxMesh(0, -150, 0, -100, 150, 50, 100, 'top'), boxMesh(1, -150, 0, -100, 150, 50, 100, 'sides')],
    };
    writeFileSync(join(modelsDir, 'lg.terrain.lgm'), deflateSync(encodeLgm(block)));
    const steps: LgmModel = {
      bounds: [-50, 0, -100, 50, 50, 100],
      materials: [flat('steps', has('roadstone01_com') ? 'roadstone01_com' : null, [0.7, 0.7, 0.65])],
      meshes: [0, 1, 2, 3].flatMap((i) => [boxMesh(0, -50, 0, 100 - (i + 1) * 50, 50, 12.5 * (i + 1), 100 - i * 50, 'top'), boxMesh(0, -50, 12.5 * i, 100 - (i + 1) * 50, 50, 12.5 * (i + 1), 100 - i * 50, 'sides')]),
    };
    writeFileSync(join(modelsDir, 'lg.stairs.lgm'), deflateSync(encodeLgm(steps)));
    assets.unshift(
      { id: 'lg.stairs', name: 'Escaleras', category: 'ledge', zone: null, source: { kind: 'marker', marker: 'stairs' }, bounds: steps.bounds as Box, triangles: 40 },
      { id: 'lg.terrain', name: 'Elevación (desnivel, saltos)', category: 'ledge', zone: null, source: { kind: 'marker', marker: 'terrain' }, bounds: block.bounds as Box, triangles: 10 },
    );
    // a sign the player reads (its model: Pallet Town's signboard)
    const board = assets.find((a) => a.id === 'zp.area02.town001_00.signboard01.0');
    if (board && existsSync(join(modelsDir, `${board.id}.lgm`))) {
      writeFileSync(join(modelsDir, 'lg.sign.lgm'), readFileSync(join(modelsDir, `${board.id}.lgm`)));
      assets.unshift({ id: 'lg.sign', name: 'Cartel con texto', category: 'street', zone: null, source: { kind: 'marker', marker: 'sign' }, bounds: board.bounds, triangles: board.triangles });
    }
    const pad = assets.find((a) => a.id === 'bm.warp01');
    if (pad && existsSync(join(modelsDir, 'bm.warp01.lgm'))) {
      writeFileSync(join(modelsDir, 'lg.exit.lgm'), readFileSync(join(modelsDir, 'bm.warp01.lgm')));
      assets.unshift({ id: 'lg.exit', name: 'Salida (teletransportador)', category: 'marker', zone: null, source: { kind: 'marker', marker: 'exit' }, bounds: pad.bounds, triangles: pad.triangles });
    }
  }

  const catalog: Catalog = { version: CATALOG_VERSION, gamePath: opts.gamePath, createdAt: new Date().toISOString(), assets };
  writeFileSync(join(opts.cacheDir, 'catalog.json'), JSON.stringify(catalog));
  progress({ phase: 'Catálogo listo', done: 1, total: 1, message: `${assets.length} objetos` });
  return catalog;
}

export function cacheSize(dir: string): number {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    n += st.isDirectory() ? cacheSize(p) : st.size;
  }
  return n;
}
