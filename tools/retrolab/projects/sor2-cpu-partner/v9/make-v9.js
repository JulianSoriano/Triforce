#!/usr/bin/env node
'use strict';
// CPU Partner v9 = v8 plus small patches to the partner's brain (no compiler needed: each patch replaces bytes at a
// known address and checks the old bytes first). Usage: node make-v9.js "<v8 rom>" out.md [--only name,name]
// Addresses are in the v8 ROM's compiled C code (ai.c): see README.md in this folder for what each one does.
const fs = require('fs');
const crypto = require('crypto');
const PATCHES = [
  // 1. Partner jump-kick cooldown 40 -> 180 frames (JK_CD in ai.c): "move.b #$28,75(a0)" -> "#$B4"
  { name: 'jk-cooldown', at: 0x1FA3D0, old: '0028', now: '00b4' },
  // 2. Partner jump-kick range 32..90 -> 48..80 (JK_MIN, JK_MAX): it closes a real gap instead of kicking up close
  { name: 'jk-min', at: 0x1FA3A2, old: '7020', now: '7030' },
  { name: 'jk-max', at: 0x1FA3AA, old: '705a', now: '7050' },
  // 3. Nothing to fight: head for the middle-right of the screen (camera + 230) and never more than 150 ahead of the
  //    human, instead of the far right edge (camera + 400): the partner no longer presses into the side of the screen
  //    or drags the camera away from the human. The new code is idle-target.s, placed in free ROM at $1FAC00;
  //    the old 3 instructions at $1FA5F0 become a jump to it.
  { name: 'idle-target-code', at: 0x1FAC00, old: 'ff'.repeat(30), now: '202f003cd0bc000000e6222f0074d2bc00000096b0816f022001' + '2f40007c4ef9001fa5fe' },
  { name: 'idle-target-hook', at: 0x1FA5F0, old: '203c00000190d0af003c2f40007c', now: '4ef9001fac00' + '4e714e714e714e71' },
];
const [romFile, out, ...rest] = process.argv.slice(2);
if (!out) { console.error('usage: make-v9.js <v8 rom> <out rom> [--only a,b]'); process.exit(1); }
const only = rest[0] === '--only' ? rest[1].split(',') : null;
const rom = Buffer.from(fs.readFileSync(romFile));
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
if (sha(rom) !== 'c7d140896d1010ab4e52a0de081a59a9e81a111c') { console.error('This is not CPU Partner v8 (SHA-1 c7d14089...).'); process.exit(1); }
for (const p of PATCHES) {
  if (only && !only.includes(p.name)) continue;
  const old = Buffer.from(p.old, 'hex'), now = Buffer.from(p.now, 'hex');
  if (!rom.subarray(p.at, p.at + old.length).equals(old)) { console.error(`${p.name}: unexpected bytes at $${p.at.toString(16)}`); process.exit(1); }
  now.copy(rom, p.at); console.log(`applied ${p.name}`);
}
let s = 0; for (let i = 0x200; i + 1 < rom.length; i += 2) s = (s + rom.readUInt16BE(i)) & 0xFFFF;
rom.writeUInt16BE(s, 0x18E);
fs.writeFileSync(out, rom); console.log(`${out}  SHA-1 ${sha(rom)}`);
