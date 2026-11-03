'use strict';
// Automatic checks for a mod: play a route (script or recording) and measure
//   - slowdown: frames where the game never reached its wait-for-next-frame loop (it ran out of time)
//   - freezes: the picture not changing for a long stretch
//   - crashes: the 68000 stuck in the exception handlers at the start of the ROM
// Slowdown and crash detection use the debug hooks (Genesis / Master System / Game Gear core).
const crypto = require('crypto');
const { Machine } = require('./machine');
const { replay, loadMovie } = require('./movie');

// The game's idle loop is where the 68000 spends most of its instructions while it waits for the next frame.
function findIdleLoop(m, frames = 120) {
  m.profile(true); m.step(frames, m.pads[0], m.pads[1]);
  const t = m.profileTop(1).top[0]; m.profile(false);
  return t ? t.pc : null;
}

async function runCheck(romFile, opts = {}) {
  const m = await Machine.open(romFile, { system: opts.system, debug: true });
  const res = { rom: romFile, frames: 0, lagFrames: 0, longestLag: 0, busyAvg: 0, freezeFrames: 0, longestFreeze: 0, crashed: false, idlePc: null };
  // get to the starting point
  let movie = null;
  if (opts.movie) movie = loadMovie(opts.movie);
  else if (opts.state) m.loadState(opts.state);
  const x = m.core.exports;
  // per-frame bookkeeping
  let lagRun = 0, lastHash = '', freezeRun = 0, busySum = 0, prevIdle = 0, prof, seen = 0;
  const begin = () => {
    res.idlePc = opts.idlePc !== undefined ? opts.idlePc : null;
    m.profile(true);
    prof = new Uint32Array(m.core.memory.buffer, x.dbg_profile_rom(), 0x200000);
  };
  const onFrame = () => {
    if (!prof || prof.buffer !== m.core.memory.buffer) prof = new Uint32Array(m.core.memory.buffer, x.dbg_profile_rom(), 0x200000);
    seen++;
    if (seen <= (opts.skip || 0)) { if (res.idlePc !== null) prevIdle = prof[res.idlePc >> 1]; return; }
    res.frames++;
    const total = m.instructions();
    let idle = 0;
    if (res.idlePc !== null) { const c = prof[res.idlePc >> 1]; idle = c - prevIdle; prevIdle = c; }
    const lag = res.idlePc !== null && idle === 0;
    if (lag) { res.lagFrames++; lagRun++; res.longestLag = Math.max(res.longestLag, lagRun); } else lagRun = 0;
    // each idle-loop pass is 2 instructions (test + branch)
    busySum += total ? Math.max(0, 1 - (2 * idle) / total) : 1;
    // crash: running in the exception vectors
    const vec = prof[0x28 >> 1] + prof[0x2C >> 1];
    if (vec > 1000 && !res.crashed) { res.crashed = true; res.crashFrame = res.frames; }
    // freeze: identical picture
    const f = m.pixels(); const hsh = crypto.createHash('sha1').update(f.rgba).digest('hex');
    if (hsh === lastHash) { freezeRun++; if (freezeRun >= (opts.freezeAfter || 300)) res.freezeFrames++; res.longestFreeze = Math.max(res.longestFreeze, freezeRun); } else freezeRun = 0;
    lastHash = hsh;
  };
  if (movie) {
    // find the idle loop on the first 120 frames of the recording, then measure the whole thing
    if (opts.idlePc === undefined) { const probe = await Machine.open(romFile, { system: opts.system || movie.system, debug: true }); probe.profile(true); replay(probe, movie, { upTo: opts.frames }); const t = probe.profileTop(1).top[0]; opts = Object.assign({}, opts, { idlePc: t ? t.pc : null }); }
    begin(); replay(m, movie, { onFrame, upTo: opts.frames });
  } else {
    if (opts.idlePc === undefined) {
      // a first pass over the whole route: the busiest instruction overall is the wait-for-next-frame loop
      const snap = m.saveState(); m.profile(true);
      if (opts.script) m.runScript(opts.script); if (opts.frames) m.step(opts.frames, m.pads[0], m.pads[1]);
      const t = m.profileTop(1).top[0]; res.idlePc = t ? t.pc : null; m.profile(false);
      m.loadState(snap); m.frame = 0; opts = Object.assign({}, opts, { idlePc: res.idlePc });
    }
    begin();
    if (opts.script) m.runScript(opts.script, onFrame);
    if (opts.frames) m.step(opts.frames, m.pads[0], m.pads[1], onFrame);
  }
  res.busyAvg = res.frames ? busySum / res.frames : 0;
  return res;
}

function report(results) {
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
  const rows = [['', ...results.map((r) => r.label || r.rom.split('/').pop())],
    ['frames played', ...results.map((r) => String(r.frames))],
    ['wait loop at', ...results.map((r) => (r.idlePc === null ? '?' : '$' + r.idlePc.toString(16).toUpperCase().padStart(6, '0')))],
    ['slowdown frames', ...results.map((r) => `${r.lagFrames} (${pct(r.lagFrames, r.frames)})`)],
    ['longest slowdown', ...results.map((r) => `${r.longestLag} frames`)],
    ['68000 busy', ...results.map((r) => (r.busyAvg * 100).toFixed(1) + '%')],
    ['picture frozen', ...results.map((r) => (r.longestFreeze >= 300 ? `yes, ${r.longestFreeze} frames` : 'no'))],
    ['crashed', ...results.map((r) => (r.crashed ? `yes, frame ${r.crashFrame}` : 'no'))]];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(w[i] + 2)).join('')).join('\n');
}

module.exports = { runCheck, report, findIdleLoop };
