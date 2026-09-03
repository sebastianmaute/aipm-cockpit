# Track D — Ingest Breadth: Design

**Date:** 2026-09-03
**Status:** approved for planning
**Track:** D of a four-track decomposition (A authoring completeness · B bulk-write safety · C planning/calendar writers · **D ingest breadth**)

## Goal

Let the AI Assistant read every source file a project manager actually receives — including
Outlook mail and its attachments — and give every consumer of the attachment pipeline the same
set of supported types.

## Why this track exists

The originating request was "Claude must be able to author documents from app content, and I want
to upload a utilization Excel and have it fill in resources, planning and calendar entries."
Measurement showed that request is four independent projects, not one. This spec covers only D.

Non-goals, deliberately deferred to their own tracks:

- **A** — document authoring completeness (image-insert tool, entity links).
- **B** — bulk-write safety (staged proposal, diff review, one commit, one undo). D widens what
  reaches the model; it does not touch the write path. Nothing in this spec makes the AI write
  anything.
- **C** — allocation and calendar writers.

## Starting position (measured, not assumed)

Already shipped and untouched by this spec:

| Capability | Where |
|---|---|
| `.docx` to Markdown | `extractDocx` |
| `.xlsx` / `.xlsm` to Markdown | `extractXlsx` |
| `.pptx` to Markdown | `extractPptx` |
| PDF | sent native base64; the model reads it directly, scans included |
| Images | png/jpeg/gif/webp |
| Plain text | txt/md/markdown/csv/vtt |
| Zip container reader | `readZipEntries` in `unzip.ts` |
| Router + output cap | `extractOfficeMarkdown` in `office-extract.ts` |
| Classifier | `classifyAttachment` in `chat-attachments.ts` |
| "Process attachment" prompt | `ask-claude-prompts.ts`, already instructs propose-then-confirm |

Three defects and gaps this spec closes:

1. **HTML is accepted but mishandled.** `.html` / `.htm` classify as `text`, so raw markup —
   script, style, navigation chrome — is dumped into the model's context as `text/plain`, spending
   the extraction budget on noise.
2. **`.eml`, `.mhtml`, `.mht` and `.msg` are unsupported.**
3. **The three consumers have drifted.** `chat-panel.tsx`, `step0-import-panel.tsx` and
   `chat-api.ts` each hand-maintain their own accept string and their own read/classify/extract
   sequence. Measured drift: the wizard's list is a strict subset of the assistant's, missing six
   tokens — `.markdown`, `application/pdf`, `image/*`, `text/plain`, `text/markdown`, `text/csv`.
   So a `.markdown` file, or any correctly-typed file with no extension, is filtered out of the
   wizard's picker while `classifyAttachment` would have accepted it. The subset looks accidental:
   it carries `.md` but not `.markdown`, and no MIME types at all.

## Architecture

### Thesis

The drift fix and mail support are the **same refactor**. Today the pipeline lives in its callers:
`classifyAttachment` is pure and synchronous, and each consumer separately reads bytes, decides
whether to call `extractOfficeMarkdown`, and writes its own accept string. Mail breaks that model,
because one dropped file is no longer one attachment — an `.eml` is a tree. Leaving the pipeline in
the callers would force all three to grow their own tree walk, budget accounting and depth guard.

Therefore: hoist read, classify, extract and recurse into one module. Deriving the accept string
from the classifier's own tables then falls out for free, and a new format lights up on every
surface at once.

### Modules

```
attachment-ingest.ts        NEW  orchestrator: read, classify, recurse, budget
  |- chat-attachments.ts    EXT  classify + build block + ATTACHMENT_ACCEPT
  |- office-extract.ts      ---  unchanged
  |- html-extract.ts        NEW  hostile HTML to Markdown
  \- mail-extract.ts        NEW  router + ParsedMail to Markdown
       |- eml-extract.ts    NEW  --> mime-parse.ts  NEW  RFC 5322 / 2045
       \- msg-extract.ts    NEW  --> cfbf.ts        NEW  MS-CFB container
                                 \-- lzfu.ts        NEW  conditional, see "Owed items"
```

Seven new files, plus `lzfu.ts` only if the owed `.msg` measurement says RTF is needed. One-way
dependencies, no cycles. Each is small; the repo norm is 200-400 lines with an 800-line ratchet.

### Three decisions

**1. `.msg` reduces to a bag of named streams, deliberately mirroring the zip reader.**

```ts
readCfbfStreams(bytes: Uint8Array): Map<string, Uint8Array>   // mirrors readZipEntries
```

OOXML is a zip; `.msg` is a compound file. Both reduce to "named binary streams", so
`msg-extract.ts` gets the same shape as `docx-extract.ts` and everything the repo already knows
about that pattern transfers — including how to test it.

**2. One normalised type, two parsers.**

```ts
type ParsedMail = {
  headers: {
    from: string;
    to: readonly string[];
    cc: readonly string[];
    subject: string;
    date: string;          // ISO 8601, or "" when unparseable
  };
  body: { kind: "html" | "text" | "rtf-degraded"; content: string };
  attachments: readonly {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }[];
  diagnostics: readonly string[];   // model-facing disclosure lines
};
```

`.eml` and `.msg` differ only in their parser. Rendering to Markdown, budget accounting, recursion
and disclosure are shared and tested once. This boundary is what stops D from doubling in size.

**3. The recursion is inverted. This is load-bearing.**

`mail-extract.ts` does **not** call back into the ingest pipeline. It returns `ParsedMail` with
attachment bytes raw and unprocessed; `attachment-ingest.ts` drives the tree walk.

Inverting it the other way creates an import cycle (ingest to mail-extract to ingest) and makes
every parser impure and untestable in isolation. As specified, each parser stays a pure function
from bytes to a value — node-testable, no DOM, no mocking — the property `docx-extract.ts` has today.

### HTML projection: own implementation, not a shared one

`htmlPlainProjection` (`rich-text-plain.ts`) is genuinely DOM-free and could be reused, but it
imports `sanitize-html.ts`, which pulls DOMPurify into the module graph and costs the extractor
family its zero-import purity.

`html-extract.ts` therefore carries its own projection: boilerplate drop (script, style, head, nav,
footer), entity decode, and block-structure-to-Markdown. It is a genuinely different job from the
existing helper — hostile web page to Markdown, versus already-sanitized rich text to plain. The
cost is some duplicated tag-stripping; the benefit is that the extractors stay pure and
node-testable, and a mail's HTML body reuses the same extractor.

## Budget and recursion

Existing caps are per-file: `MAX_ATTACHMENT_BYTES` (20 MB in) and `MAX_EXTRACT_CHARS` (200 000
chars out). Recursion breaks both, because one file is now a tree.

```ts
type IngestBudget = {
  charsRemaining: number;   // shared output ceiling across the whole tree
  bytesRemaining: number;   // cumulative decoded input
  nodesRemaining: number;   // total files touched, nested included
  depth: number;
};
```

| Constant | Value | Guards against |
|---|---:|---|
| `MAX_EXTRACT_CHARS` (existing) | 200 000 | one node monopolising the tree |
| `MAX_TREE_EXTRACT_CHARS` | 400 000 | total model-facing output (~100k tokens) |
| `MAX_INGEST_DEPTH` | 3 | mail inside mail inside mail |
| `MAX_INGEST_NODES` | 50 | 200 attachments is an attack or a mistake |
| `MAX_DECODED_BYTES` | 64 MB | heap exhaustion across the tree |

Two output ceilings do different jobs: the per-node cap stops one workbook eating everything, the
tree cap stops the sum.

### Allocation policy

The user requirement is that **both** the mail body and its attachments matter. First-come-
first-served would let a long forwarded thread starve the workbook attached to it, which is the
failure this policy exists to prevent.

1. **Body floor.** Each mail node reserves `MAIL_BODY_FLOOR = 20 000` chars. Under pressure the
   body truncates *to* the floor, never below it.
2. **Equal shares.** Attachments split what remains: remaining divided by attachments left, clamped
   to the per-node cap.
3. **Carry-forward.** Unused share flows to later siblings; a 2 KB CSV does not burn its slice.
4. **Breadth-first, not depth-first.** Depth-first lets the first attached mail's whole subtree
   consume the budget before a sibling attachment is seen. Breadth-first guarantees every direct
   attachment is reached before any nested one. This single choice is what makes the requirement —
   both body and attachments — actually hold.

### Disclosure is mandatory

Every cut emits a marker, following the existing convention in `office-extract.ts`
(`_(document contained no extractable text)_` and its truncation sibling):

```
_(truncated - 3 of 7 attachments omitted for budget)_
_(attachment "Q3-plan.msg" skipped - nesting depth limit)_
_(formatting could not be recovered from this message; plain text follows)_
```

A model handed a silently partial view will report confidently on data it never saw. The register
already records this exact failure class: an export disclosed a policy-refused image as "the bytes
are gone" (open-followups 320). Every omission states that it happened and why.

## Security

CFBF is a filesystem format and MIME is a recursive grammar. Both are hostile-input surfaces, and
both parsers are ours, so the guards live inside the walkers rather than at a library boundary.

### cfbf.ts

| Threat | Guard |
|---|---|
| Cyclic FAT / miniFAT chain | visited-set of sector ids per walk; abort on revisit |
| Chain longer than the file | chain length must not exceed total sector count |
| Directory entry declaring an absurd stream size | clamp to bytes-remaining-in-file **and** to budget *before* allocating |
| Cyclic red-black directory tree (sibling/child pointers) | visited-set on directory entry ids |
| DIFAT loop | same visited-set treatment |
| Absurd sector shift | only 9 (512) and 12 (4096) are legal; reject rather than shift by an attacker-supplied amount |

**★ DIFAT chain walking is mandatory, not an optimisation.** The header carries only the first 109
FAT-sector pointers, covering about 7.1 MB at a 512-byte sector size. Beyond that the DIFAT
continues in chained sectors, each holding `SEC/4 - 1` pointers with its last word pointing to the
next. A reader that stops at the header silently produces an empty directory rather than an error —
measured, see below. Real business mail exceeds this routinely.

### mime-parse.ts

| Threat | Guard |
|---|---|
| Deeply nested multipart | structural depth cap of 10, separate from mail-nesting depth |
| Unbounded header folding or header count | cap header count and total header bytes |
| Malformed base64 / quoted-printable | decode defensively; never throw out of the parser |
| Missing or unterminated boundary | consume the remainder as the part; never loop searching |
| A `message/rfc822` part | this *is* the recursion; counts against `MAX_INGEST_DEPTH` |

### Cross-cutting rule

Parsers return partial results plus diagnostics. **They do not throw.** A corrupt attachment inside
an otherwise-good mail must not lose the mail — mirroring how `extractOfficeMarkdown` degrades to
`_(document contained no extractable text)_` rather than failing.

## Error model

Two classes, two destinations. The split is load-bearing in both directions.

| Class | Examples | Destination |
|---|---|---|
| **Rejection** — nothing ingested | unsupported type, too large, encrypted, corrupt container | the **user**, as today |
| **Degradation** — ingested partially | corrupt attachment inside a good mail, budget truncation, depth limit, RTF fallback | the **model**, as disclosure markers |

Raise a nested corruption as a UI error and the user sees "failed" on a mail that worked. Swallow
it and the model is misled.

**User-visible summary — required.** One compact, non-error line per staged attachment, of the
form `meeting.eml - 4 attachments, 1 skipped`. It signals that something happened without calling
it a failure, and it is the user's only window onto a tree they cannot otherwise inspect. Per
`no-handroll-use-primitives`, this is the only new UI in D and it must be built from shared
primitives.

The existing per-file error accumulation in `chat-panel.tsx` is preserved. That code carries a
comment recording a fixed defect where a multi-file pick overwrote the error state so only the last
failure showed; the ingest refactor must not reintroduce it.

### i18n

- **Disclosure markers stay English and stay out of i18n.** They are model-facing, never rendered
  to a user, and the repo requires pure engines to be i18n-free. `office-extract.ts` already
  hardcodes its markers in English; this follows that precedent exactly.
- **One new user-facing key:** `chatAttachmentEncrypted`. RMS-protected Outlook mail and
  password-protected workbooks are common, and today surface as the generic
  `chatAttachmentReadFailed`. The distinction matters because the user's action differs — re-save
  it unprotected. Everything else malformed stays on `chatAttachmentReadFailed`.
- Both dictionaries move together (`tsc` enforces EN/DE key parity). `i18n.de.ts` must be patched
  by a node UTF-8 write against CRLF anchors, never the Edit tool, or the umlauts corrupt.

### Type widening

`AttachmentKind` gains `"html"` and `"mail"`:

```ts
type AttachmentKind = "pdf" | "image" | "text" | "office" | "html" | "mail";
```

HTML moves off `"text"` so it routes through the new extractor instead of dumping raw markup. This
changes what existing users get today and is the intended behaviour fix. Every switch over the
union widens with it — TypeScript exhaustiveness finds them, including `mimeForKind` in
`step0-import-panel.tsx`.

### File picker prefilter

`chat-attachments.ts` exports a single `ATTACHMENT_ACCEPT`, derived from the same extension and
MIME tables `classifyAttachment` consults. All three consumers use it. New formats — `.eml`,
`.msg`, `.mhtml`, `.mht` — appear in every picker the moment the classifier knows them, and the
six-token drift cannot recur because there is nothing left to hand-maintain.

## Testing

The `Map<string, Uint8Array>` boundary means container reading and format parsing are tested
separately, and neither needs a real file. Precedent: `docx-extract.test.ts` builds a stream map
straight from an XML string; `unzip.test.ts` builds zips with the repo's own `buildZip` and
base64-inlines one real file.

| Module | Input | Test shape |
|---|---|---|
| `mime-parse.ts` | text | template literals; `.eml` is text, so no binary handling at all |
| `eml-extract.ts` | `MimeMessage` | value to value |
| `msg-extract.ts` | `Map<string, Uint8Array>` | synthetic stream maps; no `.msg` file needed |
| `html-extract.ts` | string | string to string |
| `attachment-ingest.ts` | tree + fake extractors | budget and recursion are arithmetic; fully synthetic |
| `cfbf.ts` | container bytes | the only module needing real bytes |

The riskiest logic in D — breadth-first allocation, body floor, carry-forward, depth and node caps
— needs no parser and no fixture.

### The corpus problem, and the trap in the obvious answer

Real mail carries PII and cannot be committed. The natural answer is a minimal CFBF **writer** in
the test file, mirroring `buildZip`.

**That is a closed loop.** A reader tested only against our own writer proves self-consistency, not
correctness: both can share the same misreading of the specification and agree forever.
`unzip.test.ts` knows this, which is why it also base64-inlines a real zip.

So:

- **Synthetic writer** — all guard and edge cases, which cannot be found in the wild anyway.
- **One genuine Outlook-produced `.msg`**, reduced to minimum, stripped of content, base64-inlined.
  Without it, `cfbf.ts` is only proven self-consistent.
- **Gitignored local corpus** — the one-time body-stream measurement and the owed eye-verify. Never
  committed.

### Malformed-input cases

Each asserts that the guard fires **and** that the degradation is disclosed:

| Case | Asserts |
|---|---|
| Cyclic FAT chain | visited-set aborts, no hang |
| Chain longer than file | rejected |
| Directory entry claiming an absurd size | clamped before allocation |
| Illegal sector shift | rejected |
| Cyclic directory tree | visited-set aborts |
| MIME unterminated boundary | remainder consumed, no loop |
| MIME 50-deep nesting | depth cap fires |
| MIME header flood | header cap fires |
| Mail nested 4 deep | `MAX_INGEST_DEPTH` fires and discloses |
| Budget exhausted mid-tree | later siblings marked omitted and disclosed |

### Mutation discipline

Every guard is mutation-proved: delete the visited-set and the cyclic-chain test goes red; remove
the depth check and the nesting test goes red. Recorded as N failed / M passed, with the sum equal
to the file's runtime test count.

Disclosure assertions need this most. A test asserting a marker's *presence* passes trivially
against a build that emits markers unconditionally, so each must be mutation-proved in **both**
directions — against a never-emit build and against an always-emit build. Otherwise the assertion
is decorative.

### Gate consequences

- New `.ts` files under `src/app` are coverage-gated (lines 92 / funcs 91 / branch 80 / stmts 89).
  These parsers are pure, so the ceiling is reachable, but branch 80 will not come free: the
  malformed-input branches are most of the branch count and are only hit if the table above is
  actually written.
- `attachment-ingest.ts` holds real logic, not UI glue, so it stays coverage-gated rather than
  joining the `coverage.exclude` allow-set.
- `size:check` counts the split-on-newline length, one more than `wc -l`. Budget module sizes from
  the script's own number.
- Every `src/app` TypeScript file is CRLF. Anchored node writes must match CRLF; the Write tool
  re-lines a CRLF file to LF while Edit preserves it.

## Measured against a real `.msg` (2026-09-03, n=1)

One genuine business email — a workshop follow-up with two Office attachments — was probed with a
throwaway CFBF reader. It is a client message and its content stays out of this repository; only
structure is recorded here.

| Property | Value |
|---|---:|
| File size | 17 843 712 B (17.8 MB) |
| Sector size / mini sector | 512 / 64, cutoff 4096 |
| FAT sectors | 273 |
| DIFAT sectors (chained, beyond the header's 109) | **2** |
| Directory entries | 274 (251 of them `__substg1.0_*` property streams) |
| Recipients | 8 |
| Attachments | 2 — a `.pptx` of 16.7 MB and a `.docx` of 45 KB, both with correct MIME tags |
| `PR_BODY` (plain, unicode) | 2 078 B — complete and readable |
| `PR_RTF_COMPRESSED` | 3 242 B — present |
| `PR_HTML` | **8 B** — `06 bd 68 da 15 00 24 00`, not HTML |

### What this changes

1. **The ladder's ordering assumption was wrong.** The design predicted a real HTML body stream
   would usually be present, making RTF a minority path safely deferred. Measured: the HTML stream
   is 8 bytes of non-HTML and the only formatted body is RTF.
2. **But the conclusion is softer than "LZFu is now mandatory".** The plain-text body is complete,
   so the model still receives the full message without RTF. What RTF buys is **structure — above
   all tables**. A mail whose allocations sit in a table degrades to shapeless prose without it.
   Deferring LZFu is still defensible; it is now a measured trade rather than an assumed one, and
   the disclosure marker for the degraded case stops being a rare path.
3. **`MAX_ATTACHMENT_BYTES` will bite.** One ordinary email with a slide deck reached 17.8 MB
   against a 20 MB cap. The cap is applied to the envelope, so mail needs either a raised ceiling
   or a cap applied per extracted node instead.
4. **The recursion design is validated end to end.** This file exercises CFBF to `msg-extract` to
   `ParsedMail` to recursion to `extractPptx` and `extractDocx`, all of which already exist. The
   budget numbers also hold against it: a 2 KB body against a 20 KB floor, then two attachments
   splitting the remainder under a 200 K per-node clamp.
5. **The reader was validated by its own output** — plain body, attachment filenames and MIME tags
   all decoded correctly — so the 8-byte `PR_HTML` is a real measurement, not a parsing error.

### Fixture consequence

This file **cannot** be the committed fixture: real names, a real customer, a real deck. The
inlined real-format fixture the Testing section requires must be synthetic, or an aggressively
sanitised message produced for the purpose. The privacy constraint does not weaken the argument for
having one — a synthetic file written by Outlook is still Outlook-produced, which is the property
that matters.

## Owed items — gates, not assumptions

1. **`.msg` body-stream measurement — PARTIALLY DISCHARGED 2026-09-03, and the original assumption
   was refuted.** See "Measured against a real `.msg`" above. Still owed: 4-9 more files, in
   particular a mobile-sent message and a forwarded thread, before the LZFu decision is final.
2. **Licence question, only if LZFu is ported.** `@kenjiuno/decompressrtf` is BSD-2-Clause and is
   the port candidate. This project is EUPL-1.2 and marked private, and currently contains zero
   third-party code — D would introduce the first. Permissive-inbound-to-copyleft is the normal,
   uncontroversial direction, but EUPL-1.2 Article 1 defines "Distribution or Communication"
   broadly enough to plausibly cover network delivery, which would mean attribution obligations
   fire despite the private flag. One question to counsel; not a blocker on starting D.
3. **One real reduced `.msg` fixture**, or `cfbf.ts` is only self-consistent (see Testing).

## Reference implementations

Not dependencies. Read for understanding and for their bug history, which is the expensive
knowledge and free to learn from:

- `@kenjiuno/msgreader` (Apache-2.0) — `.msg` structure and years of real-world edge cases.
- SheetJS `js-cfb` (Apache-2.0) — container reading.
- `postal-mime` (MIT-0) — MIME parsing.

Authoritative sources are the published Microsoft specifications: **MS-CFB** (compound file),
**MS-OXMSG** (`.msg` layout), **MS-OXPROPS** (property tags), **MS-OXRTFCP** (RTF compression).
Property tags are facts from a specification, not creative expression; derive from the spec.

## Out of scope

- Any AI write path. D changes what the model can *read*, nothing else.
- Reading mail from the mailbox via Microsoft Graph. `graph-mail.ts` already declares the mail
  scopes and the Graph host is CSP-allowlisted, so it is architecturally close — but it is a
  different product decision (whole-mailbox consent versus dragging a file), and it belongs in its
  own track.
- Archive formats such as `.zip` and `.7z` as attachments.
- OCR of scanned images. PDFs already reach the model natively, which covers most of this.
