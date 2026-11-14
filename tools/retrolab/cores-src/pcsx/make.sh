#!/bin/bash
# Build PCSX-ReARMed (libretro) as a static library for wasm32-wasi
set -e
SDK=/tmp/wsdk/wasi-sdk-25.0-x86_64-linux
cd /tmp/psx/src
XF="-DNO_DYLIB -DNO_SOCKET -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -msimd128 -mllvm -wasm-enable-sjlj -Wno-error=implicit-function-declaration -Wno-error=int-conversion -Wno-incompatible-function-pointer-types"
make -f Makefile.libretro platform=unix STATIC_LINKING=1 -j8 \
  CC="$SDK/bin/clang --target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot $XF" \
  CXX="$SDK/bin/clang++ --target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot" \
  AR="$SDK/bin/llvm-ar" \
  DYNAREC= NO_MMAP=1 BUILTIN_GPU=unai HAVE_PHYSICAL_CDROM=0 USE_LIBRETRO_VFS=0 \
  USE_RTHREADS=0 USE_ASYNC_CDROM=0 USE_ASYNC_GPU=0 USE_ASYNC_SPU=0 LIBPTHREAD= HAVE_CHD=${HAVE_CHD:-1} \
  ARCH=wasm32 CFLAGS_OPT=-O2 \
  EXTRA_CFLAGS="-DNO_DYLIB -DNO_SOCKET -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -msimd128 -mllvm -wasm-enable-sjlj -Wno-error=implicit-function-declaration -Wno-error=int-conversion -Wno-incompatible-function-pointer-types" "$@"
