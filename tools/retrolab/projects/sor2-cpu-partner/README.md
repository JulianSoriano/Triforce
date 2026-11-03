# Streets of Rage 2 — CPU Partner (RetroLab project)

Working notes and test routes for the CPU Partner mod by RAMENPHOLIFE. The mod's own source lives in its repository
(`JulianSoriano/sor2-cpu-partner`); this folder holds what RetroLab needs to study and test it. No ROMs are kept here.

## ROMs

| File | SHA-1 |
|---|---|
| Streets of Rage 2 (USA) — the ROM `v8.ips` applies to | `8b656eec9692d88bbbb84787142aa732b44ce0be` |
| Streets of Rage 2 - CPU Partner v8.md | `c7d140896d1010ab4e52a0de081a59a9e81a111c` |
| Streets of Rage 2 - CPU Partner v8.ips | `c03c779080c059d6c0359ff8ddc7a121712b7039` |

No original ROM? `node rebuild-original.js "<v8>.md" <v8 source>/build.py original.md` undoes the mod using the
original bytes recorded in `build.py`, and checks the result against the SHA-1 above.

## Routes

- `start-stage1.txt` — power-on to stage 1 in CPU PARTNER mode (about 2,060 frames).
- `route-stage1.txt` — the above, then walking and fighting through stage 1 (8,270 frames in all).

```sh
cd tools/retrolab
node bin/retrolab.js run v8.md --script projects/sor2-cpu-partner/start-stage1.txt --save stage1.state --shot stage1.png
node bin/retrolab.js check original.md v8.md --script projects/sor2-cpu-partner/route-stage1.txt --skip 2058
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
3. **Donovan and Jack jump-kick too often.** Candidate distance checks against 70 (`cmpi.w #$46,d2`) at `$01741E`,
   `$018AFA`, `$01B4B0` and `$01FA8A`. Not yet tied to the enemies: `watch` an enemy's state word while it jump-kicks
   to find which routine sets it.

## v9 (work in progress)

`v9/make-v9.js` turns a v8 ROM into the v9 test ROM with small patches (no compiler needed; each checks the old bytes
first). The `.s` files in `v9/` are the new code, placed in free ROM from `$1FAC00`.

| Patch | What it changes |
|---|---|
| `jk-cooldown`, `jk-min`, `jk-max` | The partner's jump kick: cooldown 40 -> 180 frames; range 32..90 -> 48..80 px (it closes a real gap instead of kicking up close) |
| `idle-target-*` (`idle-target.s`) | Nothing to fight: head for camera + 230 (not camera + 400, the far edge) and never get more than 150 px ahead of the human |
| `sticky-side-*` (`sticky-side.s`) | Which side of an enemy she stands on only changes once she is 16 px past him (it flipped every frame when level with him) |
| `pace-zone-*` (`pace-zone.s`) | The twitch: waiting for an off-screen enemy she walked to her spot, turned to face him (a 2 px step), which put her outside the 6 px zone, so she stepped back and turned away, every frame. Once she faces him the zone is 24 px. This is a v8 bug |

Measured on a 31,000-frame scripted route (the scripted human just holds a direction):
jump kicks started 114 -> ~60; turn-around twitches 37 -> 1; `check` shows no crashes and no extra slowdown
(46 -> 45 slow frames, 64.6% busy both). How the partner feels next to a real player still needs a playtest.
The enemies' own jump kicks (Donovan, Jack) are separate and not touched yet: their routines run only after stage 1's
first section, so the stage 1 route never reaches them.
