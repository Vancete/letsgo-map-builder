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

// ---- saved variables: the game's works are named in bin/flagwork/*.tbl (AHTB, name hash -> slot in the save, in
// order); system_works.tbl has 15 slots named "NOUSED". Renaming them gives the map variables of its own.
export const SYSTEM_WORKS = 'bin/flagwork/system_works.tbl';
export const ZONE_WORKS = 'bin/flagwork/zone_works.tbl'; // 6 unused slots too

export function renameUnused(tbl: Uint8Array, names: string[]): { data: Uint8Array; free: number } {
  const dv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  const count = dv.getUint32(4, true);
  const entries: string[] = [];
  let p = 8;
  for (let i = 0; i < count; i++) {
    const l = dv.getUint16(p + 8, true);
    entries.push(new TextDecoder().decode(tbl.subarray(p + 10, p + 10 + l - 1)));
    p += 10 + l;
  }
  let k = 0;
  const renamed = entries.map((n) => (n === 'NOUSED' && k < names.length ? names[k++] : n));
  if (k < names.length) throw new Error(`no hay sitio para más de ${k} variables`);
  return { data: labelTable(renamed).subarray(0), free: entries.filter((n) => n === 'NOUSED').length };
}
