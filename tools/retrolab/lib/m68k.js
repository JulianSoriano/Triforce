'use strict';
// Motorola 68000 disassembler (Genesis / Mega Drive main CPU). Motorola syntax, $ for hex.
const H = (v, d = 0) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(d, '0');
const SZ = ['b', 'w', 'l'];
const CC = ['t', 'f', 'hi', 'ls', 'cc', 'cs', 'ne', 'eq', 'vc', 'vs', 'pl', 'mi', 'ge', 'lt', 'gt', 'le'];

function dis68k(b, i, pc) {
  let p = i;
  const w = () => { const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const sw = () => { const v = w(); return v > 32767 ? v - 65536 : v; };
  const l = () => { const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4; return v; };
  const op = w();
  let target;
  // effective address text; size: 0 b, 1 w, 2 l (for immediates)
  const ea = (mode, reg, size) => {
    switch (mode) {
      case 0: return 'd' + reg;
      case 1: return 'a' + reg;
      case 2: return `(a${reg})`;
      case 3: return `(a${reg})+`;
      case 4: return `-(a${reg})`;
      case 5: return `${sw()}(a${reg})`;
      case 6: { const e = w(); const d8 = (e & 0xFF) > 127 ? (e & 0xFF) - 256 : e & 0xFF; return `${d8}(a${reg},${e & 0x8000 ? 'a' : 'd'}${(e >> 12) & 7}.${e & 0x800 ? 'l' : 'w'})`; }
      case 7:
        switch (reg) {
          case 0: { const v = sw(); return H((v < 0 ? v + 0x1000000 : v) & 0xFFFFFF, 4) + '.w'; }
          case 1: return H(l(), 6);
          case 2: { const base = pc + (p - i); const d = sw(); target = (base + d) >>> 0; return `${H(target, 6)}(pc)`; }
          case 3: { const base = pc + (p - i); const e = w(); const d8 = (e & 0xFF) > 127 ? (e & 0xFF) - 256 : e & 0xFF; return `${H((base + d8) >>> 0, 6)}(pc,${e & 0x8000 ? 'a' : 'd'}${(e >> 12) & 7}.${e & 0x800 ? 'l' : 'w'})`; }
          case 4: return '#' + (size === 2 ? H(l()) : size === 1 ? H(w()) : H(w() & 0xFF));
        }
    }
    return '?';
  };
  const eaOK = (mode, reg, allowed) => allowed.includes(mode === 7 ? 7 + reg : mode);   // 0-6, 7 abs.w, 8 abs.l, 9 d16pc, 10 d8pc, 11 imm
  const regList = (mask, pre) => {
    const names = []; for (let k = 0; k < 16; k++) { const bit = pre ? 15 - k : k; if (mask & (1 << bit)) names.push(k); }
    const out = []; let s = 0;
    while (s < names.length) { let e = s; while (e + 1 < names.length && names[e + 1] === names[e] + 1 && (names[e + 1] & 8) === (names[s] & 8)) e++; const n = (k) => (k < 8 ? 'd' : 'a') + (k & 7); out.push(e > s ? `${n(names[s])}-${n(names[e])}` : n(names[s])); s = e + 1; }
    return out.join('/');
  };
  const top = op >> 12, reg9 = (op >> 9) & 7, opm = (op >> 6) & 7, mode = (op >> 3) & 7, reg = op & 7, sz = (op >> 6) & 3;
  let t = null;

  if (top === 0) {
    if ((op & 0x0100) && mode === 1) { const d = sw(); const s = op & 0x40 ? 'l' : 'w'; t = op & 0x80 ? `movep.${s} d${reg9},${d}(a${reg})` : `movep.${s} ${d}(a${reg}),d${reg9}`; }
    else if (op & 0x0100) { t = `${['btst', 'bchg', 'bclr', 'bset'][sz]} d${reg9},${ea(mode, reg, 0)}`; }
    else if ((op & 0x0F00) === 0x0800) { const n = w() & 0xFF; t = `${['btst', 'bchg', 'bclr', 'bset'][sz]} #${n},${ea(mode, reg, 0)}`; }
    else {
      const names = { 0: 'ori', 2: 'andi', 4: 'subi', 6: 'addi', 0xA: 'eori', 0xC: 'cmpi' }, nm = names[(op >> 8) & 0xF];
      if (nm && sz < 3) {
        if (mode === 7 && reg === 4 && (nm === 'ori' || nm === 'andi' || nm === 'eori')) { const v = w(); t = `${nm} #${H(sz === 0 ? v & 0xFF : v)},${sz === 0 ? 'ccr' : 'sr'}`; }
        else { const imm = sz === 2 ? l() : sz === 1 ? w() : w() & 0xFF; t = `${nm}.${SZ[sz]} #${H(imm)},${ea(mode, reg, sz)}`; }
      }
    }
  } else if (top >= 1 && top <= 3) {
    const s = top === 1 ? 0 : top === 3 ? 1 : 2, src = ea(mode, reg, s), dmode = (op >> 6) & 7;
    t = dmode === 1 ? `movea.${SZ[s]} ${src},a${reg9}` : `move.${SZ[s]} ${src},${ea(dmode, reg9, s)}`;
  } else if (top === 4) {
    if (op === 0x4E70) t = 'reset'; else if (op === 0x4E71) t = 'nop'; else if (op === 0x4E72) t = `stop #${H(w())}`;
    else if (op === 0x4E73) t = 'rte'; else if (op === 0x4E75) t = 'rts'; else if (op === 0x4E76) t = 'trapv'; else if (op === 0x4E77) t = 'rtr';
    else if (op === 0x4AFC) t = 'illegal';
    else if ((op & 0xFFF0) === 0x4E40) t = `trap #${op & 15}`;
    else if ((op & 0xFFF8) === 0x4E50) t = `link a${reg},#${sw()}`;
    else if ((op & 0xFFF8) === 0x4E58) t = `unlk a${reg}`;
    else if ((op & 0xFFF0) === 0x4E60) t = op & 8 ? `move usp,a${reg}` : `move a${reg},usp`;
    else if ((op & 0xFFC0) === 0x4E80) { const e = ea(mode, reg, 2); target = target !== undefined ? target : absTarget(e); t = `jsr ${e}`; }
    else if ((op & 0xFFC0) === 0x4EC0) { const e = ea(mode, reg, 2); target = target !== undefined ? target : absTarget(e); t = `jmp ${e}`; }
    else if ((op & 0xFFF8) === 0x4840) t = `swap d${reg}`;
    else if ((op & 0xFFC0) === 0x4840) t = `pea ${ea(mode, reg, 2)}`;
    else if ((op & 0xFFB8) === 0x4880) t = `ext.${op & 0x40 ? 'l' : 'w'} d${reg}`;
    else if ((op & 0xFB80) === 0x4880) { const mask = w(), s = op & 0x40 ? 'l' : 'w'; const e = ea(mode, reg, 1); t = op & 0x400 ? `movem.${s} ${e},${regList(mask, false)}` : `movem.${s} ${regList(mask, mode === 4)},${e}`; }
    else if ((op & 0xF1C0) === 0x41C0) t = `lea ${ea(mode, reg, 2)},a${reg9}`;
    else if ((op & 0xF1C0) === 0x4180) t = `chk.w ${ea(mode, reg, 1)},d${reg9}`;
    else if ((op & 0xFFC0) === 0x40C0) t = `move sr,${ea(mode, reg, 1)}`;
    else if ((op & 0xFFC0) === 0x44C0) t = `move ${ea(mode, reg, 1)},ccr`;
    else if ((op & 0xFFC0) === 0x46C0) t = `move ${ea(mode, reg, 1)},sr`;
    else if ((op & 0xFFC0) === 0x4800) t = `nbcd ${ea(mode, reg, 0)}`;
    else if ((op & 0xFFC0) === 0x4AC0) t = `tas ${ea(mode, reg, 0)}`;
    else if (sz < 3) { const nm = { 0x40: 'negx', 0x42: 'clr', 0x44: 'neg', 0x46: 'not', 0x4A: 'tst' }[op >> 8]; if (nm) t = `${nm}.${SZ[sz]} ${ea(mode, reg, sz)}`; }
  } else if (top === 5) {
    if (sz === 3) {
      if (mode === 1) { const base = pc + 2; const d = sw(); target = (base + d) >>> 0; t = `db${(op >> 8) & 15 ? CC[(op >> 8) & 15] : 't'} d${reg},${H(target, 6)}`.replace('dbf ', 'dbra '); }
      else t = `s${CC[(op >> 8) & 15]} ${ea(mode, reg, 0)}`;
    } else t = `${op & 0x100 ? 'subq' : 'addq'}.${SZ[sz]} #${reg9 || 8},${ea(mode, reg, sz)}`;
  } else if (top === 6) {
    const c = (op >> 8) & 15, d8 = op & 0xFF, base = pc + 2;
    let d, s; if (d8 === 0) { d = sw(); s = 'w'; } else { d = d8 > 127 ? d8 - 256 : d8; s = 's'; }
    target = (base + d) >>> 0;
    t = `${c === 0 ? 'bra' : c === 1 ? 'bsr' : 'b' + CC[c]}.${s} ${H(target, 6)}`;
  } else if (top === 7) {
    if (!(op & 0x100)) { const v = op & 0xFF; t = `moveq #${v > 127 ? v - 256 : v},d${reg9}`; }
  } else if (top === 8 || top === 9 || top === 0xB || top === 0xC || top === 0xD) {
    if (top === 8 && opm === 3) t = `divu.w ${ea(mode, reg, 1)},d${reg9}`;
    else if (top === 8 && opm === 7) t = `divs.w ${ea(mode, reg, 1)},d${reg9}`;
    else if (top === 0xC && opm === 3) t = `mulu.w ${ea(mode, reg, 1)},d${reg9}`;
    else if (top === 0xC && opm === 7) t = `muls.w ${ea(mode, reg, 1)},d${reg9}`;
    else if ((top === 8 || top === 0xC) && (op & 0x1F0) === 0x100) t = `${top === 8 ? 'sbcd' : 'abcd'} ${mode & 1 ? `-(a${reg}),-(a${reg9})` : `d${reg},d${reg9}`}`;
    else if (top === 0xC && (op & 0x1F8) === 0x140) t = `exg d${reg9},d${reg}`;
    else if (top === 0xC && (op & 0x1F8) === 0x148) t = `exg a${reg9},a${reg}`;
    else if (top === 0xC && (op & 0x1F8) === 0x188) t = `exg d${reg9},a${reg}`;
    else if ((top === 9 || top === 0xD || top === 0xB) && (opm === 3 || opm === 7)) { const s = opm === 3 ? 1 : 2; t = `${top === 9 ? 'suba' : top === 0xD ? 'adda' : 'cmpa'}.${SZ[s]} ${ea(mode, reg, s)},a${reg9}`; }
    else if ((top === 9 || top === 0xD) && (op & 0x130) === 0x100 && sz < 3) t = `${top === 9 ? 'subx' : 'addx'}.${SZ[sz]} ${mode & 1 ? `-(a${reg}),-(a${reg9})` : `d${reg},d${reg9}`}`;
    else if (top === 0xB && (op & 0x138) === 0x108 && sz < 3) t = `cmpm.${SZ[sz]} (a${reg})+,(a${reg9})+`;
    else if (top === 0xB && opm >= 4) t = `eor.${SZ[sz]} d${reg9},${ea(mode, reg, sz)}`;
    else {
      const nm = { 8: 'or', 9: 'sub', 0xB: 'cmp', 0xC: 'and', 0xD: 'add' }[top], s = opm & 3;
      t = opm & 4 ? `${nm}.${SZ[s]} d${reg9},${ea(mode, reg, s)}` : `${nm}.${SZ[s]} ${ea(mode, reg, s)},d${reg9}`;
    }
  } else if (top === 0xE) {
    const kinds = ['as', 'ls', 'rox', 'ro'];
    if (sz === 3) { const k = (op >> 9) & 3; t = `${kinds[k]}${op & 0x100 ? 'l' : 'r'}.w ${ea(mode, reg, 1)}`; }
    else { const k = (op >> 3) & 3, cnt = op & 0x20 ? `d${reg9}` : `#${reg9 || 8}`; t = `${kinds[k]}${op & 0x100 ? 'l' : 'r'}.${SZ[sz]} ${cnt},d${reg}`; }
  } else if (top === 0xA) t = `dc.w ${H(op, 4)} ; line A`;
  else if (top === 0xF) t = `dc.w ${H(op, 4)} ; line F`;

  if (t === null) return { len: 2, text: `dc.w ${H(op, 4)}` };
  return { len: p - i, text: t, target };
}
function absTarget(e) { const m = /^\$([0-9A-F]+)(\.w)?$/.exec(e); return m ? parseInt(m[1], 16) : undefined; }

module.exports = { dis68k };
