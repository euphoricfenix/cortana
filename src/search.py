"""FR-2 — reverse image search across Vision Web Detection + Bing Visual Search.

Both sources are optional at runtime: a missing key or a failing provider degrades
to the other one rather than killing the check.
"""

import os
from urllib.parse import urldefrag

import requests

BING_ENDPOINT = "https://api.bing.microsoft.com/v7.0/images/visualsearch"

# NFR-1 — list prices per call, override per contract. Keep in sync with billing.
COST_VISION = float(os.getenv("COST_VISION_CALL", "0.0035"))
COST_BING = float(os.getenv("COST_BING_CALL", "0.0070"))


def _vision(image_bytes: bytes) -> dict:
    from google.cloud import vision

    client = vision.ImageAnnotatorClient()
    web = client.web_detection(image=vision.Image(content=image_bytes)).web_detection
    return {
        "urls": [p.url for p in web.pages_with_matching_images],
        "labels": [l.label for l in web.best_guess_labels],
        "entities": [e.description for e in web.web_entities if e.description],
    }


def _bing(image_bytes: bytes, key: str) -> dict:
    # ponytail: Microsoft retired the Bing Search APIs in Aug 2025 — this stays because
    # the PRD names it and existing contracts still resolve. A replacement (SerpAPI,
    # TinEye) has a different request/response shape, so it gets its own function
    # returning {"urls", "labels", "entities"}; the merge below doesn't care which.
    r = requests.post(
        BING_ENDPOINT,
        headers={"Ocp-Apim-Subscription-Key": key},
        files={"image": ("query", image_bytes)},
        timeout=20,
    )
    r.raise_for_status()
    urls = [i["hostPageUrl"]
            for t in r.json().get("tags", []) for a in t.get("actions", [])
            if a.get("actionType") in ("PagesIncluding", "VisualSearch")
            for i in a.get("data", {}).get("value", []) if i.get("hostPageUrl")]
    return {"urls": urls, "labels": [], "entities": []}


def _canon(url: str) -> str:
    """Dedup key: drop the fragment and a trailing slash. Deliberately not aggressive —
    query strings can be the article id."""
    return urldefrag(url)[0].rstrip("/")


def search(image_bytes: bytes) -> dict:
    """Merged, de-duplicated candidate source URLs plus what each provider cost."""
    results, errors, cost = [], {}, 0.0

    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            results.append(_vision(image_bytes))
            cost += COST_VISION
        except Exception as e:
            errors["vision"] = str(e)

    key = os.getenv("AZURE_BING_VISUAL_SEARCH_KEY")
    if key:
        try:
            results.append(_bing(image_bytes, key))
            cost += COST_BING
        except Exception as e:
            errors["bing"] = str(e)

    return {
        "urls": list({_canon(u): u for r in results for u in r["urls"]}.values()),
        "labels": sorted({l for r in results for l in r["labels"]}),
        "entities": sorted({e for r in results for e in r["entities"]}),
        "errors": errors,
        "cost_usd": round(cost, 5),
    }
