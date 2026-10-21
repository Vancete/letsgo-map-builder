import { useEffect, useRef, useState } from 'react';
import { useEditor } from './store';
import { useUi } from './ui';
import { confirmDiscard, exportMod, generateThumbs, newMap, openLogic, openMap, saveMap } from './actions';
import { LogicEditor } from './components/LogicEditor';
import { SetupScreen, BuildScreen } from './components/Setup';
import { Toolbar } from './components/Toolbar';
import { MenuBar } from './components/MenuBar';
import { Hierarchy } from './components/Hierarchy';
import { Viewport } from './components/Viewport';
import { Inspector } from './components/Inspector';
import { AssetBrowser } from './components/AssetBrowser';
import { StatusBar } from './components/StatusBar';
import { Modals } from './components/Modals';

export function App() {
  const phase = useUi((s) => s.phase);

  // boot: game folder -> catalog -> editor
  useEffect(() => {
    (async () => {
      const s = await window.api.getSettings();
      if (!s.gamePath || !(await window.api.validateGame(s.gamePath))) return useUi.getState().setPhase('setup');
      const cat = await window.api.getCatalog();
      if (!cat) return useUi.getState().setPhase('building');
      useEditor.getState().setCatalog(cat);
      useUi.getState().setPhase('ready');
    })();
  }, []);

  useEffect(() => {
    if (phase === 'ready') generateThumbs(false);
  }, [phase]);

  // window title and closing with unsaved changes
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor((s) => s.dirty);
  useEffect(() => {
    window.api.setTitle(`${dirty ? '● ' : ''}${name} — Let's Go Map Builder`);
  }, [name, dirty]);
  useEffect(
    () =>
      window.api.onCloseRequested(async () => {
        if (await confirmDiscard()) window.api.closeApp();
      }),
    [],
  );

  return (
    <>
      {phase === 'loading' && <div className="screen" />}
      {phase === 'setup' && <SetupScreen />}
      {phase === 'building' && <BuildScreen />}
      {phase === 'ready' && <Editor />}
      {phase === 'ready' && <LogicEditor />}
      <Modals />
    </>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().logicOpen) return; // the block editor has its own keys
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const s = useEditor.getState();
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 's') {
          e.preventDefault();
          saveMap(e.shiftKey);
        } else if (k === 'o') {
          e.preventDefault();
          openMap();
        } else if (k === 'n') {
          e.preventDefault();
          newMap();
        } else if (k === 'e') {
          e.preventDefault();
          exportMod();
        } else if (k === 'l') {
          e.preventDefault();
          openLogic();
        } else if (typing) return;
        else if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          s.undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          s.redo();
        } else if (k === 'd') {
          e.preventDefault();
          s.duplicateSelected();
        } else if (k === 'g') {
          e.preventDefault();
          s.groupSelected();
        } else if (k === 'a') {
          e.preventDefault();
          s.select(s.doc.objects.map((o) => o.id));
        }
        return;
      }
      if (typing) return;
      if (k === 'w') s.setTool('translate');
      else if (k === 'e') s.setTool('rotate');
      else if (k === 'r') s.setTool('scale');
      else if (k === 'delete' || k === 'backspace') s.removeSelected();
      else if (k === 'escape') {
        if (s.armedAsset) s.arm(null);
        else s.select([]);
      } else if (k === 'g') s.toggleGrid();
      else if (k === 't') s.toggleTopView();
      else if (k === 'x') s.setSnap({ enabled: !s.snap.enabled });
      else if (k === 'f') window.dispatchEvent(new Event('lg:focus'));
      else if (k === 'q' && s.selection.length) {
        // rotate the selection 90 degrees around Y
        s.updateObjects(
          s.selection.map((id) => {
            const o = s.doc.objects.find((x) => x.id === id)!;
            return { id, patch: { rotation: [o.rotation[0], (o.rotation[1] + 90) % 360, o.rotation[2]] as [number, number, number] } };
          }),
        );
      } else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup', 'pagedown'].includes(k) && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? s.doc.grid.cellSize / 4 : s.doc.grid.cellSize;
        const d: [number, number, number] =
          k === 'arrowleft' ? [-step, 0, 0] : k === 'arrowright' ? [step, 0, 0] : k === 'arrowup' ? [0, 0, -step] : k === 'arrowdown' ? [0, 0, step] : k === 'pageup' ? [0, step / 4, 0] : [0, -step / 4, 0];
        s.updateObjects(
          s.selection.map((id) => {
            const o = s.doc.objects.find((x) => x.id === id)!;
            return { id, patch: { position: [o.position[0] + d[0], o.position[1] + d[1], o.position[2] + d[2]] as [number, number, number] } };
          }),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function readLayout() {
  try {
    return { left: 260, right: 310, bottom: 250, ...JSON.parse(localStorage.getItem('layout') ?? '{}') };
  } catch {
    return { left: 260, right: 310, bottom: 250 };
  }
}

function Editor() {
  useShortcuts();
  const [layout, setLayout] = useState(readLayout);
  const drag = useRef<{ which: 'left' | 'right' | 'bottom'; start: number; orig: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const delta = d.which === 'bottom' ? d.start - e.clientY : d.which === 'left' ? e.clientX - d.start : d.start - e.clientX;
      const min = d.which === 'bottom' ? 120 : 180;
      const max = d.which === 'bottom' ? window.innerHeight * 0.6 : window.innerWidth * 0.4;
      setLayout((l: typeof layout) => ({ ...l, [d.which]: Math.max(min, Math.min(max, d.orig + delta)) }));
    };
    const up = () => {
      if (drag.current) {
        drag.current = null;
        setLayout((l: typeof layout) => {
          try {
            localStorage.setItem('layout', JSON.stringify(l));
          } catch {
            /* storage unavailable */
          }
          return l;
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const start = (which: 'left' | 'right' | 'bottom') => (e: React.PointerEvent) => {
    drag.current = { which, start: which === 'bottom' ? e.clientY : e.clientX, orig: layout[which] };
  };

  return (
    <div
      className="app"
      style={
        {
          '--left-w': `${layout.left}px`,
          '--right-w': `${layout.right}px`,
          '--browser-h': `${layout.bottom}px`,
        } as React.CSSProperties
      }
    >
      <MenuBar />
      <Toolbar />
      <div className="panel left" style={{ position: 'relative' }}>
        <Hierarchy />
        <div className="splitter-v" style={{ right: -3 }} onPointerDown={start('left')} />
      </div>
      <Viewport />
      <div className="panel right" style={{ position: 'relative' }}>
        <div className="splitter-v" style={{ left: -3 }} onPointerDown={start('right')} />
        <Inspector />
      </div>
      <div className="panel bottom">
        <div className="splitter-h" onPointerDown={start('bottom')} />
        <AssetBrowser />
      </div>
      <StatusBar />
    </div>
  );
}
