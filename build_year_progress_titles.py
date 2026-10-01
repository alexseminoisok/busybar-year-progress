#!/usr/bin/env python3
"""Pre-render the Year Progress title cards as native BUSY Bar .anim files.

The firmware plays .anim files itself (anim_player), at the file's own fps,
with no per-frame HTTP draw — so the title cards are perfectly smooth instead
of being limited by how fast the JS app can push draw requests.

Each file covers only the top 72x9 band (title + accent rules). The subtitle
("September 2026") changes over time, so main.js still draws it as text below.

Output: community.year_progress/anims/title_{year,month,century}.anim
Format: "bicycle1" (lib/anim_file/anim_file_format.h), encoded with the
firmware's own scripts/seq2anim.py — set BSB_FW to a busybar firmware checkout
if it isn't at ./busybar-fw-jerryscript.

Keep the timing/colour constants below in sync with main.js.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "community.year_progress", "anims")

FPS = 30
W, H = 72, 9                 # anim band: rows 0-8 of the front display

# ── keep in sync with main.js ──
TITLE_MS   = 2800
TITLE_IN   = 800
TITLE_OUT  = 750
RULE_DELAY = 200
RULE_MS    = 1500
CAP_TOP    = 1               # title cap-height rows 1-7
RULE_Y     = 4

MODES = [
    ("year",    "YEAR",    "#9dffbd", "#2ee06a"),
    ("month",   "MONTH",   "#ffd98f", "#ffae1f"),
    ("century", "CENTURY", "#a3e1ff", "#38b6ff"),
]

FONT_CANDIDATES = [
    os.path.join(HERE, "fonts", "busy_bold_7px.ttf"),
    os.path.join(HERE, "busy_bold_7px.ttf"),
    os.path.join(HERE, "bsb-firmware-main", "assets", "frontend", "assets", "fonts", "busy_bold_7px.ttf"),
]


def clamp01(t):
    return 0.0 if t < 0 else (1.0 if t > 1 else t)


def ease_out_cubic(t):
    t = clamp01(t)
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = clamp01(t)
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def scale(rgb, a):
    return tuple(int(round(c * a)) for c in rgb)


def load_font(path=None):
    for p in ([path] if path else []) + FONT_CANDIDATES:
        if p and os.path.exists(p):
            return ImageFont.truetype(p, 16)        # native size: 1 unit = 1 px
    sys.exit("busy_bold_7px.ttf not found; pass its path as the first argument")


def render_title_mask(font, text):
    """1-bit mask of the title, cropped to ink, exactly as the device draws it."""
    canvas = Image.new("L", (128, 32), 0)
    d = ImageDraw.Draw(canvas)
    d.fontmode = "1"
    d.text((0, 8), text, font=font, fill=255)
    bbox = canvas.getbbox()
    # keep x from the pen origin (0) so advances/bearings match LVGL
    return canvas.crop((0, bbox[1], bbox[2], bbox[3]))


def render_frames(font, title, num_hex, main_hex):
    mask = render_title_mask(font, title)
    tw = mask.width
    tx = (W - tw) // 2
    max_grow = tx - 4
    num, main = hex_rgb(num_hex), hex_rgb(main_hex)

    frames = []
    n = round(TITLE_MS / 1000 * FPS) + 1
    for i in range(n):
        t = i * 1000 / FPS
        fade_out = clamp01((TITLE_MS - t) / TITLE_OUT)
        op = min(ease_in_out(t / TITLE_IN), fade_out)
        grow = round(ease_out_cubic((t - RULE_DELAY) / RULE_MS) * max_grow)

        im = Image.new("RGB", (W, H), (0, 0, 0))
        if op > 0:
            im.paste(scale(num, op), (tx, CAP_TOP), mask)
            if grow > 0:
                d = ImageDraw.Draw(im)
                c = scale(main, op)
                d.line([(tx - 3 - grow, RULE_Y), (tx - 4, RULE_Y)], fill=c)
                d.line([(tx + tw + 3, RULE_Y), (tx + tw + 2 + grow, RULE_Y)], fill=c)
        # The firmware converter + player end up showing R and B swapped for
        # rgb888 input (verified on device: amber came out blue), so pre-swap.
        r, g, b = im.split()
        frames.append(Image.merge("RGB", (b, g, r)))
    return frames


def write_anim(frames, fps, out_path):
    """Encode frames with the firmware's own converter (scripts/seq2anim.py,
    "bicycle1" format: delta masks + RLE/QOI-like pixels)."""
    BSBAnimConverter = load_converter()
    with tempfile.TemporaryDirectory(prefix="yp-title-") as tmp:
        for i, im in enumerate(frames):
            im.save(os.path.join(tmp, f"frame_{i}.png"))
        with open(os.path.join(tmp, "meta.json"), "w") as f:
            json.dump({"fps": fps, "color_mode": "rgb888", "sections": []}, f)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        info = BSBAnimConverter().convert_dir(Path(tmp), Path(out_path))
    print(f"Wrote {os.path.relpath(out_path, HERE)}: {info.frame_cnt} frames @ {fps} fps, "
          f"{os.path.getsize(out_path)} bytes")


def load_converter():
    """Import BSBAnimConverter from a busybar firmware checkout ($BSB_FW or ./busybar-fw-jerryscript)."""
    fw = os.environ.get("BSB_FW", os.path.join(HERE, "busybar-fw-jerryscript"))
    scripts = os.path.join(fw, "scripts")
    if not os.path.exists(os.path.join(scripts, "seq2anim.py")):
        sys.exit(f"seq2anim.py not found under {scripts}; set BSB_FW to a busybar firmware checkout")
    sys.path.insert(0, scripts)
    from seq2anim import BSBAnimConverter
    return BSBAnimConverter


if __name__ == "__main__":
    font = load_font(sys.argv[1] if len(sys.argv) > 1 else None)
    for key, title, num, main in MODES:
        write_anim(render_frames(font, title, num, main), FPS, os.path.join(OUT_DIR, f"title_{key}.anim"))
