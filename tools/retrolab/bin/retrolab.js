#!/usr/bin/env node
'use strict';
// Command line for RetroLab. Run with no arguments for help.
const fs = require('fs');
const path = require('path');
const lab = require('..');

const HELP = `RetroLab - headless tools for studying and modding retro games
Systems: Genesis/Mega Drive, Master System, Game Gear, NES, SNES, Game Boy, Game Boy Color, GBA

  retrolab selftest
      Boot a test ROM on every system and check the whole memory map.
  retrolab info <rom>
      Header details and checksum status.
  retrolab run <rom> [--frames N] [--script FILE | --input "60 RIGHT+A; tap START"]
                     [--load STATE] [--save STATE] [--shot PNG] [--shots DIR --every N] [--scale 2]
      Play the game for a while and save what you need. Script lines: "N" waits N frames,
      "N BUTTONS" holds buttons (RIGHT+A), "N BUTTONS | BUTTONS" adds player 2, "tap START" presses once.
  retrolab peek <rom> <addr> [len] [--load STATE] [--frames N] [--size 1|2|4]
      Read RAM by console address ($FF0000 Genesis, $7E0000 SNES, $0000 NES, $C000 GB...).
  retrolab poke <rom> <addr> <hexbytes> --load STATE --save STATE
      Change RAM inside a save state.
  retrolab trace <rom> <addr,addr,...> [--frames N] [--size 1|2|4] [--load STATE] [--script FILE | --input ...]
                       [--changes] [--every N] [--out CSV]
      Record addresses frame by frame.
  retrolab find <rom> --steps "STEPS" [--load STATE] [--size 1|2|4]
      Narrow down which address holds something. Steps, separated by ";":
        eq N | changed | same | up [N] | down [N] | run SCRIPT-LINE | tap BUTTON | show
      e.g. --steps "run 60; up 1; run 1; up 1; run 1; up 1; show"
  retrolab dis <rom|file> <start> [len] [--cpu 68000|6502|65816|z80|sm83|arm|thumb] [--org ADDR] [--m16] [--x16]
      Disassemble from a file offset. The CPU and the address it runs at come from the system by default.
  retrolab patch <rom> <offset> <hexbytes> [--expect HEX] --out FILE [--fix-checksum]
      Change bytes at a file offset (with --expect, only if the old bytes match).
  retrolab checksum <rom> [--fix --out FILE]
  retrolab ips apply <rom> <patch.ips> --out FILE
  retrolab ips make <original> <modified> --out FILE.ips
  retrolab diff <romA> <romB>
      List the byte ranges that differ.
Numbers can be decimal or hex ($1234 or 0x1234). Add --system md|sms|gg|nes|snes|gb|gbc|gba if the file
extension doesn't say.`;

function args(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) opt[k] = true; else { opt[k] = nx; i++; } }
    else pos.push(a);
  }
  return { pos, opt };
}
const num = (s) => { if (s === undefined || s === true) return undefined; s = String(s).trim(); if (/^\$/.test(s)) return parseInt(s.slice(1), 16); if (/^0x/i.test(s)) return parseInt(s, 16); if (/^[0-9a-f]+h$/i.test(s)) return parseInt(s, 16); return Number(s); };
const hex = (v, d = 2) => '$' + v.toString(16).toUpperCase().padStart(d, '0');

async function open(file, opt, noStep) {
  const m = await lab.Machine.open(file, { system: opt.system });
  if (opt.load) m.loadState(opt.load);
  if (!noStep && opt.frames && !opt.script && !opt.input) m.step(num(opt.frames));
  return m;
}
function script(opt) { return opt.script ? fs.readFileSync(opt.script, 'utf8') : opt.input ? String(opt.input).replace(/;/g, '\n') : null; }

async function main() {
  const { pos, opt } = args(process.argv.slice(2));
  const cmd = pos.shift();
  if (!cmd || cmd === 'help' || opt.help) { console.log(HELP); return; }

  if (cmd === 'selftest') { const failed = await lab.selftest(); process.exitCode = failed ? 1 : 0; return; }

  if (cmd === 'info') {
    const f = pos[0], b = fs.readFileSync(f), sys = opt.system || lab.systemForFile(f, b);
    console.log(JSON.stringify(lab.rom.info(sys, b), null, 2)); return;
  }

  if (cmd === 'run') {
    const m = await open(pos[0], opt, true);
    const sc = script(opt), every = num(opt.every) || 60, scale = num(opt.scale) || 2;
    const onFrame = opt.shots ? (mm) => { if (mm.frame % every === 0) { fs.mkdirSync(opt.shots, { recursive: true }); mm.screenshot(path.join(opt.shots, `f${String(mm.frame).padStart(6, '0')}.png`), scale); } } : undefined;
    if (sc) m.runScript(sc, onFrame);
    if (opt.frames || !sc) m.step(num(opt.frames) || 60, 0, 0, onFrame);
    if (opt.save) m.saveState(opt.save);
    if (opt.shot) m.screenshot(opt.shot, scale);
    console.log(`ran to frame ${m.frame}${opt.save ? ', state saved to ' + opt.save : ''}${opt.shot ? ', screenshot ' + opt.shot : ''}`);
    return;
  }

  if (cmd === 'peek') {
    const m = await open(pos[0], opt); const a = num(pos[1]), n = num(pos[2]) || 16, size = num(opt.size) || 1;
    const data = m.read(a, n);
    for (let i = 0; i < n; i += 16) {
      const row = data.subarray(i, i + 16);
      let vals;
      if (size === 1) vals = [...row].map((v) => v.toString(16).padStart(2, '0')).join(' ');
      else { vals = []; for (let k = 0; k + size <= row.length; k += size) vals.push((size === 2 ? m.u16(a + i + k) : m.u32(a + i + k)).toString(16).padStart(size * 2, '0')); vals = vals.join(' '); }
      console.log(`${hex(a + i, 6)}  ${vals}`);
    }
    return;
  }

  if (cmd === 'poke') {
    if (!opt.load || !opt.save) throw new Error('poke needs --load STATE and --save STATE');
    const m = await open(pos[0], opt); m.write(num(pos[1]), lab.rom.toBytes(pos[2])); m.saveState(opt.save);
    console.log(`wrote ${pos[2]} at ${hex(num(pos[1]), 6)}, saved ${opt.save}`); return;
  }

  if (cmd === 'trace') {
    const m = await open(pos[0], opt);
    const addrs = String(pos[1]).split(',').map(num), size = num(opt.size) || 1, frames = num(opt.frames) || 600;
    const sc = script(opt);
    let rows;
    if (sc) { rows = []; const read = (a) => (size === 1 ? m.u8(a) : size === 2 ? m.u16(a) : m.u32(a)); let last = null;
      m.runScript(sc, (mm) => { if (mm.frame % (num(opt.every) || 1)) return; const v = addrs.map(read); const k = v.join(); if (opt.changes && k === last) return; last = k; rows.push([mm.frame, ...v]); }); }
    else rows = lab.trace(m, addrs, frames, { size, every: num(opt.every) || 1, onlyChanges: !!opt.changes });
    const csv = lab.toCSV(addrs, rows, size * 2);
    if (opt.out) { fs.writeFileSync(opt.out, csv); console.log(`${rows.length} rows written to ${opt.out}`); } else process.stdout.write(csv);
    return;
  }

  if (cmd === 'find') {
    const m = await open(pos[0], opt); const s = new lab.Search(m, num(opt.size) || 1);
    for (const raw of String(opt.steps || '').split(';')) {
      const st = raw.trim(); if (!st) continue; const [w, ...rest] = st.split(/\s+/); const arg = rest.join(' ');
      let n;
      if (w === 'eq') n = s.equals(num(arg)); else if (w === 'changed') n = s.changed(); else if (w === 'same') n = s.unchanged();
      else if (w === 'up') n = s.increased(arg ? num(arg) : undefined); else if (w === 'down') n = s.decreased(arg ? num(arg) : undefined);
      else if (w === 'run') { m.runScript(arg); continue; } else if (w === 'tap') { m.tap(arg); continue; }
      else if (w === 'show') { for (const r of s.results(num(opt.limit) || 40)) console.log(`${hex(r.addr, 6)}  ${r.region.padEnd(6)} ${r.value} (${hex(r.value)})`); continue; }
      else throw new Error('Unknown step: ' + st);
      console.log(`${st.padEnd(12)} -> ${n} candidates`);
    }
    return;
  }

  if (cmd === 'dis') {
    const f = pos[0], b = fs.readFileSync(f), sys = opt.system || lab.systemForFile(f, b);
    const start = num(pos[1]) || 0, len = num(pos[2]) || 0x80;
    const CPUS = { 68000: 'm68k', '68k': 'm68k', m68k: 'm68k', 6502: '6502', 65816: '65816', z80: 'z80', sm83: 'sm83', gbz80: 'sm83', arm: 'arm', thumb: 'thumb' };
    const cpu = opt.cpu ? CPUS[String(opt.cpu).toLowerCase()] : lab.disasm.CPU_FOR[sys];
    if (!cpu) throw new Error('Say which CPU with --cpu');
    const snesHi = sys === 'snes' && lab.rom.snesHeader(b).hirom;
    const org = opt.org !== undefined ? num(opt.org) : sys ? lab.disasm.defaultOrg(sys, b, start, snesHi) : start;
    console.log(lab.disasm.format(lab.disasm.disassemble(cpu, b, start, len, org, { m16: !!opt.m16, x16: !!opt.x16 })));
    return;
  }

  if (cmd === 'patch') {
    const f = pos[0], b = fs.readFileSync(f), sys = opt.system || lab.systemForFile(f, b);
    if (!opt.out) throw new Error('patch needs --out FILE (the original is never changed)');
    let out = lab.rom.patchBytes(b, num(pos[1]), pos[2], opt.expect);
    if (opt['fix-checksum']) out = lab.rom.fixChecksum(sys, out);
    fs.writeFileSync(opt.out, out); console.log(`patched ${lab.rom.toBytes(pos[2]).length} bytes at ${hex(num(pos[1]), 6)} -> ${opt.out}`); return;
  }

  if (cmd === 'checksum') {
    const f = pos[0], b = fs.readFileSync(f), sys = opt.system || lab.systemForFile(f, b);
    const i = lab.rom.info(sys, b); console.log(i.checksumOk === null ? 'this system has no checksum' : i.checksumOk ? 'checksum ok' : 'checksum WRONG');
    if (opt.fix) { if (!opt.out) throw new Error('--fix needs --out FILE'); fs.writeFileSync(opt.out, lab.rom.fixChecksum(sys, b)); console.log('fixed copy written to ' + opt.out); }
    return;
  }

  if (cmd === 'ips') {
    const sub = pos.shift();
    if (sub === 'apply') { const out = lab.rom.applyIPS(fs.readFileSync(pos[0]), fs.readFileSync(pos[1])); fs.writeFileSync(opt.out, out); console.log('patched ROM written to ' + opt.out); return; }
    if (sub === 'make') { const p = lab.rom.makeIPS(fs.readFileSync(pos[0]), fs.readFileSync(pos[1])); fs.writeFileSync(opt.out, p); console.log(`IPS patch (${p.length} bytes) written to ${opt.out}`); return; }
    throw new Error('ips apply | ips make');
  }

  if (cmd === 'diff') {
    const d = lab.rom.diff(fs.readFileSync(pos[0]), fs.readFileSync(pos[1]), num(opt.limit) || 200);
    for (const r of d) console.log(`${hex(r.offset, 6)} +${r.len}  ${r.from.slice(0, 40)} -> ${r.to.slice(0, 40)}`);
    console.log(`${d.length} differing ranges${d.length >= (num(opt.limit) || 200) ? ' (stopped at the limit)' : ''}`);
    return;
  }

  throw new Error('Unknown command: ' + cmd + ' (run with no arguments for help)');
}

main().catch((e) => { console.error('retrolab: ' + e.message); process.exitCode = 1; });
