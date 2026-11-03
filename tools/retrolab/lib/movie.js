'use strict';
// Recordings made with the Record button in Triforce's Emulators tab (*.rlmovie.json): a save state plus the
// buttons held on every frame after it. Replaying them runs the exact same game, frame for frame.
const fs = require('fs');
const crypto = require('crypto');

function loadMovie(src) {
  const m = typeof src === 'string' ? JSON.parse(fs.readFileSync(src, 'utf8')) : src;
  if (m.format !== 'retrolab-movie') throw new Error('Not a RetroLab recording.');
  m.stateBytes = Buffer.from(m.state, 'base64');
  return m;
}
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

// Replays on an open Machine. onFrame(machine, index) runs after every frame; return false to stop early.
function replay(machine, movie, { onFrame, upTo } = {}) {
  if (movie.rom && movie.rom.sha1 && movie.rom.sha1 !== sha1(machine.rom)) throw new Error(`This recording was made with a different ROM (SHA-1 ${movie.rom.sha1}).`);
  if (machine.system === 'md' || machine.system === 'sms' || machine.system === 'gg') {
    const dev = movie.sixButton === false ? 0x101 : 0x201; machine.core.setPortDevice(0, dev); machine.core.setPortDevice(1, dev);
  }
  machine.loadState(movie.stateBytes);
  let k = 0;
  const limit = upTo === undefined ? movie.frames : Math.min(upTo, movie.frames);
  for (const [p1, p2, n] of movie.inputs) {
    for (let i = 0; i < n && k < limit; i++, k++) {
      machine.step(1, p1, p2);
      if (onFrame && onFrame(machine, k) === false) return k + 1;
    }
    if (k >= limit) break;
  }
  return k;
}

// Make a recording from a script run (for sharing a test route, or the other way round).
function toMovie(machine, startState, inputs) {
  const runs = []; for (const [a, b] of inputs) { const l = runs[runs.length - 1]; if (l && l[0] === a && l[1] === b && l[2] < 65535) l[2]++; else runs.push([a, b, 1]); }
  return { format: 'retrolab-movie', version: 1, system: machine.system, core: machine.core.name, sixButton: true, rom: { title: '', sha1: sha1(machine.rom) }, made: new Date().toISOString(), frames: inputs.length, inputs: runs, state: Buffer.from(startState).toString('base64') };
}

module.exports = { loadMovie, replay, toMovie, sha1 };
