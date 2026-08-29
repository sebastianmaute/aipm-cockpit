# Import-loss reporting and the template rich-field carry — Design

**Goal:** Close four register entries that share one theme — data lost, or loss left unreported, on a
load or an import path — without touching the classifier that decides what stored rich text *means*.

**Architecture:** A malformed-quote detector added to the existing CSV scan, surfaced as a third
cause on the incomplete-load guard; the import-diagnostics channel split from that guard and given
per-section attribution; and a DOM-free note-log carry through template capture/apply, with the
allow-list pass placed in the one module outside the sample generator's import graph.

**★★★ SEQUENCED BEHIND `fix/meta-decode-loss-chain`.** That branch is cut from the same base, lands
first, and this slice rebases onto it and adopts its vocabulary. Both slices touch
`use-load-truncation.ts`, `use-storage-backend.ts` and the `reportFor` census; an earlier draft of
this spec renamed the same three guard symbols to different names, which would have been a hard
conflict. See §3 and §4.

**Closes:** §150, §152, §168, §36(a).
**Deliberately out of scope:** §32 (see "Out of scope").

---

## 1. Why these four travel together

All four sit on the boundary where foreign or captured data enters the workspace, and all four fail
the same way: the data is wrong or gone, and nothing says so.

- **§150** — a balanced pair of stray quotes swallows a section marker, so milestones enter the
  workspace *as tasks*. Both diagnostics read false. Autosave then writes the mislabelled workspace
  back over the source.
- **§152** — `TruncationOps.reportFor` carries two independent signals on one call, so a path that
  must not touch the §103 documents flag cannot report an import loss either. Tasks and RAID are
  applied from a malformed CSV with no toast, no banner, and no `logDiag` trail.
- **§168** — template capture assigns live entity arrays by reference, so a captured template really
  does carry note logs; import then drops every one of them, because the seed sanitizers are DOM-free
  and never mention the field.
- **§36(a)** — what *does* survive (`description`) passes through `sanitizeRichText` with no
  allow-list pass. Before 0.210.0 it went through `plainToHtml`, which escaped `& < >`, so this
  boundary got *less* strict in a release about write boundaries.

§152 and §150 share a channel: the split §152 needs is what carries §150's new signal. §168 and
§36(a) share a seam: the same carry, one sanitised and one not.

---

## 2. What was measured during design

Each of these was run, not reasoned. Re-run them rather than trusting this section.

**(a) The malformed-quote detector is decidable, and the register's "undecidable" verdict is about a
different question.** §150 proves *intent* is undecidable — a swallowed marker and a legitimately
quoted marker-shaped cell are byte-identical — and correctly rejects a "the two splits disagree"
detector, which would fire on every correct import. **Malformedness is a separate, decidable
property.** `quoteStep` toggles on any `"` with no check on position:

```bash
grep -n "text\[i\] !== " src/app/csv-line-scan.ts
```

A `"` opening a region mid-field, or closing one without a following delimiter, is an RFC 4180
violation. `csvEscape` wraps any cell containing `"` and doubles the inner quotes, so nothing this
app writes can trip it — and §105's legitimate case is *properly* quoted, so it does not trip it
either. That is the discrimination the rejected detector lacked.

**(b) `template-apply.ts` is outside the sample generator's import graph; `templates.ts` is inside
it.** The guard in `rich-text-plain.test.ts` bans any file in that graph from importing
`rich-text-projection` or `ai-rich-text`, the two DOMPurify-calling modules. Resolved with the same
algorithm the guard uses:

| in the graph | outside it |
|---|---|
| `templates.ts` | `template-apply.ts` |
| `csv-codecs-decode.ts` | `new-project-workspace.ts` |
| `markdown-codecs-decode.ts` | `use-load-truncation.ts` |
| `csv-line-scan.ts` | `use-storage-backend.ts` |

So §36(a)'s allow-list pass goes in `template-apply.ts` — which is already where the seed's tasks are
sanitised on apply, by its own `★★★` comment. It is a pure module, not a component, so it stays
unit-testable.

**(c) The guard's own graph-size comment is stale.** It says 76 files; the resolver returns **92**.
The assertion is `> 50`, so the guard is green and always was. Correct the comment in the same commit
that touches the file, per the repo's correct-what-you-disprove rule.

**(d) §152's attribution is ~27 call sites, not five.** The register says "all five decoder sites",
which counts *increments*. Two of the three CSV increments and one of the two Markdown increments sit
in **generic** helpers, so the section key must be threaded in by every caller. The table in §4 has
the split and the commands to re-derive it. This does not change the design; it changes the estimate,
and it is the single largest cost in the slice.

**(e) The retracted rationale does not change the constraint.** §151 records that "the sample
generator runs under bare node" is false — the generator installs a jsdom `window`/`document` before
its dynamic import. The guard's comment still gives that as its reason. The ban is real and blocking
regardless, and `csv-line-scan.ts`'s zero-import rule stands on its leaf argument. **Design around
the constraint; do not weaken it, and do not re-derive a fifth retraction — §151 owns that cluster.**

---

## 3. §150 — detect malformed quoting, hold the commit

### Detection

Extend the existing single walk in `splitCsvLines` (`csv-line-scan.ts`). Two violations, both local:

1. **Stray open** — a `"` encountered while not inside quotes and not at a field start (field start =
   immediately after `,` or at the beginning of a line).
2. **Stray close** — a `"` that closes a quoted field where the next character is neither `,` nor a
   line break nor end of input.

`quoteStep` is shared with `parseCsv` and **must not change**, so the position tracking lives in
`splitCsvLines`, which already walks with the context needed. `csv-line-scan.ts` keeps **zero
imports** — the counter needs none.

`splitCsvLines` returns an added `malformedQuotes: number`. `splitCsvSections` forwards it onto
`ImportDiag`; both backends that publish import diagnostics expose it as
`lastImportMalformedQuotes`.

CSV only. `lastImportUnterminatedQuote` is already documented CSV-only, and Markdown has no quoting
to malform.

### The hold

The import **proceeds** — the user must be able to see and export what loaded. The **commit** is
held, on the same sticky mechanism §103 already uses, because the damage in §150 is autosave writing
the mislabelled workspace back over its source.

**★★★ THIS SLICE SEQUENCES BEHIND `fix/meta-decode-loss-chain` AND ADOPTS ITS VOCABULARY.** That
branch, cut from the same base (`24581bc6`), generalises this guard first: truncation stops being the
only reason a load is incomplete, because a malformed meta blob leaves a slice undefined and must
pause saving for the same reason. It renames the three cause-agnostic names ahead of its behavioural
change:

| before | after |
|---|---|
| `loadWasTruncated` | `loadWasIncomplete` |
| `mayCommitAfterTruncation` | `mayCommitAfterIncompleteLoad` |
| `allowTruncatedSave` | `allowIncompleteSave` |

**Do not re-do that rename here, and do not invent a competing one.** An earlier draft of this spec
proposed `loadIsHeld` / `mayCommitAfterLoadHold` / `allowHeldSave` for the same three symbols — a
direct collision. Rebase onto their branch once it lands and use their names.

★★ Their branch is **not pushed**, so these names are not yet fixed. Verify the three at
implementation time rather than trusting this table:

```bash
grep -rn "loadWasIncomplete\|mayCommitAfterIncompleteLoad\|allowIncompleteSave" src/app --include=*.ts --include=*.tsx
```

### The shape to follow

They deliberately do **not** use a discriminated union. Each cause gets its own state slot, with one
derivation over all of them — their reasoning being that the hook's warning against a second
`useState` is about restating the *same* fact twice, whereas a different cause is a different fact
with different data:

```ts
const [truncation, setTruncation] = useState<{ entries: number; blocks: number } | null>(null);
const [decodeFailures, setDecodeFailures] = useState<readonly string[] | null>(null);
const loadWasIncomplete = truncation !== null || decodeFailures !== null;
```

§150 is therefore a **third slot** and nothing more: `malformedQuotes: number | null`, folded into
`loadWasIncomplete`, cleared by `allowIncompleteSave` alongside the other two, recorded in
`reportFor`, and **lowered on a clean load** exactly as the other causes are. This is strictly
additive to their design — no restructuring, no rename.

Everything the existing guard holds must still hold: `clearForFreshWorkspace` clears it for
built-not-loaded workspaces; `wouldRefuseWrite` stays non-mutating while
`mayCommitAfterIncompleteLoad` still spends the one-shot bypass; the escape hatch stays reachable
from the UI. `truncationOps` / `TruncationOps` keep their names — they are the load/flush choke
points, which is what they are named for.

### Strings

The §103 banner reads "documents could not be opened", which is false for this hold. New EN+DE pairs:
one banner sentence and one toast sentence for malformed quoting, saying that the file's quoting is
malformed, that rows may have been read as the wrong type, and that saving is paused until confirmed.
Both must be complete sentences, because `reportImportDiagnostics` joins applicable parts with a
single space.

---

## 4. §152 — split the signals, then attribute the loss

### The split

Add a second op to `TruncationOps` that reports import diagnostics **without** touching the load
hold, for the path that must not raise the §103 flag. `reportFor` keeps its current behaviour.

The census test in `use-load-truncation.test.ts` counts a `reportFor` per `backend.load()` and is
what catches a new load path that forgets to report. It must be widened to accept **either** op, or
it fails on the new path — and widening it must not let a path reporting *neither* pass.

★★ **`fix/meta-decode-loss-chain` rewrites this same census first**, so compose with its version, not
with today's. That branch widens the census beyond its hardcoded two-file `OPS_FILES` (which misses
`use-storage-backend.ts`, holding three of the six load sites) and introduces a
`REPORT_EXEMPT_MARKER` comment — `"NO reportFor:"` — for paths that legitimately do not report. Two
consequences: the second op must be counted as satisfying the census, and it must **not** be
expressible via the exemption marker, or a path can claim exemption while silently reporting nothing.
Read their final version before editing; the marker string is not yet pushed and may change.

### The attribution

`ImportDiag.droppedRows: number` is workspace-wide, so even a split report cannot say whether the
dropped rows were the tasks/RAID this path **applies** or a section it **discards** — different
losses, different remedies. Add per-section counts and keep the flat total as a derived value so
existing readers do not churn:

```ts
export interface ImportDiag extends DocTruncationDiag {
  droppedRows: number;                                  // total, derived
  droppedBySection?: Partial<Record<ImportSectionKey, number>>;
  unterminatedQuote?: boolean;
  malformedQuotes?: number;
}
```

`ImportSectionKey` is **new** — no such union exists today. Introduce it codec-neutrally (a section
is the same concept in both families) and derive it from the 28 `CSV_SECTION_*` constants in
`csv-codecs-sections.ts`, narrowed to the sections whose decoders can actually reject a row. Config-
blob decoders, blank rows and dangling-dependency pruning are not counted today and must not start
being counted, or the total changes meaning.

**Sizing — the register's "five decoder sites" counts increments, not call sites.** Measured: the
increments sit in three **generic** helpers plus two direct decoders, so section identity has to be
threaded in as a parameter by every caller.

| helper | call sites |
|---|---|
| `collectRows<T>` (CSV) | 5 |
| `decodeCsvSection<T>` (CSV) | 8 |
| `csvToTasks` (increments directly) | 1 |
| `decodeMdTable<T>` (Markdown) | 12 |
| `markdownToTasks` (increments directly) | 1 |

Roughly **27 call sites**, each a one-argument edit, plus three helper signatures. Mechanically
simple and individually trivial; the cost is the count, not the difficulty. Re-derive it rather than
trusting this table:

```bash
grep -nE "collectRows[<(]|decodeCsvSection[<(]" src/app/csv-codecs-decode.ts
grep -rn "decodeMdTable" src/app/*.ts | grep -v "\.test\." | grep -v "export function"
```

Every increment updates both the total and its section bucket in one place, so the two cannot
disagree.

The toast names the sections. Map each section key to an entity-name i18n key through a typed
`Record<ImportSectionKey, TranslationKey>` — `TranslationKey` is real (`keyof typeof enUS`,
`i18n.ts`) — so a new section fails `tsc` rather than silently rendering nothing. Verify an
entity-name key exists for every section in the union before writing the map; add EN+DE pairs for any
that has none.

### Ordering — the part that has already shipped a false green

A caller must fire its own "loaded"/"switched"/"reloaded" toast **before** calling the report, never
after. The toast surface is single-slot: `useToast` holds a `useState<Toast | null>` and `showToast`
replaces with no queue, so of two calls in one stretch only the last survives. A test asserting
`showToast` **was called** cannot see this defect — **assert on the last call**.

---

## 5. §168 + §36(a) — carry the note log, then allow-list it

### The carry (§168)

Add `sanitizeSeedNoteLog` to `templates.ts`, wired into `sanitizeSeedTask` and
`sanitizeSeedRaidItem`, and into the change route so all three registers behave alike. Per entry:
validate `id` and `timestamp`, carry `authorResourceId` / `authorName` / `editedAt` when present, run
`sanitizeRichText` on `html`, and derive `text` from the sanitised html rather than trusting the
captured projection.

This is byte-for-byte the posture `description` already has in `sanitizeSeedTask` — DOM-free, no new
imports, and therefore legal inside the generator's import graph. **Do not re-attach the log after
sanitizing**: that shortcut stores it un-sanitised, and the import-graph guard exists to stop the
reflexive fix.

### The allow-list (§36(a))

In `template-apply.ts` — outside the graph, and already the apply-time sanitiser — add a pass over
the seed's rich fields: `description` and every note-log `html`. This is what makes the carry safe
rather than merely present, and it restores the strictness lost when the boundary moved from
`plainToHtml` to `sanitizeRichText`.

Exposure today is genuinely low and the spec should not overstate it: there is no template
file-import channel (`importTemplate` / `exportTemplate` do not exist), a template is captured from
your own workspace into your own settings, and every read re-sanitises at its sink. This is taken
because the seam is already open, not because it is urgent.

---

## 6. Testing

**§150**
- Detector unit tests: stray open, stray close, and the two together.
- **The §105 legitimate case as an explicit control** — a properly quoted cell containing
  `# MILESTONES` must **not** fire. This control is the entire argument that this detector is not the
  one §150 rejects; without it the suite cannot tell them apart.
- Property: for any workspace, `workspaceToCsv` output never trips the detector. That states the
  false-positive guarantee as a law rather than a sample. Use a bounded integer→`new Date(ms)` mapping
  rather than `fc.date()`, and `[\s\S]` rather than the `/s` flag.
- Integration: a malformed file loads, the hold is raised, a save is refused, the escape hatch lowers
  it, and a subsequent save proceeds.
- Regression: a clean load **lowers** a previously raised malformed-quote hold.

**§152**
- Per-section attribution, one test per codec family, asserting both the total and the buckets.
- The census test still fails when a load path reports neither op.
- Toast ordering asserted on the **last** `showToast` call, with a file that both drops rows and is
  malformed.

**§168 / §36(a)**
- Capture → apply round-trip preserves note logs on tasks, RAID and changes.
- A `<script>` in a seed `description` and in a note-log `html` is stripped at apply.
- The import-graph guard stays green — i.e. the carry added no banned import.

---

## 7. Hazards

- `csv-line-scan.ts` has a **zero-import** rule; verify with
  `grep -nE "^\s*(import|require)" src/app/csv-line-scan.ts` printing nothing.
- **Sequencing.** Do not start implementation until `fix/meta-decode-loss-chain` is on `origin/main`;
  rebase onto it, then re-verify the three guard names and the census shape. Starting early means
  redoing the §150 and §152 work against a moved guard.
- `use-storage-backend.ts` stands at **799** against the hard 800 cap with no baseline entry, and the
  gate counts `wc -l` plus one — **and the other slice adds to that same file first**, so the one
  line of headroom may be gone by the time this one starts. Re-measure after the rebase and budget an
  extraction rather than assuming room exists. Re-read the number:
  `node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"`
- `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it — patch with a node UTF-8 write
  matching `\r\n`. Real umlauts only; the `i18n-encoding` test bans ASCII substitutes and `\u00XX`.
- The toast surface is single-slot — see §4.
- Four new EN+DE string pairs for the holds and the split report, **plus** one pair for every section
  in `ImportSectionKey` that has no existing entity-name key. That second count is not knowable until
  the union is written — resolve it with the check named in §4, do not guess it here.
- Run `npx tsc --noEmit` after editing any test; vitest never typechecks.
- Run `npm run test:shuffle` before pushing — this slice adds tests.

---

## 8. Out of scope

**§32** — `htmlStartRe` classifies a plain sentence opening with a tag-like word as HTML, and the tag
pass then deletes the pseudo-tag along with its words. It is the highest-severity item in this
cluster and is deferred deliberately: it is the only change that alters what **already-stored** values
mean, on every read, across all three sinks, so it wants its own slice and a golden check.

It also needs a design decision this spec does not make. The fix shape the register proposes —
`[\s>/]` after the tag name plus a well-formedness check — does not discriminate the documented
cases: `<em dash>` and `<a note about pricing>` are *legitimately well-formed* HTML with boolean
attributes, and all four documented cases have a space after the tag name. A discriminator that does
work on all four is **no attributes at all, or at least one `=`** — a heuristic, not a proof, and it
should be argued in its own slice rather than smuggled in here.

**§152 beyond attribution** — nothing further; per-section attribution is what closes it.

---

## 9. Definition of done

- Rebased onto `fix/meta-decode-loss-chain` after it merges, using its three guard names verbatim and
  composing with its rewritten `reportFor` census. No competing rename anywhere in the diff:
  `grep -rn "loadWasTruncated\|mayCommitAfterTruncation\|allowTruncatedSave" src/app` returns nothing.
- Four register entries closed with their Status lines updated to the new blocking contract:
  §150, §152, §168, §36(a).
- §150's "Why no fix is proposed" section rewritten — it argues a conclusion this slice disproves.
  Keep its *undecidability of intent* argument, which remains correct, and its rejection of the
  two-splits-disagree detector.
- The stale graph-size comment in the import-graph guard corrected (76 → measured).
- `AGENTS.md` updated where it describes the load-reporting posture.
- `CHANGELOG.md` entry under `### Fixed`; patch bump via `npm run version:sync`. The codename is per
  minor series, so 0.263.x stays "Okorafor".
- Full local gate chain green, including `npm run test:shuffle` at the pinned seed.
