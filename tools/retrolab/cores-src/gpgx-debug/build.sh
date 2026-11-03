#!/bin/bash
# Builds cores/gpgx.wasm: Genesis Plus GX with RetroLab's debug hooks. The same file is Triforce's Genesis core,
# so save states move freely between the app and RetroLab.
# Needs Emscripten (emcc on PATH, or EMCC=/path/to/emcc) and git.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HERE/../../cores/gpgx.wasm}"
EMCC="${EMCC:-emcc}"
SRC="${GPGX_SRC:-$HERE/.src}"
REV="${GPGX_REV:-}"   # pin a commit with GPGX_REV=...
if [ ! -d "$SRC/core" ]; then git clone -q https://github.com/libretro/Genesis-Plus-GX.git "$SRC"; fi
if [ -n "$REV" ]; then git -C "$SRC" checkout -q "$REV"; fi
cd "$SRC"
# the hook pointer is declared in a header without "extern": make it a declaration so it is defined once
sed -i 's/^void (\*cpu_hook)(hook_type_t/extern void (*cpu_hook)(hook_type_t/' core/debug/cpuhook.h
CORE=core
DIRS="$CORE $CORE/z80 $CORE/m68k $CORE/ntsc $CORE/sound $CORE/input_hw $CORE/cd_hw $CORE/cart_hw $CORE/cart_hw/svp $CORE/debug"
# the source tree moved things around over the years: find tremor, zlib and minimp3 wherever they are
TREMOR=$(ls -d $CORE/sound/tremor $CORE/tremor 2>/dev/null | head -1)
ZLIB=$(ls -d libretro/deps/zlib-1.2.11 $CORE/cd_hw/libchdr/deps/zlib 2>/dev/null | head -1)
INC=""; for d in $DIRS; do INC="$INC -I$d"; done
INC="$INC -Ilibretro -Ilibretro/libretro-common/include -I$ZLIB -I$TREMOR"
[ -d $CORE/sound/minimp3 ] && INC="$INC -I$CORE/sound/minimp3"
FILES=""
for d in $DIRS; do FILES="$FILES $(ls $d/*.c 2>/dev/null)"; done
FILES="$FILES $(ls $TREMOR/*.c) libretro/libretro.c $(ls libretro/scrc32.c 2>/dev/null)"
for f in streams/file_stream.c streams/file_stream_transforms.c compat/fopen_utf8.c compat/compat_snprintf.c compat/compat_strl.c \
         compat/compat_strcasestr.c compat/compat_posix_string.c encodings/encoding_utf.c file/file_path.c file/retro_dirent.c \
         lists/string_list.c lists/dir_list.c memmap/memalign.c string/stdstring.c vfs/vfs_implementation.c; do
  [ -f libretro/libretro-common/$f ] && FILES="$FILES libretro/libretro-common/$f"; done
for f in adler32 crc32 inffast inflate inftrees zutil; do [ -f $ZLIB/$f.c ] && FILES="$FILES $ZLIB/$f.c"; done
DEFS="-DLSB_FIRST -DALIGN_LONG -DBYTE_ORDER=LITTLE_ENDIAN -DHAVE_ZLIB -D__LIBRETRO__ -DUSE_LIBRETRO_VFS -DM68K_OVERCLOCK_SHIFT=20 \
      -DZ80_OVERCLOCK_SHIFT=20 -DHAVE_YM3438_CORE -DHAVE_OPLL_CORE -DMAXROMSIZE=33554432 -DINLINE='static inline' \
      -DUSE_LIBTREMOR -DUSE_16BPP_RENDERING -DFRONTEND_SUPPORTS_RGB565 -DHOOK_CPU -DNDEBUG -sSUPPORT_LONGJMP=wasm"
mkdir -p "$HERE/.obj"
OBJS=""
for f in $FILES "$HERE/dbg.c"; do
  o="$HERE/.obj/$(echo "$f" | tr '/' '_' | sed 's/\.c$/.o/')"
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ]; then eval "$EMCC" -c -O2 -w $DEFS $INC "$f" -o "$o"; fi
  OBJS="$OBJS $o"
done
"$EMCC" -O2 $OBJS -o "$OUT" -sSTANDALONE_WASM -sSUPPORT_LONGJMP=wasm --no-entry -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_web_set_verbose,_web_init,_web_alloc,_web_free,_web_set_option,_web_load,_web_reset,_web_run,_web_set_pad,_web_frame,_web_frame_w,_web_frame_h,_web_audio,_web_fps,_web_sample_rate,_web_aspect,_web_state_size,_web_state_save,_web_state_load,_web_sram,_web_sram_size,_web_set_port_device,_dbg_enable,_dbg_watch,_dbg_unwatch,_dbg_hits,_dbg_hit_count,_dbg_hits_lost,_dbg_clear_hits,_dbg_instructions,_dbg_profile,_dbg_profile_clear,_dbg_profile_rom,_dbg_profile_ram,_dbg_hit_size,_dbg_ram,_dbg_frame
echo "built $OUT ($(stat -c %s "$OUT") bytes) from Genesis Plus GX $(git -C "$SRC" rev-parse --short HEAD)"
