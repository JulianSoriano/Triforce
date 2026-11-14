# Minimal ISO9660 image (one root folder) for testing the PlayStation core: SYSTEM.CNF + PSX.EXE
import struct, sys, datetime
exe = open(sys.argv[1], 'rb').read(); out = sys.argv[2]
cnf = b"BOOT = cdrom:\\PSX.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801FFF00\r\n"
S = 2048
files = [(b"PSX.EXE;1", exe), (b"SYSTEM.CNF;1", cnf)]
lba = 21; ent = []
for n, d in files: ent.append((n, d, lba)); lba += (len(d) + S - 1) // S
total = lba
def both16(v): return struct.pack('<H', v) + struct.pack('>H', v)
def both32(v): return struct.pack('<I', v) + struct.pack('>I', v)
def dirrec(name, loc, size, isdir):
    r = bytes([0, 0]) + both32(loc) + both32(size) + bytes([126, 1, 1, 0, 0, 0, 0]) + bytes([2 if isdir else 0, 0, 0]) + both16(1) + bytes([len(name)]) + name
    if len(r) % 2: r += b'\0'
    return bytes([len(r)]) + r[1:]
root = dirrec(b'\0', 20, S, True) + dirrec(b'\1', 20, S, True) + b''.join(dirrec(n, l, len(d), False) for n, d, l in ent)
img = bytearray(total * S)
pvd = bytearray(S); pvd[0] = 1; pvd[1:6] = b'CD001'; pvd[6] = 1
pvd[8:40] = b'PLAYSTATION'.ljust(32); pvd[40:72] = b'TEST'.ljust(32)
pvd[80:88] = both32(total); pvd[120:124] = both16(1); pvd[124:128] = both16(1); pvd[128:132] = both16(S)
pt = bytes([1, 0]) + struct.pack('<I', 20) + struct.pack('<H', 1) + b'\0\0'
ptm = bytes([1, 0]) + struct.pack('>I', 20) + struct.pack('>H', 1) + b'\0\0'
pvd[132:140] = both32(len(pt)); pvd[140:144] = struct.pack('<I', 18); pvd[148:152] = struct.pack('>I', 19)
pvd[156:190] = dirrec(b'\0', 20, S, True)
pvd[881] = 1
img[16 * S:17 * S] = pvd
term = bytearray(S); term[0] = 255; term[1:6] = b'CD001'; term[6] = 1; img[17 * S:18 * S] = term
img[18 * S:18 * S + len(pt)] = pt; img[19 * S:19 * S + len(ptm)] = ptm
img[20 * S:20 * S + len(root)] = root
for n, d, l in ent: img[l * S:l * S + len(d)] = d
open(out + '.iso', 'wb').write(img)
# the same disc as raw 2352-byte Mode 2 sectors (.bin) with a .cue
def bcd(v): return (v // 10) << 4 | v % 10
raw = bytearray()
for i in range(total + 150 - 150):
    m, s_, f = (i + 150) // 4500, ((i + 150) // 75) % 60, (i + 150) % 75
    raw += b'\0' + b'\xff' * 10 + b'\0' + bytes([bcd(m), bcd(s_), bcd(f), 2]) + bytes([0, 0, 8, 0] * 2) + img[i * S:(i + 1) * S] + b'\0' * 280
open(out + '.bin', 'wb').write(raw)
open(out + '.cue', 'w').write('FILE "%s.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n' % out.split('/')[-1])
print('sectors', total)
