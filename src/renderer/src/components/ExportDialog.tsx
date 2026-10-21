// Export to the game: the map built into a Let's Go Recomp mod (one of the game's unused map slots, with a teleporter
// in Pallet Town to it and one back).
import { useEffect, useState } from 'react';
import { useUi } from '../ui';
import { useEditor } from '../store';
import { docForExport } from '../actions';
import type { ExportResult } from '../../../preload/index';

const SLOTS = [
  ['test_chr01', 'Hueco 1 (test_chr01)'],
  ['test_chr02', 'Hueco 2 (test_chr02)'],
  ['test_chr03', 'Hueco 3 (test_chr03)'],
  ['test_chr04', 'Hueco 4 (test_chr04)'],
];

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen);
  const objects = useEditor((s) => s.doc.objects);
  const grid = useEditor((s) => s.doc.grid);
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
  const tiles = objects.filter((o) => o.asset?.startsWith('tile.')).length;
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
        <h2>Exportar al juego</h2>
        <p>
          Crea un mod para Let's Go Recomp con <b>{name}</b>: el mapa ocupa uno de los mapas sin usar del juego y en{' '}
          <b>Pueblo Paleta</b> aparece un teletransportador (en el camino entre las casas del norte) que lleva hasta él. En el mapa, la
          baldosa de salida devuelve a Pueblo Paleta.
        </p>
        <div className="insp" style={{ padding: 0 }}>
          <div className="field">
            <span>Carpeta mods</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} placeholder="…\LetsGoRecomp\mods" />
              <button onClick={async () => setDir((await window.api.pickModsDir()) ?? dir)}>Elegir…</button>
            </div>
          </div>
          <div className="field">
            <span>Mapa del juego</span>
            <select value={slot} onChange={(e) => setSlot(e.target.value)}>
              {SLOTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="kv">
            {hasSpawn ? '✔ Punto de llegada colocado' : '• Sin punto de llegada: se llega al centro de la rejilla'}
            <br />
            {hasExit ? '✔ Salida colocada' : '• Sin salida: se pone 3 casillas al sur de la llegada'}
            <br />
            {grid.width > 40 || grid.depth > 40 ? '⚠ La rejilla pasa de 40 × 40 casillas: el suelo base solo cubre 40 × 40' : '✔ Tamaño de la rejilla dentro del suelo base (40 × 40)'}
            {tiles > 0 && (
              <>
                <br />⚠ {tiles} baldosas generadas por el editor no se exportan todavía (usa suelos de las zonas del juego)
              </>
            )}
          </div>
        </div>
        {busy && <p>Construyendo el mapa… (la primera vez indexa los archivos del juego y tarda unos segundos)</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {result && (
          <div className="kv" style={{ marginTop: 10 }}>
            <b>Mod creado en {result.dir}</b>
            <br />
            {result.stats.objects} objetos · {result.stats.materials} materiales · {result.stats.textures} texturas · {result.stats.triangles} triángulos
            {result.warnings.filter((w) => !w.includes('baldosas')).length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18, maxHeight: 120, overflow: 'auto' }}>
                {result.warnings
                  .filter((w) => !w.includes('baldosas'))
                  .map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
              </ul>
            )}
            <br />
            Actívalo en la pestaña <b>Mods</b> del lanzador de Let's Go Recomp (y desactiva otros mods de mapas).
          </div>
        )}
        <div className="actions">
          {result && <button onClick={() => window.api.openPath(result.dir)}>Abrir carpeta</button>}
          <button onClick={close} disabled={busy}>
            Cerrar
          </button>
          <button className="primary" onClick={run} disabled={busy || !dir}>
            {busy ? 'Exportando…' : 'Exportar'}
          </button>
        </div>
      </div>
    </div>
  );
}
