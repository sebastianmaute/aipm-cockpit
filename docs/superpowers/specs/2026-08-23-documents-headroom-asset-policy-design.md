# Documents headroom + asset mime policy — design

**Date:** 2026-08-23
**Closes:** open-followups §206, §220, §223
**Opens:** §225
**Leaves open, deliberately:** §208, §217, §221 (reasons below)
**Bump:** patch — `0.256.2 "Khaw"` (Parts 2 and 3 are user-visible; Part 1 alone would be no-bump)

---

## Why this slice

Three unrelated-looking register entries share one blast radius — the documents
feature — and one of them blocks the other two.

`documents-panel.tsx` and `document-block-editors.tsx` both measure **800** by the
gate's own arithmetic, and neither has a baseline entry. §220 records what that
means exactly: `check-file-sizes.mjs` lets 800 through (`if (n <= LIMIT) continue`)
and reports 801 on an unbaselined file as `NEW file over 800`. Headroom is zero
lines, in both files, with no ratchet grace. Any net line fails
`file-size-ratchet` outright.

Measured on this branch's base (`2a1cfdef`), not quoted from §220 — the near-cap
set rots on any commit. Reproduce with the gate's own metric, honouring the same
three exclusions the gate applies (`.test.` / `.property.` / the i18n pair). Put
this in a file and run it with `node`; do not try to inline it with `node -e`,
where the backslashes and backticks are eaten before node sees them:

```js
const fs = require("fs"), p = require("path");
const base = JSON.parse(fs.readFileSync("docs/baselines/file-sizes.json", "utf8"));
const named = new Set(Object.keys(base));
const norm = (s) => s.split(p.sep).join("/");
const out = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = p.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.property\./.test(e.name)
             && !/i18n(\.de)?\.ts$/.test(e.name)) {
      const n = fs.readFileSync(f, "utf8").split("\n").length;
      if (n >= 780) out.push([n, norm(f), named.has(norm(f)) ? "baselined" : "NO BASELINE"]);
    }
  }
})("src");
out.sort((a, b) => b[0] - a[0]).forEach((r) => console.log(String(r[0]).padStart(5), r[1], r[2]));
```

Run 2026-08-23:

```
  800 src/app/document-block-editors.tsx NO BASELINE
  800 src/app/documents-panel.tsx NO BASELINE
  799 src/app/use-chat-dispatcher.ts NO BASELINE
  799 src/app/use-storage-backend.ts NO BASELINE
  795 src/app/timelog-panel.tsx NO BASELINE
  793 src/app/task-row.tsx NO BASELINE
  791 src/app/budget-panel.tsx NO BASELINE
  791 src/app/chat-tools.ts NO BASELINE
  786 src/app/csv-codecs-core.ts NO BASELINE
  781 src/app/gantt-engine.ts NO BASELINE
```

Only four baselined files exist in the whole repo (`task-manager`, `tasks-section`,
`workspace-section`, `chat-panel`). So the split comes FIRST, before either
behaviour change, rather than being absorbed by a trick the way S3c-2 had to
absorb its own cost.

★★ **Do NOT close §220 by adding a baseline entry.** Baselining a file to admit
growth is the "re-baseline to make the pipeline pass" failure the gate exists to
prevent, and it converts a hard cap into an open-ended ratchet for the two
largest surfaces in the feature.

## What is deliberately NOT in scope

**§217 (media parts minted per occurrence).** Scoped in, then dropped. It is a
size win and never a correctness one, and its only real verification is §219's
manual open-in-Word pass, which nothing in this repo can run. Shipping a change
to both OOXML renderers' bytes on unzip-and-byte-compare evidence alone would be
the second slice in a row adding package claims nothing has read back. Waiting
costs bytes. §217 gains a line recording that it was scoped in and dropped for
want of §219.

**§221 (webp embedded verbatim).** Blocked by construction on §219 item 6 — open
a `.docx` in an *older*, non-subscription Word and record what it draws. The
recorded decision stands and is right: declining webp in `mediaExtension` is one
line, but it degrades a case that works correctly in current Microsoft 365 to
improve a case nobody has confirmed fails.

**§208 (`capHtmlText` strips an image past the visible-text cap).** The real fix
is HTML-aware truncation, which is a change to `capHtmlText` and therefore to
every rich-text sink in the app — not a documents change. It is also unreachable
from the images feature itself: an inserted image paragraph is the `<img>` tag
alone and projects to zero visible characters, so the cap can never fire on one.
★★★ Do not "fix" it by skipping the cap when an image is present — the cap is a
DoS bound on stored block size, and an exemption keyed on markup the attacker
controls hands them the bypass.

---

## Part 1 — §220: headroom

Refactor only. No behaviour change, no new i18n key, no test-behaviour change.
Every extracted unit is PURE presentational: data and handlers in as props, all
state stays in the orchestrator. This is the gantt pattern (orchestrator +
presentational leaves) the repo already applies to gantt, reports and raid-panel.

### `documents-panel.tsx` → ~700

- **`documents-deleted-section.tsx`** ← the deleted-versions `<section>`: the
  implausible-count warning (`documentsDeletedImplausible`), the empty state, and
  the `<ul>` of tombstone rows with their Restore buttons.
  Props: `lang`, `deleted`, `documentCount`, `isReadOnly`, `onRestore`.
- **`documents-rename-modal.tsx`** ← the rename `Modal`, plus the `RENAME_TITLE_ID`
  const it is the only consumer of.
  Props: `lang`, `draft`, `onDraftChange`, `onCancel`, `onCommit`.

`handleRestore`, `handleShowDeletedChange` and `commitRename` stay in the
orchestrator and are threaded down.

### `document-block-editors.tsx` → ~615

- **`bullets-block-editor.tsx`** ← `BulletsBlockEditor` and the `BulletsDraft`
  type.

★★★ **Do NOT re-export it from `document-block-editors.tsx` to spare the call
sites — that is an import CYCLE.** The extracted file must import
`useBlockDraft` and `BlockEditorProps` back from `document-block-editors.tsx`, so
a re-export makes the two modules import each other. This repo already has one
runtime import cycle it works around by hand (§92, `settings-types` ⇄ `workspace`
⇄ `document-model`); it does not need a second one bought for an import-line
convenience.

★ **`document-table-editor.tsx` is exact precedent and the extraction should
mirror it byte-for-byte in shape.** It is a sibling block editor already living
in its own file: it imports `{ type BlockEditorProps, useBlockDraft } from
"./document-block-editors"`, exports its component, and `document-editor.tsx`
imports it directly. Dependencies run one way only.

The two real consumers move their import to the new module:
`document-editor.tsx` and `document-block-editors.test.tsx`. Verify the set at
write time rather than trusting this line:

```bash
grep -rn "BulletsBlockEditor" src/app --include=*.ts --include=*.tsx | grep -v "^src/app/document-block-editors.tsx:"
```

★ One hit is a COMMENT, not an import — `document-table-editor.tsx` refers to
`BulletsBlockEditor`'s header comment for the two-axis labelling rule. Read the
hits; do not count them.

### Why `.tsx` only, and why `useBlockDraft` stays put

`vitest.config.ts` excludes `src/app/**/*.tsx` from the coverage gate wholesale,
so three new `.tsx` files carry zero gate exposure.

Extracting `useBlockDraft` (~292 lines, with the documented three-rule contract:
flush a dirty draft on unmount, ABANDON a commit whose `storedBlock` moved since
the draft's baseline froze, adopt an external write while undirty) into its own
`.ts` file is the better long-term shape and would buy far more headroom. It is
deliberately NOT done here: a `.ts` hook becomes coverage-gated, no glob in
`vitest.config.ts` matches that name so it lands in the global pool against
lines 92 / funcs 91 / branches 80 / stmts 89, and a shortfall would stall a slice
whose other two parts are behaviour fixes. It is a coverage decision and deserves
its own slice.

★ Check the `.ts`-before-`.tsx` resolution trap when naming: a bare `./<name>`
import resolves `.ts` ahead of `.tsx`, so a new pure `foo.ts` silently hijacks an
existing `foo.tsx` component import. None of the three new names has a sibling
today — re-check at write time.

---

## Part 2 — §223: one mime predicate, and the consumer that checks nothing

### The shared helper

Exported from `document-asset-upload.ts`, beside `ASSET_MIME_ALLOWED`:

```ts
export function isAllowedAssetMime(mime: string | undefined): boolean {
  return mime !== undefined && (ASSET_MIME_ALLOWED as readonly string[]).includes(mime);
}
```

Seven `(ASSET_MIME_ALLOWED as readonly string[]).includes(...)` casts exist today
across six files; six become calls and the seventh becomes this body. Reproduce
the set:

```bash
grep -rc "ASSET_MIME_ALLOWED as readonly string\[\]" src/app --include=*.ts --include=*.tsx | grep -v ":0$"
```

Run 2026-08-23: `doc-render-docx.ts:1`, `doc-render-html.ts:1`,
`doc-render-pptx-slides.ts:1`, `document-asset-upload.ts:1`,
`document-download.ts:1`, `documents-asset-section.tsx:2`.

By symbol, and in the three kinds §223 distinguishes:

- **one upload gate** — `checkUploadCandidate`, the one place a file is refused
  entry;
- **four render/policy guards** — `docxEmbedFor`, `assetSrcAttr`, `pptxEmbedFor`,
  `assetPolicy`'s html/pdf branch;
- **two intake filters** — `handlePaste` and `handleDrop`.

That is 4 + 1 + 2 = 7 casts across six files, which is the count the grep above
returns. Do not say "five guards" — an earlier draft of this spec did, by folding
the upload gate into the guard list, and the test table below is sized off this
split.

★ `assetPolicy` already spells its check as `mime !== undefined && (…).includes(mime)`,
which is exactly the helper's body — so it converts to a bare
`isAllowedAssetMime(mime)` with the undefined guard folded in, not to a call with
the guard left outside it. It is also the one site that confirms the helper's
signature should take `string | undefined` rather than `string`.

★★ `handlePaste` and `handleDrop` are NOT affordances. Each filters the pasted or
dropped `FileList` and returns early when nothing survives, so both gate
`uploadAndInsert` — and `handlePaste` calls `e.preventDefault()` ONLY when a file
survived, so weakening its filter would make the editor swallow every ordinary
text paste. Preserve the control flow exactly; this is a substitution of one
expression, not a rewrite.

★ `asset-library.tsx`'s `accept={ASSET_MIME_ALLOWED.join(",")}` is untouched. It
is a genuine affordance, stops nothing, and is not a policy check.

★ **Do not fold in the extent check.** `canEmbedDocxAsset` / `canEmbedPptxAsset`
also require a recorded width and height; the html sink deliberately does not,
because HTML places no box. One shared mime predicate is right; one shared
"is this usable" predicate would re-introduce the asymmetry that comment exists
to stop.

### The behaviour change

`attachAssetImages` (`document-asset-images.ts`) is the consumer no search for
the constant can find: it reads the stored mime straight off the row through the
`mimeFor` lookup and builds a `Blob` carrying that type — no allowlist, no cast,
and so no grep hit. Sweep the mime READERS instead, which finds a consumer by
what it touches rather than by what it names:

```bash
grep -rn "\.mime\b" src/app --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "recorder\|mimeType"
```

It gains, immediately after the `mimeFor` lookup:

```ts
const mime = mimeFor?.(id);
// Decline a mime the upload gate would have refused — an imported or
// hand-edited workspace can carry one, because `sanitizeDocumentAsset` is
// mime-GENERIC by contract and deliberately does not consult the allowlist.
// Returning here routes the element down the SAME `data-asset-missing` path
// the dangling case uses, so the reader gets the disclosure rather than a bare
// broken-image icon.
if (mime !== undefined && !isAllowedAssetMime(mime)) return;
```

★★★ **`mime === undefined` deliberately does NOT decline, and that asymmetry is
the point of the `mime !== undefined` guard rather than a bare
`!isAllowedAssetMime(mime)`.** Three cases reach this line:

1. no `mimeFor` supplied at all (the generic contract — only one caller passes
   one today) → unchanged, typeless `Blob`;
2. `mimeFor` returns `undefined` because no metadata row matched the id → also
   unchanged, typeless `Blob`;
3. `mimeFor` returns a mime outside the allowlist → **declined**, new.

Case 2 is a real unchecked path — an unknown mime means the browser sniffs — but
it is not a restatement of the policy, because there is no mime to restate, and
declining it would regress a case that renders correctly today. It gets its own
register entry (§225) rather than a silent fix inside a refactor.

★★ The existing bound is why this is a hardening and not a live exploit fix: the
blob URL is only ever assigned to `<img src>`, where an `image/svg+xml` blob runs
no script, and `src/proxy.ts` serves a `script-src` of `'self'` plus a nonce and
`'strict-dynamic'`, with no `'unsafe-inline'`, alongside `object-src 'none'`.
Reproduce with `grep -n "script-src\|object-src" src/proxy.ts`. The remaining
step — that a blob document inherits its creator's policy — is a spec claim
nothing here can execute. Read it as a reason not to panic, not as proof.

### What the load path must NOT gain

`sanitizeDocumentAsset` (`document-asset.ts`) runs `sanitizeText` on the mime and
never consults `ASSET_MIME_ALLOWED`. That is deliberate and the module header says
so: the record is mime-GENERIC by contract, format policy belongs to the upload
pipeline, and narrowing it at the storage layer would make a stored row unreadable
after the policy changed. Do not add a check there.

### Testing

★★★ **A test is the only possible detector, and the helper does not make the
check automatic.** A consumer that calls nothing is still wrong, and no gate can
see it: the row is well-formed, the mime is a plausible string, and the only
symptom is whatever that sink does with bytes it should never have been handed.

- Table-driven per-consumer test: feed `image/svg+xml` to each of the four
  render/policy guards, the upload gate and both intake filters — seven rows,
  one per converted site — and assert each declines. ★ The two intake filters
  need a control-flow assertion, not just a return value: `handlePaste` must
  still NOT call `e.preventDefault()` when no file survives, or the editor
  swallows ordinary text pastes.
- One test for `attachAssetImages` asserting a disallowed mime yields
  `data-asset-missing` and no `src`.
- One test asserting `mimeFor` returning `undefined` still resolves (case 2
  above), so a later "simplification" to a bare `!isAllowedAssetMime(mime)` goes
  red instead of silently regressing.
- **Mutation check, required:** delete one converted call site and confirm the
  suite goes red. A passing suite proves only that SOME assertion fired.

---

## Part 3 — §206: history modal resolves images

`DocumentsHistoryModal` renders a version's blocks through `renderDocumentHtml`
but was never wired to `attachAssetImages`, so a version containing an image
block renders that block without its picture.

The render happens in **`HistoryRow`**, not in the modal — the preview is a
per-row disclosure, and the row is already its own component because the
disclosure needs a hook per row. So the fix lands in `HistoryRow`.

- The modal takes a new **optional** asset bag, threaded from
  `documents-panel.tsx` (which already holds `DocumentAssetPaneProps` for the
  asset section) and passed down to each `HistoryRow`.
  ★ Declare a NEW narrower type — `{ tursoConfig, projectId, assets }` — rather
  than reusing `DocumentAssetPaneProps`, which also carries `setAssets`. The
  history modal is read-only over assets and must not be handed a setter; taking
  the wider type would make that a prop the component merely happens not to use,
  which is how a write path gets added later without anyone deciding to.
  Optional for the same reason `ws` is optional:
  the component's own suite renders it bare throughout, and an absent bag degrades
  to today's behaviour — blocks render, images do not resolve — rather than to
  broken markup.
- `HistoryRow` gains a `bodyRef` and the same effect `document-preview.tsx` runs:
  call `attachAssetImages`, revoke on unmount or when the subtree is replaced,
  guarded by a `cancelled` flag because the byte loads resolve asynchronously.

### The landmine this fix walks into

★★★ **The inline `dangerouslySetInnerHTML` object literal must become a memoized
object, or every image blanks permanently.** React 19 diffs host props by
`Object.is` and treats `dangerouslySetInnerHTML` like any other prop, so a fresh
object literal every render makes React re-assign the element's `innerHTML` —
rebuilding the subtree — on EVERY re-render, byte-identical `html` or not. The
effect does NOT re-run, because its deps are unchanged, so every `src` and every
marker it wrote is gone for good.

`document-preview.tsx` carries the measured account of this on its `bodyHtml`
memo, which exists for its identity and not for the allocation. That defect
already shipped once and was a showstopper. It is inert in the history modal
today only because nothing attaches images there; wiring §206 without the memo
reproduces it exactly.

Fix and pin:

```ts
const bodyHtml = useMemo(() => ({ __html: html }), [html]);
```

with a "keeps a resolved image across an unrelated re-render" test, mirroring the
one that pins the preview.

★ The existing `html` memo already collapses to an empty string when the
disclosure is closed, so the effect must tolerate an empty subtree —
`attachAssetImages` returns a no-op teardown when it finds no
`img[data-asset-id]`, which it already does today.

★ `HistoryRow` also subscribes to the asset-repair generation the way the preview
does — `useSyncExternalStore(subscribeAssetRepairs, …)`, with that generation in
the effect's dep list — so a §212 repair landing while the modal is open clears
the stale marker instead of leaving a dashed frame around a now-healthy image.
★★ Bumping the assets array's identity instead would also re-run the effect, but
it marks the workspace dirty and writes every table; the repair signal rides its
own wire for exactly that reason. Do not substitute one for the other.

---

## Register changes

- **§206, §220, §223 close.**
- **§225 opens:** `attachAssetImages` renders a typeless `Blob` when no metadata
  row matches an asset id, leaving the mime to content sniffing. Bounded by the
  same `<img src>` + CSP argument as §223, deliberately split out because
  declining it would regress a case that renders correctly today.
- **§217 gains a line:** scoped into this slice and dropped for want of §219's
  manual verification.
- §208 and §221 unchanged.

★★ A `docs/open-followups.md` number is reserved only once it is on `origin/main`.
§225 is the next free number against `2a1cfdef`; re-check the max and renumber on
rebase if another branch lands first.

★★ `docs/open-followups.md` IS scanned by `docs:claims:check` (only
`docs/superpowers/` is skipped, per `SKIP_DIRS` in `doc-claims-lib.mjs`), and that
gate is a RATCHET — a NEW `path:LINE` citation fails it. Cite symbols and grep
commands in every register edit, never line numbers.

---

## Gates and ordering

Order is load-bearing: **Part 1, then Parts 2 and 3.** Both behaviour parts touch
files adjacent to the two at the cap, and Part 1 is what makes any net line
affordable.

Full local chain before push, each gate read UNPIPED:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

★★★ Never read a gate's exit code through a pipe — piping `npm run test:run` into
`tail` exits 0 while tests are failing, because that is `tail`'s status, and the
pipe discards the failure diagnostic too.

★ eslint: there is NO `--max-warnings` gate in CI and `noUnusedLocals` is not set,
so an unused import left behind by an extraction SHIPS GREEN. Three extractions
here move imports between files — re-check both sides of every move by hand.

★ Documents IS in axe `A11Y_VIEWS` and the gate drives it into edit mode, so run
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=1`
after Part 1. Add `--workers=1` whenever more than one view is matched: local runs
default to CPU-count while CI runs `workers: 1`, and over-subscription produces
`Test timeout` failures that name no rule and are not violations.

★★ A green axe run is silent on duplicate accessible names in every view at every
seed size. Part 1 moves per-row Restore buttons into a new file; their row-unique
naming is pinned by unit tests and by nothing else.
