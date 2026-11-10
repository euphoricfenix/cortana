const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, LevelFormat, PageBreak,
  Header, Footer, PageNumber, NumberFormat, TableOfContents, VerticalAlign,
} = require("docx");
const fs = require("fs");

const PAGE_W = 12240, PAGE_H = 15840, MARGIN = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9360

const NAVY = "1F2A44";
const SLATE = "3A4657";
const RULE = "C9CDD3";
const HEADER_FILL = "E7EAEE";
const BAND_FILL = "F4F5F7";
const MUTED = "5B6572";

const FONT = "Calibri";

function bullets(items) {
  return items.map(
    (t) =>
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 60 },
        children: [new TextRun({ text: t, size: 21 })],
      })
  );
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 420, after: 180 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
    children: [new TextRun({ text, color: NAVY, bold: true })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    children: [new TextRun({ text, color: NAVY, bold: true })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, color: SLATE, bold: true, size: 21 })],
  });
}
function label(text) {
  return new Paragraph({
    spacing: { before: 120, after: 40 },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: 16, color: MUTED, characterSpacing: 16 }),
    ],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, size: 21, italics: !!opts.italics })],
  });
}

function cell(text, { width, header = false, shade = null, bold = false, color = null } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, fill: shade } : undefined,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: header || bold,
            size: header ? 17 : 20,
            color: header ? MUTED : color || "111318",
            allCaps: header,
            characterSpacing: header ? 10 : 0,
          }),
        ],
      }),
    ],
  });
}

function dataTable(headers, rows, widths) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((htext, i) => cell(htext, { width: widths[i], header: true, shade: HEADER_FILL })),
      }),
      ...rows.map(
        (r, ri) =>
          new TableRow({
            children: r.map((c, i) => cell(c, { width: widths[i], shade: ri % 2 ? BAND_FILL : null })),
          })
      ),
    ],
  });
}

function reqTable(rows) {
  // ID | Requirement
  const widths = [1100, CONTENT_W - 1100];
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [cell("ID", { width: widths[0], header: true, shade: HEADER_FILL }), cell("Requirement", { width: widths[1], header: true, shade: HEADER_FILL })],
      }),
      ...rows.map(
        ([id, text], ri) =>
          new TableRow({
            children: [
              cell(id, { width: widths[0], shade: ri % 2 ? BAND_FILL : null, bold: true, color: NAVY }),
              cell(text, { width: widths[1], shade: ri % 2 ? BAND_FILL : null }),
            ],
          })
      ),
    ],
  });
}

function statusLine(statusText, colorHex) {
  return new Paragraph({
    spacing: { before: 0, after: 100 },
    children: [
      new TextRun({ text: statusText.toUpperCase(), bold: true, size: 17, color: colorHex, characterSpacing: 12 }),
    ],
  });
}

function riskNote(text) {
  return new Paragraph({
    spacing: { before: 100, after: 200 },
    shading: { type: ShadingType.CLEAR, fill: "FBF0DE" },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: "B08A2E", space: 8 },
    },
    indent: { left: 0 },
    children: [
      new TextRun({ text: "KEY RISK  ", bold: true, size: 16, color: "8A6416", characterSpacing: 8 }),
      new TextRun({ text, size: 20, color: "3E3018" }),
    ],
  });
}

function scopeBlock(inItems, outItems) {
  const widths = [Math.round(CONTENT_W / 2), CONTENT_W - Math.round(CONTENT_W / 2)];
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: widths[0], type: WidthType.DXA },
            margins: { right: 200 },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "IN SCOPE", bold: true, size: 16, color: "3D6B5C", characterSpacing: 10 })] }),
              ...inItems.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: t, size: 20 })] })),
            ],
          }),
          new TableCell({
            width: { size: widths[1], type: WidthType.DXA },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "OUT OF SCOPE", bold: true, size: 16, color: MUTED, characterSpacing: 10 })] }),
              ...outItems.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: t, size: 20, color: MUTED })] })),
            ],
          }),
        ],
      }),
    ],
  });
}

function metaTwoCol(leftLabel, leftText, rightLabel, rightText) {
  const widths = [Math.round(CONTENT_W / 2), CONTENT_W - Math.round(CONTENT_W / 2)];
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: widths[0], type: WidthType.DXA },
            margins: { right: 200 },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: leftLabel.toUpperCase(), bold: true, size: 16, color: MUTED, characterSpacing: 10 })] }),
              new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: leftText, size: 20 })] }),
            ],
          }),
          new TableCell({
            width: { size: widths[1], type: WidthType.DXA },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: rightLabel.toUpperCase(), bold: true, size: 16, color: MUTED, characterSpacing: 10 })] }),
              new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: rightText, size: 20 })] }),
            ],
          }),
        ],
      }),
    ],
  });
}

function phaseHeading(title, status, statusColor) {
  // Two real paragraphs (not a table) so the phase title is a genuine
  // Heading 2 and shows up in the Word navigation pane / TOC field.
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 20 },
      children: [new TextRun({ text: title, color: NAVY, bold: true })],
    }),
    new Paragraph({
      spacing: { after: 140 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 } },
      children: [new TextRun({ text: status.toUpperCase(), bold: true, size: 17, color: statusColor, characterSpacing: 10 })],
    }),
  ];
}

const P = (children, opts = {}) => new Paragraph({ spacing: { after: 160 }, ...opts, children });

/* ---------------- Document assembly ---------------- */

const docChildren = [];

// Cover
docChildren.push(
  new Paragraph({ spacing: { before: 1200, after: 60 }, children: [new TextRun({ text: "PRODUCT REQUIREMENTS DOCUMENT · DRAFT", bold: true, size: 18, color: "B4622F", characterSpacing: 14 })] }),
  new Paragraph({ spacing: { after: 220 }, children: [new TextRun({ text: "Media Authenticity Verification Platform", bold: true, size: 44, color: NAVY })] }),
  new Paragraph({ spacing: { after: 420 }, children: [new TextRun({ text: "Source verification and AI-manipulation signal detection for image, video, and text claims — phased from a bootstrapped MVP to funded Part 1 R&D.", size: 24, color: SLATE, italics: true })] }),
  dataTable(
    ["Version", "Date", "Status", "Owner"],
    [["0.1", "31 July 2026", "Draft — pre-MVP scoping", "Founder"]],
    [2000, 2400, 3160, 1800]
  ),
  new Paragraph({ children: [new PageBreak()] })
);

// TOC
docChildren.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 200 }, children: [new TextRun({ text: "Contents", color: NAVY, bold: true })] }),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new PageBreak()] })
);

// Executive Summary
docChildren.push(
  h1("Executive Summary"),
  body(
    "The product has two capabilities. Part 2 — source verification — traces an image, video, or claim back to its earliest known appearance and cross-references it against published fact-checks. Part 1 — authenticity signals — surfaces evidence of AI generation or manipulation (metadata, compression artifacts, pretrained classifiers, VLM-flagged anomalies) without issuing a verdict."
  ),
  body(
    "Part 2 is buildable now on existing APIs and open tooling. A durable, defensible version of Part 1 requires a proprietary training corpus we don't have yet — so this roadmap earns that corpus through paying enterprise usage before funding custom-model R&D, rather than building Part 1 first on spec. The executable path starts narrower than the full vision on two axes at once: one media type (image) and one customer vertical — not because the rest is wrong, but because that is the smallest thing that produces a real customer and real data."
  )
);

// Problem Statement
docChildren.push(
  h1("Problem Statement"),
  body("Five reference cases anchor scope, urgency, and the latency bar this product has to clear."),
  dataTable(
    ["Case", "Year", "What happened", "Why it matters"],
    [
      ["Arup engineering firm, Hong Kong", "2024", "A finance employee wired $25M after a video call where every other participant was a deepfake.", "Validates that enterprise fraud budget exists and is willing to pay."],
      ["WhatsApp mob killings, India", "2018", "Fabricated child-abduction videos triggered real lynchings across multiple states.", "Validates public-safety urgency in high-forward-volume markets."],
      ["Pre-election deepfake audio, Slovakia", "2023", "Released 48 hours before a national vote, spreading faster than it could be verified.", "Sets the latency bar: a multi-API deep check is not fast enough for the window that matters most."],
      ["“Pope in the puffer jacket,” fabricated Trump arrest images", "2023", "Both went viral and were debunked only by ad hoc human skepticism and manual reverse search.", "The gap is often habit and distribution, not detection capability."],
      ["Israel–Gaza & India–Pakistan conflict cycles", "Ongoing", "Dominant pattern is old media recirculated as new.", "Squarely a Part 2 problem (source and date), not a Part 1 one (pixel authenticity)."],
    ],
    [2400, 900, 3300, 2760]
  )
);

// Market Landscape
docChildren.push(
  h1("Market Landscape"),
  body(
    "The pipeline itself — reverse search, crawling, fact-check matching — is assemblable by any competent team in weeks. Defensibility has to come from vertical focus, accumulated verdict data, or distribution, not the pipeline."
  ),
  dataTable(
    ["Player", "Segment", "What they own", "Gap we use"],
    [
      ["Hive AI", "Platform API (B2B)", "AI-content detection API, integrated into Reddit and others.", "Broad detector, not provenance-first, no vertical fraud focus."],
      ["Reality Defender", "Enterprise fraud", "Funded deepfake detection, government-adjacent.", "Enterprise pricing leaves SMB / mid-market open."],
      ["Sensity AI", "Enterprise KYC / fraud", "Deepfake and fraud detection.", "Same pricing gap as above."],
      ["InVID / WeVerify", "Free, journalist / OSINT", "Reverse image & video search, keyframe tooling — EU-funded.", "Free and grant-funded, hard to out-price; avoid competing here directly."],
      ["Google (About This Image, SynthID)", "Platform-native", "Provenance labeling built into Search and Gemini.", "Absorbs the generic consumer case long-term — reinforces not building consumer-first."],
      ["C2PA / CAI", "Standard, not product", "Cryptographic provenance standard (Adobe, Microsoft, BBC, OpenAI).", "An input signal for us if adopted widely, not a competitor."],
    ],
    [1900, 1900, 3060, 2500]
  )
);

// Product Overview
docChildren.push(
  h1("Product Overview"),
  h2("Core Primitives"),
  body("Three primitives cover all media types. Video is not a separate system — it reduces to the image primitive plus extraction."),
  dataTable(
    ["Primitive", "Does"],
    [
      ["check_claim(text)", "Fact-check API match plus web search for articles discussing the claim."],
      ["check_image(image)", "Hash / cache → reverse image search → source extraction → signals panel."],
      ["crawl(url)", "Fetch a candidate source page, extract clean text and publish metadata."],
      ["check_video(video)", "= keyframe extraction → check_image() per frame + OCR/ASR caption → check_claim()."],
    ],
    [2600, 6760]
  )
);

// Segmentation
docChildren.push(
  h1("Segmentation & Go-to-Market Sequencing"),
  body(
    "Enterprise fraud and trust & safety first — fastest sales cycle, proven willingness to pay, cloud-API architecture fits without modification. Government second — needs sovereign or on-prem deployment and carries real political exposure (censorship framing); enter only once enterprise references exist to de-risk the sale. Consumer is a perpetual data and brand channel, never the primary revenue line — free incumbents (InVID) and platform-native features (Google) make it a losing lane to lead with."
  )
);

// Phased Roadmap
docChildren.push(h1("Phased Roadmap"));

// Phase 0
docChildren.push(
  ...phaseHeading("Phase 0 — MVP", "Now · Bootstrapped", "B4622F"),
  body("Ship the narrowest provable slice of Part 2, plus a basic Part 1 signals panel, for one image-dominant vertical — cheaply enough to run on founder or angel capital.", { italics: true }),
  scopeBlock(
    [
      "Image-only pipeline (no video, no text-claim yet)",
      "Hash / cache layer before any paid API call",
      "Reverse image search: Vision Web Detection + Bing Visual Search",
      "Crawl4AI source-page extraction",
      "Provenance timeline output",
      "Part 1 signals panel: EXIF, ELA, one licensed HF classifier, OpenRouter VLM anomaly pass",
    ],
    [
      "Video pipeline",
      "Text-claim / Fact Check API integration",
      "Custom-trained detection models",
      "Sovereign / on-prem deployment",
      "Aggregate score or verdict of any kind",
      "Consumer-facing UI polish beyond functional",
    ]
  ),
  h3("Functional Requirements"),
  reqTable([
    ["FR-1", "Perceptual-hash every uploaded image before any paid API call; skip the pipeline on a cache hit."],
    ["FR-2", "Query Vision Web Detection and Bing Visual Search; merge and de-duplicate candidate source URLs."],
    ["FR-3", "Crawl4AI-fetch each candidate URL; extract publish date, canonical URL, JSON-LD article metadata."],
    ["FR-4", "Render a provenance timeline: earliest known appearance, subsequent reposts, source notes."],
    ["FR-5", "EXIF extraction and sanity flags — software tag, missing camera fields, timestamp inconsistency."],
    ["FR-6", "ELA heat-map generation for localized edit / splice detection."],
    ["FR-7", "Run one license-checked pretrained HF classifier; store raw score plus score against our own eval set."],
    ["FR-8", "VLM anomaly pass via OpenRouter — itemized findings, never a verdict."],
    ["FR-9", "Combine FR-5 through FR-8 into one signals panel; no aggregate score surfaced to the user."],
  ]),
  h3("Non-Functional Requirements"),
  reqTable([
    ["NFR-1", "Per-check cost tracked with a dashboard / alert — Vision, Bing, and VLM calls are metered."],
    ["NFR-2", "Latency — cache-hit path under 2s; full pipeline path targeted under 30s."],
    ["NFR-3", "Every third-party model checked for commercial-use license before integration."],
    ["NFR-4", "Uploaded media not retained beyond the check unless the design partner explicitly consents."],
  ]),
  riskNote("Wedge vertical is undecided — see Open Questions. Requirements above hold for either candidate, but claim schema and integration point diverge past Phase 0."),
  metaTwoCol(
    "Success / Exit Criteria",
    "Pipeline runs end-to-end on real cases from the chosen vertical; 3–5 test cases legible to a non-technical reviewer; ready to hand to the first design partner.",
    "Duration & Dependencies",
    "Weeks, not months — integration work, no novel research. Needs: Vision API key, Bing Visual Search key, OpenRouter account, self-hosted Crawl4AI, 1–2 license-verified HF classifiers."
  )
);

// Phase 0.5
docChildren.push(
  ...phaseHeading("Phase 0.5 — Design Partners", "Next", "92661F"),
  body("Prove the MVP against real cases with 5–10 unpaid or discounted design partners in the chosen vertical, in exchange for feedback and consented data.", { italics: true }),
  metaTwoCol(
    "Scope Addition",
    "FR-10 — lightweight feedback capture: partner marks a result useful or not, with a reason. Seeds the future training corpus.",
    "Success Criteria",
    "2–3 quantified case studies (fraudulent claims or listings flagged, value at risk); provenance timeline usable without explanation."
  ),
  riskNote("Design partners churn without a paid relationship; feedback volume too low to be meaningful."),
  body("Duration: 4–8 weeks post-MVP.")
);

// Phase 1
docChildren.push(
  ...phaseHeading("Phase 1 — Paid Conversion", "Then", "5B6572"),
  body("Convert design partners to paying pilots; assemble a traction narrative built on real numbers, not projections.", { italics: true }),
  metaTwoCol(
    "Scope Addition",
    "Billing / metering, basic multi-tenant access control, SLA-lite support.",
    "Success Criteria",
    "First paying contracts signed; 2–3 case studies with real figures; fundraise narrative grounded in Phase 0.5 data."
  ),
  riskNote("Pricing model unproven; risk of drifting into InVID’s free journalist-tooling lane if the wedge choice skews that direction."),
  body("Duration: 2–3 months.")
);

// Phase 2
docChildren.push(
  ...phaseHeading("Phase 2 — Funded Expansion", "Funded", "3D6B5C"),
  body("Deploy raised capital into the Part 1 R&D and coverage expansion deferred throughout this document.", { italics: true }),
  metaTwoCol(
    "Scope Addition",
    "Video pipeline (reusing check_image on keyframes), text-claim pipeline (Fact Check Tools API), sovereign / on-prem deployment track, custom model training on the Phase 0.5–1 corpus, first government conversations using enterprise references.",
    "Success Criteria",
    "Video / text parity with image pipeline; first government pilot or RFP response; measurable accuracy gain of the custom Part 1 model over the borrowed HF baseline."
  ),
  riskNote("Government political exposure; sovereign-deployment architecture diverges from the cloud-API MVP; detection accuracy is never fully “solved” — communicate honestly, not as a solved problem."),
  body("Duration: 6–12 months.")
);

// Phase 3
docChildren.push(
  ...phaseHeading("Phase 3 — Consumer Channel", "Ongoing · Low Priority", "5B6572"),
  body("Maintain a consumer touchpoint — browser extension or messaging bot — as a brand and data-acquisition channel, not a revenue line.", { italics: true }),
  metaTwoCol(
    "Success Criteria",
    "Steady corpus contribution and brand awareness — explicitly not judged on standalone revenue.",
    "Duration",
    "Ongoing background thread from Phase 1 onward."
  ),
  riskNote("Temptation to over-invest here because it is the most legible “product” to outsiders. Resist — market analysis says this lane is structurally weak.")
);

// Cross-phase requirements
docChildren.push(
  h1("Cross-Phase Requirements"),
  ...bullets([
    "Data retention — media and derived signals are not retained past the check unless the customer or design partner has consented; consented data is the only source for the future training corpus.",
    "Model licensing audit trail — every third-party model (Hugging Face or otherwise) logged with license type and commercial-use approval before it ships in any check.",
    "Cost and caching controls — hash-based dedup is mandatory in front of every metered API; per-check cost visible and capped from Phase 0 onward.",
    "Crawl scope legal review — Crawl4AI targets reviewed against each site’s terms of service; extraction is for internal matching and analysis, never republication of scraped content.",
  ])
);

// Risk Register
docChildren.push(
  h1("Risk Register"),
  dataTable(
    ["Risk", "Phase", "Mitigation"],
    [
      ["Part 1 accuracy overclaimed to investors or buyers", "All", "Publish only self-benchmarked numbers; never cite a vendor’s model-card claim as our own."],
      ["Government political / censorship exposure", "2+", "Enter only with enterprise references in hand; frame as evidentiary tooling, not misinformation policing."],
      ["Free incumbent (InVID) undercuts journalist-facing pricing", "0.5–1", "Stay in paid enterprise verticals — fraud, trust & safety — not journalist tooling."],
      ["API cost blowout at viral volume", "0, 3", "Hash / cache before every paid call; cost caps and alerts (NFR-1)."],
      ["Pretrained model license violation", "0", "Mandatory license check before integration (NFR-3)."],
      ["Sovereign-deployment need conflicts with cloud-API architecture", "2", "Treat as a distinct deployment track, not a retrofit of the MVP."],
      ["Detection arms race makes any point-in-time accuracy stale", "Ongoing", "Communicate signals, not verdicts; re-benchmark on a fixed cadence."],
    ],
    [3200, 1100, 5060]
  )
);

// Metrics
docChildren.push(
  h1("Metrics & KPIs"),
  dataTable(
    ["Phase", "Primary Metric", "Target"],
    [
      ["0", "Pipeline completes end-to-end on real cases", "100% of test set"],
      ["0.5", "Active design partners", "5–10"],
      ["0.5", "Case studies with quantified impact", "2–3"],
      ["1", "Paying pilot contracts", "First N signed"],
      ["2", "Custom Part 1 model vs. borrowed baseline", "Measurable accuracy gain on internal eval set"],
      ["3", "Consumer corpus contribution", "Steady, non-zero — not revenue-judged"],
    ],
    [900, 4560, 3900]
  )
);

// Open Questions
docChildren.push(
  h1("Open Questions"),
  ...bullets([
    "Wedge vertical — insurance-claims fraud vs. marketplace / dating trust & safety. Blocks final Phase 0 scoping: claim schema and integration point differ between the two.",
    "Pricing model for Phase 1 — per-check API pricing vs. seat / platform fee.",
    "Which HF classifier(s) to benchmark first, and against what internal eval set.",
    "Build vs. buy for the OCR/ASR needed for video captions in Phase 2.",
  ])
);

// Glossary
docChildren.push(
  h1("Glossary"),
  dataTable(
    ["Term", "Definition"],
    [
      ["C2PA / CAI", "Coalition for Content Provenance and Authenticity / Content Authenticity Initiative — cryptographically signed manifest standard for media provenance."],
      ["ELA", "Error Level Analysis — compression-artifact technique that flags localized image edits or splices; no ML required."],
      ["EXIF", "Metadata embedded in image files — camera, software, timestamp — usually stripped on social re-upload."],
      ["pHash", "Perceptual hash — a fingerprint for near-duplicate detection, used to cache repeat checks before paying for search APIs."],
      ["ClaimReview", "Schema.org markup used by fact-checkers; what the Google Fact Check Tools API searches."],
      ["VLM", "Vision-language model — used here for itemized anomaly explanations, not as a calibrated classifier."],
      ["Keyframe extraction", "Scene-change-based sampling of representative video frames, reducing video to a set of images."],
    ],
    [2200, 7160]
  )
);

// Appendix
docChildren.push(
  h1("Technical Appendix"),
  dataTable(
    ["Tool / API", "Role", "Notes"],
    [
      ["Google Cloud Vision — Web Detection", "Reverse image search, discovery", "Primary discovery source"],
      ["Bing Visual Search (Azure)", "Reverse image search, discovery", "Secondary index, different coverage"],
      ["Google Fact Check Tools API", "ClaimReview search", "Phase 2 — text-claim pipeline"],
      ["Crawl4AI", "Candidate URL → clean article + metadata", "Self-hosted, Playwright-based"],
      ["OpenRouter", "Multi-provider VLM routing", "Cost-effective, swappable vision model access"],
      ["Hugging Face pretrained classifiers", "Part 1 baseline signal", "License check mandatory before use"],
      ["ELA implementation", "Local edit / splice detection", "Classic re-compression technique, no ML"],
    ],
    [2700, 2800, 3860]
  )
);

/* ---------------- Doc container ---------------- */

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: "111318" } },
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 420, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 21, bold: true, color: SLATE, font: FONT }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
              children: [new TextRun({ text: "MEDIA AUTHENTICITY VERIFICATION PLATFORM — PRD v0.1", size: 15, color: MUTED, characterSpacing: 10 })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: "Page ", size: 16, color: MUTED }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                new TextRun({ text: " of ", size: 16, color: MUTED }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
              ],
            }),
          ],
        }),
      },
      children: docChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(__dirname + "/Media-Authenticity-Platform-PRD.docx", buf);
  console.log("written");
});
