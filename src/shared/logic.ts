// The map's logic, made with blocks in the editor (Blockly) and saved in the map as Blockly's own JSON. This reads that
// JSON (no Blockly needed: the export runs in a worker) into a small program the game script is generated from
// (amxgen.ts):
//
//   events      "Al leer el cartel X" (a sign), "Al pisar la zona X" (a trigger zone): each a list of statements
//   statements  show a text, set a variable, if / else if / else
//   expressions numbers and true/false (constants), variables, comparisons, and / or / not, + - ×
//
// Variables are the game's own saved values ("works", see amxgen.ts): numbers, with true = 1 and false = 0.

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'var'; id: string }
  | { k: 'cmp'; op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'; a: Expr; b: Expr }
  | { k: 'and' | 'or'; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'arith'; op: 'ADD' | 'MINUS' | 'MULTIPLY'; a: Expr; b: Expr };

export type Stmt =
  | { k: 'text'; text: string }
  | { k: 'set'; id: string; value: Expr }
  | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; otherwise: Stmt[] };

export interface Handler {
  event: 'read' | 'step';
  object: string; // the map object's id
  body: Stmt[];
}

export interface Program {
  handlers: Handler[];
  variables: { id: string; name: string }[];
  errors: string[];
}

// the block types (shared by the editor's definitions and this reader)
export const BLOCK = {
  onRead: 'lg_on_read',
  onStep: 'lg_on_step',
  showText: 'lg_show_text',
} as const;

// the Blockly JSON (Blockly.serialization.workspaces.save)
interface BlockJson {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson };
  extraState?: Record<string, unknown>;
  enabled?: boolean;
  disabledReasons?: string[];
}
export interface WorkspaceJson {
  blocks?: { blocks?: BlockJson[] };
  variables?: { id: string; name: string }[];
}

export function readProgram(ws: WorkspaceJson | null | undefined): Program {
  const errors: string[] = [];
  const variables = ws?.variables ?? [];
  const handlers: Handler[] = [];
  const input = (b: BlockJson, name: string) => b.inputs?.[name]?.block ?? b.inputs?.[name]?.shadow;
  const disabled = (b: BlockJson) => b.enabled === false || !!b.disabledReasons?.length;

  const expr = (b: BlockJson | undefined, where: string): Expr => {
    if (!b) {
      errors.push(`${where}: falta un valor`);
      return { k: 'num', v: 0 };
    }
    switch (b.type) {
      case 'math_number':
        return { k: 'num', v: Math.trunc(Number(b.fields?.NUM ?? 0)) || 0 };
      case 'logic_boolean':
        return { k: 'num', v: b.fields?.BOOL === 'TRUE' ? 1 : 0 };
      case 'variables_get':
        return { k: 'var', id: (b.fields?.VAR as { id: string }).id };
      case 'logic_compare':
        return { k: 'cmp', op: (b.fields?.OP as 'EQ') ?? 'EQ', a: expr(input(b, 'A'), where), b: expr(input(b, 'B'), where) };
      case 'logic_operation':
        return { k: b.fields?.OP === 'OR' ? 'or' : 'and', a: expr(input(b, 'A'), where), b: expr(input(b, 'B'), where) };
      case 'logic_negate':
        return { k: 'not', a: expr(input(b, 'BOOL'), where) };
      case 'math_arithmetic': {
        const op = b.fields?.OP as string;
        if (op !== 'ADD' && op !== 'MINUS' && op !== 'MULTIPLY') {
          errors.push(`${where}: operación no admitida (${op})`);
          return { k: 'num', v: 0 };
        }
        return { k: 'arith', op, a: expr(input(b, 'A'), where), b: expr(input(b, 'B'), where) };
      }
      default:
        errors.push(`${where}: bloque de valor no admitido (${b.type})`);
        return { k: 'num', v: 0 };
    }
  };

  const stmts = (first: BlockJson | undefined, where: string): Stmt[] => {
    const out: Stmt[] = [];
    for (let b = first; b; b = b.next?.block) {
      if (disabled(b)) continue;
      switch (b.type) {
        case BLOCK.showText:
          out.push({ k: 'text', text: String(b.fields?.TEXT ?? '') });
          break;
        case 'variables_set':
          out.push({ k: 'set', id: (b.fields?.VAR as { id: string }).id, value: expr(input(b, 'VALUE'), where) });
          break;
        case 'controls_if': {
          const n = 1 + Number(b.extraState?.elseIfCount ?? 0);
          const branches = Array.from({ length: n }, (_, i) => ({ cond: expr(input(b, `IF${i}`), where), body: stmts(input(b, `DO${i}`), where) }));
          out.push({ k: 'if', branches, otherwise: b.extraState?.hasElse ? stmts(input(b, 'ELSE'), where) : [] });
          break;
        }
        default:
          errors.push(`${where}: bloque no admitido (${b.type})`);
      }
    }
    return out;
  };

  for (const b of ws?.blocks?.blocks ?? []) {
    if (disabled(b)) continue;
    if (b.type !== BLOCK.onRead && b.type !== BLOCK.onStep) continue; // loose blocks: not run
    const object = String(b.fields?.[b.type === BLOCK.onRead ? 'SIGN' : 'ZONE'] ?? '');
    if (!object || object === 'NONE') {
      errors.push(`un evento sin ${b.type === BLOCK.onRead ? 'cartel' : 'zona'} elegido`);
      continue;
    }
    const event = b.type === BLOCK.onRead ? 'read' : 'step';
    if (handlers.some((h) => h.event === event && h.object === object)) errors.push('dos eventos para el mismo objeto: solo cuenta el primero');
    else handlers.push({ event, object, body: stmts(input(b, 'DO'), event === 'read' ? 'Al leer' : 'Al pisar') });
  }
  return { handlers, variables, errors };
}

// the variables a program uses (in use order)
export function usedVariables(p: Program): string[] {
  const used = new Set<string>();
  const ex = (e: Expr) => {
    if (e.k === 'var') used.add(e.id);
    else if (e.k === 'not') ex(e.a);
    else if ('a' in e && 'b' in e) {
      ex(e.a);
      ex(e.b);
    }
  };
  const st = (s: Stmt[]) =>
    s.forEach((x) => {
      if (x.k === 'set') {
        used.add(x.id);
        ex(x.value);
      } else if (x.k === 'if') {
        x.branches.forEach((b) => {
          ex(b.cond);
          st(b.body);
        });
        st(x.otherwise);
      }
    });
  p.handlers.forEach((h) => st(h.body));
  return [...used];
}
