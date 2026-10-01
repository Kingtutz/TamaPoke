# TamaPoke for phones (PWA)

A port of the firmware to a web app you can add to your iPhone/Android home
screen. It runs full-screen and works offline. The game rules are the same
(`pet.cpp` ported 1:1), and so are the screens: starter pick, Pokédex, stat
card, ball minigame, punching bag, bath, evolution and farewell. All 9
languages and the square-wave sound effects are included.

The layout is built for a portrait phone instead of the round 466×466 watch
screen. The pet's world (scene, sprite, egg, bath, evolution, ceremonies and
the mini-games) is still drawn with the firmware's pixel code on a canvas. That
canvas fills the width of the screen and gets taller or shorter with the phone.
Everything around it is HTML: the needs bars, the action buttons, the dialogs
and a tab bar for Pokédex, Stats and Settings.

## Play it

1. Host the repo on any HTTPS static host (e.g. GitHub Pages, repo root).
2. On the iPhone, open `https://<host>/phone/` in **Safari** →
   Share → **Add to Home Screen**.
3. Launch it from the home-screen icon.

Sprites load from `../tools/sdcard/mons/` (the same files that go on the SD
card) and are cached for offline use the first time each one is shown.

## Controls

| Where | Action |
|---|---|
| Home: Feed / Play / Light / Bath | Feed opens a berry/candy menu; Play starts the ball game |
| Home: tap the pet (or the egg) | pet it (hatch it) |
| Home: hold the pet 3 s | send it to the Professor (also: Stats → Send to the Professor) |
| Pokédex tab | scrolling grid of all 151; tap one for its sprite and base stats. A Poké Ball marks species you have at the Professor's: tap **Bring back** to swap |
| Stats tab | profile, rename, bond, battle stats + Train strength, progress, medals |
| Settings tab | sound, language |
| ✕ in a mini-game | leave it without a result |

## Differences from the device

- Time comes from the phone's clock, so there is no clock editor.
- Released Pokémon, and those that say farewell, go to the Professor instead
  of being gone: they wait there frozen in time and can be swapped back from
  the Pokédex (not while you have an egg). One that runs away from neglect is
  still gone for good.
- Tabs and buttons replace the device's swipe gestures, and renaming uses the
  phone's own keyboard.
- Closing or backgrounding the app counts as "powered off": on return the
  firmware's gentle offline progression is applied (bars floor at 15, no
  slip-ups, capped at 2 weeks).
- The save lives in the browser's `localStorage` on that phone. It is not
  synced with the board.
- No battery indicator or screen dimming (the phone handles that).

## Development

```bash
node phone/tools/extract.mjs     # regenerate js/data.js from dex.h / i18n.cpp / species.h
node phone/tools/make_icons.mjs  # regenerate home-screen icons
node phone/tools/test_pet.mjs    # headless checks of the ported game logic
node phone/tools/serve.mjs       # http://localhost:8080/phone/
```

Font: Press Start 2P (SIL OFL, `fonts/OFL.txt`).
