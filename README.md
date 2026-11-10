# Media Authenticity Checker — Phase 0 MVP

Image-only source verification + a basic AI-signals panel, for one enterprise
vertical. This is the bootstrapped slice from the PRD
(`media-authenticity-prd/Media-Authenticity-Platform-PRD.docx`) — everything
here is what's needed to build *that* and nothing past it.

## What Phase 0 actually does

One primitive: `check_image(image) -> report`

1. Perceptual-hash the image, check cache — skip everything below on a hit.
2. Reverse image search (Google Vision Web Detection + Bing Visual Search) →
   candidate source URLs.
3. Crawl4AI each candidate → publish date, canonical URL, article text.
4. Build a provenance timeline: earliest known appearance, reposts, sources.
5. Run the signals panel — EXIF check, ELA heat-map, one licensed HF
   classifier, one VLM anomaly pass (via OpenRouter) — shown as separate
   signals, never combined into a score or verdict.

No video, no text-claim pipeline, no custom-trained models, no on-prem —
those are Phase 2+, not here.

## Blocking decision before writing code

**Wedge vertical is not chosen yet**: insurance-claims fraud vs.
marketplace/dating trust & safety. This decides the claim schema and where
the pipeline plugs in (claims-processing tool vs. listing/profile scanner).
Pick this first — the pipeline below is identical either way, only the
input/output shape around it changes.

## Stack

- **Python** — Crawl4AI is Python-native, and EXIF/ELA/image-hash tooling
  (Pillow, `imagehash`) is more mature there than in JS.
- **Crawl4AI** (`pip install crawl4ai`) — self-hosted, Playwright-based
  extraction.
- **`imagehash` + Pillow** — pHash for the cache layer.
- **Google Cloud Vision API** (Web Detection) — primary reverse-search source.
- **Bing Visual Search API** (Azure) — secondary reverse-search source.
- **OpenRouter** — routes the VLM anomaly-explainer call, provider-agnostic.
- **One Hugging Face classifier** — pick a candidate, verify its license
  allows commercial use, benchmark it ourselves before trusting its model
  card.
- **SQLite** — cache table (hash → last result) + provenance results. No
  need for Postgres at this scale; upgrade only if it becomes a bottleneck.

## Environment variables

Every variable, with defaults, is listed in [`.env.example`](.env.example): API
keys (Vision, Bing, HF, OpenRouter), model choices, and the NFR-1 cost knobs.
Real values go in `.env`, which is gitignored. Never put them in `.env.example`.

## Layout

```
cortana/
  src/
    cache.py       # FR-1 — pHash + SQLite lookup
    search.py      # FR-2 — Vision + Bing, merged/deduped
    crawl.py       # FR-3 — Crawl4AI wrapper, candidate URL in, metadata out
    timeline.py    # FR-4 — assembles the provenance timeline
    signals.py     # FR-5..FR-8 — EXIF, ELA, HF classifier, OpenRouter VLM
    pipeline.py    # FR-9 — check_image(), wires the above, no scoring
  tests/
    test_pipeline.py
  media-authenticity-prd/
    Media-Authenticity-Platform-PRD.docx   # the PRD this repo implements
    media-authenticity-prd.html            # same PRD, browser-readable
    build_prd.js                           # regenerates the .docx (`npm i docx && node build_prd.js`)
  .env.example
  requirements.txt
```

FR-5..FR-8 are one file, not a `signals/` package — four modules of ~30 lines
each buys nothing, and they share the "return evidence, never a verdict"
contract that's easier to hold in one place. Split it when one of them grows
past a screen.

## Run it

```
pip install -r requirements.txt
crawl4ai-setup                        # installs the Playwright browsers
cp .env.example .env                  # fill in what you have; missing keys degrade
python tests/test_pipeline.py         # hermetic — no keys, no network
set -a; source .env; set +a           # nothing auto-loads .env — export it first
python -m src.pipeline path/to.jpg    # live check
```

Both reverse-search providers are optional at runtime: with only one key
present the pipeline runs on that source alone rather than failing.

The tests run without pytest (`python tests/test_pipeline.py`) and are also
collected by pytest if it's installed.

## Known gap

**Bing Visual Search was retired by Microsoft in Aug 2025.** FR-2 names it as
the secondary index, and the code path is there, but an existing subscription
key is now the only way it resolves. A replacement (SerpAPI, TinEye) is one new
function in `src/search.py` — the merge is provider-agnostic. Decide before
Phase 0.5, because single-source discovery weakens the timeline.

## Status

FR-1 through FR-9 are implemented in the build order below (cheap and local
first, metered calls last). The hermetic tests cover everything the pipeline
owns. **The live path has not been run end-to-end yet**, because it needs
`crawl4ai`, `google-cloud-vision` and real keys.

1. `FR-1` cache (nothing else matters if you're re-paying for the same image)
2. `FR-2` reverse search
3. `FR-3` Crawl4AI extraction
4. `FR-4` timeline assembly
5. `FR-5` EXIF, `FR-6` ELA — both cheap, no external calls
6. `FR-7` HF classifier — license-checked at call time
7. `FR-8` VLM pass — last, since it's the most expensive per call
8. `FR-9` combine into one signals panel response

## Non-functional targets

- Cache-hit latency < 2s, full pipeline < 30s.
- Per-check cost logged (Vision/Bing/VLM are all metered) with a cap/alert —
  `MAX_COST_PER_CHECK_USD` skips the VLM before it's called, not after.
- Every third-party model's license checked before it ships — `signals.classifier`
  reads the license off the HF API at call time and refuses anything not on the
  commercial allowlist. Nothing is assumed from a model card.
- Uploaded media not retained past the check — only the report is cached, and
  the ELA heat-map is stripped before it's written.
- A check whose reverse search errored is not cached, so a transient quota or
  timeout failure gets retried instead of being served forever.

## Still open

- Which HF classifier(s) to benchmark first, and against what eval set.
  `HF_MODEL` defaults to `Organika/sdxl-detector` because it's a working
  starting point, not because it's been benchmarked. Its number is not our
  number until we run our own eval set.
- Wedge vertical (see above). It does not block the pipeline — nothing in
  `check_image()` depends on it — but it blocks the claim schema wrapped
  around the call, so it blocks Phase 0.5.
- No eval set exists yet. `tests/test_pipeline.py` proves the pipeline is
  wired correctly, not that the signals are any good. Phase 0's exit criterion
  ("3–5 test cases legible to a non-technical reviewer") needs real images.
- The cache has no TTL. A viral image picks up new reposts after it's first
  checked, and a cache hit won't show them. Add an expiry when that matters.
