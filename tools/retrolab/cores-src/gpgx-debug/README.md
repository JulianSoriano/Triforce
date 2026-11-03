# gpgx-debug

Genesis Plus GX (libretro) built with `HOOK_CPU`, plus `dbg.c`, a small frontend that gives it the same `web_*`
interface as Triforce's player cores and adds watchpoints, an instruction counter and an execution profile.

Build: `EMCC=/path/to/emcc ./build.sh` (clones Genesis Plus GX; set `GPGX_SRC` to use a checkout, `GPGX_REV` to pin a
commit). The current `cores/gpgx-debug.wasm` was built from commit f27655b with Emscripten and LLVM 18.

Genesis Plus GX is free for non-commercial use; see its LICENSE.txt.
