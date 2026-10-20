import { useEditor } from '../store';

export function StatusBar() {
  const cell = useEditor((s) => s.hoverCell);
  const count = useEditor((s) => s.doc.objects.length);
  const sel = useEditor((s) => s.selection.length);
  const dirty = useEditor((s) => s.dirty);
  const filePath = useEditor((s) => s.filePath);
  const grid = useEditor((s) => s.doc.grid);
  return (
    <div className="status">
      <span>{cell ? `Casilla ${cell[0]}, ${cell[1]}` : 'Fuera de la rejilla'}</span>
      <span>
        Rejilla {grid.width}×{grid.depth} · {grid.cellSize} u
      </span>
      <span>{count} objetos</span>
      <span>{sel ? `${sel} seleccionados` : ''}</span>
      <span className="grow" />
      <span>{dirty ? '● Cambios sin guardar' : filePath ? 'Guardado' : ''}</span>
      <span>{filePath ?? ''}</span>
    </div>
  );
}
