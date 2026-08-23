#!/usr/bin/env python3
"""Standalone clip miner — no Supabase, no server, no cost.

Usage:
    pip install yt-dlp bgutil-ytdlp-pot-provider
    python3 scripts/mine-clips-standalone.py [--channels channels.json] [--out hits.csv]
    MAX_VIDEOS=12 SLEEP=8 python3 scripts/mine-clips-standalone.py

The PO-token provider plugin is what lets caption downloads work from
datacenter/cloud IPs; from a home connection plain yt-dlp usually suffices.
Subtitles are cached under ./subs/ so re-runs are incremental. Channels and
terms can be overridden with JSON files of the same shape as the built-in
defaults (--channels expects [[name, dialect, url], ...]; --terms expects
{concept: {dialect_or_*: [forms...]}}).

For each channel: enumerate recent videos (yt-dlp), fetch the Arabic caption
track (manual preferred, auto fallback; PO-token plugin handles datacenter-IP
blocks), then search every caption line for the target words per dialect and
score lines with the same marker logic as the app's dialectMarkers.ts.

Output: hits.csv — one row per (word, clip candidate) with the YouTube URL at
the timestamp, ready for a human to eyeball and use.

Arabic normalization kept in parity with supabase/functions/_shared/
msaLeakDetector.ts (same as scripts/derive-yemeni-artifacts.py).
"""
import csv, json, os, re, subprocess, sys, time
from pathlib import Path

import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--channels", help="JSON file: [[name, dialect, url], ...]")
ap.add_argument("--terms", help="JSON file: {concept: {dialect_or_*: [forms]}}")
ap.add_argument("--out", default="hits.csv")
ARGS = ap.parse_args()

WORK = Path.cwd()
SUBS = WORK / "subs"
SUBS.mkdir(exist_ok=True)
OUT = Path(ARGS.out)
LOG = lambda *a: print(*a, flush=True)

# ---------------- channels ----------------
# (name, dialect, url) — url is a channel /videos tab or a resolvable handle.
CHANNELS = [
    ("Easy Arabic", "Egyptian", "https://www.youtube.com/@EasyArabicVideos/videos"),
    ("Egyptoon", "Egyptian", "https://www.youtube.com/@egyptoon/videos"),
    ("Kareem Elsayed", "Egyptian", "https://www.youtube.com/@kareemelsayedvlogs/videos"),
    ("AlRamsa Institute", "Gulf", "https://www.youtube.com/channel/UCZppcNmTZmr_fLeXdQ5d1Gw/videos"),
    ("Khambalah", "Gulf", "https://www.youtube.com/@khambalah/videos"),
    ("Moshaya Family", "Gulf", "https://www.youtube.com/channel/UCPOw2O3_uZ1doro9iR4x6vw/videos"),
    ("Fatma Abu Haty", "Egyptian", "https://www.youtube.com/channel/UCyUnkCOIbi-7MImxJcOu3Lg/videos"),
    ("Mustafa Al-Mawmari", "Yemeni", "https://www.youtube.com/channel/UC3TZenznQs5XS9uMFGzVe2Q/videos"),
    ("Mister Momen", "Yemeni", "https://www.youtube.com/channel/UCr-YrZ0xeAK8leSL0XKWYGA/videos"),
    ("Khobz Yabis", "Yemeni", "https://www.youtube.com/channel/UCbJFy7MAlxIh68W1poiS5Ww/videos"),
]

if ARGS.channels:
    CHANNELS = [tuple(row) for row in json.load(open(ARGS.channels))]

MAX_VIDEOS = int(os.environ.get("MAX_VIDEOS", "10"))
MIN_S, MAX_S = 45, 1200
SLEEP = float(os.environ.get("SLEEP", "8"))

# ---------------- target words ----------------
# concept -> dialect -> surface forms INCLUDING definite/clitic variants.
# AI-drafted; every hit gets human eyes on the actual video, so a wrong form
# costs a bad row, never a bad lesson.
TERMS = {
    "dog":       {"*": ["كلب", "الكلب", "كلاب"]},
    "cat":       {"*": ["قطه", "قط", "القطه", "بسه"]},
    "water":     {"Gulf": ["مويه", "الموية", "مويا"], "Egyptian": ["ميه", "المياه", "مية"], "Yemeni": ["مويه", "ماء", "الماء"]},
    "bread":     {"*": ["خبز", "الخبز", "عيش", "العيش"]},
    "coffee":    {"*": ["قهوه", "القهوه"]},
    "tea":       {"*": ["شاي", "الشاي", "شاهي"]},
    "milk":      {"*": ["حليب", "الحليب", "لبن", "اللبن"]},
    "house":     {"*": ["بيت", "البيت"]},
    "car":       {"Gulf": ["سياره", "السياره"], "Egyptian": ["عربيه", "العربيه", "سياره"], "Yemeni": ["سياره", "السياره"]},
    "food_eat":  {"*": ["اكل", "الاكل", "ناكل", "كليت"]},
    "want":      {"Gulf": ["ابغى", "ابي", "يبي", "تبي", "ابغا"], "Egyptian": ["عايز", "عاوز", "عايزه"], "Yemeni": ["اشتي", "تشتي", "يشتي", "نشتي"]},
    "now":       {"Gulf": ["الحين", "دحين", "هالحين"], "Egyptian": ["دلوقتي", "دلوقت"], "Yemeni": ["ذحين", "ذلحين", "الحين"]},
    "today":     {"Gulf": ["اليوم"], "Egyptian": ["النهارده", "انهارده"], "Yemeni": ["اليوم"]},
    "tomorrow":  {"*": ["بكره", "بكرا"]},
    "good_nice": {"Gulf": ["زين", "حلو"], "Egyptian": ["كويس", "كويسه", "حلو"], "Yemeni": ["زين", "طيب", "حلو"]},
    "big":       {"*": ["كبير", "كبيره"]},
    "small":     {"*": ["صغير", "صغيره"]},
    "what":      {"Gulf": ["وش", "شنو", "ايش"], "Egyptian": ["ايه"], "Yemeni": ["ايش", "ما هو"]},
    "where":     {"Gulf": ["وين"], "Egyptian": ["فين"], "Yemeni": ["وين", "فين"]},
    "how_r_you": {"Gulf": ["شلونك", "شخبارك", "كيفك"], "Egyptian": ["ازيك", "عامل ايه"], "Yemeni": ["كيفك", "كيف حالك", "شلونك"]},
    "hello":     {"*": ["هلا", "اهلين", "مرحبا", "السلام عليكم", "اهلا"]},
    "come_on":   {"*": ["يلا", "تعال", "تعالي"]},
    "very":      {"Gulf": ["وايد", "مره"], "Egyptian": ["اوي", "قوي", "جدا"], "Yemeni": ["مره", "جدا"]},
    "money":     {"Gulf": ["فلوس", "الفلوس"], "Egyptian": ["فلوس", "الفلوس"], "Yemeni": ["فلوس", "الفلوس"]},
    "go":        {"*": ["روح", "نروح", "اروح", "رحت"]},
}

if ARGS.terms:
    TERMS = json.load(open(ARGS.terms))

# ---------------- normalization (parity with msaLeakDetector.ts) ----------
TASHKEEL = re.compile(r"[ً-ٰٟـ]")
def normalize(s: str) -> str:
    s = TASHKEEL.sub("", s or "")
    s = re.sub(r"[آأإ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"\s+", " ", s).strip()

# Compact marker lists (subset of dialectMarkers.ts, same tiers) for line scoring.
MARKERS = {
    "Egyptian": ["دلوقتي", "النهارده", "امبارح", "ازاي", "ازيك", "عايز", "عاوز", "مفيش", "كده", "بتاع", "ده", "دي", "ليه"],
    "Gulf": ["وايد", "شخبارك", "هالحين", "خوش", "يبي", "تبي", "ابغى", "شلون", "وش", "زين", "الحين", "وين", "ليش", "مو"],
    "Yemeni": ["ذحين", "ذلحين", "اشتي", "تشتي", "لاحين", "عاد", "شلون", "وش", "زين", "الحين", "وين", "ليش", "مو", "مش", "فين"],
    "MSA": ["الان", "لماذا", "ماذا", "سوف", "ليس", "الذي", "التي", "الذين", "حينما", "بينما", "ايضا", "كذلك", "يجب", "حيث"],
}
MARKERS_N = {k: [normalize(w) for w in v] for k, v in MARKERS.items()}

def word_in(text_n: str, term_n: str) -> bool:
    return re.search(rf"(^|[\s\W]){re.escape(term_n)}($|[\s\W])", text_n) is not None

def score(text: str, dialect: str):
    n = normalize(text)
    tokens = max(len(n.split()), 1)
    d = sum(1 for w in MARKERS_N[dialect] if word_in(n, w))
    m = sum(1 for w in MARKERS_N["MSA"] if word_in(n, w))
    return min(1.0, d * 6 / tokens), min(1.0, m * 6 / tokens)

# ---------------- yt-dlp helpers ----------------
def run(args, timeout=180):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)

def list_videos(url: str):
    r = run(["yt-dlp", "--flat-playlist", "--print", "%(id)s\t%(title)s\t%(duration)s",
             "--playlist-end", str(MAX_VIDEOS * 2), url])
    out = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        vid, title, dur = parts
        try:
            seconds = int(float(dur))
        except ValueError:
            seconds = None
        if seconds is not None and not (MIN_S <= seconds <= MAX_S):
            continue
        out.append((vid, title, seconds))
        if len(out) >= MAX_VIDEOS:
            break
    return out

def fetch_subs(vid: str):
    """Arabic caption events for a video, cached on disk. Manual preferred."""
    cached = SUBS / f"{vid}.ar.json3"
    if not cached.exists():
        for flags in (["--write-subs"], ["--write-auto-subs"]):
            r = run(["yt-dlp", "--skip-download", *flags, "--sub-langs", "ar",
                     "--sub-format", "json3", "--no-warnings",
                     "-o", str(SUBS / "%(id)s.%(ext)s"),
                     f"https://www.youtube.com/watch?v={vid}"], timeout=240)
            if cached.exists():
                break
            if "429" in (r.stderr or ""):
                LOG(f"    429 — cooling off 45s"); time.sleep(45)
                run(["yt-dlp", "--skip-download", *flags, "--sub-langs", "ar",
                     "--sub-format", "json3", "--no-warnings",
                     "-o", str(SUBS / "%(id)s.%(ext)s"),
                     f"https://www.youtube.com/watch?v={vid}"], timeout=240)
                if cached.exists():
                    break
        time.sleep(SLEEP)
    if not cached.exists():
        return None
    data = json.loads(cached.read_text())
    lines = []
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs or ev.get("tStartMs") is None:
            continue
        text = re.sub(r"\s+", " ", "".join(s.get("utf8", "") for s in segs)).strip()
        if not text or text.startswith(("[", "(", "♪")):
            continue
        lines.append((int(ev["tStartMs"]), int(ev["tStartMs"]) + int(ev.get("dDurationMs") or 2000), text))
    return lines

# ---------------- mine ----------------
def terms_for(dialect: str):
    out = []
    for concept, by_dialect in TERMS.items():
        for form in by_dialect.get(dialect, by_dialect.get("*", [])):
            out.append((concept, form, normalize(form)))
        if dialect in by_dialect and "*" in by_dialect:
            for form in by_dialect["*"]:
                out.append((concept, form, normalize(form)))
    return out

rows = []
for name, dialect, url in CHANNELS:
    LOG(f"\n== {name} [{dialect}]")
    try:
        videos = list_videos(url)
    except Exception as e:
        LOG(f"  enumeration failed: {e}"); continue
    LOG(f"  {len(videos)} videos in window")
    terms = terms_for(dialect)
    for vid, title, seconds in videos:
        try:
            lines = fetch_subs(vid)
        except Exception as e:
            LOG(f"  {vid}: {e}"); continue
        if lines is None:
            LOG(f"  {vid}: no Arabic captions — {title[:50]}"); continue
        hits = 0
        for start, end, text in lines:
            if not (1000 <= end - start <= 12000):
                continue
            n = normalize(text)
            matched = [(c, f) for c, f, fn in terms if word_in(n, fn)]
            if not matched:
                continue
            d_score, m_score = score(text, dialect)
            for concept, form in matched[:2]:
                rows.append({
                    "concept": concept, "word": form, "dialect": dialect,
                    "channel": name, "video_title": title,
                    "url": f"https://www.youtube.com/watch?v={vid}&t={max(start//1000-1,0)}s",
                    "start_s": round(start / 1000, 1), "end_s": round(end / 1000, 1),
                    "line": text, "dialect_score": round(d_score, 2), "msa_score": round(m_score, 2),
                })
                hits += 1
        LOG(f"  {vid}: {len(lines)} lines, {hits} hits — {title[:50]}")

with OUT.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["concept", "word", "dialect", "channel", "video_title",
                                      "url", "start_s", "end_s", "line", "dialect_score", "msa_score"])
    w.writeheader()
    for row in sorted(rows, key=lambda r: (r["dialect"], r["concept"], -r["dialect_score"])):
        w.writerow(row)
LOG(f"\nDONE: {len(rows)} hits -> {OUT}")
