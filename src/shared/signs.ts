// Signs the player reads with A, as the game's own (Pallet Town's town sign and mailboxes):
//
//  - Placement list 17 of a zone holds what can be inspected: an object with its position, a box to face (80 x 100 x
//    50, turned to the side it is read from) and, in its transform's field 11, the hash of a script event.
//  - Inspecting it runs the zone's script (bin/script/amx/<zone>.amx) with that hash in its global 0. The script's main
//    function switches on it and calls a function that shows a message: the message's label (FNV-1a 64 of e.g.
//    "msg_town001_kanban_01") goes to a common function that turns the player towards the object and opens the
//    message window (natives GetTargetFieldObjectID, MsgWin_, ABKeyWait_...).
//  - The messages are in bin/message/<language>/script/<zone>.dat (labels in .tbl); the test maps have theirs
//    (registered in bin/message/asset.tbl), so a map in a test slot can write its own.
//
// The scripts are Pawn AMX, 64-bit cells, in "compact" encoding (each cell as 7-bit groups, most significant first,
// the high bit set on all but the last byte, bit 6 of the first byte the sign); native and public names are 32-bit
// hashes (h = h * 0x83 ^ byte). The zone script for the map is Pallet Town's (town001.amx) with two patches of the
// same size: its switch maps the signs' hashes to one function, and that function shows the message whose label is
// the event's hash itself (instead of a constant). Nothing else moves, so every relative jump stays valid.
import { fnv1a64 } from './formats/gfpak.ts';
import { FBEditor, buildTable } from './formats/fbedit.ts';

// ---- AMX compact encoding

export function amxExpand(file: Uint8Array): { header: Uint8Array; cells: bigint[] } {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const size = dv.getUint32(0, true);
  const cod = dv.getUint32(12, true);
  const cells: bigint[] = [];
  let i = cod;
  while (i < size) {
    const start = i;
    let c = 0n;
    for (;;) {
      const b = file[i++];
      c = (c << 7n) | BigInt(b & 0x7f);
      if (!(b & 0x80)) break;
    }
    const bits = BigInt(7 * (i - start));
    if (file[start] & 0x40) c |= ((1n << 64n) - 1n) ^ ((1n << bits) - 1n);
    cells.push(BigInt.asUintN(64, c));
  }
  return { header: file.slice(0, cod), cells };
}

export function amxCompact(header: Uint8Array, cells: bigint[]): Uint8Array {
  const bytes: number[] = [];
  for (const cell of cells) {
    let v = BigInt.asIntN(64, cell);
    const groups: number[] = [];
    for (;;) {
      groups.unshift(Number(v & 0x7fn));
      v >>= 7n;
      if ((v === 0n && !(groups[0] & 0x40)) || (v === -1n && groups[0] & 0x40)) break;
    }
    groups.forEach((g, k) => bytes.push(k < groups.length - 1 ? g | 0x80 : g));
  }
  const out = new Uint8Array(header.length + bytes.length);
  out.set(header);
  out.set(bytes, header.length);
  new DataView(out.buffer).setUint32(0, out.length, true);
  return out;
}

// ---- the sign script

const OP_PROC = 46n, OP_RETN = 48n, OP_CALL = 49n, OP_ZERO_PRI = 89n, OP_PUSH_PRI = 36n, OP_CASETBL = 130n;
const OP_LOAD_P_PRI = 162n, OP_PUSH_P_C = 188n;
const packed = (op: bigint, param: number) => BigInt.asUintN(64, (BigInt(param) << 32n) | op);

// Pallet Town's script (bin/script/amx/town001.amx) with its event switch and its first sign's function patched; the
// addresses are this game's (checked before patching)
const MAIN_CASETBL = 0x2138;
const SIGN_STUB = 0x2010; // a case of the switch: push 0, call the sign function, jump to the end
const SIGN_FN = 0x22c0; // the sign function: push 0, push 0xe (window), push label, push 0x18, call the common one
export const MAX_SIGNS = 8;

export function signScript(town001: Uint8Array, events: bigint[]): Uint8Array {
  if (events.length > MAX_SIGNS) throw new Error(`como mucho ${MAX_SIGNS} carteles por mapa`);
  const { header, cells } = amxExpand(town001);
  const at = (addr: number) => addr / 8;
  const t = at(MAIN_CASETBL);
  const fn = at(SIGN_FN);
  const ok =
    cells[t] === OP_CASETBL &&
    cells[t + 1] === 8n &&
    cells[fn] === OP_PROC &&
    cells[fn + 1] === packed(OP_PUSH_P_C, 0) &&
    cells[fn + 2] === packed(OP_PUSH_P_C, 0xe) &&
    cells[fn + 5] === packed(OP_PUSH_P_C, 0x18) &&
    cells[fn + 6] === OP_CALL &&
    cells[fn + 9] === OP_RETN &&
    cells[at(SIGN_STUB) + 1] === OP_CALL &&
    at(SIGN_STUB) + 2 + Number(BigInt.asIntN(64, cells[at(SIGN_STUB) + 2])) / 8 - 1 === fn;
  if (!ok) throw new Error('el script de Pueblo Paleta no es el esperado (otra versión del juego)');
  // the function: show the message whose label is the event (global 0)
  cells[fn + 3] = packed(OP_LOAD_P_PRI, 0);
  cells[fn + 4] = OP_PUSH_PRI;
  // (cells fn+5.. stay: push 0x18, call the common function, zero, retn)
  // the switch: each sign's event to the stub; the other entries: the default (nothing but a debug print)
  const defaultTarget = t + 1 + Number(BigInt.asIntN(64, cells[t + 2])) / 8;
  for (let k = 0; k < 8; k++) {
    const rec = t + 3 + k * 2;
    const ev = events[k];
    cells[rec] = ev ?? BigInt.asUintN(64, -1n);
    const target = ev !== undefined ? at(SIGN_STUB) : defaultTarget;
    cells[rec + 1] = BigInt.asUintN(64, BigInt((target - rec) * 8));
  }
  void OP_ZERO_PRI;
  return amxCompact(header, cells);
}

// ---- messages (bin/message/<language>/script/<zone>.dat / .tbl)

export const LANGUAGES = ['English', 'French', 'German', 'Italian', 'JPN', 'JPN_KANJI', 'Korean', 'Simp_Chinese', 'Spanish', 'Trad_Chinese'];

// A message's characters as the game writes them: lines end in 0x000A; from the third line on, the window scrolls a
// line (command 0x0010 0x0001 0xBE00 before the break); an empty line starts a new window (0xBE01).
export function messageChars(text: string): number[] {
  const paras = text.replace(/\r/g, '').trim().split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean));
  const out: number[] = [];
  paras.forEach((lines, pi) => {
    if (pi > 0) out.push(0x10, 0x01, 0xbe01, 0x0a);
    lines.forEach((l, li) => {
      if (li > 0) {
        if (li >= 2) out.push(0x10, 0x01, 0xbe00);
        out.push(0x0a);
      }
      for (const ch of l) out.push(ch.codePointAt(0)! > 0xffff ? 0x3f : ch.charCodeAt(0));
    });
  });
  out.push(0);
  return out;
}

// the .dat: one section; per line its offset, length and flags, then the text, each line encrypted (key 0x7C89 +
// 0x2983 * line, XOR per character, the key rotated left 3 bits after each)
export function messageFile(texts: string[]): Uint8Array {
  const lines = texts.map(messageChars);
  const table = 4 + lines.length * 8;
  let off = table;
  const offsets = lines.map((l) => {
    const o = off;
    off += l.length * 2;
    off = (off + 3) & ~3;
    return o;
  });
  const sectionLen = off;
  const out = new Uint8Array(0x10 + sectionLen);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1, true);
  dv.setUint16(2, lines.length, true);
  dv.setUint32(4, sectionLen, true);
  dv.setUint32(8, 0, true);
  dv.setUint32(12, 0x10, true);
  dv.setUint32(0x10, sectionLen, true);
  lines.forEach((l, i) => {
    dv.setUint32(0x10 + 4 + i * 8, offsets[i], true);
    dv.setUint16(0x10 + 8 + i * 8, l.length, true);
    let key = (0x7c89 + i * 0x2983) & 0xffff;
    l.forEach((c, k) => {
      dv.setUint16(0x10 + offsets[i] + k * 2, c ^ key, true);
      key = ((key << 3) | (key >> 13)) & 0xffff;
    });
  });
  return out;
}

// the .tbl (AHTB): the labels, then the closing "msg_<zone>_max"
export function labelTable(labels: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts = labels.map((l) => enc.encode(l));
  const out = new Uint8Array(8 + parts.reduce((n, b) => n + 10 + b.length + 1, 0));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('AHTB'));
  dv.setUint32(4, labels.length, true);
  let p = 8;
  labels.forEach((l, i) => {
    dv.setBigUint64(p, fnv1a64(l), true);
    dv.setUint16(p + 8, parts[i].length + 1, true);
    out.set(parts[i], p + 10);
    p += 10 + parts[i].length + 1;
  });
  return out;
}

// ---- the event register (bin/script/param/script_id/script_id_record.bin): every script event's hash with the script
// that handles it and its messages ({0 u64 event, 1 "bin/script/amx/<x>.amx", 2 "script/<x>.dat"}); the game loads
// the messages of the events of the map's zones when entering the map, and runs the script when one happens
export const SCRIPT_RECORD = 'bin/script/param/script_id/script_id_record.bin';

export function addScriptRecords(file: Uint8Array, events: bigint[], script: string, messages: string): Uint8Array {
  const ed = new FBEditor(file);
  const field = ed.fieldPos(ed.u32(0), 0);
  const old = ed.vectorElems(ed.deref(field));
  const dv = () => new DataView(ed.buf.buffer);
  const keep = old.filter((e) => !events.includes(dv().getBigUint64(ed.fieldPos(e, 0), true)));
  const copy = (e: number) => () =>
    buildTable(ed, [
      { idx: 0, u64: dv().getBigUint64(ed.fieldPos(e, 0), true) },
      { idx: 1, child: (x) => x.string(ed.readString(ed.child(e, 1))) },
      { idx: 2, child: (x) => x.string(ed.readString(ed.child(e, 2))) },
    ]);
  const add = (ev: bigint) => () =>
    buildTable(ed, [
      { idx: 0, u64: ev },
      { idx: 1, child: (x) => x.string(script) },
      { idx: 2, child: (x) => x.string(messages) },
    ]);
  ed.link(field, ed.vectorOfTables([...keep.map(copy), ...events.map(add)]));
  return ed.data;
}
