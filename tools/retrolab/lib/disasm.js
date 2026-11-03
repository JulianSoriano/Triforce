'use strict';
// Disassemblers for the CPUs in the supported consoles:
//   6502 (NES), 65816 (SNES), SM83 (Game Boy), Z80 (Master System, Game Gear, Genesis sound),
//   68000 (Genesis, lib/m68k.js) and ARM / Thumb (GBA, through llvm-objdump when it is installed).
const { execFileSync } = require('child_process');
const { dis68k } = require('./m68k');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hx = (v, d) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(d, '0');
const s8 = (v) => (v > 127 ? v - 256 : v);

// ---------------- 6502 ----------------
const OPS6502 = {};
`00 BRK imp|01 ORA izx|05 ORA zp|06 ASL zp|08 PHP imp|09 ORA imm|0A ASL acc|0D ORA abs|0E ASL abs|10 BPL rel|11 ORA izy|15 ORA zpx|16 ASL zpx|18 CLC imp|19 ORA aby|1D ORA abx|1E ASL abx|
20 JSR abs|21 AND izx|24 BIT zp|25 AND zp|26 ROL zp|28 PLP imp|29 AND imm|2A ROL acc|2C BIT abs|2D AND abs|2E ROL abs|30 BMI rel|31 AND izy|35 AND zpx|36 ROL zpx|38 SEC imp|39 AND aby|3D AND abx|3E ROL abx|
40 RTI imp|41 EOR izx|45 EOR zp|46 LSR zp|48 PHA imp|49 EOR imm|4A LSR acc|4C JMP abs|4D EOR abs|4E LSR abs|50 BVC rel|51 EOR izy|55 EOR zpx|56 LSR zpx|58 CLI imp|59 EOR aby|5D EOR abx|5E LSR abx|
60 RTS imp|61 ADC izx|65 ADC zp|66 ROR zp|68 PLA imp|69 ADC imm|6A ROR acc|6C JMP ind|6D ADC abs|6E ROR abs|70 BVS rel|71 ADC izy|75 ADC zpx|76 ROR zpx|78 SEI imp|79 ADC aby|7D ADC abx|7E ROR abx|
81 STA izx|84 STY zp|85 STA zp|86 STX zp|88 DEY imp|8A TXA imp|8C STY abs|8D STA abs|8E STX abs|90 BCC rel|91 STA izy|94 STY zpx|95 STA zpx|96 STX zpy|98 TYA imp|99 STA aby|9A TXS imp|9D STA abx|
A0 LDY imm|A1 LDA izx|A2 LDX imm|A4 LDY zp|A5 LDA zp|A6 LDX zp|A8 TAY imp|A9 LDA imm|AA TAX imp|AC LDY abs|AD LDA abs|AE LDX abs|B0 BCS rel|B1 LDA izy|B4 LDY zpx|B5 LDA zpx|B6 LDX zpy|B8 CLV imp|B9 LDA aby|BA TSX imp|BC LDY abx|BD LDA abx|BE LDX aby|
C0 CPY imm|C1 CMP izx|C4 CPY zp|C5 CMP zp|C6 DEC zp|C8 INY imp|C9 CMP imm|CA DEX imp|CC CPY abs|CD CMP abs|CE DEC abs|D0 BNE rel|D1 CMP izy|D5 CMP zpx|D6 DEC zpx|D8 CLD imp|D9 CMP aby|DD CMP abx|DE DEC abx|
E0 CPX imm|E1 SBC izx|E4 CPX zp|E5 SBC zp|E6 INC zp|E8 INX imp|E9 SBC imm|EA NOP imp|EC CPX abs|ED SBC abs|EE INC abs|F0 BEQ rel|F1 SBC izy|F5 SBC zpx|F6 INC zpx|F8 SED imp|F9 SBC aby|FD SBC abx|FE INC abx`
  .split('|').forEach((e) => { const [o, m, mode] = e.trim().split(' '); OPS6502[parseInt(o, 16)] = [m, mode]; });
const LEN6502 = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };
function one6502(b, i, pc) {
  const op = OPS6502[b[i]];
  if (!op) return { len: 1, text: `.db ${hx(b[i], 2)}` };
  const [m, mode] = op, n = LEN6502[mode], lo = b[i + 1], w = b[i + 1] | (b[i + 2] << 8);
  const arg = { imp: '', acc: 'A', imm: `#${hx(lo, 2)}`, zp: hx(lo, 2), zpx: `${hx(lo, 2)},X`, zpy: `${hx(lo, 2)},Y`, izx: `(${hx(lo, 2)},X)`, izy: `(${hx(lo, 2)}),Y`, rel: hx((pc + 2 + s8(lo)) & 0xFFFF, 4), abs: hx(w, 4), abx: `${hx(w, 4)},X`, aby: `${hx(w, 4)},Y`, ind: `(${hx(w, 4)})` }[mode];
  return { len: n, text: arg ? `${m} ${arg}` : m, target: mode === 'rel' || ((m === 'JMP' || m === 'JSR') && mode === 'abs') ? (mode === 'rel' ? (pc + 2 + s8(lo)) & 0xFFFF : w) : undefined };
}

// ---------------- 65816 ----------------
const OPS816 = [];
`BRK i8|ORA dxi|COP i8|ORA sr|TSB dp|ORA dp|ASL dp|ORA dil|PHP -|ORA iM|ASL A|PHD -|TSB ab|ORA ab|ASL ab|ORA lg|
BPL r8|ORA diy|ORA di|ORA siy|TRB dp|ORA dpx|ASL dpx|ORA dily|CLC -|ORA aby|INC A|TCS -|TRB ab|ORA abx|ASL abx|ORA lgx|
JSR ab|AND dxi|JSL lg|AND sr|BIT dp|AND dp|ROL dp|AND dil|PLP -|AND iM|ROL A|PLD -|BIT ab|AND ab|ROL ab|AND lg|
BMI r8|AND diy|AND di|AND siy|BIT dpx|AND dpx|ROL dpx|AND dily|SEC -|AND aby|DEC A|TSC -|BIT abx|AND abx|ROL abx|AND lgx|
RTI -|EOR dxi|WDM i8|EOR sr|MVP mv|EOR dp|LSR dp|EOR dil|PHA -|EOR iM|LSR A|PHK -|JMP ab|EOR ab|LSR ab|EOR lg|
BVC r8|EOR diy|EOR di|EOR siy|MVN mv|EOR dpx|LSR dpx|EOR dily|CLI -|EOR aby|PHY -|TCD -|JML lg|EOR abx|LSR abx|EOR lgx|
RTS -|ADC dxi|PER r16|ADC sr|STZ dp|ADC dp|ROR dp|ADC dil|PLA -|ADC iM|ROR A|RTL -|JMP ai|ADC ab|ROR ab|ADC lg|
BVS r8|ADC diy|ADC di|ADC siy|STZ dpx|ADC dpx|ROR dpx|ADC dily|SEI -|ADC aby|PLY -|TDC -|JMP axi|ADC abx|ROR abx|ADC lgx|
BRA r8|STA dxi|BRL r16|STA sr|STY dp|STA dp|STX dp|STA dil|DEY -|BIT iM|TXA -|PHB -|STY ab|STA ab|STX ab|STA lg|
BCC r8|STA diy|STA di|STA siy|STY dpx|STA dpx|STX dpy|STA dily|TYA -|STA aby|TXS -|TXY -|STZ ab|STA abx|STZ abx|STA lgx|
LDY iX|LDA dxi|LDX iX|LDA sr|LDY dp|LDA dp|LDX dp|LDA dil|TAY -|LDA iM|TAX -|PLB -|LDY ab|LDA ab|LDX ab|LDA lg|
BCS r8|LDA diy|LDA di|LDA siy|LDY dpx|LDA dpx|LDX dpy|LDA dily|CLV -|LDA aby|TSX -|TYX -|LDY abx|LDA abx|LDX aby|LDA lgx|
CPY iX|CMP dxi|REP i8|CMP sr|CPY dp|CMP dp|DEC dp|CMP dil|INY -|CMP iM|DEX -|WAI -|CPY ab|CMP ab|DEC ab|CMP lg|
BNE r8|CMP diy|CMP di|CMP siy|PEI di|CMP dpx|DEC dpx|CMP dily|CLD -|CMP aby|PHX -|STP -|JML ail|CMP abx|DEC abx|CMP lgx|
CPX iX|SBC dxi|SEP i8|SBC sr|CPX dp|SBC dp|INC dp|SBC dil|INX -|SBC iM|NOP -|XBA -|CPX ab|SBC ab|INC ab|SBC lg|
BEQ r8|SBC diy|SBC di|SBC siy|PEA i16|SBC dpx|INC dpx|SBC dily|SED -|SBC aby|PLX -|XCE -|JSR axi|SBC abx|INC abx|SBC lgx`
  .split(/[|\n]/).map((e) => e.trim()).filter(Boolean).forEach((e) => { const [m, mode] = e.split(' '); OPS816.push([m, mode]); });
if (OPS816.length !== 256) throw new Error('65816 table has ' + OPS816.length + ' entries');
function one65816(b, i, pc, st) {
  const [m, mode] = OPS816[b[i]];
  const b1 = b[i + 1], w = b[i + 1] | (b[i + 2] << 8), l = w | (b[i + 3] << 16);
  const bank = pc & 0xFF0000;
  let len = 1, arg = '', target;
  switch (mode) {
    case '-': break;
    case 'A': arg = 'A'; break;
    case 'i8': len = 2; arg = `#${hx(b1, 2)}`; break;
    case 'i16': len = 3; arg = `#${hx(w, 4)}`; break;
    case 'iM': len = st.m16 ? 3 : 2; arg = st.m16 ? `#${hx(w, 4)}` : `#${hx(b1, 2)}`; break;
    case 'iX': len = st.x16 ? 3 : 2; arg = st.x16 ? `#${hx(w, 4)}` : `#${hx(b1, 2)}`; break;
    case 'dp': len = 2; arg = hx(b1, 2); break;
    case 'dpx': len = 2; arg = `${hx(b1, 2)},X`; break;
    case 'dpy': len = 2; arg = `${hx(b1, 2)},Y`; break;
    case 'di': len = 2; arg = `(${hx(b1, 2)})`; break;
    case 'dil': len = 2; arg = `[${hx(b1, 2)}]`; break;
    case 'dxi': len = 2; arg = `(${hx(b1, 2)},X)`; break;
    case 'diy': len = 2; arg = `(${hx(b1, 2)}),Y`; break;
    case 'dily': len = 2; arg = `[${hx(b1, 2)}],Y`; break;
    case 'sr': len = 2; arg = `${hx(b1, 2)},S`; break;
    case 'siy': len = 2; arg = `(${hx(b1, 2)},S),Y`; break;
    case 'ab': len = 3; arg = hx(w, 4); if (m === 'JMP' || m === 'JSR') target = bank | w; break;
    case 'abx': len = 3; arg = `${hx(w, 4)},X`; break;
    case 'aby': len = 3; arg = `${hx(w, 4)},Y`; break;
    case 'ai': len = 3; arg = `(${hx(w, 4)})`; break;
    case 'ail': len = 3; arg = `[${hx(w, 4)}]`; break;
    case 'axi': len = 3; arg = `(${hx(w, 4)},X)`; break;
    case 'lg': len = 4; arg = hx(l, 6); if (m === 'JSL' || m === 'JML') target = l; break;
    case 'lgx': len = 4; arg = `${hx(l, 6)},X`; break;
    case 'r8': len = 2; target = bank | ((pc + 2 + s8(b1)) & 0xFFFF); arg = hx(target, 6); break;
    case 'r16': len = 3; target = bank | ((pc + 3 + (w > 32767 ? w - 65536 : w)) & 0xFFFF); arg = hx(target, 6); break;
    case 'mv': len = 3; arg = `${hx(b[i + 2], 2)},${hx(b1, 2)}`; break;
  }
  // REP/SEP change the register widths for what follows (a straight-line guess; branches can disagree)
  if (m === 'REP') { if (b1 & 0x20) st.m16 = true; if (b1 & 0x10) st.x16 = true; }
  if (m === 'SEP') { if (b1 & 0x20) st.m16 = false; if (b1 & 0x10) st.x16 = false; }
  return { len, text: arg ? `${m} ${arg}` : m, target };
}

// ---------------- Z80 and SM83 (decoded by the opcode's bit fields) ----------------
const Z = {
  r: ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'], rp: ['BC', 'DE', 'HL', 'SP'], rp2: ['BC', 'DE', 'HL', 'AF'],
  cc: ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'], alu: ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '],
  rot: ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'], im: ['0', '0/1', '1', '2', '0', '0/1', '1', '2'],
  bli: [['LDI', 'CPI', 'INI', 'OUTI'], ['LDD', 'CPD', 'IND', 'OUTD'], ['LDIR', 'CPIR', 'INIR', 'OTIR'], ['LDDR', 'CPDR', 'INDR', 'OTDR']],
};
function oneZ80(b, i, pc) {
  let p0 = i, ix = null, d = null;
  if (b[i] === 0xDD || b[i] === 0xFD) { ix = b[i] === 0xDD ? 'IX' : 'IY'; i++; if (b[i] === 0xDD || b[i] === 0xFD || b[i] === 0xED) return { len: 1, text: 'NOP*' }; }
  const op = b[i];
  const n8 = () => b[i + 1 + (d !== null ? 1 : 0)], n16 = () => b[i + 1] | (b[i + 2] << 8);
  const usesHLind = (x, y, z) => (x === 1 && (y === 6 || z === 6) && !(y === 6 && z === 6)) || (x === 2 && z === 6) || (x === 0 && (z === 4 || z === 5 || z === 6) && y === 6);
  const R = (k, keepHL) => { if (!ix) return Z.r[k]; if (k === 6) return `(${ix}${d >= 0 ? '+' : ''}${d})`; if (keepHL) return Z.r[k]; return k === 4 ? ix + 'H' : k === 5 ? ix + 'L' : Z.r[k]; };
  const RP = (k) => (k === 2 && ix ? ix : Z.rp[k]), RP2 = (k) => (k === 2 && ix ? ix : Z.rp2[k]);
  if (op === 0xCB) {
    if (ix) { d = s8(b[i + 1]); const o2 = b[i + 2], x = o2 >> 6, y = (o2 >> 3) & 7, z = o2 & 7; const m = `(${ix}${d >= 0 ? '+' : ''}${d})`;
      const t = x === 0 ? `${Z.rot[y]} ${m}` : x === 1 ? `BIT ${y},${m}` : x === 2 ? `RES ${y},${m}` : `SET ${y},${m}`;
      return { len: i - p0 + 3, text: t + (x !== 1 && z !== 6 ? ',' + Z.r[z] : '') }; }
    const o2 = b[i + 1], x = o2 >> 6, y = (o2 >> 3) & 7, z = o2 & 7;
    return { len: 2, text: x === 0 ? `${Z.rot[y]} ${Z.r[z]}` : `${['', 'BIT', 'RES', 'SET'][x]} ${y},${Z.r[z]}` };
  }
  if (op === 0xED && !ix) {
    const o2 = b[i + 1], x = o2 >> 6, y = (o2 >> 3) & 7, z = o2 & 7, p = y >> 1, q = y & 1, w = b[i + 2] | (b[i + 3] << 8);
    if (x === 1) {
      if (z === 0) return { len: 2, text: y === 6 ? 'IN (C)' : `IN ${Z.r[y]},(C)` };
      if (z === 1) return { len: 2, text: y === 6 ? 'OUT (C),0' : `OUT (C),${Z.r[y]}` };
      if (z === 2) return { len: 2, text: `${q ? 'ADC' : 'SBC'} HL,${Z.rp[p]}` };
      if (z === 3) return { len: 4, text: q ? `LD ${Z.rp[p]},(${hx(w, 4)})` : `LD (${hx(w, 4)}),${Z.rp[p]}` };
      if (z === 4) return { len: 2, text: 'NEG' };
      if (z === 5) return { len: 2, text: y === 1 ? 'RETI' : 'RETN' };
      if (z === 6) return { len: 2, text: `IM ${Z.im[y]}` };
      return { len: 2, text: ['LD I,A', 'LD R,A', 'LD A,I', 'LD A,R', 'RRD', 'RLD', 'NOP*', 'NOP*'][y] };
    }
    if (x === 2 && z <= 3 && y >= 4) return { len: 2, text: Z.bli[y - 4][z] };
    return { len: 2, text: 'NOP*' };
  }
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  if (ix && usesHLind(x, y, z)) d = s8(b[i + 1]);
  const ext = d !== null ? 1 : 0, base = i - p0 + 1 + ext;
  let len = base, t, target;
  if (x === 0) {
    if (z === 0) {
      if (y === 0) t = 'NOP'; else if (y === 1) t = "EX AF,AF'";
      else { target = (pc + 2 + s8(b[i + 1])) & 0xFFFF; len = 2; t = y === 2 ? `DJNZ ${hx(target, 4)}` : y === 3 ? `JR ${hx(target, 4)}` : `JR ${Z.cc[y - 4]},${hx(target, 4)}`; }
    } else if (z === 1) { if (q) t = `ADD ${RP(2)},${RP(p)}`; else { len = base + 2; t = `LD ${RP(p)},${hx(n16(), 4)}`; } }
    else if (z === 2) {
      if (p >= 2) { len = base + 2; const w = n16(); t = q ? (p === 2 ? `LD ${RP(2)},(${hx(w, 4)})` : `LD A,(${hx(w, 4)})`) : (p === 2 ? `LD (${hx(w, 4)}),${RP(2)}` : `LD (${hx(w, 4)}),A`); }
      else t = q ? `LD A,(${Z.rp[p]})` : `LD (${Z.rp[p]}),A`;
    } else if (z === 3) t = `${q ? 'DEC' : 'INC'} ${RP(p)}`;
    else if (z === 4) t = `INC ${R(y)}`; else if (z === 5) t = `DEC ${R(y)}`;
    else if (z === 6) { len = base + 1; t = `LD ${R(y)},${hx(n8(), 2)}`; }
    else t = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'][y];
  } else if (x === 1) t = y === 6 && z === 6 ? 'HALT' : `LD ${R(y, z === 6)},${R(z, y === 6)}`;
  else if (x === 2) t = `${Z.alu[y]}${R(z)}`;
  else {
    const w = n16();
    if (z === 0) t = `RET ${Z.cc[y]}`;
    else if (z === 1) t = q ? ['RET', 'EXX', `JP (${RP(2)})`, `LD SP,${RP(2)}`][p] : `POP ${RP2(p)}`;
    else if (z === 2) { len = base + 2; target = w; t = `JP ${Z.cc[y]},${hx(w, 4)}`; }
    else if (z === 3) {
      if (y === 0) { len = base + 2; target = w; t = `JP ${hx(w, 4)}`; }
      else if (y === 2) { len = base + 1; t = `OUT (${hx(b[i + 1], 2)}),A`; } else if (y === 3) { len = base + 1; t = `IN A,(${hx(b[i + 1], 2)})`; }
      else t = { 4: `EX (SP),${RP(2)}`, 5: 'EX DE,HL', 6: 'DI', 7: 'EI' }[y];
    } else if (z === 4) { len = base + 2; target = w; t = `CALL ${Z.cc[y]},${hx(w, 4)}`; }
    else if (z === 5) { if (q) { len = base + 2; target = w; t = `CALL ${hx(w, 4)}`; } else t = `PUSH ${RP2(p)}`; }
    else if (z === 6) { len = base + 1; t = `${Z.alu[y]}${hx(n8(), 2)}`; }
    else { target = y * 8; t = `RST ${hx(y * 8, 2)}`; }
  }
  return { len, text: t, target };
}
function oneSM83(b, i, pc) {
  const op = b[i], x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  const n8 = b[i + 1], w = b[i + 1] | (b[i + 2] << 8), r = Z.r, cc = ['NZ', 'Z', 'NC', 'C'];
  if (op === 0xCB) { const o = b[i + 1], X = o >> 6, Y = (o >> 3) & 7, Zz = o & 7; return { len: 2, text: X === 0 ? `${['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SWAP', 'SRL'][Y]} ${r[Zz]}` : `${['', 'BIT', 'RES', 'SET'][X]} ${Y},${r[Zz]}` }; }
  let len = 1, t, target;
  if (x === 0) {
    if (z === 0) {
      if (y === 0) t = 'NOP'; else if (y === 1) { len = 3; t = `LD (${hx(w, 4)}),SP`; } else if (y === 2) { len = 2; t = 'STOP'; }
      else { len = 2; target = (pc + 2 + s8(n8)) & 0xFFFF; t = y === 3 ? `JR ${hx(target, 4)}` : `JR ${cc[y - 4]},${hx(target, 4)}`; }
    } else if (z === 1) { if (q) t = `ADD HL,${Z.rp[p]}`; else { len = 3; t = `LD ${Z.rp[p]},${hx(w, 4)}`; } }
    else if (z === 2) { const m = ['(BC)', '(DE)', '(HL+)', '(HL-)'][p]; t = q ? `LD A,${m}` : `LD ${m},A`; }
    else if (z === 3) t = `${q ? 'DEC' : 'INC'} ${Z.rp[p]}`;
    else if (z === 4) t = `INC ${r[y]}`; else if (z === 5) t = `DEC ${r[y]}`;
    else if (z === 6) { len = 2; t = `LD ${r[y]},${hx(n8, 2)}`; }
    else t = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'][y];
  } else if (x === 1) t = op === 0x76 ? 'HALT' : `LD ${r[y]},${r[z]}`;
  else if (x === 2) t = `${Z.alu[y]}${r[z]}`;
  else {
    if (z === 0) { if (y < 4) t = `RET ${cc[y]}`; else if (y === 4) { len = 2; t = `LDH (${hx(0xFF00 + n8, 4)}),A`; } else if (y === 5) { len = 2; t = `ADD SP,${s8(n8)}`; } else if (y === 6) { len = 2; t = `LDH A,(${hx(0xFF00 + n8, 4)})`; } else { len = 2; t = `LD HL,SP${s8(n8) >= 0 ? '+' : ''}${s8(n8)}`; } }
    else if (z === 1) t = q ? ['RET', 'RETI', 'JP HL', 'LD SP,HL'][p] : `POP ${Z.rp2[p]}`;
    else if (z === 2) { if (y < 4) { len = 3; target = w; t = `JP ${cc[y]},${hx(w, 4)}`; } else if (y === 4) t = 'LD (C),A'; else if (y === 5) { len = 3; t = `LD (${hx(w, 4)}),A`; } else if (y === 6) t = 'LD A,(C)'; else { len = 3; t = `LD A,(${hx(w, 4)})`; } }
    else if (z === 3) { if (y === 0) { len = 3; target = w; t = `JP ${hx(w, 4)}`; } else if (y === 6) t = 'DI'; else if (y === 7) t = 'EI'; else t = `.db ${hx(op, 2)}`; }
    else if (z === 4) { if (y < 4) { len = 3; target = w; t = `CALL ${cc[y]},${hx(w, 4)}`; } else t = `.db ${hx(op, 2)}`; }
    else if (z === 5) { if (!q) t = `PUSH ${Z.rp2[p]}`; else if (p === 0) { len = 3; target = w; t = `CALL ${hx(w, 4)}`; } else t = `.db ${hx(op, 2)}`; }
    else if (z === 6) { len = 2; t = `${Z.alu[y]}${hx(n8, 2)}`; }
    else { target = y * 8; t = `RST ${hx(y * 8, 2)}`; }
  }
  return { len, text: t, target };
}

// ---------------- ARM / Thumb through llvm-objdump ----------------
function llvmObjdump() { for (const c of ['llvm-objdump', 'llvm-objdump-18', 'llvm-objdump-17', 'llvm-objdump-19']) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* next */ } } return null; }
function elfWrap(data, machine, bigEndian) {
  const shstr = Buffer.from('\0.text\0.shstrtab\0', 'latin1'), eh = 52, offText = eh, offStr = offText + data.length, offSh = (offStr + shstr.length + 3) & ~3;
  const W16 = (b, v, o) => (bigEndian ? b.writeUInt16BE(v, o) : b.writeUInt16LE(v, o)), W32 = (b, v, o) => (bigEndian ? b.writeUInt32BE(v >>> 0, o) : b.writeUInt32LE(v >>> 0, o));
  const out = Buffer.alloc(offSh + 40 * 3);
  Buffer.from([0x7F, 0x45, 0x4C, 0x46, 1, bigEndian ? 2 : 1, 1, 0]).copy(out, 0);
  W16(out, 1, 16); W16(out, machine, 18); W32(out, 1, 20); W32(out, offSh, 32); W16(out, eh, 40); W16(out, 40, 46); W16(out, 3, 48); W16(out, 2, 50);
  data.copy(out, offText); shstr.copy(out, offStr);
  const sh = (k, name, type, flags, off, size) => { const o = offSh + 40 * k; W32(out, name, o); W32(out, type, o + 4); W32(out, flags, o + 8); W32(out, off, o + 16); W32(out, size, o + 20); W32(out, 2, o + 32); };
  sh(1, 1, 1, 6, offText, data.length); sh(2, 7, 3, 0, offStr, shstr.length);
  return out;
}
function viaLLVM(cpu, data, org) {
  const tool = llvmObjdump();
  if (!tool) throw new Error(`The ${cpu} disassembler needs llvm-objdump (part of LLVM) installed.`);
  const spec = { arm: [40, false, 'armv4t'], thumb: [40, false, 'thumbv4t'] }[cpu];
  const tmp = path.join(os.tmpdir(), `retrolab-${process.pid}-${Date.now()}.o`);
  fs.writeFileSync(tmp, elfWrap(Buffer.from(data), spec[0], spec[1]));
  try {
    const txt = execFileSync(tool, ['-d', '--no-show-raw-insn', `--triple=${spec[2]}`, `--adjust-vma=${org}`, tmp], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const lines = [];
    for (const l of txt.split('\n')) {
      const m = /^\s*([0-9a-f]+):\s+(.*)$/.exec(l); if (!m) continue;
      const a = parseInt(m[1], 16); let t = m[2].replace(/\s+/g, ' ').trim();
      t = t.replace(/\s*<[^>]*>/, '').replace(/\s*@.*$/, '').replace(/<unknown>/, '(not code)');
      lines.push({ addr: a, text: t });
    }
    return lines;
  } finally { fs.unlinkSync(tmp); }
}

// Disassemble `len` bytes of `rom` starting at file offset `start`, with `org` = the CPU address of that byte.
function disassemble(cpu, rom, start, len, org = start, opts = {}) {
  const data = rom.subarray(start, start + len);
  if (cpu === 'arm' || cpu === 'thumb') {
    const lines = viaLLVM(cpu, data, org);
    return lines.map((l, k) => { const next = k + 1 < lines.length ? lines[k + 1].addr : org + len; const o = l.addr - org; return { addr: l.addr, bytes: Buffer.from(data.subarray(o, Math.min(o + (next - l.addr), o + 10))).toString('hex'), text: l.text }; });
  }
  const one = { '6502': one6502, '65816': one65816, z80: oneZ80, sm83: oneSM83, m68k: dis68k }[cpu];
  if (!one) throw new Error('CPU must be one of: 6502, 65816, z80, sm83, m68k, arm, thumb');
  const st = { m16: !!opts.m16, x16: !!opts.x16 }, out = [];
  const pad = Buffer.concat([data, Buffer.alloc(12)]);
  for (let i = 0; i < data.length;) {
    const r = one(pad, i, org + i, st);
    out.push({ addr: org + i, bytes: pad.subarray(i, i + r.len).toString('hex'), text: r.text, target: r.target });
    i += r.len;
  }
  return out;
}

// The CPU each system uses, and where a ROM file offset appears in the CPU's address space by default.
const CPU_FOR = { nes: '6502', snes: '65816', gb: 'sm83', gbc: 'sm83', gba: 'arm', md: 'm68k', sms: 'z80', gg: 'z80' };
function defaultOrg(system, rom, offset, snesHi) {
  if (system === 'md') return offset;
  if (system === 'gba') return 0x08000000 + offset;
  if (system === 'gb' || system === 'gbc') return offset < 0x4000 ? offset : 0x4000 + (offset % 0x4000);
  if (system === 'sms' || system === 'gg') return offset < 0xC000 ? offset : 0x8000 + (offset % 0x4000);
  if (system === 'nes') { const prg = offset - 16 - (rom[6] & 4 ? 512 : 0); const banks = rom[4]; return banks === 1 ? 0xC000 + (prg & 0x3FFF) : (prg >= (banks - 1) * 0x4000 ? 0xC000 + (prg & 0x3FFF) : 0x8000 + (prg & 0x3FFF)); }
  if (system === 'snes') { const o = offset - (rom.length % 1024 === 512 ? 512 : 0); return snesHi ? 0xC00000 + o : (((o >> 15) | 0x80) << 16) | 0x8000 | (o & 0x7FFF); }
  return offset;
}
function format(lines) { return lines.map((l) => `${l.addr.toString(16).toUpperCase().padStart(6, '0')}  ${(l.bytes || '').padEnd(20)} ${l.text}`).join('\n'); }

module.exports = { disassemble, format, CPU_FOR, defaultOrg, llvmObjdump };
