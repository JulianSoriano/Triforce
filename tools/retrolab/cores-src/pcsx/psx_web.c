/* PCSX-ReARMed (PlayStation) for Triforce's Emulators tab.
 * A small libretro frontend with the same web_* exports as the other player cores, plus an in-memory file system
 * (served to the core through the libretro VFS interface) so disc images (.cue + .bin, .chd, .pbp, .iso) and an
 * optional BIOS can be handed over from the browser without any real files.
 * Built with wasi-sdk as a WebAssembly reactor module (see build.sh). */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdarg.h>
#include <stdio.h>
#include "libretro.h"

#define EXPORT __attribute__((used, visibility("default")))

/* ---------------- in-memory files ---------------- */
typedef struct { char name[128]; uint8_t *data; size_t len, cap; int used; } memfile_t;
#define MAXF 64
static memfile_t files[MAXF];
struct retro_vfs_file_handle { memfile_t *f; int64_t pos; char path[256]; };

static const char *base(const char *p) { const char *a = strrchr(p, '/'), *b = strrchr(p, '\\'); if (b > a) a = b; return a ? a + 1 : p; }
static memfile_t *find(const char *path) {
  const char *b = base(path);
  for (int i = 0; i < MAXF; i++) if (files[i].used && !strcasecmp(files[i].name, b)) return &files[i];
  return NULL;
}
static memfile_t *create(const char *path) {
  memfile_t *f = find(path); if (f) return f;
  for (int i = 0; i < MAXF; i++) if (!files[i].used) {
    f = &files[i]; memset(f, 0, sizeof *f); f->used = 1;
    strncpy(f->name, base(path), sizeof f->name - 1); return f;
  }
  return NULL;
}
static const char *v_get_path(struct retro_vfs_file_handle *h) { return h->path; }
static struct retro_vfs_file_handle *v_open(const char *path, unsigned mode, unsigned hints) {
  (void)hints; memfile_t *f = find(path);
  if (!f) { if (!(mode & RETRO_VFS_FILE_ACCESS_WRITE)) return NULL; f = create(path); if (!f) return NULL; }
  else if ((mode & RETRO_VFS_FILE_ACCESS_WRITE) && !(mode & RETRO_VFS_FILE_ACCESS_UPDATE_EXISTING) && !(mode & RETRO_VFS_FILE_ACCESS_READ)) f->len = 0;
  struct retro_vfs_file_handle *h = calloc(1, sizeof *h); h->f = f; strncpy(h->path, path, sizeof h->path - 1); return h;
}
static int v_close(struct retro_vfs_file_handle *h) { free(h); return 0; }
static int64_t v_size(struct retro_vfs_file_handle *h) { return (int64_t)h->f->len; }
static int64_t v_tell(struct retro_vfs_file_handle *h) { return h->pos; }
static int64_t v_seek(struct retro_vfs_file_handle *h, int64_t off, int whence) {
  int64_t p = whence == RETRO_VFS_SEEK_POSITION_START ? off : whence == RETRO_VFS_SEEK_POSITION_CURRENT ? h->pos + off : (int64_t)h->f->len + off;
  if (p < 0) return -1; h->pos = p; return p;
}
static int64_t v_read(struct retro_vfs_file_handle *h, void *s, uint64_t len) {
  if (h->pos >= (int64_t)h->f->len) return 0;
  uint64_t n = h->f->len - (size_t)h->pos; if (n > len) n = len;
  memcpy(s, h->f->data + h->pos, n); h->pos += n; return (int64_t)n;
}
static int grow(memfile_t *f, size_t need) {
  if (need <= f->cap) return 1;
  size_t c = f->cap ? f->cap : 4096; while (c < need) c *= 2;
  uint8_t *d = realloc(f->data, c); if (!d) return 0; f->data = d; f->cap = c; return 1;
}
static int64_t v_write(struct retro_vfs_file_handle *h, const void *s, uint64_t len) {
  size_t end = (size_t)h->pos + len; if (!grow(h->f, end)) return -1;
  if ((size_t)h->pos > h->f->len) memset(h->f->data + h->f->len, 0, h->pos - h->f->len);
  memcpy(h->f->data + h->pos, s, len); h->pos = end; if (end > h->f->len) h->f->len = end; return (int64_t)len;
}
static int v_flush(struct retro_vfs_file_handle *h) { (void)h; return 0; }
static int v_remove(const char *path) { memfile_t *f = find(path); if (!f) return -1; free(f->data); memset(f, 0, sizeof *f); return 0; }
static int v_rename(const char *a, const char *b) { memfile_t *f = find(a); if (!f) return -1; strncpy(f->name, base(b), sizeof f->name - 1); return 0; }
static int64_t v_truncate(struct retro_vfs_file_handle *h, int64_t len) { if (!grow(h->f, (size_t)len)) return -1; h->f->len = (size_t)len; return 0; }
static int v_stat(const char *path, int32_t *size) {
  const char *b = base(path);
  if (!*b) { if (size) *size = 0; return RETRO_VFS_STAT_IS_VALID | RETRO_VFS_STAT_IS_DIRECTORY; }   /* the root folder */
  memfile_t *f = find(path); if (!f) return 0;
  if (size) *size = (int32_t)f->len; return RETRO_VFS_STAT_IS_VALID;
}
static int v_mkdir(const char *d) { (void)d; return 0; }
/* folders: one flat root that lists every file (lets the core find a BIOS by scanning) */
struct retro_vfs_dir_handle { int i; };
static struct retro_vfs_dir_handle *v_opendir(const char *dir, bool hidden) { (void)dir; (void)hidden; struct retro_vfs_dir_handle *d = calloc(1, sizeof *d); d->i = -1; return d; }
static bool v_readdir(struct retro_vfs_dir_handle *d) { while (++d->i < MAXF) if (files[d->i].used) return true; return false; }
static const char *v_dirent_name(struct retro_vfs_dir_handle *d) { return files[d->i].name; }
static bool v_dirent_isdir(struct retro_vfs_dir_handle *d) { (void)d; return false; }
static int v_closedir(struct retro_vfs_dir_handle *d) { free(d); return 0; }
static struct retro_vfs_interface vfs = {
  v_get_path, v_open, v_close, v_size, v_tell, v_seek, v_read, v_write, v_flush, v_remove, v_rename,
  v_truncate, v_stat, v_mkdir, v_opendir, v_readdir, v_dirent_name, v_dirent_isdir, v_closedir,
};

/* ---------------- libretro frontend ---------------- */
static uint32_t pads[2];
static const void *vid_data; static unsigned vid_w = 320, vid_h = 240; static size_t vid_pitch;
static enum retro_pixel_format pixfmt = RETRO_PIXEL_FORMAT_0RGB1555;
static uint32_t *rgba; static int loaded, verbose;
static int16_t audio_buf[16384]; static unsigned audio_n;
#define MAXOPT 160
static char opt_k[MAXOPT][64], opt_v[MAXOPT][64]; static int nopt;

static void log_cb(enum retro_log_level level, const char *fmt, ...) {
  if (!verbose && level < RETRO_LOG_WARN) return;
  va_list ap; va_start(ap, fmt); vfprintf(stderr, fmt, ap); va_end(ap);
}
static bool env_cb(unsigned cmd, void *data) {
  switch (cmd) {
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: case RETRO_ENVIRONMENT_GET_CONTENT_DIRECTORY:
      *(const char **)data = "/"; return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: pixfmt = *(enum retro_pixel_format *)data; return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      struct retro_variable *v = data; v->value = NULL;
      for (int i = 0; i < nopt; i++) if (!strcmp(opt_k[i], v->key)) { v->value = opt_v[i]; return true; }
      return false;
    }
    /* the core announces its options with their defaults: keep those so every option has a value */
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned *)data = 2; return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL: case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2: {
      const struct retro_core_options_v2 *o = cmd == RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2 ? data : ((const struct retro_core_options_v2_intl *)data)->us;
      if (!o) return false;
      for (const struct retro_core_option_v2_definition *d = o->definitions; d && d->key; d++) {
        int have = 0; for (int i = 0; i < nopt; i++) if (!strcmp(opt_k[i], d->key)) have = 1;
        if (!have && nopt < MAXOPT && d->default_value) { strncpy(opt_k[nopt], d->key, 63); strncpy(opt_v[nopt], d->default_value, 63); nopt++; }
      }
      return true;
    }
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((struct retro_log_callback *)data)->log = log_cb; return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool *)data = true; return true;
    case RETRO_ENVIRONMENT_GET_VFS_INTERFACE: {
      struct retro_vfs_interface_info *vi = data;
      if (vi->required_interface_version > 3) return false;
      vi->required_interface_version = 3; vi->iface = &vfs; return true;
    }
    default: return false;
  }
}
static void video_cb(const void *data, unsigned w, unsigned h, size_t pitch) { if (data) { vid_data = data; vid_w = w; vid_h = h; vid_pitch = pitch; } }
static void audio_cb(int16_t l, int16_t r) { if (audio_n < 8192) { audio_buf[audio_n * 2] = l; audio_buf[audio_n * 2 + 1] = r; audio_n++; } }
static size_t audio_batch_cb(const int16_t *d, size_t frames) {
  size_t n = frames; if (audio_n + n > 8192) n = 8192 - audio_n;
  memcpy(audio_buf + audio_n * 2, d, n * 4); audio_n += n; return frames;
}
static void input_poll_cb(void) {}
static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
  (void)index; if (port > 1) return 0;
  if (device == RETRO_DEVICE_ANALOG) return 0;   /* sticks centred */
  if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)pads[port];
  return (pads[port] >> id) & 1;
}

EXPORT void web_set_verbose(int v) { verbose = v; }
EXPORT int web_init(void) {
  retro_set_environment(env_cb); retro_set_video_refresh(video_cb); retro_set_audio_sample(audio_cb);
  retro_set_audio_sample_batch(audio_batch_cb); retro_set_input_poll(input_poll_cb); retro_set_input_state(input_state_cb);
  retro_init();
  rgba = malloc(1024 * 1024 * 4);
  return 1;
}
EXPORT void *web_alloc(size_t n) { return malloc(n); }
EXPORT void web_free(void *p) { free(p); }
EXPORT void web_set_option(const char *k, const char *v) {
  for (int i = 0; i < nopt; i++) if (!strcmp(opt_k[i], k)) { strncpy(opt_v[i], v, 63); return; }
  if (nopt < MAXOPT) { strncpy(opt_k[nopt], k, 63); strncpy(opt_v[nopt], v, 63); nopt++; }
}
/* Hands a file to the core's file system. The memory (from web_alloc) now belongs to the file. */
EXPORT int web_add_file(const char *name, uint8_t *data, size_t len) {
  memfile_t *f = create(name); if (!f) return 0;
  if (f->data && f->data != data) free(f->data);
  f->data = data; f->len = f->cap = len; return 1;
}
EXPORT void web_clear_files(void) { for (int i = 0; i < MAXF; i++) if (files[i].used) { free(files[i].data); memset(&files[i], 0, sizeof files[i]); } }
EXPORT int web_load_path(const char *name) {
  if (loaded) { retro_unload_game(); loaded = 0; }
  static char path[160]; snprintf(path, sizeof path, "/%s", base(name));
  struct retro_game_info gi = { path, NULL, 0, NULL };
  memfile_t *f = find(path); if (f) { gi.data = f->data; gi.size = f->len; }
  loaded = retro_load_game(&gi);
  return loaded;
}
/* single-file load, same call as the other cores: the bytes are copied in as "game.<ext>" */
EXPORT int web_load(const uint8_t *data, size_t len, const char *ext) {
  char name[32]; snprintf(name, sizeof name, "game.%s", ext && *ext ? ext : "bin");
  uint8_t *copy = malloc(len); if (!copy) return 0; memcpy(copy, data, len);
  web_add_file(name, copy, len);
  return web_load_path(name);
}
EXPORT void web_reset(void) { retro_reset(); }
EXPORT unsigned web_run(void) { audio_n = 0; retro_run(); return audio_n; }
EXPORT void web_set_pad(int port, uint32_t mask) { if (port >= 0 && port < 2) pads[port] = mask; }
EXPORT void web_set_port_device(int port, unsigned dev) { retro_set_controller_port_device(port, dev); }
EXPORT uint32_t web_frame_w(void) { return vid_w; }
EXPORT uint32_t web_frame_h(void) { return vid_h; }
EXPORT uint32_t *web_frame(void) {
  if (!vid_data) return rgba;
  if (vid_w > 1024 || vid_h > 1024) return rgba;
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
/* the console's 2 MB of main memory (for save editors and watchers) */
EXPORT uint8_t *web_ram(void) { return retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM); }
EXPORT size_t web_ram_size(void) { return retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM); }
EXPORT uint8_t *web_sram(void) { return retro_get_memory_data(RETRO_MEMORY_SAVE_RAM); }
EXPORT size_t web_sram_size(void) { return retro_get_memory_size(RETRO_MEMORY_SAVE_RAM); }
/* "is a real BIOS in use?" so the page can say so */
EXPORT int web_file_count(void) { int n = 0; for (int i = 0; i < MAXF; i++) n += files[i].used; return n; }
