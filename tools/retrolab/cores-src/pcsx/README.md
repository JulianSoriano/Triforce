# pcsx (PlayStation)

PCSX-ReARMed (libretro) compiled to WebAssembly with wasi-sdk 25, plus `psx_web.c`: a small frontend with the same
`web_*` interface as Triforce's other player cores and an in-memory file system served through the libretro VFS
interface, so a disc (.cue + .bin, .chd, .pbp, .iso) and an optional BIOS can be handed over from the browser.

Build: clone https://github.com/libretro/pcsx_rearmed to `/tmp/psx/src`, unpack wasi-sdk 25 to `/tmp/wsdk`, then run
`make.sh USE_LIBRETRO_VFS=1` and `link.sh` (paths are at the top of each script). Interpreter only (no dynarec), the
"unai" software renderer, no threads. `mkiso.py` makes a tiny test disc from a PS-EXE.

PCSX-ReARMed is GPL-2.0; see its COPYING file.
