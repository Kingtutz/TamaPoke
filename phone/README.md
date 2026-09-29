# TamaPoke for phones (PWA)

A port of the firmware to a web app you can add to your iPhone/Android home
screen. It runs full-screen and works offline. It keeps the same round
466×466 screen, the same game rules (`pet.cpp` ported 1:1) and the same
screens: starter pick, Pokédex gallery, stat card, ball minigame, punching bag,
bath, evolution and farewell. All 8 languages and the square-wave sound effects
are included.

## Play it

1. Host the repo on any HTTPS static host (e.g. GitHub Pages, repo root).
2. On the iPhone, open `https://<host>/phone/` in **Safari** →
   Share → **Add to Home Screen**.
3. Launch it from the home-screen icon.

Sprites load from `../tools/sdcard/mons/` (the same files that go on the SD
card) and are cached for offline use the first time each one is shown.

## Controls

The same gestures as the device:

| Gesture | Action |
|---|---|
| tap buttons | feed / minigame / sleep / bath |
| tap the pet | pet it |
| swipe ← / → | Pokédex gallery (pages), swipe right on page 1 to exit |
| swipe ↑ | pet card (swipe ←/→ for 4 pages, tap name to rename) |
| swipe ↓ | settings: sound, language |
| hold the pet 3 s | release dialog |

## Differences from the device

- Time comes from the phone's clock, so the settings screen shows the time
  instead of editing it.
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
