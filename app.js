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
const RT_STEPS = [0, 60, 75, 90];
const SORTS = ["imdb", "meta", "group", "next", "title"];

const DEFAULTS = {
  sort: "imdb",
  when: "week",
  cinemas: [],
  versions: [],
  genres: [],
  origins: [],
  metaMin: 0,
  rtMin: 0,
  people: [],
  allWant: false,
  unrated: false,
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
function rtBadge(f, long = false) {
  if (f.rt == null) return "";
  const fresh = f.rt >= 60;
  return `<span class="rt ${fresh ? "fresh" : "rotten"}" title="Rotten Tomatoes: ${f.rt} % positive Kritiken (${fresh ? "fresh" : "rotten"})">${fresh ? "🍅" : "🤢"} ${long ? "Rotten Tomatoes " : ""}${f.rt} %</span>`;
}

/* ---------- Gruppe & Bewertungen ---------- */
const SCALE = [["🙅", "nein"], ["🤷", "vielleicht"], ["🙂", "gern"], ["🤩", "unbedingt"]];
const GROUP = { code: null, api: null, me: null, members: {}, votes: {}, comments: {}, drafts: {}, error: "", status: "aus" };

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
    chips.push(`<span class="vchip${GROUP.me && p.id === GROUP.me.id ? " me" : ""}" title="${esc(title)}">${esc(labels[p.id])}${has ? ` ${SCALE[e.v][0]}` : ""}${e.s ? " 👀" : ""}</span>`);
  }
  const nc = (GROUP.comments[f.id] || []).length;
  if (nc) chips.push(`<span class="vchip cmt" title="${nc} ${nc === 1 ? "Kommentar" : "Kommentare"}">💬 ${nc}</span>`);
  return chips.length ? `<span class="votes">${chips.join("")}</span>` : "";
}

/* ---------- Kommentare ---------- */
function agoStr(ms) {
  const now = new Date();
  const d = new Date(ms);
  const min = Math.round((now - d) / 6e4);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  if (min < 6 * 60) return `vor ${Math.round(min / 60)} Std.`;
  return `${dayWord(d, now)}, ${timeStr(d)}`;
}
function commentsListHTML(f) {
  const list = GROUP.comments[f.id] || [];
  if (!list.length) return `<p class="d-note">Noch keine Kommentare. Schreib als Erste:r, was du vom Film hältst oder wann du kannst.</p>`;
  return `<ul class="cmt-list">${list.map((c) => {
    const own = GROUP.me && c.person === GROUP.me.id;
    return `<li class="cmt${own ? " own" : ""}"><div class="cmt-head"><b>${esc(c.name || c.person)}</b><span>${agoStr(c.at)}</span>${own ? `<button type="button" class="linkbtn" data-uncomment="${esc(c.id)}">löschen</button>` : ""}</div><p>${esc(c.text)}</p></li>`;
  }).join("")}</ul>`;
}
function commentFormHTML(f) {
  if (!GROUP.me) return `<button type="button" class="ghost" data-who-open>Namen wählen, um zu kommentieren</button>`;
  if (GROUP.status === "fehler") return `<p class="d-note">Kommentieren geht erst wieder, wenn die Bewertungen verbunden sind.</p>`;
  return `<label class="sr-only" for="cmtText">Kommentar</label>
    <textarea id="cmtText" rows="2" maxlength="500" placeholder="Kommentar schreiben …">${esc(GROUP.drafts[f.id] || "")}</textarea>
    <button type="button" class="primary" data-comment>Senden</button>`;
}
function commentsSectionHTML(f) {
  if (!GROUP.code) return "";
  const n = (GROUP.comments[f.id] || []).length;
  return `<section class="d-cmt">
    <h3>Kommentare <span id="cmtCount">${n ? `(${n})` : ""}</span></h3>
    <div id="cmtList">${commentsListHTML(f)}</div>
    <div class="cmt-form" id="cmtForm">${commentFormHTML(f)}</div>
  </section>`;
}
function sendComment() {
  const id = $("#detailBody").dataset.id;
  const ta = $("#cmtText");
  const text = (ta && ta.value || "").trim();
  if (!text) { ta && ta.focus(); return; }
  if (!GROUP.api || !GROUP.me) { toast(GROUP.error ? `Nicht gesendet. ${GROUP.error}` : "Noch keine Verbindung, bitte gleich nochmal versuchen.", "bad"); return; }
  ta.value = "";
  delete GROUP.drafts[id];
  GROUP.api.comment(id, GROUP.me.id, GROUP.me.name, text.slice(0, 500))
    .then(() => toast("Kommentar gesendet ✓"))
    .catch((e) => { GROUP.drafts[id] = text; groupFail(e); toast(`Nicht gesendet. ${GROUP.error}`, "bad"); });
}

/* ---------- Teilen über WhatsApp ---------- */
function filmLink(f) {
  const g = GROUP.code ? `?gruppe=${encodeURIComponent(GROUP.code)}` : "";
  return `${location.origin}${location.pathname}${g}#film=${encodeURIComponent(f.id)}`;
}
function waLink(text) { return `https://wa.me/?text=${encodeURIComponent(text)}`; }
function scoreLine(f) {
  const parts = [];
  if (f.imdbRating != null) parts.push(`IMDb ${deNum(f.imdbRating)}`);
  if (f.rt != null) parts.push(`🍅 ${f.rt} %`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}
function shareShow(f, s) {
  const d = s._d;
  return waLink(`🎬 *${f.title}*${scoreLine(f)}\n📅 ${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}, ${timeStr(d)}\n📍 ${s.cinema}, ${s.version}\nWer kommt mit?\n${filmLink(f)}`);
}
function shareFilm(f) {
  return waLink(`🎬 *${f.title}*${scoreLine(f)}\nWollen wir den gemeinsam anschauen?\n${filmLink(f)}`);
}

function groupSectionHTML(f) {
  if (!GROUP.code) {
    return `<section class="d-group"><h3>Gemeinsam bewerten</h3><p class="d-note">Dieses Gerät ist noch mit keiner Gruppe verbunden. Öffne euren Einladungslink oder füge ihn hier ein.</p><button type="button" class="primary" data-join-open>Einladungslink einfügen</button></section>`;
  }
  if (GROUP.status === "fehler") {
    return `<section class="d-group"><h3>Gemeinsam bewerten</h3><p class="d-note bad">🔴 Bewertungen nicht verbunden. ${esc(GROUP.error)}</p><button type="button" class="primary" data-reconnect>Neu verbinden</button></section>`;
  }
  if (!GROUP.me) {
    return `<section class="d-group"><h3>Eure Bewertungen</h3><p class="d-note">Wähle zuerst deinen Namen, dann kannst du mitbewerten.</p><button type="button" class="primary" data-who-open>Namen wählen</button></section>`;
  }
  const my = mine(f.id);
  const btns = SCALE.map(([emo, label], v) => `<button type="button" class="rate" data-vote="${v}" aria-pressed="${my.v === v}"><span class="emo" aria-hidden="true">${emo}</span><span>${label}</span></button>`).join("");
  const list = groupMembers().map((p) => {
    const e = entriesFor(f.id)[p.id] || {};
    const has = typeof e.v === "number";
    const what = `${has ? `${SCALE[e.v][0]} ${SCALE[e.v][1]}` : "noch nicht bewertet"}${e.s ? ", 👀 gesehen" : ""}`;
    return `<li><span class="who">${esc(p.name)}${p.id === GROUP.me.id ? " (du)" : ""}</span><span class="what${has || e.s ? "" : " none"}">${what}</span></li>`;
  }).join("");
  return `<section class="d-group">
    <h3>Wie gern willst du ihn sehen?</h3>
    <div class="rates" role="group" aria-label="Deine Bewertung">${btns}</div>
    <button type="button" class="seen-toggle" data-seen aria-pressed="${!!my.s}">${my.s ? "👀 Schon gesehen" : "👀 Schon gesehen? Hier abhaken"}</button>
    <ul class="group-list">${list}</ul>
  </section>`;
}
const FAIL_TEXT = {
  "permission-denied": "Zugriff verweigert: Gruppen-Code und Firestore-Regeln passen nicht zusammen.",
  "not-found": "Die Firestore-Datenbank wurde nicht gefunden.",
  "failed-precondition": "Die Firestore-Datenbank ist noch nicht fertig eingerichtet.",
  "unavailable": "Die Bewertungs-Datenbank ist nicht erreichbar. Internet prüfen; ein Werbeblocker (z. B. Brave Shields) kann die Verbindung sperren.",
  "sdk-blocked": "Firebase konnte nicht geladen werden. Ein Werbeblocker (z. B. Brave Shields) sperrt vermutlich gstatic.com.",
  "no-config": "Firebase ist in der App noch nicht eingetragen.",
  "timeout": "Keine Antwort von der Bewertungs-Datenbank. Ein Werbeblocker (z. B. Brave Shields) sperrt vermutlich die Verbindung zu Firebase.",
};
function groupFail(e) {
  const code = (e && e.code) || "";
  GROUP.status = "fehler";
  GROUP.error = FAIL_TEXT[code] || `${(e && e.message) || "Unbekannter Fehler"}${code ? ` (${code})` : ""}`;
  renderGroupInfo();
  refreshDetail();
}
let toastTimer;
function toast(msg, kind = "") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, kind === "bad" ? 6000 : 2200);
}
function setMine(filmId, patch) {
  if (!GROUP.me) { openWho(); return; }
  if (!GROUP.api) {
    toast(GROUP.error ? `Nicht gespeichert. ${GROUP.error}` : "Verbindung zur Bewertungs-Datenbank wird noch aufgebaut, bitte gleich nochmal tippen.", "bad");
    return;
  }
  const before = entriesFor(filmId)[GROUP.me.id];
  const cur = { v: null, s: false, ...mine(filmId) };
  const next = { ...cur, ...patch };
  GROUP.votes[filmId] = { ...entriesFor(filmId), [GROUP.me.id]: next };
  refreshAll();
  let done = false;
  const slow = setTimeout(() => {
    if (!done) toast("Noch nicht gespeichert: keine Antwort von der Datenbank. Ein Werbeblocker (z. B. Brave Shields) könnte Firebase sperren.", "bad");
  }, 8000);
  GROUP.api.set(filmId, GROUP.me.id, { v: next.v, s: next.s })
    .then(() => { done = true; clearTimeout(slow); toast("Gespeichert ✓"); })
    .catch((e) => {
      done = true; clearTimeout(slow);
      GROUP.votes[filmId] = { ...entriesFor(filmId), [GROUP.me.id]: before };
      if (!before) delete GROUP.votes[filmId][GROUP.me.id];
      refreshAll();
      groupFail(e);
      toast(`Nicht gespeichert. ${GROUP.error}`, "bad");
    });
}
function refreshDetail() {
  const dlg = $("#detail");
  if (!dlg || !dlg.open || !DATA) return;
  const f = DATA.films.find((x) => x.id === $("#detailBody").dataset.id);
  if (!f) return;
  const g = $("#dGroup");
  if (g) g.innerHTML = groupSectionHTML(f);
  const c = $("#dCmtWrap");
  if (!c) return;
  if (!$(".d-cmt") || !GROUP.code) { c.innerHTML = commentsSectionHTML(f); return; }
  const n = (GROUP.comments[f.id] || []).length;
  $("#cmtCount").textContent = n ? `(${n})` : "";
  $("#cmtList").innerHTML = commentsListHTML(f);
  const form = $("#cmtForm");
  if (!form.contains(document.activeElement)) form.innerHTML = commentFormHTML(f);
}
let refreshTimer;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 60); }
function refreshAll() {
  if (!DATA || !DATA.films) return;
  if (GROUP.membersChanged || GROUP.statusChanged) { GROUP.membersChanged = false; GROUP.statusChanged = false; renderFilters(); }
  renderList();
  refreshDetail();
  renderGroupInfo();
}
function renderGroupInfo() {
  const el = $("#gruppeInfo");
  if (!el) return;
  if (!GROUP.code) {
    el.innerHTML = `Gemeinsame Bewertungen: Dieses Gerät ist mit keiner Gruppe verbunden. <button type="button" class="linkbtn" data-join-open>Einladungslink einfügen</button>`;
    return;
  }
  const dot = { online: "🟢", verbinde: "🟡", fehler: "🔴" }[GROUP.status] || "⚪";
  if (GROUP.status === "fehler") {
    el.innerHTML = `${dot} Bewertungen nicht verbunden. ${esc(GROUP.error)} <button type="button" class="linkbtn" data-reconnect>Neu verbinden</button>`;
    return;
  }
  const n = groupMembers().length;
  const state = GROUP.status === "online" ? "verbunden" : "verbinde …";
  el.innerHTML = GROUP.me
    ? `${dot} Bewertungen ${state}. Du bewertest als <b>${esc(GROUP.me.name)}</b>, ${n} ${n === 1 ? "Person" : "Personen"} in der Gruppe. <button type="button" class="linkbtn" data-who-open>Name ändern</button>`
    : `${dot} Bewertungen ${state}. <button type="button" class="linkbtn" data-who-open>Namen wählen</button>, um mitzubewerten.`;
}
function openJoin() {
  $("#whoTitle").textContent = "Gruppe verbinden";
  $("#whoBody").innerHTML = `
    <p class="hint">Füge den Einladungslink eurer Gruppe ein (oder nur den Code nach "gruppe=").</p>
    <label class="who-new"><span>Einladungslink</span><input id="joinCode" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…#gruppe=…"></label>
    <button type="button" class="primary" data-join>Verbinden</button>`;
  const dlg = $("#who");
  if (!dlg.open) dlg.showModal();
}
function joinWith(text) {
  const t = (text || "").trim();
  const m = t.match(/gruppe=([A-Za-z0-9_-]{4,})/);
  const code = m ? m[1] : (/^[A-Za-z0-9_-]{4,}$/.test(t) ? t : "");
  if (!code) { toast("Das sieht nicht nach einem Einladungslink aus.", "bad"); return; }
  try { localStorage.setItem("kinosieb.gruppe", code); } catch (e) { /* egal */ }
  $("#who").close();
  location.reload();
}
function openWho() {
  if (!GROUP.code) return openJoin();
  $("#whoTitle").textContent = "Wer bist du?";
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
  GROUP.membersChanged = true;
  refreshAll();
}
// Gruppen-Code aus dem Einladungslink lesen: …/NonstopKino/?gruppe=CODE oder …/#gruppe=CODE
function codeFromUrl() {
  const m = `${location.search}&${location.hash}`.match(/gruppe=([A-Za-z0-9_-]{4,})/);
  return m ? m[1] : null;
}
function readGroupCode() {
  const c = codeFromUrl();
  if (c) {
    try { localStorage.setItem("kinosieb.gruppe", c); } catch (e) { /* egal */ }
    const params = new URLSearchParams(location.search);
    params.delete("gruppe");
    const q = params.toString();
    const keep = /^#film=/.test(location.hash) ? location.hash : "";
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + keep);
    return c;
  }
  try { return localStorage.getItem("kinosieb.gruppe"); } catch (e) { return null; }
}
// Wird der Einladungslink geöffnet, während die App schon offen ist, lädt der Browser nicht neu.
window.addEventListener("hashchange", () => {
  const fm = location.hash.match(/^#film=(.+)$/);
  if (fm && DATA && !$("#detail").open) { openDetail(decodeURIComponent(fm[1]), false); return; }
  const c = codeFromUrl();
  if (!c) return;
  try { localStorage.setItem("kinosieb.gruppe", c); } catch (e) { /* egal */ }
  location.replace(location.pathname);
});
async function connectGroup() {
  if (!GROUP.code) { renderGroupInfo(); return; }
  GROUP.me = loadMe();
  renderGroupInfo();
  try {
    const mod = await import("./gruppe.js?v=18");
    GROUP.status = "verbinde";
    renderGroupInfo();
    GROUP.api = await mod.connect({
      code: GROUP.code,
      config: window.KINOSIEB_FIREBASE,
      onMembers: (m) => { GROUP.members = m || {}; GROUP.membersChanged = true; scheduleRefresh(); },
      onVotes: (v) => { GROUP.votes = v || {}; scheduleRefresh(); },
      onComments: (list) => {
        const by = {};
        for (const c of list || []) (by[c.film] = by[c.film] || []).push(c);
        for (const k of Object.keys(by)) by[k].sort((a, b) => a.at - b.at);
        GROUP.comments = by;
        scheduleRefresh();
      },
      onOnline: () => { GROUP.status = "online"; GROUP.error = ""; GROUP.statusChanged = true; scheduleRefresh(); },
      onError: groupFail,
    });
    setTimeout(() => { if (GROUP.status === "verbinde") groupFail({ code: "timeout" }); }, 12000);
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
  if (state.rtMin && !(film.rt >= state.rtMin)) return false;
  if (GROUP.code && !votesPass(film)) return false;
  if (state.q) {
    const q = norm(state.q);
    const hay = norm([film.title, film.originalTitle, film.director].join(" "));
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Bevorzugt = 🙂 gern (2) oder 🤩 unbedingt (3)
const LIKED = 2;
function votesPass(film) {
  const e = entriesFor(film.id);
  const ids = new Set(groupMembers().map((p) => p.id));
  const people = state.people.filter((id) => ids.has(id));
  if (people.length && !people.every((id) => e[id] && typeof e[id].v === "number" && e[id].v >= LIKED)) return false;
  if (state.allWant) {
    const vs = Object.values(e).filter((x) => x && typeof x.v === "number").map((x) => x.v);
    if (vs.length < 2 || vs.some((v) => v < LIKED)) return false;
  }
  if (state.unrated && GROUP.me && typeof mine(film.id).v === "number") return false;
  return true;
}
function voteFilterCount() {
  if (!GROUP.code) return 0;
  return state.people.length + (state.allWant ? 1 : 0) + (state.unrated ? 1 : 0);
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
    state.origins.length + (state.metaMin ? 1 : 0) + (state.rtMin ? 1 : 0) + voteFilterCount();
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
    <span class="nr" aria-hidden="true">${n}</span>
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
    <span class="stub">${score}${meta}${rtBadge(f)}</span>
  </button>`;
}

function renderList() {
  const el = $("#list");
  const { rows, now } = compute();
  const totalShows = rows.reduce((n, r) => n + r.shows.length, 0);
  const ac = activeCount() + (state.q ? 1 : 0);
  const joinHint = GROUP.code ? "" : `<div class="join-hint"><p>Noch nicht mit eurer Kinogruppe verbunden. Ohne Verbindung siehst du keine Bewertungen und Kommentare.</p><button type="button" class="primary" data-join-open>Einladungslink einfügen</button></div>`;
  const summary = joinHint + `<p class="summary"><span>${rows.length} ${rows.length === 1 ? "Film" : "Filme"}, ${totalShows} Vorstellungen</span>${ac ? `<button type="button" data-reset>Filter zurücksetzen</button>` : ""}</p>`;
  if (!rows.length && voteFilterCount()) {
    el.innerHTML = `<div class="empty-state"><h2>Noch nichts Passendes</h2><p>Für diese Bewertungsfilter gibt es noch keine Treffer. Bewertet ein paar Filme mit 🙂 oder 🤩, dann tauchen sie hier auf.</p><button type="button" class="primary" data-reset>Filter zurücksetzen</button></div>`;
  } else if (!rows.length) {
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
  ["votes", "Bewertung", () => voteFilterCount()],
  ["cinemas", "Kino", () => state.cinemas.length],
  ["versions", "Fassung", () => state.versions.length],
  ["genres", "Genre", () => state.genres.length],
  ["origins", "Herkunft", () => state.origins.length],
  ["critics", "Kritik", () => (state.metaMin ? 1 : 0) + (state.rtMin ? 1 : 0)],
];
function renderChips() {
  const any = activeCount() + (state.q ? 1 : 0) > 0;
  const clear = any ? `<button type="button" class="chip clear" data-reset>✕ Filter löschen</button>` : "";
  $("#chips").innerHTML = clear + CHIP_DEFS.map(([key, label, val]) => {
    const v = val();
    const on = !!v;
    if (key === "votes" && !GROUP.code) return "";
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

  const people = GROUP.code ? groupMembers() : [];
  const votesHTML = GROUP.code ? `
  <section class="fgroup" id="f-votes"><h3>Eure Bewertungen</h3>
    <p class="hint">Bevorzugt heißt mit 🙂 gern oder 🤩 unbedingt bewertet.</p>
    <div class="vlist">
      <button type="button" class="opt" data-group="allWant" data-value="1" aria-pressed="${state.allWant}"><span>👥 Alle wollen</span><span>alle Bewertungen 🙂 oder 🤩, mind. 2</span></button>
      <button type="button" class="opt" data-group="unrated" data-value="1" aria-pressed="${state.unrated}"><span>✍️ Von mir unbewertet</span><span>zum schnellen Durchbewerten</span></button>
    </div>
    ${people.length ? `<p class="hint sub">Bevorzugt von:</p><div class="opts">
      ${people.map((p) => optBtn("people", p.id, `${p.name}${GROUP.me && p.id === GROUP.me.id ? " (du)" : ""}`, state.people.includes(p.id))).join("")}
    </div><p class="hint sub">Mehrere Personen: nur Filme, die alle Gewählten sehen wollen.</p>` : ""}
  </section>` : "";

  return `
  <section class="fgroup" id="f-when"><h3>Wann</h3><div class="opts">
    ${WHEN.map(([k, l]) => optBtn("when", k, l, state.when === k)).join("")}
  </div></section>
  ${votesHTML}
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
  <section class="fgroup" id="f-critics"><h3>Kritik</h3>
    <p class="hint">Metascore: Durchschnitt der Profi-Kritiken auf Metacritic (0 bis 100).</p>
    <div class="opts">
      ${META_STEPS.map((m) => optBtn("metaMin", m, m ? `Metascore ab ${m}` : "Alle", state.metaMin === m)).join("")}
    </div>
    <p class="hint sub">Rotten Tomatoes: Anteil positiver Profi-Kritiken (ab 60 % "fresh" 🍅).</p>
    <div class="opts">
      ${RT_STEPS.map((m) => optBtn("rtMin", m, m ? `🍅 ab ${m} %` : "Alle", state.rtMin === m)).join("")}
    </div>
  </section>`;
}

function renderFilters() {
  const html = filterHTML();
  $("#sheetBody").innerHTML = html;
  const any = activeCount() + (state.q ? 1 : 0) > 0;
  $("#side").innerHTML = (any ? `<button type="button" class="ghost side-reset" data-reset>✕ Alle Filter löschen</button>` : "") + html;
}

function toggle(group, value) {
  if (group === "when") state.when = value;
  else if (group === "metaMin") state.metaMin = Number(value);
  else if (group === "rtMin") state.rtMin = Number(value);
  else if (group === "allWant") state.allWant = !state.allWant;
  else if (group === "unrated") state.unrated = !state.unrated;
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
  state = { ...DEFAULTS, cinemas: [], versions: [], genres: [], origins: [], people: [], sort };
  $("#q").value = "";
  saveState();
  renderFilters();
  renderList();
}

/* ---------- Detail ---------- */
let detailAll = false;
function openDetail(id, push = true) {
  const f = DATA.films.find((x) => x.id === id);
  if (!f) { if (!push) history.replaceState(null, "", location.pathname + location.search); toast("Dieser Film läuft nicht mehr im Programm.", "bad"); return; }
  detailAll = false;
  renderDetail(f);
  const dlg = $("#detail");
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  if (push) history.pushState({ detail: id }, "", `#film=${encodeURIComponent(id)}`);
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
        <span class="show-links">${s.cinemaUrl ? `<a href="${esc(s.cinemaUrl)}" target="_blank" rel="noopener">Kino</a>` : ""}${s.ics ? `<a href="${esc(s.ics)}" target="_blank" rel="noopener">Kalender</a>` : ""}<a href="${esc(shareShow(f, s))}" target="_blank" rel="noopener">WhatsApp</a></span>
      </div>`).join("");
    return `<div class="day"><h4>${label}</h4>${rows}</div>`;
  }).join("");

  const scores = [];
  if (f.imdbRating != null) scores.push(`<span class="d-score"><span class="score">${deNum(f.imdbRating)}</span><span class="score-label">IMDb${f.imdbVotes ? `, ${votesStr(f.imdbVotes)}` : ""}</span></span>`);
  else scores.push(`<span class="d-score"><span class="score none">–</span><span class="score-label">noch keine IMDb-Wertung</span></span>`);
  if (f.metascore != null) scores.push(`<span class="meta ${metaClass(f.metascore)}">Metascore ${f.metascore}</span>`);
  if (f.rt != null) scores.push(rtBadge(f, true));

  const facts = [factsLine(f), f.director ? `Regie: ${f.director}` : ""].filter(Boolean).join(". ");
  const links = [
    f.trailer ? `<a class="trailer" href="${esc(f.trailer)}" target="_blank" rel="noopener">Trailer ansehen</a>` : "",
    f.imdbId ? `<a href="https://www.imdb.com/title/${esc(f.imdbId)}/" target="_blank" rel="noopener">IMDb</a>` : "",
    f.rt != null ? `<a href="https://www.rottentomatoes.com/search?search=${encodeURIComponent(f.originalTitle || f.title)}" target="_blank" rel="noopener">Rotten Tomatoes</a>` : "",
    `<a href="${esc(f.imdbId ? `https://letterboxd.com/imdb/${f.imdbId}/` : `https://letterboxd.com/search/films/${encodeURIComponent(f.originalTitle || f.title)}/`)}" target="_blank" rel="noopener">Letterboxd</a>`,
    f.nonstopUrl ? `<a href="${esc(f.nonstopUrl)}" target="_blank" rel="noopener">nonstop-Seite</a>` : "",
    `<a class="wa" href="${esc(shareFilm(f))}" target="_blank" rel="noopener">In WhatsApp teilen</a>`,
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
    <div id="dGroup">${groupSectionHTML(f)}</div>
    <div id="dCmtWrap">${commentsSectionHTML(f)}</div>
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
    if (t.hasAttribute("data-comment")) return sendComment();
    if (t.dataset.uncomment) {
      if (!GROUP.api) return;
      return GROUP.api.uncomment(t.dataset.uncomment).then(() => toast("Kommentar gelöscht")).catch((e) => { groupFail(e); toast(`Nicht gelöscht. ${GROUP.error}`, "bad"); });
    }
    if (t.hasAttribute("data-join-open")) return openJoin();
    if (t.hasAttribute("data-join")) return joinWith($("#joinCode").value);
    if (t.hasAttribute("data-reconnect")) return location.reload();
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
  document.addEventListener("input", (e) => {
    if (e.target.id === "cmtText") GROUP.drafts[$("#detailBody").dataset.id] = e.target.value;
  });
  let qTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderList(); renderFilters(); }, 120);
  });
}

function statusText() {
  const g = new Date(DATA.generated);
  if (isNaN(g)) return "";
  const now = new Date();
  return `Stand ${dayWord(g, now)}, ${timeStr(g)}`;
}

/* ---------- Aussehen ---------- */
const STILE = { karte: "#2a0c12", film: "#e7eae4", sessel: "#1c0e11", leinwand: "#13111a", popcorn: "#ffe59a" };
function currentStil() { const s = document.documentElement.dataset.stil; return STILE[s] ? s : "karte"; }
function applyStil(stil) {
  if (!STILE[stil]) stil = "karte";
  if (stil !== "karte") document.documentElement.dataset.stil = stil;
  else delete document.documentElement.dataset.stil;
  try { localStorage.setItem("kinosieb.stil", stil); } catch (e) { /* egal */ }
  document.querySelectorAll(".stilwahl button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.stil === stil)));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = STILE[stil];
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
  if (m) openDetail(decodeURIComponent(m[1]), false);
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
