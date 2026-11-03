#!/usr/bin/env node
'use strict';
// Rebuilds the original "Streets of Rage 2 (USA)" ROM from a CPU Partner v8 ROM, using the patch list in the
// mod's own build.py (each patch records the original bytes it replaced). Usage:
//   node rebuild-original.js "Streets of Rage 2 - CPU Partner v8.md" path/to/source/build.py out.md
const fs = require('fs');
const crypto = require('crypto');
const [romFile, buildPy, out] = process.argv.slice(2);
if (!out) { console.error('usage: rebuild-original.js <v8 rom> <build.py> <out rom>'); process.exit(1); }
const py = fs.readFileSync(buildPy, 'utf8');
const rom = Buffer.from(fs.readFileSync(romFile));
// the patch tuples: (0x0007CC, '31f8fc08fc6e', ...) plus the special-move list at the end
const pats = [...py.matchAll(/\(\s*0x([0-9a-f]+)\s*,\s*'([0-9a-f]+)'/gi)].map((m) => [parseInt(m[1], 16), Buffer.from(m[2], 'hex')]);
const sm = /'516a00804e75'[^\n]*for a in \(([^)]+)\)/.exec(py);
if (sm) for (const a of sm[1].split(',')) pats.push([parseInt(a.trim(), 16), Buffer.from('516a00804e75', 'hex')]);
for (const [a, orig] of pats) orig.copy(rom, a);
rom.fill(0xFF, 0x1F8000, 0x200000);                       // the mod's code area was empty in the original
let s = 0; for (let i = 0x200; i < rom.length; i += 2) s = (s + rom.readUInt16BE(i)) & 0xFFFF;
rom.writeUInt16BE(s, 0x18E);
fs.writeFileSync(out, rom);
const sha = crypto.createHash('sha1').update(rom).digest('hex');
console.log(`${pats.length} patches undone -> ${out}\nSHA-1 ${sha}${sha === '8b656eec9692d88bbbb84787142aa732b44ce0be' ? ' (matches the original v8.ips applies to)' : ' (UNEXPECTED: check the inputs)'}`);
