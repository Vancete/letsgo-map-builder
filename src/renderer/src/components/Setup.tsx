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
      setError(`No se encuentran los archivos del juego en ${path}`);
      return;
    }
    await window.api.setSettings({ gamePath: path });
    useEditor.getState().setCatalog(null);
    useUi.getState().setPhase('building');
  };

  const pick = async (file: boolean) => {
    const r = await window.api.pickGame(file);
    if (!r) return;
    if (!r.valid) setError(`No se encuentran los archivos del juego en ${r.path}`);
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
          Editor de mapas para <b>Pokémon: Let's Go, Pikachu! / Eevee!</b>. Los modelos del mundo (árboles, hierba, saltos,
          suelos, bancos, farolas, Centros Pokémon, tiendas...) se cargan de los archivos de tu copia del juego.
        </p>
        <p>
          Elige la carpeta de tu instalación de <b>Let's Go Recomp</b> (usa <code>extracted/romfs.bin</code>), una carpeta{' '}
          <code>romfs</code> extraída o el archivo <code>romfs.bin</code>.
        </p>
        <div className="paths">
          {found === null && <span className="kv">Buscando instalaciones...</span>}
          {found?.map((p) => (
            <button key={p} onClick={() => use(p)} className={p === current ? 'primary' : ''}>
              📁 {p}
            </button>
          ))}
          {found?.length === 0 && <span className="kv">No se ha encontrado ninguna automáticamente.</span>}
        </div>
        <div className="btn-row">
          <button className="primary" onClick={() => pick(false)}>
            Elegir carpeta...
          </button>
          <button onClick={() => pick(true)}>Elegir romfs.bin...</button>
          {current && (
            <button onClick={cancel} style={{ marginLeft: 'auto' }}>
              Cancelar
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
    useUi.getState().setBuild({ phase: 'Preparando', done: 0, total: 1 });
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
        <h1>Preparando el catálogo</h1>
        <p>
          Primera vez: se extraen los modelos y texturas de los archivos del juego y se guardan en la caché del editor. Después
          se generarán las miniaturas de todos los objetos (se pueden regenerar desde la barra de herramientas).
        </p>
        {error ? (
          <>
            <p className="err">{error}</p>
            <button onClick={() => useUi.getState().setPhase('setup')}>Cambiar carpeta del juego</button>
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
