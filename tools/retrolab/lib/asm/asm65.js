'use strict';
// 6502 (NES) and 65816 (SNES) assemblers, built from the same opcode tables as the disassemblers.
const { OPS6502, OPS816 } = require('../disasm');

const rev = (table) => { const r = {}; table.forEach((e, op) => { if (!e) return; const [m, mode] = e; (r[m] = r[m] || {})[mode] = op; }); return r; };
const R6502 = rev(Object.keys(OPS6502).reduce((a, k) => { a[+k] = OPS6502[k]; return a; }, []));
const R816 = rev(OPS816);
const BRANCH6502 = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ']);

// How wide a written number is: "$12" -> 1 byte, "$1234" -> 2, "$123456" -> 3 (when the operand is a plain literal).
function literalWidth(expr) {
  const m = /^\$([0-9a-f]+)$/i.exec(expr.trim()) || /^0x([0-9a-f]+)$/i.exec(expr.trim());
  if (!m) return 0;
  return m[1].length <= 2 ? 1 : m[1].length <= 4 ? 2 : 3;
}
const le = (v, n) => { const o = []; for (let i = 0; i < n; i++) o.push((v >>> (8 * i)) & 0xFF); return o; };

const backend6502 = {
  name: '6502', bigEndian: false,
  encode(mnem, args, ctx) {
    const M = mnem.toUpperCase(), modes = R6502[M];
    if (!modes) throw new Error(`no 6502 instruction "${mnem}"`);
    let a = args.trim(), m;
    const pick = (zp, abs, expr) => {
      const r = ctx.ev(expr), w = literalWidth(expr);
      const useZp = zp in modes && !(w === 2) && (w === 1 || (!r.unknown && r.v >= 0 && r.v < 0x100)) && !(abs in modes && w === 0 && r.unknown);
      if (useZp) return [modes[zp], ...le(r.v, 1)];
      if (!(abs in modes)) throw new Error(`${M} has no ${abs} form`);
      return [modes[abs], ...le(r.v, 2)];
    };
    if (!a) { if ('imp' in modes) return [modes.imp]; if ('acc' in modes) return [modes.acc]; throw new Error(`${M} needs an operand`); }
    if (/^a$/i.test(a)) { if ('acc' in modes) return [modes.acc]; }
    if (a[0] === '#') { if (!('imm' in modes)) throw new Error(`${M} has no immediate form`); return [modes.imm, ...le(ctx.ev(a.slice(1)).v, 1)]; }
    if ((m = /^\((.+),\s*x\)$/i.exec(a))) return [modes.izx, ...le(ctx.ev(m[1]).v, 1)];
    if ((m = /^\((.+)\),\s*y$/i.exec(a))) return [modes.izy, ...le(ctx.ev(m[1]).v, 1)];
    if ((m = /^\((.+)\)$/.exec(a))) { if (!('ind' in modes)) throw new Error(`${M} has no indirect form`); return [modes.ind, ...le(ctx.ev(m[1]).v, 2)]; }
    if ((m = /^(.+),\s*x$/i.exec(a))) return pick('zpx', 'abx', m[1]);
    if ((m = /^(.+),\s*y$/i.exec(a))) return pick('zpy', 'aby', m[1]);
    if (BRANCH6502.has(M)) {
      const r = ctx.ev(a); let d = ((r.v - (ctx.pc + 2)) & 0xFFFF); if (d > 32767) d -= 65536;
      if (!r.unknown && (d < -128 || d > 127)) throw new Error(`branch out of range (${d} bytes); use JMP`);
      return [modes.rel, d & 0xFF];
    }
    return pick('zp', 'abs', a);
  },
};

const backend816 = {
  name: '65816', bigEndian: false,
  newState(opts) { return { m16: !!opts.m16, x16: !!opts.x16 }; },
  directive(m, args, st) {
    const d = { '.m8': ['m16', false], '.a8': ['m16', false], '.m16': ['m16', true], '.a16': ['m16', true], '.x8': ['x16', false], '.i8': ['x16', false], '.x16': ['x16', true], '.i16': ['x16', true] }[m];
    if (!d) return false; st[d[0]] = d[1]; return true;
  },
  encode(mnem, args, ctx) {
    const M = mnem.toUpperCase(), modes = R816[M], st = ctx.state;
    if (!modes) throw new Error(`no 65816 instruction "${mnem}"`);
    const a = args.trim(); let m;
    const val = (e) => ctx.ev(e);
    const width = (e) => { const w = literalWidth(e); if (w) return w; const r = val(e); return r.unknown ? 2 : r.v > 0xFFFF ? 3 : 2; };
    const choose = (opts, e) => {             // opts: [[mode, bytes], ...] narrowest first
      const w = width(e); const avail = opts.filter(([md]) => md in modes);
      if (!avail.length) throw new Error(`${M} has no such addressing form`);
      const exact = avail.find(([, n]) => n === w) || avail.find(([, n]) => n > w) || avail[avail.length - 1];
      return [modes[exact[0]], ...le(val(e).v, exact[1])];
    };
    let out;
    if (!a) out = '-' in modes ? [modes['-']] : 'A' in modes ? [modes.A] : null;
    else if (/^a$/i.test(a) && 'A' in modes) out = [modes.A];
    else if (a[0] === '#') {
      const e = a.slice(1);
      if ('i8' in modes) out = [modes.i8, ...le(val(e).v, 1)];
      else if ('i16' in modes) out = [modes.i16, ...le(val(e).v, 2)];
      else if ('iM' in modes) { const w = literalWidth(e); out = [modes.iM, ...le(val(e).v, w ? (w >= 2 ? 2 : 1) : st.m16 ? 2 : 1)]; }
      else if ('iX' in modes) { const w = literalWidth(e); out = [modes.iX, ...le(val(e).v, w ? (w >= 2 ? 2 : 1) : st.x16 ? 2 : 1)]; }
    }
    else if ((m = /^\((.+),\s*s\),\s*y$/i.exec(a))) out = [modes.siy, ...le(val(m[1]).v, 1)];
    else if ((m = /^(.+),\s*s$/i.exec(a))) out = [modes.sr, ...le(val(m[1]).v, 1)];
    else if ((m = /^\((.+),\s*x\)$/i.exec(a))) out = choose([['dxi', 1], ['axi', 2]], m[1]);
    else if ((m = /^\((.+)\),\s*y$/i.exec(a))) out = [modes.diy, ...le(val(m[1]).v, 1)];
    else if ((m = /^\[(.+)\],\s*y$/i.exec(a))) out = [modes.dily, ...le(val(m[1]).v, 1)];
    else if ((m = /^\[(.+)\]$/.exec(a))) out = choose([['dil', 1], ['ail', 2]], m[1]);
    else if ((m = /^\((.+)\)$/.exec(a))) out = choose([['di', 1], ['ai', 2]], m[1]);
    else if ('mv' in modes && (m = /^(.+),(.+)$/.exec(a))) out = [modes.mv, val(m[2]).v & 0xFF, val(m[1]).v & 0xFF];
    else if ((m = /^(.+),\s*x$/i.exec(a))) out = choose([['dpx', 1], ['abx', 2], ['lgx', 3]], m[1]);
    else if ((m = /^(.+),\s*y$/i.exec(a))) out = choose([['dpy', 1], ['aby', 2]], m[1]);
    else if ('r8' in modes) { const r = val(a); const d = (r.v & 0xFFFF) - ((ctx.pc + 2) & 0xFFFF); const dd = d > 32767 ? d - 65536 : d < -32768 ? d + 65536 : d; if (!r.unknown && (dd < -128 || dd > 127)) throw new Error(`branch out of range (${dd}); use BRL or JMP`); out = [modes.r8, dd & 0xFF]; }
    else if ('r16' in modes) { const r = val(a); const d = ((r.v & 0xFFFF) - ((ctx.pc + 3) & 0xFFFF)) & 0xFFFF; out = [modes.r16, ...le(d, 2)]; }
    else out = choose([['dp', 1], ['ab', 2], ['lg', 3]], a);
    if (!out || out[0] === undefined) throw new Error(`${M} can't take "${a}"`);
    if (M === 'REP') { if (out[1] & 0x20) st.m16 = true; if (out[1] & 0x10) st.x16 = true; }
    if (M === 'SEP') { if (out[1] & 0x20) st.m16 = false; if (out[1] & 0x10) st.x16 = false; }
    return out;
  },
};

module.exports = { backend6502, backend816 };
