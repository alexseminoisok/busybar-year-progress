#!/usr/bin/env python3
"""Synthesize the Year Progress "calculation" sound as a bsb-firmware .snd file.

.snd is headerless raw PCM: 16-bit signed little-endian, 44100 Hz, mono.

The sound is locked to the bar's intro fill (sine ease-in-out over INTRO_MS in
community.year_progress/scripts/main.js, fillEase): one data-blip each time the
fill crosses another 1/STEPS of its length, so blips accelerate and then settle
with the bar, while their pitch climbs with progress. A soft two-note
chime lands exactly when the fill does (the glow flash).
"""
import math
import random
import struct
import sys
import os

SAMPLE_RATE = 44100
INTRO_MS = 2600          # keep in sync with main.js
STEPS = 30               # number of blips across the fill
BLIP_S = 0.022
AMP = 0.22

random.seed(7)


def inv_fill_ease(y):
    # t such that 0.5 - 0.5*cos(pi*t) == y   (fillEase in main.js)
    return math.acos(1 - 2 * y) / math.pi


def blip(buf, start_s, freq, dur, amp):
    """Short square-ish blip (odd harmonics) with a fast attack / exp decay."""
    i0 = int(start_s * SAMPLE_RATE)
    n = int(dur * SAMPLE_RATE)
    for i in range(n):
        if i0 + i >= len(buf):
            break
        t = i / SAMPLE_RATE
        env = min(1.0, i / 40) * math.exp(-t / (dur * 0.35))
        ph = 2 * math.pi * freq * t
        v = math.sin(ph) + math.sin(3 * ph) / 3 * 0.6 + math.sin(5 * ph) / 5 * 0.3
        buf[i0 + i] += amp * env * v


def chime(buf, start_s, freq, dur, amp):
    """Bell-ish tone: fundamental + soft inharmonic partial, long decay."""
    i0 = int(start_s * SAMPLE_RATE)
    n = int(dur * SAMPLE_RATE)
    for i in range(n):
        if i0 + i >= len(buf):
            break
        t = i / SAMPLE_RATE
        env = min(1.0, i / 120) * math.exp(-t / (dur * 0.3))
        v = math.sin(2 * math.pi * freq * t) + 0.35 * math.sin(2 * math.pi * freq * 2.76 * t) * math.exp(-t * 18)
        buf[i0 + i] += amp * env * v


def build(out_path):
    intro_s = INTRO_MS / 1000
    total_s = intro_s + 0.75
    buf = [0.0] * int(total_s * SAMPLE_RATE)

    # Pentatonic-ish ladder, climbing with progress; slight random jitter so it
    # sounds like data being crunched rather than a scale.
    ladder = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]
    base = 660.0
    for k in range(STEPS):
        y = (k + 0.5) / STEPS
        t = inv_fill_ease(y) * intro_s
        rung = ladder[min(len(ladder) - 1, int(y * len(ladder)))]
        jitter = random.choice([0, 0, 2, -2, 5])
        freq = base * 2 ** ((rung + jitter) / 12)
        amp = AMP * (0.75 + 0.25 * random.random())
        blip(buf, t, freq, BLIP_S, amp)
        # occasional "double" blip for texture in the fast section
        if y < 0.6 and random.random() < 0.35:
            blip(buf, t + 0.011, freq * 1.5, BLIP_S * 0.6, amp * 0.5)

    # Landing chime (fifth + octave), synced to the fill finishing.
    chime(buf, intro_s - 0.01, base * 2 ** (12 / 12), 0.6, 0.20)
    chime(buf, intro_s + 0.07, base * 2 ** (19 / 12), 0.6, 0.16)

    peak = max(1e-9, max(abs(v) for v in buf))
    scale = min(1.0, 0.9 / peak)
    pcm = [int(max(-1.0, min(1.0, v * scale)) * 32767) for v in buf]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack(f"<{len(pcm)}h", *pcm))
    print(f"Wrote {out_path}: {len(pcm)} samples ({len(pcm)/SAMPLE_RATE:.2f}s, {len(pcm)*2} bytes)")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "community.year_progress", "sounds", "calc.snd")
    build(out)
