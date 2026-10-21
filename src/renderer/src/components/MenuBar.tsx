// The window's menu bar: Archivo, Editar, Ver, Catálogo, Ayuda. Everything the editor can do is here (with its
// shortcut); the toolbar below keeps only the tools used all the time.
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { useUi } from '../ui';
import { changeGameFolder, confirmDiscard, exportMod, generateThumbs, newMap, openMap, rebuildCatalog, saveMap } from '../actions';

type Item =
  | { sep: true }
  | { label: string; keys?: string; action?: () => void; disabled?: boolean; checked?: boolean; sub?: Item[] };

const ed = useEditor.getState;

function rotateSelection() {
  const s = ed();
  s.updateObjects(
    s.selection.map((id) => {
      const o = s.doc.objects.find((x) => x.id === id)!;
      return { id, patch: { rotation: [o.rotation[0], (o.rotation[1] + 90) % 360, o.rotation[2]] as [number, number, number] } };
    }),
  );
}

function showControls() {
  useUi
    .getState()
    .ask(
      'Controles',
      [
        'Clic: seleccionar (Ctrl/Mayús: añadir a la selección)',
        'Botón derecho / central / rueda: orbitar / desplazar / zoom',
        'W / E / R: mover / rotar / escalar · Q: girar 90°',
        'Flechas, RePág/AvPág: mover una casilla (Mayús: ¼), subir/bajar',
        'X: ajuste a la rejilla · G: rejilla · T: vista cenital · F: encuadrar',
        'Ctrl+D duplicar · Ctrl+G agrupar · Supr eliminar · Ctrl+A seleccionar todo',
        'Ctrl+Z / Ctrl+Y: deshacer / rehacer',
        'Ctrl+N / O / S / Mayús+S: nuevo / abrir / guardar / guardar como · Ctrl+E: exportar al juego',
      ].join('\n'),
      [{ label: 'Cerrar', value: 'ok', primary: true }],
    );
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const showGrid = useEditor((s) => s.showGrid);
  const topView = useEditor((s) => s.topView);
  const snap = useEditor((s) => s.snap);
  const thumbJob = useUi((s) => s.thumbJob);
  const fillTexture = useEditor((s) => s.fillTexture);

  useEffect(() => {
    if (!open) return;
    window.api.getSettings().then((s) => setRecent(s.recent ?? []));
    const close = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const menus: { name: string; items: Item[] }[] = [
    {
      name: 'Archivo',
      items: [
        { label: 'Nuevo mapa', keys: 'Ctrl+N', action: newMap },
        { label: 'Abrir…', keys: 'Ctrl+O', action: () => openMap() },
        {
          label: 'Abrir reciente',
          disabled: !recent.length,
          sub: recent.map((p) => ({ label: p.split(/[\\/]/).pop() ?? p, keys: p.length > 60 ? `…${p.slice(-57)}` : p, action: () => openMap(p) })),
        },
        { sep: true },
        { label: 'Guardar', keys: 'Ctrl+S', action: () => saveMap(false) },
        { label: 'Guardar como…', keys: 'Ctrl+Mayús+S', action: () => saveMap(true) },
        { sep: true },
        { label: 'Exportar al juego…', keys: 'Ctrl+E', action: exportMod },
        { sep: true },
        { label: 'Salir', action: async () => (await confirmDiscard()) && window.api.closeApp() },
      ],
    },
    {
      name: 'Editar',
      items: [
        { label: 'Deshacer', keys: 'Ctrl+Z', action: () => ed().undo(), disabled: !canUndo },
        { label: 'Rehacer', keys: 'Ctrl+Y', action: () => ed().redo(), disabled: !canRedo },
        { sep: true },
        { label: 'Duplicar', keys: 'Ctrl+D', action: () => ed().duplicateSelected(), disabled: !hasSel },
        { label: 'Agrupar', keys: 'Ctrl+G', action: () => ed().groupSelected(), disabled: !hasSel },
        { label: 'Girar 90°', keys: 'Q', action: rotateSelection, disabled: !hasSel },
        { label: 'Eliminar', keys: 'Supr', action: () => ed().removeSelected(), disabled: !hasSel },
        { sep: true },
        { label: 'Seleccionar todo', keys: 'Ctrl+A', action: () => ed().select(ed().doc.objects.map((o) => o.id)) },
        { label: 'Deseleccionar', keys: 'Esc', action: () => ed().select([]), disabled: !hasSel },
        { sep: true },
        { label: 'Mover', keys: 'W', action: () => ed().setTool('translate') },
        { label: 'Rotar', keys: 'E', action: () => ed().setTool('rotate') },
        { label: 'Escalar', keys: 'R', action: () => ed().setTool('scale') },
        { sep: true },
        { label: `Rellenar el suelo con ${fillTexture}`, action: () => ed().fillGround(fillTexture) },
      ],
    },
    {
      name: 'Ver',
      items: [
        { label: 'Rejilla', keys: 'G', checked: showGrid, action: () => ed().toggleGrid() },
        { label: 'Vista cenital', keys: 'T', checked: topView, action: () => ed().toggleTopView() },
        { label: 'Encuadrar la selección', keys: 'F', action: () => window.dispatchEvent(new Event('lg:focus')) },
        { sep: true },
        { label: 'Ajustar a la rejilla', keys: 'X', checked: snap.enabled, action: () => ed().setSnap({ enabled: !snap.enabled }) },
      ],
    },
    {
      name: 'Catálogo',
      items: [
        { label: 'Regenerar miniaturas', action: () => generateThumbs(true), disabled: !!thumbJob },
        { label: 'Reconstruir el catálogo…', action: rebuildCatalog },
        { sep: true },
        { label: 'Cambiar la carpeta del juego…', action: changeGameFolder },
      ],
    },
    {
      name: 'Ayuda',
      items: [{ label: 'Controles', action: showControls }],
    },
  ];

  const run = (it: Item) => {
    if ('sep' in it || it.disabled || it.sub) return;
    setOpen(null);
    it.action?.();
  };

  const renderItems = (items: Item[]) =>
    items.map((it, i) =>
      'sep' in it ? (
        <div key={i} className="menu-sep" />
      ) : (
        <div key={i} className={`menu-item${it.disabled ? ' disabled' : ''}${it.sub ? ' has-sub' : ''}`} onClick={() => run(it)}>
          <span className="check">{it.checked ? '✓' : ''}</span>
          <span className="label">{it.label}</span>
          {it.keys && !it.sub && <span className="keys">{it.keys}</span>}
          {it.sub && <span className="keys">▸</span>}
          {it.sub && !it.disabled && <div className="menu-drop sub">{renderItems(it.sub)}</div>}
        </div>
      ),
    );

  return (
    <div className="menubar" ref={bar}>
      {menus.map((m) => (
        <div key={m.name} className={`menu${open === m.name ? ' open' : ''}`}>
          <button className="menu-title" onClick={() => setOpen(open === m.name ? null : m.name)} onMouseEnter={() => open && setOpen(m.name)}>
            {m.name}
          </button>
          {open === m.name && <div className="menu-drop">{renderItems(m.items)}</div>}
        </div>
      ))}
    </div>
  );
}
