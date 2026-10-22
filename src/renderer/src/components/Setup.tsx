import { useEffect, useState } from 'react';
import { useUi } from '../ui';
import { useEditor } from '../store';

export function SetupScreen() {
  const [found, setFound] = useState<string[] | null>(null);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.getSettings().then((s) => setCurrent(s.gamePath));
    window.api.detectGame().then(setFound);
  }, []);

  const use = async (path: string) => {
    if (!(await window.api.validateGame(path))) {
      setError(`The game's files are not in ${path}`);
      return;
    }
    await window.api.setSettings({ gamePath: path });
    useEditor.getState().setCatalog(null);
    useUi.getState().setPhase('building');
  };

  const pick = async (file: boolean) => {
    const r = await window.api.pickGame(file);
    if (!r) return;
    if (!r.valid) setError(`The game's files are not in ${r.path}`);
    else use(r.path);
  };

  const cancel = async () => {
    const cat = await window.api.getCatalog();
    if (cat && current) {
      useEditor.getState().setCatalog(cat);
      useUi.getState().setPhase('ready');
    }
  };

  return (
    <div className="screen">
      <div className="setup">
        <h1>Let's Go Map Builder</h1>
        <p>
          Map editor for <b>Pokémon: Let's Go, Pikachu! / Eevee!</b>. The world's models (trees, grass, ledges, ground, benches,
          street lamps, Pokémon Centers, shops...) are loaded from the files of your copy of the game.
        </p>
        <p>
          Choose the folder of your <b>Let's Go Recomp</b> install (it uses <code>extracted/romfs.bin</code>), an extracted{' '}
          <code>romfs</code> folder or the <code>romfs.bin</code> file.
        </p>
        <div className="paths">
          {found === null && <span className="kv">Looking for installs...</span>}
          {found?.map((p) => (
            <button key={p} onClick={() => use(p)} className={p === current ? 'primary' : ''}>
              📁 {p}
            </button>
          ))}
          {found?.length === 0 && <span className="kv">None was found automatically.</span>}
        </div>
        <div className="btn-row">
          <button className="primary" onClick={() => pick(false)}>
            Choose folder...
          </button>
          <button onClick={() => pick(true)}>Choose romfs.bin...</button>
          {current && (
            <button onClick={cancel} style={{ marginLeft: 'auto' }}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}

export function BuildScreen() {
  const progress = useUi((s) => s.buildProgress);
  const error = useUi((s) => s.buildError);

  useEffect(() => {
    const off = window.api.onCatalogProgress((p) => useUi.getState().setBuild(p));
    useUi.getState().setBuild({ phase: 'Getting ready', done: 0, total: 1 });
    window.api
      .buildCatalog()
      .then((cat) => {
        useEditor.getState().setCatalog(cat);
        useUi.getState().setBuild(null);
        useUi.getState().setPhase('ready');
      })
      .catch((e: Error) => useUi.getState().setBuild(null, e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
    return off;
  }, []);

  const pct = progress && progress.total ? (progress.done / progress.total) * 100 : 0;
  return (
    <div className="screen">
      <div className="setup">
        <h1>Building the catalog</h1>
        <p>
          The models and textures are extracted from the game's files and kept in the editor's cache. Then thumbnails of every
          object are made (they can be made again from the Catalog menu).
        </p>
        {error ? (
          <>
            <p className="err">{error}</p>
            <button onClick={() => useUi.getState().setPhase('setup')}>Change the game folder</button>
          </>
        ) : (
          <>
            <div className="big-progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="kv">
              <b>{progress?.phase}</b> {progress?.message ?? ''} {progress && progress.total > 1 ? `(${progress.done}/${progress.total})` : ''}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
