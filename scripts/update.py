#!/usr/bin/env python3
"""Holt das aktuelle nonstop-Programm für Wien, ergänzt Filmdaten (TMDB, OMDb)
und schreibt data/data.json für die App.

Läuft täglich über GitHub Actions. Ohne API-Schlüssel läuft es trotzdem,
dann eben ohne Wertungen, Genres und Plakate.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEBUG = ROOT / "debug"
CACHE_FILE = DATA / "cache.json"
OUT_FILE = DATA / "data.json"
FALTER_FILE = ROOT / "falter-tipps.txt"
OVERRIDES_FILE = ROOT / "overrides.json"

BASE = "https://nonstopkino.at"
PROGRAM_URL = f"{BASE}/programm/"
TZ = ZoneInfo("Europe/Vienna")
REGION = "Wien"
REGIONS = ["Wien", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg", "Steiermark", "Tirol", "Vorarlberg", "Burgenland"]

TMDB_KEY = os.environ.get("TMDB_API_KEY", "").strip()
OMDB_KEY = os.environ.get("OMDB_API_KEY", "").strip()
DUMP = (DEBUG / "DUMP").exists() or os.environ.get("DUMP_HTML") == "1"

FACTS_MAX_AGE = timedelta(days=14)
TMDB_MAX_AGE = timedelta(days=14)
OMDB_MAX_AGE = timedelta(days=2)

UA = "Kinosieb/1.0 (privates, nicht-kommerzielles Projekt; github.com)"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "de-AT,de;q=0.9"})

VERSION_RE = re.compile(r"(?<![A-Za-zÄÖÜäöü])(Om[a-zA-Z]{0,4}U|OV|OF|DF|DtF)(?![A-Za-zÄÖÜäöü])")
DATE_RE = re.compile(r"(?<!\d)(\d{1,2})\.(\d{1,2})\.(?!\d)")
TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)")
TIP_RE = re.compile(r"\b([A-ZÄÖÜ][a-zäöüß]+s Tipp)\b")
FIXED_TAGS = ["Film der Woche", "Festival", "Open Air", "Q&A", "Retrospektive", "Preview", "Nur für Mitglieder"]

KNOWN_CINEMAS = [
    "Actors Studio", "Admiral Kino", "Bellaria Kino", "Breitenseer Lichtspiele", "Burg Kino", "Burghofkino",
    "CineCenter", "De France", "Filmcasino", "Filmhaus", "Filmmuseum", "Gartenbaukino", "Haydn Kino",
    "Kino wie noch nie", "Metro Kinokulturhaus", "Schikaneder", "Stadtkino Wien", "Top Kino",
    "URANIA CEE🧡NEMA", "Votiv Kino",
]

COUNTRY_DE = {
    "US": "USA", "AT": "Österreich", "DE": "Deutschland", "CH": "Schweiz", "FR": "Frankreich", "IT": "Italien",
    "ES": "Spanien", "PT": "Portugal", "GB": "Großbritannien", "IE": "Irland", "BE": "Belgien", "NL": "Niederlande",
    "LU": "Luxemburg", "DK": "Dänemark", "SE": "Schweden", "NO": "Norwegen", "FI": "Finnland", "IS": "Island",
    "PL": "Polen", "CZ": "Tschechien", "SK": "Slowakei", "HU": "Ungarn", "SI": "Slowenien", "HR": "Kroatien",
    "RS": "Serbien", "BA": "Bosnien", "RO": "Rumänien", "BG": "Bulgarien", "GR": "Griechenland", "TR": "Türkei",
    "UA": "Ukraine", "RU": "Russland", "GE": "Georgien", "AM": "Armenien", "LT": "Litauen", "LV": "Lettland",
    "EE": "Estland", "IL": "Israel", "PS": "Palästina", "LB": "Libanon", "IR": "Iran", "IN": "Indien",
    "CN": "China", "HK": "Hongkong", "TW": "Taiwan", "JP": "Japan", "KR": "Südkorea", "TH": "Thailand",
    "PH": "Philippinen", "VN": "Vietnam", "ID": "Indonesien", "AU": "Australien", "NZ": "Neuseeland",
    "CA": "Kanada", "MX": "Mexiko", "BR": "Brasilien", "AR": "Argentinien", "CL": "Chile", "CO": "Kolumbien",
    "PE": "Peru", "CU": "Kuba", "EG": "Ägypten", "MA": "Marokko", "TN": "Tunesien", "DZ": "Algerien",
    "SN": "Senegal", "NG": "Nigeria", "ZA": "Südafrika", "KE": "Kenia", "ET": "Äthiopien", "SA": "Saudi-Arabien",
    "JO": "Jordanien", "QA": "Katar", "AE": "VAE", "MK": "Nordmazedonien", "XK": "Kosovo", "AL": "Albanien",
    "ME": "Montenegro", "CY": "Zypern", "MT": "Malta", "KZ": "Kasachstan", "MN": "Mongolei",
}


def log(*a):
    print(*a, flush=True)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def sim(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def now_vienna() -> datetime:
    return datetime.now(TZ)


def iso_now() -> str:
    return now_vienna().isoformat(timespec="seconds")


def is_fresh(stamp: str | None, max_age: timedelta) -> bool:
    if not stamp:
        return False
    try:
        return now_vienna() - datetime.fromisoformat(stamp) < max_age
    except Exception:
        return False


def get(url: str, **kw) -> requests.Response:
    for attempt in range(3):
        try:
            r = S.get(url, timeout=30, **kw)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt == 2:
                raise
            log(f"  Wiederhole {url}: {e}")
            time.sleep(3)
    raise RuntimeError(url)


def dump(name: str, text: str):
    if DUMP:
        DEBUG.mkdir(exist_ok=True)
        (DEBUG / name).write_text(text, encoding="utf-8")


# ---------------------------------------------------------------- nonstop

def movie_slug(href: str) -> str | None:
    m = re.search(r"/movies/([^/?#]+)/?", href or "")
    return m.group(1) if m else None


def cinema_names(soup: BeautifulSoup) -> list[str]:
    names = set(KNOWN_CINEMAS)
    for opt in soup.find_all("option"):
        t = opt.get_text(" ", strip=True)
        if t and not t.lower().startswith("alle") and t not in REGIONS and len(t) < 60:
            names.add(t)
    return sorted(names, key=len, reverse=True)


def find_cinema(text: str, names: list[str]) -> str | None:
    for n in names:  # längste zuerst
        if n in text:
            return n
    return None


def infer_date(day: int, month: int, hh: int, mm: int) -> datetime:
    today = now_vienna()
    year = today.year
    cand = datetime(year, month, day, hh, mm, tzinfo=TZ)
    if cand < today - timedelta(days=60):
        cand = cand.replace(year=year + 1)
    elif cand > today + timedelta(days=300):
        cand = cand.replace(year=year - 1)
    return cand


def parse_card_text(text: str, names: list[str]) -> dict | None:
    text = re.sub(r"\s+", " ", text).strip()
    d = DATE_RE.search(text)
    t = TIME_RE.search(text, d.end() if d else 0) or TIME_RE.search(text)
    cinema = find_cinema(text, names)
    if not (d and t and cinema):
        return None
    region = None
    m = re.search(re.escape(cinema) + r"\s+(" + "|".join(REGIONS) + r")\b", text)
    if m:
        region = m.group(1)
    else:
        for r in REGIONS:
            if re.search(rf"\b{r}\b", text.replace(cinema, " ")):
                region = r
                break
    v = VERSION_RE.findall(text.replace(cinema, " "))
    tags = list(dict.fromkeys(TIP_RE.findall(text) + [tg for tg in FIXED_TAGS if tg in text]))
    dt = infer_date(int(d.group(1)), int(d.group(2)), int(t.group(1)), int(t.group(2)))
    return {
        "dt": dt.strftime("%Y-%m-%dT%H:%M"),
        "cinema": cinema,
        "region": region,
        "version": v[-1] if v else "",
        "tags": tags,
    }


def climb_to_card(el, stop_pred, max_up=8):
    """Vom Element nach oben, bis der Text Datum und Uhrzeit enthält."""
    cur = el
    for _ in range(max_up):
        if cur is None:
            return None
        txt = cur.get_text(" ", strip=True)
        if stop_pred(txt):
            return cur
        cur = cur.parent
    return None


def has_datetime(txt: str) -> bool:
    return bool(DATE_RE.search(txt) and TIME_RE.search(txt))


def count_dates(txt: str) -> int:
    return len(DATE_RE.findall(txt))


def parse_program(html: str) -> tuple[list[dict], list[str]]:
    soup = BeautifulSoup(html, "lxml")
    names = cinema_names(soup)
    seen = set()
    shows = []
    for a in soup.find_all("a", href=True):
        slug = movie_slug(a["href"])
        if not slug:
            continue
        card = climb_to_card(a, has_datetime)
        if card is None or id(card) in seen:
            continue
        txt = card.get_text(" ", strip=True)
        if count_dates(txt) > 2:  # zu weit nach oben geklettert
            continue
        seen.add(id(card))
        info = parse_card_text(txt, names)
        if not info:
            continue
        info["slug"] = slug
        info["href"] = urljoin(BASE, a["href"].split("?")[0])
        title_el = card.find(["h2", "h3", "h4", "h5"]) or a
        info["title"] = title_el.get_text(" ", strip=True)
        ics = card.find("a", href=re.compile(r"feed/calendar"))
        site = card.find("a", string=re.compile(r"Website", re.I))
        info["ics"] = urljoin(BASE, ics["href"]) if ics else ""
        info["cinemaUrl"] = site["href"] if site else ""
        shows.append(info)
    return shows, names


def parse_movie_page(html: str, names: list[str]) -> dict:
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    title = h1.get_text(" ", strip=True) if h1 else ""
    full = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    facts = {"title": title}
    m = re.search(r"\bJahr\s+(\d{4})\b", full)
    facts["year"] = int(m.group(1)) if m else None
    m = re.search(r"\bDauer\s+(\d{2,3})\s*min", full)
    facts["runtime"] = int(m.group(1)) if m else None
    m = re.search(r"\bVon\s+(.+?)\s+(?:Mit|Jahr|Dauer|Sprache)\b", full)
    facts["director"] = m.group(1).strip() if m and len(m.group(1)) < 120 else ""
    m = re.search(r"\bSprache\s+([A-ZÄÖÜ][\wäöüß/,\s-]{1,40}?)(?=\s+[A-ZÄÖÜ][a-zäöü]+\s|\s*$)", full)
    facts["language"] = m.group(1).strip() if m else ""
    desc = ""
    for p in soup.find_all("p"):
        t = p.get_text(" ", strip=True)
        if len(t) > len(desc) and len(t) > 120 and "Barrierefreiheit" not in t and "Cookies" not in t:
            desc = t
    facts["description"] = desc
    # Kino-Websites und Kalenderlinks der einzelnen Vorstellungen
    sites, ics = {}, {}
    for a in soup.find_all("a", href=re.compile(r"feed/calendar")):
        card = climb_to_card(a, has_datetime)
        if card is None:
            continue
        txt = card.get_text(" ", strip=True)
        if count_dates(txt) > 2:
            continue
        info = parse_card_text(txt, names)
        if not info:
            continue
        ics[f'{info["dt"]}|{info["cinema"]}'] = urljoin(BASE, a["href"])
        site = card.find("a", string=re.compile(r"Website", re.I))
        if site and info["cinema"] not in sites:
            sites[info["cinema"]] = site["href"]
    facts["sites"] = sites
    facts["ics"] = ics
    return facts


# ---------------------------------------------------------------- TMDB / OMDb

def tmdb(path: str, **params) -> dict:
    headers = {}
    if TMDB_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {TMDB_KEY}"
    else:
        params["api_key"] = TMDB_KEY
    r = get(f"https://api.themoviedb.org/3{path}", params=params, headers=headers)
    return r.json()


def title_variants(title: str) -> list[str]:
    out = [title]
    inner = re.findall(r"\(([^)]+)\)", title)
    base = re.sub(r"\s*\([^)]*\)", "", title).strip()
    base = re.sub(r"\s*[–-]\s*(Director.?s Cut|Extended Version|4K.*|Restaur.*)$", "", base, flags=re.I).strip()
    base = re.sub(r"^.+?[’']s\s+", "", base) if re.match(r"^[A-Z][\w.]+ [A-Z][\w.]+[’']s ", base) else base
    for v in [base, *inner]:
        v = v.strip()
        if v and not re.search(r"restaur|director|extended|fassung|4k", v, re.I) and v not in out:
            out.append(v)
    return out


def director_match(nonstop_dir: str, credits: dict) -> bool | None:
    if not nonstop_dir:
        return None
    ours = {norm(x).split(" ")[-1] for x in re.split(r",| und | & ", nonstop_dir) if norm(x)}
    theirs = {norm(c.get("name", "")).split(" ")[-1] for c in credits.get("crew", []) if c.get("job") == "Director"}
    if not theirs:
        return None
    return bool(ours & theirs)


def tmdb_details(tid: int) -> dict:
    return tmdb(f"/movie/{tid}", language="de-DE", append_to_response="credits,external_ids,videos",
                include_video_language="de,en,null")


def tmdb_match(facts: dict, title: str) -> tuple[int | None, dict | None]:
    year = facts.get("year")
    cands = {}
    for q in title_variants(title):
        for yr in ([year, None] if year else [None]):
            params = {"query": q, "language": "de-DE", "include_adult": "false"}
            if yr:
                params["year"] = yr
            try:
                res = tmdb("/search/movie", **params).get("results", [])[:8]
            except Exception as e:
                log(f"  TMDB-Suche fehlgeschlagen ({q}): {e}")
                continue
            for r in res:
                ry = int(r["release_date"][:4]) if r.get("release_date") else None
                s = max(sim(q, r.get("title", "")), sim(q, r.get("original_title", "")))
                score = s
                if year and ry:
                    dy = abs(year - ry)
                    score += 0.35 if dy == 0 else 0.2 if dy == 1 else -0.4 if dy > 2 else 0
                score += min(r.get("popularity", 0), 50) / 500
                if r["id"] not in cands or cands[r["id"]][0] < score:
                    cands[r["id"]] = (score, s)
            if cands and max(c[0] for c in cands.values()) > 1.3:
                break
    ranked = sorted(cands.items(), key=lambda kv: kv[1][0], reverse=True)[:3]
    best = None
    for tid, (score, s) in ranked:
        if s < 0.55:
            continue
        try:
            det = tmdb_details(tid)
        except Exception as e:
            log(f"  TMDB-Details fehlgeschlagen ({tid}): {e}")
            continue
        dm = director_match(facts.get("director", ""), det.get("credits", {}))
        total = score + (0.5 if dm else -0.6 if dm is False else 0)
        if best is None or total > best[0]:
            best = (total, tid, det)
        if dm:
            break
    if best and best[0] >= 0.9:
        return best[1], best[2]
    return None, None


def pick_trailer(det: dict) -> str:
    vids = [v for v in det.get("videos", {}).get("results", []) if v.get("site") == "YouTube" and v.get("type") in ("Trailer", "Teaser")]
    def rank(v):
        return (v.get("iso_639_1") == "de", v.get("type") == "Trailer", bool(v.get("official")))
    vids.sort(key=rank, reverse=True)
    return f"https://www.youtube.com/watch?v={vids[0]['key']}" if vids else ""


def origin_of(det: dict) -> tuple[str, list[str]]:
    prod = [c.get("iso_3166_1") for c in det.get("production_countries", []) if c.get("iso_3166_1")]
    orig = det.get("origin_country") or []
    countries = list(dict.fromkeys(orig + prod))
    if "AT" in orig or ("AT" in prod and det.get("original_language") == "de"):
        o = "at"
    elif "US" in orig or (prod[:1] == ["US"]):
        o = "us"
    elif not countries:
        o = ""
    else:
        o = "intl"
    return o, countries


def omdb(imdb_id: str) -> dict:
    r = get("https://www.omdbapi.com/", params={"apikey": OMDB_KEY, "i": imdb_id})
    j = r.json()
    if j.get("Response") == "False":
        raise RuntimeError(j.get("Error", "OMDb-Fehler"))
    def num(x, f=float):
        try:
            return f(str(x).replace(",", ""))
        except Exception:
            return None
    return {
        "imdbRating": num(j.get("imdbRating")),
        "imdbVotes": num(j.get("imdbVotes"), int),
        "metascore": num(j.get("Metascore"), int),
    }


# ---------------------------------------------------------------- Falter

def falter_titles() -> list[str]:
    if not FALTER_FILE.exists():
        return []
    out = []
    for line in FALTER_FILE.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def is_falter(film: dict, tips: list[str]) -> bool:
    names = [film.get("title", ""), film.get("originalTitle", "")]
    for tip in tips:
        nt = norm(tip)
        for n in names:
            nn = norm(n)
            if not nn or not nt:
                continue
            if nn == nt or sim(nn, nt) >= 0.88:
                return True
            if len(nt) >= 5 and (nt in nn or nn in nt):
                return True
    return False


# ---------------------------------------------------------------- Hauptablauf

def main() -> int:
    DATA.mkdir(exist_ok=True)
    cache = load_json(CACHE_FILE, {"films": {}})
    films_cache: dict = cache.setdefault("films", {})
    overrides = load_json(OVERRIDES_FILE, {})

    log("Lade Programm …")
    html = get(PROGRAM_URL).text
    dump("programm.html", html)
    shows, names = parse_program(html)
    log(f"  {len(shows)} Vorstellungen erkannt (alle Regionen)")
    vienna = [s for s in shows if s.get("region") == REGION]
    log(f"  davon {len(vienna)} in {REGION}")
    if not vienna:
        log("FEHLER: keine Wiener Vorstellungen erkannt, Seitenaufbau prüfen. data.json bleibt unverändert.")
        return 1

    by_slug: dict[str, dict] = {}
    for s in vienna:
        f = by_slug.setdefault(s["slug"], {"slug": s["slug"], "href": s["href"], "title": s["title"], "screenings": []})
        key = (s["dt"], s["cinema"], s["version"])
        if key not in {(x["dt"], x["cinema"], x["version"]) for x in f["screenings"]}:
            f["screenings"].append(s)
    log(f"  {len(by_slug)} verschiedene Filme in {REGION}")

    tips = falter_titles()
    out_films = []
    cinema_sites: dict[str, str] = cache.setdefault("cinemaSites", {})
    dumped_movie = False

    for slug, f in sorted(by_slug.items()):
        c = films_cache.setdefault(slug, {})
        ov = overrides.get(slug, {})

        # nonstop-Filmseite (Jahr, Regie, Beschreibung) – nur gelegentlich neu laden
        if not is_fresh(c.get("factsAt"), FACTS_MAX_AGE) or not c.get("facts"):
            try:
                page = get(f["href"]).text
                if not dumped_movie:
                    dump("film.html", page)
                    dumped_movie = True
                facts = parse_movie_page(page, names)
                c["facts"] = {k: v for k, v in facts.items() if k not in ("sites", "ics")}
                c["ics"] = facts["ics"]
                c["factsAt"] = iso_now()
                cinema_sites.update({k: v for k, v in facts["sites"].items() if k not in cinema_sites})
                time.sleep(1.0)
            except Exception as e:
                log(f"  Filmseite {slug} nicht geladen: {e}")
        facts = c.get("facts", {})
        title = facts.get("title") or f["title"] or slug

        # TMDB
        if TMDB_KEY and not ov.get("skip"):
            want = ov.get("tmdb")
            if want and c.get("tmdbId") != want:
                c.pop("tmdbAt", None)
            if not is_fresh(c.get("tmdbAt"), TMDB_MAX_AGE):
                try:
                    if want:
                        tid, det = want, tmdb_details(want)
                    elif c.get("tmdbId"):
                        tid, det = c["tmdbId"], tmdb_details(c["tmdbId"])
                    else:
                        tid, det = tmdb_match(facts, title)
                    if tid and det:
                        origin, countries = origin_of(det)
                        c["tmdbId"] = tid
                        c["tmdb"] = {
                            "originalTitle": det.get("original_title", ""),
                            "overview": det.get("overview", ""),
                            "genres": [g["name"] for g in det.get("genres", [])],
                            "runtime": det.get("runtime"),
                            "year": int(det["release_date"][:4]) if det.get("release_date") else None,
                            "poster": det.get("poster_path") or "",
                            "imdbId": (det.get("external_ids") or {}).get("imdb_id") or det.get("imdb_id") or "",
                            "trailer": pick_trailer(det),
                            "origin": origin,
                            "countries": countries,
                        }
                        log(f"  TMDB ok: {title} → {det.get('title')} ({c['tmdb']['year']})")
                    else:
                        log(f"  TMDB kein Treffer: {title}")
                    c["tmdbAt"] = iso_now()
                    time.sleep(0.25)
                except Exception as e:
                    log(f"  TMDB-Fehler {title}: {e}")
        tm = c.get("tmdb") or {}
        if ov.get("skip"):
            tm = {}

        # OMDb (IMDb-Wertung, Metascore)
        imdb_id = ov.get("imdb") or tm.get("imdbId")
        if OMDB_KEY and imdb_id and not is_fresh(c.get("omdbAt"), OMDB_MAX_AGE):
            try:
                c["omdb"] = omdb(imdb_id)
                c["omdbAt"] = iso_now()
                time.sleep(0.2)
            except Exception as e:
                log(f"  OMDb-Fehler {title}: {e}")
        om = (c.get("omdb") or {}) if imdb_id else {}

        screenings = []
        for s in sorted(f["screenings"], key=lambda x: x["dt"]):
            screenings.append({
                "dt": s["dt"],
                "cinema": s["cinema"],
                "version": s["version"],
                "tags": s["tags"],
                "cinemaUrl": s.get("cinemaUrl") or cinema_sites.get(s["cinema"], ""),
                "ics": s.get("ics") or (c.get("ics") or {}).get(f'{s["dt"]}|{s["cinema"]}', ""),
            })

        overview = tm.get("overview") or ""
        if not overview and facts.get("description"):
            d = facts["description"]
            overview = d if len(d) <= 420 else d[:400].rsplit(" ", 1)[0] + " …"
        film = {
            "id": slug,
            "title": title,
            "originalTitle": tm.get("originalTitle", ""),
            "year": facts.get("year") or tm.get("year"),
            "runtime": facts.get("runtime") or tm.get("runtime"),
            "director": facts.get("director", ""),
            "genres": tm.get("genres", []),
            "origin": tm.get("origin", ""),
            "countryNames": [COUNTRY_DE.get(x, x) for x in tm.get("countries", [])],
            "imdbId": imdb_id or "",
            "imdbRating": om.get("imdbRating"),
            "imdbVotes": om.get("imdbVotes"),
            "metascore": om.get("metascore"),
            "overview": overview,
            "poster": f"https://image.tmdb.org/t/p/{{size}}{tm['poster']}" if tm.get("poster") else "",
            "trailer": tm.get("trailer", ""),
            "nonstopUrl": f["href"],
            "screenings": screenings,
        }
        film["falter"] = is_falter(film, tips)
        out_films.append(film)

    # alte Cache-Einträge (länger als 60 Tage nicht im Programm) aufräumen
    for slug, c in list(films_cache.items()):
        if slug in by_slug:
            c["seenAt"] = iso_now()
        elif not is_fresh(c.get("seenAt"), timedelta(days=60)):
            del films_cache[slug]

    out = {"generated": iso_now(), "region": REGION, "source": PROGRAM_URL, "films": out_films}
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")

    rated = sum(1 for x in out_films if x["imdbRating"] is not None)
    matched = sum(1 for x in out_films if x["genres"])
    log(f"Fertig: {len(out_films)} Filme, {sum(len(x['screenings']) for x in out_films)} Vorstellungen, "
        f"{matched} mit TMDB-Daten, {rated} mit IMDb-Wertung, {sum(x['falter'] for x in out_films)} Falter-Tipps.")
    if not TMDB_KEY:
        log("Hinweis: TMDB_API_KEY fehlt, Filme ohne Genre/Plakat/Herkunft.")
    if not OMDB_KEY:
        log("Hinweis: OMDB_API_KEY fehlt, Filme ohne IMDb-Wertung/Metascore.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
