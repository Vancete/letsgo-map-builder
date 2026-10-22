// The tools used all the time (the rest is in the menu bar): undo, the gizmo's mode, snapping, the view, and the
// export to the game.
import { useEditor } from '../store';
import { exportMod, openLogic } from '../actions';

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const showGrid = useEditor((s) => s.showGrid);
  const topView = useEditor((s) => s.topView);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const e = useEditor.getState;

  return (
    <div className="toolbar">
      <span className="brand">Let's Go Map Builder</span>
      <button onClick={() => e().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
      <button onClick={() => e().redo()} disabled={!canRedo} title="Redo (Ctrl+Y)">↷</button>
      <div className="sep" />
      <button className={tool === 'translate' ? 'active' : ''} onClick={() => e().setTool('translate')} title="Move (W)">✥ Move</button>
      <button className={tool === 'rotate' ? 'active' : ''} onClick={() => e().setTool('rotate')} title="Rotate (E)">⟳ Rotate</button>
      <button className={tool === 'scale' ? 'active' : ''} onClick={() => e().setTool('scale')} title="Scale (R)">⤢ Scale</button>
      <button onClick={() => e().duplicateSelected()} disabled={!hasSel} title="Duplicate (Ctrl+D)">⧉</button>
      <button onClick={() => e().removeSelected()} disabled={!hasSel} title="Delete (Del)">🗑</button>
      <div className="sep" />
      <button className={snap.enabled ? 'active' : ''} onClick={() => e().setSnap({ enabled: !snap.enabled })} title="Snap to the grid (X)">
        🧲 Snap
      </button>
      <label title="Move step">
        <select value={snap.move} onChange={(ev) => e().setSnap({ move: Number(ev.target.value) })} disabled={!snap.enabled}>
          <option value={100}>Cell center</option>
          <option value={50}>½ cell</option>
          <option value={25}>¼ cell</option>
          <option value={10}>10 u</option>
        </select>
      </label>
      <label title="Rotation step">
        <select value={snap.rotate} onChange={(ev) => e().setSnap({ rotate: Number(ev.target.value) })} disabled={!snap.enabled}>
          <option value={90}>90°</option>
          <option value={45}>45°</option>
          <option value={15}>15°</option>
          <option value={5}>5°</option>
        </select>
      </label>
      <div className="sep" />
      <button className={showGrid ? 'active' : ''} onClick={() => e().toggleGrid()} title="Show the grid (G)">▦ Grid</button>
      <button className={topView ? 'active' : ''} onClick={() => e().toggleTopView()} title="Top view (T)">⬒ Top</button>
      <button onClick={() => window.dispatchEvent(new Event('lg:focus'))} title="Frame the selection (F)">◎</button>
      <div className="spacer" />
      <button onClick={() => openLogic()} title="Block editor: what happens when reading signs or stepping into zones (Ctrl+L)">
        🧩 Logic
      </button>
      <button className="primary" onClick={exportMod} title="Make a Let's Go Recomp mod with the map, reached by a teleport pad in Pallet Town (Ctrl+E)">
        🎮 Export to the game
      </button>
    </div>
  );
}
