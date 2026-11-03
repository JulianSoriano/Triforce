'use strict';
// Shared parts of the assemblers: expressions, labels, directives and the two-pass loop.
// Syntax matches what RetroLab's disassemblers print, so disassembled code can be edited and assembled back.

class AsmError extends Error { constructor(msg, line) { super(line ? `line ${line.no}: ${msg}\n  ${line.text.trim()}` : msg); } }

// ---------- expressions ----------
// numbers: $1F 0x1F 1Fh %1010 123 'A'; labels; * = current address; + - * / % & | ^ << >> ~ and parentheses.
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    if ((m = /^(\$[0-9a-f]+|0x[0-9a-f]+|%[01]+|[0-9][0-9a-f]*h\b|[0-9]+)/i.exec(s.slice(i)))) { out.push({ t: 'n', v: num(m[1]) }); i += m[1].length; continue; }
    if ((m = /^'(.)'/.exec(s.slice(i)))) { out.push({ t: 'n', v: m[1].charCodeAt(0) }); i += 3; continue; }
    if ((m = /^[A-Za-z_.@][\w.@]*/.exec(s.slice(i)))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ((m = /^(<<|>>|[-+*/%&|^~()<>])/.exec(s.slice(i)))) { out.push({ t: 'op', v: m[1] }); i += m[1].length; continue; }
    throw new Error(`can't read "${s.slice(i)}"`);
  }
  return out;
}
function num(t) {
  if (t[0] === '$') return parseInt(t.slice(1), 16);
  if (/^0x/i.test(t)) return parseInt(t, 16);
  if (t[0] === '%') return parseInt(t.slice(1), 2);
  if (/h$/i.test(t)) return parseInt(t.slice(0, -1), 16);
  return parseInt(t, 10);
}
// Evaluates an expression. `sym(name)` returns a value or undefined (unknown yet).
function evaluate(src, sym, pc) {
  const tk = tokenize(src); let p = 0; let unknown = false;
  const peek = () => tk[p], take = () => tk[p++];
  const prim = () => {
    const t = take();
    if (!t) throw new Error('expression ends early');
    if (t.t === 'n') return t.v;
    if (t.t === 'id') { const v = sym(t.v); if (v === undefined) { unknown = true; return 0; } return v; }
    if (t.v === '(') { const v = expr(0); if (!take() || tk[p - 1].v !== ')') throw new Error('missing )'); return v; }
    if (t.v === '-') return -prim();
    if (t.v === '+') return prim();
    if (t.v === '~') return ~prim();
    if (t.v === '*') return pc;
    if (t.v === '<') return prim() & 0xFF;          // low byte
    if (t.v === '>') return (prim() >> 8) & 0xFF;   // high byte
    throw new Error(`unexpected "${t.v}"`);
  };
  const PREC = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  const expr = (min) => {
    let l = prim();
    for (;;) {
      const t = peek(); if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < min) return l;
      take(); const r = expr(PREC[t.v] + 1);
      l = { '|': l | r, '^': l ^ r, '&': l & r, '<<': l << r, '>>': l >>> r, '+': l + r, '-': l - r, '*': l * r, '/': Math.trunc(l / r), '%': l % r }[t.v];
    }
  };
  const v = expr(0);
  if (p < tk.length) throw new Error(`unexpected "${tk[p].v}"`);
  return { v, unknown };
}
// Split an operand list on top-level commas (not inside parentheses, brackets or quotes).
function splitOperands(s) {
  const out = []; let depth = 0, cur = '', q = false;
  for (const c of s) {
    if (c === "'" || c === '"') q = !q;
    if (!q && (c === '(' || c === '[')) depth++;
    if (!q && (c === ')' || c === ']')) depth--;
    if (c === ',' && depth === 0 && !q) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------- the assembler loop ----------
// backend: { name, bigEndian, encode(mnemonic, operandText, ctx) -> bytes array, directive?(...) }
// Labels end with ':' or start in column 0. Local labels start with '.' and belong to the last global label.
function assemble(backend, source, opts = {}) {
  const lines = String(source).split('\n').map((text, k) => ({ no: k + 1, text }));
  const syms = Object.assign({}, opts.symbols || {});
  let result;
  // Repeat until every label settles (instruction sizes can depend on label values).
  for (let pass = 0; pass < 8; pass++) {
    const r = runPass(backend, lines, syms, opts, pass);
    const changed = Object.keys(r.defined).some((k) => syms[k] !== r.defined[k]);
    Object.assign(syms, r.defined);
    result = r;
    if (!changed && !r.unknownUsed) break;
  }
  if (result.unknownUsed) throw new AsmError(`unknown label: ${result.unknownUsed.name}`, result.unknownUsed.line);
  return { chunks: result.chunks, symbols: syms, listing: result.listing };
}

function runPass(backend, lines, syms, opts, pass) {
  let pc = opts.org !== undefined ? opts.org : 0, global = '';
  const defined = {}, chunks = [], listing = []; let cur = null, unknownUsed = null;
  const state = backend.newState ? backend.newState(opts) : {};
  const startChunk = () => { cur = { org: pc, bytes: [] }; chunks.push(cur); };
  startChunk();
  const sym = (line) => (name) => {
    const full = name[0] === '.' ? global + name : name;
    if (full in defined) return defined[full];
    if (full in syms) return syms[full];
    if (!unknownUsed && pass > 0) unknownUsed = { name: full, line };
    return undefined;
  };
  const emit = (bytes, line, src) => { listing.push({ addr: pc, bytes: Buffer.from(bytes).toString('hex'), src: src || line.text.trim() }); for (const b of bytes) cur.bytes.push(b & 0xFF); pc += bytes.length; };
  for (const line of lines) {
    let t = line.text.replace(/;.*$/, '').replace(/\s+$/, '');
    if (!t.trim()) continue;
    // label at the start
    let m = /^\s*([A-Za-z_.@][\w.@]*):\s*/.exec(t);
    if (m) {
      const name = m[1]; const full = name[0] === '.' ? global + name : name; if (name[0] !== '.') global = name;
      defined[full] = pc; t = t.slice(m[0].length);
      if (!t.trim()) continue;
    }
    // name equ value / name = value
    if ((m = /^\s*([A-Za-z_][\w.]*)\s*(?:equ\b|=)\s*(.+)$/i.exec(t))) {
      try { const r = evaluate(m[2], sym(line), pc); defined[m[1]] = r.v; } catch (e) { throw new AsmError(e.message, line); }
      continue;
    }
    const parts = /^\s*([A-Za-z_.][\w.]*)\s*(.*)$/.exec(t);
    if (!parts) throw new AsmError('not understood', line);
    const mnem = parts[1].toLowerCase(), args = parts[2].trim();
    const ev = (s) => { try { return evaluate(s, sym(line), pc); } catch (e) { throw new AsmError(e.message, line); } };
    // directives
    if (mnem === 'org' || mnem === '.org') { pc = ev(args).v; startChunk(); continue; }
    if (/^(dc\.b|db|\.db|\.byte)$/.test(mnem)) {
      const out = []; for (const a of splitOperands(args)) { const sm = /^"(.*)"$/.exec(a) || /^'(..+)'$/.exec(a); if (sm) for (const ch of sm[1]) out.push(ch.charCodeAt(0)); else out.push(ev(a).v); }
      emit(out, line); continue;
    }
    if (/^(dc\.w|dw|\.dw|\.word)$/.test(mnem)) { const out = []; for (const a of splitOperands(args)) { const v = ev(a).v & 0xFFFF; backend.bigEndian ? out.push(v >> 8, v) : out.push(v, v >> 8); } emit(out, line); continue; }
    if (/^(dc\.l|dl|\.dl|\.long)$/.test(mnem)) { const out = []; for (const a of splitOperands(args)) { const v = ev(a).v >>> 0; backend.bigEndian ? out.push(v >>> 24, v >>> 16, v >>> 8, v) : out.push(v, v >>> 8, v >>> 16, v >>> 24); } emit(out, line); continue; }
    if (/^(ds\.b|ds|\.ds|\.res)$/.test(mnem)) { const [n, f] = splitOperands(args); emit(new Array(ev(n).v).fill(f ? ev(f).v : 0), line); continue; }
    if (mnem === 'even' || mnem === '.even') { if (pc & 1) emit([0], line); continue; }
    if (mnem === 'align' || mnem === '.align') { const n = ev(args).v; const k = (n - (pc % n)) % n; if (k) emit(new Array(k).fill(0), line); continue; }
    if (backend.directive && backend.directive(mnem, args, state)) continue;
    let bytes;
    try { bytes = backend.encode(mnem, args, { pc, ev: (s) => ev(s), state, pass, line }); }
    catch (e) { if (e instanceof AsmError) throw e; throw new AsmError(e.message, line); }
    emit(bytes, line);
  }
  return { defined, chunks: chunks.filter((c) => c.bytes.length), listing, unknownUsed };
}

// Put assembled chunks into a ROM. `toOffset(cpuAddress)` turns an address into a file offset.
function place(rom, chunks, toOffset = (a) => a) {
  const out = Buffer.from(rom);
  for (const c of chunks) { const o = toOffset(c.org); if (o < 0 || o + c.bytes.length > out.length) throw new Error(`code at $${c.org.toString(16)} falls outside the ROM`); Buffer.from(c.bytes).copy(out, o); }
  return out;
}

module.exports = { assemble, evaluate, splitOperands, place, AsmError, num };
