# Triforce

A game collectible tracker and in-browser player in one page: checklists, save import, maps, and emulators for the games below. Everything runs in your browser. Nothing is uploaded anywhere.

**No games are included.** You load your own copies (ROMs and disc images) and your own save files. They stay on your computer.

## How to use it

1. Download `index.html` (the **Download raw file** button on its page here).
2. Open it in Chrome, Edge or Firefox. It works offline.
3. Pick a game, then use **Play in browser** to load your own ROM, or **Import save file** to fill in the checklist from an emulator save.

Your progress is kept in that browser on that computer. Use **Back up my progress** at the bottom of the page to save it to a file, and **Restore a backup** to bring it back, or to move it to another computer.

## Games

| Series | Games |
| --- | --- |
| The Legend of Zelda | The Legend of Zelda, Zelda II, A Link to the Past, Ocarina of Time, Link's Awakening DX, The Minish Cap |
| Pokémon | Red/Blue/Yellow, Gold/Silver/Crystal, Ruby/Sapphire/Emerald, FireRed/LeafGreen |
| Golden Sun | Golden Sun, Golden Sun: The Lost Age |
| Ace Combat | Ace Combat 3: Electrosphere (Japanese version, with the English fan translation) |

- **Pokémon:** The Pokédex sprites, the 3D maps and where each Pokémon is found are read from your own ROM once you've loaded it. The **Pokémon Box** moves Pokémon between saves: Gen 1 ↔ Gen 2 (Time Capsule rules), Gen 3 ↔ Gen 3, and Gen 1/2 → Gen 3.
- **Emulators:** a general retro player in its own tab: Genesis / Mega Drive, Master System, Game Gear, NES, SNES, Game Boy, Game Boy Color and GBA. It keeps a library of the games you add, four save-state slots per game and a save-state editor with value search; keys can be rebound and controllers work. Bring your own game files; everything stays in your browser. The cores are libretro builds (Genesis Plus GX, FCEUmm, Snes9x 2010, mGBA) compiled to WebAssembly.
- **Golden Sun:** Each game has its own page with every Djinni, the summon tablets (Lost Age) and the Psynergy items. While you play Golden Sun here, the Djinn and Psynergy items your party collects tick themselves off. The **Password Generator** tab is the [Golden Sun Password Generator](https://github.com/JulianSoriano/Golden-Sun-Password), for carrying a Golden Sun party into The Lost Age. The memory addresses come from [Dyrati](https://github.com/Dyrati)'s Golden Sun password research.
- **Ace Combat Lore:** The Ace Combat tab includes the [Strangereal Map](https://github.com/JulianSoriano/Strangereal-Map).

This public build leaves out game artwork. The Zelda maps are plain coloured 3D models, and the checklist tiles have no item icons.

## Credits

Triforce builds on other people's work, each under its own license:

- [IodineGBA](https://github.com/taisel/IodineGBA) (Game Boy Advance), [GameBoy-Online](https://github.com/taisel/GameBoy-Online) (Game Boy / Color), [JSNES](https://github.com/bfirsh/jsnes) (NES), [LakeSnes](https://github.com/angelo-wf/LakeSnes) (Super Nintendo), and the [Cult-of-GBA BIOS](https://github.com/Cult-of-GBA/BIOS)
- [Ship of Harkinian](https://github.com/HarbourMasters/Shipwright) (Ocarina of Time)
- [Ace Combat 3 static recompilation](https://github.com/sal063/Ace-Combat-3-static-recompilation), built for the browser
- Team NEMO's (Project NEMO) English translation patch for Ace Combat 3, v0.9b3
- Golden Sun password research and algorithm by [Dyrati](https://github.com/Dyrati)
- [three.js](https://threejs.org) (Strangereal Map)
- Fonts under the SIL Open Font License: [Geist and Geist Mono](https://github.com/vercel/geist-font), Chakra Petch, Barlow, Share Tech Mono, Marcellus SC, Cinzel, Cinzel Decorative, Alegreya Sans, Figtree and IBM Plex Mono

Pokémon, The Legend of Zelda and Ace Combat are trademarks of their owners. This is a fan project with no ties to Nintendo, Game Freak, The Pokémon Company or Bandai Namco.
