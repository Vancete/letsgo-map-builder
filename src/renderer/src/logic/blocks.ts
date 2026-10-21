// The block editor's blocks (Blockly): the map's own (events on its objects, show a text) besides Blockly's logic,
// numbers and variables. shared/logic.ts reads what they save; keep both in step.
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as Es from 'blockly/msg/es';
import { FieldMultilineInput } from '@blockly/field-multilineinput';
import { BLOCK } from '@shared/logic';
import { SIGN_ASSET, TRIGGER_ASSET } from '@shared/types';
import { useEditor } from '../store';

Blockly.setLocale(Es as unknown as { [key: string]: string });

export const COLOR = { events: 35, text: 160, logic: 210, math: 230, vars: 330 };

// the map's objects of a kind, for a dropdown (an object deleted since: kept, marked)
function objectOptions(asset: string, current: () => string | null): () => Blockly.MenuOption[] {
  return () => {
    const objs = useEditor.getState().doc.objects.filter((o) => o.asset === asset);
    const opts: Blockly.MenuOption[] = objs.map((o) => [o.name, o.id]);
    const cur = current();
    if (cur && cur !== 'NONE' && !objs.some((o) => o.id === cur)) opts.push(['(borrado)', cur]);
    return opts.length ? opts : [['(no hay ninguno en el mapa)', 'NONE']];
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
        this.appendStatementInput('DO').appendField('hacer');
        this.setColour(COLOR.events);
        this.setTooltip(tip);
      },
    };
  };
  eventBlock(BLOCK.onRead, 'Al leer el cartel', SIGN_ASSET, 'SIGN', 'Cuando el jugador lee este cartel (A delante de él). Si el cartel tiene este bloque, su texto del inspector no se usa.');
  eventBlock(BLOCK.onStep, 'Al pisar la zona', TRIGGER_ASSET, 'ZONE', 'Cuando el jugador entra en esta zona de activación (una vez por visita al mapa).');
  Blockly.Blocks[BLOCK.showText] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('mostrar texto');
      this.appendDummyInput().appendField(new FieldMultilineInput('Escribe aquí el texto.'), 'TEXT');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(COLOR.text);
      this.setTooltip('Abre la ventana de mensaje con este texto. Dos líneas por ventana; una línea en blanco empieza otra ventana.');
    },
  };
}

// what the side panel offers
export const TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Eventos',
      colour: String(COLOR.events),
      contents: [
        { kind: 'block', type: BLOCK.onRead },
        { kind: 'block', type: BLOCK.onStep },
      ],
    },
    {
      kind: 'category',
      name: 'Mensajes',
      colour: String(COLOR.text),
      contents: [{ kind: 'block', type: BLOCK.showText }],
    },
    {
      kind: 'category',
      name: 'Condiciones',
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
      name: 'Constantes',
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
