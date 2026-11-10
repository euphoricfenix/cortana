"""FR-3 — Crawl4AI wrapper: one candidate URL in, publish metadata out.

Self-hosted, so no per-call cost. Extraction here is for internal matching only —
never republication of scraped content (cross-phase requirement).
"""

import asyncio
import json
from datetime import datetime, timezone

from bs4 import BeautifulSoup

MAX_CONCURRENT = 5
TIMEOUT_S = 30

DATE_META = [  # <meta> attrs, in priority order after JSON-LD
    {"property": "article:published_time"},
    {"property": "og:published_time"},
    {"name": "date"},
    {"name": "pubdate"},
    {"itemprop": "datePublished"},
]


def _iso(raw):
    """Normalise to UTC ISO-8601, or None if it isn't a date we can trust."""
    if not raw or not isinstance(raw, str):
        return None
    # ponytail: ISO-8601 only. JSON-LD and article:published_time are ISO in practice;
    # add dateutil.parser if real crawls show useful dates being dropped here.
    try:
        d = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat()


def _jsonld_dates(soup):
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
                for k in ("datePublished", "dateCreated", "uploadDate"):
                    if node.get(k):
                        yield node[k]


def _date_candidates(soup):
    """Raw date strings, most trusted first: JSON-LD, then <meta>, then <time>."""
    yield from _jsonld_dates(soup)
    for attrs in DATE_META:
        if tag := soup.find("meta", attrs=attrs):
            yield tag.get("content")
    if tag := soup.find("time", datetime=True):
        yield tag.get("datetime")


def extract(url: str, html: str, text: str = "") -> dict:
    soup = BeautifulSoup(html, "html.parser")
    published = next(filter(None, map(_iso, _date_candidates(soup))), None)
    canonical = soup.find("link", rel="canonical")
    title = soup.find("meta", property="og:title") or soup.find("title")

    return {
        "url": url,
        "canonical_url": canonical.get("href") if canonical else url,
        "published": published,
        "title": (title.get("content") if title and title.has_attr("content") else
                  title.get_text(strip=True) if title else None),
        "text": text[:2000],  # enough to eyeball the match, not a content copy
    }


async def _crawl_all(urls):
    from crawl4ai import AsyncWebCrawler

    sem = asyncio.Semaphore(MAX_CONCURRENT)
    async with AsyncWebCrawler() as crawler:

        async def one(url):
            async with sem:
                try:
                    r = await asyncio.wait_for(crawler.arun(url=url), TIMEOUT_S)
                    if not r.success:
                        return {"url": url, "error": r.error_message}
                    return extract(url, r.html, str(r.markdown or ""))
                except Exception as e:
                    return {"url": url, "error": str(e)}

        return await asyncio.gather(*(one(u) for u in urls))


def crawl(urls: list[str]) -> list[dict]:
    """Blocking wrapper — the pipeline is synchronous."""
    return asyncio.run(_crawl_all(urls)) if urls else []
