/* =========================================================
   shrimp — deep sea personal site
   scroll = depth. everything in the ocean is placed in metres.
   ========================================================= */

const MAX_DEPTH = 10994; // challenger deep

// depth (m) -> scroll distance (px) below the waterline.
// piecewise so the shallow, content-heavy part gets more room than the empty hadal zone.
// tweak these to make the dive longer / shorter.
const DEPTH_MAP = [
  [0, 0],
  [200, 1100],
  [1000, 3000],
  [4000, 5400],
  [6000, 6800],
  [MAX_DEPTH, 9600],
];

// colours of the water at each depth: base + four blurred blobs
const PALETTE = [
  { d: 0,         bg: "#cfe2ef", b: ["#c2dbec", "#dbe9f3", "#b2cfe6", "#cbe0ee"] },
  { d: 200,       bg: "#7fafd2", b: ["#6aa1cb", "#97bfdd", "#5a91c1", "#8ab6d8"] },
  { d: 1000,      bg: "#24508a", b: ["#1d4680", "#3466a2", "#173b70", "#2b5b96"] },
  { d: 4000,      bg: "#0c1b3a", b: ["#10244a", "#0a1730", "#163060", "#0e1f42"] },
  { d: 6000,      bg: "#060d1f", b: ["#0a1530", "#050b1a", "#0d1b3a", "#08122a"] },
  { d: MAX_DEPTH, bg: "#07112a", b: ["#0a1838", "#050c20", "#0e1d42", "#081430"] },
];

const ZONES = [
  { d: 0,     name: "the surface",     line: "wait for me!" },
  { d: 12,    name: "sunlight zone",   line: "ooh, sunbeams" },
  { d: 200,   name: "twilight zone",   line: "getting a bit dim…" },
  { d: 1000,  name: "midnight zone",   line: "who turned off the lights" },
  { d: 4000,  name: "the abyss",       line: "it's so quiet down here" },
  { d: 6000,  name: "hadal zone",      line: "my ears are popping" },
  { d: 10900, name: "challenger deep", line: "home sweet home" },
];

const PUNS = [
  "shrimply the best",
  "i'm not shellfish, ask me anything",
  "water you looking at?",
  "this is krill-iant",
  "keep calm & swim on",
  "o-crab-tunity awaits",
];

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function piecewise(map, v, from, to) {
  if (v <= map[0][from]) return map[0][to];
  for (let i = 1; i < map.length; i++) {
    const [a, b] = [map[i - 1], map[i]];
    if (v <= b[from]) return lerp(a[to], b[to], (v - a[from]) / (b[from] - a[from]));
  }
  return map[map.length - 1][to];
}
const depthToPx = (d) => piecewise(DEPTH_MAP, d, 0, 1);
const pxToDepth = (p) => piecewise(DEPTH_MAP, p, 1, 0);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], t))).join(",")})`;
};
const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/* ---------- layout: place everything by depth ---------- */
const ocean = document.getElementById("ocean");
const root = document.documentElement.style;

function layout() {
  const vh = innerHeight;
  ocean.style.height = depthToPx(MAX_DEPTH) + Math.max(520, vh / 2 + 40) + "px";
  document.querySelectorAll("[data-depth]").forEach((el) => {
    el.style.top = depthToPx(+el.dataset.depth) + "px";
    if (el.dataset.x) el.style.left = el.dataset.x + "%";
  });
  keepCreaturesClear();
}

// creatures must never sit on top of content: if one overlaps a card,
// slide it sideways into free space; if there's no room beside the card (narrow screens),
// move it just above or below the card instead.
const GAP = 40;   // breathing room around cards
const EDGE = 16;  // keep creatures this far from the screen edge

function keepCreaturesClear() {
  const o = ocean.getBoundingClientRect();
  const W = ocean.clientWidth;
  const boxes = [...document.querySelectorAll(".station .card, .seabed-inner")].map((el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - o.left - GAP, r: r.right - o.left + GAP, t: r.top - o.top - GAP, b: r.bottom - o.top + GAP };
  });
  const hits = (x, y, w, h) =>
    boxes.find((b) => x + w / 2 > b.l && x - w / 2 < b.r && y + h / 2 > b.t && y - h / 2 < b.b);

  document.querySelectorAll(".creature").forEach((c) => {
    const w = c.offsetWidth, h = c.offsetHeight;
    const fits = (cx) => cx >= w / 2 + EDGE && cx <= W - w / 2 - EDGE;
    const want = (W * +c.dataset.x) / 100;
    const x = clamp(want, w / 2 + EDGE, W - w / 2 - EDGE);
    if (x !== want) c.style.left = x + "px";
    const y = depthToPx(+c.dataset.depth);
    const box = hits(x, y, w, h);
    if (!box) return;

    const sideways = [box.l - w / 2, box.r + w / 2]
      .filter((cx) => fits(cx) && !hits(cx, y, w, h))
      .sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
    if (sideways.length) {
      c.style.left = sideways[0] + "px";
      return;
    }
    const cx = clamp(x, w / 2 + EDGE, W - w / 2 - EDGE);
    const vertical = [box.t - h / 2, box.b + h / 2]
      .filter((cy) => !hits(cx, cy, w, h))
      .sort((a, b) => Math.abs(a - y) - Math.abs(b - y));
    c.style.left = cx + "px";
    if (vertical.length) c.style.top = vertical[0] + "px";
  });
}

// fun-fact bubbles on creatures
document.querySelectorAll(".creature").forEach((c) => {
  const f = document.createElement("div");
  f.className = "fact";
  f.textContent = c.dataset.fact;
  c.prepend(f);
  c.addEventListener("click", () => c.classList.toggle("tapped"));
});

/* ---------- reveal on scroll ---------- */
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
  { rootMargin: "0px 0px -12% 0px" }
);
document.querySelectorAll(".station, .creature").forEach((el) => io.observe(el));

/* ---------- depth meter + water colour ---------- */
const $depth = document.getElementById("depth");
const $zone = document.getElementById("zone");
const $dot = document.getElementById("meter-dot");
const buddy = document.getElementById("buddy");
const bubble = document.getElementById("buddy-bubble");
const fmt = new Intl.NumberFormat("en-US");

let depth = 0;
let lastY = scrollY;
let vel = 0;
let tilt = 0;
let zoneIdx = -1;
let bubbleTimer;

// read-only view of the dive for analytics.js
window.shrimp = {
  get depth() { return depth; },
};

function say(text, ms = 2600) {
  bubble.textContent = text;
  bubble.classList.add("show");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);
}

buddy.addEventListener("click", () => {
  say(PUNS[Math.floor(Math.random() * PUNS.length)]);
});

function update() {
  const vh = innerHeight;
  const y = scrollY + vh * 0.5 - ocean.offsetTop;
  const atBottom = scrollY >= document.documentElement.scrollHeight - vh - 2;
  depth = atBottom ? MAX_DEPTH : clamp(pxToDepth(Math.max(0, y)), 0, MAX_DEPTH);

  // meter
  $depth.textContent = fmt.format(Math.round(depth));
  $dot.style.top = (depth / MAX_DEPTH) * 100 + "%";
  let zi = 0;
  ZONES.forEach((z, i) => { if (depth >= z.d) zi = i; });
  if (zi !== zoneIdx) {
    $zone.textContent = ZONES[zi].name;
    if (zoneIdx !== -1 && document.body.classList.contains("diving")) say(ZONES[zi].line);
    zoneIdx = zi;
  }
  document.body.classList.toggle("diving", y > 20);

  // colour
  let i = 1;
  while (i < PALETTE.length - 1 && depth > PALETTE[i].d) i++;
  const [a, b] = [PALETTE[i - 1], PALETTE[i]];
  const t = clamp((depth - a.d) / (b.d - a.d), 0, 1);
  const bg = mix(a.bg, b.bg, t);
  root.setProperty("--bg", bg);
  a.b.forEach((c, k) => root.setProperty(`--blob${k + 1}`, mix(c, b.b[k], t)));
  document.body.classList.toggle("deep", luminance(bg) < 0.42);

  // buddy tilts nose-down when you dive, nose-up when you rise
  const dy = scrollY - lastY;
  lastY = scrollY;
  vel = lerp(vel, dy, 0.15);
  tilt = lerp(tilt, clamp(vel * 1.6, -45, 45), 0.2);
  buddy.style.setProperty("--tilt", tilt.toFixed(2) + "deg");
}

/* ---------- smooth "dive to" navigation ---------- */
let diveAnim = null;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function diveTo(target) {
  let y;
  if (target === "0") y = 0;
  else if (target === "hi") y = document.documentElement.scrollHeight - innerHeight;
  else {
    const el = document.getElementById(target);
    if (!el) return;
    y = ocean.offsetTop + el.offsetTop - innerHeight * 0.3;
  }
  const from = scrollY;
  const dist = Math.abs(y - from);
  const dur = clamp(700 + dist * 0.18, 800, 3200);
  const t0 = performance.now();
  cancelAnimationFrame(diveAnim);
  const step = (now) => {
    const t = clamp((now - t0) / dur, 0, 1);
    scrollTo(0, lerp(from, y, easeInOut(t)));
    if (t < 1) diveAnim = requestAnimationFrame(step);
  };
  diveAnim = requestAnimationFrame(step);
}
["wheel", "touchstart", "keydown"].forEach((ev) =>
  addEventListener(ev, () => cancelAnimationFrame(diveAnim), { passive: true })
);
document.querySelectorAll("[data-dive]").forEach((el) =>
  el.addEventListener("click", (e) => {
    e.preventDefault();
    diveTo(el.dataset.dive);
  })
);

/* ---------- main loop ---------- */
function frame() {
  update();
  requestAnimationFrame(frame);
}

addEventListener("resize", layout);
layout();
document.fonts?.ready.then(layout); // card heights change once the web fonts arrive
requestAnimationFrame(frame);
