// The map's logic as blocks (Blockly), over the whole window: events on the map's objects (read a sign, walk into a
// trigger zone), texts, variables and conditions. Blocks join or lie loose (loose ones don't run); wheel or the
// buttons zoom, dragging the background moves around. The workspace is saved in the map (doc.logic) as Blockly's JSON.
import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { useEditor } from '../store';
import { useUi } from '../ui';
import { BLOCK, readProgram, type WorkspaceJson } from '@shared/logic';
import { SIGN_ASSET } from '@shared/types';
import { DARK, TOOLBOX, defineBlocks } from '../logic/blocks';

export function LogicEditor() {
  const open = useUi((s) => s.logicOpen);
  if (!open) return null;
  return <LogicScreen />;
}

function LogicScreen() {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const close = () => useUi.setState({ logicOpen: false, logicFocus: null });

  useEffect(() => {
    defineBlocks();
    const w = Blockly.inject(host.current!, {
      toolbox: TOOLBOX,
      theme: DARK,
      renderer: 'zelos',
      trashcan: true,
      sounds: false,
      media: './blockly-media/', // (Blockly's icons, served by the editor: the page can't load them from the internet)
      grid: { spacing: 24, length: 2, colour: '#2c313b', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 2.5, minScale: 0.3, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    ws.current = w;
    const doc = useEditor.getState().doc;
    if (doc.logic) {
      try {
        Blockly.serialization.workspaces.load(doc.logic as object, w);
      } catch (e) {
        useUi.getState().notify(`Could not load the logic: ${(e as Error).message}`, true);
      }
    }
    setErrors(readProgram(doc.logic as WorkspaceJson).errors);

    // opened from an object: its event block (made if it has none), centered and selected
    const focus = useUi.getState().logicFocus;
    if (focus) {
      const obj = doc.objects.find((o) => o.id === focus);
      if (obj) {
        const type = obj.asset === SIGN_ASSET ? BLOCK.onRead : BLOCK.onStep;
        const field = obj.asset === SIGN_ASSET ? 'SIGN' : 'ZONE';
        let b = w.getTopBlocks(false).find((x) => x.type === type && x.getFieldValue(field) === obj.id);
        if (!b) {
          b = w.newBlock(type) as Blockly.BlockSvg;
          b.setFieldValue(obj.id, field);
          (b as Blockly.BlockSvg).initSvg();
          (b as Blockly.BlockSvg).render();
          const others = w.getTopBlocks(false).filter((x) => x !== b);
          const y = others.reduce((m, x) => Math.max(m, x.getRelativeToSurfaceXY().y + (x as Blockly.BlockSvg).getHeightWidth().height), 0);
          b.moveBy(40, others.length ? y + 40 : 40);
        }
        w.centerOnBlock(b.id);
        (b as Blockly.BlockSvg).select();
      }
    }

    // saved into the map as it changes (a step of undo per change, after a pause)
    let timer: number | undefined;
    const save = () => {
      const json = Blockly.serialization.workspaces.save(w);
      useEditor.getState().setLogic(json);
      setErrors(readProgram(json as WorkspaceJson).errors);
    };
    w.addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.isUiEvent) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 250);
    });
    const resize = new ResizeObserver(() => Blockly.svgResize(w));
    resize.observe(host.current!);
    return () => {
      window.clearTimeout(timer);
      save();
      resize.disconnect();
      w.dispose();
      ws.current = null;
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  return (
    <div className="logic-screen">
      <div className="logic-head">
        <b>Map logic</b>
        <span className="kv">
          Drag blocks from the left. Only what hangs from an event ("When reading the sign", "When stepping into the zone") runs;
          loose blocks don't. Wheel: zoom · drag the background to move around.
        </span>
        <div className="spacer" />
        <button onClick={() => ws.current?.cleanUp()} title="Lays the blocks out in a column, without overlapping">
          Tidy up
        </button>
        <button className="primary" onClick={close}>
          Back to the map (Esc)
        </button>
      </div>
      <div className="logic-host" ref={host} />
      {errors.length > 0 && (
        <div className="logic-errors">
          {errors.slice(0, 4).map((e, i) => (
            <div key={i}>⚠ {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
