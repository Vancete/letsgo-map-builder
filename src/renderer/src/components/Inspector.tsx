// Right panel: the selected object's name and transform (game units, degrees), its cell on the grid, and the map's own
// properties when nothing is selected.
import { useEffect, useState } from 'react';
import { useEditor } from '../store';
import { CATEGORY_LABELS, GRASS_ASSET, SIGN_ASSET, STAIRS_ASSET, TERRAIN_ASSET, type MapObject } from '@shared/types';
import { SignPanel } from './SignPanel';
import { GrassPanel } from './GrassPanel';
import { StairsPanel, TerrainPanel, TexturePicker } from './TerrainPanel';
import { thumbUrl } from '../three/thumbs';

type V3 = [number, number, number];

function NumberInput({ value, onCommit, onLive, step, axis }: { value: number; onCommit(v: number): void; onLive(v: number): void; step: number; axis: 'x' | 'y' | 'z' }) {
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(fmt(value));
  }, [value, editing]);

  // drag the axis label to scrub the value
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) useEditor.getState().commit();
      moved = true;
      const fine = ev.shiftKey ? 0.1 : 1;
      onLive(Math.round((start + dx * step * 0.1 * fine) / (step * 0.1 * fine)) * step * 0.1 * fine);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commit = () => {
    setEditing(false);
    const v = evalNumber(text);
    if (v !== null && v !== value) onCommit(v);
    else setText(fmt(value));
  };

  return (
    <label>
      <b className={axis} onPointerDown={scrub}>
        {axis.toUpperCase()}
      </b>
      <input
        value={text}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = (evalNumber(text) ?? value) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
            setText(fmt(v));
            onCommit(v);
          }
        }}
      />
    </label>
  );
}

function fmt(v: number) {
  return String(Math.round(v * 1000) / 1000);
}

// numbers or simple arithmetic ("150+100", "3*100")
function evalNumber(s: string): number | null {
  const t = s.replace(/,/g, '.').replace(/\s+/g, '');
  let i = 0;
  const num = (): number => {
    if (t[i] === '(') {
      i++;
      const v = expr();
      if (t[i++] !== ')') throw new Error();
      return v;
    }
    if (t[i] === '-' || t[i] === '+') return t[i++] === '-' ? -num() : num();
    const m = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(t.slice(i));
    if (!m) throw new Error();
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const term = (): number => {
    let v = num();
    while (t[i] === '*' || t[i] === '/') v = t[i++] === '*' ? v * num() : v / num();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (t[i] === '+' || t[i] === '-') v = t[i++] === '+' ? v + term() : v - term();
    return v;
  };
  try {
    const v = expr();
    return i === t.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function Vec3({ label, value, step, onChange }: { label: string; value: V3; step: number; onChange(v: V3, history: boolean): void }) {
  const set = (i: number, v: number, history: boolean) => {
    const n = [...value] as V3;
    n[i] = v;
    onChange(n, history);
  };
  return (
    <div className="field">
      <span>{label}</span>
      <div className="vec3">
        {(['x', 'y', 'z'] as const).map((a, i) => (
          <NumberInput key={a} axis={a} value={value[i]} step={step} onCommit={(v) => set(i, v, true)} onLive={(v) => set(i, v, false)} />
        ))}
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const objects = useEditor((s) => s.doc.objects);
  const sel = selection.map((id) => objects.find((o) => o.id === id)).filter((o): o is MapObject => !!o);
  return (
    <>
      <div className="panel-head">{sel.length === 1 ? 'Objeto' : sel.length > 1 ? `${sel.length} objetos` : 'Mapa'}</div>
      <div className="panel-body">
        {sel.length === 1 ? <ObjectInspector obj={sel[0]} /> : sel.length > 1 ? <MultiInspector objs={sel} /> : <MapInspector />}
      </div>
    </>
  );
}

// world position of an object (parents' transforms applied, translation and Y rotation only)
function worldPos(o: MapObject, objects: MapObject[]): V3 {
  let p: V3 = [...o.position];
  let cur = o;
  for (let n = 0; cur.parent && n < 64; n++) {
    const parent = objects.find((x) => x.id === cur.parent);
    if (!parent) break;
    const a = (parent.rotation[1] * Math.PI) / 180;
    const [x, y, z] = [p[0] * parent.scale[0], p[1] * parent.scale[1], p[2] * parent.scale[2]];
    p = [parent.position[0] + x * Math.cos(a) + z * Math.sin(a), parent.position[1] + y, parent.position[2] - x * Math.sin(a) + z * Math.cos(a)];
    cur = parent;
  }
  return p;
}

function ObjectInspector({ obj }: { obj: MapObject }) {
  const ed = useEditor.getState;
  const asset = useEditor((s) => (obj.asset ? s.assets.get(obj.asset) : undefined));
  const grid = useEditor((s) => s.doc.grid);
  const objects = useEditor((s) => s.doc.objects);
  const thumbs = useEditor((s) => s.thumbs);
  const thumbVersion = useEditor((s) => s.thumbVersion);
  const wp = worldPos(obj, objects);
  const cell = [Math.floor((wp[0] - grid.originX) / grid.cellSize), Math.floor((wp[2] - grid.originZ) / grid.cellSize)];
  const update = (patch: Partial<MapObject>, history = true) => ed().updateObject(obj.id, patch, history);

  const setCell = (cx: number, cz: number) => {
    const dx = grid.originX + (cx + 0.5) * grid.cellSize - wp[0];
    const dz = grid.originZ + (cz + 0.5) * grid.cellSize - wp[2];
    update({ position: [obj.position[0] + dx, obj.position[1], obj.position[2] + dz] });
  };

  return (
    <div className="insp">
      <div>
        <div className="field">
          <span>Nombre</span>
          <input key={obj.id + obj.name} defaultValue={obj.name} onBlur={(e) => e.target.value.trim() && e.target.value !== obj.name && update({ name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </div>
        <div className="field">
          <span>Visible</span>
          <div className="btn-row">
            <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" checked={obj.visible} onChange={(e) => update({ visible: e.target.checked })} /> visible
            </label>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" checked={obj.locked} onChange={(e) => update({ locked: e.target.checked })} /> bloqueado
            </label>
          </div>
        </div>
      </div>

      <div>
        <h3>Transformación</h3>
        <Vec3 label="Posición" value={obj.position} step={grid.cellSize / 2} onChange={(v, h) => update({ position: v }, h)} />
        <Vec3 label="Rotación °" value={obj.rotation} step={15} onChange={(v, h) => update({ rotation: v }, h)} />
        <Vec3 label="Escala" value={obj.scale} step={0.25} onChange={(v, h) => update({ scale: v }, h)} />
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button onClick={() => update({ rotation: [obj.rotation[0], (obj.rotation[1] + 90) % 360, obj.rotation[2]] })}>Girar 90°</button>
          <button onClick={() => update({ position: [obj.position[0], 0, obj.position[2]] })}>Al suelo</button>
          <button onClick={() => update({ rotation: [0, 0, 0], scale: [1, 1, 1] })}>Reiniciar</button>
        </div>
      </div>

      <div>
        <h3>Rejilla</h3>
        <div className="field">
          <span>Casilla</span>
          <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput axis="x" value={cell[0]} step={1} onCommit={(v) => setCell(Math.round(v), cell[1])} onLive={(v) => setCell(Math.round(v), cell[1])} />
            <NumberInput axis="z" value={cell[1]} step={1} onCommit={(v) => setCell(cell[0], Math.round(v))} onLive={(v) => setCell(cell[0], Math.round(v))} />
          </div>
        </div>
        <div className="kv">
          Mundo: <b>{wp.map((v) => Math.round(v)).join(', ')}</b> · casilla de {grid.cellSize} u
        </div>
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button onClick={() => setCell(cell[0], cell[1])}>Centrar en la casilla</button>
        </div>
      </div>

      {obj.asset === GRASS_ASSET && <GrassPanel obj={obj} />}
      {obj.asset === TERRAIN_ASSET && <TerrainPanel obj={obj} />}
      {obj.asset === STAIRS_ASSET && <StairsPanel obj={obj} />}
      {obj.asset === SIGN_ASSET && <SignPanel obj={obj} />}

      {obj.asset && ![GRASS_ASSET, TERRAIN_ASSET, STAIRS_ASSET].includes(obj.asset) && (
        <div>
          <h3>Modelo</h3>
          {asset && thumbs.has(asset.id) && <img className="insp-thumb" src={thumbUrl(asset.id, thumbVersion)} />}
          <div className="kv">
            {asset ? (
              <>
                <b>{asset.name}</b>
                <br />
                {CATEGORY_LABELS[asset.category]}
                {asset.zone ? ` · de ${asset.zone}` : ''}
                <br />
                Tamaño: {Math.round(asset.bounds[3] - asset.bounds[0])} × {Math.round(asset.bounds[4] - asset.bounds[1])} × {Math.round(asset.bounds[5] - asset.bounds[2])} u · {asset.triangles} triángulos
                <br />
                <span style={{ fontSize: 11 }}>{asset.source.kind === 'model' ? asset.source.path ?? asset.source.pak : asset.source.kind === 'tile' ? `textura ${asset.source.texture}` : asset.source.kind === 'marker' ? 'marcador del editor' : asset.source.pak}</span>
              </>
            ) : (
              <span style={{ color: 'var(--danger)' }}>"{obj.asset}" no está en el catálogo</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MultiInspector({ objs }: { objs: MapObject[] }) {
  const ed = useEditor.getState;
  const grid = useEditor((s) => s.doc.grid);
  const each = (f: (o: MapObject) => Partial<MapObject>) => ed().updateObjects(objs.map((o) => ({ id: o.id, patch: f(o) })));
  const snap = (v: number, origin: number) => Math.floor((v - origin) / grid.cellSize) * grid.cellSize + origin + grid.cellSize / 2;
  return (
    <div className="insp">
      <div className="kv">{objs.map((o) => o.name).join(', ')}</div>
      <div className="btn-row">
        <button onClick={() => each((o) => ({ position: [snap(o.position[0], grid.originX), o.position[1], snap(o.position[2], grid.originZ)] }))}>Centrar en casillas</button>
        <button onClick={() => each((o) => ({ position: [o.position[0], 0, o.position[2]] }))}>Al suelo</button>
        <button onClick={() => each((o) => ({ rotation: [o.rotation[0], (o.rotation[1] + 90) % 360, o.rotation[2]] }))}>Girar 90°</button>
        <button onClick={() => ed().groupSelected()}>Agrupar</button>
        <button onClick={() => ed().removeSelected()}>Eliminar</button>
      </div>
    </div>
  );
}

function MapInspector() {
  const doc = useEditor((s) => s.doc);
  const filePath = useEditor((s) => s.filePath);
  const ed = useEditor.getState;
  const g = doc.grid;
  const counts = new Map<string, number>();
  const assets = useEditor((s) => s.assets);
  for (const o of doc.objects) {
    const c = o.asset ? assets.get(o.asset)?.category ?? 'other' : null;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const center = () => ed().setGrid({ originX: -Math.round(g.width / 2) * g.cellSize, originZ: -Math.round(g.depth / 2) * g.cellSize });
  return (
    <div className="insp">
      <div>
        <h3>Mapa</h3>
        <div className="field">
          <span>Nombre</span>
          <input value={doc.name} onChange={(e) => ed().setMapInfo({ name: e.target.value })} />
        </div>
        <div className="field">
          <span>Autor</span>
          <input value={doc.author} onChange={(e) => ed().setMapInfo({ author: e.target.value })} />
        </div>
        <div className="field" style={{ alignItems: 'start' }}>
          <span>Descripción</span>
          <textarea rows={3} value={doc.description} onChange={(e) => ed().setMapInfo({ description: e.target.value })} />
        </div>
        <div className="kv">{filePath ?? 'Sin guardar'}</div>
      </div>
      <div>
        <h3>Rejilla</h3>
        <div className="field">
          <span>Casillas</span>
          <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput axis="x" value={g.width} step={1} onCommit={(v) => ed().setGrid({ width: Math.max(1, Math.min(512, Math.round(v))) })} onLive={() => {}} />
            <NumberInput axis="z" value={g.depth} step={1} onCommit={(v) => ed().setGrid({ depth: Math.max(1, Math.min(512, Math.round(v))) })} onLive={() => {}} />
          </div>
        </div>
        <div className="field">
          <span>Origen</span>
          <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput axis="x" value={g.originX} step={g.cellSize} onCommit={(v) => ed().setGrid({ originX: Math.round(v / g.cellSize) * g.cellSize })} onLive={() => {}} />
            <NumberInput axis="z" value={g.originZ} step={g.cellSize} onCommit={(v) => ed().setGrid({ originZ: Math.round(v / g.cellSize) * g.cellSize })} onLive={() => {}} />
          </div>
        </div>
        <div className="field">
          <span>Casilla</span>
          <select value={g.cellSize} onChange={(e) => ed().setGrid({ cellSize: Number(e.target.value) })}>
            <option value={100}>100 u (la del juego)</option>
            <option value={50}>50 u</option>
            <option value={200}>200 u</option>
          </select>
        </div>
        <div className="btn-row">
          <button onClick={center}>Centrar en el origen</button>
        </div>
        <p className="kv">
          Como en el juego, una casilla mide 100 unidades (una roca de Fuerza o una baldosa ocupan una). Los objetos se colocan en el
          centro de las casillas.
        </p>
      </div>
      <GroundSection />
      <div>
        <h3>Contenido</h3>
        <div className="kv">
          {doc.objects.length} objetos
          {[...counts].map(([c, n]) => (
            <div key={c}>
              {CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS]}: <b>{n}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// the ground in the game: the slot's own meadow under the map, a ring of ground around it, filling the grid with tiles
function GroundSection() {
  const doc = useEditor((s) => s.doc);
  const assets = useEditor((s) => s.assets);
  const fillTex = useEditor((s) => s.fillTexture);
  const ed = useEditor.getState;
  const tiles = doc.objects.filter((o) => o.asset && assets.get(o.asset)?.source.kind === 'tile').length;
  return (
    <div>
      <h3>Suelo en el juego</h3>
      <div className="field">
        <span>Pradera del hueco</span>
        <select
          value={doc.slotGround === undefined ? 'auto' : doc.slotGround ? 'yes' : 'no'}
          onChange={(e) => ed().setMapInfo({ slotGround: e.target.value === 'auto' ? undefined : e.target.value === 'yes' })}
        >
          <option value="auto">Automática ({tiles ? 'no: el mapa tiene baldosas' : 'sí: el mapa no tiene baldosas'})</option>
          <option value="yes">Sí</option>
          <option value="no">No</option>
        </select>
      </div>
      <div className="field">
        <span>Borde exterior</span>
        {doc.border ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px', gap: 6 }}>
            <TexturePicker value={doc.border.texture} onChange={(texture) => ed().setMapInfo({ border: { ...doc.border!, texture } })} prefer={/grass/} />
            <input
              type="number"
              min={0}
              max={64}
              value={doc.border.cells}
              title="Ancho en casillas (0: sin borde)"
              onChange={(e) => {
                const cells = Math.max(0, Math.min(64, Math.round(Number(e.target.value) || 0)));
                ed().setMapInfo({ border: cells ? { ...doc.border!, cells } : null });
              }}
            />
          </div>
        ) : (
          <button onClick={() => ed().setMapInfo({ border: { texture: 'grass01_com', cells: 12 } })}>Añadir borde</button>
        )}
      </div>
      <div className="field">
        <span>Rellenar</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
          <TexturePicker value={fillTex} onChange={(t) => useEditor.setState({ fillTexture: t })} prefer={/grass/} />
          <button onClick={() => ed().fillGround(fillTex)} title="Cubre con baldosas de 4 × 4 casillas lo que aún no tiene baldosas">
            Rellenar
          </button>
        </div>
      </div>
      <p className="kv">
        La <b>pradera del hueco</b> es el suelo de la sala de pruebas que el mapa sustituye (40 × 40 casillas). Fuera del mapa el juego
        solo muestra su fondo: el <b>borde exterior</b> pone suelo alrededor (solo se ve, no se pisa).
      </p>
    </div>
  );
}
