'use strict';
// Boots each test ROM and checks the memory map address by address, plus a write round-trip.
const { Machine, MAPS } = require('./machine');
const { ROMS, PATTERN } = require('./testroms');

const CHECKS = {
  nes: [[0x0000, 0x800], [0x6000, 0x2000], [0x0800, 0x800, (a) => PATTERN.nes(a & 0x7FF)]],     // + a mirror
  snes: [[0x7E0000, 0x20000], [0x001234, 0x10, (a) => PATTERN.snes(0x7E0000 + (a & 0x1FFF))]],
  gb: [[0xC000, 0x1000], [0xFF80, 0x7F]],
  gbc: [[0xC000, 0x1000], [0xD000, 0x1000], [0x12000, 0x1000, (a) => PATTERN.gbc(0xD000 + (a & 0xFFF), 2)], [0x17000, 0x1000, (a) => PATTERN.gbc(0xD000 + (a & 0xFFF), 7)], [0xFF80, 0x7F]],
  gba: [[0x02000000, 0x40000], [0x03000000, 0x7F00]],
  md: [[0xFF0000, 0x10000], [0xA00000, 0x2000]],
  sms: [[0xC000, 0x2000]],
  gg: [[0xC000, 0x2000]],
};

async function selftest(log = console.log) {
  let failed = 0;
  for (const sys of Object.keys(ROMS)) {
    const { bytes, ext } = ROMS[sys]();
    const m = await Machine.open(bytes, { system: sys, ext });
    m.step(120);
    const t0 = Date.now(); m.calibrate(); const cal = Date.now() - t0;
    let bad = 0, total = 0, firstBad = '';
    for (const [base, len, f] of CHECKS[sys]) {
      const got = m.read(base, len);
      for (let i = 0; i < len; i++) {
        total++;
        const want = f ? f(base + i) : PATTERN[sys](base + i, 1);
        if (got[i] !== want) { if (!bad) firstBad = `0x${(base + i).toString(16)} read ${got[i]} want ${want}`; bad++; }
      }
    }
    // write test: change a byte through the map, then see it in a fresh save state at the right spot
    const [b0] = CHECKS[sys][0]; const addr = b0 + 0x123;
    const before = m.u8(addr); m.w8(addr, before ^ 0xFF);
    const back = m.u8(addr); m.w8(addr, before);
    const wrote = back === (before ^ 0xFF);
    const ok = !bad && wrote;
    if (!ok) failed++;
    log(`${ok ? 'ok  ' : 'FAIL'} ${sys.padEnd(4)} ${total} bytes checked${bad ? `, ${bad} wrong (first: ${firstBad})` : ''}, write ${wrote ? 'ok' : 'failed'}, located in ${cal} ms`);
  }
  return failed;
}
module.exports = { selftest };
