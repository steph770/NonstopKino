"use strict";

const STORE_KEY = "kinosieb.v1";

const VERSION_INFO = {
  DF: "Deutsche Fassung, synchronisiert",
  OV: "Originalversion ohne Untertitel",
  OmdU: "Original mit deutschen Untertiteln",
  OmeU: "Original mit englischen Untertiteln",
  OmU: "Original mit Untertiteln",
};
const ORIGINS = [
  ["us", "USA", "Produktionsland USA, auch US-Indies"],
  ["at", "Österreich", "Österreichische Filme und Koproduktionen"],
  ["intl", "International", "Alle anderen Länder"],
];
const WHEN = [
  ["today", "Heute"],
  ["tomorrow", "Morgen"],
  ["weekend", "Wochenende"],
  ["week", "7 Tage"],
  ["all", "Alles"],
];
const META_STEPS = [0, 60, 70, 80];
const SORTS = ["imdb", "meta", "group", "next", "title"];

const DEFAULTS = {
  sort: "imdb",
  when: "week",
  cinemas: [],
  versions: [],
  genres: [],
  origins: [],
  metaMin: 0,
  q: "",
};

let DATA = null;
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...JSON.parse(raw) };
    if (!SORTS.includes(s.sort)) s.sort = DEFAULTS.sort;
    s.q = "";
    return s;
  } catch (e) {
    return { ...DEFAULTS };
  }
}
function saveState() {
  try {
    const { q, ...rest } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
  } catch (e) { /* Speicher nicht verfügbar, egal */ }
}

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function parseLocal(dt) {
  const [d, t = "00:00"] = dt.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h, mi);
}
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MON = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const pad = (n) => String(n).padStart(2, "0");
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function dayWord(d, now) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  return `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}
function timeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function deNum(x, digits = 1) { return Number(x).toFixed(digits).replace(".", ","); }
function votesStr(v) {
  if (!v) return "";
  if (v >= 1e6) return `${deNum(v / 1e6)} Mio. Stimmen`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} Tsd. Stimmen`;
  return `${v} Stimmen`;
}
function votesShort(v) {
  if (v >= 1e6) return `${deNum(v / 1e6)} Mio. Stimmen`;
  if (v >= 1e4) return `${Math.round(v / 1e3)} Tsd. Stimmen`;
  return `${v.toLocaleString("de-AT")} Stimmen`;
}
function metaClass(m) { return m >= 61 ? "good" : m >= 40 ? "mid" : "bad"; }

/* ---------- Gruppe & Bewertungen ---------- */
const SCALE = [["🙅", "nein"], ["🤷", "vielleicht"], ["🙂", "gern"], ["🤩", "unbedingt"]];
const GROUP = { code: null, api: null, me: null, members: {}, votes: {}, error: "" };

function personId(name) { return norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "gast"; }
function loadMe() { try { return JSON.parse(localStorage.getItem("kinosieb.ich")); } catch (e) { return null; } }
function saveMe(me) { try { localStorage.setItem("kinosieb.ich", JSON.stringify(me)); } catch (e) { /* egal */ } }

function groupMembers() {
  const m = { ...GROUP.members };
  if (GROUP.me && !m[GROUP.me.id]) m[GROUP.me.id] = { name: GROUP.me.name };
  return Object.entries(m).map(([id, v]) => ({ id, name: (v && v.name) || id })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}
function shortLabels() {
  const list = groupMembers();
  const out = {};
  for (const p of list) {
    const me = norm(p.name);
    const others = list.filter((q) => q.id !== p.id).map((q) => norm(q.name));
    let n = 1;
    while (n < me.length && others.some((o) => o.startsWith(me.slice(0, n)))) n++;
    const s = p.name.slice(0, n);
    out[p.id] = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return out;
}
function entriesFor(filmId) { return GROUP.votes[filmId] || {}; }
function mine(filmId) { return (GROUP.me && entriesFor(filmId)[GROUP.me.id]) || {}; }
function seenByMe(f) { return !!(GROUP.code && mine(f.id).s); }
function groupScore(f) {
  let sum = 0, n = 0, top = 0;
  for (const e of Object.values(entriesFor(f.id))) {
    if (e && typeof e.v === "number") { sum += e.v; n++; if (e.v === 3) top++; }
  }
  return { sum, n, top };
}
function votesLine(f) {
  if (!GROUP.code) return "";
  const labels = shortLabels();
  const chips = [];
  for (const p of groupMembers()) {
    const e = entriesFor(f.id)[p.id];
    if (!e || (typeof e.v !== "number" && !e.s)) continue;
    const has = typeof e.v === "number";
    const title = `${p.name}: ${has ? SCALE[e.v][1] : "nicht bewertet"}${e.s ? ", schon gesehen" : ""}`;
    chips.push(`<span class="vchip${GROUP.me && p.id === GROUP.me.id ? " me" : ""}" title="${esc(title)}">${esc(labels[p.id])}${has ? ` ${SCALE[e.v][0]}` : ""}${e.s ? " ✓" : ""}</span>`);
  }
  return chips.length ? `<span class="votes">${chips.join("")}</span>` : "";
}
function groupSectionHTML(f) {
  if (!GROUP.code) return "";
  if (!GROUP.me) {
    return `<section class="d-group"><h3>Eure Bewertungen</h3><p class="d-note">Wähle zuerst deinen Namen, dann kannst du mitbewerten.</p><button type="button" class="primary" data-who-open>Namen wählen</button></section>`;
  }
  const my = mine(f.id);
  const btns = SCALE.map(([emo, label], v) => `<button type="button" class="rate" data-vote="${v}" aria-pressed="${my.v === v}"><span class="emo" aria-hidden="true">${emo}</span><span>${label}</span></button>`).join("");
  const list = groupMembers().map((p) => {
    const e = entriesFor(f.id)[p.id] || {};
    const has = typeof e.v === "number";
    const what = `${has ? `${SCALE[e.v][0]} ${SCALE[e.v][1]}` : "noch nicht bewertet"}${e.s ? ", schon gesehen" : ""}`;
    return `<li><span class="who">${esc(p.name)}${p.id === GROUP.me.id ? " (du)" : ""}</span><span class="what${has || e.s ? "" : " none"}">${what}</span></li>`;
  }).join("");
  return `<section class="d-group">
    <h3>Wie gern willst du ihn sehen?</h3>
    <div class="rates" role="group" aria-label="Deine Bewertung">${btns}</div>
    <button type="button" class="seen-toggle" data-seen aria-pressed="${!!my.s}">${my.s ? "✓ Schon gesehen" : "Schon gesehen? Hier abhaken"}</button>
    <ul class="group-list">${list}</ul>
  </section>`;
}
function groupFail(e) {
  const code = e && e.code;
  GROUP.error = code === "permission-denied"
    ? "Der Gruppen-Code passt nicht zu den Firebase-Regeln."
    : (e && e.message) || "Unbekannter Fehler";
  renderGroupInfo();
}
function setMine(filmId, patch) {
  if (!GROUP.me || !GROUP.api) return;
  const cur = { v: null, s: false, ...mine(filmId) };
  const next = { ...cur, ...patch };
  GROUP.votes[filmId] = { ...entriesFor(filmId), [GROUP.me.id]: next };
  refreshAll();
  GROUP.api.set(filmId, GROUP.me.id, { v: next.v, s: next.s }).catch(groupFail);
}
let refreshTimer;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 60); }
function refreshAll() {
  if (!DATA || !DATA.films) return;
  renderList();
  const dlg = $("#detail");
  if (dlg.open) {
    const st = dlg.scrollTop;
    const f = DATA.films.find((x) => x.id === $("#detailBody").dataset.id);
    if (f) renderDetail(f);
    dlg.scrollTop = st;
  }
  renderGroupInfo();
}
function renderGroupInfo() {
  const el = $("#gruppeInfo");
  if (!el) return;
  if (!GROUP.code) { el.textContent = "Gemeinsame Bewertungen: Öffne den Einladungslink eurer Gruppe."; return; }
  if (GROUP.error) { el.textContent = `Bewertungen gerade nicht erreichbar. ${GROUP.error}`; return; }
  const n = groupMembers().length;
  el.innerHTML = GROUP.me
    ? `Du bewertest als <b>${esc(GROUP.me.name)}</b>, ${n} ${n === 1 ? "Person" : "Personen"} in der Gruppe. <button type="button" class="linkbtn" data-who-open>Name ändern</button>`
    : `<button type="button" class="linkbtn" data-who-open>Namen wählen</button>, um mitzubewerten.`;
}
function openWho() {
  if (!GROUP.code) return;
  const list = groupMembers();
  $("#whoBody").innerHTML = `
    ${list.length ? `<p class="hint">Schon in der Gruppe:</p><div class="opts">${list.map((p) => `<button type="button" class="opt" data-who="${esc(p.id)}" aria-pressed="${!!(GROUP.me && GROUP.me.id === p.id)}">${esc(p.name)}</button>`).join("")}</div>` : ""}
    <label class="who-new"><span>${list.length ? "Oder neu dazukommen:" : "Dein Vorname:"}</span><input id="whoName" type="text" maxlength="24" autocomplete="given-name" placeholder="Vorname"></label>
    <button type="button" class="primary" data-who-new>Beitreten</button>`;
  const dlg = $("#who");
  if (!dlg.open) dlg.showModal();
}
function chooseMe(id, name) {
  GROUP.me = { id, name };
  saveMe(GROUP.me);
  if (GROUP.api) GROUP.api.join(id, name).catch(groupFail);
  $("#who").close();
  refreshAll();
}
function readGroupCode() {
  const m = location.hash.match(/gruppe=([A-Za-z0-9_-]{4,})/);
  if (m) {
    try { localStorage.setItem("kinosieb.gruppe", m[1]); } catch (e) { /* egal */ }
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  try { return localStorage.getItem("kinosieb.gruppe"); } catch (e) { return null; }
}
async function connectGroup() {
  if (!GROUP.code) { renderGroupInfo(); return; }
  GROUP.me = loadMe();
  renderGroupInfo();
  try {
    const mod = await import("./gruppe.js?v=9");
    GROUP.api = await mod.connect({
      code: GROUP.code,
      config: window.KINOSIEB_FIREBASE,
      onMembers: (m) => { GROUP.members = m || {}; GROUP.error = ""; scheduleRefresh(); },
      onVotes: (v) => { GROUP.votes = v || {}; GROUP.error = ""; scheduleRefresh(); },
      onError: groupFail,
    });
    if (GROUP.me) GROUP.api.join(GROUP.me.id, GROUP.me.name).catch(groupFail);
    else setTimeout(openWho, 700);
  } catch (e) {
    groupFail(e);
  }
}

function whenRange(key, now) {
  const today = startOfDay(now);
  switch (key) {
    case "today": return [now, addDays(today, 1)];
    case "tomorrow": return [addDays(today, 1), addDays(today, 2)];
    case "weekend": {
      const wd = now.getDay(); // 0 So .. 6 Sa
      if (wd === 5 || wd === 6 || wd === 0) {
        const end = addDays(today, wd === 0 ? 1 : 8 - wd);
        return [now, end];
      }
      const fri = addDays(today, 5 - wd);
      return [fri, addDays(fri, 3)];
    }
    case "week": return [now, addDays(now, 7)];
    default: return [now, new Date(8.64e15)];
  }
}

/* ---------- Filtern & Sortieren ---------- */
function screeningsFor(film, now, ignoreFilters = false) {
  const [from, to] = whenRange(ignoreFilters ? "all" : state.when, now);
  return film.screenings.filter((s) => {
    if (s._d < now) return false;
    if (ignoreFilters) return true;
    if (s._d < from || s._d >= to) return false;
    if (state.cinemas.length && !state.cinemas.includes(s.cinema)) return false;
    if (state.versions.length && !state.versions.includes(s.version)) return false;
    return true;
  });
}

function filmPasses(film) {
  if (state.genres.length && !film.genres.some((g) => state.genres.includes(g))) return false;
  if (state.origins.length && !state.origins.includes(film.origin || "")) return false;
  if (state.metaMin && !(film.metascore >= state.metaMin)) return false;
  if (state.q) {
    const q = norm(state.q);
    const hay = norm([film.title, film.originalTitle, film.director].join(" "));
    if (!hay.includes(q)) return false;
  }
  return true;
}

function compute() {
  const now = new Date();
  const rows = [];
  for (const f of DATA.films) {
    if (!filmPasses(f)) continue;
    const shows = screeningsFor(f, now);
    if (!shows.length) continue;
    rows.push({ f, shows });
  }
  const nullsLast = (a, b) => (a == null) - (b == null);
  const byTitle = (a, b) => a.f.title.localeCompare(b.f.title, "de");
  const sorters = {
    imdb: (a, b) => nullsLast(a.f.imdbRating, b.f.imdbRating) || (b.f.imdbRating || 0) - (a.f.imdbRating || 0) || (b.f.imdbVotes || 0) - (a.f.imdbVotes || 0) || byTitle(a, b),
    meta: (a, b) => nullsLast(a.f.metascore, b.f.metascore) || (b.f.metascore || 0) - (a.f.metascore || 0) || byTitle(a, b),
    next: (a, b) => a.shows[0]._d - b.shows[0]._d || byTitle(a, b),
    title: byTitle,
    group: (a, b) => {
      const A = groupScore(a.f), B = groupScore(b.f);
      return (B.n > 0) - (A.n > 0) || B.sum - A.sum || B.top - A.top || sorters.imdb(a, b);
    },
  };
  const sorter = sorters[state.sort === "group" && !GROUP.code ? "imdb" : state.sort] || sorters.imdb;
  rows.sort((a, b) => (seenByMe(a.f) - seenByMe(b.f)) || sorter(a, b));
  return { rows, now };
}

function activeCount() {
  return (state.when !== DEFAULTS.when ? 1 : 0) + state.cinemas.length + state.versions.length + state.genres.length +
    state.origins.length + (state.metaMin ? 1 : 0);
}

/* ---------- Darstellung ---------- */
window.posterFail = (img) => {
  const d = document.createElement("div");
  d.className = `${img.className} empty`;
  d.setAttribute("aria-hidden", "true");
  d.textContent = img.dataset.initial || "";
  img.replaceWith(d);
};
function posterHTML(f, cls = "poster", size = "w185") {
  if (f.poster) {
    const src = f.poster.replace("{size}", size);
    return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" data-initial="${esc((f.title || "?").trim().charAt(0))}" onerror="posterFail(this)">`;
  }
  return `<div class="${cls} empty" aria-hidden="true">${esc((f.title || "?").trim().charAt(0))}</div>`;
}

function factsLine(f) {
  const parts = [];
  if (f.year) parts.push(f.year);
  if (f.runtime) parts.push(`${f.runtime} Min.`);
  if (f.countryNames && f.countryNames.length) parts.push(f.countryNames.slice(0, 2).join("/"));
  return parts.join(", ");
}

function ticketHTML({ f, shows }, now, i = 0) {
  const first = shows[0];
  const more = shows.length - 1;
  const score = f.imdbRating != null
    ? `<span class="score">${deNum(f.imdbRating)}</span><span class="score-label">IMDb${f.imdbVotes ? `<br>${votesShort(f.imdbVotes)}` : ""}</span>`
    : `<span class="score none">–</span><span class="score-label">keine IMDb-Wertung</span>`;
  const meta = f.metascore != null ? `<span class="meta ${metaClass(f.metascore)}" title="Metascore">Meta ${f.metascore}</span>` : "";
  const genres = f.genres.length ? `<p class="genres">${esc(f.genres.slice(0, 3).join(", "))}</p>` : "";
  const n = String(i + 1).padStart(2, "0");
  return `<button class="ticket${seenByMe(f) ? " is-seen" : ""}" type="button" data-id="${esc(f.id)}">
    <span class="edge" aria-hidden="true">▸ ${n}&emsp;&emsp;▸ ${n}A&emsp;&emsp;NONSTOPKINO 35&emsp;&emsp;▸ ${n}</span>
    ${posterHTML(f)}
    <span class="body">
      <span class="title">${esc(f.title)}</span>
      <span class="facts">${esc(factsLine(f))}</span>
      ${genres.replace("<p", "<span").replace("</p>", "</span>")}
      <span class="next"><b>${dayWord(first._d, now)} ${timeStr(first._d)}</b> ${esc(first.cinema)}
        <span class="vtag" title="${esc(VERSION_INFO[first.version] || first.version)}">${esc(first.version)}</span>
        ${more > 0 ? `<span class="more">+${more} weitere</span>` : ""}</span>
      ${votesLine(f)}
    </span>
    <span class="stub">${score}${meta}</span>
  </button>`;
}

function renderList() {
  const el = $("#list");
  const { rows, now } = compute();
  const totalShows = rows.reduce((n, r) => n + r.shows.length, 0);
  const ac = activeCount() + (state.q ? 1 : 0);
  const summary = `<p class="summary"><span>${rows.length} ${rows.length === 1 ? "Film" : "Filme"}, ${totalShows} Vorstellungen</span>${ac ? `<button type="button" data-reset>Filter zurücksetzen</button>` : ""}</p>`;
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><h2>Nichts gefunden</h2><p>Kein Film passt zu allen gewählten Filtern. Lockere einen Filter oder setze alle zurück.</p><button type="button" class="primary" data-reset>Filter zurücksetzen</button></div>`;
  } else {
    el.innerHTML = summary + rows.map((r, i) => ticketHTML(r, now, i)).join("");
  }
  $("#showN").textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "Film" : "Filme"} anzeigen` : "Keine Treffer";
  renderChips();
  const gb = document.querySelector('.sortrow [data-sort="group"]');
  if (gb) gb.hidden = !GROUP.code;
  const eff = state.sort === "group" && !GROUP.code ? "imdb" : state.sort;
  document.querySelectorAll(".sortrow button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sort === eff)));
}

const CHIP_DEFS = [
  ["when", "Wann", () => (state.when !== DEFAULTS.when ? WHEN.find((w) => w[0] === state.when)[1] : "")],
  ["cinemas", "Kino", () => state.cinemas.length],
  ["versions", "Fassung", () => state.versions.length],
  ["genres", "Genre", () => state.genres.length],
  ["origins", "Herkunft", () => state.origins.length],
  ["critics", "Metascore", () => (state.metaMin ? `ab ${state.metaMin}` : "")],
];
function renderChips() {
  $("#chips").innerHTML = CHIP_DEFS.map(([key, label, val]) => {
    const v = val();
    const on = !!v;
    if (key === "when") {
      const cur = WHEN.find((w) => w[0] === state.when)[1];
      return `<button type="button" class="chip${on ? " on" : ""}" data-open="when">${esc(cur)}</button>`;
    }
    const extra = on ? `<span class="n">${typeof v === "number" ? v : esc(v)}</span>` : "";
    return `<button type="button" class="chip${on ? " on" : ""}" data-open="${key}">${label}${extra}</button>`;
  }).join("");
}

function optBtn(group, value, label, pressed, sub = "") {
  return `<button type="button" class="opt" data-group="${group}" data-value="${esc(value)}" aria-pressed="${pressed}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
}

function filterHTML() {
  const now = new Date();
  const upcoming = DATA.films.flatMap((f) => f.screenings.filter((s) => s._d >= now).map((s) => ({ s, f })));
  const cinemaCount = {}, versionCount = {}, genreCount = {};
  for (const { s } of upcoming) {
    cinemaCount[s.cinema] = (cinemaCount[s.cinema] || 0) + 1;
    versionCount[s.version] = (versionCount[s.version] || 0) + 1;
  }
  for (const f of DATA.films) {
    if (!f.screenings.some((s) => s._d >= now)) continue;
    for (const g of f.genres) genreCount[g] = (genreCount[g] || 0) + 1;
  }
  const cinemas = Object.keys(cinemaCount).sort((a, b) => a.localeCompare(b, "de"));
  const versions = Object.keys(versionCount).sort((a, b) => versionCount[b] - versionCount[a]);
  const genres = Object.keys(genreCount).sort((a, b) => genreCount[b] - genreCount[a]);

  return `
  <section class="fgroup" id="f-when"><h3>Wann</h3><div class="opts">
    ${WHEN.map(([k, l]) => optBtn("when", k, l, state.when === k)).join("")}
  </div></section>
  <section class="fgroup" id="f-cinemas"><h3>Kino</h3><div class="opts">
    ${cinemas.map((c) => optBtn("cinemas", c, c, state.cinemas.includes(c))).join("")}
  </div></section>
  <section class="fgroup" id="f-versions"><h3>Fassung</h3><div class="vlist">
    ${versions.map((v) => `<button type="button" class="opt" data-group="versions" data-value="${esc(v)}" aria-pressed="${state.versions.includes(v)}"><span>${esc(v)}</span><span>${esc(VERSION_INFO[v] || "")}</span></button>`).join("")}
  </div></section>
  <section class="fgroup" id="f-genres"><h3>Genre</h3><p class="hint">Zeigt Filme mit mindestens einem der gewählten Genres.</p><div class="opts">
    ${genres.map((g) => optBtn("genres", g, g, state.genres.includes(g), String(genreCount[g]))).join("")}
  </div></section>
  <section class="fgroup" id="f-origins"><h3>Herkunft</h3><div class="vlist">
    ${ORIGINS.map(([k, l, d]) => `<button type="button" class="opt" data-group="origins" data-value="${k}" aria-pressed="${state.origins.includes(k)}"><span>${l}</span><span>${d}</span></button>`).join("")}
  </div></section>
  <section class="fgroup" id="f-critics"><h3>Metascore</h3>
    <p class="hint">Metascore ist der Durchschnitt der Profi-Kritiken auf Metacritic (0 bis 100).</p>
    <div class="opts">
      ${META_STEPS.map((m) => optBtn("metaMin", m, m ? `Metascore ab ${m}` : "Alle", state.metaMin === m)).join("")}
    </div>
  </section>`;
}

function renderFilters() {
  const html = filterHTML();
  $("#sheetBody").innerHTML = html;
  $("#side").innerHTML = html;
}

function toggle(group, value) {
  if (group === "when") state.when = value;
  else if (group === "metaMin") state.metaMin = Number(value);
  else {
    const arr = state[group];
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
  }
  saveState();
  renderFilters();
  renderList();
}

function resetFilters() {
  const sort = state.sort;
  state = { ...DEFAULTS, cinemas: [], versions: [], genres: [], origins: [], sort };
  $("#q").value = "";
  saveState();
  renderFilters();
  renderList();
}

/* ---------- Detail ---------- */
let detailAll = false;
function openDetail(id) {
  const f = DATA.films.find((x) => x.id === id);
  if (!f) return;
  detailAll = false;
  renderDetail(f);
  const dlg = $("#detail");
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  history.pushState({ detail: id }, "", `#film=${encodeURIComponent(id)}`);
}

function renderDetail(f) {
  const now = new Date();
  const shows = detailAll ? screeningsFor(f, now, true) : screeningsFor(f, now);
  const allCount = screeningsFor(f, now, true).length;
  const byDay = new Map();
  for (const s of shows) {
    const key = startOfDay(s._d).getTime();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }
  const days = [...byDay.entries()].map(([k, list]) => {
    const d = new Date(Number(k));
    const label = `${dayWord(d, now) === "Heute" || dayWord(d, now) === "Morgen" ? dayWord(d, now) + ", " : ""}${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`;
    const rows = list.map((s) => `<div class="show">
        <span class="show-time">${timeStr(s._d)}</span>
        <span class="show-where"><span class="cin">${esc(s.cinema)}</span> <span class="vtag" title="${esc(VERSION_INFO[s.version] || s.version)}">${esc(s.version)}</span>
          ${s.tags && s.tags.length ? `<br><span class="tags">${esc(s.tags.join(", "))}</span>` : ""}</span>
        <span class="show-links">${s.cinemaUrl ? `<a href="${esc(s.cinemaUrl)}" target="_blank" rel="noopener">Kino</a>` : ""}${s.ics ? `<a href="${esc(s.ics)}" target="_blank" rel="noopener">Kalender</a>` : ""}</span>
      </div>`).join("");
    return `<div class="day"><h4>${label}</h4>${rows}</div>`;
  }).join("");

  const scores = [];
  if (f.imdbRating != null) scores.push(`<span class="d-score"><span class="score">${deNum(f.imdbRating)}</span><span class="score-label">IMDb${f.imdbVotes ? `, ${votesStr(f.imdbVotes)}` : ""}</span></span>`);
  else scores.push(`<span class="d-score"><span class="score none">–</span><span class="score-label">noch keine IMDb-Wertung</span></span>`);
  if (f.metascore != null) scores.push(`<span class="meta ${metaClass(f.metascore)}">Metascore ${f.metascore}</span>`);

  const facts = [factsLine(f), f.director ? `Regie: ${f.director}` : ""].filter(Boolean).join(". ");
  const links = [
    f.trailer ? `<a class="trailer" href="${esc(f.trailer)}" target="_blank" rel="noopener">Trailer ansehen</a>` : "",
    f.imdbId ? `<a href="https://www.imdb.com/title/${esc(f.imdbId)}/" target="_blank" rel="noopener">IMDb</a>` : "",
    f.nonstopUrl ? `<a href="${esc(f.nonstopUrl)}" target="_blank" rel="noopener">nonstop-Seite</a>` : "",
  ].join("");
  const filtered = activeCount() > 0 && allCount !== shows.length;

  $("#detailBody").innerHTML = `
    <div class="detail-bar"><button type="button" class="ghost" data-close-detail>Zurück zur Liste</button></div>
    <div class="d-hero">
      ${posterHTML(f, "poster", "w342")}
      <div>
        <h2 class="d-title">${esc(f.title)}</h2>
        ${f.originalTitle && norm(f.originalTitle) !== norm(f.title) ? `<p class="d-orig">${esc(f.originalTitle)}</p>` : ""}
        <p class="d-facts">${esc(facts)}</p>
        ${f.genres.length ? `<p class="d-facts">${esc(f.genres.join(", "))}</p>` : ""}
        <div class="d-scores">${scores.join("")}</div>
      </div>
    </div>
    ${f.overview ? `<p class="d-overview">${esc(f.overview)}</p>` : ""}
    <div class="d-links">${links}</div>
    ${groupSectionHTML(f)}
    <section class="d-shows">
      <div class="d-shows-head"><h3>Vorstellungen in Wien</h3>
        ${filtered || detailAll ? `<button type="button" data-toggle-all>${detailAll ? "Nur passend zu meinen Filtern" : `Alle ${allCount} zeigen`}</button>` : ""}
      </div>
      ${days || `<p class="d-note">Keine kommenden Vorstellungen.</p>`}
    </section>
    <p class="d-note">Reservierung und Abo-Bedingungen stehen auf der Website des jeweiligen Kinos.</p>`;
  $("#detailBody").dataset.id = f.id;
}

function closeDetail(fromPop = false) {
  const dlg = $("#detail");
  if (dlg.open) dlg.close();
  if (!fromPop && location.hash.startsWith("#film=")) history.back();
}

/* ---------- Ereignisse ---------- */
function bind() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    if (t.matches(".ticket")) return openDetail(t.dataset.id);
    if (t.dataset.open) {
      renderFilters();
      $("#sheet").showModal();
      const sec = $(`#sheetBody #f-${t.dataset.open}`);
      if (sec) sec.scrollIntoView({ block: "start" });
      return;
    }
    if (t.dataset.group) return toggle(t.dataset.group, t.dataset.value);
    if (t.dataset.sort) { state.sort = t.dataset.sort; saveState(); return renderList(); }
    if (t.dataset.stil) return applyStil(t.dataset.stil);
    if (t.dataset.vote !== undefined) {
      const id = $("#detailBody").dataset.id;
      const v = Number(t.dataset.vote);
      return setMine(id, { v: mine(id).v === v ? null : v });
    }
    if (t.hasAttribute("data-seen")) {
      const id = $("#detailBody").dataset.id;
      return setMine(id, { s: !mine(id).s });
    }
    if (t.hasAttribute("data-who-open")) return openWho();
    if (t.hasAttribute("data-who-close")) return $("#who").close();
    if (t.dataset.who) {
      const p = groupMembers().find((x) => x.id === t.dataset.who);
      return p && chooseMe(p.id, p.name);
    }
    if (t.hasAttribute("data-who-new")) {
      const name = ($("#whoName").value || "").trim();
      if (!name) { $("#whoName").focus(); return; }
      return chooseMe(personId(name), name);
    }
    if (t.hasAttribute("data-reset") || t.id === "reset") return resetFilters();
    if (t.hasAttribute("data-close")) return $("#sheet").close();
    if (t.hasAttribute("data-close-detail")) return closeDetail();
    if (t.hasAttribute("data-toggle-all")) {
      detailAll = !detailAll;
      const f = DATA.films.find((x) => x.id === $("#detailBody").dataset.id);
      if (f) renderDetail(f);
    }
  });
  $("#sheet").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $("#detail").addEventListener("cancel", (e) => { e.preventDefault(); closeDetail(); });
  window.addEventListener("popstate", () => { if (!location.hash.startsWith("#film=")) closeDetail(true); });
  let qTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderList(); }, 120);
  });
}

function statusText() {
  const g = new Date(DATA.generated);
  if (isNaN(g)) return "";
  const now = new Date();
  return `Stand ${dayWord(g, now)}, ${timeStr(g)}`;
}

/* ---------- Aussehen ---------- */
function currentStil() { return document.documentElement.dataset.stil === "film" ? "film" : "karte"; }
function applyStil(stil) {
  if (stil === "film") document.documentElement.dataset.stil = "film";
  else delete document.documentElement.dataset.stil;
  try { localStorage.setItem("kinosieb.stil", stil); } catch (e) { /* egal */ }
  document.querySelectorAll(".stilwahl button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.stil === stil)));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = stil === "film" ? "#e7eae4" : "#2a0c12";
}
function tileTitle() {
  const h = document.querySelector(".brand h1");
  const text = h.textContent.trim();
  h.setAttribute("aria-label", text);
  h.innerHTML = [...text].map((c) => `<span class="tile" aria-hidden="true">${esc(c)}</span>`).join("");
}
function countdown() {
  if (currentStil() !== "film") return Promise.resolve();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  try { if (sessionStorage.getItem("kinosieb.vorlauf")) return Promise.resolve(); sessionStorage.setItem("kinosieb.vorlauf", "1"); } catch (e) { /* egal */ }
  const el = document.createElement("div");
  el.className = "leader";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="leader-ring"><span>3</span></div>`;
  document.body.appendChild(el);
  const num = el.querySelector("span");
  return new Promise((done) => {
    setTimeout(() => { num.textContent = "2"; }, 450);
    setTimeout(() => { num.textContent = "1"; }, 900);
    setTimeout(() => { el.classList.add("out"); done(); }, 1350);
    setTimeout(() => el.remove(), 1750);
  });
}

async function init() {
  bind();
  tileTitle();
  applyStil(currentStil());
  countdown();
  GROUP.code = readGroupCode();
  try {
    const res = await fetch("data/data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (e) {
    $("#status").textContent = "";
    $("#list").innerHTML = `<div class="empty-state"><h2>Programm nicht geladen</h2><p>Die Programmdaten konnten nicht abgerufen werden (${esc(e.message)}). Prüfe die Internetverbindung und lade die Seite neu.</p></div>`;
    return;
  }
  if (!DATA.films || !DATA.films.length) {
    $("#status").textContent = "";
    $("#list").innerHTML = `<div class="empty-state"><h2>Noch kein Programm</h2><p>Das tägliche Update hat noch keine Daten geliefert. Sobald es auf GitHub durchgelaufen ist, erscheint hier das Programm.</p></div>`;
    return;
  }
  for (const f of DATA.films) {
    f.genres = f.genres || [];
    for (const s of f.screenings) s._d = parseLocal(s.dt);
    f.screenings.sort((a, b) => a._d - b._d);
  }
  $("#status").textContent = statusText();
  renderFilters();
  renderList();
  connectGroup();
  const m = location.hash.match(/^#film=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
