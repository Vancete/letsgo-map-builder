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

const SIDE_LABEL: Record<Side, string> = { n: 'Norte (arriba)', e: 'Este (derecha)', s: 'Sur (abajo)', w: 'Oeste (izquierda)' };

export function TerrainPanel({ obj }: { obj: MapObject }) {
  const t: TerrainBlock = obj.terrain ?? defaultTerrain();
  const set = (patch: Partial<TerrainBlock>) => useEditor.getState().updateObject(obj.id, { terrain: { ...t, ...patch } });
  return (
    <div>
      <h3>Elevación</h3>
      <div className="field">
        <span>Casillas</span>
        <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <IntInput value={t.w} min={1} max={128} onChange={(w) => set({ w })} />
          <IntInput value={t.d} min={1} max={128} onChange={(d) => set({ d })} />
        </div>
      </div>
      <div className="field">
        <span>Altura</span>
        <IntInput value={t.height} min={5} max={1000} step={25} onChange={(height) => set({ height })} />
      </div>
      <div className="field">
        <span>Arriba</span>
        <TexturePicker value={t.top} onChange={(top) => set({ top })} prefer={/grass|soil|sand|tile|grd/} />
      </div>
      <div className="field">
        <span>Lados</span>
        <TexturePicker value={t.side} onChange={(side) => set({ side })} prefer={/cliff|rock|wall|stone/} />
      </div>
      <h3 style={{ marginTop: 10 }}>Bordes</h3>
      {(['n', 'e', 's', 'w'] as Side[]).map((sd) => (
        <div className="field" key={sd}>
          <span>{SIDE_LABEL[sd]}</span>
          <select value={t.edges[sd]} onChange={(e) => set({ edges: { ...t.edges, [sd]: e.target.value as EdgeKind } })}>
            <option value="wall">Acantilado (no se pasa)</option>
            <option value="ledge">Salto (se baja saltando)</option>
          </select>
        </div>
      ))}
      <p className="kv">
        Un salto es un borde por el que el jugador baja saltando, pero no sube (en el juego miden 50). Para subir, pon unas
        <b> Escaleras</b> contra un borde. Los objetos y zonas de hierba que pongas encima se colocan a su altura.
      </p>
    </div>
  );
}

export function StairsPanel({ obj }: { obj: MapObject }) {
  const s: StairsBlock = obj.stairs ?? defaultStairs();
  const set = (patch: Partial<StairsBlock>) => useEditor.getState().updateObject(obj.id, { stairs: { ...s, ...patch } });
  return (
    <div>
      <h3>Escaleras</h3>
      <div className="field">
        <span>Ancho</span>
        <IntInput value={s.w} min={1} max={32} onChange={(w) => set({ w })} />
      </div>
      <div className="field">
        <span>Largo</span>
        <IntInput value={s.length} min={1} max={32} onChange={(length) => set({ length })} />
      </div>
      <div className="field">
        <span>Altura</span>
        <IntInput value={s.height} min={5} max={1000} step={25} onChange={(height) => set({ height })} />
      </div>
      <div className="field">
        <span>Textura</span>
        <TexturePicker value={s.texture} onChange={(texture) => set({ texture })} prefer={/stone|stairs|tile|road/} />
      </div>
      <p className="kv">
        Suben hacia donde mira el objeto (gíralo con Q o con la rotación Y): 0° hacia el norte (arriba), 90° oeste, 180° sur, 270°
        este. Colócalas con el extremo alto contra el borde de una elevación de la misma altura.
      </p>
    </div>
  );
}
