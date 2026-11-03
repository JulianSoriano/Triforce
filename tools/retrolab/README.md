# RetroLab

Headless tools for studying and modding retro games. It runs the same emulator cores as Triforce's Emulators tab, without a window, so a script (or Claude) can play a game, watch its memory, test a change and check the result.

| System | Core | CPU | RAM you can read and write |
|---|---|---|---|
| Genesis / Mega Drive | Genesis Plus GX | 68000 (+ Z80) | `$FF0000-$FFFFFF` (mirrors from `$E00000`), Z80 RAM `$A00000-$A01FFF` |
| Master System, Game Gear | Genesis Plus GX | Z80 | `$C000-$DFFF` (mirror `$E000-$FFFF`) |
| NES | FCEUmm | 6502 | `$0000-$07FF` (mirrors to `$1FFF`), cartridge RAM `$6000-$7FFF` when the game has it |
| SNES | Snes9x 2010 | 65816 | `$7E0000-$7FFFFF`, and `$0000-$1FFF` in banks `$00-$3F`/`$80-$BF` |
| Game Boy | mGBA | SM83 | `$C000-$DFFF` (echo `$E000-$FDFF`), `$FF80-$FFFE` |
| Game Boy Color | mGBA | SM83 | as Game Boy; `$D000-$DFFF` follows the bank in SVBK; every bank at `$10000 + bank * $1000` |
| Game Boy Advance | mGBA | ARM7 | `$02000000` (256 KB), `$03000000` (32 KB) |

Battery saves are available with `machine.sram()`.

## Needs

- Node.js 18 or newer. Nothing to install: the cores are in `cores/`.
- For GBA (ARM / Thumb) disassembly only: `llvm-objdump` from LLVM. Everything else is built in.

## Quick start

```sh
cd tools/retrolab
node bin/retrolab.js selftest                       # check the memory map on every system
node bin/retrolab.js info game.md                   # header, checksum
node bin/retrolab.js run game.md --script start.txt --save stage1.state --shot stage1.png
node bin/retrolab.js find game.md --load stage1.state --size 2 \
     --steps "run 20 RIGHT; up; run 20 LEFT; down; run 20; same; show"
node bin/retrolab.js trace game.md '$FFB800,$FFB802' --load stage1.state --frames 300 --size 2 --out pos.csv
node bin/retrolab.js dis game.md 0x1740E 0x40       # 68000 code at file offset 0x1740E
node bin/retrolab.js patch game.md 0x1741E 0c420030 --expect 0c420046 --out test.md --fix-checksum
```

Run `node bin/retrolab.js` with no arguments for every command.

### Assemblers

`retrolab asm` turns instructions into bytes for the 68000 (Genesis), 6502 (NES), 65816 (SNES), Z80 (Master System, Game Gear, Genesis sound) and SM83 (Game Boy). They read the same syntax the disassemblers print, so you can copy code out of `dis`, change it and assemble it back.

```
; jumpkick.s - make the check at $1741E use a shorter distance
        org     $1741E
        cmpi.w  #$30,d2          ; was #$46
```

```sh
node bin/retrolab.js asm jumpkick.s --cpu 68000 --list --into game.md --out test.md --fix-checksum
```

- Labels end with `:`; local labels start with `.` and belong to the label above. `NAME equ VALUE` (or `=`).
- Numbers: `$1F`, `0x1F`, `1Fh`, `%1010`, `65`, `'A'`. Expressions: `+ - * / % & | ^ << >> ~`, brackets, `*` for the current address.
- Directives: `org`, `dc.b`/`db` (text in quotes too), `dc.w`/`dw`, `dc.l`, `ds.b`, `even`, `align`. On the 65816, `.a8 .a16 .i8 .i16` set register widths (`REP`/`SEP` also do).
- Sizes are what you write: a 68000 address is long unless it ends in `.w`, a branch is `.w` unless it is `.s`; on the 6502 and 65816, `$12` is zero page or direct page, `$1234` absolute and `$123456` long.
- The 68000 writes `$017356(pc)` with the address of the data, the way the disassembler shows it.

Checked by disassembling real games and assembling every instruction back: 117,063 instructions from Streets of Rage 2 (68000) and 214,475 from its sound code (Z80), 138,349 from Zelda and Zelda II (6502), 469,830 from A Link to the Past (65816) and 2,524,421 from Pokémon Crystal and Link's Awakening DX (SM83). All came back byte for byte. ARM/Thumb (GBA) has no assembler yet; `llvm-mc --triple=thumbv4t` works in the meantime.

### Input scripts

One line per step:

```
# comments start with #
600              wait 600 frames
tap START        press and release Start
30 RIGHT+A       hold Right and A for 30 frames
30 RIGHT | LEFT  player 1 holds Right, player 2 holds Left
```

Buttons: Genesis/SMS/GG `A B C X Y Z START MODE`; Nintendo systems `A B X Y L R START SELECT`; all have `UP DOWN LEFT RIGHT`.

## From a script

```js
const lab = require('./tools/retrolab');
const m = await lab.Machine.open('Streets of Rage 2.md');
m.loadState('stage1.state');
m.step(60, 'RIGHT');                   // 60 frames holding Right
console.log(m.u16(0xFFB800));          // read a word (big-endian on Genesis)
m.w8(0xFFFC08, 3);                     // change a byte; the game sees it on the next frame
const s = new lab.Search(m, 1);        // find a value
m.step(1); s.increased(1);
m.screenshot('now.png');
```

Also there: `lab.asm.assemble(cpu, source, { org })`, `lab.trace`, `lab.rom` (`info`, `fixChecksum`, `patchBytes`, `applyIPS`, `makeIPS`, `diff`) and `lab.disasm` (`disassemble(cpu, rom, start, len, org)` for `m68k`, `6502`, `65816`, `z80`, `sm83`, `arm`, `thumb`).

## How it reaches the memory

The cores only offer save states, not a memory API. RetroLab knows where each system's RAM sits inside the core's save state. To find the live copy inside the running core, it writes a random marker into a save state, loads it, and searches the core's memory for the marker. It then confirms the copy is the one the emulator uses: it changes a byte there, saves a state and checks the state shows the change. This takes a few milliseconds and happens once per game, again if a loaded state moves things.

`selftest` boots a tiny test ROM for each system (made byte by byte in `lib/testroms.js`). Each one fills RAM with a known pattern, and the self-test checks every address through the map, plus a write.

Real games checked (frame counters found by search, then changed and seen counting on from the new value): The Legend of Zelda `$0015`, Zelda II `$0012`, A Link to the Past `$7E001A`, Link's Awakening DX, Pokémon Crystal `$FF9B`, The Minish Cap, Pokémon Emerald, Streets of Rage 2 `$FF9014`.

## Limits

- No breakpoints and no instruction tracing: the cores don't expose the CPU. Memory watch, search and frame stepping cover most of the work. For "which code writes this byte", trace the value, then read the code with `dis`.
- Runs are repeatable: the clock and random seed given to the cores are fixed, so the same inputs give the same game.
- About 1,000 frames a second for Genesis on an ordinary machine (16 seconds of play in one second).
- The 65816 disassembler guesses register widths from `REP`/`SEP` in a straight line; use `--m16`/`--x16` to set them.
- Use your own copies of games.

## Licenses

The cores are the libretro builds used by Triforce: Genesis Plus GX and Snes9x are free for non-commercial use, FCEUmm is GPL, mGBA is MPL 2.0. RetroLab's own code is part of Triforce.
