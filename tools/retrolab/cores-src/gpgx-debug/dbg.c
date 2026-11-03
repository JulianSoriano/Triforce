/* RetroLab debug build of Genesis Plus GX.
 * A small libretro frontend with the same web_* exports as Triforce's player cores, plus:
 *   - write and read watchpoints on 68000 addresses: each hit records the instruction (PC) that did it
 *   - an instruction counter per frame (how busy the 68000 is: the slowdown meter)
 *   - an execution profile: how many times each instruction address ran
 *   - direct pointers to work RAM and Z80 RAM
 * Built with Emscripten as a standalone WebAssembly module (see build.sh). */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include "libretro.h"
#include "cpuhook.h"

#define EXPORT __attribute__((used, visibility("default")))

static uint32_t pads[2];
static const void *vid_data; static unsigned vid_w = 320, vid_h = 224; static size_t vid_pitch;
static enum retro_pixel_format pixfmt = RETRO_PIXEL_FORMAT_0RGB1555;
static uint32_t *rgba; static int loaded;
static int16_t audio_buf[8192]; static unsigned audio_n;

static uint8_t *rom_copy; static size_t rom_len; static char rom_ext[16] = "md";
static struct retro_game_info_ext info_ext;
static void log_cb(enum retro_log_level level, const char *fmt, ...) { (void)level; (void)fmt; }
static bool env_cb(unsigned cmd, void *data) {
  switch (cmd) {
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: case RETRO_ENVIRONMENT_GET_CONTENT_DIRECTORY:
      *(const char **)data = "/"; return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: pixfmt = *(enum retro_pixel_format *)data; return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: { struct retro_variable *v = data; v->value = NULL; return false; }
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((struct retro_log_callback *)data)->log = log_cb; return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool *)data = true; return true;
    case RETRO_ENVIRONMENT_GET_GAME_INFO_EXT:   /* hand the ROM over from memory (there are no files here) */
      memset(&info_ext, 0, sizeof info_ext);
      info_ext.full_path = "/game"; info_ext.dir = "/"; info_ext.name = "game"; info_ext.ext = rom_ext;
      info_ext.data = rom_copy; info_ext.size = rom_len;
      *(const struct retro_game_info_ext **)data = &info_ext; return true;
    default: return false;
  }
}
static void video_cb(const void *data, unsigned w, unsigned h, size_t pitch) { if (data) { vid_data = data; vid_w = w; vid_h = h; vid_pitch = pitch; } }
static void audio_cb(int16_t l, int16_t r) { (void)l; (void)r; }
static size_t audio_batch_cb(const int16_t *d, size_t frames) { (void)d; return frames; }
static void input_poll_cb(void) {}
static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
  (void)device; (void)index; if (port > 1) return 0;
  if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)pads[port];
  return (pads[port] >> id) & 1;
}

/* ---------------- debugging ---------------- */
typedef struct { uint32_t pc, addr, value, frame; uint8_t width, kind, pad[2]; } hit_t;   /* kind 1 = write, 2 = read */
#define MAXW 16
#define MAXHITS 65536
static uint32_t wlo[MAXW], whi[MAXW]; static uint8_t wkind[MAXW]; static int nwatch;
static hit_t hits[MAXHITS]; static uint32_t nhits, lost;
static uint32_t cur_pc, frame_no, instr_frame;
static uint32_t *prof_rom; static uint32_t prof_ram[0x8000]; static int profiling;

static void hook(hook_type_t type, int width, unsigned int address, unsigned int value) {
  if (type == HOOK_M68K_E) {
    cur_pc = address & 0xFFFFFF; instr_frame++;
    if (profiling) { if (cur_pc < 0x400000) prof_rom[cur_pc >> 1]++; else if (cur_pc >= 0xFF0000) prof_ram[(cur_pc & 0xFFFF) >> 1]++; }
    return;
  }
  if (type != HOOK_M68K_W && type != HOOK_M68K_R) return;
  uint32_t a = address & 0xFFFFFF; uint8_t kind = type == HOOK_M68K_W ? 1 : 2;
  for (int i = 0; i < nwatch; i++) {
    if (!(wkind[i] & kind)) continue;
    if (a + (uint32_t)width - 1 < wlo[i] || a > whi[i]) continue;
    if (nhits < MAXHITS) { hit_t *h = &hits[nhits++]; h->pc = cur_pc; h->addr = a; h->value = value; h->frame = frame_no; h->width = (uint8_t)width; h->kind = kind; }
    else lost++;
    break;
  }
}
static void update_hook(void) { set_cpu_hook(hook); }

EXPORT int dbg_watch(uint32_t lo, uint32_t hi, int kind) { if (nwatch >= MAXW) return 0; wlo[nwatch] = lo & 0xFFFFFF; whi[nwatch] = hi & 0xFFFFFF; wkind[nwatch] = (uint8_t)(kind ? kind : 1); nwatch++; return 1; }
EXPORT void dbg_unwatch(void) { nwatch = 0; }
EXPORT hit_t *dbg_hits(void) { return hits; }
EXPORT uint32_t dbg_hit_count(void) { return nhits; }
EXPORT uint32_t dbg_hits_lost(void) { return lost; }
EXPORT void dbg_clear_hits(void) { nhits = 0; lost = 0; }
EXPORT uint32_t dbg_instructions(void) { return instr_frame; }           /* in the last frame */
EXPORT void dbg_profile(int on) { if (on && !prof_rom) prof_rom = calloc(0x200000, 4); profiling = on && prof_rom; }
EXPORT void dbg_profile_clear(void) { if (prof_rom) memset(prof_rom, 0, 0x200000 * 4); memset(prof_ram, 0, sizeof prof_ram); }
EXPORT uint32_t *dbg_profile_rom(void) { return prof_rom; }              /* [pc / 2] for pc < $400000 */
EXPORT uint32_t *dbg_profile_ram(void) { return prof_ram; }              /* [(pc & $FFFF) / 2] for pc >= $FF0000 */
EXPORT uint32_t dbg_hit_size(void) { return sizeof(hit_t); }
EXPORT uint8_t *dbg_ram(void) { return retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM); }
EXPORT uint32_t dbg_frame(void) { return frame_no; }

/* ---------------- the same interface as the player cores ---------------- */
EXPORT void web_set_verbose(int v) { (void)v; }
EXPORT int web_init(void) {
  retro_set_environment(env_cb); retro_set_video_refresh(video_cb); retro_set_audio_sample(audio_cb);
  retro_set_audio_sample_batch(audio_batch_cb); retro_set_input_poll(input_poll_cb); retro_set_input_state(input_state_cb);
  retro_init(); return 1;
}
EXPORT void *web_alloc(size_t n) { return malloc(n); }
EXPORT void web_free(void *p) { free(p); }
EXPORT void web_set_option(const char *k, const char *v) { (void)k; (void)v; }
EXPORT int web_load(const uint8_t *data, size_t len, const char *ext) {
  (void)ext;
  if (loaded) { retro_unload_game(); loaded = 0; }
  free(rom_copy); rom_copy = malloc(len); memcpy(rom_copy, data, len); rom_len = len;
  if (ext && *ext) { strncpy(rom_ext, ext, 15); rom_ext[15] = 0; }
  static char name[32]; strcpy(name, "/game."); strncat(name, rom_ext, 20);
  struct retro_game_info gi = { name, rom_copy, len, NULL };
  loaded = retro_load_game(&gi);
  update_hook();
  return loaded;
}
EXPORT void web_reset(void) { retro_reset(); }
EXPORT void web_run(void) { instr_frame = 0; retro_run(); frame_no++; }
EXPORT void web_set_pad(int port, uint32_t mask) { if (port >= 0 && port < 2) pads[port] = mask; }
EXPORT void web_set_port_device(int port, unsigned dev) { retro_set_controller_port_device(port, dev); }
EXPORT uint32_t web_frame_w(void) { return vid_w; }
EXPORT uint32_t web_frame_h(void) { return vid_h; }
EXPORT uint32_t *web_frame(void) {
  if (!rgba) rgba = malloc(1024 * 1024 * 4);
  if (!vid_data) return rgba;
  for (unsigned y = 0; y < vid_h; y++) {
    const uint8_t *row = (const uint8_t *)vid_data + y * vid_pitch; uint32_t *out = rgba + y * vid_w;
    for (unsigned x = 0; x < vid_w; x++) {
      uint32_t r, g, b;
      if (pixfmt == RETRO_PIXEL_FORMAT_XRGB8888) { uint32_t p = ((const uint32_t *)row)[x]; r = (p >> 16) & 255; g = (p >> 8) & 255; b = p & 255; }
      else if (pixfmt == RETRO_PIXEL_FORMAT_RGB565) { uint16_t p = ((const uint16_t *)row)[x]; r = ((p >> 11) & 31) * 255 / 31; g = ((p >> 5) & 63) * 255 / 63; b = (p & 31) * 255 / 31; }
      else { uint16_t p = ((const uint16_t *)row)[x]; r = ((p >> 10) & 31) * 255 / 31; g = ((p >> 5) & 31) * 255 / 31; b = (p & 31) * 255 / 31; }
      out[x] = 0xFF000000u | (b << 16) | (g << 8) | r;
    }
  }
  return rgba;
}
EXPORT int16_t *web_audio(void) { return audio_buf; }
EXPORT double web_fps(void) { struct retro_system_av_info av; retro_get_system_av_info(&av); return av.timing.fps; }
EXPORT double web_sample_rate(void) { struct retro_system_av_info av; retro_get_system_av_info(&av); return av.timing.sample_rate; }
EXPORT double web_aspect(void) { struct retro_system_av_info av; retro_get_system_av_info(&av); return av.geometry.aspect_ratio; }
EXPORT size_t web_state_size(void) { return retro_serialize_size(); }
EXPORT int web_state_save(void *p, size_t n) { return retro_serialize(p, n); }
EXPORT int web_state_load(const void *p, size_t n) { return retro_unserialize(p, n); }
EXPORT uint8_t *web_sram(void) { return retro_get_memory_data(RETRO_MEMORY_SAVE_RAM); }
EXPORT size_t web_sram_size(void) { return retro_get_memory_size(RETRO_MEMORY_SAVE_RAM); }
