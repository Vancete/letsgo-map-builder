// Inspector section of a tall-grass zone: its size in cells and the wild Pokémon that appear in it (species, chance,
// levels), as the game's encounter table holds them.
import { useEditor } from '../store';
import { defaultGrass, type GrassZone, type MapObject, type WildSlot } from '@shared/types';
import { SPECIES } from '@shared/pokemon';

const MAX_SLOTS = 10;

function IntInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
      }}
      style={{ width: '100%' }}
    />
  );
}

export function GrassPanel({ obj }: { obj: MapObject }) {
  const z: GrassZone = obj.grass ?? defaultGrass();
  const set = (patch: Partial<GrassZone>) => useEditor.getState().updateObject(obj.id, { grass: { ...z, ...patch } });
  const setWild = (patch: Partial<GrassZone['wild']>) => set({ wild: { ...z.wild, ...patch } });
  const setSlot = (i: number, patch: Partial<WildSlot>) => setWild({ slots: z.wild.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const total = z.wild.slots.reduce((n, s) => n + (s.species ? s.rate : 0), 0);

  // share 100 % among the slots, the remainder to the first ones
  const even = () => {
    const n = z.wild.slots.length;
    if (!n) return;
    const base = Math.floor(100 / n);
    setWild({ slots: z.wild.slots.map((s, i) => ({ ...s, rate: base + (i < 100 - base * n ? 1 : 0) })) });
  };

  return (
    <div>
      <h3>Tall-grass zone</h3>
      <div className="field">
        <span>Cells</span>
        <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <IntInput value={z.w} min={1} max={40} onChange={(w) => set({ w })} />
          <IntInput value={z.d} min={1} max={40} onChange={(d) => set({ d })} />
        </div>
      </div>
      <div className="field">
        <span>Level</span>
        <div className="vec3" style={{ gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
          <IntInput value={z.wild.minLevel} min={1} max={100} onChange={(minLevel) => setWild({ minLevel, maxLevel: Math.max(minLevel, z.wild.maxLevel) })} />
          <span className="kv">to</span>
          <IntInput value={z.wild.maxLevel} min={1} max={100} onChange={(maxLevel) => setWild({ maxLevel, minLevel: Math.min(maxLevel, z.wild.minLevel) })} />
        </div>
      </div>
      <h3 style={{ marginTop: 10 }}>Wild Pokémon</h3>
      <div className="slots">
        {z.wild.slots.map((s, i) => (
          <div className="slot" key={i}>
            <select value={s.species} onChange={(e) => setSlot(i, { species: Number(e.target.value) })}>
              {SPECIES.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {String(sp.id).padStart(3, '0')} {sp.name}
                </option>
              ))}
            </select>
            <input type="number" min={1} max={100} value={s.rate} onChange={(e) => setSlot(i, { rate: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} title="Chance (%)" />
            <span className="kv">%</span>
            <button className="icon" title="Remove" onClick={() => setWild({ slots: z.wild.slots.filter((_, k) => k !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button disabled={z.wild.slots.length >= MAX_SLOTS} onClick={() => setWild({ slots: [...z.wild.slots, { species: 16, rate: 10 }] })}>
          + Add Pokémon
        </button>
        <button disabled={!z.wild.slots.length} onClick={even}>
          Share 100 %
        </button>
      </div>
      <div className="kv" style={{ marginTop: 6, color: total === 100 ? undefined : 'var(--danger)' }}>
        Total: <b>{total} %</b>
        {total !== 100 && ' — it should add up to 100 %'}
        {z.wild.slots.length >= MAX_SLOTS && ' · at most 10 Pokémon per zone'}
      </div>
      <p className="kv">
        In the game the zone fills with tall grass and the Pokémon appear and wander in it; touching one starts the catch. Each
        zone is a game zone of its own, with its table, the same for Pikachu and Eevee.
      </p>
    </div>
  );
}
