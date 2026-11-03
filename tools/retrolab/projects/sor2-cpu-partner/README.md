# Streets of Rage 2 — CPU Partner (RetroLab project)

Working notes and test routes for the CPU Partner mod by RAMENPHOLIFE. The mod's own source lives in its repository
(`JulianSoriano/sor2-cpu-partner`); this folder holds what RetroLab needs to study and test it. No ROMs are kept here.

## ROMs

There is one patch: `patch/Streets of Rage 2 - CPU Partner v9.ips` in the mod's repository. It applies to the original,
unmodified ROM. No ROMs are kept here.

| File | SHA-1 |
|---|---|
| Streets of Rage 2 (USA), the original | `8b656eec9692d88bbbb84787142aa732b44ce0be` |
| The original with the v9 patch applied | `0049ae1c92829ba09fb49378028ec8451452a340` |

## Routes

- `start-stage1.txt` — power-on to stage 1 in CPU PARTNER mode (about 2,060 frames).
- `route-stage1.txt` — the above, then walking and fighting through stage 1 (8,270 frames in all).

```sh
cd tools/retrolab
node bin/retrolab.js run patched.md --script projects/sor2-cpu-partner/start-stage1.txt --save stage1.state --shot stage1.png
node bin/retrolab.js check original.md patched.md --script projects/sor2-cpu-partner/route-stage1.txt --skip 2058
```

## Memory and code (checked with RetroLab)

| Address | What | How it was found |
|---|---|---|
| `$001A4E` | Main loop's wait for the next frame: `tst.b $FFFC10.w / bne.s` | `profile`: 11-12% of all instructions in stage 1 |
| `$FFFC10` | Set by the VBlank handler; the main loop waits on it (the mod's VBlank guard reads it too) | the code above, `cpu_partner.asm` |
| `$FFFC18` | Main-menu cursor (the mod's menu code) | `cpu_partner.asm` |
| `$FFFD06`, `$FFFD0E` | Lives / continues settings (the mod's options code) | `cpu_partner.asm` |
| `$FFFE20` | Start of the mod's own working memory (`struct Mem` in `ai.c`) | `build.py` |
| `$1F8000`, `$1F9000` | The mod's glue code and the C brain in the ROM | `build.py` |
| `$020DE6` | `move.w d2,(a3)+`: builds the sprite list (writes `$FFECC2` and up) | `watch` |
| `$FF9014` | A word that counts frames during the intro | `find` + live write |

## Feedback being worked on

1. **Screen pull in 2-player.** Not yet located: next step is to `find` the camera position (it changes only when
   the screen scrolls), then `watch` it for the code that decides how far each player may pull.
2. **Slowdown with 4+ enemies (stages 1, 6, 8).** Baseline from `check` on `route-stage1.txt` (stage 1 only, after
   the menus): neither the original nor v8 dropped a frame on this route; the 68000 was busy 56.9% of the time in the
   original and 63.6% with the mod (the partner's AI costs about 7% of the CPU). The route needs more enemies on screen
   at once to show the reported slowdown.

## v9

What the v9 patches change, with the source for each, is in the mod's repository (`CHANGELOG.md` and `src/patches-v9/`).
The measurements below were taken with this folder's routes.

Measured on a 31,000-frame scripted route (the scripted human just holds a direction):
jump kicks started 114 -> ~60; turn-around twitches 37 -> 0; left/right pad twitches 14 -> 0 and up/down 23 -> 0 (22,000 frames);
the bar table breaks after ~240 frames instead of ~1160; `check` on `route-stage1.txt` shows no crashes and no extra slowdown
(179 slow frames, 2.2%, before and after). How the partner feels next to a real player still needs a playtest.
Routes for later stages: save states are cheap to make with `run --save` and a loop that keeps both players'
HP topped up with the human holding RIGHT with a B now and then; stage 1's bar is about 28,000 frames in.
