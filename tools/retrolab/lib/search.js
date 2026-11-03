'use strict';
// "Which address holds this value?" Take a snapshot of all RAM, change something in the game, and narrow
// the candidates down: equal to a number, changed, unchanged, went up, went down, up or down by N.

class Search {
  constructor(machine, size = 1) {
    this.m = machine; this.size = size; this.big = machine.map.endian === 'big';
    this.prev = this._snap();
    this.cands = null;                       // null = every address
  }
  _snap() { return this.m.regions().filter((r) => !r.readonly); }
  _val(buf, i) {
    if (this.size === 1) return buf[i];
    if (this.size === 2) return this.big ? buf.readUInt16BE(i) : buf.readUInt16LE(i);
    return this.big ? buf.readUInt32BE(i) : buf.readUInt32LE(i);
  }
  // keep(old, now) -> boolean
  filter(keep) {
    const now = this._snap(), next = [];
    const each = (fn) => {
      if (this.cands) { for (const [ri, i] of this.cands) fn(ri, i); return; }
      now.forEach((r, ri) => { for (let i = 0; i + this.size <= r.size; i += this.size === 1 ? 1 : 2) fn(ri, i); });
    };
    each((ri, i) => { if (keep(this._val(this.prev[ri].data, i), this._val(now[ri].data, i))) next.push([ri, i]); });
    this.prev = now; this.cands = next;
    return next.length;
  }
  equals(v) { return this.filter((o, n) => n === v); }
  changed() { return this.filter((o, n) => n !== o); }
  unchanged() { return this.filter((o, n) => n === o); }
  increased(by) { return this.filter((o, n) => (by === undefined ? n > o : n - o === by)); }
  decreased(by) { return this.filter((o, n) => (by === undefined ? n < o : o - n === by)); }
  // console addresses with their current values
  results(limit = 50) {
    const now = this.prev;
    return (this.cands || []).slice(0, limit).map(([ri, i]) => ({ addr: now[ri].base + i, region: now[ri].name, value: this._val(now[ri].data, i) }));
  }
  get count() { return this.cands ? this.cands.length : this.prev.reduce((a, r) => a + r.size, 0); }
}

// Record chosen addresses every frame (or every `every` frames) while the game runs.
function trace(machine, addrs, frames, { every = 1, size = 1, input, onlyChanges = false } = {}) {
  const rows = []; let last = null;
  const read = (a) => (size === 1 ? machine.u8(a) : size === 2 ? machine.u16(a) : machine.u32(a));
  for (let f = 0; f < frames; f++) {
    machine.step(1, input ? input(machine.frame) : undefined);
    if (f % every) continue;
    const vals = addrs.map(read);
    const key = vals.join(',');
    if (onlyChanges && key === last) continue;
    last = key; rows.push([machine.frame, ...vals]);
  }
  return rows;
}
function toCSV(addrs, rows, hexDigits = 2) {
  const h = (v) => '0x' + v.toString(16).padStart(hexDigits, '0');
  return ['frame,' + addrs.map((a) => '0x' + a.toString(16)).join(','), ...rows.map((r) => r.map((v, i) => (i ? h(v) : v)).join(','))].join('\n') + '\n';
}

module.exports = { Search, trace, toCSV };
