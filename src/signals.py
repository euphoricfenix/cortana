"""FR-5..FR-8 — the Part 1 signals panel.

Every function returns evidence, never a verdict and never a score that gets summed
with another signal's. A caller that combines these into one number is a bug (FR-9).
"""

import base64
import io
import json
import mimetypes
import os

import requests
from PIL import Image, ImageChops, ImageEnhance, ExifTags

HF_MODEL = os.getenv("HF_MODEL", "Organika/sdxl-detector")
HF_ENDPOINT = "https://router.huggingface.co/hf-inference/models"
# NFR-3 — nothing runs until its license is confirmed commercial-use.
COMMERCIAL_LICENSES = {
    "apache-2.0", "mit", "bsd", "bsd-3-clause", "bsd-2-clause",
    "cc-by-4.0", "cc0-1.0", "cc-by-sa-4.0", "openrail", "creativeml-openrail-m",
}

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-2.5-flash")
COST_VLM = float(os.getenv("COST_VLM_CALL", "0.0020"))

VLM_PROMPT = (
    "List concrete visual anomalies in this image that are consistent with AI "
    "generation or manual editing: lighting/shadow inconsistency, warped text, "
    "hand/limb/anatomy errors, repeated textures, splice or blend edges, "
    "impossible reflections or perspective. Report only what you can point at in "
    "the image. Do NOT state whether the image is real or fake, and do not give a "
    "confidence score. Reply as JSON: "
    '{"findings":[{"where":"...","observation":"...","why_it_matters":"..."}]}. '
    "An empty findings list is a valid answer."
)


# ---------------------------------------------------------------- FR-5 EXIF
def exif(image_path) -> dict:
    with Image.open(image_path) as im:
        raw = im.getexif()
        data = {ExifTags.TAGS.get(k, k): str(v) for k, v in raw.items()}

    flags = []
    if not data:
        flags.append("No EXIF at all — consistent with a generated image, but also "
                     "with any social-media re-upload. Weak on its own.")
    else:
        if data.get("Software"):
            flags.append(f"Software tag present: {data['Software']}")
        if not (data.get("Make") or data.get("Model")):
            flags.append("No camera make/model despite other EXIF being present.")
        stamps = {k: data[k] for k in ("DateTime", "DateTimeOriginal", "DateTimeDigitized")
                  if k in data}
        if len(set(stamps.values())) > 1:
            flags.append(f"Timestamp fields disagree: {stamps}")

    return {"present": bool(data), "flags": flags,
            "fields": {k: data[k] for k in
                       ("Make", "Model", "Software", "DateTime", "DateTimeOriginal")
                       if k in data}}


# ----------------------------------------------------------------- FR-6 ELA
def ela(image_path, quality: int = 90, scale: int = 20) -> dict:
    """Re-compress, diff, amplify. Bright regions = areas that survived an earlier
    save at a different quality, i.e. candidate edits."""
    with Image.open(image_path) as im:
        original = im.convert("RGB")
        buf = io.BytesIO()
        original.save(buf, "JPEG", quality=quality)
        buf.seek(0)
        with Image.open(buf) as resaved:
            diff = ImageChops.difference(original, resaved)

    extrema = diff.getextrema()
    peak = max(hi for _, hi in extrema) or 1
    heat = ImageEnhance.Brightness(diff).enhance(min(scale, 255.0 / peak))

    out = io.BytesIO()
    heat.save(out, "PNG")
    return {
        "peak_difference": peak,
        "note": "High-contrast regions are candidate edits. JPEGs re-saved by any "
                "platform show elevated ELA everywhere — read localisation, not level.",
        "heatmap_png_b64": base64.b64encode(out.getvalue()).decode(),
    }


# ---------------------------------------------------------- FR-7 classifier
def _license_ok(model_id: str) -> tuple[bool, str]:
    r = requests.get(f"https://huggingface.co/api/models/{model_id}", timeout=10)
    r.raise_for_status()
    lic = str((r.json().get("cardData") or {}).get("license") or "unstated").lower()
    return lic in COMMERCIAL_LICENSES, lic


def classifier(image_path) -> dict:
    ok, lic = _license_ok(HF_MODEL)
    audit = {"model": HF_MODEL, "license": lic, "commercial_use_ok": ok}
    if not ok:
        # NFR-3 / risk register: refuse rather than ship an unlicensed model.
        return {**audit, "error": f"license '{lic}' not on the commercial allowlist — "
                                  f"add it to COMMERCIAL_LICENSES only after review"}

    headers = {"Content-Type": "application/octet-stream"}
    if os.getenv("HF_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['HF_TOKEN']}"
    with open(image_path, "rb") as f:
        r = requests.post(f"{HF_ENDPOINT}/{HF_MODEL}", headers=headers, data=f.read(),
                          timeout=60)
    r.raise_for_status()
    return {
        **audit,
        "raw_scores": r.json(),
        "note": "Vendor-reported accuracy is not our number. Benchmark on our own eval "
                "set before this score is shown to a customer.",
    }


# ----------------------------------------------------------------- FR-8 VLM
def vlm(image_path) -> dict:
    key = os.environ["OPENROUTER_API_KEY"]
    mime = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": OPENROUTER_MODEL,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": VLM_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ]}],
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    r.raise_for_status()
    body = r.json()
    content = body["choices"][0]["message"]["content"]
    try:
        findings = json.loads(content).get("findings", [])
    except json.JSONDecodeError:
        findings = [{"observation": content}]
    return {
        "model": OPENROUTER_MODEL,
        "findings": findings,
        "cost_usd": body.get("usage", {}).get("cost", COST_VLM),
        "note": "Descriptive only — a VLM is not a calibrated detector.",
    }


# --------------------------------------------------------------- FR-9 panel
def panel(image_path, skip: set[str] = frozenset()) -> dict:
    """All four signals side by side. One failing signal does not sink the panel,
    and nothing here is aggregated into a score."""
    out = {}
    for name, fn in (("exif", exif), ("ela", ela),
                     ("classifier", classifier), ("vlm", vlm)):
        if name in skip:
            out[name] = {"skipped": True}
            continue
        try:
            out[name] = fn(image_path)
        except Exception as e:
            out[name] = {"error": f"{type(e).__name__}: {e}"}
    return out
