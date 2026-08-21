# CSV section splitting must respect quoted cells — design

**Register entry:** `docs/open-followups.md` §105 (open, silent data loss).
**Date:** 2026-08-16. **Base:** 0.240.0 "Elliott" (`5a87026a`).

---

## 1. The defect

`splitCsvSections` (`csv-codecs-decode.ts`) segments a marker-delimited CSV by walking
**physical text lines**, before any tokenizing:

```ts
const lines = csv.split(/\r?\n/);          // raw split, BEFORE any tokenizing
for (const line of lines) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith(CSV_SECTION_BUDGETS)) { mode = "budgets"; continue; }
  // …26 more markers
```

A quoted cell legitimately contains newlines, so its continuation lands on its own physical
line. If that continuation begins with a section marker, `startsWith` fires and the parser
switches section **mid-row**. `trimStart()` means leading whitespace does not protect it.

The encoder is correct — `csvEscape` quotes any value containing `,`, `"`, `\n` or `\r`.
**Only the reader is broken.** But `local-file-backend` reads and writes the same file, so a
load-then-save cycle persists the loss to disk. `sharepoint-backend` has the same pair.

### 1.1 Damage — measured, not reasoned

The register records the damage as one truncated field:

```
blockers: "step one\n# RAID\nstep two"   →   "step one"
```

That fixture has a **single** task, which conceals the real blast radius. Re-measured on
2026-08-16 with four tasks, one carrying the hostile value:

```
PROBE tasks in  : 4
PROBE tasks out : 1
PROBE ids out   : [1]
PROBE blockers  : "step one"
PROBE raid out  : 0
PROBE diag      : {"droppedRows":0}
```

Tasks 2, 3 and 4 are **destroyed outright** — they do not reappear as RAID items, and
`droppedRows` is **0**. Every row after the hostile cell dies, up to the next real marker.

### 1.2 Why the existing counter is blind

`decodeCsvSection` does count rejects (`else if (diag) diag.droppedRows++`), so the swallowed
rows should have been counted. They were not. Measured mechanism:

```
MECH tasks rows : [["id","taskName","blockers"],["1","T1","step one"]]
MECH raid rows  : 1
MECH raid dump  : [["step two,x\r\n2,T2,\r\n3,T3,\r\n4,T4,\r\n# RAID\r\nid,category,title"]]
```

The split leaves an orphan `"` at the head of the RAID buffer. `parseCsv` treats it as an
opening quote and **absorbs the entire rest of the section into one cell**.
`decodeCsvSection` takes that single cell as the header row, finds zero data rows, and never
calls `build` — so nothing is ever rejected.

★★ **The rows are ABSORBED, not REJECTED.** Any detector built on reject-counting is
structurally blind to this. So is "rows found vs entities produced": one row found, zero
entities, shortfall zero. An earlier draft of this design proposed exactly that counter; it
would have shipped a detector that sits there reporting nothing.

### 1.3 Reachability — traced, not argued

The register says the claim that a UI writer puts a newline in `blockers` is "argued, not
traced — settle that before pricing a fix". Settled:

- `task-form-fields.tsx` binds `form.blockers` to a `<textarea>`.
- `task-row.tsx` renders `renderInlineTextarea("blockers", …)`; its own comment reads
  "Multiline inline cell (blockers): double-click the cell to open a textarea".
- `use-chat-dispatcher.ts` writes `blockers` from an AI tool call via `sanitizeBlockers`.

Pressing Enter is sufficient. There are 27 markers, all `# UPPERCASE`
(`# TASKS`, `# RAID`, `# PLAN`, `# CHANGES`, `# ROLES`, …) — shapes that occur naturally in
pasted notes.

### 1.4 Stale facts in the register itself

Both corrected as part of this slice:

- Its reproduce command records **26** markers
  (`grep -c "trimmed.startsWith(CSV_SECTION" src/app/csv-codecs-decode.ts`). The answer is
  now **27** — `# ACTIVITY LOG` landed after the entry was written.
- Its damage claim (one truncated field) understates §1.1.

---

## 2. Approach

Three were considered.

| | Approach | Verdict |
|---|---|---|
| **A** | Quote-aware line splitter; sections stay text | **Chosen** |
| B | Tokenize once, group `string[][]` rows by marker | Rejected — changes all 27 section outputs, `decodeCsvSection` and every `csvTo*` signature |
| C | Tokenize once, re-serialize each section back to text | Rejected — re-escaping inserts an encode step into a decode path; a cell the original quoted unnecessarily comes back different |

A is the smallest change that is still correct at the root. Its honest cost is a **second
scanner** that must agree with `parseCsv` about quoting; mitigated by sharing one quote-state
step and pinning the pair with a differential test (§4).

### 2.1 The normalization trap

Today's code does `split(/\r?\n/)` and later `join("\r\n")`. That round trip **converts a
newline inside a quoted cell from LF to CRLF**. It is an artifact of breaking the cell apart
and reassembling it — not a deliberate codec rule — but it is **pinned behaviour**:

- `codec-roundtrip.property.test.ts` defines `csvNewlines(s) = s.replace(/\r\n|\n/g, "\r\n")`
  and its header says "CSV — a bare LF becomes CRLF (see `csvNewlines`)".
- The **live** task round-trip property asserts `taskName: csvNewlines(v.taskName)`.
- The **skipped** §105 test asserts `blockers: csvNewlines(t.blockers)`.

★★★ A naive quote-aware splitter keeps the cell intact, so the inner LF survives as LF — and
the live property tests go red, as does the skipped §105 test this slice exists to unskip.
**The artifact must be preserved deliberately.**

---

## 3. Design

### 3.1 New module `src/app/csv-line-scan.ts`

Pure, DOM-free, no imports. A separate leaf because `csv-codecs-core.ts` stands at **776** of
the 800-line cap and is not baselined (`size:check` counts `wc -l` + 1, so its real headroom
is 24 lines), and because the scanner is worth testing on its own.

```ts
export function splitCsvLines(text: string): {
  lines: string[];
  unterminatedQuote: boolean;
};
```

Three steps, in order:

1. **Normalize break points only** — `text.replace(/\r?\n/g, "\r\n")`. This is exactly the set
   of positions the current regex treats as breaks. A **bare `\r` is deliberately left
   untouched**: `split(/\r?\n/)` does not split on it either, and normalizing it would collide
   with §106 (bare-CR erosion in the Markdown codec), which is out of scope.
2. **Quote-aware scan** — walk the text tracking `inQuotes`, honouring the `""` escape exactly
   as `parseCsv` does, and split on `\r\n` **only** when outside quotes.
3. **Report** whether the scan ended inside a quote.

Step 1 is what preserves the §2.1 artifact: the inner newline is normalized to CRLF *before*
the cell is kept intact, so the value the decoder returns is byte-identical to today's.

### 3.2 Call-site change

`splitCsvSections` changes **one line** — `csv.split(/\r?\n/)` becomes `splitCsvLines(csv)` —
plus writing the flag into the diag. All 27 sections, `decodeCsvSection`, `csvRowsToObjects`
and the `join("\r\n")` reassembly are untouched.

★ Precisely what is preserved: a file decodes **byte-identically to today unless a quoted
cell's continuation line begins with a section marker** — which is the defect itself, and the
only case whose output is meant to change. Do not restate this as "every well-formed file
decodes identically": a file exercising the defect is well-formed CSV, and that phrasing
claims the fix changes nothing. Multi-line quoted cells that do *not* begin a line with a
marker are already reassembled correctly today (both physical lines land in the same buffer
and `join("\r\n")` puts the cell back), so those are genuinely unchanged.

### 3.3 Shared quote state

Both scanners consume one **character-level** step rather than spelling the quoting rules
twice. The step must be character-level, not chunk-level: `parseCsv` builds cells inside its
loop, so it cannot hand a chunk to a helper and resume.

```ts
/** Non-null only when the char at `i` is quote-relevant (`"` or an escaped `""`).
 *  Returns the new quote state and the index to resume from. */
export function quoteStep(
  text: string, i: number, inQuotes: boolean,
): { inQuotes: boolean; next: number } | null;
```

Both loops call it first and fall through to their own handling when it returns null, so a
change to the escape rule cannot land in one scanner and miss the other.

★ This is a mitigation, not a proof. The two loops remain separate code, and the thing that
actually guarantees agreement is the differential property test in §4 — if `quoteStep` turns
out not to fit `parseCsv` cleanly during implementation, **keep the differential test and drop
the shared step**, rather than bending `parseCsv` around a helper that does not suit it.

### 3.4 Loudness

`ImportDiag` gains one optional flag, set by `splitCsvSections` from the scan:

```ts
export interface ImportDiag extends DocTruncationDiag {
  droppedRows: number;
  unterminatedQuote?: boolean;
}
```

Post-fix this can only fire on a genuinely unbalanced file — hand-edited, truncated mid-write,
or a foreign export — which is the remaining silent-loss vector once misrouting is gone.

**Producers.** `local-file-backend` and `sharepoint-backend` already build an `ImportDiag` and
publish `lastImportDroppedRows`; each gains a sibling publish for the new flag.

**Consumer widening.** Today `lastImportDroppedRows` has exactly **one** reader
(`use-storage-file-ops.ts`, which fires `showToast("error", "importDroppedRowsWarning")` after
a project load). `truncationOps.reportFor` has **five** call sites. The reporting moves into
`reportFor`, whose parameter widens from `Pick<StorageBackend, "lastLoadTruncation">` to also
carry `lastImportDroppedRows` and `lastImportUnterminatedQuote`; the standalone toast is
deleted as a duplicate.

Three things fall out:

- dropped rows reach 5 load paths instead of 1;
- both signals travel one call, so they cannot drift apart;
- it inherits the existing completeness net — `use-load-truncation.test.ts` asserts
  `it.each(OPS_FILES)("%s reports every load it performs")`, i.e. `reportFor` calls equal
  `.load()` calls — which is what catches a future path forgetting to report.

**Inherited decision, stated not assumed.** `use-storage-backend.ts` has one deliberate
non-call of `reportFor`, whose inline reason is document-specific: that path applies tasks and
RAID only, never the loaded documents. Folding import diagnostics into the same call means it
also stays quiet about dropped rows. That is correct — it does not apply the loaded workspace
wholesale — but the decision is inherited, so its inline comment is **extended** to say so
rather than left for the next reader to rediscover.

**Producer gap, deliberately not closed.** `browser-backend` and `turso-backend` build the
narrower `DocTruncationDiag` and structurally cannot carry a row count. This is the
"cautionary precedent" `backend-truncation-registry.test.ts` already names — declared on the
shared interface, implemented by two of four backends. Closing it is a separate slice.
Recorded, not attempted.

### 3.5 i18n

One new EN/DE key pair modelled on `importDroppedRowsWarning`, naming a file whose quoting is
unbalanced and warning that rows may be missing. DE takes real umlauts and is written via a
node UTF-8 write against `\r\n` anchors — `i18n.de.ts` is CRLF and the Edit tool corrupts
umlauts there. Key parity is tsc-enforced.

---

## 4. Testing

| Test | Pins |
|---|---|
| `csv-line-scan.test.ts` | newline inside quotes does not break a line; `""` escape; unterminated-quote flag; **bare `\r` untouched** (the §106 boundary); equivalence with the old regex on well-formed input |
| Differential property test | `splitCsvLines` and `parseCsv` agree on quote state over hostile strings — the two scanners cannot drift |
| Unskip the §105 block in `codec-roundtrip.property.test.ts` | passes **as written**; §3.1 step 1 preserves its `csvNewlines` expectation |
| New multi-row regression | 4 tasks in, 4 out. The register's single-task fixture is what concealed §1.1 |
| Loudness test | an unbalanced-quote file sets the flag and surfaces a toast through `reportFor` |
| `golden-workspace.test` | must stay green — the encode path is untouched, so movement there means the fix leaked |

`npx tsc --noEmit` after every test edit (vitest never typechecks). `npm run test:shuffle`
before pushing — the only local reproduction of the `unit-tests-shuffled` gate.

★ Mutation-check the two guards that are easy to get vacuously green: revert step 1 of
`splitCsvLines` and confirm the live round-trip property goes red; revert the quote-awareness
and confirm the multi-row regression goes red. A guard that cannot fail is not a guard.

---

## 5. Scope

**In:** the splitter, the shared quote state, the diag flag, the consumer widening, the i18n
pair, the tests above, the §105 register corrections from §1.4, and closing §105.

**Out:** §106 (Markdown bare-CR erosion — the sibling `describe.skip` in the same file);
§133; the Turso/IndexedDB producer gap.

**Release:** a user-visible data-loss fix, not a refactor — so a version bump, a `CHANGELOG.md`
entry, a `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` with EN/DE strings, and the
five ungated version sites (`package.json`, `package-lock.json` ×2, the README badge, the five
`docs/CODEMAPS/*.md` headers). Fetch before bumping — the number moves under you.

**Carried in:** this branch also carries three doc fixes made before the slice was chosen —
`AGENTS.md` ×2 and `README.md` ×1 still described the dashboard as masonry, and §64's
`VarianceSummary` citation named a file the symbol had left. Folded in at the user's
direction.
