# NeuralSprint: Winning Idea Dossier

> **Status:** One idea selected; no product name assigned; no implementation started.
> **Deadline:** August 23, 2026 at 11:45 PM PT.
> **Ground truth:** [`HACKATHON.md`](./HACKATHON.md) is authoritative for rules and submission fields.

## Final decision

Build a local-first forensic redaction verifier and repair tool. A user drops in a PDF they believe is redacted. The tool proves whether covered text, OCR layers, annotations, metadata, attachments, or earlier incremental-save revisions still expose the sensitive content. It then produces a rebuilt copy in which selected regions are actually removed, and runs the same attacks against its own output before declaring it safe.

No project name is proposed. “Forensic redaction verifier” is a functional description only.

## The one-line version

A black rectangle is not a redaction: this finds the text still hiding underneath it, repairs the file locally, and gives you a machine-checkable report showing that the secret is gone.

## Why this idea is stronger than a generic sprint project

NeuralSprint is broad. That makes generic productivity apps, chatbots, habit trackers, summarizers, and dashboards likely. This concept has a concrete, cinematic failure that any judge understands in seconds:

1. a PDF visibly shows `████████`;
2. the tool selects the covered area;
3. the supposedly hidden text reappears in a forensic panel;
4. the repaired copy is attacked again and passes.

The project can compete simultaneously for **Best Overall**, **Most Innovative**, and **Most Practical**. It has a real technical spine, a polished product surface, and an externally testable definition of success. It does not ask judges to trust an AI confidence score.

### Rejected concepts

- **General PDF summarizer:** one model call, crowded category, no objective success condition.
- **Screenshot-to-app generator:** technically broad, difficult to finish, and indistinguishable from existing tools.
- **Meeting assistant:** no visible hard problem and a saturated market.
- **Generic PII detector:** finding names or numbers is not enough; safe removal and adversarial verification are the differentiators.
- **Cloud document cleaner:** uploading the very secrets being protected creates a trust contradiction.
- **Password-protect-a-PDF utility:** encryption is useful but does not fix documents intended for public disclosure.
- **A legal/compliance advice bot:** high-stakes claims with no verifiable artifact.

## Specific problem

People routinely “redact” PDFs by drawing a black shape over text in Preview, Word, Google Docs, or a PDF editor. The page looks safe, but the original characters remain in the content stream and can be selected, copied, searched, extracted, or revealed by deleting the overlay. Other leaks survive in:

- invisible OCR text behind a scanned page;
- comments and annotation contents;
- document properties and XMP metadata;
- embedded source files;
- optional-content layers;
- form values;
- thumbnails;
- earlier object revisions appended during incremental saves;
- filenames and attachment names;
- white text placed behind or outside the visible page.

Who has the problem: students submitting financial-aid evidence, tenants sharing documents, journalists publishing records, lawyers exchanging exhibits, schools processing forms, small nonprofits responding to records requests, and anyone without expensive dedicated redaction software.

The current failure mode is unusually dangerous because the document looks correct. Visual review confirms the disguise, not the removal.

## Scope boundary

### The single job

Given one PDF and a set of sensitive regions or detected candidates, determine whether the file still contains recoverable sensitive content, then generate a sanitized PDF and verify it with independent checks.

### Supported in the hackathon build

- Born-digital PDFs with text and vector graphics.
- Scanned PDFs with an OCR text layer.
- Plain image-only pages.
- Rectangle/annotation/white-fill fake redactions.
- Metadata, form-field, annotation, attachment, and incremental-update checks.
- User-drawn regions plus optional local candidate suggestions.
- English-language PII patterns for assistance, never as the only gate.
- Local processing in the browser or a packaged local runtime.
- A downloadable verification report containing hashes and test results, but never the recovered secret itself by default.

### Explicit non-goals

1. No promise that arbitrary files are legally compliant.
2. No legal advice and no claim of certification.
3. No automatic public upload or email flow.
4. No cloud storage, user accounts, or team workspace.
5. No DOCX/PPTX support during the event.
6. No attempt to infer every category of sensitive information.
7. No steganography or image-forensics guarantee beyond declared tests.
8. No password cracking or bypassing encrypted inputs.

## User experience

### Screen 1: Drop and preflight

The user drops a PDF. Before showing page content, the app reports page count, file size, whether the PDF is encrypted, whether it contains incremental revisions, text objects, OCR layers, forms, annotations, embedded files, JavaScript, or optional-content groups.

Everything runs locally. A persistent network indicator states “0 bytes uploaded.” A developer-mode panel can prove this by showing no network requests after initial app load.

### Screen 2: Page and leak map

The central canvas shows the page. The right panel lists findings by class:

- visible text;
- text geometrically covered by another object;
- hidden/invisible text;
- OCR text;
- metadata;
- annotation content;
- form value;
- attachment;
- previous revision residue.

The user can draw or resize a redaction region. Suggested candidates are yellow, confirmed regions are red, and repaired regions are green. The app never prints a recovered SSN or similar value into telemetry or logs.

### Screen 3: Attack preview

A safe preview explains how a leak can be recovered: “Selectable text exists beneath this rectangle” or “An earlier object revision contains the previous stream.” For a bundled synthetic demo, the exact recovered text may be shown. For real documents, the default is a masked preview with a deliberate “reveal locally” action.

### Screen 4: Repair and verify

The user selects repair. The tool rebuilds the affected pages, strips disallowed object classes, and creates a new PDF rather than appending another edit. It then runs the full scanner against the new bytes.

The result is not a vague “safe” badge. It is a checklist:

- no text objects intersect confirmed redaction regions;
- no matching OCR tokens remain;
- no prior revisions remain;
- no annotations/forms/attachments remain unless explicitly retained;
- metadata allowlist only;
- page raster inspection finds no original glyph signal in removed regions;
- extracted text and raw-byte scans contain none of the user-confirmed tokens;
- output hash recorded.

Unknown or unsupported structures produce “not verified,” never a green result.

## Architecture

```text
PDF bytes
   |
   +--> structural parser ------------------------------+
   |    xref tables, object streams, revisions,         |
   |    pages, resources, annotations, attachments      |
   |                                                    |
   +--> page interpreter --> glyph geometry + paint order
   |                                                    |
   +--> raster renderer --> page pixels                 |
   |                                                    |
   +--> optional OCR --> token boxes                     |
   |                                                    v
   +----------------------------------------------> finding graph
                                                        |
                                   user-confirmed regions/candidates
                                                        |
                                                        v
                                              sanitizing rebuild
                                                        |
                                                        v
                                         independent verification
                                         structure + text + pixels
                                                        |
                                                        v
                                          clean PDF + signed report
```

### Recommended stack

- TypeScript and Vite.
- PDF.js for rendering and text geometry, supplemented by a lower-level parser for xref/object history.
- `pdf-lib` only where safe; do not assume saving through a library removes unreachable historical bytes.
- Tesseract.js or a small WASM OCR path for scans, opt-in because it is expensive.
- Web Workers for parsing, OCR, rendering, and rebuilding.
- IndexedDB only for temporary local recovery after a crash, encrypted or disabled by default.
- Playwright for end-to-end document tests.
- A generated adversarial fixture corpus committed to the repository.

## Hard technical core

### 1. Paint-order-aware covered-text detection

A text bounding box overlapping a dark rectangle is not automatically a leak, because overlap can be decorative. The interpreter records drawing operations in paint order and maps every glyph quad through the page's current transformation matrix. It then finds later opaque fills or images that geometrically occlude glyphs.

For each glyph cluster, compute:

- intersection area with later opaque objects;
- coverage ratio;
- fill luminance and alpha;
- clipping path;
- whether the text remains selectable/extractable;
- whether the occluder is a true redaction annotation with applied removal or merely an appearance layer.

High coverage plus extractable text is a deterministic finding. A model is unnecessary for the core defect.

### 2. Incremental-save archaeology

PDF editors often append changed objects and a new cross-reference table rather than rewriting the file. The current catalog may point to the sanitized object while old bytes remain in earlier revisions.

The parser must walk `Prev` pointers across xref tables/streams, reconstruct the object graph for each revision, and flag superseded streams containing confirmed secret tokens or prior page content. A safe output must be created from a clean object graph into a new byte stream, never by incremental append.

### 3. Hidden-content inventory

Inspect and either remove or explicitly preserve:

- `/Annots` and annotation `/Contents`;
- AcroForm values and appearances;
- embedded-file name trees;
- XMP and Info dictionaries;
- optional-content groups;
- JavaScript and actions;
- alternate images and thumbnails;
- marked-content `/ActualText` and `/Alt` values;
- text rendering mode 3, zero opacity, tiny font size, off-page coordinates, and clipping-hidden text.

The sanitizer should use an allowlist, not a growing blacklist.

### 4. Two repair modes

**Vector-preserving mode:** remove content operations intersecting confirmed regions, split text runs, rebuild streams, and overlay a true replacement rectangle. This keeps unaffected text searchable but is harder to prove correct.

**High-assurance raster mode:** render affected pages at a declared resolution, destructively replace sensitive pixels, run OCR verification, and rebuild those pages from sanitized images. This sacrifices searchability but has a simpler safety argument.

The user chooses the tradeoff. High-assurance mode is the default for unsupported fonts or ambiguous content streams.

### 5. Independent verifier

Do not verify the output with the exact same in-memory assumptions used to produce it. Reload the emitted bytes in a fresh worker and run:

- structural inventory;
- full text extraction;
- raw decoded-stream search;
- revision count check;
- OCR over affected regions;
- pixel comparison and edge inspection;
- metadata/attachment/form/annotation checks.

A result is green only when every required test passes. Parser errors or unsupported filters are yellow “not verified.”

### 6. Candidate detection without overclaiming

Local helpers can suggest likely secrets using regular expressions, checksums, and lightweight NER:

- email, phone, account formats;
- SSN-like patterns only when context supports them;
- credit-card candidates validated by Luhn but masked immediately;
- addresses/names as low-confidence suggestions;
- user-provided exact terms.

The user confirms every region. Detection recall is not allowed to define safety.

## Adversarial fixture corpus

Build at least 40 synthetic PDFs, each with known ground truth and no real PII:

1. black vector rectangle over selectable text;
2. image rectangle over text;
3. redaction annotation not applied;
4. applied redaction;
5. white text on white background;
6. invisible text rendering mode;
7. clipped text;
8. text outside CropBox but inside MediaBox;
9. OCR layer beneath scan;
10. form field with hidden value;
11. comment containing secret;
12. attachment containing secret;
13. XMP metadata leak;
14. filename leak;
15. incremental save with old text;
16. object stream compression;
17. optional-content hidden layer;
18. alternate text leak;
19. page thumbnail leak;
20. encrypted input;
21. malformed xref;
22. rotated page transformations;
23. Type 3 font;
24. ligature and custom encoding;
25. partial-glyph region;
26. transparent overlay;
27. patterned overlay;
28. scanned image where pixels themselves contain the secret;
29. raster redaction that was blurred, not erased;
30. multiple nested revisions.

For every fixture, assert expected findings before repair and expected absence after repair. Publish the corpus and results so judges can inspect the claim.

## Privacy, safety, and trust

- No document bytes leave the device.
- No analytics event may include text, filenames, hashes of user tokens, or page images.
- Crash reports exclude document-derived values.
- Temporary data is cleared when the tab closes unless the user explicitly enables recovery.
- Recovered content is masked by default.
- The UI says “verified against these tests,” never “guaranteed safe.”
- Unsupported encryption, malformed structures, parser ambiguity, or OCR uncertainty fail closed.
- Sample files use synthetic identifiers only.
- Network-dependent fonts/assets are bundled so offline mode is real.

## Accessibility and design

- Full keyboard navigation for page list, findings, and region handles.
- Region selection mirrored by a numeric bounding-box form for users who cannot drag precisely.
- Findings use icon, label, and pattern in addition to color.
- Screen-reader announcements state page, finding class, and status without reading the secret.
- Zoom up to 400% with reflowing side panels.
- High-contrast mode and reduced motion.
- A plain-language explanation beside each forensic term.
- Mobile view supports inspection, but repair is optimized for desktop due to memory limits.

## First 48-hour kill test

The riskiest assumption is that the tool can distinguish a visual cover from actual content removal across real PDFs without becoming a fragile one-format demo.

Build five fixtures immediately:

1. black rectangle over text;
2. unapplied redaction annotation;
3. OCR layer beneath a scan;
4. incremental update containing old text;
5. embedded attachment containing a token.

By the end of hour 48, the prototype must:

- render all five;
- identify the correct leak class;
- display the affected page/region;
- rebuild one vector case and one raster case;
- reload its own output and find zero seeded tokens;
- keep all processing offline.

Kill or narrow the project if incremental revisions cannot be inspected, if PDF.js geometry cannot be reconciled with raw objects, or if the repair path merely paints another overlay.

## Build order

### August 9-10: forensic proof

Five-fixture kill test, parser inventory, paint order, local-only shell.

### August 11-12: structural scanner

Text geometry, annotations, forms, attachments, metadata, hidden text, revision walker.

### August 13: region workflow

Page viewer, region drawing, candidate list, masked reveal behavior.

### August 14-15: sanitizing rebuild

Vector removal for simple streams and high-assurance raster fallback. No incremental saves.

### August 16: independent verifier

Fresh-worker reload, decoded-stream search, extraction, revision and object-class checks.

### August 17: OCR path

Scanned pages, OCR token geometry, post-repair OCR verification.

### August 18: fixture expansion

Grow to at least 40 adversarial cases and publish a machine-readable test matrix.

### August 19: interface and accessibility

Keyboard regions, status language, high contrast, worker progress, memory errors.

### August 20: performance and offline

Large-file streaming, worker cancellation, service worker, no-network test.

### August 21: external testing

Run documents produced by several common editors; record unsupported cases honestly.

### August 22: freeze and record

No new formats. Demo, screenshots, README, architecture diagram, Devpost copy.

### August 23 before 8:00 PM PT

Clean-profile smoke test, deploy, submit with a multi-hour buffer.

## Demo storyboard, about 2:30

- **0:00-0:10:** Open a synthetic financial-aid PDF with a thick black rectangle. “This looks redacted.”
- **0:10-0:24:** Drag-select the page text or remove the overlay in the forensic view. The hidden identifier appears masked. “It is only covered.”
- **0:24-0:42, winning moment:** The findings panel lights up with selectable text, an earlier revision, and metadata carrying the same token. One visible box caused three independent leaks.
- **0:42-1:02:** Confirm the region and choose high-assurance repair. The page rebuilds locally.
- **1:02-1:22:** Independent verification runs: extraction, raw streams, OCR, revisions, metadata, attachments. All tests turn green with exact labels.
- **1:22-1:38:** Edit a single fixture to add an unsupported filter. The system refuses a green badge and says “not verified,” demonstrating honest failure.
- **1:38-1:55:** Show airplane/offline mode and DevTools network at zero document uploads.
- **1:55-2:15:** Show the adversarial corpus and pass/fail matrix, then a before/after byte-level revision diagram.
- **2:15-2:30:** Download the repaired PDF and verification report. Close with: “A redaction should survive an attacker, not just a glance.”

## Rubric map

### Execution & Build Quality, 30%

- Real parser, renderer, sanitizer, independent verifier, and adversarial corpus.
- Fail-closed behavior and explicit unsupported states.
- Local workers, large-file handling, accessibility, and reproducible tests.
- A complete end-to-end action: inspect, repair, re-attack, download.

### Most Innovative Project

- Treats redaction as an adversarial verification problem rather than a drawing tool.
- Examines paint order, object history, hidden layers, and non-page data together.
- Produces evidence tied to deterministic attacks, not an opaque AI score.

### Most Practical Project

- Solves a common, consequential document-sharing failure.
- Needs no account, paid editor, or cloud upload.
- Works for students, journalists, schools, tenants, nonprofits, and small offices.
- Leaves users with a usable repaired file and an inspectable report.

### Best Overall

The demo has a ten-second hook, the implementation has visible depth, the interface has one coherent job, and success is independently testable.

## Submission checklist

- Project name remains blank until explicitly chosen.
- Elevator pitch under 200 characters should lead with “black rectangle is not a redaction.”
- 3:2 thumbnail: blacked-out page on the left, exposed hidden layer in the middle, verified clean output on the right.
- At least six gallery images: leak map, revision tree, repair choice, verification report, offline proof, fixture matrix.
- Public repo and hosted demo.
- Public video even though the form does not mark it required; it materially improves judging.
- About section: Inspiration / What it does / How built / Challenges / Accomplishments / Learned / Next.
- Built-with tags capped at 25.
- Team contribution states one solo builder.
- README includes threat model, privacy model, supported/unsupported features, fixture generation, test commands, and local setup.

## Repository plan

```text
/
├── README.md
├── LICENSE
├── src/
│   ├── app/
│   ├── pdf/
│   │   ├── parser/
│   │   ├── revisions/
│   │   ├── interpreter/
│   │   ├── geometry/
│   │   └── inventory/
│   ├── findings/
│   ├── sanitizer/
│   │   ├── vector.ts
│   │   ├── raster.ts
│   │   └── rebuild.ts
│   ├── verifier/
│   ├── ocr/
│   ├── privacy/
│   ├── workers/
│   └── accessibility/
├── fixtures/
│   ├── generators/
│   ├── PDFs/
│   └── manifest.json
├── tests/
│   ├── parser/
│   ├── findings/
│   ├── repair/
│   └── e2e/
└── docs/
    ├── architecture.svg
    ├── threat-model.md
    ├── supported-features.md
    └── verification-report.schema.json
```

## Honest loss conditions

1. **The tool scans but cannot safely rebuild.** That is half a product and loses Practicality.
2. **It calls output “safe” after only searching extracted text.** Hidden bytes and revisions are the point.
3. **The parser silently ignores unsupported structures.** Unknown must be visible and fail closed.
4. **The UI reveals real PII in logs or screenshots.** Mask by default and use synthetic demo files.
5. **The fixture corpus is self-serving.** Add files from multiple PDF generators and publish every miss.
6. **It becomes a generic PII highlighter.** User-confirmed regions and adversarial removal remain the core.
7. **Browser memory fails on ordinary files.** Stream pages, use workers, state a tested size limit.
8. **A mature paid tool already does more.** The winning distinction is local, open, inspectable verification with a public adversarial test suite, not a claim that redaction software is new.

The project wins only if the repaired file survives the same attacks that embarrassed the original.