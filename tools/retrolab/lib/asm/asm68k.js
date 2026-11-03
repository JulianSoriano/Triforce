'use strict';
// Motorola 68000 assembler (Genesis). Accepts the syntax RetroLab's 68000 disassembler prints:
//   move.w #$1C,0(a2)   lea $FF0000,a0   tst.b $FFFC4B.w   jsr $00F342   bne.s label   dbra d1,loop
//   movem.l d0-d7/a0-a6,-(a7)   btst #0,30(a2)   move.w $017356(pc),d0  (address of the data, not the offset)
// Absolute addresses are long unless written with .w; branches are .w unless written with .s.
const { splitOperands } = require('./common');

const SIZE = { b: 0, w: 1, l: 2 };
const CC = { t: 0, f: 1, hi: 2, ls: 3, cc: 4, hs: 4, cs: 5, lo: 5, ne: 6, eq: 7, vc: 8, vs: 9, pl: 10, mi: 11, ge: 12, lt: 13, gt: 14, le: 15 };
const be16 = (v) => [(v >> 8) & 0xFF, v & 0xFF];
const be32 = (v) => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];

function parseReg(s) {
  s = s.trim().toLowerCase();
  let m;
  if ((m = /^d([0-7])$/.exec(s))) return { kind: 'd', n: +m[1] };
  if ((m = /^a([0-7])$/.exec(s))) return { kind: 'a', n: +m[1] };
  if (s === 'sp') return { kind: 'a', n: 7 };
  return null;
}
function parseIndex(s) {   // d3.w / a1.l / d0
  const m = /^([da][0-7]|sp)(?:\.([wl]))?$/i.exec(s.trim()); if (!m) return null;
  const r = parseReg(m[1]); return { da: r.kind === 'a' ? 1 : 0, n: r.n, long: (m[2] || 'w').toLowerCase() === 'l' };
}

// operand text -> { mode, reg, ext: [words/longs as byte arrays], kind }
function parseEA(text, ctx, size, extPcOffset) {
  let s = text.trim(), m; const lo = s.toLowerCase();
  const ev = (e) => ctx.ev(e).v;
  let r = parseReg(s); if (r) return { mode: r.kind === 'd' ? 0 : 1, reg: r.n, ext: [] };
  if (lo === 'sr' || lo === 'ccr' || lo === 'usp') return { special: lo };
  if (s[0] === '#') { const v = ev(s.slice(1)); return { mode: 7, reg: 4, ext: size === 2 ? be32(v) : be16(size === 0 ? v & 0xFF : v), imm: v }; }
  if ((m = /^\(\s*(a[0-7]|sp)\s*\)$/i.exec(s))) return { mode: 2, reg: parseReg(m[1]).n, ext: [] };
  if ((m = /^\(\s*(a[0-7]|sp)\s*\)\+$/i.exec(s))) return { mode: 3, reg: parseReg(m[1]).n, ext: [] };
  if ((m = /^-\(\s*(a[0-7]|sp)\s*\)$/i.exec(s))) return { mode: 4, reg: parseReg(m[1]).n, ext: [] };
  // d(pc,xn) and d(pc): the number is the address of the data (like the disassembler prints)
  if ((m = /^(.*)\(\s*pc\s*,\s*([^)]+)\)$/i.exec(s)) || (m = /^\(\s*(.*?)\s*,\s*pc\s*,\s*([^)]+)\)$/i.exec(s))) {
    const x = parseIndex(m[2]); const base = ctx.pc + extPcOffset; const r = ctx.ev(m[1] || '0'); const d = r.v - base;
    if (!r.unknown && (d < -128 || d > 127)) throw new Error('pc-relative index out of range');
    return { mode: 7, reg: 3, ext: be16((x.da << 15) | (x.n << 12) | (x.long ? 0x800 : 0) | (d & 0xFF)) };
  }
  if ((m = /^(.*)\(\s*pc\s*\)$/i.exec(s)) || (m = /^\(\s*(.*?)\s*,\s*pc\s*\)$/i.exec(s))) {
    const base = ctx.pc + extPcOffset; const d = ev(m[1] || '0') - base;
    return { mode: 7, reg: 2, ext: be16(d & 0xFFFF) };
  }
  // d(an,xn)
  if ((m = /^(.*)\(\s*(a[0-7]|sp)\s*,\s*([^)]+)\)$/i.exec(s)) || (m = /^\(\s*(.*?)\s*,\s*(a[0-7]|sp)\s*,\s*([^)]+)\)$/i.exec(s))) {
    const x = parseIndex(m[3]); const d = ev(m[1] || '0');
    return { mode: 6, reg: parseReg(m[2]).n, ext: be16((x.da << 15) | (x.n << 12) | (x.long ? 0x800 : 0) | (d & 0xFF)) };
  }
  // d(an)
  if ((m = /^(.+)\(\s*(a[0-7]|sp)\s*\)$/i.exec(s)) || (m = /^\(\s*(.+?)\s*,\s*(a[0-7]|sp)\s*\)$/i.exec(s))) return { mode: 5, reg: parseReg(m[2]).n, ext: be16(ev(m[1]) & 0xFFFF) };
  // absolute
  if ((m = /^(.+)\.w$/i.exec(s))) { const v = ev(m[1]); return { mode: 7, reg: 0, ext: be16(v & 0xFFFF), abs: v }; }
  if ((m = /^(.+)\.l$/i.exec(s))) s = m[1];
  const v = ev(s); return { mode: 7, reg: 1, ext: be32(v), abs: v };
}
const eaBits = (e) => (e.mode << 3) | e.reg;
// size of the extension words before an operand, to work out pc-relative displacements
function extLen(text, size) {
  const s = text.trim(); if (/^[da][0-7]$|^sp$|^\(\s*(a[0-7]|sp)\s*\)[+]?$|^-\(/i.test(s)) return 0;
  if (s[0] === '#') return size === 2 ? 4 : 2;
  if (/\(|\.w$/i.test(s)) return 2;
  return 4;
}

function regList(s) {
  let mask = 0;
  for (const part of s.split('/')) {
    const [a, b] = part.split('-').map((x) => parseReg(x));
    if (!a) throw new Error('bad register list: ' + s);
    const idx = (r) => (r.kind === 'd' ? 0 : 8) + r.n;
    for (let k = idx(a); k <= idx(b || a); k++) mask |= 1 << k;
  }
  return mask;
}
const rev16 = (m) => { let r = 0; for (let i = 0; i < 16; i++) if (m & (1 << i)) r |= 1 << (15 - i); return r; };

const backend68k = {
  name: '68000', bigEndian: true,
  encode(mnemonic, args, ctx) {
    const lower = mnemonic.toLowerCase();
    let [base, sz] = lower.split('.'); const ops = splitOperands(args);
    const size = sz && sz in SIZE ? SIZE[sz] : 1;
    const out = (opword, ...exts) => [...be16(opword), ...[].concat(...exts)];
    const ea = (k, s = size) => parseEA(ops[k], ctx, s, 2 + (k === 1 ? extLen(ops[0], s) : 0));
    const ctxPc = ctx.pc;

    // ----- no operands -----
    const fixed = { rts: 0x4E75, rte: 0x4E73, rtr: 0x4E77, nop: 0x4E71, reset: 0x4E70, trapv: 0x4E76, illegal: 0x4AFC };
    if (base in fixed) return be16(fixed[base]);
    if (base === 'stop') return out(0x4E72, be16(ctx.ev(ops[0].replace('#', '')).v));
    if (base === 'trap') return be16(0x4E40 | (ctx.ev(ops[0].replace('#', '')).v & 15));
    if (base === 'link') return out(0x4E50 | parseReg(ops[0]).n, be16(ctx.ev(ops[1].replace('#', '')).v & 0xFFFF));
    if (base === 'unlk') return be16(0x4E58 | parseReg(ops[0]).n);
    if (base === 'swap') return be16(0x4840 | parseReg(ops[0]).n);
    if (base === 'ext') return be16((sz === 'l' ? 0x48C0 : 0x4880) | parseReg(ops[0]).n);

    // ----- branches -----
    const bm = /^b(ra|sr|[a-z]{2})$/.exec(base);
    if (bm && (bm[1] === 'ra' || bm[1] === 'sr' || bm[1] in CC) && !['bchg', 'bclr', 'bset', 'btst'].includes(base)) {
      const c = bm[1] === 'ra' ? 0 : bm[1] === 'sr' ? 1 : CC[bm[1]];
      const r = ctx.ev(ops[0]); const d = r.v - (ctxPc + 2);
      if (sz === 's' || sz === 'b') { if (!r.unknown && (d < -128 || d > 127 || d === 0)) throw new Error(`short branch can't reach (${d})`); return be16(0x6000 | (c << 8) | (d & 0xFF)); }
      return out(0x6000 | (c << 8), be16(d & 0xFFFF));
    }
    const dbm = /^db(ra|[a-z]{1,2})$/.exec(base);
    if (dbm && (dbm[1] === 'ra' || dbm[1] in CC)) {
      const c = dbm[1] === 'ra' ? 1 : CC[dbm[1]]; const d = ctx.ev(ops[1]).v - (ctxPc + 2);
      return out(0x50C8 | (c << 8) | parseReg(ops[0]).n, be16(d & 0xFFFF));
    }
    const sm = /^s([a-z]{1,2})$/.exec(base);
    if (sm && sm[1] in CC && base !== 'sub' && base !== 'swap') { const e = ea(0, 0); return out(0x50C0 | (CC[sm[1]] << 8) | eaBits(e), e.ext); }

    // ----- moves -----
    if (base === 'moveq') return be16(0x7000 | (parseReg(ops[1]).n << 9) | (ctx.ev(ops[0].replace('#', '')).v & 0xFF));
    if (base === 'move' || base === 'movea') {
      const s0 = ops[0].trim().toLowerCase(), s1 = ops[1].trim().toLowerCase();
      if (s0 === 'sr') { const d = ea(1, 1); return out(0x40C0 | eaBits(d), d.ext); }
      if (s1 === 'ccr') { const e = ea(0, 1); return out(0x44C0 | eaBits(e), e.ext); }
      if (s1 === 'sr') { const e = ea(0, 1); return out(0x46C0 | eaBits(e), e.ext); }
      if (s0 === 'usp') return be16(0x4E68 | parseReg(ops[1]).n);
      if (s1 === 'usp') return be16(0x4E60 | parseReg(ops[0]).n);
      const src = ea(0), dst = ea(1);
      const code = size === 0 ? 1 : size === 1 ? 3 : 2;
      return out((code << 12) | (dst.reg << 9) | (dst.mode << 6) | eaBits(src), src.ext, dst.ext);
    }
    if (base === 'lea') { const e = ea(0, 2); return out(0x41C0 | (parseReg(ops[1]).n << 9) | eaBits(e), e.ext); }
    if (base === 'pea') { const e = ea(0, 2); return out(0x4840 | eaBits(e), e.ext); }
    if (base === 'jsr' || base === 'jmp') { const e = ea(0, 2); return out((base === 'jsr' ? 0x4E80 : 0x4EC0) | eaBits(e), e.ext); }
    if (base === 'movem') {
      const toRegs = !!(parseReg(ops[1].split(/[/-]/)[0]) && !/[(]/.test(ops[1]));
      const list = regList(toRegs ? ops[1] : ops[0]);
      const e = parseEA(toRegs ? ops[0] : ops[1], ctx, 1, 4);
      const mask = e.mode === 4 ? rev16(list) : list;
      return out(0x4880 | (toRegs ? 0x400 : 0) | (sz === 'l' ? 0x40 : 0) | eaBits(e), be16(mask), e.ext);
    }
    if (base === 'movep') {
      const s0 = parseReg(ops[0]);
      if (s0 && s0.kind === 'd') { const m = /^(.*)\(\s*(a[0-7])\s*\)$/i.exec(ops[1]); return out(0x0108 | (s0.n << 9) | ((sz === 'l' ? 7 : 6) << 6) | parseReg(m[2]).n, be16(ctx.ev(m[1] || '0').v & 0xFFFF)); }
      const m = /^(.*)\(\s*(a[0-7])\s*\)$/i.exec(ops[0]); return out(0x0108 | (parseReg(ops[1]).n << 9) | ((sz === 'l' ? 5 : 4) << 6) | parseReg(m[2]).n, be16(ctx.ev(m[1] || '0').v & 0xFFFF));
    }

    // ----- single operand -----
    const one = { negx: 0x4000, clr: 0x4200, neg: 0x4400, not: 0x4600, tst: 0x4A00 };
    if (base in one) { const e = ea(0); return out(one[base] | (size << 6) | eaBits(e), e.ext); }
    if (base === 'nbcd') { const e = ea(0, 0); return out(0x4800 | eaBits(e), e.ext); }
    if (base === 'tas') { const e = ea(0, 0); return out(0x4AC0 | eaBits(e), e.ext); }
    if (base === 'chk') { const e = ea(0, 1); return out(0x4180 | (parseReg(ops[1]).n << 9) | eaBits(e), e.ext); }

    // ----- immediate forms -----
    const imm = { ori: 0x0000, andi: 0x0200, subi: 0x0400, addi: 0x0600, eori: 0x0A00, cmpi: 0x0C00 };
    if (base in imm) {
      const dst = ops[1].trim().toLowerCase();
      if (dst === 'ccr' || dst === 'sr') return out(imm[base] | (dst === 'ccr' ? 0x3C : 0x7C), be16(ctx.ev(ops[0].replace('#', '')).v & (dst === 'ccr' ? 0xFF : 0xFFFF)));
      const i = ea(0), e = ea(1);
      return out(imm[base] | (size << 6) | eaBits(e), i.ext, e.ext);
    }
    const bit = { btst: 0, bchg: 1, bclr: 2, bset: 3 };
    if (base in bit) {
      const r = parseReg(ops[0]);
      if (r) { const e = ea(1, 0); return out(0x0100 | (r.n << 9) | (bit[base] << 6) | eaBits(e), e.ext); }
      const n = ctx.ev(ops[0].replace('#', '')).v; const e = parseEA(ops[1], ctx, 0, 4);
      return out(0x0800 | (bit[base] << 6) | eaBits(e), be16(n & 0xFF), e.ext);
    }
    if (base === 'addq' || base === 'subq') {
      const n = ctx.ev(ops[0].replace('#', '')).v; if (n < 1 || n > 8) throw new Error('addq/subq take 1-8');
      const e = parseEA(ops[1], ctx, size, 2); return out(0x5000 | ((n & 7) << 9) | (base === 'subq' ? 0x100 : 0) | (size << 6) | eaBits(e), e.ext);
    }

    // ----- two-operand arithmetic -----
    const r1 = ops[1] ? parseReg(ops[1]) : null;
    if (['add', 'sub', 'cmp', 'adda', 'suba', 'cmpa'].includes(base) && r1 && r1.kind === 'a') {
      const b2 = { add: 0xD000, adda: 0xD000, sub: 0x9000, suba: 0x9000, cmp: 0xB000, cmpa: 0xB000 }[base];
      const e = ea(0); return out(b2 | (r1.n << 9) | ((size === 2 ? 7 : 3) << 6) | eaBits(e), e.ext);
    }
    if (base === 'addx' || base === 'subx') {
      const b2 = base === 'addx' ? 0xD100 : 0x9100; const mem = /^-\(/.test(ops[0]);
      const rx = mem ? +/a([0-7])/i.exec(ops[0])[1] : parseReg(ops[0]).n, ry = mem ? +/a([0-7])/i.exec(ops[1])[1] : parseReg(ops[1]).n;
      return be16(b2 | (ry << 9) | (size << 6) | (mem ? 8 : 0) | rx);
    }
    if (base === 'abcd' || base === 'sbcd') {
      const mem = /^-\(/.test(ops[0]); const rx = mem ? +/a([0-7])/i.exec(ops[0])[1] : parseReg(ops[0]).n, ry = mem ? +/a([0-7])/i.exec(ops[1])[1] : parseReg(ops[1]).n;
      return be16((base === 'abcd' ? 0xC100 : 0x8100) | (ry << 9) | (mem ? 8 : 0) | rx);
    }
    if (base === 'cmpm') { const ay = +/a([0-7])/i.exec(ops[0])[1], ax = +/a([0-7])/i.exec(ops[1])[1]; return be16(0xB108 | (ax << 9) | (size << 6) | ay); }
    if (['mulu', 'muls', 'divu', 'divs'].includes(base)) { const e = ea(0, 1); return out({ mulu: 0xC0C0, muls: 0xC1C0, divu: 0x80C0, divs: 0x81C0 }[base] | (r1.n << 9) | eaBits(e), e.ext); }
    if (base === 'exg') {
      const a = parseReg(ops[0]), b = parseReg(ops[1]);
      if (a.kind === 'd' && b.kind === 'd') return be16(0xC140 | (a.n << 9) | b.n);
      if (a.kind === 'a' && b.kind === 'a') return be16(0xC148 | (a.n << 9) | b.n);
      const d = a.kind === 'd' ? a : b, ar = a.kind === 'a' ? a : b; return be16(0xC188 | (d.n << 9) | ar.n);
    }
    if (base === 'eor') { const e = ea(1); return out(0xB000 | (parseReg(ops[0]).n << 9) | ((4 + size) << 6) | eaBits(e), e.ext); }
    const two = { or: 0x8000, sub: 0x9000, cmp: 0xB000, and: 0xC000, add: 0xD000 };
    if (base in two) {
      if (r1 && r1.kind === 'd') { const e = ea(0); return out(two[base] | (r1.n << 9) | (size << 6) | eaBits(e), e.ext); }
      const r0 = parseReg(ops[0]); if (!r0 || r0.kind !== 'd' || base === 'cmp') throw new Error(`${base} needs a data register on one side`);
      const e = ea(1); return out(two[base] | (r0.n << 9) | ((4 + size) << 6) | eaBits(e), e.ext);
    }

    // ----- shifts and rotates -----
    const sh = /^(as|ls|rox|ro)([lr])$/.exec(base);
    if (sh) {
      const type = { as: 0, ls: 1, rox: 2, ro: 3 }[sh[1]], left = sh[2] === 'l' ? 1 : 0;
      if (ops.length === 1) { const e = ea(0, 1); return out(0xE0C0 | (type << 9) | (left << 8) | eaBits(e), e.ext); }
      const dst = parseReg(ops[1]).n, cnt = parseReg(ops[0]);
      if (cnt) return be16(0xE000 | (cnt.n << 9) | (left << 8) | (size << 6) | 0x20 | (type << 3) | dst);
      const n = ctx.ev(ops[0].replace('#', '')).v; if (n < 1 || n > 8) throw new Error('shift count must be 1-8 (use a register for more)');
      return be16(0xE000 | ((n & 7) << 9) | (left << 8) | (size << 6) | (type << 3) | dst);
    }
    throw new Error(`no 68000 instruction "${mnemonic}"`);
  },
};

module.exports = { backend68k };
