// Offline-Speicher: App-Gerüst aus dem Cache, Programmdaten immer zuerst frisch aus dem Netz.
const SHELL = "kinosieb-shell-v6";
const IMG = "kinosieb-img-v1";
const SHELL_FILES = ["./", "index.html", "app.css?v=8", "stil-film.css?v=8", "app.js?v=8", "firebase-config.js?v=8", "gruppe.js?v=8", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, IMG].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Programmdaten: Netz zuerst, bei Funkloch die letzte Fassung
  if (url.pathname.endsWith("/data/data.json")) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Plakate: aus dem Cache, sonst laden und merken
  if (url.hostname === "image.tmdb.org") {
    e.respondWith(
      caches.open(IMG).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { c.put(req, res.clone()); return res; })))
    );
    return;
  }

  // App-Gerüst: Netz zuerst und am Server nachfragen (damit Updates sofort ankommen), offline aus dem Cache
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
