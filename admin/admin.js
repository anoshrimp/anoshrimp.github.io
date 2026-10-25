/* =========================================================
   shrimp admin
   - Data: reads GA4 through the Google Analytics Data API, signed in with Google
     (only Google accounts with access to the GA4 property can see anything).
   - Edit: reads/writes content.json in the GitHub repo with a fine-grained token
     that lives only in this browser.
   - ?demo shows the whole thing with made-up numbers, nothing is saved.
   ========================================================= */
const CONFIG = {
  googleClientId: "",   // Google Cloud → APIs & Services → Credentials → OAuth client ID (Web)
  gaPropertyId: "",     // GA4 → Admin → Property details → Property ID (digits only)
  clarityProjectId: "z2zcnyrfq3",
  repo: "anoshrimp/anoshrimp.github.io",
  branch: "main",
  contentPath: "content.json",
};
const DEMO = new URLSearchParams(location.search).has("demo");

/* ---------- small helpers ---------- */
const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};
const store = (kind) => ({
  get(k) { try { return window[kind].getItem(k); } catch { return null; } },
  set(k, v) { try { window[kind].setItem(k, v); } catch {} },
  del(k) { try { window[kind].removeItem(k); } catch {} },
});
const local = store("localStorage");
const session = store("sessionStorage");
const num = new Intl.NumberFormat("en-US");
const pct = (v) => `${Math.round(v * 100)}%`;
const dur = (s) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const tip = $("#tip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(innerWidth - r.width - 8, x + 12) + "px";
  tip.style.top = Math.max(8, y - r.height - 10) + "px";
}
const hideTip = () => (tip.hidden = true);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

if (DEMO) $("#demo-badge").hidden = false;

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $("#panel-data").hidden = name !== "data";
  $("#panel-edit").hidden = name !== "edit";
  local.set("shrimp-admin-tab", name);
  if (name === "edit") initEdit();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* =========================================================
   DATA
   ========================================================= */
const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_KEY = "shrimp-g-token";
let rangeDays = 28;

function googleToken() {
  try {
    const t = JSON.parse(session.get(TOKEN_KEY));
    return t && t.exp > Date.now() + 60_000 ? t.token : null;
  } catch { return null; }
}

async function googleSignIn() {
  for (let i = 0; i < 50 && !window.google?.accounts?.oauth2; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in didn't load. Check your connection or ad blocker.");
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: GA_SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        session.set(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + r.expires_in * 1000 }));
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e.message || e.type || "Sign-in was cancelled.")),
    });
    client.requestAccessToken();
  });
}

class GAError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function ga(method, body) {
  if (DEMO) return demoReport(method, body);
  const token = googleToken();
  if (!token) throw new GAError("Signed out", 401);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${CONFIG.gaPropertyId}:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GAError(json.error?.message || res.statusText, res.status);
  return json;
}

const rowsOf = (r) => (r.rows || []).map((x) => ({ d: (x.dimensionValues || []).map((v) => v.value), m: x.metricValues.map((v) => +v.value) }));

function report(dims, metrics, { event, order, limit } = {}) {
  const body = {
    dateRanges: [{ startDate: `${rangeDays - 1}daysAgo`, endDate: "today" }],
    dimensions: dims.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
  };
  if (event) body.dimensionFilter = { filter: { fieldName: "eventName", stringFilter: { value: event } } };
  if (order === "metric") body.orderBys = [{ metric: { metricName: metrics[0] }, desc: true }];
  else if (order) body.orderBys = [{ dimension: { dimensionName: order }, desc: order !== "date" }];
  if (limit) body.limit = limit;
  return ga("runReport", body).then(rowsOf);
}

/* ---------- gate ---------- */
function dataGate(kind, detail = "") {
  const gate = $("#data-gate");
  $("#data-body").hidden = true;
  gate.hidden = false;
  const demoLink = h("a", { href: "?demo" }, "Preview with demo data");

  if (kind === "setup") {
    gate.replaceChildren(
      h("h2", {}, "Connect Google Analytics"),
      h("p", {}, "Two values are missing in ", h("code", {}, "admin/admin.js"), " → ", h("code", {}, "CONFIG"), ":"),
      h("ol", {},
        h("li", {}, h("code", {}, "googleClientId"), " — an OAuth client ID (Web) from Google Cloud, with ", h("code", {}, location.origin), " as an authorised JavaScript origin."),
        h("li", {}, h("code", {}, "gaPropertyId"), " — GA4 → Admin → Property details → Property ID (digits).")
      ),
      h("div", { class: "row" }, demoLink)
    );
    return;
  }
  const err = h("p", { class: "err" }, detail);
  const btn = h("button", {
    onclick: async () => {
      btn.disabled = true;
      err.textContent = "";
      try { await googleSignIn(); loadData(); }
      catch (e) { err.textContent = e.message; btn.disabled = false; }
    },
  }, "Sign in with Google");
  gate.replaceChildren(
    h("h2", {}, kind === "denied" ? "No access to this data" : "Sign in to see who's diving"),
    h("p", {}, kind === "denied"
      ? "This Google account can't read the GA4 property, or the Google Analytics Data API isn't enabled in the Cloud project."
      : "Only Google accounts with access to the GA4 property can see the numbers. Sign-in lasts about an hour."),
    h("div", { class: "row" }, btn, demoLink),
    err
  );
}

/* ---------- renderers ---------- */
function note(el, html) { el.innerHTML = `<p class="note">${html}</p>`; }

function barList(el, items, fmt = (v) => num.format(v)) {
  if (!items.length) return note(el, "No data yet.");
  const max = Math.max(...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  el.replaceChildren(
    h("div", { class: "bars" },
      items.map((i) => {
        const row = h("div", { class: "row-hit" },
          h("div", { class: "l", title: i.label }, i.label, i.sub ? h("small", {}, i.sub) : null),
          h("div", { class: "t" }, h("div", { class: "b", style: `width:${(i.value / max) * 100}%` })),
          h("div", { class: "v" }, fmt(i.value))
        );
        row.addEventListener("mousemove", (e) => showTip(`<b>${esc(i.label)}</b>${i.sub ? " · " + esc(i.sub) : ""}<br>${fmt(i.value)} · ${pct(i.value / total)} of total`, e.clientX, e.clientY));
        row.addEventListener("mouseleave", hideTip);
        return row;
      })
    )
  );
}

function niceCeil(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const shortDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function lineChart(el, points, unit) {
  if (!points.some((p) => p.y > 0)) return note(el, "No visitors in this range yet.");
  const W = el.clientWidth || 600, H = 220, L = 34, R = 8, T = 10, B = 24;
  const max = niceCeil(Math.max(...points.map((p) => p.y)));
  const x = (i) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const ns = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${unit} per day` });

  [0, max / 2, max].forEach((v) => {
    svg.append(s("line", { class: "grid-line", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const t = s("text", { class: "axis", x: L - 8, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = num.format(v);
    svg.append(t);
  });
  [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((i, k) => {
    const t = s("text", { class: "axis", x: x(i), y: H - 6, "text-anchor": ["start", "middle", "end"][k] });
    t.textContent = shortDate(points[i].x);
    svg.append(t);
  });
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  svg.append(s("path", { class: "area", d: `${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z` }));
  svg.append(s("path", { class: "line", d }));

  const cross = s("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" });
  const dot = s("circle", { class: "hover-dot", r: 4.5, visibility: "hidden" });
  const hit = s("rect", { x: L, y: 0, width: W - L - R, height: H, fill: "transparent" });
  svg.append(cross, dot, hit);
  hit.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(points[i].y));
    cross.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    showTip(`<b>${shortDate(points[i].x)}</b><br>${num.format(points[i].y)} ${unit}`, e.clientX, e.clientY);
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); });
  el.replaceChildren(svg);
}

/* ---------- panels ---------- */
const clean = (v) => (v === "(not set)" || v === "" ? "Unknown" : v);

const PANELS = {
  async live() {
    const r = rowsOf(await ga("runRealtimeReport", { dimensions: [{ name: "country" }, { name: "city" }], metrics: [{ name: "activeUsers" }] }));
    const total = r.reduce((a, x) => a + x.m[0], 0);
    const where = r.slice(0, 4).map((x) => `${clean(x.d[1])}, ${clean(x.d[0])}`).join(" · ");
    $("#live").replaceChildren(
      h("span", { class: "dot" }),
      h("b", {}, `${total} ${total === 1 ? "person" : "people"} on the site right now`),
      total ? h("span", { class: "where" }, where) : h("span", { class: "where" }, "(last 30 minutes)")
    );
  },
  async kpis() {
    const [r] = await report([], ["activeUsers", "newUsers", "sessions", "averageSessionDuration", "engagementRate"]);
    const m = r?.m || [0, 0, 0, 0, 0];
    const tiles = [["Visitors", num.format(m[0])], ["New visitors", num.format(m[1])], ["Visits", num.format(m[2])], ["Avg. visit", dur(m[3])], ["Engaged", pct(m[4])]];
    $("#kpis").replaceChildren(...tiles.map(([l, v]) => h("div", { class: "kpi" }, h("div", { class: "label" }, l), h("div", { class: "value" }, v))));
  },
  async trend() {
    const r = await report(["date"], ["activeUsers"], { order: "date" });
    const byDay = new Map(r.map((x) => [x.d[0], x.m[0]]));
    const pts = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      pts.push({ x: d, y: byDay.get(key) || 0 });
    }
    lineChart($("#trend"), pts, "visitors");
  },
  async cities() {
    const r = await report(["city", "country"], ["activeUsers"], { order: "metric", limit: 10 });
    barList($("#cities"), r.map((x) => ({ label: clean(x.d[0]), sub: clean(x.d[1]), value: x.m[0] })));
  },
  async sources() {
    const r = await report(["sessionSource", "sessionMedium"], ["sessions"], { order: "metric", limit: 10 });
    barList($("#sources"), r.map((x) => ({ label: x.d[0] === "(direct)" ? "Direct / typed URL" : x.d[0], sub: x.d[1] === "(none)" ? "" : x.d[1], value: x.m[0] })));
  },
  async devices() {
    const [d, b] = await Promise.all([
      report(["deviceCategory"], ["activeUsers"], { order: "metric" }),
      report(["browser"], ["activeUsers"], { order: "metric", limit: 6 }),
    ]);
    barList($("#devices"), d.map((x) => ({ label: x.d[0][0].toUpperCase() + x.d[0].slice(1), value: x.m[0] })));
    barList($("#browsers"), b.map((x) => ({ label: x.d[0], value: x.m[0] })));
  },
  async recent() {
    const r = await report(["dateHourMinute", "city", "country", "sessionSource", "deviceCategory", "browser"], ["sessions"], { order: "dateHourMinute", limit: 25 });
    if (!r.length) return note($("#recent"), "No visits yet.");
    const when = (v) => {
      const d = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12));
      return `${shortDate(d)}, ${v.slice(8, 10)}:${v.slice(10, 12)}`;
    };
    $("#recent").replaceChildren(
      h("div", { class: "table-wrap" },
        h("table", {},
          h("thead", {}, h("tr", {}, ["Time", "Place", "Came from", "Device", "Browser"].map((t) => h("th", {}, t)), h("th", { style: "text-align:right" }, "Visits"))),
          h("tbody", {}, r.map((x) => h("tr", {},
            h("td", {}, when(x.d[0])),
            h("td", {}, `${clean(x.d[1])}, ${clean(x.d[2])}`),
            h("td", {}, x.d[3] === "(direct)" ? "Direct" : x.d[3]),
            h("td", {}, x.d[4]),
            h("td", {}, x.d[5]),
            h("td", { class: "num" }, num.format(x.m[0]))
          )))
        )
      ),
      h("p", { class: "note" }, "Times are in your GA4 property's time zone. GA4 doesn't reveal names — this is as close to “who” as it gets.")
    );
  },
};

const PANEL_EL = { live: "#live", kpis: "#kpis", trend: "#trend", cities: "#cities", sources: "#sources", devices: "#devices", recent: "#recent" };

async function loadData() {
  if (!DEMO && (!CONFIG.googleClientId || !CONFIG.gaPropertyId)) return dataGate("setup");
  if (!DEMO && !googleToken()) return dataGate("signin");
  $("#data-gate").hidden = true;
  $("#data-body").hidden = false;
  [...Object.values(PANEL_EL), "#browsers"].forEach((s) => { if (s !== "#live" && s !== "#kpis") $(s).innerHTML = '<div class="skeleton"></div>'; });

  let authFail = null;
  await Promise.all(Object.entries(PANELS).map(async ([name, fn]) => {
    try { await fn(); }
    catch (e) {
      if (e.status === 401 || e.status === 403) authFail = e;
      else note($(PANEL_EL[name]), `Couldn't load: ${esc(e.message)}`);
    }
  }));
  if (authFail) {
    session.del(TOKEN_KEY);
    return dataGate(authFail.status === 403 ? "denied" : "signin", authFail.status === 403 ? authFail.message : "");
  }
  $("#updated").textContent = `Updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

document.querySelectorAll("#range button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b));
    rangeDays = +b.dataset.range;
    loadData();
  })
);
$("#refresh").addEventListener("click", loadData);
let resizeT;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => !$("#data-body").hidden && PANELS.trend().catch(() => {}), 200); });

const C = `https://clarity.microsoft.com/projects/view/${CONFIG.clarityProjectId}`;
$("#clarity-links").replaceChildren(
  h("a", { href: `${C}/impressions`, target: "_blank", rel: "noopener" }, "Recordings ↗"),
  h("a", { href: `${C}/heatmaps`, target: "_blank", rel: "noopener" }, "Heatmaps ↗"),
  h("a", { href: `${C}/dashboard`, target: "_blank", rel: "noopener" }, "Dashboard ↗")
);

// same origin as the site, so this flag is read by analytics.js
const exclude = $("#exclude-me");
exclude.checked = local.get("shrimp-exclude") === "1";
exclude.addEventListener("change", () => (exclude.checked ? local.set("shrimp-exclude", "1") : local.del("shrimp-exclude")));

/* =========================================================
   EDIT
   ========================================================= */
const GH_KEY = "shrimp-gh-token";
const API = `https://api.github.com/repos/${CONFIG.repo}`;
let draft = null, savedJson = "", sha = null, editReady = false;

const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (s) => { let bin = ""; new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
const ghHeaders = () => ({ Authorization: `Bearer ${local.get(GH_KEY)}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

function editGate(msg = "") {
  $("#editor").hidden = true;
  $("#savebar").hidden = true;
  const gate = $("#edit-gate");
  gate.hidden = false;
  const input = h("input", { type: "password", placeholder: "github_pat_…", "aria-label": "GitHub token" });
  const err = h("p", { class: "err" }, msg);
  const btn = h("button", {
    onclick: async () => {
      const t = input.value.trim();
      if (!t) return;
      btn.disabled = true; err.textContent = "";
      try {
        const res = await fetch(API, { headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" } });
        const j = await res.json();
        if (!res.ok) throw new Error(res.status === 401 ? "That token isn't valid." : j.message);
        if (!j.permissions?.push) throw new Error("This token can't write to the repo. Give it Contents: Read and write.");
        local.set(GH_KEY, t);
        editReady = false;
        initEdit();
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    },
  }, "Connect");
  gate.replaceChildren(
    h("h2", {}, "Connect GitHub to edit"),
    h("p", {}, "Edits are saved to ", h("code", {}, "content.json"), " in ", h("code", {}, CONFIG.repo), ". The site updates about a minute after you publish."),
    h("ol", {},
      h("li", {}, "GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token."),
      h("li", {}, "Repository access: only ", h("code", {}, CONFIG.repo), ". Permissions: Contents → Read and write."),
      h("li", {}, "Paste it below. It stays in this browser only.")
    ),
    h("div", { class: "row" }, input),
    h("div", { class: "row", style: "margin-top:10px" }, btn, h("a", { href: "?demo" }, "Try the editor in demo mode")),
    err
  );
}

async function initEdit() {
  if (editReady) return;
  if (!DEMO && !local.get(GH_KEY)) return editGate();
  try {
    if (DEMO) {
      draft = await (await fetch("../content.json", { cache: "no-cache" })).json();
      sha = null;
    } else {
      const res = await fetch(`${API}/contents/${CONFIG.contentPath}?ref=${CONFIG.branch}`, { headers: ghHeaders(), cache: "no-store" });
      if (res.status === 401) { local.del(GH_KEY); return editGate("The saved token expired or was revoked. Connect again."); }
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      draft = JSON.parse(b64decode(j.content));
      sha = j.sha;
    }
    savedJson = JSON.stringify(draft);
    editReady = true;
    $("#edit-gate").hidden = true;
    buildEditor();
  } catch (e) {
    editGate(`Couldn't load content: ${e.message}`);
  }
}

/* ---------- form building ---------- */
function markDirty() {
  const dirty = JSON.stringify(draft) !== savedJson;
  $("#savebar").classList.toggle("dirty", dirty);
  $("#save-state").className = "";
  $("#save-state").textContent = dirty ? "Unsaved changes" : "No unsaved changes";
  $("#save").disabled = !dirty;
  $("#revert").disabled = !dirty;
}

function field(label, value, onInput, { multiline, type = "text", placeholder = "" } = {}) {
  const input = multiline
    ? h("textarea", { rows: 3, placeholder }, value ?? "")
    : h("input", { type, value: value ?? "", placeholder });
  input.addEventListener("input", () => { onInput(input.value); markDirty(); });
  return h("label", { class: "field" }, h("span", {}, label), input);
}

function section(title, hint, ...kids) {
  return h("section", { class: "ed-sec" }, h("h3", {}, title), hint ? h("p", { class: "hint" }, hint) : null, ...kids);
}

// a reorderable list editor: renderItem(item, i) returns the body of one row
function listEditor(arr, renderItem, makeNew, { addLabel = "+ Add", row = false, itemClass } = {}) {
  const wrap = h("div");
  const draw = () => {
    wrap.replaceChildren(
      h("div", { class: "items" },
        arr.map((it, i) => {
          const move = (d) => { [arr[i], arr[i + d]] = [arr[i + d], arr[i]]; draw(); markDirty(); };
          const ctrls = h("div", { class: "ctrls" },
            h("button", { type: "button", title: "Move up", disabled: i === 0, onclick: () => move(-1) }, "↑"),
            h("button", { type: "button", title: "Move down", disabled: i === arr.length - 1, onclick: () => move(1) }, "↓"),
            h("button", { type: "button", class: "del", title: "Remove", onclick: () => { arr.splice(i, 1); draw(); markDirty(); } }, "✕")
          );
          const body = [].concat(renderItem(it, i, draw));
          const cls = ["item", row ? "row" : "", row && body.length === 1 ? "single" : "", itemClass ? itemClass(it) : ""].join(" ");
          return h("div", { class: cls }, ...body, ctrls);
        })
      ),
      h("button", { type: "button", class: "ghost add", onclick: () => { arr.push(makeNew()); draw(); markDirty(); } }, addLabel)
    );
  };
  draw();
  return wrap;
}

function buildEditor() {
  const c = draft;
  const form = $("#editor");
  form.replaceChildren(
    section("Status", "The line under the big title on the first screen.",
      field("Status line", c.status, (v) => (c.status = v), { placeholder: "currently user researcher @ Gallup" })
    ),
    section("About", null,
      field("Bio", c.about.text, (v) => (c.about.text = v), { multiline: true }),
      h("div", { class: "field" }, h("span", {}, "Tags")),
      listEditor(c.about.chips, (t, i) => field("Tag", t, (v) => (c.about.chips[i] = v)), () => "", { row: true, addLabel: "+ Add tag" })
    ),
    section("Case studies", "Shown in this order. The first one is the large featured tile. Hidden ones stay saved but don't appear on the site.",
      listEditor(c.projects, (p, i, redraw) => {
        const cover = h("div", { class: "cover", style: p.image ? `background-image:url("${encodeURI(p.image)}")` : "" });
        return h("div", { class: "proj" },
          cover,
          h("div", {},
            h("div", { class: "fields-2" },
              field("Name", p.name, (v) => (p.name = v)),
              field("Role", p.role, (v) => (p.role = v))
            ),
            field("One-line description", p.blurb, (v) => (p.blurb = v), { multiline: true }),
            field("Link", p.url, (v) => (p.url = v), { type: "url", placeholder: "https://…" }),
            field("Cover image URL", p.image, (v) => { p.image = v; cover.style.backgroundImage = v ? `url("${encodeURI(v)}")` : ""; }, { type: "url", placeholder: "https://…" }),
            h("div", { class: "fields-2" },
              field("Tracking ID", p.id, (v) => (p.id = slug(v)), { placeholder: "used in analytics, e.g. amazon" }),
              h("label", { class: "check", style: "align-self:center" },
                (() => {
                  const cb = h("input", { type: "checkbox", checked: p.visible !== false });
                  cb.addEventListener("change", () => { p.visible = cb.checked; redraw(); markDirty(); });
                  return cb;
                })(),
                "Show on site"
              )
            )
          )
        );
      }, () => ({ id: "", name: "", role: "", blurb: "", url: "", image: "", visible: true }), { addLabel: "+ Add case study", itemClass: (p) => (p.visible === false ? "off" : "") })
    ),
    section("Playground", null,
      listEditor(c.playground, (p) => [field("Title", p.title, (v) => (p.title = v)), field("Link", p.url, (v) => (p.url = v), { type: "url" })], () => ({ title: "", url: "" }), { row: true, addLabel: "+ Add link" })
    ),
    section("Path so far", "Label on the left (e.g. now, before), text on the right.",
      listEditor(c.path, (p) => [field("Label", p.label, (v) => (p.label = v)), field("Text", p.value, (v) => (p.value = v))], () => ({ label: "", value: "" }), { row: true, addLabel: "+ Add row" })
    ),
    section("Contact", null,
      field("Email", c.contact.email, (v) => (c.contact.email = v), { type: "email" }),
      h("div", { class: "field" }, h("span", {}, "Links")),
      listEditor(c.contact.links, (l) => [field("Label", l.label, (v) => (l.label = v)), field("Link", l.url, (v) => (l.url = v), { type: "url" })], () => ({ label: "", url: "" }), { row: true, addLabel: "+ Add link" })
    ),
    DEMO ? null : h("p", { class: "muted" }, "Connected to GitHub. ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); local.del(GH_KEY); editReady = false; editGate(); } }, "Disconnect"))
  );
  form.hidden = false;
  $("#savebar").hidden = false;
  markDirty();
}

function problems(c) {
  const out = [];
  if (!/^\S+@\S+\.\S+$/.test(c.contact.email || "")) out.push("Email doesn't look right.");
  c.projects.forEach((p, i) => {
    if (!p.name?.trim()) out.push(`Case study #${i + 1} needs a name.`);
    if (p.url && !/^https?:\/\//.test(p.url)) out.push(`“${p.name || "#" + (i + 1)}” link should start with https://`);
  });
  return out;
}

$("#save").addEventListener("click", async () => {
  const state = $("#save-state");
  const issues = problems(draft);
  if (issues.length) { state.className = "bad"; state.textContent = issues[0]; return; }
  draft.projects.forEach((p) => { if (!p.id) p.id = slug(p.name); });
  const body = JSON.stringify(draft, null, 2) + "\n";
  $("#save").disabled = true;
  state.className = ""; state.textContent = "Publishing…";
  try {
    if (DEMO) { await new Promise((r) => setTimeout(r, 600)); }
    else {
      const res = await fetch(`${API}/contents/${CONFIG.contentPath}`, {
        method: "PUT",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Update site content via /admin", content: b64encode(body), sha, branch: CONFIG.branch }),
      });
      const j = await res.json();
      if (res.status === 409 || res.status === 422) throw new Error("content.json changed somewhere else. Reload the page to get the latest, then redo your edit.");
      if (!res.ok) throw new Error(j.message);
      sha = j.content.sha;
    }
    savedJson = JSON.stringify(draft);
    markDirty();
    state.className = "ok";
    state.textContent = DEMO ? "Demo mode — nothing was actually saved." : "Published. The site updates in about a minute.";
  } catch (e) {
    state.className = "bad";
    state.textContent = e.message;
    $("#save").disabled = false;
  }
});
$("#revert").addEventListener("click", () => { draft = JSON.parse(savedJson); buildEditor(); });
addEventListener("beforeunload", (e) => { if (draft && JSON.stringify(draft) !== savedJson) { e.preventDefault(); e.returnValue = ""; } });

/* =========================================================
   DEMO DATA (?demo) — made-up numbers shaped like the real reports
   ========================================================= */
function demoReport(method, body) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dims = (body.dimensions || []).map((d) => d.name);
  const days = +(body.dateRanges?.[0]?.startDate || "27daysAgo").replace("daysAgo", "") + 1;
  const scale = days / 28;
  const R = (vals, ...m) => ({ dimensionValues: vals.map((value) => ({ value: String(value) })), metricValues: m.map((value) => ({ value: String(value) })) });
  const rows = (list) => Promise.resolve({ rows: list });

  if (method === "runRealtimeReport") return rows([R(["United States", "New York"], 2), R(["China", "Shanghai"], 1)]);
  const key = dims.join(",");
  if (!dims.length) return rows([R([], Math.round(312 * scale), Math.round(241 * scale), Math.round(455 * scale), 94.5, 0.62)]);
  if (key === "date") {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      out.push(R([k], Math.round(6 + rnd() * 10 + (d.getDay() % 6 ? 4 : 0) + (i < 5 ? 8 : 0))));
    }
    return rows(out);
  }
  const s = (n) => Math.max(1, Math.round(n * scale));
  const table = {
    "city,country": [["San Francisco", "United States", 61], ["New York", "United States", 44], ["Washington", "United States", 37], ["Los Angeles", "United States", 29], ["Shanghai", "China", 22], ["Seattle", "United States", 18], ["London", "United Kingdom", 11], ["(not set)", "United States", 7]].map(([a, b, n]) => R([a, b], s(n))),
    "sessionSource,sessionMedium": [["linkedin.com", "referral", 162], ["(direct)", "(none)", 131], ["google", "organic", 74], ["behance.net", "referral", 39], ["sharontzhao.com", "referral", 22]].map(([a, b, n]) => R([a, b], s(n))),
    deviceCategory: [["desktop", 201], ["mobile", 104], ["tablet", 7]].map(([a, n]) => R([a], s(n))),
    browser: [["Chrome", 176], ["Safari", 98], ["Edge", 21], ["Firefox", 17]].map(([a, n]) => R([a], s(n))),
  };
  if (table[key]) return rows(table[key]);
  if (dims[0] === "dateHourMinute") {
    const places = [["San Francisco", "United States"], ["New York", "United States"], ["Shanghai", "China"], ["Washington", "United States"], ["London", "United Kingdom"]];
    const srcs = ["linkedin.com", "(direct)", "google", "behance.net"];
    const devs = [["desktop", "Chrome"], ["mobile", "Safari"], ["desktop", "Safari"], ["mobile", "Chrome"]];
    const out = [];
    let t = Date.now();
    for (let i = 0; i < 18; i++) {
      t -= (20 + rnd() * 300) * 60_000;
      const d = new Date(t);
      const k = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      const p = places[Math.floor(rnd() * places.length)], dv = devs[Math.floor(rnd() * devs.length)];
      out.push(R([k, p[0], p[1], srcs[Math.floor(rnd() * srcs.length)], dv[0], dv[1]], 1));
    }
    return rows(out);
  }
  return rows([]);
}

/* ---------- start ---------- */
showTab(location.hash === "#edit" ? "edit" : local.get("shrimp-admin-tab") || "data");
loadData();
