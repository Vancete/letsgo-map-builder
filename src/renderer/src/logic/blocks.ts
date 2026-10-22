// The block editor's blocks (Blockly): the map's own (events on its objects, show a text) besides Blockly's logic,
// numbers and variables. shared/logic.ts reads what they save; keep both in step.
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { FieldMultilineInput } from '@blockly/field-multilineinput';
import { BLOCK } from '@shared/logic';
import { SIGN_ASSET, TRIGGER_ASSET } from '@shared/types';
import { useEditor } from '../store';

Blockly.setLocale(En as unknown as { [key: string]: string });

export const COLOR = { events: 35, text: 160, logic: 210, math: 230, vars: 330 };

// the map's objects of a kind, for a dropdown (an object deleted since: kept, marked)
function objectOptions(asset: string, current: () => string | null): () => Blockly.MenuOption[] {
  return () => {
    const objs = useEditor.getState().doc.objects.filter((o) => o.asset === asset);
    const opts: Blockly.MenuOption[] = objs.map((o) => [o.name, o.id]);
    const cur = current();
    if (cur && cur !== 'NONE' && !objs.some((o) => o.id === cur)) opts.push(['(deleted)', cur]);
    return opts.length ? opts : [['(none in the map)', 'NONE']];
  };
}

let defined = false;
export function defineBlocks() {
  if (defined) return;
  defined = true;
  const eventBlock = (type: string, label: string, asset: string, field: string, tip: string) => {
    Blockly.Blocks[type] = {
      init(this: Blockly.Block) {
        const dd = new Blockly.FieldDropdown(objectOptions(asset, () => (this.getFieldValue ? this.getFieldValue(field) : null)));
        this.appendDummyInput().appendField(label).appendField(dd, field);
        this.appendStatementInput('DO').appendField('do');
        this.setColour(COLOR.events);
        this.setTooltip(tip);
      },
    };
  };
  eventBlock(BLOCK.onRead, 'When reading the sign', SIGN_ASSET, 'SIGN', 'When the player reads this sign (A in front of it). If the sign has this block, its text in the inspector is not used.');
  eventBlock(BLOCK.onStep, 'When stepping into the zone', TRIGGER_ASSET, 'ZONE', 'When the player walks into this trigger zone (once per visit to the map).');
  Blockly.Blocks[BLOCK.showText] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('show text');
      this.appendDummyInput().appendField(new FieldMultilineInput('Write the text here.'), 'TEXT');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(COLOR.text);
      this.setTooltip('Opens the message window with this text. Two lines per window; an empty line starts another window.');
    },
  };
}

// what the side panel offers
export const TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Events',
      colour: String(COLOR.events),
      contents: [
        { kind: 'block', type: BLOCK.onRead },
        { kind: 'block', type: BLOCK.onStep },
      ],
    },
    {
      kind: 'category',
      name: 'Messages',
      colour: String(COLOR.text),
      contents: [{ kind: 'block', type: BLOCK.showText }],
    },
    {
      kind: 'category',
      name: 'Conditions',
      colour: String(COLOR.logic),
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
      ],
    },
    {
      kind: 'category',
      name: 'Constants',
      colour: String(COLOR.math),
      contents: [
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
        { kind: 'block', type: 'math_arithmetic', fields: { OP: 'ADD' } },
      ],
    },
    { kind: 'category', name: 'Variables', colour: String(COLOR.vars), custom: 'VARIABLE' },
  ],
};

export const DARK = Blockly.Theme.defineTheme('lgdark', {
  name: 'lgdark',
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: '#1b1d23',
    toolboxBackgroundColour: '#23262e',
    toolboxForegroundColour: '#d9dde6',
    flyoutBackgroundColour: '#2a2e37',
    flyoutForegroundColour: '#d9dde6',
    flyoutOpacity: 0.97,
    scrollbarColour: '#4a5060',
    insertionMarkerColour: '#ffffff',
    insertionMarkerOpacity: 0.3,
    cursorColour: '#f5c542',
  },
  fontStyle: { family: "'Segoe UI', system-ui, sans-serif", size: 12 }, // (a real family: Blockly measures text with it)
});
