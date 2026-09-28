# BUSY Bar — Year Progress

An on-device JavaScript app for the [BUSY Bar](https://busy.app) that shows how
much of the year, month, or century is already done — as a live, segmented
progress bar on the 72×16 front display. It runs **on the bar** (JerryScript);
no companion app or host feeder required.

```
2026 is 74.412% done
[█████████|███|███|███|███|███|██▓░|░░░|░░░|░░░]
```

- **Modes:** Year → Month → Century (press **Start** to cycle)
- **Text:** `2026 is 74.412% done` · `Sep is 91.234% done` · `C21 is 25.740% done` — three decimals, truncated (never rounds up early)
- **Bar:** segmented by real calendar boundaries — months (Year), Mondays (Month), decades (Century)
- **Colours:** green (Year), amber (Month), blue (Century); the status LED blinks in the mode colour whenever a new bar is shown
- **Animations:** fill + number count-up on launch, landing glow, breathing leading edge, sub-pixel front column, periodic shimmer, title card between modes
- **Sound:** a synthesized "calculation" effect synced to the fill, ending with a chime as the bar lands

## Requirements

A BUSY Bar running firmware that includes the **on-device JS runner** — i.e. the
runtime that provides the global `listen("input", …)` and `fetch()` APIs and
lists JS apps in the **Apps** menu. (On official *release* firmware the JS SDK is
still "coming soon"; this app targets the dev/JS-runner firmware.)

## Install

USB (default address `10.0.4.20`):

```bash
./install_year_progress.sh 10.0.4.20
```

Wi-Fi (set your HTTP-API password):

```bash
BAR_TOKEN=<http-access-password> ./install_year_progress.sh <bar-ip>
```

The script uploads the app to `/ext/user_assets/community.year_progress/` and
writes the `js_apps_enabled` flag. Then on the bar: **mode switch → Apps →
Year Progress → Start**.

To update after changing files, just run the installer again and reopen the app.

## Controls

| Button | Action |
|--------|--------|
| **Start** | Next mode: Year → Month → Century → Year |
| **Back** | Exit |

## Layout

```
community.year_progress/
├── appmeta/
│   ├── manifest.json          # id, name, heap_size_kib, etc.
│   ├── icon_front_8x8.png     # Apps-menu icon (front, colour)
│   └── icon_back_11x11.png    # Apps-menu icon (back, greyscale)
├── scripts/
│   └── main.js                # the app
└── sounds/
    └── calc.snd               # "calculation" sound (raw PCM)
build_year_progress_snd.py     # regenerates sounds/calc.snd
install_year_progress.sh       # curl installer
```

## How it works

- **Draw:** each frame is a `POST http://127.0.0.1/api/display/draw` with a JSON
  element list (loopback skips auth). Elements are keyed by `id` and persist on
  the device, so each frame sends only the elements that changed, plus hides for
  ones that disappeared. Draw cost scales with element count, so the fill
  animation touches only ~4 elements per frame.
- **Bar:** rectangles with vertical gradients for the fill and track,
  translucent black 1 px dividers, a partially transparent leading column for
  sub-pixel motion, and horizontal-gradient pairs for the shimmer band.
- **Motion:** the fill uses a sine ease-in-out (lowest peak speed of the common
  curves), which keeps per-frame jumps small at the device's frame rate.
- **Time:** local wall-clock time comes from `GET /api/time` (re-synced every
  minute), so the percentages follow the bar's own timezone setting.
- **Century:** the 21st century is counted as 2001–2100.
- **Sound:** `POST /api/audio/play` with a JSON body. `calc.snd` is headless
  16-bit / 44.1 kHz mono PCM; blips are placed where the fill crosses each
  1/30 of its length, so the sound tracks the animation.
- **LED:** `led_notification_color` on the draw request that starts each bar.

## Regenerating the sound

```bash
python3 build_year_progress_snd.py
```

Keep `INTRO_MS` in the script equal to `INTRO_MS` in `scripts/main.js`, then
re-run the installer.

## Credits

Built for the BUSY Bar.
