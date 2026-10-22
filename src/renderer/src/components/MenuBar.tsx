// The window's menu bar: File, Edit, View, Catalog, Help. Everything the editor can do is here (with its
// shortcut); the toolbar below keeps only the tools used all the time.
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { useUi } from '../ui';
import { changeGameFolder, confirmDiscard, exportMod, generateThumbs, newMap, openLogic, openMap, rebuildCatalog, saveMap } from '../actions';

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
      'Controls',
      [
        'Click: select (Ctrl/Shift: add to the selection)',
        'Right / middle button / wheel: orbit / pan / zoom',
        'W / E / R: move / rotate / scale · Q: turn 90°',
        'Arrows, PgUp/PgDn: move one cell (Shift: ¼), up/down',
        'X: grid snapping · G: grid · T: top view · F: frame the selection',
        'Ctrl+D duplicate · Ctrl+G group · Del delete · Ctrl+A select all',
        'Ctrl+Z / Ctrl+Y: undo / redo',
        'Ctrl+N / O / S / Shift+S: new / open / save / save as · Ctrl+E: export to the game · Ctrl+L: logic',
      ].join('\n'),
      [{ label: 'Close', value: 'ok', primary: true }],
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
      name: 'File',
      items: [
        { label: 'New map', keys: 'Ctrl+N', action: newMap },
        { label: 'Open…', keys: 'Ctrl+O', action: () => openMap() },
        {
          label: 'Open recent',
          disabled: !recent.length,
          sub: recent.map((p) => ({ label: p.split(/[\\/]/).pop() ?? p, keys: p.length > 60 ? `…${p.slice(-57)}` : p, action: () => openMap(p) })),
        },
        { sep: true },
        { label: 'Save', keys: 'Ctrl+S', action: () => saveMap(false) },
        { label: 'Save as…', keys: 'Ctrl+Shift+S', action: () => saveMap(true) },
        { sep: true },
        { label: 'Export to the game…', keys: 'Ctrl+E', action: exportMod },
        { sep: true },
        { label: 'Quit', action: async () => (await confirmDiscard()) && window.api.closeApp() },
      ],
    },
    {
      name: 'Edit',
      items: [
        { label: 'Undo', keys: 'Ctrl+Z', action: () => ed().undo(), disabled: !canUndo },
        { label: 'Redo', keys: 'Ctrl+Y', action: () => ed().redo(), disabled: !canRedo },
        { sep: true },
        { label: 'Duplicate', keys: 'Ctrl+D', action: () => ed().duplicateSelected(), disabled: !hasSel },
        { label: 'Group', keys: 'Ctrl+G', action: () => ed().groupSelected(), disabled: !hasSel },
        { label: 'Turn 90°', keys: 'Q', action: rotateSelection, disabled: !hasSel },
        { label: 'Delete', keys: 'Del', action: () => ed().removeSelected(), disabled: !hasSel },
        { sep: true },
        { label: 'Select all', keys: 'Ctrl+A', action: () => ed().select(ed().doc.objects.map((o) => o.id)) },
        { label: 'Select none', keys: 'Esc', action: () => ed().select([]), disabled: !hasSel },
        { sep: true },
        { label: 'Move', keys: 'W', action: () => ed().setTool('translate') },
        { label: 'Rotate', keys: 'E', action: () => ed().setTool('rotate') },
        { label: 'Scale', keys: 'R', action: () => ed().setTool('scale') },
        { sep: true },
        { label: `Fill the ground with ${fillTexture}`, action: () => ed().fillGround(fillTexture) },
      ],
    },
    {
      name: 'View',
      items: [
        { label: 'Grid', keys: 'G', checked: showGrid, action: () => ed().toggleGrid() },
        { label: 'Top view', keys: 'T', checked: topView, action: () => ed().toggleTopView() },
        { label: 'Frame the selection', keys: 'F', action: () => window.dispatchEvent(new Event('lg:focus')) },
        { sep: true },
        { label: 'Map logic (blocks)…', keys: 'Ctrl+L', action: () => openLogic() },
        { sep: true },
        { label: 'Snap to the grid', keys: 'X', checked: snap.enabled, action: () => ed().setSnap({ enabled: !snap.enabled }) },
      ],
    },
    {
      name: 'Catalog',
      items: [
        { label: 'Make thumbnails again', action: () => generateThumbs(true), disabled: !!thumbJob },
        { label: 'Rebuild the catalog…', action: rebuildCatalog },
        { sep: true },
        { label: 'Change the game folder…', action: changeGameFolder },
      ],
    },
    {
      name: 'Help',
      items: [{ label: 'Controls', action: showControls }],
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
