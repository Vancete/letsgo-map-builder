import { useEffect, useRef } from 'react';
import { useEditor } from '../store';
import { SceneView } from '../three/SceneView';

let view: SceneView | null = null;
export const getView = () => view;

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useEditor((s) => s.armedAsset);
  const assets = useEditor((s) => s.assets);
  const topView = useEditor((s) => s.topView);
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);

  useEffect(() => {
    const ed = useEditor.getState;
    const v = new SceneView(ref.current!, {
      select: (ids, additive) => ed().select(ids, additive),
      beginEdit: () => ed().commit(),
      liveEdit: (patches) => ed().updateObjects(patches, false),
      place: (assetId, position) => {
        const id = ed().addObject(assetId, position);
        if (ed().armedAsset) ed().select([id]);
      },
      hoverCell: (cell) => ed().setHoverCell(cell),
    });
    view = v;
    const s = ed();
    v.sync(s.doc, s.selection);
    v.setTool(s.tool);
    v.setSnap(s.snap);
    v.setGridVisible(s.showGrid);
    v.setTopView(s.topView);
    v.focusSelection();
    const unsub = useEditor.subscribe((st, prev) => {
      if (st.doc !== prev.doc || st.selection !== prev.selection) v.sync(st.doc, st.selection);
      if (st.tool !== prev.tool) v.setTool(st.tool);
      if (st.snap !== prev.snap) v.setSnap(st.snap);
      if (st.showGrid !== prev.showGrid) v.setGridVisible(st.showGrid);
      if (st.topView !== prev.topView) v.setTopView(st.topView);
      if (st.armedAsset !== prev.armedAsset) v.setArmed(st.armedAsset);
    });
    const focus = () => v.focusSelection();
    window.addEventListener('lg:focus', focus);
    return () => {
      unsub();
      window.removeEventListener('lg:focus', focus);
      v.dispose();
      view = null;
    };
  }, []);

  const armedName = armed ? assets.get(armed)?.name : null;
  return (
    <div className="view" ref={ref}>
      <div className="view-overlay">
        <span className="chip">{topView ? 'Cenital' : 'Perspectiva'}</span>
        <span className="chip">
          {tool === 'translate' ? 'Mover' : tool === 'rotate' ? 'Rotar' : 'Escalar'}
          {snap.enabled ? ' · ajuste' : ''}
        </span>
        {armedName && (
          <span className="chip" style={{ borderColor: 'var(--accent)' }}>
            Colocando: <b>{armedName}</b> — clic para poner, Esc para terminar
          </span>
        )}
      </div>
      <div className="view-help">
        Clic: seleccionar · Botón derecho: orbitar · Central: desplazar · Rueda: zoom
        <br />
        W/E/R mover/rotar/escalar · Q girar 90° · Flechas: mover una casilla · F encuadrar · T cenital
      </div>
    </div>
  );
}
