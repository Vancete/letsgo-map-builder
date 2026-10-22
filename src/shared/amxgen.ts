// The zone script of an exported map, generated from its signs and its logic (logic.ts).
//
// Base: Pallet Town's script (bin/script/amx/town001.amx), for its message functions. Our code is appended after its
// code (calls and jumps in Pawn are relative, and data is addressed from the data section's start, so nothing in it
// moves), with a new main function (the entry point, cip) that compares the event's hash (global 0) with each of ours
// and calls its handler. One native is added to its table (WorkSet), after the existing ones.
//
// Pawn AMX here: 64-bit cells; a function is PROC .. RETN, its arguments pushed last-to-first and then their size in
// bytes; CALL, JUMP and the conditional jumps take the distance from the instruction itself; packed opcodes (162 on)
// carry their operand in the high 32 bits. Expressions leave their value in PRI; a binary operator gets the left side
// in ALT (pushed, then popped) and the right side in PRI.
import { amxCompact, amxExpand } from './signs.ts';
import type { Expr, Stmt } from './logic.ts';

const OP = {
  MOVE_ALT: 34n, PUSH_PRI: 36n, PUSH_C: 39n, POP_ALT: 43n, PROC: 46n, RETN: 48n, CALL: 49n, JUMP: 51n, JZER: 53n,
  JNEQ: 56n, CONST_PRI: 11n, CONST_ALT: 12n, SMUL: 72n, ADD: 78n, NOT: 84n, NEG: 85n, ZERO_PRI: 89n, EQ: 95n, NEQ: 96n,
  SLESS: 101n, SLEQ: 102n, SGRTR: 103n, SGEQ: 104n, SYSREQ_N: 135n, LOAD_P_PRI: 162n, CONST_P_PRI: 171n, PUSH_P_C: 188n,
};

// town001.amx's functions we call (byte addresses in its code, checked before use)
const FN_SIGN_MESSAGE = 0x1d80; // (label, window, flags): turn to the inspected object, show the message, wait, close
const FN_MESSAGE = 0xf40; // (label, 1, 0xf, window, flags | 4): open the message window
const FN_WAIT = 0xe80; // (1): wait for the message to be read
const FN_CLOSE = 0xdb8; // (): close the message window
const NATIVE_WORKGET = 0x24; // WorkGet(hash) -> value
const WINDOW_SIGN = 0xe; // the signboard window (Pallet Town's town sign)
const WINDOW_TALK = 0xb; // the window of Pallet Town's mailboxes

// native names are hashed: h = h * 0x83 ^ byte (32 bits)
export function nativeHash(name: string): number {
  let h = 0;
  for (const c of new TextEncoder().encode(name)) h = (Math.imul(h, 0x83) ^ c) >>> 0;
  return h;
}

const packed = (op: bigint, param: number) => BigInt.asUintN(64, (BigInt(param) << 32n) | op);
const cell = (v: bigint | number) => BigInt.asUintN(64, BigInt(v));

class Asm {
  cells: bigint[] = [];
  private labels = new Map<string, number>();
  private fixups: { instr: number; label: string }[] = [];
  private n = 0;
  readonly base: number; // cell index of the first cell, in the code
  constructor(base: number) {
    this.base = base;
  }
  addr(i = this.cells.length) {
    return (this.base + i) * 8;
  }
  emit(...c: bigint[]) {
    this.cells.push(...c);
  }
  label(name: string) {
    this.labels.set(name, this.cells.length);
  }
  fresh(prefix: string) {
    return `${prefix}${this.n++}`;
  }
  jump(op: bigint, label: string) {
    this.fixups.push({ instr: this.cells.length, label });
    this.emit(op, 0n);
  }
  call(target: number) {
    const at = this.addr();
    this.emit(OP.CALL, cell(target - at));
  }
  num(v: number) {
    if (v >= -0x80000000 && v <= 0x7fffffff) this.emit(packed(OP.CONST_P_PRI, v));
    else this.emit(OP.CONST_PRI, cell(v));
  }
  push(v: number | bigint) {
    if (typeof v === 'number' && v >= -0x80000000 && v <= 0x7fffffff) this.emit(packed(OP.PUSH_P_C, v));
    else this.emit(OP.PUSH_C, cell(v));
  }
  resolve() {
    for (const f of this.fixups) {
      const t = this.labels.get(f.label);
      if (t === undefined) throw new Error(`amxgen: label ${f.label}`);
      this.cells[f.instr + 1] = cell((t - f.instr) * 8);
    }
  }
}

export interface ScriptHandler {
  event: bigint; // the hash the game puts in global 0
  kind: 'sign' | 'step'; // a sign turns the player towards it
  body: Stmt[];
  arm?: bigint; // a work set to 1 before anything else (a trigger's "already fired")
}

export interface ScriptContext {
  label(text: string): bigint; // a message's label hash (its text goes to the zone's message file)
  variable(id: string): bigint; // a variable's work hash
}

export function buildZoneScript(town001: Uint8Array, handlers: ScriptHandler[], ctx: ScriptContext): Uint8Array {
  const { header, cells } = amxExpand(town001);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const cod = hv.getUint32(12, true);
  const dat = hv.getUint32(16, true);
  const codeCells = (dat - cod) / 8;
  // the functions we call are where we expect them
  const at = (a: number) => cells[a / 8];
  if (at(FN_SIGN_MESSAGE) !== OP.PROC || at(FN_MESSAGE) !== OP.PROC || at(FN_WAIT) !== OP.PROC || at(FN_CLOSE) !== OP.PROC)
    throw new Error('Pallet Town\'s script is not the expected one (another version of the game)');
  const natives = (hv.getUint32(40, true) - hv.getUint32(36, true)) / 12;
  if (natives !== 38) throw new Error('Pallet Town\'s script is not the expected one (natives)');
  const NATIVE_WORKSET = natives; // added below

  const a = new Asm(codeCells);
  const expr = (e: Expr) => {
    switch (e.k) {
      case 'num':
        a.num(e.v);
        break;
      case 'var':
        a.push(ctx.variable(e.id));
        a.emit(OP.SYSREQ_N, cell(NATIVE_WORKGET), 8n);
        break;
      case 'not':
        expr(e.a);
        a.emit(OP.NOT);
        break;
      case 'and':
      case 'or': {
        const short = a.fresh('sc'), end = a.fresh('se');
        expr(e.a);
        if (e.k === 'and') a.jump(OP.JZER, short);
        else {
          const next = a.fresh('sn');
          a.jump(OP.JZER, next);
          a.num(1);
          a.jump(OP.JUMP, end);
          a.label(next);
        }
        expr(e.b);
        a.jump(OP.JZER, short);
        a.num(1);
        a.jump(OP.JUMP, end);
        a.label(short);
        a.emit(OP.ZERO_PRI);
        a.label(end);
        break;
      }
      case 'cmp':
      case 'arith': {
        expr(e.a);
        a.emit(OP.PUSH_PRI);
        expr(e.b);
        if (e.k === 'arith' && e.op === 'MINUS') a.emit(OP.NEG);
        a.emit(OP.POP_ALT);
        const ops = { EQ: OP.EQ, NEQ: OP.NEQ, LT: OP.SLESS, LTE: OP.SLEQ, GT: OP.SGRTR, GTE: OP.SGEQ, ADD: OP.ADD, MINUS: OP.ADD, MULTIPLY: OP.SMUL };
        a.emit(ops[e.op]); // (compare: PRI = ALT <op> PRI)
        break;
      }
    }
  };
  const stmts = (list: Stmt[], kind: 'sign' | 'step') => {
    for (const s of list) {
      if (s.k === 'text') {
        const label = ctx.label(s.text);
        if (kind === 'sign') {
          a.push(0);
          a.push(WINDOW_SIGN);
          a.push(label);
          a.push(0x18);
          a.call(FN_SIGN_MESSAGE);
        } else {
          a.push(4);
          a.push(WINDOW_TALK);
          a.push(0xf);
          a.push(1);
          a.push(label);
          a.push(0x28);
          a.call(FN_MESSAGE);
          a.push(1);
          a.push(8);
          a.call(FN_WAIT);
          a.push(0);
          a.call(FN_CLOSE);
        }
      } else if (s.k === 'set') {
        expr(s.value);
        a.emit(OP.PUSH_PRI);
        a.push(ctx.variable(s.id));
        a.emit(OP.SYSREQ_N, cell(NATIVE_WORKSET), 16n); // WorkSet(hash, value)
      } else {
        const end = a.fresh('ie');
        for (const br of s.branches) {
          const next = a.fresh('in');
          expr(br.cond);
          a.jump(OP.JZER, next);
          stmts(br.body, kind);
          a.jump(OP.JUMP, end);
          a.label(next);
        }
        stmts(s.otherwise, kind);
        a.label(end);
      }
    }
  };

  // the handlers
  const entry: number[] = [];
  for (const h of handlers) {
    entry.push(a.addr());
    a.emit(OP.PROC);
    if (h.arm !== undefined) {
      a.push(1);
      a.push(h.arm);
      a.emit(OP.SYSREQ_N, cell(NATIVE_WORKSET), 16n);
    }
    stmts(h.body, h.kind);
    a.emit(OP.ZERO_PRI, OP.RETN);
  }
  // main: which event?
  const main = a.addr();
  a.emit(OP.PROC);
  handlers.forEach((h, i) => {
    const next = a.fresh('m');
    a.emit(packed(OP.LOAD_P_PRI, 0));
    a.emit(OP.CONST_ALT, cell(h.event));
    a.jump(OP.JNEQ, next);
    a.push(0);
    a.call(entry[i]);
    a.jump(OP.JUMP, 'end');
    a.label(next);
  });
  a.label('end');
  a.emit(OP.ZERO_PRI, OP.RETN);
  a.resolve();
  void OP.MOVE_ALT;

  // the header with one more native (WorkSet), every table after the natives and every section moved by 12 bytes
  const lib = hv.getUint32(40, true);
  const nh = new Uint8Array(header.length + 12);
  nh.set(header.subarray(0, lib));
  nh.set(header.subarray(lib), lib + 12);
  const nv = new DataView(nh.buffer);
  nv.setBigUint64(lib, 0n, true);
  nv.setUint32(lib + 8, nativeHash('WorkSet'), true);
  const grow = a.cells.length * 8;
  for (const off of [40, 44, 48, 52, 56]) nv.setUint32(off, nv.getUint32(off, true) + 12, true); // libraries, pubvars, tags, names, overlays
  nv.setUint32(12, cod + 12, true);
  nv.setUint32(16, dat + 12 + grow, true);
  nv.setUint32(20, nv.getUint32(20, true) + 12 + grow, true); // heap
  nv.setUint32(24, nv.getUint32(24, true) + 12 + grow, true); // stack top
  nv.setUint32(28, main, true); // the entry point (an address in the code)
  return amxCompact(nh, [...cells.slice(0, codeCells), ...a.cells, ...cells.slice(codeCells)]);
}
