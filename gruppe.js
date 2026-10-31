// Gemeinsame Bewertungen der Gruppe über Firebase Firestore.
// Wird von app.js nur geladen, wenn ein Gruppen-Code vorhanden ist.
// Datenmodell:
//   gruppen/{code}/mitglieder/{personId}  -> { name, seit }
//   gruppen/{code}/stimmen/{filmId}       -> { [personId]: { v: 0..3 | null, s: true|false } }

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

export async function connect({ code, config, onMembers, onVotes, onError }) {
  if (code === "test") return localBackend({ onMembers, onVotes });
  if (!config || !config.projectId) throw new Error("Firebase ist noch nicht eingerichtet.");

  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const fs = await import(`${SDK}/firebase-firestore.js`);
  const app = initializeApp(config);
  const db = fs.getFirestore(app);

  const fail = (err) => onError && onError(err);
  fs.onSnapshot(fs.collection(db, "gruppen", code, "mitglieder"), (snap) => {
    const m = {};
    snap.forEach((d) => { m[d.id] = d.data(); });
    onMembers(m);
  }, fail);
  fs.onSnapshot(fs.collection(db, "gruppen", code, "stimmen"), (snap) => {
    const v = {};
    snap.forEach((d) => { v[d.id] = d.data(); });
    onVotes(v);
  }, fail);

  return {
    join: (id, name) => fs.setDoc(fs.doc(db, "gruppen", code, "mitglieder", id), { name, seit: fs.serverTimestamp() }, { merge: true }),
    set: (filmId, id, entry) => fs.setDoc(fs.doc(db, "gruppen", code, "stimmen", filmId), { [id]: entry }, { merge: true }),
  };
}

// Nur zum Ausprobieren ohne Firebase (Einladungslink mit #gruppe=test): speichert im Browser.
function localBackend({ onMembers, onVotes }) {
  const KEY = "kinosieb.testgruppe";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { m: {}, v: {} }; } catch (e) { return { m: {}, v: {} }; } };
  const write = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* egal */ } };
  const emit = () => { const db = read(); onMembers(db.m); onVotes(db.v); };
  setTimeout(emit, 0);
  return {
    join: async (id, name) => { const db = read(); db.m[id] = { ...(db.m[id] || {}), name }; write(db); emit(); },
    set: async (filmId, id, entry) => {
      const db = read();
      db.v[filmId] = db.v[filmId] || {};
      db.v[filmId][id] = { ...(db.v[filmId][id] || {}), ...entry };
      write(db); emit();
    },
  };
}
