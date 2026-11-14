#!/bin/bash
set -e
SDK=/tmp/wsdk/wasi-sdk-25.0-x86_64-linux
CC="$SDK/bin/clang --target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot"
cd /tmp/psx/build
$CC -O2 -c psx_web.c -I/tmp/psx/src/libretro-common/include -I/tmp/psx/src/deps/libretro-common/include -o psx_web.o
$CC -O2 -mexec-model=reactor psx_web.o /tmp/psx/src/pcsx_rearmed_libretro.so -o pcsx.wasm \
  -lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid -lsetjmp \
  -Wl,--max-memory=4294967296 -Wl,--initial-memory=67108864 -Wl,--gc-sections -Wl,--strip-all \
  $(for f in malloc free web_set_verbose web_init web_alloc web_free web_set_option web_add_file web_clear_files web_load_path web_load web_reset web_run web_set_pad web_set_port_device web_frame web_frame_w web_frame_h web_audio web_fps web_sample_rate web_aspect web_state_size web_state_save web_state_load web_sram web_sram_size web_file_count; do echo -n "-Wl,--export=$f "; done)
ls -la pcsx.wasm
