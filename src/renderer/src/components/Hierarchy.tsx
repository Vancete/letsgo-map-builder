// Scene tree, as Unity's Hierarchy: objects nested under groups, drag to reparent or reorder.
import { useMemo, useState } from 'react';
import { useEditor } from '../store';
import { CATEGORY_LABELS, type MapObject } from '@shared/types';

const ICONS: Record<string, string> = {
  pc: '🏥', shop: '🏪', gym: '🏟', building: '🏠', tree: '🌳', grass: '🌿', flower: '🌼', ledge: '⛰', ground: '🟫', rock: '🪨',
  street: '🪑', fence: '🚧', door: '🚪', water: '💧', gimmick: '✨', zone: '🗺', other: '◆',
};

interface Node {
  obj: MapObject;
  children: Node[];
}

export function Hierarchy() {
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const assets = useEditor((s) => s.assets);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string | null; mode: 'into' | 'before' } | null>(null);
  const [filter, setFilter] = useState('');

  const roots = useMemo(() => {
    const byId = new Map<string, Node>(objects.map((o) => [o.id, { obj: o, children: [] }]));
    const out: Node[] = [];
    for (const o of objects) {
      const n = byId.get(o.id)!;
      const p = o.parent ? byId.get(o.parent) : undefined;
      (p ? p.children : out).push(n);
    }
    return out;
  }, [objects]);

  const sel = new Set(selection);
  const ed = useEditor.getState;
  const f = filter.trim().toLowerCase();

  const matches = (n: Node): boolean => !f || n.obj.name.toLowerCase().includes(f) || n.children.some(matches);

  const onDrop = (e: React.DragEvent, target: string | null, mode: 'into' | 'before') => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const id = e.dataTransfer.getData('application/x-lgobject');
    if (!id) return;
    const t = target ? objects.find((o) => o.id === target) : null;
    if (mode === 'into') ed().reparent(id, target, null);
    else ed().reparent(id, t?.parent ?? null, target);
  };

  const row = (n: Node, depth: number): React.ReactNode => {
    if (!matches(n)) return null;
    const o = n.obj;
    const open = !collapsed.has(o.id) || !!f;
    const asset = o.asset ? assets.get(o.asset) : null;
    const icon = o.asset ? ICONS[asset?.category ?? 'other'] ?? '◆' : '📁';
    const dt = dropTarget?.id === o.id ? dropTarget.mode : null;
    return (
      <div key={o.id}>
        <div
          className={`tree-row ${sel.has(o.id) ? 'selected' : ''} ${dt === 'into' ? 'drop-into' : ''} ${dt === 'before' ? 'drop-before' : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          title={asset ? `${asset.name} · ${CATEGORY_LABELS[asset.category]}${asset.zone ? ` · ${asset.zone}` : ''}` : o.asset ? 'Objeto fuera del catálogo' : 'Grupo'}
          draggable={renaming !== o.id}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-lgobject', o.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-lgobject')) return;
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setDropTarget({ id: o.id, mode: e.clientY - r.top < r.height * 0.3 ? 'before' : 'into' });
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => onDrop(e, o.id, dropTarget?.mode ?? 'into')}
          onClick={(e) => ed().select([o.id], e.ctrlKey || e.shiftKey)}
          onDoubleClick={() => setRenaming(o.id)}
        >
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              const c = new Set(collapsed);
              c.has(o.id) ? c.delete(o.id) : c.add(o.id);
              setCollapsed(c);
            }}
          >
            {n.children.length ? (open ? '▼' : '▶') : ''}
          </span>
          <span className="kind">{icon}</span>
          {renaming === o.id ? (
            <input
              autoFocus
              defaultValue={o.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== o.name) ed().updateObject(o.id, { name: e.target.value.trim() });
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <span className={`name ${o.visible ? '' : 'hidden-obj'}`}>{o.name}</span>
          )}
          <button
            className={`mini ${o.locked ? 'on' : ''}`}
            title={o.locked ? 'Desbloquear' : 'Bloquear (no se selecciona en la vista)'}
            onClick={(e) => {
              e.stopPropagation();
              ed().updateObject(o.id, { locked: !o.locked });
            }}
          >
            {o.locked ? '🔒' : '🔓'}
          </button>
          <button
            className={`mini ${!o.visible ? 'on' : ''}`}
            title={o.visible ? 'Ocultar' : 'Mostrar'}
            onClick={(e) => {
              e.stopPropagation();
              ed().updateObject(o.id, { visible: !o.visible });
            }}
          >
            {o.visible ? '👁' : '◌'}
          </button>
        </div>
        {open && n.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className="panel-head">
        <span>Escena</span>
        <span className="grow" />
        <button className="icon" title="Nuevo grupo con la selección (Ctrl+G)" onClick={() => ed().groupSelected()}>
          📁+
        </button>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <input type="search" placeholder="Buscar en la escena..." value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div
        className="panel-body"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-lgobject')) e.preventDefault();
        }}
        onDrop={(e) => onDrop(e, null, 'into')}
        onClick={(e) => e.target === e.currentTarget && ed().select([])}
      >
        <div className="tree" onClick={(e) => e.target === e.currentTarget && ed().select([])}>
          {roots.map((n) => row(n, 0))}
          {!objects.length && (
            <div className="empty">
              La escena está vacía.
              <br />
              Arrastra objetos desde el catálogo de abajo a la vista, o selecciona uno y haz clic en la vista para colocarlo.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
