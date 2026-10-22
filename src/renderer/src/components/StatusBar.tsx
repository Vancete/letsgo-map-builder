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
      <span>{cell ? `Cell ${cell[0]}, ${cell[1]}` : 'Outside the grid'}</span>
      <span>
        Grid {grid.width}×{grid.depth} · {grid.cellSize} u
      </span>
      <span>{count} objects</span>
      <span>{sel ? `${sel} selected` : ''}</span>
      <span className="grow" />
      <span>{dirty ? '● Unsaved changes' : filePath ? 'Saved' : ''}</span>
      <span>{filePath ?? ''}</span>
    </div>
  );
}
