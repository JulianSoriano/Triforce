'use strict';
// Tiny homebrew test ROMs, one per system. Each fills the console's work RAM with a known pattern and then
// loops forever. `retrolab selftest` boots them and checks that every address reads back as expected,
// which proves the memory map (where each console address lives inside the emulator) is right.
// They are written byte by byte here so the toolkit needs no assembler.

// The value each test ROM writes at a console address.
const PATTERN = {
  nes: (a) => (a & 0xFF) ^ ((a >> 8) & 0xFF),                       // $0000-$07FF and $6000-$7FFF
  snes: (a) => (a & 0xFF) ^ (a >= 0x7F0000 ? 0xFF : 0),             // $7E0000-$7FFFFF
  gb: (a) => (a & 0xFF) ^ ((a >> 8) & 0xFF),                        // $C000-$DFFF, $FF80-$FFFE
  gbc: (a, bank) => (a & 0xFF) ^ ((a >> 8) & 0xFF) ^ (a >= 0xD000 && bank > 1 ? bank : 0),
  gba: (a) => ((a ^ (a >>> 8)) & 0xFF) ^ (a >= 0x03000000 ? 0x55 : 0),   // $02000000 EWRAM, $03000000 IWRAM (first 0x7F00)
  md: (a) => ((a ^ (a >>> 8)) & 0xFF) ^ (a < 0xFF0000 ? 0x55 : 0),        // $FF0000-$FFFFFF, Z80 $A00000-$A01FFF
  sms: (a) => (a & 0xFF) ^ ((a >> 8) & 0xFF),                       // $C000-$DFFF
};
PATTERN.gg = PATTERN.sms;

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

function nes() {
  // iNES, mapper 0, 1 x 16 KB PRG, 1 x 8 KB CHR, battery flag so $6000-$7FFF is RAM
  const header = hex('4E45531A 01 01 02 00 0000000000000000');
  const prg = Buffer.alloc(0x4000, 0xFF);
  const code = [0x78, 0xD8, 0xA2, 0xFF, 0x9A];            // sei / cld / ldx #$FF / txs
  const pages = []; for (let p = 0; p < 8; p++) pages.push(p); for (let p = 0x60; p < 0x80; p++) pages.push(p);
  for (const p of pages) code.push(0xA2, 0x00, 0x8A, 0x49, p, 0x9D, 0x00, p, 0xE8, 0xD0, 0xF7);   // ldx #0 / L: txa / eor #p / sta $p00,x / inx / bne L
  const loop = 0xC000 + code.length; code.push(0x4C, loop & 0xFF, loop >> 8);                     // jmp *
  Buffer.from(code).copy(prg, 0);
  prg.writeUInt16LE(0xC000, 0x3FFA); prg.writeUInt16LE(0xC000, 0x3FFC); prg.writeUInt16LE(0xC000, 0x3FFE);
  return Buffer.concat([header, prg, Buffer.alloc(0x2000)]);
}

function snes() {
  const rom = Buffer.alloc(0x8000, 0xFF);
  hex(`78 18 FB C2 10 E2 20 A2 00 00
       8A 9F 00 00 7E E8 D0 F8
       8A 49 FF 9F 00 00 7F E8 D0 F6
       80 FE`).copy(rom, 0);
  Buffer.from('RETROLAB SELFTEST    ', 'ascii').copy(rom, 0x7FC0);
  rom[0x7FD5] = 0x20; rom[0x7FD6] = 0x00; rom[0x7FD7] = 0x05; rom[0x7FD8] = 0x00; rom[0x7FD9] = 0x01; rom[0x7FDA] = 0x33; rom[0x7FDB] = 0x00;
  rom.writeUInt16LE(0x8000, 0x7FFC);                       // reset vector (emulation mode)
  rom.writeUInt16LE(0x0000, 0x7FDC); rom.writeUInt16LE(0xFFFF, 0x7FDE);
  let sum = 0; for (const b of rom) sum = (sum + b) & 0xFFFF;
  rom.writeUInt16LE(sum ^ 0xFFFF, 0x7FDC); rom.writeUInt16LE(sum, 0x7FDE);
  return rom;
}

function gb(color) {
  const rom = Buffer.alloc(0x8000, 0x00);
  hex('00 C3 50 01').copy(rom, 0x100);                     // nop / jp $0150
  hex('CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DDDDD999BBBB67636E0EECCCDDDC999FBBB9333E').copy(rom, 0x104);
  Buffer.from('RETROLABTEST', 'ascii').copy(rom, 0x134);
  rom[0x143] = color ? 0xC0 : 0x00; rom[0x147] = 0; rom[0x148] = 0; rom[0x149] = 0; rom[0x14A] = 1;
  hex(`F3 21 00 C0
       7D AC 22 7C FE E0 20 F8
       0E 02
       79 E0 70 21 00 D0
       7D AC A9 22 7C FE E0 20 F7
       0C 79 FE 08 20 EB
       3E 01 E0 70
       21 80 FF
       7D AC 22 7D FE FF 20 F8
       18 FE`).copy(rom, 0x150);
  let c = 0; for (let i = 0x134; i <= 0x14C; i++) c = (c - rom[i] - 1) & 0xFF; rom[0x14D] = c;
  let g = 0; for (let i = 0; i < rom.length; i++) if (i !== 0x14E && i !== 0x14F) g = (g + rom[i]) & 0xFFFF; rom.writeUInt16BE(g, 0x14E);
  return rom;
}

function gba() {
  const rom = Buffer.alloc(0x400, 0x00);
  rom.writeUInt32LE(0xEA00002E, 0);                        // b 0xC0
  Buffer.from('RETROLABTEST', 'ascii').copy(rom, 0xA0); Buffer.from('ARLT01', 'ascii').copy(rom, 0xAC);
  rom[0xB2] = 0x96;
  let c = 0; for (let i = 0xA0; i <= 0xBC; i++) c = (c - rom[i]) & 0xFF; rom[0xBD] = (c - 0x19) & 0xFF;
  const words = [
    0xE3A00402, 0xE3A01701,                                // mov r0,#0x02000000 / mov r1,#0x40000
    0xE0202420, 0xE4C02001, 0xE2511001, 0x1AFFFFFB,        // L: eor r2,r0,r0,lsr #8 / strb r2,[r0],#1 / subs r1,r1,#1 / bne L
    0xE3A00403, 0xE3A01C7F,                                // mov r0,#0x03000000 / mov r1,#0x7F00 (the top of IWRAM is left for the BIOS)
    0xE0202420, 0xE2222055, 0xE4C02001, 0xE2511001, 0x1AFFFFFA,   // same, with eor r2,r2,#0x55
    0xEAFFFFFE,                                            // b .
  ];
  words.forEach((w, i) => rom.writeUInt32LE(w >>> 0, 0xC0 + i * 4));
  return rom;
}

function md() {
  const rom = Buffer.alloc(0x400, 0xFF);
  rom.writeUInt32BE(0x00FFFE00, 0); rom.writeUInt32BE(0x00000200, 4);
  for (let v = 8; v < 0x100; v += 4) rom.writeUInt32BE(0x00000200, v);
  Buffer.from('SEGA MEGA DRIVE (C)RLAB 2026.NOV RETROLAB SELFTEST', 'ascii').copy(rom, 0x100);
  rom.writeUInt32BE(0, 0x1A0); rom.writeUInt32BE(0x3FF, 0x1A4); rom.writeUInt32BE(0xFF0000, 0x1A8); rom.writeUInt32BE(0xFFFFFF, 0x1AC);
  Buffer.from('JUE', 'ascii').copy(rom, 0x1F0);
  hex(`46FC2700
       41F900FF0000 323CFFFF
       2008 2400 E08A B500 10C0 51C9FFF4
       33FC010000A11100 33FC010000A11200
       0839000000A11100 66F6
       41F900A00000 323C1FFF
       2008 2400 E08A B500 0A000055 10C0 51C9FFF0
       60FE`).copy(rom, 0x200);
  // checksum over 0x200..end
  let s = 0; for (let i = 0x200; i < rom.length; i += 2) s = (s + rom.readUInt16BE(i)) & 0xFFFF; rom.writeUInt16BE(s, 0x18E);
  return rom;
}

function sms(gg) {
  const rom = Buffer.alloc(0x8000, 0xFF);
  hex(`F3 31 F0 DF 21 00 C0
       7D AC 77 23 7C FE E0 20 F7
       18 FE`).copy(rom, 0);
  Buffer.from('TMR SEGA', 'ascii').copy(rom, 0x7FF0);
  rom[0x7FFA] = 0; rom[0x7FFB] = 0; rom[0x7FFC] = 0; rom[0x7FFD] = 0; rom[0x7FFE] = 0; rom[0x7FFF] = gg ? 0x6C : 0x4C;
  return rom;
}

const ROMS = {
  nes: () => ({ bytes: nes(), ext: 'nes' }),
  snes: () => ({ bytes: snes(), ext: 'sfc' }),
  gb: () => ({ bytes: gb(false), ext: 'gb' }),
  gbc: () => ({ bytes: gb(true), ext: 'gbc' }),
  gba: () => ({ bytes: gba(), ext: 'gba' }),
  md: () => ({ bytes: md(), ext: 'md' }),
  sms: () => ({ bytes: sms(false), ext: 'sms' }),
  gg: () => ({ bytes: sms(true), ext: 'gg' }),
};
module.exports = { ROMS, PATTERN };
