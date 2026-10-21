// Builds a map made in the editor into files the game loads: one of the game's unused map slots (the character test
// maps, test_chr01..04) gets the map's model, collision and terrain, and a teleporter in an existing map leads to it.
//
//   bin/field/model/<slot>/<slot>.gfbmdl           every object's triangles merged into one model, from the game's own
//                                                    vertex data (moved to their place on the map)
//   bin/archive/field/<slot>.gfpak                  the slot's shaders and textures, plus those the merged materials use
//                                                    (<material>.bnsh_vsh / .bnsh_fsh and <texture>.bntx, copied from
//                                                    the packs the pieces come from)
//   bin/field/model/<slot>/<slot>_floor|wall|zone.gfbcol   collision: the floor, walls around the map and around
//                                                    solid objects, and the zone's shape
//   bin/field/param/terrain/<slot>/terrain_data.bin the slot's terrain block, resized to the map
//   bin/archive/field/placement.gfpak               the slot without its test characters, a teleporter back, and the
//                                                    teleporter that leads there
//   bin/archive/script_amx.gfpak                    the zone scripts every zone needs (the test maps have none)
import { FB, Table } from './formats/flatbuf.ts';
import { FBEditor, buildTable, cloneWithSchema, learnSchema, type FieldSpec, type Schema } from './formats/fbedit.ts';
import { Gfpak, fnv1a64, writeGfpak, type GfpakEntry } from './formats/gfpak.ts';
import { boneWorldMatrices, isIdentity, parseGfbmdl, type GfModel } from './formats/gfbmdl.ts';
import type { GameFS } from './formats/gamefs.ts';
import { LIST_INSPECT, Templates, addTeleporter, editZoneList, signMaker, learnZoneSchema, placementPath, rootSettingsFrom, zoneIndexOf } from './placement.ts';
import { ENCOUNT_FILES, ZONE_NAME_TABLE, addEncounterTables, addHashNames, addZone, grassPatchMaker } from './encounters.ts';
import { addQuads, cellsMesh, gfbcol, wallQuad, type ColMesh } from './collision.ts';
import { buildTerrain, stairsSize, WALL_NAMES, type Surface, type TerrainShape } from './terrain.ts';
import { LANGUAGES, MAX_SIGNS, SCRIPT_RECORD, addScriptRecords, labelTable, messageFile, signScript } from './signs.ts';
import { GRASS_ASSET, SIGN_ASSET, SIGN_MODEL, STAIRS_ASSET, TERRAIN_ASSET, cellRect, defaultGrass, defaultStairs, defaultTerrain, grassRect, type AssetEntry, type AssetSource, type Category, type MapDocument, type MapObject, type WildTable } from './types.ts';

export const MAP_SLOTS = ['test_chr01', 'test_chr02', 'test_chr03', 'test_chr04'];

export interface Entrance {
  map: string; // "area02"
  zone: string; // "town001"
  at: [number, number, number]; // where the teleporter is
  back: [number, number, number]; // where the player arrives when coming back
}

export const DEFAULT_ENTRANCE: Entrance = { map: 'area02', zone: 'town001', at: [2050, 0, 900], back: [2050, 0, 1050] };

export interface MapBuildOptions {
  fs: GameFS;
  doc: MapDocument;
  assets: Map<string, AssetEntry>;
  selection: (assetId: string) => Uint8Array | null; // the piece's triangles (cache/models/<id>.sel)
  slot?: string;
  entrance?: Entrance;
  baseGround?: boolean; // keep the slot's own ground under the map (default: the map's slotGround setting)
  yOffset?: number; // the whole map moved up (+) or down (-)
  log?: (s: string) => void;
}

export interface MapBuildResult {
  files: { path: string; data: Uint8Array }[]; // RomFS paths
  warnings: string[];
  spawn: [number, number, number];
  stats: { objects: number; meshes: number; materials: number; textures: number; triangles: number };
}

export const SPAWN_ASSET = 'lg.spawn';
export const EXIT_ASSET = 'lg.exit';
// the editor's own objects: not models
const EDITOR_ASSETS = [SPAWN_ASSET, EXIT_ASSET, GRASS_ASSET, TERRAIN_ASSET, STAIRS_ASSET];

const SOLID: Category[] = ['pc', 'shop', 'gym', 'building', 'tree', 'rock', 'fence', 'street', 'water'];

// ---- math (column-major 4x4, three.js conventions: Euler XYZ = Rx * Ry * Rz)

type M4 = number[];
const DEG = Math.PI / 180;

function compose(p: number[], rDeg: number[], s: number[]): M4 {
  const [x, y, z] = rDeg.map((v) => v * DEG);
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m = [
    c * e, af + be * d, bf - ae * d, 0,
    -c * f, ae - bf * d, be + af * d, 0,
    d, -b * c, a * c, 0,
    p[0], p[1], p[2], 1,
  ];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) m[i * 4 + k] *= s[i];
  return m;
}

function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

const apply = (m: M4, x: number, y: number, z: number): [number, number, number] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
const applyDir = (m: M4, x: number, y: number, z: number): [number, number, number] => {
  const v: [number, number, number] = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function worldMatrix(o: MapObject, byId: Map<string, MapObject>): M4 {
  let m = compose(o.position, o.rotation, o.scale);
  for (let p = o.parent ? byId.get(o.parent) : undefined, n = 0; p && n < 64; p = p.parent ? byId.get(p.parent) : undefined, n++)
    m = mul(compose(p.position, p.rotation, p.scale), m);
  return m;
}

// the schema of a nested table: field a's elements (or table), then their field b ...
function subSchema(schema: Schema, ...path: number[]): Schema {
  let s = schema;
  for (const i of path) {
    const k = s.get(i);
    if (!k || (k.kind !== 'table' && k.kind !== 'vtables')) return new Map();
    s = k.schema;
  }
  return s;
}

// ---- half floats

const f32bits = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >>> 13);
}
function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 31;
  const f = h & 1023;
  if (!e) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// ---- source models

const FORMAT_SIZE: Record<number, number> = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 8: 1 };

interface SourceModel {
  key: string;
  pak: string;
  ed: FBEditor; // the model file
  root: Table;
  gf: GfModel; // parsed (materials, bones)
  boneMats: number[][];
  meshBone: Map<number, number>;
  textures: string[];
}

class Sources {
  private paks = new Map<string, Gfpak>();
  private models = new Map<string, SourceModel>();
  private fs: GameFS;
  private nameIndex: Map<bigint, string> | null = null; // shader/texture file name hash -> pack

  constructor(fs: GameFS) {
    this.fs = fs;
  }

  pak(path: string): Gfpak {
    let p = this.paks.get(path);
    if (!p) this.paks.set(path, (p = new Gfpak(this.fs.read(path))));
    return p;
  }

  model(pakPath: string, fileIndex: number): SourceModel {
    const key = `${pakPath}#${fileIndex}`;
    let m = this.models.get(key);
    if (m) return m;
    const pak = this.pak(pakPath);
    const data = pak.read(pak.files[fileIndex]);
    const gf = parseGfbmdl(data);
    const root = new FB(data).root();
    const meshBone = new Map<number, number>();
    for (const g of root.tables(7)) meshBone.set(g.u32(1), g.u32(0));
    m = { key, pak: pakPath, ed: new FBEditor(data), root, gf, boneMats: boneWorldMatrices(gf.bones), meshBone, textures: root.strings(2) };
    this.models.set(key, m);
    return m;
  }

  // a model that is a file of its own (a map slot's)
  modelFile(path: string, packNear: string): SourceModel {
    const key = path;
    let m = this.models.get(key);
    if (m) return m;
    const data = this.fs.read(path);
    const gf = parseGfbmdl(data);
    const root = new FB(data).root();
    const meshBone = new Map<number, number>();
    for (const g of root.tables(7)) meshBone.set(g.u32(1), g.u32(0));
    m = { key, pak: packNear, ed: new FBEditor(data), root, gf, boneMats: boneWorldMatrices(gf.bones), meshBone, textures: root.strings(2) };
    this.models.set(key, m);
    return m;
  }

  // a shader or texture file by name: the model's own pack, its area's pack, then any pack
  file(name: string, near: string): Uint8Array | null {
    const h = fnv1a64(name);
    const tryPak = (p: string) => {
      if (!this.fs.exists(p)) return null;
      const pak = this.pak(p);
      const f = pak.files.find((x) => x.nameHash === h);
      return f ? pak.read(f) : null;
    };
    const area = near.replace(/\/[^/]+\.gfpak$/, '.gfpak');
    for (const p of [near, area]) {
      const d = tryPak(p);
      if (d) return d;
    }
    if (!this.nameIndex) {
      this.nameIndex = new Map();
      const walk = (dir: string) => {
        const { files, dirs } = this.fs.list(dir);
        for (const f of files)
          if (f.endsWith('.gfpak') && !/placement|script/.test(f)) {
            const p = `${dir}/${f}`;
            try {
              for (const x of new Gfpak(this.fs.read(p)).files) if (!this.nameIndex!.has(x.nameHash)) this.nameIndex!.set(x.nameHash, p);
            } catch {
              /* unreadable */
            }
          }
        for (const d of dirs) walk(`${dir}/${d}`);
      };
      walk('bin/archive/field');
    }
    const p = this.nameIndex.get(h);
    return p ? tryPak(p) : null;
  }
}

// The invisible shadow casters (FieldShadowOnlyShader: drawn only into the shadow map, e.g. a tree's crown as a few
// solid shapes) of a piece of a zone model: the catalog leaves them out of the pieces, so they are found again here,
// in the piece's family (its group of meshes) and inside the piece's box.
function shadowCasters(gf: GfModel, family: string, pick: Map<number, Map<number, number[]>>, add: (mesh: number, poly: number, k: number) => void) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const [mi, polys] of pick) {
    const mesh = gf.meshes[mi];
    for (const [pi, ks] of polys)
      for (const k of ks)
        for (let c = 0; c < 3; c++) {
          const v = mesh.polygons[pi].indices[k * 3 + c];
          for (let a = 0; a < 3; a++) {
            box[a] = Math.min(box[a], mesh.position[v * 3 + a]);
            box[a + 3] = Math.max(box[a + 3], mesh.position[v * 3 + a]);
          }
        }
  }
  if (!isFinite(box[0])) return;
  const m = 30;
  gf.meshes.forEach((mesh, mi) => {
    const chain: string[] = [];
    for (let b = mesh.bone, n = 0; b >= 0 && b < gf.bones.length && n < 64; b = gf.bones[b].parent, n++) chain.push(gf.bones[b].name);
    if (!chain.includes(family)) return;
    mesh.polygons.forEach((p, pi) => {
      if (!/ShadowOnly/i.test(gf.materials[p.material]?.shader ?? '')) return;
      for (let k = 0; k < Math.floor(p.indices.length / 3); k++) {
        const c = [0, 1, 2].map((a) => (mesh.position[p.indices[k * 3] * 3 + a] + mesh.position[p.indices[k * 3 + 1] * 3 + a] + mesh.position[p.indices[k * 3 + 2] * 3 + a]) / 3);
        if (c[0] >= box[0] - m && c[0] <= box[3] + m && c[1] >= box[1] - m && c[1] <= box[4] + m && c[2] >= box[2] - m && c[2] <= box[5] + m) add(mi, pi, k);
      }
    });
  });
}

// ---- the editor's surfaces (ground tiles, terrain): quads drawn with a game material whose texture is replaced

// a ground material with a single texture (Route 1's paving stones: FieldObjectShader, Texture01, the ground's toon
// shading table)
const SURFACE_TEMPLATE = { pak: 'bin/archive/field/area02/road001_00.gfpak', fileIndex: 0, material: 'roadstone01_com' };


// the direction of +u along the quad's surface
function tangent(q: Surface): [number, number, number] {
  const e = [0, 1, 2].map((k) => q.p[1][k] - q.p[0][k]);
  const du = q.uv[1][0] - q.uv[0][0] || 1;
  const l = Math.hypot(...e) || 1;
  return [e[0] / l / Math.sign(du), e[1] / l / Math.sign(du), e[2] / l / Math.sign(du)];
}

// ---- the build

interface MatRef {
  model: SourceModel;
  index: number;
  name: string; // unique name in the merged model (= its shader files' name)
  textures?: Record<string, string>; // sampler -> texture, replacing the material's own (the editor's ground tiles)
}

interface PieceMesh {
  material: number[]; // merged material per source polygon
  attrs: Table[];
  stride: number;
  data: Uint8Array;
  polys: { material: number; indices: Uint16Array }[];
  box: number[];
  srcModel: SourceModel;
}

export function buildMapMod(o: MapBuildOptions): MapBuildResult {
  const slot = o.slot ?? 'test_chr01';
  const entrance = o.entrance ?? DEFAULT_ENTRANCE;
  const log = o.log ?? (() => {});
  const warnings: string[] = [];
  const src = new Sources(o.fs);
  const g = o.doc.grid;
  const byId = new Map(o.doc.objects.map((x) => [x.id, x]));
  const W = g.width * g.cellSize;
  const D = g.depth * g.cellSize;
  // the map's grid starts at the slot's origin; the whole map can be moved up or down (yOffset)
  const Y0 = o.yOffset ?? 0;
  const toSlot = compose([-g.originX, Y0, -g.originZ], [0, 0, 0], [1, 1, 1]);
  const visible = (x: MapObject): boolean => {
    for (let p: MapObject | undefined = x, n = 0; p && n < 64; p = p.parent ? byId.get(p.parent) : undefined, n++) if (!p.visible) return false;
    return true;
  };
  const sourceOf = (id: string): { source: AssetSource; category: Category } | null => {
    const a = o.assets.get(id) ?? o.doc.assets[id];
    return a ? { source: a.source, category: a.category } : null;
  };

  // raised ground and stairs: a height per cell (terrain.ts), in slot coordinates
  const cell = g.cellSize;
  const shapes: TerrainShape[] = [];
  for (const x of o.doc.objects) {
    if ((x.asset !== TERRAIN_ASSET && x.asset !== STAIRS_ASSET) || !visible(x)) continue;
    const m = mul(toSlot, worldMatrix(x, byId));
    const c = apply(m, 0, 0, 0);
    if (x.asset === TERRAIN_ASSET) {
      const t = x.terrain ?? defaultTerrain();
      shapes.push({ kind: 'terrain', ...cellRect(c[0], c[2], t.w, t.d, cell), base: c[1], terrain: t });
    } else {
      const st = x.stairs ?? defaultStairs();
      const fwd = applyDir(m, 0, 0, -1); // the way the object faces: where the stairs climb to
      const dir = Math.abs(fwd[2]) >= Math.abs(fwd[0]) ? (fwd[2] < 0 ? 0 : 2) : fwd[0] > 0 ? 1 : 3;
      const sz = stairsSize(st, dir);
      shapes.push({ kind: 'stairs', ...cellRect(c[0], c[2], sz.w, sz.d, cell), base: c[1], stairs: st, dir });
    }
  }
  const terrain = buildTerrain({ width: g.width, depth: g.depth, cell }, shapes, Y0);
  const onGround = (p: [number, number, number]): [number, number, number] => [p[0], Math.max(p[1], terrain.height(p[0], p[2])), p[2]];

  // spawn and exit markers
  let spawn: [number, number, number] = onGround([W / 2, Y0, D / 2]);
  let exit: [number, number, number] | null = null;
  for (const x of o.doc.objects) {
    if (x.asset !== SPAWN_ASSET && x.asset !== EXIT_ASSET) continue;
    const p = onGround(apply(mul(toSlot, worldMatrix(x, byId)), 0, 0, 0));
    if (x.asset === SPAWN_ASSET) spawn = p;
    else exit = p;
  }
  if (!exit) exit = onGround([spawn[0], spawn[1], spawn[2] + 3 * g.cellSize]);

  // signs: where they are, which way they face, their text (a script event and a message each, signs.ts)
  const signs: { at: [number, number, number]; rotY: number; text: string; label: string }[] = [];
  for (const x of o.doc.objects) {
    if (x.asset !== SIGN_ASSET || !visible(x)) continue;
    if (signs.length >= MAX_SIGNS) {
      warnings.push(`${x.name}: como mucho ${MAX_SIGNS} carteles por mapa`);
      continue;
    }
    const m = mul(toSlot, worldMatrix(x, byId));
    const f = applyDir(m, 0, 0, 1);
    const text = x.sign?.text?.trim() || '...';
    signs.push({ at: onGround(apply(m, 0, 0, 0)), rotY: (Math.atan2(f[0], f[2]) * 180) / Math.PI, text, label: `msg_${slot}_sign_${String(signs.length + 1).padStart(2, '0')}` });
  }

  // tall-grass zones: cells of the slot's grid (the map's grid starts at the slot's origin)
  const grass: { name: string; cells: [number, number][]; center: [number, number, number]; wild: WildTable }[] = [];
  const grassCells = new Set<string>();
  for (const x of o.doc.objects) {
    if (x.asset !== GRASS_ASSET || !visible(x)) continue;
    const z = x.grass ?? defaultGrass();
    const m = mul(toSlot, worldMatrix(x, byId));
    const c = apply(m, 0, 0, 0);
    const { cx0, cz0, w, d } = grassRect(c[0], c[2], z, cell);
    const cells: [number, number][] = [];
    for (let i = 0; i < w; i++)
      for (let k = 0; k < d; k++) {
        const key = `${cx0 + i},${cz0 + k}`;
        if (grassCells.has(key)) continue;
        grassCells.add(key);
        cells.push([cx0 + i, cz0 + k]);
      }
    if (!cells.length) continue;
    if (!z.wild.slots.some((sl) => sl.species && sl.rate)) warnings.push(`${x.name}: zona de hierba sin Pokémon`);
    grass.push({ name: `${slot}_g${grass.length + 1}`, cells, center: onGround([(cx0 + w / 2) * cell, c[1], (cz0 + d / 2) * cell]), wild: z.wild });
  }

  // materials and meshes
  const materials: MatRef[] = [];
  const matIndex = new Map<string, number>();
  const usedNames = new Set<string>();
  const meshes: PieceMesh[] = [];
  const walls: number[][] = []; // footprint boxes [x0, z0, x1, z1] of solid objects
  let triangles = 0;
  let objects = 0;
  let tiles = 0;
  const surfaces = new Map<string, Surface[]>(); // texture -> quads
  const surface = (texture: string, q: Surface) => {
    let l = surfaces.get(texture);
    if (!l) surfaces.set(texture, (l = []));
    l.push(q);
  };

  const mergedMaterial = (m: SourceModel, index: number, textures?: Record<string, string>): number => {
    const k = `${m.key}#${index}#${JSON.stringify(textures ?? {})}`;
    let i = matIndex.get(k);
    if (i !== undefined) return i;
    const orig = textures ? `lg_${Object.values(textures).join('_')}` : m.gf.materials[index]?.name || `mat${index}`;
    let name = orig;
    for (let n = 2; usedNames.has(name); n++) name = `${orig}_${n}`;
    usedNames.add(name);
    i = materials.length;
    materials.push({ model: m, index, name, textures });
    matIndex.set(k, i);
    return i;
  };

  // the chosen triangles of a model, moved by `world` (after the pivot), as meshes of the merged model
  function addPiece(name: string, model: SourceModel, pick: Map<number, Map<number, number[]>>, world: M4, pivot: number[], onBones: boolean): number[] {
    const objBox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const meshTables = model.root.tables(8);
    for (const [mi, polys] of pick) {
      const mt = meshTables[mi];
      if (!mt) continue;
      const attrs = mt.tables(1);
      const layout = attrs.map((a) => ({ type: a.u32(0), fmt: a.u32(1), count: a.u32(2) }));
      const stride = layout.reduce((n, a) => n + (FORMAT_SIZE[a.fmt] ?? 4) * a.count, 0);
      const srcData = mt.bytes(2);
      const srcPolys = mt.tables(0);
      // rigid meshes of objects sit on their bone
      const bone = model.boneMats[model.meshBone.get(mi) ?? 0];
      const skinned = layout.some((a) => a.type === 12);
      const m = !skinned && bone && !isIdentity(bone) && onBones ? mul(world, mul(compose([-pivot[0], -pivot[1], -pivot[2]], [0, 0, 0], [1, 1, 1]), bone)) : mul(world, compose([-pivot[0], -pivot[1], -pivot[2]], [0, 0, 0], [1, 1, 1]));
      const remap = new Map<number, number>();
      const order: number[] = [];
      const outPolys: { material: number; indices: Uint16Array }[] = [];
      for (const [pi, ks] of polys) {
        const sp = srcPolys[pi];
        if (!sp) continue;
        const [fs0] = sp.vec(1);
        const idx: number[] = [];
        for (const k of ks)
          for (let c = 0; c < 3; c++) {
            const v = sp.fb.dv.getUint16(fs0 + (k * 3 + c) * 2, true);
            let r = remap.get(v);
            if (r === undefined) {
              r = order.length;
              remap.set(v, r);
              order.push(v);
            }
            idx.push(r);
          }
        if (idx.length) outPolys.push({ material: mergedMaterial(model, sp.u32(0)), indices: Uint16Array.from(idx) });
      }
      if (!outPolys.length || order.length > 65535) {
        if (order.length > 65535) warnings.push(`${name}: malla demasiado grande`);
        continue;
      }
      // the selected vertices, moved
      const data = new Uint8Array(order.length * stride);
      const dv = new DataView(data.buffer);
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      order.forEach((v, i) => data.set(srcData.subarray(v * stride, v * stride + stride), i * stride));
      let off = 0;
      for (const a of layout) {
        const es = FORMAT_SIZE[a.fmt] ?? 4;
        for (let i = 0; i < order.length; i++) {
          const p = i * stride + off;
          if (a.type === 0 && a.fmt === 0) {
            const q = apply(m, dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true));
            dv.setFloat32(p, q[0], true);
            dv.setFloat32(p + 4, q[1], true);
            dv.setFloat32(p + 8, q[2], true);
            for (let c = 0; c < 3; c++) {
              box[c] = Math.min(box[c], q[c]);
              box[c + 3] = Math.max(box[c + 3], q[c]);
            }
          } else if ((a.type === 1 || a.type === 2) && a.fmt === 1 && a.count >= 3) {
            const q = applyDir(m, fromHalf(dv.getUint16(p, true)), fromHalf(dv.getUint16(p + 2, true)), fromHalf(dv.getUint16(p + 4, true)));
            for (let c = 0; c < 3; c++) dv.setUint16(p + c * 2, toHalf(q[c]), true);
          } else if (a.type === 11) {
            for (let c = 0; c < a.count * es; c++) data[p + c] = 0; // every vertex on the root bone
          } else if (a.type === 12 && a.fmt === 8) {
            for (let c = 0; c < a.count; c++) data[p + c] = c === 0 ? 255 : 0;
          }
        }
        off += es * a.count;
      }
      triangles += outPolys.reduce((n, p) => n + p.indices.length / 3, 0);
      for (let c = 0; c < 3; c++) {
        objBox[c] = Math.min(objBox[c], box[c]);
        objBox[c + 3] = Math.max(objBox[c + 3], box[c + 3]);
      }
      meshes.push({ material: [], attrs, stride, data, polys: outPolys, box, srcModel: model });
    }
    return objBox;
  }

  for (const obj of o.doc.objects) {
    if (!obj.asset || EDITOR_ASSETS.includes(obj.asset) || !visible(obj)) continue;
    const assetId = obj.asset === SIGN_ASSET ? SIGN_MODEL : obj.asset;
    const info = sourceOf(assetId);
    if (!info) {
      warnings.push(`${obj.name}: modelo desconocido (${obj.asset})`);
      continue;
    }
    const s = info.source;
    if (s.kind === 'tile') {
      // a square of `cells` cells centered on the object, the texture repeated once per cell (as the editor shows it)
      const m = mul(toSlot, worldMatrix(obj, byId));
      const h = (s.cells * 100) / 2;
      const c = [[-h, -h], [h, -h], [h, h], [-h, h]];
      surface(s.texture, {
        p: c.map(([x, z]) => apply(m, x, 0, z)),
        uv: [[0, 0], [s.cells, 0], [s.cells, s.cells], [0, s.cells]],
        n: applyDir(m, 0, 1, 0),
      });
      tiles++;
      objects++;
      continue;
    }
    if (s.kind === 'marker') continue;
    let model: SourceModel;
    try {
      model = src.model(s.pak, s.fileIndex);
    } catch (e) {
      warnings.push(`${obj.name}: no se pudo leer ${s.pak} (${(e as Error).message})`);
      continue;
    }
    // which triangles
    const pick = new Map<number, Map<number, number[]>>(); // mesh -> polygon -> triangle numbers
    const add = (mesh: number, poly: number, k: number) => {
      let mp = pick.get(mesh);
      if (!mp) pick.set(mesh, (mp = new Map()));
      let l = mp.get(poly);
      if (!l) mp.set(poly, (l = []));
      l.push(k);
    };
    let pivot = [0, 0, 0];
    if (s.kind === 'zonePiece') {
      pivot = s.pivot;
      const sel = o.selection(assetId);
      if (!sel) {
        warnings.push(`${obj.name}: falta la selección de la pieza (reconstruye el catálogo)`);
        continue;
      }
      const dv = new DataView(sel.buffer, sel.byteOffset, sel.byteLength);
      const n = dv.getUint32(0, true);
      for (let i = 0; i < n; i++) add(dv.getUint16(4 + i * 8, true), dv.getUint16(6 + i * 8, true), dv.getUint32(8 + i * 8, true));
      shadowCasters(model.gf, s.family, pick, add);
    } else {
      model.gf.meshes.forEach((mesh, mi) => mesh.polygons.forEach((p, pi) => {
        for (let k = 0; k < Math.floor(p.indices.length / 3); k++) add(mi, pi, k);
      }));
    }
    const world = mul(toSlot, worldMatrix(obj, byId));
    objects++;
    const objBox = addPiece(obj.name, model, pick, world, pivot, s.kind !== 'zonePiece');
    if (obj.asset === SIGN_ASSET) {
      // a thinner box than the board's: the player has to get within the inspection box (60 deep) to read it
      const c = apply(world, 0, 0, 0);
      const f = applyDir(world, 0, 0, 1);
      const [hw, hd] = Math.abs(f[0]) > Math.abs(f[2]) ? [20, 70] : [70, 20];
      walls.push([c[0] - hw, c[2] - hd, c[0] + hw, c[2] + hd, c[1]]);
    } else if (SOLID.includes(info.category) && objBox[4] - objBox[1] > 40 && isFinite(objBox[0]))
      walls.push([objBox[0], objBox[2], objBox[3], objBox[5], objBox[1]]);
  }
  // a ring of ground around the map (drawn only)
  if (o.doc.border?.texture && o.doc.border.cells > 0) {
    const b = Math.round(o.doc.border.cells) * 100;
    const ring = [
      [-b, -b, W + b, 0],
      [-b, D, W + b, D + b],
      [-b, 0, 0, D],
      [W, 0, W + b, D],
    ];
    for (const [x0, z0, x1, z1] of ring)
      for (let x = x0; x < x1; x += 400)
        for (let z = z0; z < z1; z += 400) {
          const xe = Math.min(x + 400, x1), ze = Math.min(z + 400, z1);
          surface(o.doc.border.texture, {
            p: [[x, Y0, z], [xe, Y0, z], [xe, Y0, ze], [x, Y0, ze]],
            uv: [[x / 100, z / 100], [xe / 100, z / 100], [xe / 100, ze / 100], [x / 100, ze / 100]],
            n: [0, 1, 0],
          });
        }
  }
  for (const { texture, q } of terrain.surfaces) surface(texture, q);
  // the editor's surfaces: a game material for ground (a single texture: FieldObjectShader) with its texture replaced
  if (surfaces.size) {
    const tm = src.model(SURFACE_TEMPLATE.pak, SURFACE_TEMPLATE.fileIndex);
    const mi = tm.gf.meshes.findIndex((m) => m.polygons.some((p) => tm.gf.materials[p.material]?.name === SURFACE_TEMPLATE.material));
    if (mi < 0) throw new Error(`no se encuentra el material ${SURFACE_TEMPLATE.material}`);
    const matIdx = tm.gf.meshes[mi].polygons.find((p) => tm.gf.materials[p.material]?.name === SURFACE_TEMPLATE.material)!.material;
    const mt = tm.root.tables(8)[mi];
    const attrs = mt.tables(1);
    const layout = attrs.map((a) => ({ type: a.u32(0), fmt: a.u32(1), count: a.u32(2) }));
    const stride = layout.reduce((n, a) => n + (FORMAT_SIZE[a.fmt] ?? 4) * a.count, 0);
    const proto = mt.bytes(2).slice(0, stride); // a vertex of the template, for anything not set below
    for (const [texture, quads] of surfaces)
      for (let q0 = 0; q0 < quads.length; q0 += 16000) {
        const part = quads.slice(q0, q0 + 16000);
        const data = new Uint8Array(part.length * 4 * stride);
        const dv = new DataView(data.buffer);
        const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        const idx = new Uint16Array(part.length * 6);
        part.forEach((q, qi) => {
          for (let c = 0; c < 4; c++) {
            const base = (qi * 4 + c) * stride;
            data.set(proto, base);
            let off = 0;
            for (const a of layout) {
              const p = base + off;
              if (a.type === 0 && a.fmt === 0) {
                q.p[c].forEach((v, k) => dv.setFloat32(p + k * 4, v, true));
                for (let k = 0; k < 3; k++) {
                  box[k] = Math.min(box[k], q.p[c][k]);
                  box[k + 3] = Math.max(box[k + 3], q.p[c][k]);
                }
              } else if (a.type === 1 && a.fmt === 1) q.n.forEach((v, k) => dv.setUint16(p + k * 2, toHalf(v), true));
              else if (a.type === 2 && a.fmt === 1) {
                const t = tangent(q);
                t.forEach((v, k) => dv.setUint16(p + k * 2, toHalf(v), true));
                if (a.count > 3) dv.setUint16(p + 6, toHalf(1), true);
              } else if (a.type === 3 && a.fmt === 0) q.uv[c].forEach((v, k) => dv.setFloat32(p + k * 4, v, true));
              else if (a.type === 3 && a.fmt === 1) q.uv[c].forEach((v, k) => dv.setUint16(p + k * 2, toHalf(v), true));
              else if (a.type === 7 && a.fmt === 3) data.fill(255, p, p + a.count);
              off += (FORMAT_SIZE[a.fmt] ?? 4) * a.count;
            }
          }
          // front faces wound as the game's (counter-clockwise seen from the side the normal points to)
          const e1 = [0, 1, 2].map((k) => q.p[1][k] - q.p[0][k]), e2 = [0, 1, 2].map((k) => q.p[2][k] - q.p[0][k]);
          const front = (e1[1] * e2[2] - e1[2] * e2[1]) * q.n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * q.n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * q.n[2] > 0;
          const v = qi * 4;
          idx.set(front ? [v, v + 1, v + 2, v, v + 2, v + 3] : [v, v + 2, v + 1, v, v + 3, v + 2], qi * 6);
        });
        triangles += part.length * 2;
        meshes.push({ material: [], attrs, stride, data, polys: [{ material: mergedMaterial(tm, matIdx, { Texture01: texture }), indices: idx }], box, srcModel: tm });
      }
  }
  // the slot's own ground under the map (a test meadow of 40 x 40 cells): by default only when the map has no ground
  // tiles of its own
  if (o.baseGround ?? o.doc.slotGround ?? !tiles) {
    const base = src.modelFile(`bin/field/model/${slot}/${slot}.gfbmdl`, `bin/archive/field/${slot}.gfpak`);
    const pick = new Map<number, Map<number, number[]>>();
    base.gf.meshes.forEach((mesh, mi) => {
      const mp = new Map<number, number[]>();
      mesh.polygons.forEach((p, pi) => mp.set(pi, Array.from({ length: Math.floor(p.indices.length / 3) }, (_, k) => k)));
      pick.set(mi, mp);
    });
    addPiece('suelo base', base, pick, compose([0, Y0, 0], [0, 0, 0], [1, 1, 1]), [0, 0, 0], false);
  }
  if (!meshes.length) throw new Error('El mapa no tiene objetos que se puedan exportar al juego');
  if (W > 4000 || D > 4000) warnings.push('El mapa mide más de 40 casillas: el suelo base del hueco solo cubre 40 x 40');
  log(`${objects} objetos, ${meshes.length} mallas, ${materials.length} materiales, ${triangles} triángulos`);

  // ---- the merged model
  const slotModelPath = `bin/field/model/${slot}/${slot}.gfbmdl`;
  const slotModel = new FBEditor(o.fs.read(slotModelPath));
  const slotRoot = slotModel.u32(0);
  const textures: string[] = [];
  const texIndex = new Map<string, number>();
  const texNear = new Map<string, string>();
  const texOf = (name: string, near: string) => {
    let i = texIndex.get(name);
    if (i === undefined) {
      i = textures.length;
      textures.push(name);
      texIndex.set(name, i);
      texNear.set(name, near);
    }
    return i;
  };
  const ed = new FBEditor(new Uint8Array(8));
  const all = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let c = 0; c < 3; c++) {
      all[c] = Math.min(all[c], m.box[c]);
      all[c + 3] = Math.max(all[c + 3], m.box[c + 3]);
    }
  const boundsBytes = (b: number[]) => new Uint8Array(new Float32Array(b).buffer);

  // the material table's layout, learned from every material of the models used
  const matSamples = [...new Set(materials.map((m) => m.model))].flatMap((m) =>
    m.ed.vectorElems(m.ed.child(m.ed.u32(0), 6)).map((pos) => ({ ed: m.ed, pos })),
  );
  const matSchema = learnSchema(matSamples);
  const boneSchema = learnSchema(slotModel.vectorElems(slotModel.child(slotRoot, 9)).map((pos) => ({ ed: slotModel, pos })));

  // the merged texture list, in material order (written before the materials that index it)
  for (const mr of materials) {
    const e = mr.model.ed;
    const maps = e.child(e.vectorElems(e.child(e.u32(0), 6))[mr.index], 11);
    if (!maps) continue;
    for (const sm of e.vectorElems(maps)) {
      const f1 = e.fieldPos(sm, 1);
      texOf(mr.textures?.[e.readString(e.child(sm, 0))] ?? mr.model.textures[f1 ? e.u32(f1) : 0] ?? '', mr.model.pak);
    }
  }

  // materials (their texture maps point into the merged list)
  // (fields 8 and 10 hold the material's own number in the model: its shader in the shader list)
  const matMakers = materials.map((mr, mi) => (e: FBEditor) => {
    const srcMat = mr.model.ed.vectorElems(mr.model.ed.child(mr.model.ed.u32(0), 6))[mr.index];
    const t = cloneWithSchema(e, mr.model.ed, srcMat, matSchema, { 8: mi, 10: mi });
    e.link(e.fieldPos(t, 0), e.string(mr.name));
    // texture maps rebuilt with indices into the merged list
    const mapsField = e.fieldPos(t, 11);
    if (mapsField) {
      const srcMaps = mr.model.ed.vectorElems(mr.model.ed.child(srcMat, 11));
      const vec = e.vectorOfTables(
        srcMaps.map((sm) => () => {
          const sampler = mr.model.ed.readString(mr.model.ed.child(sm, 0));
          const f1 = mr.model.ed.fieldPos(sm, 1);
          const texName = mr.textures?.[sampler] ?? mr.model.textures[f1 ? mr.model.ed.u32(f1) : 0] ?? '';
          const params = mr.model.ed.child(sm, 2);
          const fields: FieldSpec[] = [
            { idx: 0, child: (x) => x.string(sampler) },
            { idx: 1, u32: texOf(texName, mr.model.pak) },
          ];
          if (params) fields.push({ idx: 2, child: (x) => cloneWithSchema(x, mr.model.ed, params, subSchema(matSchema, 11, 2)) });
          return buildTable(e, fields);
        }),
      );
      e.link(mapsField, vec);
    }
    return t;
  });

  const root = buildTable(ed, [
    { idx: 0, u32: slotModel.u32(slotModel.fieldPos(slotRoot, 0)) },
    { idx: 1, bytes: boundsBytes(all), align: 4 },
    { idx: 2, child: (x) => x.stringVector(textures) },
    { idx: 3, child: (x) => x.stringVector(materials.map((m) => m.name)) },
    { idx: 4, child: (x) => x.vectorOfTables([]) },
    { idx: 5, child: (x) => x.stringVector(materials.map((m) => m.name)) },
    { idx: 6, child: (x) => x.vectorOfTables(matMakers.map((mk) => () => mk(x))) },
    {
      idx: 7,
      child: (x) =>
        x.vectorOfTables(
          meshes.map((m, i) => () =>
            buildTable(x, [
              { idx: 0, u32: 1 },
              { idx: 1, u32: i },
              { idx: 2, bytes: boundsBytes(m.box), align: 4 },
            ]),
          ),
        ),
    },
    {
      idx: 8,
      child: (x) =>
        x.vectorOfTables(
          meshes.map((m) => () =>
            buildTable(x, [
              {
                idx: 0,
                child: (y) =>
                  y.vectorOfTables(
                    m.polys.map((p) => () =>
                      buildTable(y, [
                        { idx: 0, u32: p.material },
                        { idx: 1, child: (z) => z.bytesVector(new Uint8Array(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength), 2) },
                      ]),
                    ),
                  ),
              },
              {
                idx: 1,
                child: (y) =>
                  y.vectorOfTables(
                    m.attrs.map((a) => () =>
                      buildTable(y, [
                        { idx: 0, u32: a.u32(0) },
                        { idx: 1, u32: a.u32(1) },
                        { idx: 2, u32: a.u32(2) },
                      ]),
                    ),
                  ),
              },
              { idx: 2, child: (y) => y.bytesVector(m.data, 1) },
            ]),
          ),
        ),
    },
    { idx: 9, child: (x) => x.vectorOfTables(slotModel.vectorElems(slotModel.child(slotRoot, 9)).map((b) => () => cloneWithSchema(x, slotModel, b, boneSchema))) },
    { idx: 10, child: (x) => x.vectorOfTables([]) },
  ]);
  ed.setRoot(root);
  const modelData = ed.data;

  // ---- the slot's pack: its own files, then the merged materials' shaders and textures
  const packPath = `bin/archive/field/${slot}.gfpak`;
  const folder = `bin/field/model/${slot}/`;
  const slotPak = new Gfpak(o.fs.read(packPath));
  const entries: GfpakEntry[] = slotPak.files.map((f) => ({ pathHash: f.pathHash, nameHash: f.nameHash, folderHash: f.folderHash, data: slotPak.read(f) }));
  const have = new Set(entries.map((e) => e.nameHash));
  const put = (file: string, data: Uint8Array) => {
    const h = fnv1a64(file);
    if (have.has(h)) return;
    have.add(h);
    entries.push({ pathHash: fnv1a64(folder + file), nameHash: h, folderHash: fnv1a64(folder), data });
  };
  for (const mr of materials) {
    const orig = mr.model.gf.materials[mr.index]?.name ?? '';
    const near = mr.model.pak;
    let found = 0;
    for (const ext of ['.bnsh_vsh', '.bnsh_fsh', '.bnsh_gsh']) {
      const d = src.file(orig + ext, near);
      if (d) {
        put(mr.name + ext, d);
        found++;
      }
    }
    if (found < 2) warnings.push(`material ${orig}: shaders no encontrados`);
  }
  for (const t of textures) {
    if (!t) continue;
    const d = src.file(`${t}.bntx`, texNear.get(t)!);
    if (d) put(`${t}.bntx`, d);
    else warnings.push(`textura ${t} no encontrada`);
  }

  // ---- collision (see collision.ts)
  // the floor at every height (terrain.ts); walls: around the map, around solid objects, the cliffs (col_wall) and
  // the ledges (col_jump)
  const floor: ColMesh = terrain.floor;
  const wallMesh: ColMesh = { verts: [...terrain.walls.verts], idx: [] };
  const top = shapes.reduce((m, s) => Math.max(m, s.base + (s.terrain?.height ?? s.stairs?.height ?? 0)), Y0);
  addQuads(wallMesh, [wallQuad(0, 0, W, 0, Y0 - 100, top + 500), wallQuad(W, 0, W, D, Y0 - 100, top + 500), wallQuad(W, D, 0, D, Y0 - 100, top + 500), wallQuad(0, D, 0, 0, Y0 - 100, top + 500)]);
  for (const [x0, z0, x1, z1, y0] of walls)
    addQuads(wallMesh, [wallQuad(x0, z0, x1, z0, y0 - 100, y0 + 500), wallQuad(x1, z0, x1, z1, y0 - 100, y0 + 500), wallQuad(x1, z1, x0, z1, y0 - 100, y0 + 500), wallQuad(x0, z1, x0, z0, y0 - 100, y0 + 500)]);
  const wallPolys = [{ name: 0, idx: [...(terrain.walls.polys.find((p) => p.name === 0)?.idx ?? []), ...wallMesh.idx] }, ...terrain.walls.polys.filter((p) => p.name !== 0)];
  let zoneMesh: ColMesh = { verts: [], idx: [] };
  if (!grass.length) addQuads(zoneMesh, [[0, Y0, 0, W, Y0, 0, 0, Y0, D, W, Y0, D]]);
  else {
    // the base zone: every cell but the grass zones' (zones don't overlap)
    const rest: [number, number][] = [];
    for (let i = 0; i < g.width; i++) for (let k = 0; k < g.depth; k++) if (!grassCells.has(`${i},${k}`)) rest.push([i, k]);
    zoneMesh = cellsMesh(rest, cell, 0, 0, Y0);
  }
  const grassFiles: { path: string; data: Uint8Array }[] = [];
  for (const gz of grass) {
    grassFiles.push({ path: `bin/field/model/${slot}/${gz.name}_zone.gfbcol`, data: gfbcol('col_zone', cellsMesh(gz.cells, cell, 0, 0, Y0)) }); // the zone: slot coordinates
    const patch = cellsMesh(gz.cells, cell, gz.center[0], gz.center[2]); // the patch: around its position
    grassFiles.push({ path: `bin/field/model/${slot}/${gz.name}_enc.gfbcol`, data: gfbcol('col_enc', patch, { color: [255, 255, 255, 255] }) });
  }

  // ---- terrain block: the map's size
  const terrainPath = `bin/field/param/terrain/${slot}/terrain_data.bin`;
  const te = new FBEditor(o.fs.read(terrainPath));
  // (block: 0..2 corner, 3..5 size, 6 model, 7 animations, 8 wall and 9 floor collision; the slot's has no height, and
  // the game plants no tall grass outside a block's box: it is written again with all six)
  const elem = te.vectorElems(te.child(te.u32(0), 0))[0];
  const block = te.child(elem, 0);
  const str = (i: number) => (p: number) => (i === 7 ? te.vectorOfTables([]) : te.cloneString(p));
  const nb = te.cloneTable(block, { 6: str(6), 7: str(7), 8: str(8), 9: str(9) }, te, { 0: f32bits(0), 1: f32bits(Y0 - 500), 2: f32bits(0), 3: f32bits(W), 4: f32bits(2000), 5: f32bits(D) });
  te.link(te.fieldPos(elem, 0), nb);

  // ---- placement: the slot emptied, teleporters both ways
  const ppak = src.pak('bin/archive/field/placement.gfpak');
  const tpl = new Templates(ppak.read(ppak.byPath(placementPath('t011gym'))!));
  const pentries = ppak.files.map((f) => {
    let data = ppak.read(f);
    if (f.pathHash === fnv1a64(placementPath(slot))) {
      data = editZoneList(data, 0, 1, [], false); // the test characters
      data = addTeleporter(data, 0, tpl, { id: `lgmap_${slot}_exit`, at: exit!, destMap: entrance.map, destZone: entrance.zone, arrive: entrance.back });
      const area02Data = ppak.read(ppak.byPath(placementPath('area02'))!);
      const zoneSchema = learnZoneSchema(ppak.files.map((x) => ppak.read(x)));
      // an outdoor map's settings (the slot's are an indoor test room's): lighting, shadow volume...
      data = rootSettingsFrom(data, area02Data, zoneSchema);
      // the signs: things to inspect in the map's zone
      if (signs.length) {
        const make = signMaker(ppak.files.map((x) => ppak.read(x)), zoneSchema);
        data = editZoneList(data, 0, LIST_INSPECT, signs.map((sg, i) => make({ id: `lgmap_sign_${i + 1}`, at: sg.at, rotY: sg.rotY, event: fnv1a64(sg.label) })), true, zoneSchema);
      }
      // a zone per grass zone, with its patch of tall grass
      const area02 = new FBEditor(area02Data);
      // (a Route 1 patch whose position has all three axes: tables leave out fields at 0, and a patch with no Y stays
      // at height 0)
      const isTuftPatch = (e: number) => {
        const obj = area02.child(e, 0);
        return area02.readString(area02.child(obj, 2)).includes('enc_grass') && !!area02.fieldPos(area02.child(obj, 0), 1);
      };
      const tplPatch = area02
        .vectorElems(area02.child(area02.u32(0), 0))
        .flatMap((z) => (area02.child(z, 5) ? area02.vectorElems(area02.child(z, 5)) : []))
        .find(isTuftPatch);
      if (tplPatch === undefined) throw new Error('placement: no tall-grass patch template in area02');
      for (const gz of grass) {
        const added = addZone(data, 0, gz.name, `bin/field/model/${slot}/${gz.name}_zone.gfbcol`, zoneSchema);
        data = editZoneList(added.data, added.index, 5, [
          grassPatchMaker(area02, tplPatch, gz.center, `bin/field/model/${slot}/${gz.name}_enc.gfbcol`, 'bin/field/model/buildmodel/enc_grass01.gfbmdl', `lgmap_${gz.name}`),
        ], true, zoneSchema);
      }
    } else if (f.pathHash === fnv1a64(placementPath(entrance.map))) {
      const z = zoneIndexOf(data, entrance.zone);
      if (z < 0) throw new Error(`La zona ${entrance.zone} no está en ${entrance.map}`);
      data = addTeleporter(data, z, tpl, { id: `lgmap_${slot}_entrance`, at: entrance.at, destMap: slot, destZone: slot, arrive: spawn });
    }
    return { pathHash: f.pathHash, nameHash: f.nameHash, folderHash: f.folderHash, data };
  });

  // ---- zone scripts
  const spak = src.pak('bin/archive/script_amx.gfpak');
  const sentries: GfpakEntry[] = spak.files.map((f) => ({ pathHash: f.pathHash, nameHash: f.nameHash, folderHash: f.folderHash, data: spak.read(f) }));
  const sfolder = spak.files[0].folderHash;
  const empty = spak.read(spak.byPath('bin/script/amx/town010.amx')!); // the empty zone script many zones share
  const init = spak.read(spak.byPath('bin/script/amx/init_town010.amx')!); // only a debug print of the zone name differs
  // (with signs: Pallet Town's script, patched to show their messages)
  const zoneScript = signs.length ? signScript(spak.read(spak.byPath('bin/script/amx/town001.amx')!), signs.map((sg) => fnv1a64(sg.label))) : empty;
  for (const [file, data] of [[`${slot}.amx`, zoneScript], [`init_${slot}.amx`, init], ...grass.flatMap((gz) => [[`${gz.name}.amx`, empty], [`init_${gz.name}.amx`, init]])] as [string, Uint8Array][])
    if (!spak.byPath(`bin/script/amx/${file}`)) sentries.push({ pathHash: fnv1a64(`bin/script/amx/${file}`), nameHash: fnv1a64(file), folderHash: sfolder, data });
    else if (file === `${slot}.amx`) sentries.find((e) => e.pathHash === fnv1a64(`bin/script/amx/${file}`))!.data = data;
  // the signs' messages, in every language (the test slots' message files exist and are registered)
  const messageFiles = signs.length
    ? LANGUAGES.flatMap((lang) => [
        { path: `bin/message/${lang}/script/${slot}.dat`, data: messageFile(signs.map((sg) => sg.text)) },
        { path: `bin/message/${lang}/script/${slot}.tbl`, data: labelTable([...signs.map((sg) => sg.label), `msg_${slot}_max`]) },
      ])
    : [];
  if (signs.length)
    messageFiles.push({ path: SCRIPT_RECORD, data: addScriptRecords(o.fs.read(SCRIPT_RECORD), signs.map((sg) => fnv1a64(sg.label)), `bin/script/amx/${slot}.amx`, `script/${slot}.dat`) });

  return {
    files: [
      { path: slotModelPath, data: modelData },
      { path: packPath, data: writeGfpak(entries) },
      { path: `bin/field/model/${slot}/${slot}_floor.gfbcol`, data: gfbcol('col_floor', floor) },
      { path: `bin/field/model/${slot}/${slot}_wall.gfbcol`, data: gfbcol(WALL_NAMES, { verts: wallMesh.verts, polys: wallPolys }) },
      { path: `bin/field/model/${slot}/${slot}_zone.gfbcol`, data: gfbcol('col_zone', zoneMesh) },
      { path: terrainPath, data: te.data },
      { path: 'bin/archive/field/placement.gfpak', data: writeGfpak(pentries) },
      { path: 'bin/archive/script_amx.gfpak', data: writeGfpak(sentries) },
      ...grassFiles,
      ...messageFiles,
      ...(grass.length
        ? [
            ...ENCOUNT_FILES.map((path) => ({ path, data: addEncounterTables(o.fs.read(path), 'road001', grass.map((gz) => ({ zone: gz.name, wild: gz.wild }))) })),
            { path: ZONE_NAME_TABLE, data: addHashNames(o.fs.read(ZONE_NAME_TABLE), grass.map((gz) => gz.name)) },
          ]
        : []),
    ],
    warnings,
    spawn,
    stats: { objects, meshes: meshes.length, materials: materials.length, textures: textures.length, triangles },
  };
}
