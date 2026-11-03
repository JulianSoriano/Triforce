'use strict';
// Z80 (Master System, Game Gear, Genesis sound CPU) and SM83 (Game Boy) assemblers.
// The instruction table is generated from the disassemblers: every opcode is disassembled once with
// placeholder operands, which turns "LD A,($0000)" into the pattern "LD A,({n16})". Assembling is matching
// a line against those patterns, so the assembler and disassembler always agree.
const { oneZ80, oneSM83 } = require('../disasm');
const { splitOperands } = require('./common');

function enumerate(one, prefixes) {
  const seen = new Map(), list = [];
  const add = (opBytes, pfxLen, kind) => {
    const buf = Buffer.alloc(8); Buffer.from(opBytes).copy(buf, 0);
    const r = one(buf, 0, 0, {}); if (!r || /NOP\*|\.db/.test(r.text)) return;
    let t = r.text.toUpperCase();
    const mn = t.split(' ')[0];
    const fields = [];
    t = t.replace(/\(I([XY])\+0\)/g, (m0, r) => { fields.push('d'); return `(I${r}{d})`; });
    if (mn === 'LDH') t = t.replace(/\$FF00/, () => { fields.push('ldh'); return '{ldh}'; });
    t = t.replace(/SP\+0$/, () => { fields.push('s8'); return 'SP{s8}'; });
    if (/^ADD SP,0$/.test(t)) { t = 'ADD SP,{s8}'; fields.push('s8'); }
    t = t.replace(/\$[0-9A-F]{4}/g, () => { const k = mn === 'JR' || mn === 'DJNZ' ? 'rel' : 'n16'; fields.push(k); return `{${k}}`; });
    if (mn !== 'RST') t = t.replace(/\$[0-9A-F]{2}/g, () => { fields.push('n8'); return '{n8}'; });
    if (seen.has(t)) return; seen.set(t, true);
    list.push({ text: t, mn, ops: t.slice(mn.length).trim(), bytes: opBytes, len: r.len, fields, kind });
  };
  for (const pfx of prefixes) {
    for (let op = 0; op < 256; op++) {
      if (pfx.length === 0 && [0xCB, 0xED, 0xDD, 0xFD].includes(op) && prefixes.length > 2) continue;
      if (pfx.length === 0 && op === 0xCB) continue;
      if (pfx.length === 1 && pfx[0] !== 0xCB && pfx[0] !== 0xED && op === 0xCB) continue;   // DD CB / FD CB come from their own list
      if (pfx.length === 2 && pfx[1] === 0xCB) add([...pfx, 0, op], 3, 'idxcb');   // DD CB d op
      else add([...pfx, op], pfx.length + 1, 'plain');
    }
  }
  return list;
}

let Z80T = null, SM83T = null;
const tablesZ80 = () => Z80T || (Z80T = enumerate(oneZ80, [[], [0xCB], [0xED], [0xDD], [0xFD], [0xDD, 0xCB], [0xFD, 0xCB]]));
const tablesSM83 = () => SM83T || (SM83T = enumerate(oneSM83, [[], [0xCB]]));

const REGS = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY', 'IXH', 'IXL', 'IYH', 'IYL', 'I', 'R', 'NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M', "AF'", '(C)', '(HL)', '(BC)', '(DE)', '(SP)', '(IX)', '(IY)', 'HL+', 'HL-', '(HL+)', '(HL-)']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(t) {
  if (t.re) return t;
  let src = '^' + esc(t.ops).replace(/\\\{(n16|n8|rel|ldh|s8)\\\}/g, '(.+?)').replace(/\\\{d\\\}/g, '((?:\\s*[+-]\\s*.+?)?)') + '$';
  t.re = new RegExp(src, 'i'); t.fixedChars = t.ops.replace(/\{[a-z0-9]+\}/g, '').length;
  return t;
}

function makeBackend(name, tables) {
  return {
    name, bigEndian: false,
    encode(mnemonic, args, ctx) {
      const M = mnemonic.toUpperCase(), ops = splitOperands(args).map((o) => o.replace(/\s+/g, ' ').trim()).join(',');
      const cands = tables().filter((t) => t.mn === M).map(compile);
      if (!cands.length) throw new Error(`no ${name} instruction "${mnemonic}"`);
      const exact = cands.find((t) => !t.fields.length && t.ops.toUpperCase() === ops.toUpperCase().replace(/\s/g, ''));
      if (exact) { const o = exact.bytes.slice(); while (o.length < exact.len) o.push(0); return o; }
      const matches = [];
      for (const t of cands) {
        if (!t.fields.length) continue;
        const m = t.re.exec(ops); if (!m) continue;
        const caps = m.slice(1);
        if (caps.some((c, k) => t.fields[k] !== 'd' && (REGS.has(c.trim().toUpperCase()) || /(?<![$\w])(IX|IY|HL|SP|AF|BC|DE)(?!\w)/i.test(c)))) continue;   // a register isn't a number
        matches.push({ t, caps });
      }
      if (!matches.length) throw new Error(`${M} can't take "${args}"`);
      matches.sort((a, b) => b.t.fixedChars - a.t.fixedChars);
      const { t, caps } = matches[0];
      const out = t.bytes.slice(); const vals = {};
      t.fields.forEach((f, k) => {
        const s = caps[k].trim();
        if (f === 'd') { vals.d = s ? ctx.ev('0' + s.replace(/\s/g, '')).v : 0; return; }
        if (f === 's8') { vals.s8 = ctx.ev(s.replace(/^\+/, '')).v; return; }
        const r = ctx.ev(s);
        if (f === 'rel') { let d = (r.v - (ctx.pc + 2)) & 0xFFFF; if (d > 32767) d -= 65536; if (!r.unknown && (d < -128 || d > 127)) throw new Error(`jump out of range (${d}); use JP`); vals.n8 = d; return; }
        if (f === 'ldh') { const v = r.v >= 0xFF00 ? r.v - 0xFF00 : r.v; vals.n8 = v; return; }
        vals[f] = r.v;
      });
      const range8 = (v, what) => { if (v < -128 || v > 255) throw new Error(`${what} ${v} doesn't fit in a byte`); return v & 0xFF; };
      if (t.kind === 'idxcb') { out[2] = range8(vals.d, 'displacement'); return out; }
      if ('d' in vals) out.push(range8(vals.d, 'displacement'));
      if ('n8' in vals) out.push(range8(vals.n8, 'value'));
      if ('s8' in vals) out.push(range8(vals.s8, 'value'));
      if ('n16' in vals) out.push(vals.n16 & 0xFF, (vals.n16 >> 8) & 0xFF);
      while (out.length < t.len) out.push(0);
      return out;
    },
  };
}

const backendZ80 = makeBackend('Z80', tablesZ80);
const backendSM83 = makeBackend('SM83', tablesSM83);
module.exports = { backendZ80, backendSM83, tablesZ80, tablesSM83 };
