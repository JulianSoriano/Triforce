'use strict';
// RetroLab: a headless toolkit for studying and modding retro games.
// Use it from scripts:  const lab = require('./tools/retrolab');  const m = await lab.Machine.open('game.md');
const { Machine, MAPS, BUTTONS } = require('./lib/machine');
const { Search, trace, toCSV } = require('./lib/search');
const rom = require('./lib/rom');
const disasm = require('./lib/disasm');
const { SYSTEMS, systemForFile } = require('./lib/core');
const { selftest } = require('./lib/selftest');
const { encodePNG } = require('./lib/png');

module.exports = { Machine, MAPS, BUTTONS, Search, trace, toCSV, rom, disasm, SYSTEMS, systemForFile, selftest, encodePNG };
