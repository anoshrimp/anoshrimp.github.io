/* =========================================================
   visitor tracking: Google Analytics 4 + Microsoft Clarity
   paste your two IDs below. until then nothing loads.
   ========================================================= */
const GA_ID = "G-9HKLXD504N";      // GA4 → Admin → Data streams → Measurement ID
const CLARITY_ID = "xxxxxxxxxx";   // Clarity → Settings → Overview → Project ID

const gaOn = !GA_ID.includes("X");
const clarityOn = !CLARITY_ID.startsWith("x");

/* ---------- consent (needed for cookies in EU/UK/CA) ---------- */
const CONSENT_KEY = "shrimp-consent";
const store = {
  get() { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch {} },
};

/* ---------- GA4: loads right away in cookieless mode, upgrades on consent ---------- */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
if (gaOn) {
  gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  gtag("js", new Date());
  gtag("config", GA_ID);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

/* ---------- Clarity (session replay + heatmaps): only after consent ---------- */
function loadClarity() {
  if (!clarityOn || window.clarity) return;
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_ID);
}

function grant() {
  if (gaOn) gtag("consent", "update", { analytics_storage: "granted" });
  loadClarity();
}

function askConsent() {
  const bar = document.createElement("div");
  bar.className = "consent";
  bar.innerHTML = `<span>mind if i count the bubbles? <small>anonymous analytics, no ads</small></span>
    <button data-c="yes">sure</button><button data-c="no" class="ghost">no thanks</button>`;
  bar.addEventListener("click", (e) => {
    const c = e.target.dataset.c;
    if (!c) return;
    store.set(c);
    if (c === "yes") grant();
    bar.remove();
  });
  document.body.appendChild(bar);
}

if (gaOn || clarityOn) {
  const choice = store.get();
  if (choice === "yes") grant();
  else if (choice !== "no") askConsent();
}

/* ---------- one helper that reports to both tools ---------- */
function track(name, params = {}) {
  if (gaOn) gtag("event", name, params);
  if (window.clarity) window.clarity("event", name);
}

/* ---------- what we track ---------- */
// 1. how deep people dive (milestones + the deepest point, sent when they leave)
const MILESTONES = [50, 200, 500, 1000, 2000, 4000, 6000, 8000, 10994];
const hit = new Set();
let maxDepth = 0;
const t0 = Date.now();

function checkDepth() {
  const d = Math.round(window.shrimp?.depth ?? 0);
  if (d > maxDepth) maxDepth = d;
  for (const m of MILESTONES) {
    if (d >= m && !hit.has(m)) {
      hit.add(m);
      track("dive_depth", { depth_m: m });
      if (window.clarity) window.clarity("set", "max_depth", String(m));
    }
  }
}
let depthTimer;
addEventListener("scroll", () => {
  clearTimeout(depthTimer);
  depthTimer = setTimeout(checkDepth, 400);
}, { passive: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  track("dive_summary", { max_depth_m: maxDepth, seconds: Math.round((Date.now() - t0) / 1000) });
});

// 2. which sections people actually look at (≥ 1.5 s in view)
const seen = new Set();
const timers = new Map();
const sectionIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    const id = e.target.id;
    if (e.isIntersecting && !seen.has(id)) {
      timers.set(id, setTimeout(() => {
        seen.add(id);
        track("section_view", { section: id });
      }, 1500));
    } else {
      clearTimeout(timers.get(id));
    }
  });
}, { threshold: 0.4 });
document.querySelectorAll(".station, #hi").forEach((el) => sectionIO.observe(el));

// 3. clicks on anything marked data-track (case studies, playground, email, linkedin…)
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-track]");
  if (!el) return;
  const [kind, item] = el.dataset.track.split(":");
  track("link_click", { kind, item, url: el.href || "" });
});

// 4. playful bits: creature fun facts + poking the shrimp buddy
document.querySelectorAll(".creature").forEach((c) => {
  const name = c.querySelector("figcaption b")?.textContent;
  let done = false;
  const peek = () => { if (!done) { done = true; track("creature_peek", { creature: name }); } };
  c.addEventListener("mouseenter", peek);
  c.addEventListener("click", peek);
});
document.getElementById("buddy")?.addEventListener("click", () => track("buddy_poke"));

// 5. navigation: which nav link / button people use to dive
document.querySelectorAll("[data-dive]").forEach((el) =>
  el.addEventListener("click", () => track("dive_nav", { target: el.dataset.dive }))
);
