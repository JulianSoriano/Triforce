'use strict';
// Loads one of the libretro cores Triforce ships (compiled to WebAssembly) and drives it without a screen.
// Same wrapper the Emulators tab uses, minus the browser parts.
const fs = require('fs');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'cores');

// Which core plays which system, and the file extensions each system uses.
const SYSTEMS = {
  md:   { name: 'Genesis / Mega Drive', core: 'gpgx',   exts: ['md', 'gen', 'bin', 'smd'] },
  sms:  { name: 'Master System',        core: 'gpgx',   exts: ['sms', 'sg'] },
  gg:   { name: 'Game Gear',            core: 'gpgx',   exts: ['gg'] },
  nes:  { name: 'NES',                  core: 'fceumm', exts: ['nes', 'unf', 'unif'] },
  snes: { name: 'Super Nintendo',       core: 'snes9x', exts: ['sfc', 'smc', 'fig', 'swc'] },
  gb:   { name: 'Game Boy',             core: 'mgba',   exts: ['gb'] },
  gbc:  { name: 'Game Boy Color',       core: 'mgba',   exts: ['gbc'] },
  gba:  { name: 'Game Boy Advance',     core: 'mgba',   exts: ['gba', 'agb'] },
};
const CORE_OPTIONS = {
  mgba: { mgba_sgb_borders: 'OFF' },
};

function systemForFile(file, bytes) {
  const ext = path.extname(file).slice(1).toLowerCase();
  for (const [k, s] of Object.entries(SYSTEMS)) if (s.exts.includes(ext)) return k;
  // No telling extension: look at the data.
  if (bytes) {
    if (bytes[0] === 0x4E && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1A) return 'nes';
    if (bytes.length > 0x110 && /SEGA/.test(String.fromCharCode(...bytes.slice(0x100, 0x110)))) return 'md';
    if (bytes.length > 0xC0 && bytes[0xB2] === 0x96) return 'gba';
    if (bytes.length > 0x150 && bytes[0x104] === 0xCE && bytes[0x105] === 0xED) return bytes[0x143] & 0x80 ? 'gbc' : 'gb';
  }
  return null;
}

function wasiFor(getMem) {
  const view = () => new DataView(getMem().buffer);
  const wasi = {
    fd_close: () => 0,
    fd_fdstat_get: (fd, p) => {
      if (fd > 2) return 8;
      const v = view(); v.setUint8(p, 2); v.setUint16(p + 2, 0, true);
      v.setBigUint64(p + 8, 0n, true); v.setBigUint64(p + 16, 0n, true); return 0;
    },
    fd_fdstat_set_flags: () => 0,
    fd_prestat_get: () => 8,
    fd_prestat_dir_name: () => 8,
    fd_read: () => 8,
    fd_seek: () => 8,
    fd_tell: () => 8,
    fd_write: (fd, iovs, n, out) => {
      const v = view(); let total = 0;
      for (let i = 0; i < n; i++) {
        const p = v.getUint32(iovs + i * 8, true), l = v.getUint32(iovs + i * 8 + 4, true);
        if (l && process.env.RETROLAB_CORE_LOG) process.stderr.write(Buffer.from(new Uint8Array(getMem().buffer, p, l)));
        total += l;
      }
      v.setUint32(out, total, true); return 0;
    },
    path_open: () => 44,
    proc_exit: (c) => { throw new Error('core exited ' + c); },
    environ_sizes_get: (pc, ps) => { const v = view(); v.setUint32(pc, 0, true); v.setUint32(ps, 0, true); return 0; },
    environ_get: () => 0,
    args_sizes_get: (pc, ps) => { const v = view(); v.setUint32(pc, 0, true); v.setUint32(ps, 0, true); return 0; },
    args_get: () => 0,
    // A fixed clock keeps runs repeatable: the same inputs give the same game.
    clock_time_get: (...a) => { view().setBigUint64(a[a.length - 1], 0n, true); return 0; },
    clock_res_get: (id, out) => { view().setBigUint64(out, 1000n, true); return 0; },
    sched_yield: () => 0,
    random_get: (p, n) => { new Uint8Array(getMem().buffer, p, n).fill(0); return 0; },
  };
  return new Proxy(wasi, { get: (t, k) => (k in t ? t[k] : () => 52) });
}

const compiled = {};
async function loadCore(name) {
  if (!compiled[name]) compiled[name] = await WebAssembly.compile(fs.readFileSync(path.join(CORE_DIR, name + '.wasm')));
  let mem;
  const instance = await WebAssembly.instantiate(compiled[name], { wasi_snapshot_preview1: wasiFor(() => mem) });
  const x = instance.exports;
  mem = x.memory;
  x._initialize(); x.web_init();
  const cstr = (s) => { const b = Buffer.from(s + '\0'); const p = x.web_alloc(b.length); new Uint8Array(mem.buffer, p, b.length).set(b); return p; };
  let romPtr = 0;
  const core = {
    name, exports: x,
    get memory() { return mem; },
    heap() { return new Uint8Array(mem.buffer); },
    setOption(k, v) { const a = cstr(k), b = cstr(String(v)); x.web_set_option(a, b); x.web_free(a); x.web_free(b); },
    load(bytes, ext) {
      if (romPtr) x.web_free(romPtr);
      romPtr = x.web_alloc(bytes.length);
      new Uint8Array(mem.buffer, romPtr, bytes.length).set(bytes);
      const e = cstr(ext); const ok = x.web_load(romPtr, bytes.length, e); x.web_free(e);
      return !!ok;
    },
    run() { x.web_run(); },
    frame() { const w = x.web_frame_w(), h = x.web_frame_h(); return { w, h, rgba: new Uint8Array(mem.buffer, x.web_frame(), w * h * 4) }; },
    setPad(port, mask) { x.web_set_pad(port, mask); },
    setPortDevice(port, dev) { x.web_set_port_device(port, dev); },
    reset() { x.web_reset(); },
    fps() { return x.web_fps(); },
    stateSize() { return x.web_state_size(); },
    // The state is written into a buffer inside the core; `where` reports it so memory searches can skip it.
    saveState(where) {
      const n = x.web_state_size(); const p = x.web_alloc(n);
      const ok = x.web_state_save(p, n);
      const out = new Uint8Array(mem.buffer, p, n).slice();
      new Uint8Array(mem.buffer, p, n).fill(0);   // don't leave a stale copy of the state lying in the heap
      x.web_free(p);
      if (where) { where.ptr = p; where.len = n; }
      return ok ? out : null;
    },
    loadState(buf) { const p = x.web_alloc(buf.length); new Uint8Array(mem.buffer, p, buf.length).set(buf); const ok = x.web_state_load(p, buf.length); new Uint8Array(mem.buffer, p, buf.length).fill(0); x.web_free(p); return !!ok; },
    sram() { const n = x.web_sram_size(), p = x.web_sram(); return n && p ? new Uint8Array(mem.buffer, p, n) : null; },
  };
  for (const [k, v] of Object.entries(CORE_OPTIONS[name] || {})) core.setOption(k, v);
  return core;
}

module.exports = { SYSTEMS, systemForFile, loadCore, CORE_DIR };
