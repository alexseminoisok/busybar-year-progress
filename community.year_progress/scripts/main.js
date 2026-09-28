// Year Progress — on-device BUSY Bar app (front 72x16).
// Native dev-firmware runtime: draws via fetch -> /api/display/draw, input via
// listen("input"), local time from /api/time.
//
// "2026 is 74.412% done" + a segmented, live progress bar.
// START cycles:  Year -> Month -> Century -> Year ...
//
// Layout:
//   rows 1-5   sentence, "small" (5 px) font, centred
//   row  6     gap
//   rows 7-15  progress bar (9 px)

var APP = "community.year_progress";
var DRAW_URL = "http://127.0.0.1/api/display/draw";
var TIME_URL = "http://127.0.0.1/api/time";
var AUDIO_URL = "http://127.0.0.1/api/audio/play";
var CALC_SND = "sounds/calc.snd";

// ── Timing (ms) ─────────────────────────────────────────────
var FRAME_ANIM = 30;       // pacing while something is moving fast
var FRAME_LIVE = 50;       // pacing in the steady state
var INTRO_MS   = 2600;     // bar fill + number count-up (sounds/calc.snd is synced to this)
var DRAIN_MS   = 600;      // old bar empties on mode switch
var TITLE_MS   = 1700;     // title card between modes
var GLOW_MS    = 1100;     // flash when the fill lands
var SHIMMER_EVERY = 6000;  // gap between shimmer sweeps
var SHIMMER_MS    = 2400;
var BREATH_MS     = 2800;
var TIME_SYNC_MS  = 60000;

// ── Geometry ────────────────────────────────────────────────
var W = 72;
var BAR_Y = 7;
var BAR_H = 9;
var TEXT_Y = -1;           // small: glyph top = y + 2  -> rows 1-5
var TITLE_Y = -1;          // bold:  glyph top = y + 2  -> rows 1-7
var SUB_Y = 8;             // small  -> rows 10-14
var HIDE_X = -300;
var MAX_DIVIDERS = 11;

// ── Glyph advances (px, incl. 1 px spacing), from busy_*px.ttf ──
var ADV_SMALL = {
  "0":4,"1":3,"2":4,"3":4,"4":4,"5":4,"6":4,"7":4,"8":4,"9":4,
  "a":4,"b":4,"c":4,"d":4,"e":4,"f":3,"g":4,"h":4,"i":2,"j":3,"k":4,"l":2,"m":6,
  "n":4,"o":4,"p":4,"q":4,"r":3,"s":4,"t":3,"u":4,"v":4,"w":6,"x":4,"y":4,"z":4,
  "A":5,"B":5,"C":5,"D":5,"E":5,"F":5,"G":5,"H":5,"I":2,"J":4,"K":5,"L":4,"M":6,
  "N":5,"O":5,"P":5,"Q":5,"R":5,"S":5,"T":4,"U":5,"V":4,"W":6,"X":4,"Y":4,"Z":4,
  " ":2,".":2,"%":5,"-":3
};
var ADV_BOLD = { "Y":7,"E":6,"A":7,"R":7,"M":10,"O":7,"N":8,"T":7,"H":7,"C":7,"U":7," ":5 };

function textWidth(s, adv) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var a = adv[s.charAt(i)];
    w += (a === undefined) ? 4 : a;
  }
  return w - 1;            // drop trailing spacing column
}

// ── Colour helpers ("#rrggbb" in, "#RRGGBBAA" out) ─────────
function hexToRgb(h) {
  return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
}
function hex2(n) {
  n = Math.max(0, Math.min(255, Math.round(n)));
  return (n < 16 ? "0" : "") + n.toString(16).toUpperCase();
}
function mix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  var x = hexToRgb(a), y = hexToRgb(b);
  return "#" + hex2(x[0] + (y[0] - x[0]) * t) + hex2(x[1] + (y[1] - x[1]) * t) + hex2(x[2] + (y[2] - x[2]) * t);
}
function rgba(hex, alpha) {
  if (alpha === undefined) alpha = 1;
  return hex.toUpperCase() + hex2(clamp01(alpha) * 255);
}

// ── Easing ──────────────────────────────────────────────────
function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t)  { t = clamp01(t); return t * t * t; }
function easeInOut(t)    { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// ── Palettes ────────────────────────────────────────────────
var LABEL = "#b4b4b4";
var WHITE = "#ffffff";

var MODES = [
  { key: "year", title: "YEAR",
    hi: "#8cf7b0", main: "#2ee06a", shade: "#0f7a33", edge: "#eafff1", num: "#9dffbd",
    trackTop: "#0f2e19", trackBot: "#07170c", curTop: "#18482a", curBot: "#0c2615" },
  { key: "month", title: "MONTH",
    hi: "#ffd584", main: "#ffae1f", shade: "#935a06", edge: "#fff7e3", num: "#ffd98f",
    trackTop: "#2e1d05", trackBot: "#170e02", curTop: "#4a300a", curBot: "#261804" },
  { key: "century", title: "CENTURY",
    hi: "#92dbff", main: "#38b6ff", shade: "#135a91", edge: "#ecf9ff", num: "#a3e1ff",
    trackTop: "#082236", trackBot: "#04111b", curTop: "#0f3754", curBot: "#081c2b" }
];

var MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MONTH_LONG  = ["January","February","March","April","May","June","July",
                   "August","September","October","November","December"];

// ── Local time ──────────────────────────────────────────────
// /api/time returns local wall clock, e.g. "2026-09-28T17:48:03+01:00".
// We keep it as "local ms treated as UTC" and advance it with Date.now().
var baseLocalMs = null;
var baseDevMs = 0;

function syncTime(cb) {
  fetch(TIME_URL)
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)/.exec(j.timestamp);
      if (m) {
        baseLocalMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        baseDevMs = Date.now();
      }
      if (cb) cb();
    })
    .catch(function () { if (cb) cb(); });
}

function localNow() {
  if (baseLocalMs === null) {
    // Fallback: device clock with its own timezone handling.
    var d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  }
  return baseLocalMs + (Date.now() - baseDevMs);
}


// ── Periods ─────────────────────────────────────────────────
// Boundaries/labels/dividers are cached per mode and only recomputed when the
// period rolls over — the JS engine is slow, so per-frame work is kept tiny.
var DAY = 86400000;
var periodCache = {};

function computePeriod(mode, now) {
  var d = new Date(now);
  var Y = d.getUTCFullYear(), M = d.getUTCMonth();
  var start, end, label, sub, marks = [];

  if (mode.key === "year") {
    start = Date.UTC(Y, 0, 1);
    end   = Date.UTC(Y + 1, 0, 1);
    for (var m = 1; m < 12; m++) marks.push(Date.UTC(Y, m, 1));
    label = String(Y);
    sub   = String(Y);
  } else if (mode.key === "month") {
    start = Date.UTC(Y, M, 1);
    end   = Date.UTC(Y, M + 1, 1);
    for (var t = start + DAY; t < end; t += DAY) {
      if (new Date(t).getUTCDay() === 1) marks.push(t);      // week boundaries (Mondays)
    }
    label = MONTH_SHORT[M];
    sub   = MONTH_LONG[M] + " " + Y;
  } else {
    var sy = Math.floor((Y - 1) / 100) * 100 + 1;              // 21st century = 2001-2100
    start = Date.UTC(sy, 0, 1);
    end   = Date.UTC(sy + 100, 0, 1);
    for (var k = 1; k < 10; k++) marks.push(Date.UTC(sy + k * 10, 0, 1));   // decades
    label = "C" + (Math.floor((sy - 1) / 100) + 1);
    sub   = sy + " - " + (sy + 99);
  }

  var dividers = [];
  for (var i = 0; i < marks.length; i++) {
    var x = Math.round((marks[i] - start) / (end - start) * W);
    if (x > 0 && x < W) dividers.push(x);
  }
  return { start: start, end: end, label: label, sub: sub, dividers: dividers };
}

// Returns { p (0..1), label, sub, dividers } for a mode.
function periodInfo(mode) {
  var now = localNow();
  var c = periodCache[mode.key];
  if (!c || now < c.start || now >= c.end) c = periodCache[mode.key] = computePeriod(mode, now);
  c.p = clamp01((now - c.start) / (c.end - c.start));
  return c;
}

// Truncated (never rounds up early) percent with 3 decimals. minInt pads the
// integer part with zeros so the text doesn't jump during the count-up.
function pctString(p, minInt) {
  var v = Math.floor(p * 100000);
  if (v > 99999) v = 99999;
  var is = String(Math.floor(v / 1000));
  while (is.length < minInt) is = "0" + is;
  var fs = String(v % 1000);
  while (fs.length < 3) fs = "0" + fs;
  return is + "." + fs + "%";
}

// ── Element builders ────────────────────────────────────────
function rect(id, x, y, w, h, c1, c2, z, dir) {
  if (w <= 0 || h <= 0) return hiddenEl(id, "rectangle");
  var el = { id: id, type: "rectangle", display: "front", align: "top_left",
    x: x, y: y, width: w, height: h, border_width: 0, z_index: z };
  if (c2) { el.fill = dir || "gradient_v"; el.fill_colors = [c1, c2]; }
  else    { el.fill = "solid"; el.fill_colors = [c1]; }
  return el;
}
function text(id, s, x, y, font, color, z) {
  return { id: id, type: "text", display: "front", align: "top_left",
    x: x, y: y, text: s, font: font, color: color, z_index: z };
}
function hiddenEl(id, type) {
  if (type === "text") return { id: id, type: "text", display: "front", x: HIDE_X, y: 0,
    text: " ", font: "small", color: "#00000000", z_index: 0 };
  return { id: id, type: "rectangle", display: "front", x: HIDE_X, y: 0, width: 1, height: 1,
    fill: "solid", fill_colors: ["#00000000"], border_width: 0, z_index: 0 };
}

function post(body) {
  return fetch(new Request(DRAW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

// ── Sound + status LED ──────────────────────────────────────
function playSound(path) {
  fetch(new Request(AUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application_name: APP, path: path }),
  })).catch(function () {});
}
function stopSound() {
  fetch(new Request(AUDIO_URL, { method: "DELETE" })).catch(function () {});
}
var pendingLed = null;     // "#RRGGBBAA" sent with the next draw request

// ── State ───────────────────────────────────────────────────
var modeIdx = 0;
var prevIdx = 0;           // mode being drained during "drain"
var phase = "wait";        // "wait" | "intro" | "live" | "drain" | "title"
var phaseT0 = 0;
var drainFrom = 0;
var glowT0 = -1e9;
var shimmerT0 = 0;
var running = true;

function setPhase(p) {
  phase = p;
  phaseT0 = Date.now();
  if (p === "intro") {
    playSound(CALC_SND);
    pendingLed = rgba(MODES[modeIdx].main);
  }
}

// Fill easing for intro: sine in-out has the lowest peak speed of the usual
// curves (1.57x average vs 3x for cubic out), so the bar never jumps far
// between the device's relatively slow frames.
function fillEase(t) { t = clamp01(t); return 0.5 - 0.5 * Math.cos(Math.PI * t); }

// ── Frame composition ───────────────────────────────────────
// Each builder pushes only the elements that are visible in this frame.
// Anything shown last frame but not pushed now is hidden automatically.

function pushSentence(out, mode, info, shownP, op) {
  if (op <= 0) return;
  var intLen = pctString(info.p, 1).indexOf(".");
  var pct = pctString(shownP, intLen);
  var a = info.label + " is";
  var c = "done";
  var wa = textWidth(a, ADV_SMALL) + 1 + ADV_SMALL[" "];
  var wb = textWidth(pct, ADV_SMALL) + 1 + ADV_SMALL[" "];
  var total = wa + wb + textWidth(c, ADV_SMALL);
  var x = Math.floor((W - total) / 2);
  out.push(text("ta", a,   x,           TEXT_Y, "small", rgba(LABEL, op),    20));
  out.push(text("tp", pct, x + wa,      TEXT_Y, "small", rgba(mode.num, op), 20));
  out.push(text("tc", c,   x + wa + wb, TEXT_Y, "small", rgba(LABEL, op),    20));
}

function segmentAt(dividers, x) {
  var a = 0, b = W;
  for (var i = 0; i < dividers.length; i++) {
    if (dividers[i] <= x) a = dividers[i];
    else { b = dividers[i]; break; }
  }
  return [a, b];
}

// Static part of the bar: track + dividers. Only changes with the mode.
function pushTrack(out, mode, info) {
  out.push(rect("trk", 0, BAR_Y, W, BAR_H, rgba(mode.trackTop), rgba(mode.trackBot), 1));
  for (var i = 0; i < info.dividers.length && i < MAX_DIVIDERS; i++) {
    out.push(rect("d" + i, info.dividers[i], BAR_Y, 1, BAR_H, "#000000B8", null, 7));
  }
}

// Moving part of the bar. `live` adds the current-segment lift and shimmer.
function pushFill(out, mode, info, fill, glow, breath, shimmerX, live) {
  var fx = fill * W;
  var n = Math.min(W, Math.floor(fx));
  var fr = fx - n;

  if (live && n < W) {
    var seg = segmentAt(info.dividers, n);
    var cx = n + 1;
    if (seg[1] > cx) out.push(rect("cur", cx, BAR_Y, seg[1] - cx, BAR_H, rgba(mode.curTop), rgba(mode.curBot), 2));
  }

  // Body: highlight at the top fading into the shade colour at the bottom.
  if (n > 0) out.push(rect("fil", 0, BAR_Y, n, BAR_H, rgba(mode.hi), rgba(mode.shade), 3));

  if (glow > 0.02 && n > 0) out.push(rect("glw", 0, BAR_Y, n, BAR_H, rgba(WHITE, glow * 0.45), null, 5));

  if (shimmerX !== null && n > 2) {
    var HW = 4, sx = Math.round(shimmerX);
    var l0 = Math.max(0, sx - HW), l1 = Math.min(n - 1, sx);
    var r0 = Math.max(0, sx),      r1 = Math.min(n - 1, sx + HW);
    if (l1 > l0) out.push(rect("sh0", l0, BAR_Y, l1 - l0, BAR_H, rgba(WHITE, 0), rgba(WHITE, 0.5), 5, "gradient_h"));
    if (r1 > r0) out.push(rect("sh1", r0, BAR_Y, r1 - r0, BAR_H, rgba(WHITE, 0.5), rgba(WHITE, 0), 5, "gradient_h"));
  }

  // Sub-pixel leading column: partial brightness shows the fraction, which
  // makes slow motion read as continuous instead of 1 px steps.
  if (n < W && fr > 0.04) out.push(rect("prt", n, BAR_Y, 1, BAR_H, rgba(mode.main, fr * 0.9), null, 6));

  // Leading edge: breathing bright column at the tip.
  if (n > 0) out.push(rect("edg", n - 1, BAR_Y, 1, BAR_H, rgba(mode.edge, 0.3 + 0.55 * breath + 0.15 * glow), null, 8));
}

function pushTitle(out, mode, info, t) {
  // fade in, hold, fade out; slide down into place; accent rules grow outward
  var op = Math.min(clamp01(t / 350), clamp01((TITLE_MS - t) / 400));
  var tw = textWidth(mode.title, ADV_BOLD);
  var sw = textWidth(info.sub, ADV_SMALL);
  var tx = Math.floor((W - tw) / 2);
  var slide = Math.round((1 - easeOutCubic(t / 600)) * -3);
  var grow = Math.round(easeOutCubic((t - 150) / 800) * 10);
  out.push(text("tt", mode.title, tx, TITLE_Y + slide, "bold", rgba(mode.num, op), 20));
  out.push(text("ts", info.sub, Math.floor((W - sw) / 2), SUB_Y, "small", rgba(LABEL, op * 0.9), 20));
  if (grow > 0) {
    out.push(rect("rl", tx - 3 - grow, 4, grow, 1, rgba(mode.main, op), null, 20));
    out.push(rect("rr", tx + tw + 3,   4, grow, 1, rgba(mode.main, op), null, 20));
  }
}

var BG = rect("bg", 0, 0, W, 16, "#000000FF", null, 0);

function buildFrame() {
  var now = Date.now();
  var t = now - phaseT0;
  var mode = MODES[phase === "drain" ? prevIdx : modeIdx];
  var info = periodInfo(mode);
  var out = [BG];

  if (phase === "wait") return out;

  if (phase === "title") {
    if (t >= TITLE_MS) setPhase("intro");
    pushTitle(out, mode, info, Math.min(t, TITLE_MS));
    return out;
  }

  var fill = info.p, shown = info.p, op = 1;
  if (phase === "intro") {
    fill = info.p * fillEase(t / INTRO_MS);
    shown = fill;
    op = clamp01(t / 500);
    if (t >= INTRO_MS) { setPhase("live"); glowT0 = now; shimmerT0 = now + 2000; }
  } else if (phase === "drain") {
    fill = drainFrom * (1 - fillEase(t / DRAIN_MS));
    op = 1 - clamp01(t / DRAIN_MS);
    if (t >= DRAIN_MS) setPhase("title");
  }

  var glow = 1 - clamp01((now - glowT0) / GLOW_MS);
  glow = glow * glow;
  var breath = 0.5 - 0.5 * Math.cos((now / BREATH_MS) * 2 * Math.PI);

  var live = phase === "live";
  var shimmerX = null;
  if (live) {
    var st = now - shimmerT0;
    if (st >= SHIMMER_EVERY) { shimmerT0 = now; st = 0; }
    if (st >= 0 && st < SHIMMER_MS) shimmerX = -5 + easeInOut(st / SHIMMER_MS) * (fill * W + 10);
  }

  pushSentence(out, mode, info, shown, op);
  pushTrack(out, mode, info);
  pushFill(out, mode, info, fill, glow, breath, shimmerX, live);
  return out;
}

// ── Render loop, paced to draw completion ───────────────────
// `sent` maps id -> {json, type} for everything currently on screen. Each
// frame sends only new/changed elements plus hides for ones that vanished.
var sent = {};

function loop() {
  if (!running) return;
  var t0 = Date.now();
  var els = buildFrame();
  var changed = [], commit = [], seen = {};

  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    seen[el.id] = true;
    var js = JSON.stringify(el);
    var prev = sent[el.id];
    if (!prev || prev.json !== js) { changed.push(el); commit.push([el.id, js, el.type]); }
  }
  for (var id in sent) {
    if (!seen[id] && sent[id].json !== null) {
      changed.push(hiddenEl(id, sent[id].type));
      commit.push([id, null, sent[id].type]);
    }
  }

  var pace = phase === "live" ? FRAME_LIVE : FRAME_ANIM;
  function next() { setTimeout(loop, Math.max(10, pace - (Date.now() - t0))); }

  if (changed.length === 0 && pendingLed === null) { next(); return; }
  if (changed.length === 0) changed.push(BG);
  var body = { application_name: APP, elements: changed };
  var led = pendingLed;
  if (led !== null) { body.led_notification_color = led; pendingLed = null; }

  post(body).then(function (r) {
    if (r && r.ok !== false) {
      for (var k = 0; k < commit.length; k++) {
        var c = commit[k];
        if (c[1] === null) delete sent[c[0]];
        else sent[c[0]] = { json: c[1], type: c[2] };
      }
    } else if (led !== null && pendingLed === null) {
      pendingLed = led;              // retry the LED on the next frame
    }
    next();
  }, function () {
    if (led !== null && pendingLed === null) pendingLed = led;
    next();
  });
}

// ── Input ───────────────────────────────────────────────────
function currentFill() {
  var t = Date.now() - phaseT0;
  var p = periodInfo(MODES[modeIdx]).p;
  if (phase === "intro") return p * fillEase(t / INTRO_MS);
  if (phase === "drain") return drainFrom * (1 - fillEase(t / DRAIN_MS));
  if (phase === "title" || phase === "wait") return 0;
  return p;
}

var unbind = listen("input", function (e) {
  if (e.key === "start" && e.action === "press") {
    if (phase === "wait") return;
    var cur = currentFill();
    if (phase === "intro") stopSound();
    if (phase !== "drain") prevIdx = modeIdx;
    modeIdx = (modeIdx + 1) % MODES.length;
    glowT0 = -1e9;
    if (phase === "drain") return;           // keep draining the old bar; new mode follows
    drainFrom = cur;
    setPhase(cur > 0.001 ? "drain" : "title");
  } else if (e.key === "back" && e.action === "press") {
    running = false;
    stopSound();
    clearInterval(syncTimer);
    if (unbind) unbind();
  }
});

// ── Go ──────────────────────────────────────────────────────
var syncTimer = setInterval(syncTime, TIME_SYNC_MS);
syncTime(function () { setPhase("intro"); });
loop();
