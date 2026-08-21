# Small-correctness batch — §11 · §14 · §15 · §29

_Design, 2026-07-31. Against HEAD `04a2ac32` (0.211.0 "Samatar" merged; branch `docs/eslint-major-deferred`
is one docs-only commit ahead of `main`)._

Four entries from [`docs/open-followups.md`](../../open-followups.md), chosen as one themed batch: each
is small, each lives in a different file, and each closes an entry outright rather than narrowing it.

★ **This spec is at a gitignored path** (`.gitignore:76` covers `/docs/superpowers/`), which is the
invisibility §44 of the register records. Acceptable only because this batch is executed in the same
session it was designed in. If it is deferred, the register entries are the durable record — not this
file.

---

## Scope

| # | Entry | Verified live at HEAD |
|---|---|---|
| §11 | `instanceof DOMException` abort check misreports a user cancel | `use-tasks-dedup.tsx:121`, `use-action-analysis.ts:34` |
| §14 | Timelog keys its two per-device stores differently | `timelog-actuals-store.ts` keyed `ws.project?.code` (`timelog-panel.tsx:92`) vs `timelog-picker-store.ts` keyed canonical |
| §15 | Two file-picker patterns; extract a `FilePickerButton` | `color-scheme-editor.tsx:212-214`, `theme-gallery.tsx:79-87` |
| §29 | `form.noteLog` is dead state in the task form | seed `use-task-submit.ts:341`, `emptyForm` `task-form-context.tsx:47`, sole reader `task-form-fields.tsx:632` |

Line numbers had drifted from the register's (§11 was filed at `:111`, now `:121`); every claim itself
re-verified against HEAD on 2026-07-31 rather than trusted forward.

**Out of scope, deliberately:** the other ~20 open entries. §42 in particular stays untouched — it is
Task 11 of the unexecuted S6 plan and fixing it here would be re-done there.

---

## Two findings discovered while grounding §15

Both are new — neither is in the register — and the first one **changes the design**.

### (a) The label shape has no visible focus indicator — WCAG 2.4.7

`color-scheme-editor.tsx:212` and `branding-image-input.tsx:53` both render:

```tsx
<label className={`cursor-pointer ${btn}`}>   {/* btn ends in INTERACTIVE → focus:ring-2 */}
  {label}
  <input type="file" className="sr-only" … />
</label>
```

A `<label>` is not focusable, so its `focus:ring-2` can never match. Focus goes to the `sr-only`
input — a 1px clipped box — so a keyboard user tabbing onto "Import theme" or "Choose logo" gets **no
visible focus indicator at all**. The fix would be `focus-within:` on the label, or the Button+ref
shape.

★ Nothing catches this: axe has no focus-visibility rule, and the accessible NAME is fine (a wrapping
`<label>` supplies it), so the one thing axe does check passes. Same blind-spot class as §15's
original duplicate-name finding.

★ This decides the primitive's shape — see §15 below.

### (b) `chat-panel.tsx:805` uses `className="hidden"` on a ref-clicked file input

Exactly what §15 says never to do ("a hidden input cannot be clicked in every browser", which is why
both theme sites use `sr-only`). A third pattern, contradicting the entry it belongs to. Out of scope
for this batch — recorded, not fixed.

---

## §11 — one `isAbortError`, four call sites

**Defect.** `use-tasks-dedup.tsx:121` and `use-action-analysis.ts:34` catch a user cancel as
`e instanceof DOMException && e.name === "AbortError"`. When that `instanceof` fails — `DOMException`
is not reliably `instanceof` across the jsdom/Node boundary, which the codebase already documents at
`chat-panel.tsx:471-473` and in `use-alloc-plan.tsx` — the branch falls through to the generic arm.
Dedup fires `showToast("error", t(lang,"taskDedupError"))`; action-analysis calls `setError(msg)`.
An action the user took on purpose is reported as a failure, and the two fail **differently**, so a
test for one does not cover the other.

**Design.** New pure module `src/app/abort-error.ts`:

```ts
/** True when `e` is a fetch/AbortController cancellation.
 *  Reads `.name` directly — NEVER `instanceof DOMException` — because a
 *  DOMException is not reliably instanceof Error/DOMException across the
 *  jsdom/Node boundary, which is the whole defect this closes. */
export function isAbortError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : (e as { name?: string } | null | undefined)?.name;
  return name === "AbortError";
}
```

Applied at all four sites:

| site | change |
|---|---|
| `use-tasks-dedup.tsx:121` | `if (isAbortError(e)) return;` |
| `use-action-analysis.ts:34` | `if (isAbortError(e)) return null;` |
| `use-project-proposal.ts:51` | keeps its `signal?.aborted ||` short-circuit, `instanceof` arm → `isAbortError(e)` |
| `use-timelog-sync.ts:106` | same shape |

★ The two already-safe sites are folded in even though the register said to leave them: the point of
the helper is that a fifth caller cannot reinvent the broken shape. Their `signal.aborted` read stays
**ahead** of the call — it catches a cancel that never became a rejection, which is not the same
condition.

★ At both exposed sites the `reqId !== reqIdRef.current` stale-guard stays **above** the abort check.
Different question (a superseded request, not a cancelled one), different discard.

★ **THREE** further sites already read `.name` correctly by hand — `chat-panel.tsx:478`,
`use-alloc-plan.tsx:166` and `use-raci-suggest.tsx:203` (the last added by 0.211.0, after the register
entry was written, so §11's "four call sites" sweep is now an undercount of the *pattern*). Folding
them in is optional and NOT part of this batch: none is a defect, and each carries a 4-line
explanatory comment that would have to be rewritten into the helper. ★ Worth knowing for whoever
decides: three verbatim copies of the same read-plus-comment is `dup:check` fuel, and the gate is
BLOCKING — if the duplication gate ever flags them, the helper is already there to absorb them.

**Tests.** `abort-error.test.ts` — a real `new DOMException("", "AbortError")`, a plain object
`{name: "AbortError"}` (the cross-boundary case the helper exists for), a plain `Error`, `null`,
`undefined`, a string. Plus one behavioural test per exposed site: assert **no** error toast /
**no** `setError` after an abort. A new coverage-gated `.ts` file must not drop the function-coverage
floor — this one is trivially 100%.

---

## §14 — canonical key, with a read-both fallback

**Defect.** `timelog-panel.tsx:92` computes `projectId = ws.project?.code ?? "default"` and feeds it
to `useTimelogSync`, which keys the actuals cache with it. The picker scope (added 0.204.0) keys on
the canonical `portfolioCurrentId ?? "default"` instead — the same key `landing-state` and
project-appearance use. Two per-device stores describing one project, keyed differently.

Consequence today: the project **code is user-editable**, so renaming it orphans the actuals cache
while the picker scope survives — the picker restores a selection for bookings that are no longer
loaded. The scope-mismatch notice added in the same slice does not cover this; it compares against
`links.customerId`, which is workspace data and unaffected by a rename.

**Design.**

1. `TimelogPanel` passes its existing canonical `projectKey` prop to `useTimelogSync` as `projectId`,
   and adds `legacyProjectId = ws.project?.code ?? "default"`.
2. `useTimelogSync` threads `legacyProjectId` into its reads and its clear (all writes stay canonical).
3. `timelog-actuals-store.ts` widens two functions:

```ts
export function loadActualsCache(projectId: string, legacyProjectId?: string): ActualsCacheEntry | undefined {
  const map = readMap();
  const hit = map[projectId];
  if (hit) return hit;
  if (legacyProjectId && legacyProjectId !== projectId) return map[legacyProjectId];
  return undefined;
}

export function clearActualsCache(projectId: string, legacyProjectId?: string): void { /* delete BOTH */ }
```

`saveActualsCache` is unchanged and already writes whatever key it is given — which is now always the
canonical one, so the entry migrates on the first save with no write-during-read.

★ **`clearActualsCache` MUST delete both, and this is the one way the migration can mint a new bug.**
Delete only the canonical entry and the next remount's read falls back to the legacy one — "Clear all"
would appear to work and the cleared data would resurrect on the next mount.

★ Read-only fallback is deliberate: the four call sites are lazy `useState` initializers
(`use-timelog-sync.ts:56,57,61,62`), so a write inside the read would be a side effect during render,
double-invoked under StrictMode. Idempotent, but the wrong shape for this codebase.

★ The orphaned legacy entry lingers as garbage. Bounded — `MAX_PROJECTS = 50` already evicts
oldest-first by `fetchedAt`.

★ `legacyProjectId === projectId` (file mode where both resolve to `"default"`) is a no-op by the
guard above.

★ Delete the now-false comment at `timelog-panel.tsx:57-61`, which documents the split as deliberate.

**Tests.** In `timelog-actuals-store.test.ts`: canonical wins when both exist; legacy returned when
canonical is absent; nothing returned when neither; `legacyId === id` is safe; **clear removes both**.
In `timelog-panel.test.tsx` or the hook's test: a cache written under the old code key is still read
after the switch (the actual user-facing promise).

---

## §15 — `FilePickerButton`

**Defect.** Two structurally different ways to open a file dialog, put on the same settings surface
(Settings → Appearance) by slice E:

| where | shape |
|---|---|
| `color-scheme-editor.tsx:212-215` | `<label className={btn}>` + `sr-only` child input. Label IS the control. |
| `theme-gallery.tsx:67-87` | DS `<Button>` + sibling `sr-only` input reached via `useRef` and `.click()`. |

Neither is a primitive, and converting either into the other is wrong on its own terms — the register
records both directions.

**Design.** `src/app/file-picker-button.tsx` takes the **Button + ref** shape:

```tsx
export interface FilePickerButtonProps {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  variant?: ButtonVariant;   // default "secondary"
  size?: ButtonSize;         // default "sm"
}
```

Renders the DS `Button` plus an input it owns: `className="sr-only"` (never `display:none`),
`tabIndex={-1}`, `aria-hidden="true"`, and `e.target.value = ""` after each pick so the same file can
be re-selected.

★ **Why Button+ref and not the label shape** — three independent reasons, and the first is new:
1. The label shape has no visible focus ring (finding (a) above). Button+ref is correct today.
2. Adopting the label shape would copy `color-scheme-editor.tsx:190`'s hand-rolled `btn` string into a
   second file — hand-rolled button styling where a DS `Button` exists, and a fresh `dup:check` clone
   against a **BLOCKING** gate.
3. `tabIndex={-1}` + `aria-hidden` on the owned input settles the duplicate-accessible-name failure
   (fixed in `df507f95`) in ONE place, so neither site can regress into it. axe reports missing names,
   never duplicated ones — nothing else would catch a regression.

**Call sites (three).**
- `theme-gallery.tsx` — drops its `inputRef`, its input and its explanatory comment; the comment's
  content moves onto the primitive.
- `color-scheme-editor.tsx` — drops the `<label>`; gains a real focus ring. Note this changes its
  visual chrome from the local `btn` to the DS `Button`; the surrounding row is a mix of `btn` buttons,
  so the Import control will no longer match its neighbours exactly. **Accepted** — correctness over
  local consistency, and the row's other buttons are §7-A-class hand-rolls anyway.
- `branding-image-input.tsx` — keeps ALL of its own validation (raster-mime allowlist, 512 KB raw-byte
  cap, `FileReader`, error surfacing). It hands over the picker chrome only.

★ Not folded in: `chat-panel.tsx` (multi-file, own classify/size caps, and the `hidden` bug above) and
`step0-import-panel.tsx` (multi-file import flow). The register scopes those out; finding (b) is
recorded separately rather than fixed here.

**Tests.** `file-picker-button.test.tsx`: clicking the Button opens the input (assert the click reaches
it); the input is not a tab stop (a real `userEvent.tab()` walk — `.focus()` proves nothing about
focusability); `onFile` fires with the picked file; picking the same file twice fires twice (the
`value = ""` reset). Existing `theme-gallery.test.tsx:53-62` tab-order test must keep passing
unchanged — it is the regression guard for reason 3.

---

## §29 — retire `form.noteLog`

**Defect.** `fe779f32` removed `noteLog` from the submit payload — the log is write-through and owns
itself, so spreading a modal-open snapshot over the live row destroys any note added while the editor
was open. But the field is still **seeded** into form state (`use-task-submit.ts:341`), where its only
remaining reader is the disabled fallback button's count (`task-form-fields.tsx:632`) — permanently
`0`, since nothing can write a note in create mode. Dead state that invites a future writer to put it
back into `payload`, which is the data-loss bug `fe779f32` fixed.

**Design.**
1. `task-form-fields.tsx:632` — the fallback count becomes a literal `0`. (`:615` keeps reading
   `taskNotePanel.entries.length`; that is the live path and is unaffected.)
2. Remove `noteLog` from the form-state type, from `emptyForm` (`task-form-context.tsx:47`) and from
   the seed (`use-task-submit.ts:341`).
3. The deliberate-absence comment at `use-task-submit.ts:167` **stays** and is extended: the field is
   now absent from the draft as well as the payload, so a future reader is told why both.

**Test rework** — this is the part that is larger than "S":
- `use-task-submit.test.ts:570-597` pins exactly the seeding being removed ("`openEditModal` snapshots
  `task.noteLog` into that draft"). **Delete it.**
- `use-task-submit.test.ts:617-629` stays untouched — those assert the payload omission against a live
  row that changed under the open editor, i.e. the data-loss guard itself.
- `use-task-submit.test.ts:57` — drop `noteLog` from the draft fixture.
- `task-form-modal.test.tsx:243,288` — the stub deliberately gives `form.noteLog` ONE entry while the
  panel holds TWO, as a discriminator proving the button reads panel entries. Once the field is gone
  the discriminator is gone with it. Drop the stub and the comment; the write-through assertion at
  `:320-330` (count goes 1 → 2 after an add, and the old label is absent) carries the proof on its own.
- `task-form-fields.test.tsx:194-196` asserts an empty draft reads "Notes log (0)" — must still pass,
  now against the literal.

★ Anything else constructing a `TaskFormDraft` needs the field dropped; `tsc --noEmit` finds them all,
since removing it from the type makes every stale literal an excess-property error.

---

## Verification

Unit only. **None of these four is reachable by the axe gate** — Settings → Appearance is not the
scanned Settings sub-section, the task form's create mode is not seeded in e2e, dedup and
action-analysis are AI paths behind an unconfigured key, and Time bookings' cache is per-device state
axe never exercises. The vitest suites are the only automated coverage; finding (a) has no automated
coverage of any kind and is closed by construction rather than by a test.

Gates, each run **unpiped** with its own exit code read (`cmd > /tmp/x.log 2>&1; echo "EXIT=$?"`):

```
npx tsc --noEmit
npx eslint --max-warnings=0 src/app          # NOT `npm run lint` — that has no --max-warnings and exits 0 on warnings
npm run test:run
npm run size:check
npm run dup:check
```

No golden regeneration (no serializer, sanitizer or codec is touched). No new i18n keys. No CSP,
palette or `A11Y_VIEWS` change. A full e2e run is not required by the change set, but the release
chain runs it anyway.

★ `npm run dup:check` is expected to **improve** — §11 collapses four copies of the abort shape and
§15 collapses two picker shapes into one primitive.

---

## Release shape

§11 and §14 change user-visible behaviour (a spurious error toast on a deliberate cancel; a cache that
now follows the project instead of its editable code), so this is not internal-only work and does take
a bump: **0.211.1**, patch.

Per AGENTS.md, `version.ts` (APP_VERSION + APP_BUILD_DATE + milestone) and `CHANGELOG.md`, plus the
five ungated sites that no gate checks — `package.json` `version`, **both** `package-lock.json`
occurrences (root and `packages[""]`), the README shields badge (version and codename), and the
`<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`. Same commit, or the drift restarts.

A patch bump needs no new codename. ★ Do **not** reach for "Bodard" — it is reserved for S6 (§44), and
§44 records that the spare was already consumed once by an unrelated release.

Merge chain per the standing rule: push → create MR → poll the **MR-ref** pipeline to `status:success`
→ plain `glab mr merge <iid> --remove-source-branch --yes` → confirm the post-merge main pipeline.
Never `--auto-merge` (it checks the branch-head pipeline and merges instantly pre-green).

---

## Register updates

Same commit as the code.

**Close** §11, §14, §15, §29 — moved to Provenance with what actually closed each, not deleted. The
numbers are stable identifiers and are never reused.

**Open two new entries**, next free number is 46:

- **§46 — the `<label>`-wrapped file input has no visible focus indicator.** `INTERACTIVE`'s
  `focus:ring-2` on a non-focusable `<label>` never matches; focus sits on the `sr-only` input. Closed
  for the three sites this batch touches; the entry exists because the *pattern* is what to watch for,
  axe cannot see it, and `focus:` vs `focus-within:` on a wrapper is a mistake anyone can repeat.
- **§47 — `chat-panel.tsx:805` clicks a `display:none` file input.** Contradicts §15's own warning.
  Scoped out of this batch; needs the multi-file attachment flow read before touching.

★ Also correct AGENTS.md if anything there names `form.noteLog` or either picker shape — grep the
symbol, not just the register. A landmine bullet's *tail* is where resolution status lives and nothing
re-reads tails; that is how the last stale claim survived.
