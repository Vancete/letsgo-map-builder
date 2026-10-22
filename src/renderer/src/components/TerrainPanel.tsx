// Inspector sections of raised ground (its cells, height, textures and what each edge is: a cliff or a ledge to jump
// down from) and of stairs (width, length, height, texture). The ground at several heights is built from them
// (shared/terrain.ts) in the view and in the game alike.
import { useMemo } from 'react';
import { useEditor } from '../store';
import { defaultStairs, defaultTerrain, type EdgeKind, type MapObject, type Side, type StairsBlock, type TerrainBlock } from '@shared/types';
import { textureUrl } from '../three/models';

function IntInput({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange(v: number): void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
      }}
      style={{ width: '100%' }}
    />
  );
}

// the game's ground and cliff textures the catalog has (those of its ground tiles)
export function useGroundTextures(): string[] {
  const catalog = useEditor((s) => s.catalog);
  return useMemo(() => {
    const set = new Set<string>();
    for (const a of catalog?.assets ?? []) if (a.source.kind === 'tile') set.add(a.source.texture);
    return [...set].sort();
  }, [catalog]);
}

export function TexturePicker({ value, onChange, prefer }: { value: string; onChange(t: string): void; prefer?: RegExp }) {
  const all = useGroundTextures();
  const list = prefer ? [...all.filter((t) => prefer.test(t)), ...all.filter((t) => !prefer.test(t))] : all;
  if (!list.includes(value)) list.unshift(value);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <img src={textureUrl(value)} style={{ width: 26, height: 26, borderRadius: 3, objectFit: 'cover', flex: 'none' }} />
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
        {list.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

const SIDE_LABEL: Record<Side, string> = { n: 'North (up)', e: 'East (right)', s: 'South (down)', w: 'West (left)' };

export function TerrainPanel({ obj }: { obj: MapObject }) {
  const t: TerrainBlock = obj.terrain ?? defaultTerrain();
  const set = (patch: Partial<TerrainBlock>) => useEditor.getState().updateObject(obj.id, { terrain: { ...t, ...patch } });
  return (
    <div>
      <h3>Raised ground</h3>
      <div className="field">
        <span>Cells</span>
        <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <IntInput value={t.w} min={1} max={128} onChange={(w) => set({ w })} />
          <IntInput value={t.d} min={1} max={128} onChange={(d) => set({ d })} />
        </div>
      </div>
      <div className="field">
        <span>Height</span>
        <IntInput value={t.height} min={5} max={1000} step={25} onChange={(height) => set({ height })} />
      </div>
      <div className="field">
        <span>Top</span>
        <TexturePicker value={t.top} onChange={(top) => set({ top })} prefer={/grass|soil|sand|tile|grd/} />
      </div>
      <div className="field">
        <span>Sides</span>
        <TexturePicker value={t.side} onChange={(side) => set({ side })} prefer={/cliff|rock|wall|stone/} />
      </div>
      <h3 style={{ marginTop: 10 }}>Edges</h3>
      {(['n', 'e', 's', 'w'] as Side[]).map((sd) => (
        <div className="field" key={sd}>
          <span>{SIDE_LABEL[sd]}</span>
          <select value={t.edges[sd]} onChange={(e) => set({ edges: { ...t.edges, [sd]: e.target.value as EdgeKind } })}>
            <option value="wall">Cliff (blocks)</option>
            <option value="ledge">Ledge (jump down)</option>
          </select>
        </div>
      ))}
      <p className="kv">
        A ledge is an edge the player jumps down from but can't climb (in the game they are 50 high). To go up, put
        <b> Stairs</b> against an edge. Objects and grass zones placed on top sit at its height.
      </p>
    </div>
  );
}

export function StairsPanel({ obj }: { obj: MapObject }) {
  const s: StairsBlock = obj.stairs ?? defaultStairs();
  const set = (patch: Partial<StairsBlock>) => useEditor.getState().updateObject(obj.id, { stairs: { ...s, ...patch } });
  return (
    <div>
      <h3>Stairs</h3>
      <div className="field">
        <span>Width</span>
        <IntInput value={s.w} min={1} max={32} onChange={(w) => set({ w })} />
      </div>
      <div className="field">
        <span>Length</span>
        <IntInput value={s.length} min={1} max={32} onChange={(length) => set({ length })} />
      </div>
      <div className="field">
        <span>Height</span>
        <IntInput value={s.height} min={5} max={1000} step={25} onChange={(height) => set({ height })} />
      </div>
      <div className="field">
        <span>Texture</span>
        <TexturePicker value={s.texture} onChange={(texture) => set({ texture })} prefer={/stone|stairs|tile|road/} />
      </div>
      <p className="kv">
        They climb towards where the object faces (turn it with Q or rotation Y): 0° north (up), 90° west, 180° south, 270°
        east. Put the high end against the edge of raised ground of the same height.
      </p>
    </div>
  );
}
