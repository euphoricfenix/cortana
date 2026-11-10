"""FR-4 — provenance timeline: earliest known appearance, reposts, undated sources."""

from urllib.parse import urlparse


def build(sources: list[dict]) -> dict:
    ok = [s for s in sources if not s.get("error")]
    dated = sorted((s for s in ok if s.get("published")), key=lambda s: s["published"])
    undated = [s for s in ok if not s.get("published")]
    failed = [s for s in sources if s.get("error")]

    def entry(s):
        return {
            "url": s.get("canonical_url") or s["url"],
            "domain": urlparse(s["url"]).netloc,
            "published": s.get("published"),
            "title": s.get("title"),
        }

    notes = []
    if not dated:
        notes.append("No source carried a machine-readable publish date — "
                     "earliest appearance is unknown, not recent.")
    elif len(dated) > 1:
        span = f"{dated[0]['published'][:10]} → {dated[-1]['published'][:10]}"
        notes.append(f"{len(dated)} dated appearances spanning {span}.")
    if undated:
        notes.append(f"{len(undated)} source(s) found but undated.")
    if failed:
        notes.append(f"{len(failed)} candidate URL(s) failed to crawl.")

    return {
        "earliest_appearance": entry(dated[0]) if dated else None,
        "reposts": [entry(s) for s in dated[1:]],
        "undated_sources": [entry(s) for s in undated],
        "unreachable": [{"url": s["url"], "error": s["error"]} for s in failed],
        "notes": notes,
    }
