"""One hermetic pass over check_image() — no API keys, no network.

The paid edges (search, crawl, HF, VLM) are stubbed; everything the pipeline actually
owns — cache hit/miss, timeline ordering, EXIF flags, ELA, cost cap, no-verdict — is
real. Run: python tests/test_pipeline.py   (also collects under pytest)
"""

import random
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image

from src import cache, pipeline, signals, timeline
from src.crawl import extract

TMP = Path(tempfile.mkdtemp())
cache.DB = TMP / "cache.db"  # keep the real data/cache.db out of the tests


def _image(name, seed=1, size=(64, 64)):
    """Deterministic textured noise — a flat colour has no DCT content, so every flat
    image pHashes identically and the cache test would pass for the wrong reason."""
    rng = random.Random(seed)
    p = TMP / name
    im = Image.new("RGB", size)
    im.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256))
                for _ in range(size[0] * size[1])])
    im.save(p)
    return p


def _empty_cache():
    """Tests share one DB; a stray near-duplicate would silently turn a pipeline test
    into a cache-hit test."""
    with cache._conn() as c:
        c.execute("DELETE FROM checks")


def test_timeline_orders_by_date():
    t = timeline.build([
        {"url": "https://b.com/2", "published": "2024-03-01T00:00:00+00:00"},
        {"url": "https://a.com/1", "published": "2023-01-05T00:00:00+00:00"},
        {"url": "https://c.com/3"},
        {"url": "https://d.com/4", "error": "timeout"},
    ])
    assert t["earliest_appearance"]["domain"] == "a.com"
    assert [r["domain"] for r in t["reposts"]] == ["b.com"]
    assert t["undated_sources"][0]["domain"] == "c.com"
    assert t["unreachable"][0]["url"] == "https://d.com/4"


def test_timeline_flags_absent_dates():
    t = timeline.build([{"url": "https://x.com/1"}])
    assert t["earliest_appearance"] is None
    assert any("unknown, not recent" in n for n in t["notes"])


def test_extract_prefers_jsonld_and_normalises_tz():
    html = """<html><head>
      <link rel="canonical" href="https://n.com/real">
      <meta property="article:published_time" content="2024-05-05T00:00:00Z">
      <script type="application/ld+json">
        {"@graph":[{"@type":"Article","datePublished":"2024-01-02T03:04:05+05:30"}]}
      </script></head><body></body></html>"""
    got = extract("https://n.com/real?utm=1", html)
    assert got["published"] == "2024-01-01T21:34:05+00:00"  # JSON-LD wins, UTC
    assert got["canonical_url"] == "https://n.com/real"


def test_extract_survives_junk_dates():
    assert extract("u", '<meta name="date" content="last tuesday">')["published"] is None


def test_exif_flags_missing_metadata():
    got = signals.exif(_image("plain.jpg", seed=2))
    assert got["present"] is False and got["flags"]


def test_ela_returns_a_heatmap():
    got = signals.ela(_image("ela.jpg", seed=3))
    assert got["heatmap_png_b64"] and got["peak_difference"] >= 0


def test_cache_matches_near_duplicates_not_everything():
    a = _image("a.png", seed=1)
    recompressed = TMP / "a-reupload.jpg"          # what a social re-upload does to it
    Image.open(a).save(recompressed, quality=45)

    cache.store(cache.phash(a), {"marker": "hit"})
    assert cache.lookup(cache.phash(recompressed))["marker"] == "hit"
    assert cache.lookup(cache.phash(_image("other.png", seed=99))) is None


@patch.object(signals, "vlm", lambda p: {"findings": [], "cost_usd": 0.002})
@patch.object(signals, "classifier", lambda p: {"raw_scores": []})
@patch.object(pipeline.crawl, "crawl", lambda urls: [
    {"url": urls[0], "published": "2019-06-01T00:00:00+00:00", "title": "Original"},
    {"url": urls[1], "published": "2024-06-01T00:00:00+00:00", "title": "Repost"}])
@patch.object(pipeline.search, "search", lambda b: {
    "urls": ["https://old.com/a", "https://new.com/b"],
    "labels": ["protest"], "entities": [], "errors": {}, "cost_usd": 0.0105})
def test_check_image_end_to_end():
    _empty_cache()
    img = _image("check.jpg", seed=5)
    r = pipeline.check_image(img)

    assert r["cached"] is False
    assert r["verdict"] is None                     # FR-9 — never a verdict
    assert "aggregate" not in r and "score" not in r
    assert r["provenance"]["earliest_appearance"]["domain"] == "old.com"
    assert set(r["signals"]) == {"exif", "ela", "classifier", "vlm"}
    assert r["cost_usd"] == 0.0125                  # NFR-1 — every metered call counted

    hit = pipeline.check_image(img)                 # FR-1 — second pass is free
    assert hit["cached"] and hit["cost_usd"] == 0.0
    assert "heatmap_png_b64" not in hit["signals"]["ela"]  # NFR-4 — media not retained


@patch.object(signals, "vlm", lambda p: 1 / 0)  # must never be called
@patch.object(signals, "classifier", lambda p: {"raw_scores": []})
@patch.object(pipeline.search, "search", lambda b: {
    "urls": [], "labels": [], "entities": [], "errors": {}, "cost_usd": 0.049})
def test_cost_cap_skips_the_vlm():
    _empty_cache()
    r = pipeline.check_image(_image("capped.jpg", seed=7))
    assert r["signals"]["vlm"] == {"skipped": True} and r["cost_capped"]


@patch.object(signals, "vlm", lambda p: {"findings": []})
@patch.object(signals, "classifier", lambda p: {"raw_scores": []})
@patch.object(pipeline.search, "search", lambda b: {
    "urls": [], "labels": [], "entities": [], "errors": {"vision": "quota"},
    "cost_usd": 0.0})
def test_failed_search_is_not_cached():
    _empty_cache()
    img = _image("flaky.jpg", seed=11)
    pipeline.check_image(img)
    assert cache.lookup(cache.phash(img)) is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok   {name}")
    print("all passed")
