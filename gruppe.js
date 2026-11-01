// Gemeinsame Bewertungen der Gruppe über Firebase Firestore.
// Wird von app.js nur geladen, wenn ein Gruppen-Code vorhanden ist.
// Datenmodell:
//   gruppen/{code}/mitglieder/{personId}  -> { name, seit }
//   gruppen/{code}/stimmen/{filmId}       -> { [personId]: { v: 0..3 | null, s: true|false } }
//   gruppen/{code}/kommentare/{autoId}    -> { film, person, name, text, at }

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

export async function connect({ code, config, onMembers, onVotes, onComments, onOnline, onError }) {
  if (code === "test") return localBackend({ onMembers, onVotes, onComments, onOnline });
  if (!config || !config.projectId) throw Object.assign(new Error("Firebase ist noch nicht eingerichtet."), { code: "no-config" });

  let appMod, fs;
  try {
    appMod = await import(`${SDK}/firebase-app.js`);
    fs = await import(`${SDK}/firebase-firestore.js`);
  } catch (e) {
    throw Object.assign(new Error("Firebase-Bibliothek konnte nicht geladen werden."), { code: "sdk-blocked" });
  }
  const app = appMod.initializeApp(config);
  const db = fs.getFirestore(app);

  // "online" erst melden, wenn wirklich Daten vom Server kamen (nicht nur aus dem Zwischenspeicher)
  let online = false;
  const mark = (snap) => {
    if (!online && !snap.metadata.fromCache) { online = true; onOnline && onOnline(); }
  };
  const fail = (err) => onError && onError(err);
  const opts = { includeMetadataChanges: true };

  fs.onSnapshot(fs.collection(db, "gruppen", code, "mitglieder"), opts, (snap) => {
    mark(snap);
    const m = {};
    snap.forEach((d) => { m[d.id] = d.data(); });
    onMembers(m);
  }, fail);
  fs.onSnapshot(fs.collection(db, "gruppen", code, "stimmen"), opts, (snap) => {
    mark(snap);
    const v = {};
    snap.forEach((d) => { v[d.id] = d.data(); });
    onVotes(v);
  }, fail);

  fs.onSnapshot(fs.collection(db, "gruppen", code, "kommentare"), (snap) => {
    const list = [];
    snap.forEach((d) => {
      const x = d.data({ serverTimestamps: "estimate" });
      list.push({ id: d.id, film: x.film, person: x.person, name: x.name, text: x.text, at: x.at && x.at.toMillis ? x.at.toMillis() : Date.now() });
    });
    onComments && onComments(list);
  }, fail);

  return {
    join: (id, name) => fs.setDoc(fs.doc(db, "gruppen", code, "mitglieder", id), { name, seit: fs.serverTimestamp() }, { merge: true }),
    set: (filmId, id, entry) => fs.setDoc(fs.doc(db, "gruppen", code, "stimmen", filmId), { [id]: entry }, { merge: true }),
    comment: (film, person, name, text) => fs.addDoc(fs.collection(db, "gruppen", code, "kommentare"), { film, person, name, text, at: fs.serverTimestamp() }),
    uncomment: (id) => fs.deleteDoc(fs.doc(db, "gruppen", code, "kommentare", id)),
  };
}

// Nur zum Ausprobieren ohne Firebase (Einladungslink mit #gruppe=test): speichert im Browser.
function localBackend({ onMembers, onVotes, onComments, onOnline }) {
  const KEY = "kinosieb.testgruppe";
  const read = () => { try { return { m: {}, v: {}, c: [], ...JSON.parse(localStorage.getItem(KEY)) }; } catch (e) { return { m: {}, v: {}, c: [] }; } };
  const write = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* egal */ } };
  const emit = () => { const db = read(); onMembers(db.m); onVotes(db.v); onComments && onComments(db.c); };
  setTimeout(() => { emit(); onOnline && onOnline(); }, 0);
  return {
    join: async (id, name) => { const db = read(); db.m[id] = { ...(db.m[id] || {}), name }; write(db); emit(); },
    set: async (filmId, id, entry) => {
      const db = read();
      db.v[filmId] = db.v[filmId] || {};
      db.v[filmId][id] = { ...(db.v[filmId][id] || {}), ...entry };
      write(db); emit();
    },
    comment: async (film, person, name, text) => {
      const db = read();
      db.c.push({ id: `c${Date.now()}`, film, person, name, text, at: Date.now() });
      write(db); emit();
    },
    uncomment: async (id) => { const db = read(); db.c = db.c.filter((x) => x.id !== id); write(db); emit(); },
  };
}
