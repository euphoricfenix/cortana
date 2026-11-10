"""FR-1 — perceptual hash + SQLite cache, sits in front of every metered API call."""

import json
import sqlite3
from pathlib import Path

import imagehash
from PIL import Image

DB = Path(__file__).resolve().parent.parent / "data" / "cache.db"
MAX_DISTANCE = 4  # pHash hamming distance below which two images are "the same"


def _conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB)
    c.execute(
        "CREATE TABLE IF NOT EXISTS checks (phash TEXT PRIMARY KEY, report TEXT NOT NULL)"
    )
    return c


def phash(image_path) -> str:
    with Image.open(image_path) as im:
        return str(imagehash.phash(im))


def lookup(h: str):
    """Nearest stored report within MAX_DISTANCE, else None."""
    target = imagehash.hex_to_hash(h)
    best, best_d = None, MAX_DISTANCE + 1
    # ponytail: full table scan — pHash needs hamming distance, not equality, so no
    # index helps. Fine to ~1e5 rows; swap in a BK-tree if lookup shows up in latency.
    with _conn() as c:
        for stored, report in c.execute("SELECT phash, report FROM checks"):
            d = imagehash.hex_to_hash(stored) - target
            if d < best_d:
                best, best_d = report, d
    return json.loads(best) if best is not None else None


def store(h: str, report: dict) -> None:
    """NFR-4: only the report is persisted here, never the uploaded media."""
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO checks VALUES (?,?)", (h, json.dumps(report)))
