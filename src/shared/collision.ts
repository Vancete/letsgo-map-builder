// Collision and shape files (.gfbcol), as the game's own:
//
//   0 names {0 name}, 1 {1 bounds}, 2 meshes {0 polygons {1 u16 triangles}, 1 attributes {0 type, 1 format, 2 count},
//   2 vertex data}, 3 {0 bounds, 1 u32 list of meshes}
//
// Floors (<map>_floor) and walls (_wall) are triangle soups with positions only (attribute {2: 3}: three floats). The
// shapes of vegetation patches (_enc*) also carry a color per vertex (attribute {0: 7, 1: 3, 2: 4}: four bytes,
// white in almost all of the game's): the game reads it for every tuft it plants, so a shape without it gives tufts
// of random size and shade.
import { FBEditor, buildTable } from './formats/fbedit.ts';

export interface ColMesh {
  verts: number[]; // x, y, z
  idx: number[];
}

// polygons: groups of triangles, each with the index of its name (wall files: col_wall, col_jump...)
export function gfbcol(
  names: string | string[],
  mesh: ColMesh | { verts: number[]; polys: { name: number; idx: number[] }[] },
  opts: { color?: [number, number, number, number] } = {},
): Uint8Array {
  const verts = mesh.verts;
  const polys = 'polys' in mesh ? mesh.polys : [{ name: 0, idx: mesh.idx }];
  const nameList = typeof names === 'string' ? [names] : names;
  const c = new FBEditor(new Uint8Array(8));
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts.length; i += 3)
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], verts[i + k]);
      b[k + 3] = Math.max(b[k + 3], verts[i + k]);
    }
  if (!verts.length) b.fill(0);
  const box = new Uint8Array(new Float32Array(b).buffer);
  const n = verts.length / 3;
  const stride = opts.color ? 16 : 12;
  const data = new Uint8Array(n * stride);
  const dv = new DataView(data.buffer);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) dv.setFloat32(v * stride + k * 4, verts[v * 3 + k], true);
    if (opts.color) data.set(opts.color, v * stride + 12);
  }
  const attrs = opts.color
    ? [() => buildTable(c, [{ idx: 2, u32: 3 }]), () => buildTable(c, [{ idx: 0, u32: 7 }, { idx: 1, u32: 3 }, { idx: 2, u32: 4 }])]
    : [() => buildTable(c, [{ idx: 2, u32: 3 }])];
  const r = buildTable(c, [
    { idx: 0, child: (x) => x.vectorOfTables(nameList.map((nm) => () => buildTable(x, [{ idx: 0, child: (y) => y.string(nm) }]))) },
    { idx: 1, child: (x) => x.vectorOfTables([() => buildTable(x, [{ idx: 1, bytes: box, align: 4 }])]) },
    {
      idx: 2,
      child: (x) =>
        x.vectorOfTables([
          () =>
            buildTable(x, [
              {
                idx: 0,
                child: (y) =>
                  y.vectorOfTables(
                    polys.map((p) => () =>
                      buildTable(y, [
                        ...(p.name ? [{ idx: 0, u32: p.name }] : []),
                        { idx: 1, child: (z: FBEditor) => z.bytesVector(new Uint8Array(Uint16Array.from(p.idx).buffer), 2) },
                      ]),
                    ),
                  ),
              },
              { idx: 1, child: (y) => y.vectorOfTables(attrs) },
              { idx: 2, child: (y) => y.bytesVector(data, 1) },
            ]),
        ]),
    },
    {
      idx: 3,
      child: (x) =>
        buildTable(x, [
          { idx: 0, bytes: box, align: 4 },
          { idx: 1, child: (y) => y.bytesVector(new Uint8Array(4), 4) },
        ]),
    },
  ]);
  c.setRoot(r);
  return c.data;
}

// quads [x0 y0 z0, x1 y1 z1, x2 y2 z2, x3 y3 z3] (corners 0-1 along one edge, 2-3 along the opposite one), both sides
export function addQuads(m: ColMesh, list: number[][], bothSides = true) {
  for (const q of list) {
    const base = m.verts.length / 3;
    m.verts.push(...q);
    m.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    if (bothSides) m.idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }
}

// a vertical wall from (x0, z0) to (x1, z1) between heights lo and hi
export const wallQuad = (x0: number, z0: number, x1: number, z1: number, lo: number, hi: number) => [x0, lo, z0, x1, lo, z1, x0, hi, z0, x1, hi, z1];

// cells (cx, cz) of size `cell` as quads facing up, around (ox, oz), at height y (or a height per cell)
export function cellsMesh(cells: [number, number][], cell: number, ox: number, oz: number, y: number | ((cx: number, cz: number) => number) = 0): ColMesh {
  const verts: number[] = [];
  const idx: number[] = [];
  for (const [cx, cz] of cells) {
    const x0 = cx * cell - ox, z0 = cz * cell - oz;
    const h = typeof y === 'number' ? y : y(cx, cz);
    const b = verts.length / 3;
    verts.push(x0, h, z0, x0 + cell, h, z0, x0, h, z0 + cell, x0 + cell, h, z0 + cell);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  return { verts, idx };
}
