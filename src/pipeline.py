"""FR-9 — check_image(): the one Phase 0 primitive. Wires FR-1..FR-8 together.

Deliberately produces no aggregate score and no verdict. The output is a provenance
timeline plus four independent signals, and it stays that way.
"""

import os
import time

from . import cache, crawl, search, signals, timeline

MAX_CANDIDATES = int(os.getenv("MAX_CANDIDATE_URLS", "10"))
MAX_COST_PER_CHECK = float(os.getenv("MAX_COST_PER_CHECK_USD", "0.05"))  # NFR-1 cap


def check_image(image_path) -> dict:
    started = time.monotonic()
    h = cache.phash(image_path)

    if hit := cache.lookup(h):
        return {**hit, "phash": h, "cached": True,
                "elapsed_s": round(time.monotonic() - started, 3), "cost_usd": 0.0}

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    found = search.search(image_bytes)                       # FR-2
    sources = crawl.crawl(found["urls"][:MAX_CANDIDATES])    # FR-3
    provenance = timeline.build(sources)                     # FR-4
    provenance["search_labels"] = found["labels"]
    provenance["search_entities"] = found["entities"]

    cost = found["cost_usd"]
    # Cap before the most expensive call, not after it.
    skip = {"vlm"} if cost + signals.COST_VLM > MAX_COST_PER_CHECK else set()
    panel = signals.panel(image_path, skip=skip)             # FR-5..FR-8
    cost += panel.get("vlm", {}).get("cost_usd", 0.0)

    report = {
        "phash": h,
        "cached": False,
        "provenance": provenance,
        "signals": panel,
        "verdict": None,  # by design — Phase 0 ships signals, never a conclusion
        "search_errors": found["errors"],
        "cost_usd": round(cost, 5),
        "cost_capped": bool(skip),
        "elapsed_s": round(time.monotonic() - started, 3),
    }

    if cost > MAX_COST_PER_CHECK:
        report["cost_alert"] = f"${cost:.4f} exceeded the ${MAX_COST_PER_CHECK} cap"

    # A failed search is usually transient (quota, timeout) — caching it would serve the
    # degraded report forever. ponytail: signal errors still cache; most are permanent
    # (license refusal), and the cache has no TTL — add one if stale timelines bite.
    if not found["errors"]:
        # NFR-4 — derived media (the ELA heat-map) is not persisted past the check.
        ela = {k: v for k, v in panel["ela"].items() if k != "heatmap_png_b64"}
        cache.store(h, {**report, "signals": {**panel, "ela": ela}})
    return report


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(check_image(sys.argv[1]), indent=2)[:4000])
