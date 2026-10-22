// Export to the game: the map built into a Let's Go Recomp mod (one of the game's unused map slots, with a teleporter
// in Pallet Town to it and one back).
import { useEffect, useState } from 'react';
import { useUi } from '../ui';
import { useEditor } from '../store';
import { docForExport } from '../actions';
import type { ExportResult } from '../../../preload/index';

const SLOTS = [
  ['test_chr01', 'Slot 1 (test_chr01)'],
  ['test_chr02', 'Slot 2 (test_chr02)'],
  ['test_chr03', 'Slot 3 (test_chr03)'],
  ['test_chr04', 'Slot 4 (test_chr04)'],
];

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen);
  const objects = useEditor((s) => s.doc.objects);
  const name = useEditor((s) => s.doc.name);
  const [dir, setDir] = useState('');
  const [slot, setSlot] = useState('test_chr01');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setResult(null);
      setError('');
      window.api.defaultModsDir().then((d) => setDir((cur) => cur || d));
    }
  }, [open]);
  if (!open) return null;

  const hasSpawn = objects.some((o) => o.asset === 'lg.spawn');
  const hasExit = objects.some((o) => o.asset === 'lg.exit');
  const grass = objects.filter((o) => o.asset === 'lg.grass' && o.visible);
  const badGrass = grass.filter((o) => (o.grass?.wild.slots ?? []).reduce((n, s) => n + s.rate, 0) !== 100).length;
  const close = () => !busy && useUi.setState({ exportOpen: false });

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await window.api.exportMod(docForExport(), slot, dir));
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width: 'min(640px, 94vw)' }}>
        <h2>Export to the game</h2>
        <p>
          Makes a Let's Go Recomp mod with <b>{name}</b>: the map takes the place of one of the game's unused maps, and a teleport
          pad appears in <b>Pallet Town</b> (on the path between the northern houses) that leads to it. In the map, the exit pad
          takes you back to Pallet Town.
        </p>
        <div className="insp" style={{ padding: 0 }}>
          <div className="field">
            <span>Mods folder</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} placeholder="…\LetsGoRecomp\mods" />
              <button onClick={async () => setDir((await window.api.pickModsDir()) ?? dir)}>Choose…</button>
            </div>
          </div>
          <div className="field">
            <span>Game map</span>
            <select value={slot} onChange={(e) => setSlot(e.target.value)}>
              {SLOTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="kv">
            {hasSpawn ? '✔ Arrival point placed' : '• No arrival point: the player arrives at the middle of the grid'}
            <br />
            {hasExit ? '✔ Exit placed' : '• No exit: it goes 3 cells south of the arrival'}
            <br />
            {grass.length ? `✔ ${grass.length} grass zones with wild Pokémon` : '• No grass zones (no wild Pokémon)'}
            {badGrass > 0 && (
              <>
                <br />⚠ {badGrass} grass zones whose chances don't add up to 100 %
              </>
            )}
          </div>
        </div>
        {busy && <p>Building the map… (the first time it indexes the game's files and takes a few seconds)</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {result && (
          <div className="kv" style={{ marginTop: 10 }}>
            <b>Mod made in {result.dir}</b>
            <br />
            {result.stats.objects} objects · {result.stats.materials} materials · {result.stats.textures} textures · {result.stats.triangles} triangles
            {result.warnings.length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18, maxHeight: 120, overflow: 'auto' }}>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <br />
            Enable it in the <b>Mods</b> tab of the Let's Go Recomp launcher (and disable other map mods).
          </div>
        )}
        <div className="actions">
          {result && <button onClick={() => window.api.openPath(result.dir)}>Open folder</button>}
          <button onClick={close} disabled={busy}>
            Close
          </button>
          <button className="primary" onClick={run} disabled={busy || !dir}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
