'use strict';
// A running console you can script: load a ROM, press buttons, step frames, read and write memory by
// console address, take screenshots and save states. No window, no sound.
const fs = require('fs');
const path = require('path');
const { SYSTEMS, systemForFile, loadCore } = require('./core');
const { encodePNG } = require('./png');

// Where each system's memory sits inside the core's save state (confirmed with the self-test ROMs).
// `find` returns the offset of the region's first byte in a save state. `swap16`: the core keeps 16-bit
// words in host (little-endian) order, so console byte A lives at offset A ^ 1.
const tagLE = (tag, size) => (st) => {          // FCEUmm chunks: 4-char name, 32-bit little-endian size, data
  const t = Buffer.alloc(8); Buffer.from(tag, 'latin1').copy(t, 0); t.writeUInt32LE(size, 4);
  const i = st.indexOf(t); return i < 0 ? -1 : i + 8;
};
const tagS9x = (tag) => (st) => {               // Snes9x blocks: "RAM:131072:" then data
  const i = st.indexOf(Buffer.from(tag, 'latin1')); return i < 0 ? -1 : i + tag.length;
};
const at = (off) => () => off;

const MAPS = {
  nes: {
    endian: 'little',
    regions: [
      { name: 'ram', base: 0x0000, size: 0x800, find: tagLE('RAM\0', 0x800), mirror: [0x0000, 0x2000] },
      { name: 'wram', base: 0x6000, size: 0x2000, find: tagLE('WRAM', 0x2000), optional: true },
    ],
  },
  snes: {
    endian: 'little',
    regions: [{ name: 'wram', base: 0x7E0000, size: 0x20000, find: tagS9x('RAM:131072:') }],
    // $0000-$1FFF in banks $00-$3F and $80-$BF is the first 8 KB of WRAM
    alias: (a) => ((a & 0xFFFF) < 0x2000 && (((a >> 16) & 0x7F) < 0x40)) ? 0x7E0000 + (a & 0x1FFF) : a,
  },
  gb: {
    endian: 'little',
    regions: [
      { name: 'wram', base: 0xC000, size: 0x2000, find: at(0x4400), mirror: [0xC000, 0xFE00] },
      { name: 'hram', base: 0xFF80, size: 0x7F, find: at(0x380) },
    ],
  },
  gbc: {
    endian: 'little',
    regions: [
      // bank 0 at $C000; $D000-$DFFF shows the bank chosen by SVBK ($FF70), 1-7. Linear access to every
      // bank: addresses $10000 + bank * $1000 (bank 0 = $10000, bank 7 = $17000).
      { name: 'wram', base: 0xC000, size: 0x8000, find: at(0x4400), banked: true },
      { name: 'hram', base: 0xFF80, size: 0x7F, find: at(0x380) },
      { name: 'io', base: 0xFF00, size: 0x80, find: at(0x300), readonly: true },
    ],
  },
  gba: {
    endian: 'little',
    regions: [
      { name: 'ewram', base: 0x02000000, size: 0x40000, find: at(0x21000), mirror: [0x02000000, 0x03000000] },
      { name: 'iwram', base: 0x03000000, size: 0x8000, find: at(0x19000), mirror: [0x03000000, 0x04000000] },
    ],
  },
  md: {
    endian: 'big',
    regions: [
      { name: 'ram', base: 0xFF0000, size: 0x10000, find: at(0x10), swap16: true, mirror: [0xE00000, 0x1000000] },
      { name: 'z80', base: 0xA00000, size: 0x2000, find: at(0x10010) },
    ],
    alias: (a) => a & 0xFFFFFF,
  },
  sms: { endian: 'little', regions: [{ name: 'ram', base: 0xC000, size: 0x2000, find: at(0x10), mirror: [0xC000, 0x10000] }] },
};
MAPS.gg = MAPS.sms;

// Buttons each system has, as libretro button numbers.
const BUTTONS = {
  sega: { B: 0, A: 1, MODE: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, C: 8, Y: 9, X: 10, Z: 11 },
  nin: { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 },
};
const PAD_FOR = { md: 'sega', sms: 'sega', gg: 'sega', nes: 'nin', snes: 'nin', gb: 'nin', gbc: 'nin', gba: 'nin' };

class Machine {
  static async open(source, opts = {}) {
    let bytes, file = null;
    if (Buffer.isBuffer(source) || source instanceof Uint8Array) bytes = Buffer.from(source);
    else { file = source; bytes = fs.readFileSync(source); }
    const system = opts.system || systemForFile(file || ('x.' + (opts.ext || '')), bytes);
    if (!system) throw new Error('Unknown system. Pass --system (one of ' + Object.keys(SYSTEMS).join(', ') + ').');
    const core = await loadCore(SYSTEMS[system].core);
    const ext = opts.ext || (file ? path.extname(file).slice(1).toLowerCase() : SYSTEMS[system].exts[0]);
    if (!core.load(bytes, ext)) throw new Error('The core refused this ROM.');
    if (system === 'md' && opts.sixButton !== false) { core.setPortDevice(0, 0x201); core.setPortDevice(1, 0x201); }
    const m = new Machine(core, system, bytes, file);
    return m;
  }

  constructor(core, system, rom, file) {
    this.core = core; this.system = system; this.rom = rom; this.file = file;
    this.map = MAPS[system]; this.frame = 0; this.pads = [0, 0];
    this.live = null;        // region name -> heap offset of its first byte
  }

  get buttons() { return BUTTONS[PAD_FOR[this.system]]; }

  // ---------- input and time ----------
  mask(list) {
    if (typeof list === 'number') return list;
    let m = 0;
    for (const b of (Array.isArray(list) ? list : String(list || '').split(/[+, ]+/)).filter(Boolean)) {
      const id = this.buttons[b.toUpperCase()];
      if (id === undefined) throw new Error(`No button "${b}" on ${SYSTEMS[this.system].name}. Buttons: ${Object.keys(this.buttons).join(' ')}`);
      m |= 1 << id;
    }
    return m;
  }
  setInput(p1, p2) { this.pads = [this.mask(p1 || 0), this.mask(p2 || 0)]; }
  // Run n frames holding the given buttons (player 1, player 2). onFrame(machine) runs after each frame.
  step(n = 1, p1, p2, onFrame) {
    if (p1 !== undefined || p2 !== undefined) this.setInput(p1, p2);
    for (let i = 0; i < n; i++) {
      this.core.setPad(0, this.pads[0]); this.core.setPad(1, this.pads[1]);
      this.core.run(); this.frame++;
      if (onFrame && onFrame(this) === false) return i + 1;
    }
    return n;
  }
  // Press and release: hold for `hold` frames, then let go for `gap` frames.
  tap(buttons, hold = 4, gap = 8, player = 1) {
    const other = this.pads[player === 1 ? 1 : 0];
    if (player === 1) { this.step(hold, buttons, other); this.step(gap, 0, other); }
    else { this.step(hold, this.pads[0], buttons); this.step(gap, this.pads[0], 0); }
  }
  // A script: one command per line. "30" waits 30 frames; "10 RIGHT+A" holds RIGHT and A for 10 frames;
  // "10 RIGHT | B" also holds B on player 2; "tap START" presses and releases; "# ..." is a comment.
  runScript(text, onFrame) {
    for (const raw of String(text).split('\n')) {
      const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
      let m;
      if ((m = /^tap\s+(\S+)(?:\s+(\d+))?$/i.exec(line))) { this.tap(m[1], +(m[2] || 4)); continue; }
      if ((m = /^(\d+)(?:\s+([^|]*))?(?:\|\s*(.*))?$/.exec(line))) { this.step(+m[1], (m[2] || '').trim() || 0, (m[3] || '').trim() || 0, onFrame); continue; }
      throw new Error('Script line not understood: ' + raw);
    }
  }
  reset() { this.core.reset(); this.frame = 0; }

  // ---------- save states ----------
  saveState(file) { const s = this.core.saveState(); if (file) fs.writeFileSync(file, s); return s; }
  loadState(src) {
    const buf = typeof src === 'string' ? fs.readFileSync(src) : src;
    if (!this.core.loadState(buf)) throw new Error('The core refused that save state.');
    if (this.live && !this._verify()) this.live = null;   // recalibrate if a buffer moved
  }

  // ---------- memory ----------
  // Find each memory region inside the core: write a marker into a save state, load it, look for the marker.
  calibrate() {
    const orig = Buffer.from(this.core.saveState());
    const live = {};
    for (const r of this.map.regions) {
      const off = r.find(orig);
      if (off < 0 || off + r.size > orig.length) { if (r.optional) continue; throw new Error(`Couldn't find ${r.name} in the save state.`); }
      const win = Math.min(64, r.size), at = Math.min(0x40, r.size - win);
      const marker = Buffer.alloc(win); for (let i = 0; i < win; i++) marker[i] = (Math.random() * 256) | 0;
      const st = Buffer.from(orig); marker.copy(st, off + at);
      if (!this.core.loadState(st)) throw new Error('Calibration: the core refused its own state.');
      const heap = Buffer.from(this.core.memory.buffer);
      const cands = []; let h = heap.indexOf(marker); while (h >= 0) { cands.push(h - at); h = heap.indexOf(marker, h + 1); }
      // Keep the candidate the emulator really uses: change it, save, and see the change in the state.
      let found = -1;
      for (const base of cands) {
        const p = base + at + 1, old = heap[p]; heap[p] = old ^ 0xA5;
        const chk = Buffer.from(this.core.saveState()); heap[p] = old;
        if (chk[off + at + 1] === (old ^ 0xA5)) { found = base; break; }
      }
      if (found < 0) { if (r.optional) continue; this.core.loadState(orig); throw new Error(`Couldn't find ${r.name} in the emulator's memory.`); }
      live[r.name] = { heap: found, state: off };
    }
    this.core.loadState(orig);
    this.live = live;
    return live;
  }
  _verify() {
    const st = Buffer.from(this.core.saveState()), heap = Buffer.from(this.core.memory.buffer);
    for (const r of this.map.regions) {
      const L = this.live[r.name]; if (!L) continue;
      if (!heap.subarray(L.heap, L.heap + Math.min(r.size, 4096)).equals(st.subarray(L.state, L.state + Math.min(r.size, 4096)))) return false;
    }
    return true;
  }
  _ensure() { if (!this.live) this.calibrate(); }
  // console address -> [region, byte offset in the region's heap copy]
  locate(addr) {
    this._ensure();
    let a = this.map.alias ? this.map.alias(addr) : addr;
    for (const r of this.map.regions) {
      if (!this.live[r.name]) continue;
      if (r.banked) {
        if (a >= 0x10000 && a < 0x18000) return [r, a - 0x10000];                            // linear GBC WRAM
        if (a >= 0xC000 && a < 0xD000) return [r, a - 0xC000];
        if (a >= 0xD000 && a < 0xE000) return [r, this._gbcBank() * 0x1000 + (a - 0xD000)];
        if (a >= 0xE000 && a < 0xFE00) return this.locate(a - 0x2000);                       // echo RAM
        continue;
      }
      let o = a - r.base;
      if (r.mirror && a >= r.mirror[0] && a < r.mirror[1]) o = (a - r.mirror[0]) % r.size;
      if (o >= 0 && o < r.size) return [r, r.swap16 ? o ^ 1 : o];
    }
    return null;
  }
  _gbcBank() { const io = this.live.io; if (!io) return 1; const v = this.core.heap()[io.heap + 0x70] & 7; return v || 1; }
  read(addr, len = 1) {
    const out = Buffer.alloc(len), heap = this.core.heap();
    for (let i = 0; i < len; i++) { const l = this.locate(addr + i); if (!l) throw new Error('Not a RAM address on ' + this.system + ': 0x' + (addr + i).toString(16)); out[i] = heap[this.live[l[0].name].heap + l[1]]; }
    return out;
  }
  write(addr, bytes) {
    const heap = this.core.heap(); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    for (let i = 0; i < bytes.length; i++) {
      const l = this.locate(addr + i); if (!l) throw new Error('Not a RAM address: 0x' + (addr + i).toString(16));
      if (l[0].readonly) throw new Error(l[0].name + ' is read-only here');
      heap[this.live[l[0].name].heap + l[1]] = bytes[i];
    }
  }
  u8(a) { return this.read(a, 1)[0]; }
  u16(a) { const b = this.read(a, 2); return this.map.endian === 'big' ? b.readUInt16BE(0) : b.readUInt16LE(0); }
  u32(a) { const b = this.read(a, 4); return this.map.endian === 'big' ? b.readUInt32BE(0) : b.readUInt32LE(0); }
  s8(a) { const v = this.u8(a); return v > 127 ? v - 256 : v; }
  s16(a) { const v = this.u16(a); return v > 32767 ? v - 65536 : v; }
  w8(a, v) { this.write(a, [v & 0xFF]); }
  w16(a, v) { const b = Buffer.alloc(2); this.map.endian === 'big' ? b.writeUInt16BE(v & 0xFFFF) : b.writeUInt16LE(v & 0xFFFF); this.write(a, b); }
  w32(a, v) { const b = Buffer.alloc(4); this.map.endian === 'big' ? b.writeUInt32BE(v >>> 0) : b.writeUInt32LE(v >>> 0); this.write(a, b); }
  // Every RAM region as console-ordered bytes (for searching and diffing).
  regions() {
    this._ensure();
    const heap = this.core.heap(), out = [];
    for (const r of this.map.regions) {
      const L = this.live[r.name]; if (!L) continue;
      let data = Buffer.from(heap.subarray(L.heap, L.heap + r.size));
      if (r.swap16) { data = Buffer.from(data); for (let i = 0; i + 1 < data.length; i += 2) { const t = data[i]; data[i] = data[i + 1]; data[i + 1] = t; } }
      out.push({ name: r.name, base: r.banked ? 0x10000 : r.base, size: r.size, data, readonly: !!r.readonly });
    }
    return out;
  }
  sram() { const s = this.core.sram(); return s ? Buffer.from(s) : null; }

  // ---------- picture ----------
  screenshot(file, scale = 2) {
    const f = this.core.frame(); const png = encodePNG(f.w, f.h, f.rgba, scale);
    if (file) fs.writeFileSync(file, png); return png;
  }
  pixels() { const f = this.core.frame(); return { w: f.w, h: f.h, rgba: Buffer.from(f.rgba) }; }
}

module.exports = { Machine, MAPS, BUTTONS, PAD_FOR };
