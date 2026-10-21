// Ground at several heights, from the map's raised blocks and stairs, as the game builds its routes:
//
//  - The floor collision (<map>_floor.gfbcol) is one mesh at every height: the top of each block, the slope of each
//    stairs, the ground everywhere else, and vertical faces where heights change (Route 1's floor is like that: its
//    terraces are 50 units apart).
//  - Cliffs are walls (col_wall) along the edge of the higher ground.
//  - A ledge the player jumps down from is not a wall but a thin closed box of "col_jump" walls: one face on the edge
//    line and one 25 units out over the lower ground (Route 1: z -815 and -790). The game lets the player through it
//    only downwards, with the jump.
//
// Everything is worked out on the grid's cells (a height per cell), in grid coordinates: x and z from the grid's
// corner (cell (0, 0) at 0..cell), y as in the game. The editor draws the same surfaces the export writes.
import type { EdgeKind, Side, StairsBlock, TerrainBlock } from './types.ts';

export interface Surface {
  p: [number, number, number][]; // corners in order around the quad (triangles 0-1-2, 0-2-3)
  uv: [number, number][];
  n: [number, number, number]; // the side it faces
}

export interface TerrainShape {
  kind: 'terrain' | 'stairs';
  cx0: number;
  cz0: number;
  w: number; // cells along X
  d: number; // cells along Z
  base: number; // height of its bottom
  terrain?: TerrainBlock;
  stairs?: StairsBlock;
  dir?: number; // stairs: the direction they climb towards: 0 -Z, 1 +X, 2 +Z, 3 -X
}

export interface TerrainResult {
  surfaces: { texture: string; q: Surface }[];
  floor: { verts: number[]; idx: number[] };
  walls: { verts: number[]; polys: { name: number; idx: number[] }[] }; // names: WALL_NAMES
  height(x: number, z: number): number; // the ground's height at a point (grid coordinates)
}

export const WALL_NAMES = ['col_wall', 'col_jump'];
const JUMP_DEPTH = 25;

// the stairs' climbing direction from the object's rotation around Y (degrees)
export function stairsDir(rotY: number): number {
  return [0, 3, 2, 1][(((Math.round(rotY / 90) % 4) + 4) % 4)];
}

// a stairs object's cells: `w` across the climb, `length` along it
export function stairsSize(s: StairsBlock, dir: number): { w: number; d: number } {
  return dir % 2 === 0 ? { w: s.w, d: s.length } : { w: s.length, d: s.w };
}

const SIDES: { side: Side; dx: number; dz: number }[] = [
  { side: 'n', dx: 0, dz: -1 },
  { side: 'e', dx: 1, dz: 0 },
  { side: 's', dx: 0, dz: 1 },
  { side: 'w', dx: -1, dz: 0 },
];
const DIR_SIDE: Side[] = ['n', 'e', 's', 'w']; // stairs dir -> the side they climb towards

export function buildTerrain(grid: { width: number; depth: number; cell: number }, shapes: TerrainShape[], groundY = 0): TerrainResult {
  const { width: GW, depth: GD, cell } = grid;
  const n = GW * GD;
  const h = new Float64Array(n).fill(groundY); // flat cells: their height
  const owner = new Int32Array(n).fill(-1); // the shape a cell belongs to
  const inside = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < GW && cz < GD;
  shapes.forEach((s, i) => {
    if (s.kind !== 'terrain' || !s.terrain) return;
    const top = s.base + s.terrain.height;
    for (let x = s.cx0; x < s.cx0 + s.w; x++)
      for (let z = s.cz0; z < s.cz0 + s.d; z++)
        if (inside(x, z) && (owner[z * GW + x] < 0 || top >= h[z * GW + x])) {
          h[z * GW + x] = top;
          owner[z * GW + x] = i;
        }
  });
  shapes.forEach((s, i) => {
    if (s.kind !== 'stairs') return;
    for (let x = s.cx0; x < s.cx0 + s.w; x++) for (let z = s.cz0; z < s.cz0 + s.d; z++) if (inside(x, z)) owner[z * GW + x] = i;
  });
  const isStairs = (c: number) => owner[c] >= 0 && shapes[owner[c]].kind === 'stairs';

  // stairs: height along the climb (0 at the low end, 1 at the high end) of a point
  const stairsT = (s: TerrainShape, x: number, z: number) => {
    const x0 = s.cx0 * cell, x1 = (s.cx0 + s.w) * cell, z0 = s.cz0 * cell, z1 = (s.cz0 + s.d) * cell;
    const t = [(z1 - z) / (z1 - z0), (x - x0) / (x1 - x0), (z - z0) / (z1 - z0), (x1 - x) / (x1 - x0)][s.dir ?? 0];
    return Math.max(0, Math.min(1, t));
  };
  const stairsH = (s: TerrainShape, x: number, z: number) => s.base + stairsT(s, x, z) * (s.stairs?.height ?? 0);

  const height = (x: number, z: number) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    if (!inside(cx, cz)) return groundY;
    const c = cz * GW + cx;
    return isStairs(c) ? stairsH(shapes[owner[c]], x, z) : h[c];
  };

  const surfaces: TerrainResult['surfaces'] = [];
  const fv: number[] = [], fi: number[] = [];
  const wv: number[] = [];
  const wallIdx: number[] = [], jumpIdx: number[] = [];
  const quad = (verts: number[], idx: number[], p: number[][], both: boolean) => {
    const b = verts.length / 3;
    for (const v of p) verts.push(v[0], v[1], v[2]);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // (up-facing for corners going +x then +z)
    if (both) idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };

  // ---- floor: flat cells merged into rectangles of one height, the stairs' slopes
  const done = new Uint8Array(n);
  for (let z = 0; z < GD; z++)
    for (let x = 0; x < GW; x++) {
      const c = z * GW + x;
      if (done[c] || isStairs(c)) continue;
      let w = 1;
      while (x + w < GW && !done[c + w] && !isStairs(c + w) && h[c + w] === h[c]) w++;
      let d = 1;
      grow: while (z + d < GD) {
        for (let k = 0; k < w; k++) {
          const e = (z + d) * GW + x + k;
          if (done[e] || isStairs(e) || h[e] !== h[c]) break grow;
        }
        d++;
      }
      for (let a = 0; a < d; a++) for (let k = 0; k < w; k++) done[(z + a) * GW + x + k] = 1;
      const y = h[c];
      quad(fv, fi, [[x * cell, y, z * cell], [(x + w) * cell, y, z * cell], [(x + w) * cell, y, (z + d) * cell], [x * cell, y, (z + d) * cell]], false);
    }
  shapes.forEach((s) => {
    if (s.kind !== 'stairs') return;
    const x0 = Math.max(0, s.cx0) * cell, x1 = Math.min(GW, s.cx0 + s.w) * cell, z0 = Math.max(0, s.cz0) * cell, z1 = Math.min(GD, s.cz0 + s.d) * cell;
    if (x1 <= x0 || z1 <= z0) return;
    quad(fv, fi, [[x0, stairsH(s, x0, z0), z0], [x1, stairsH(s, x1, z0), z0], [x1, stairsH(s, x1, z1), z1], [x0, stairsH(s, x0, z1), z1]], false);
  });

  // ---- edges between cells: vertical floor faces, walls, ledges, the blocks' sides
  // the height of a cell along one of its sides (stairs: at their ends; null along their sides)
  const edgeH = (c: number, side: Side): number | null => {
    if (!isStairs(c)) return h[c];
    const s = shapes[owner[c]];
    const up = DIR_SIDE[s.dir ?? 0];
    const down = DIR_SIDE[((s.dir ?? 0) + 2) % 4];
    if (side === up) return s.base + (s.stairs?.height ?? 0);
    if (side === down) return s.base;
    return null;
  };
  type Run = { kind: 'wall' | 'jump'; side: Side; line: number; a0: number; a1: number; lo: number; hi: number; low: number; high: number; tex: string | null };
  const runs: Run[] = [];
  const addRun = (r: Run) => {
    const last = runs.find((o) => o.kind === r.kind && o.side === r.side && o.line === r.line && o.a1 === r.a0 && o.lo === r.lo && o.hi === r.hi && o.tex === r.tex);
    if (last) last.a1 = r.a1;
    else runs.push(r);
  };
  for (let z = 0; z < GD; z++)
    for (let x = 0; x < GW; x++) {
      const a = z * GW + x;
      for (const { side, dx, dz } of SIDES) {
        if (side === 'w' || side === 'n') continue; // each edge once: from its cell to the east and to the south
        const bx = x + dx, bz = z + dz;
        if (!inside(bx, bz)) continue;
        const b = bz * GW + bx;
        const opp: Side = side === 'e' ? 'w' : 'n';
        // the edge's line and its span along it
        const line = side === 'e' ? (x + 1) * cell : (z + 1) * cell;
        const a0 = (side === 'e' ? z : x) * cell, a1 = a0 + cell;
        const sameStairs = owner[a] >= 0 && owner[a] === owner[b] && isStairs(a);
        if (sameStairs) continue;
        const ha = edgeH(a, side), hb = edgeH(b, opp);
        if (ha === null || hb === null) {
          // along a stairs' side: a wall from the lower ground to the top of the stairs, the side drawn
          const sc = ha === null ? a : b;
          const s = shapes[owner[sc]];
          const other = ha === null ? hb ?? s.base : ha;
          const top = s.base + (s.stairs?.height ?? 0);
          addRun({ kind: 'wall', side, line, a0, a1, lo: Math.min(other, s.base) - 100, hi: Math.max(other, top) + 300, low: 0, high: 0, tex: null });
          // the stairs' side face: from the ground beside them up to the slope
          const pts = side === 'e' ? [[line, a0], [line, a1]] : [[a0, line], [a1, line]];
          const yTop = pts.map(([px, pz]) => stairsH(s, px, pz));
          const facing: Side = ha === null ? side : opp; // away from the stairs
          if (yTop.some((v) => v > other + 0.5)) {
            const p: [number, number, number][] = [[pts[0][0], other, pts[0][1]], [pts[1][0], other, pts[1][1]], [pts[1][0], Math.max(other, yTop[1]), pts[1][1]], [pts[0][0], Math.max(other, yTop[0]), pts[0][1]]];
            surfaces.push({ texture: s.stairs!.texture, q: sideQuad(p, facing) });
          }
          continue;
        }
        if (Math.abs(ha - hb) < 0.5) continue;
        const hiC = ha > hb ? a : b;
        const highSide: Side = ha > hb ? side : opp; // the side of the higher cell the edge is on
        const high = Math.max(ha, hb), low = Math.min(ha, hb);
        // vertical floor face
        const ends = side === 'e' ? [[line, a0], [line, a1]] : [[a0, line], [a1, line]];
        quad(fv, fi, [[ends[0][0], low, ends[0][1]], [ends[1][0], low, ends[1][1]], [ends[1][0], high, ends[1][1]], [ends[0][0], high, ends[0][1]]], true);
        const hs = owner[hiC] >= 0 ? shapes[owner[hiC]] : null;
        const kind: EdgeKind = hs?.terrain ? hs.terrain.edges[highSide] : 'wall';
        const tex = hs?.terrain?.side ?? hs?.stairs?.texture ?? null;
        addRun({ kind: kind === 'ledge' ? 'jump' : 'wall', side: highSide, line, a0, a1, lo: low - 100, hi: high + 300, low, high, tex });
      }
    }

  for (const r of runs) {
    const along = (l: number, a: number, y: number): [number, number, number] => (r.side === 'e' || r.side === 'w' ? [l, y, a] : [a, y, l]);
    // the block's side face, facing the lower ground
    if (r.tex && r.high > r.low) {
      const p = [along(r.line, r.a0, r.low), along(r.line, r.a1, r.low), along(r.line, r.a1, r.high), along(r.line, r.a0, r.high)];
      surfaces.push({ texture: r.tex, q: sideQuad(p, r.side) });
    }
    if (r.kind === 'wall') quad(wv, wallIdx, [along(r.line, r.a0, r.lo), along(r.line, r.a1, r.lo), along(r.line, r.a1, r.hi), along(r.line, r.a0, r.hi)], true);
    else {
      // the jump box: on the edge and JUMP_DEPTH out over the lower ground, closed at both ends
      const out = r.side === 'e' || r.side === 's' ? JUMP_DEPTH : -JUMP_DEPTH;
      const l2 = r.line + out;
      quad(wv, jumpIdx, [along(r.line, r.a0, r.lo), along(r.line, r.a1, r.lo), along(r.line, r.a1, r.hi), along(r.line, r.a0, r.hi)], true);
      quad(wv, jumpIdx, [along(l2, r.a0, r.lo), along(l2, r.a1, r.lo), along(l2, r.a1, r.hi), along(l2, r.a0, r.hi)], true);
      for (const a of [r.a0, r.a1]) quad(wv, jumpIdx, [along(r.line, a, r.lo), along(l2, a, r.lo), along(l2, a, r.hi), along(r.line, a, r.hi)], true);
    }
  }

  // ---- the blocks' tops and the stairs' steps
  for (let z = 0; z < GD; z++)
    for (let x = 0; x < GW; x++) {
      const c = z * GW + x;
      const s = owner[c] >= 0 ? shapes[owner[c]] : null;
      if (!s?.terrain) continue;
      const y = h[c];
      surfaces.push({
        texture: s.terrain.top,
        q: { p: [[x * cell, y, z * cell], [(x + 1) * cell, y, z * cell], [(x + 1) * cell, y, (z + 1) * cell], [x * cell, y, (z + 1) * cell]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], n: [0, 1, 0] },
      });
    }
  for (const s of shapes) if (s.kind === 'stairs' && s.stairs) surfaces.push(...stairsSteps(s, cell).map((q) => ({ texture: s.stairs!.texture, q })));

  return {
    surfaces,
    floor: { verts: fv, idx: fi },
    walls: { verts: wv, polys: [{ name: 0, idx: wallIdx }, { name: 1, idx: jumpIdx }].filter((p) => p.idx.length) },
    height,
  };
}

// a vertical quad facing `side`, its texture repeated once per 100 units
function sideQuad(p: [number, number, number][], side: Side): Surface {
  const n: [number, number, number] = side === 'n' ? [0, 0, -1] : side === 's' ? [0, 0, 1] : side === 'e' ? [1, 0, 0] : [-1, 0, 0];
  const u = (v: [number, number, number]) => (side === 'n' || side === 's' ? v[0] : v[2]) / 100;
  return { p, uv: p.map((v) => [u(v), -v[1] / 100] as [number, number]), n };
}

// the steps of a stairs object: a tread and a riser per step (a step every ~12.5 units of height)
function stairsSteps(s: TerrainShape, cell: number): Surface[] {
  const st = s.stairs!;
  const steps = Math.max(1, Math.round(st.height / 12.5));
  const dir = s.dir ?? 0;
  const x0 = s.cx0 * cell, x1 = (s.cx0 + s.w) * cell, z0 = s.cz0 * cell, z1 = (s.cz0 + s.d) * cell;
  const out: Surface[] = [];
  // u: across the stairs, t: along the climb (0 low end .. 1 high end) -> a point
  const at = (u: number, t: number, y: number): [number, number, number] => {
    switch (dir) {
      case 0: return [x0 + u * (x1 - x0), y, z1 - t * (z1 - z0)];
      case 1: return [x0 + t * (x1 - x0), y, z0 + u * (z1 - z0)];
      case 2: return [x1 - u * (x1 - x0), y, z0 + t * (z1 - z0)];
      default: return [x1 - t * (x1 - x0), y, z1 - u * (z1 - z0)];
    }
  };
  const width = dir % 2 === 0 ? x1 - x0 : z1 - z0;
  const length = dir % 2 === 0 ? z1 - z0 : x1 - x0;
  const climb: [number, number, number] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][dir] as [number, number, number];
  const back: [number, number, number] = [-climb[0], 0, -climb[2]];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const y0 = s.base + (st.height * i) / steps, y1 = s.base + (st.height * (i + 1)) / steps;
    // riser at t0 (facing down the stairs), then the tread from t0 to t1 at y1
    out.push({ p: [at(0, t0, y0), at(1, t0, y0), at(1, t0, y1), at(0, t0, y1)], uv: [[0, 0], [width / 100, 0], [width / 100, (y1 - y0) / 100], [0, (y1 - y0) / 100]], n: back });
    out.push({ p: [at(0, t0, y1), at(1, t0, y1), at(1, t1, y1), at(0, t1, y1)], uv: [[0, (t0 * length) / 100], [width / 100, (t0 * length) / 100], [width / 100, (t1 * length) / 100], [0, (t1 * length) / 100]], n: [0, 1, 0] });
  }
  return out;
}
