import { useEditor } from '../store';
import { useUi } from '../ui';
import { changeGameFolder, exportMod, generateThumbs, newMap, openMap, rebuildCatalog, saveMap } from '../actions';

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const showGrid = useEditor((s) => s.showGrid);
  const topView = useEditor((s) => s.topView);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const thumbJob = useUi((s) => s.thumbJob);
  const e = useEditor.getState;

  return (
    <div className="toolbar">
      <span className="brand">Let's Go Map Builder</span>
      <button onClick={newMap} title="Nuevo mapa (Ctrl+N)">📄 Nuevo</button>
      <button onClick={() => openMap()} title="Abrir mapa (Ctrl+O)">📂 Abrir</button>
      <button onClick={() => saveMap(false)} title="Guardar (Ctrl+S)">💾 Guardar</button>
      <button onClick={() => saveMap(true)} title="Guardar como (Ctrl+Shift+S)">Guardar como</button>
      <button onClick={exportMod} title="Crear un mod de Let's Go Recomp con el mapa, al que se llega con un teletransportador desde Pueblo Paleta">🎮 Exportar al juego</button>
      <div className="sep" />
      <button onClick={() => e().undo()} disabled={!canUndo} title="Deshacer (Ctrl+Z)">↶</button>
      <button onClick={() => e().redo()} disabled={!canRedo} title="Rehacer (Ctrl+Y)">↷</button>
      <div className="sep" />
      <button className={tool === 'translate' ? 'active' : ''} onClick={() => e().setTool('translate')} title="Mover (W)">✥ Mover</button>
      <button className={tool === 'rotate' ? 'active' : ''} onClick={() => e().setTool('rotate')} title="Rotar (E)">⟳ Rotar</button>
      <button className={tool === 'scale' ? 'active' : ''} onClick={() => e().setTool('scale')} title="Escalar (R)">⤢ Escalar</button>
      <button onClick={() => e().duplicateSelected()} disabled={!hasSel} title="Duplicar (Ctrl+D)">⧉</button>
      <button onClick={() => e().removeSelected()} disabled={!hasSel} title="Eliminar (Supr)">🗑</button>
      <div className="sep" />
      <button className={snap.enabled ? 'active' : ''} onClick={() => e().setSnap({ enabled: !snap.enabled })} title="Ajustar a la rejilla (X)">
        🧲 Ajuste
      </button>
      <label title="Paso al mover">
        <select value={snap.move} onChange={(ev) => e().setSnap({ move: Number(ev.target.value) })} disabled={!snap.enabled}>
          <option value={100}>Centro de casilla</option>
          <option value={50}>½ casilla</option>
          <option value={25}>¼ casilla</option>
          <option value={10}>10 u</option>
        </select>
      </label>
      <label title="Paso al rotar">
        <select value={snap.rotate} onChange={(ev) => e().setSnap({ rotate: Number(ev.target.value) })} disabled={!snap.enabled}>
          <option value={90}>90°</option>
          <option value={45}>45°</option>
          <option value={15}>15°</option>
          <option value={5}>5°</option>
        </select>
      </label>
      <div className="sep" />
      <button className={showGrid ? 'active' : ''} onClick={() => e().toggleGrid()} title="Mostrar rejilla (G)">▦ Rejilla</button>
      <button className={topView ? 'active' : ''} onClick={() => e().toggleTopView()} title="Vista cenital (T)">⬒ Cenital</button>
      <button onClick={() => window.dispatchEvent(new Event('lg:focus'))} title="Encuadrar selección (F)">◎</button>
      <div className="spacer" />
      <button onClick={() => generateThumbs(true)} disabled={!!thumbJob} title="Volver a generar todas las miniaturas">
        🖼 Regenerar miniaturas
      </button>
      <button onClick={rebuildCatalog} title="Volver a extraer los modelos del juego">↻ Catálogo</button>
      <button onClick={changeGameFolder} title="Cambiar la carpeta del juego">⚙</button>
    </div>
  );
}
