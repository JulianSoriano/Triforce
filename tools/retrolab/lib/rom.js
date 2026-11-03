'use strict';
// ROM files: header details, checksums (check and fix), byte patches with a safety check, and IPS patches.

function ascii(b, s, e) { return Buffer.from(b.subarray(s, e)).toString('latin1').replace(/[^\x20-\x7e]/g, ' ').trim(); }
const h = (v, d = 2) => '0x' + v.toString(16).toUpperCase().padStart(d, '0');

// ---------- Genesis ----------
function mdSum(b) { let s = 0; for (let i = 0x200; i + 1 < b.length; i += 2) s = (s + b.readUInt16BE(i)) & 0xFFFF; return s; }
// ---------- SNES ----------
function snesHeader(b) {
  const copier = b.length % 1024 === 512 ? 512 : 0;
  const score = (o) => { const p = o + copier; if (b.length < p + 0x40) return -1; const c = b.readUInt16LE(p + 0x1C), s = b.readUInt16LE(p + 0x1E); let v = (c ^ s) === 0xFFFF ? 4 : 0; if (/^[\x20-\x7e]{10}/.test(ascii(b, p, p + 21).padEnd(10, '#'))) v++; const mode = b[p + 0x15] & 0xEF; if ((o === 0x7FC0 && (mode & 1) === 0) || (o === 0xFFC0 && (mode & 1) === 1)) v += 2; return v; };
  const lo = score(0x7FC0), hi = score(0xFFC0);
  return { at: (hi > lo ? 0xFFC0 : 0x7FC0) + copier, copier, hirom: hi > lo };
}
function snesSum(b, copier) {
  const d = b.subarray(copier); let size = 1; while (size < d.length) size <<= 1;
  let sum = 0;
  if (size === d.length) for (const x of d) sum += x;
  else { // the part above the largest power of two is mirrored to fill the space (standard rule)
    let base = 1; while (base * 2 <= d.length) base *= 2;
    for (let i = 0; i < base; i++) sum += d[i];
    const rest = d.length - base; for (let i = 0; i < base; i++) sum += d[base + (i % rest)];
  }
  return sum & 0xFFFF;
}
// ---------- Game Boy ----------
function gbHeaderSum(b) { let c = 0; for (let i = 0x134; i <= 0x14C; i++) c = (c - b[i] - 1) & 0xFF; return c; }
function gbGlobalSum(b) { let g = 0; for (let i = 0; i < b.length; i++) if (i !== 0x14E && i !== 0x14F) g = (g + b[i]) & 0xFFFF; return g; }
// ---------- GBA ----------
function gbaComp(b) { let c = 0; for (let i = 0xA0; i <= 0xBC; i++) c = (c - b[i]) & 0xFF; return (c - 0x19) & 0xFF; }
// ---------- Master System / Game Gear ----------
const SMS_SIZES = { 0xA: 0x2000, 0xB: 0x4000, 0xC: 0x8000, 0xD: 0xC000, 0xE: 0x10000, 0xF: 0x20000, 0x0: 0x40000, 0x1: 0x80000, 0x2: 0x100000 };
function smsHeaderAt(b) { for (const o of [0x7FF0, 0x3FF0, 0x1FF0]) if (b.length >= o + 16 && ascii(b, o, o + 8) === 'TMR SEGA') return o; return -1; }
function smsSum(b, o) {
  const size = Math.min(SMS_SIZES[b[o + 15] & 0xF] || 0x8000, b.length); let s = 0;
  for (let i = 0; i < size; i++) { if (i >= 0x7FF0 && i < 0x8000) continue; s = (s + b[i]) & 0xFFFF; }
  return s;
}

function info(system, b) {
  const out = { system, size: b.length };
  if (system === 'md') {
    Object.assign(out, { console: ascii(b, 0x100, 0x110), title: ascii(b, 0x150, 0x180) || ascii(b, 0x120, 0x150), serial: ascii(b, 0x180, 0x18E), region: ascii(b, 0x1F0, 0x1F3), checksum: h(b.readUInt16BE(0x18E), 4), computed: h(mdSum(b), 4) });
    out.checksumOk = b.readUInt16BE(0x18E) === mdSum(b);
  } else if (system === 'nes') {
    if (b.readUInt32BE(0) !== 0x4E45531A) return Object.assign(out, { error: 'no iNES header' });
    const nes2 = (b[7] & 0x0C) === 0x08;
    Object.assign(out, { format: nes2 ? 'NES 2.0' : 'iNES', mapper: (b[6] >> 4) | (b[7] & 0xF0) | (nes2 ? (b[8] & 0x0F) << 8 : 0), prg: b[4] * 16 + ' KB', chr: b[5] ? b[5] * 8 + ' KB' : 'RAM', battery: !!(b[6] & 2), mirroring: b[6] & 8 ? 'four-screen' : b[6] & 1 ? 'vertical' : 'horizontal', trainer: !!(b[6] & 4) });
    out.checksumOk = null; out.note = 'NES ROMs have no checksum.';
  } else if (system === 'snes') {
    const H = snesHeader(b), p = H.at;
    Object.assign(out, { layout: H.hirom ? 'HiROM' : 'LoROM', copierHeader: !!H.copier, title: ascii(b, p, p + 21), mapMode: h(b[p + 0x15]), romSize: h(b[p + 0x17]), sramSize: h(b[p + 0x18]), checksum: h(b.readUInt16LE(p + 0x1E), 4), complement: h(b.readUInt16LE(p + 0x1C), 4), computed: h(snesSum(b, H.copier), 4) });
    out.checksumOk = b.readUInt16LE(p + 0x1E) === snesSum(b, H.copier) && (b.readUInt16LE(p + 0x1C) ^ b.readUInt16LE(p + 0x1E)) === 0xFFFF;
  } else if (system === 'gb' || system === 'gbc') {
    Object.assign(out, { title: ascii(b, 0x134, 0x143), color: b[0x143] === 0xC0 ? 'GBC only' : b[0x143] === 0x80 ? 'GBC enhanced' : 'no', cartType: h(b[0x147]), romSize: h(b[0x148]), ramSize: h(b[0x149]), headerChecksum: h(b[0x14D]), headerComputed: h(gbHeaderSum(b)), globalChecksum: h(b.readUInt16BE(0x14E), 4), globalComputed: h(gbGlobalSum(b), 4) });
    out.checksumOk = b[0x14D] === gbHeaderSum(b) && b.readUInt16BE(0x14E) === gbGlobalSum(b);
  } else if (system === 'gba') {
    Object.assign(out, { title: ascii(b, 0xA0, 0xAC), code: ascii(b, 0xAC, 0xB0), maker: ascii(b, 0xB0, 0xB2), version: b[0xBC], complement: h(b[0xBD]), computed: h(gbaComp(b)) });
    out.checksumOk = b[0xBD] === gbaComp(b);
  } else if (system === 'sms' || system === 'gg') {
    const o = smsHeaderAt(b);
    if (o < 0) return Object.assign(out, { note: 'no TMR SEGA header (fine for many Japanese and Game Gear games)', checksumOk: null });
    Object.assign(out, { header: h(o, 4), checksum: h(b.readUInt16LE(o + 10), 4), computed: h(smsSum(b, o), 4), regionCode: h(b[o + 15] >> 4, 1), sizeCode: h(b[o + 15] & 0xF, 1) });
    out.checksumOk = b.readUInt16LE(o + 10) === smsSum(b, o);
  }
  return out;
}

// Rewrites the checksum fields so the game (and emulators that check) accept the edited ROM.
function fixChecksum(system, b) {
  b = Buffer.from(b);
  if (system === 'md') b.writeUInt16BE(mdSum(b), 0x18E);
  else if (system === 'snes') { const H = snesHeader(b); b.writeUInt16LE(0xFFFF, H.at + 0x1C); b.writeUInt16LE(0, H.at + 0x1E); const s = snesSum(b, H.copier); b.writeUInt16LE(s ^ 0xFFFF, H.at + 0x1C); b.writeUInt16LE(s, H.at + 0x1E); }
  else if (system === 'gb' || system === 'gbc') { b[0x14D] = gbHeaderSum(b); b.writeUInt16BE(gbGlobalSum(b), 0x14E); }
  else if (system === 'gba') b[0xBD] = gbaComp(b);
  else if (system === 'sms' || system === 'gg') { const o = smsHeaderAt(b); if (o >= 0) b.writeUInt16LE(smsSum(b, o), o + 10); }
  return b;
}

// Write bytes at a file offset. With `expect`, the old bytes must match first (catches editing the wrong ROM).
function patchBytes(b, offset, bytes, expect) {
  b = Buffer.from(b); bytes = toBytes(bytes);
  if (expect !== undefined) {
    const e = toBytes(expect), cur = b.subarray(offset, offset + e.length);
    if (!cur.equals(e)) throw new Error(`At ${h(offset, 6)} the ROM has ${cur.toString('hex')}, expected ${e.toString('hex')}.`);
  }
  if (offset + bytes.length > b.length) throw new Error('Patch runs past the end of the ROM.');
  bytes.copy(b, offset);
  return b;
}
function toBytes(x) { if (Buffer.isBuffer(x)) return x; if (Array.isArray(x)) return Buffer.from(x); return Buffer.from(String(x).replace(/0x|[\s,_]/gi, ''), 'hex'); }

// ---------- IPS ----------
function applyIPS(rom, patch) {
  if (patch.subarray(0, 5).toString('latin1') !== 'PATCH') throw new Error('Not an IPS patch.');
  let out = Buffer.from(rom), p = 5;
  const grow = (n) => { if (n > out.length) { const g = Buffer.alloc(n); out.copy(g); out = g; } };
  for (;;) {
    if (p + 3 > patch.length) throw new Error('IPS patch ends early.');
    const off = patch.readUIntBE(p, 3); p += 3;
    if (off === 0x454F46) { if (p + 3 <= patch.length) { const trunc = patch.readUIntBE(p, 3); out = out.subarray(0, trunc); } break; }
    const n = patch.readUInt16BE(p); p += 2;
    if (n) { grow(off + n); patch.copy(out, off, p, p + n); p += n; }
    else { const rl = patch.readUInt16BE(p), v = patch[p + 2]; p += 3; grow(off + rl); out.fill(v, off, off + rl); }
  }
  return out;
}
function makeIPS(orig, mod) {
  const parts = [Buffer.from('PATCH')];
  let i = 0;
  while (i < mod.length) {
    if (i < orig.length && orig[i] === mod[i]) { i++; continue; }
    let j = i; while (j < mod.length && j - i < 0xFFFF && (j >= orig.length || orig[j] !== mod[j] || (j + 1 < mod.length && j + 1 < orig.length && orig[j + 1] !== mod[j + 1] && j + 2 < mod.length && orig[j + 2] !== mod[j + 2]))) j++;
    let off = i;
    if (off === 0x454F46) off--;   // "EOF" can't be an offset; start one byte earlier
    const rec = Buffer.alloc(5); rec.writeUIntBE(off, 0, 3); rec.writeUInt16BE(j - off, 3);
    parts.push(rec, mod.subarray(off, j)); i = j;
  }
  parts.push(Buffer.from('EOF'));
  if (mod.length < orig.length) { const t = Buffer.alloc(3); t.writeUIntBE(mod.length, 0, 3); parts.push(t); }
  return Buffer.concat(parts);
}
// List what differs between two ROMs, as runs of bytes.
function diff(a, b, max = 200) {
  const out = []; let i = 0; const n = Math.max(a.length, b.length);
  while (i < n && out.length < max) {
    if (a[i] === b[i]) { i++; continue; }
    let j = i; while (j < n && a[j] !== b[j]) j++;
    out.push({ offset: i, len: j - i, from: Buffer.from(a.subarray(i, Math.min(j, a.length))).toString('hex'), to: Buffer.from(b.subarray(i, Math.min(j, b.length))).toString('hex') });
    i = j;
  }
  return out;
}

module.exports = { info, fixChecksum, patchBytes, applyIPS, makeIPS, diff, toBytes, snesHeader };
