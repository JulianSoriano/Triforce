'use strict';
// Assemblers. assemble(cpu, source, { org, symbols, m16, x16 }) -> { bytes, chunks, symbols, listing }
const { assemble: run, place, AsmError } = require('./common');
const { backend6502, backend816 } = require('./asm65');
const { backend68k } = require('./asm68k');
const { backendZ80, backendSM83 } = require('./asmz80');

const BACKENDS = { m68k: backend68k, '6502': backend6502, '65816': backend816, z80: backendZ80, sm83: backendSM83 };
function assemble(cpu, source, opts = {}) {
  const b = BACKENDS[cpu]; if (!b) throw new Error('assembler CPU must be one of: ' + Object.keys(BACKENDS).join(', '));
  const r = run(b, source, opts);
  const bytes = r.chunks.length === 1 ? Buffer.from(r.chunks[0].bytes) : null;
  return Object.assign(r, { bytes });
}
module.exports = { assemble, place, AsmError, BACKENDS };
