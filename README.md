# Kinosieb

Private Web-App für vier Leute mit nonstop-Kinoabo: das aktuelle Programm der Wiener Abo-Kinos, sortierbar nach IMDb-Wertung und Metascore, filterbar nach Tag, Kino, Fassung, Genre, Herkunft und Kritik.

## So funktioniert das Update

Jeden Tag in der Früh läuft auf GitHub das Skript `scripts/update.py` (Einstellung in `.github/workflows/update.yml`):

1. Es liest das Programm auf nonstopkino.at und behält die Wiener Vorstellungen.
2. Es ergänzt pro Film Plakat, Genre, Herkunftsland und Trailer von TMDB sowie IMDb-Wertung und Metascore von OMDb.
3. Es markiert Filme aus `falter-tipps.txt` als Falter-Tipp.
4. Es speichert alles in `data/data.json`, die App lädt diese Datei.

Von Hand starten: Reiter **Actions** → "Programm aktualisieren" → **Run workflow**.

## Pflege

- **Falter-Tipps:** `falter-tipps.txt` auf GitHub öffnen, Stift-Symbol, pro Zeile ein Titel aus dem Falter-Kino-Newsletter, speichern. Das Update startet dann von selbst.
- **Falsche Filmzuordnung:** In `overrides.json` den richtigen TMDB-Film eintragen (Erklärung steht in der Datei).

## Einrichtung (einmalig)

- Repository-Secrets `TMDB_API_KEY` und `OMDB_API_KEY` unter Settings → Secrets and variables → Actions.
- Settings → Pages → "Deploy from a branch" → Branch `main`, Ordner `/ (root)`.

Datenquellen: Programm von nonstopkino.at, Filmdaten von [TMDB](https://www.themoviedb.org/) (dieses Projekt nutzt die TMDB-API, ist aber nicht von TMDB unterstützt oder zertifiziert) und [OMDb](https://www.omdbapi.com/). Schriften Barlow und Big Shoulders Display unter SIL Open Font License. Kein Bezug zu nonstop, Angaben ohne Gewähr.
