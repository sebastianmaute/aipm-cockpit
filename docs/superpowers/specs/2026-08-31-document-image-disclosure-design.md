# Document-image disclosure slice — design

**Date:** 2026-08-31
**Register entries:** §213 (fix) · §230 (fix) · §225 (text only) · §205 (verify only)
**Branch:** `fix/document-image-disclosure` off `a5f51aa1`
**Version:** 0.271.0 (peer session holds 0.272.0 until this lands)

## Goal

Two disclosure defects in the document-image surface: an asset that is healthy can be
reported broken (§213), and an asset that is blocked by upload policy is reported with the
same marker as one whose bytes are gone, while the library calls the same row healthy
(§230). Neither loses data. Both lie to the user about the state of their images.

## Scope decision

Four entries were assigned. They are four different kinds of work and only two are code:

| § | Kind | Outcome |
|---|---|---|
| 213 | Real defect | Code + a test that controls async resolution ORDER |
| 230 | Disclosure split, plus a one-line normalise | New attribute, CSS, i18n EN+DE, library row |
| 225 | **Deliberate** — the obvious tightening is the regression | No code change; text repointed at the shared predicate |
| 205 | Owed eye-verify | A crossengine spec; stays open until a human reads its output |

## §213 — a late diff overwrites a healthy asset back to dangling

### Mechanism

`upload` commits the metadata row before writing the bytes (deliberate, per §212). The
metadata change re-fires the dangling-diff effect while `saveAssetData` is still in flight
(~1.8s for a 5 MB image). The diff's `loadAssetDataIds` correctly reports the new id as
absent. If the save resolves first and the load resolves second, the diff's `setDanglingIds`
REPLACES the whole set and discards the clear. The effect's deps are `[config, projectId,
assets]`, none of which change again, so nothing re-runs it. The row is stuck dangling.

### Rejected: re-arm the diff after a repair

Measured by the register entry to turn the §212 test red at its `danglingIds.has(first.id)`
assertion, because that test deliberately leaves `loadAssetDataIds` returning `[]` so the
explicit clear is the only thing that can un-mark the row. "Fixing" that fixture would let
the drop-the-clear mutant survive — trading this open defect for a weaker proof of a closed
one. Whatever closes §213 must leave that test's shape intact.

### Rejected: a plain `wroteBytesRef` Set

The entry's own candidate. It closes the race, but an id in the set is suppressed for the
rest of the session, so if its byte row later vanishes (§207 desync, another tab, a failed
remove) the library reports healthy permanently. That trades a false "broken" for a false
"healthy" — the worse direction, because the user is given no signal at all.

### Chosen: epoch-keyed suppression

Two refs in `use-document-assets.ts`:

- `writtenRef: Map<string, number>` — asset id to the epoch at which its bytes were last
  successfully written.
- `epochRef: number` — monotonic, incremented on each successful byte write.

The diff captures `startEpoch = epochRef.current` BEFORE awaiting `loadAssetDataIds`, and
when building `next` skips any id whose recorded epoch is `> startEpoch` — bytes written
after this diff's snapshot began, which its load could not have observed.

Why this is exact rather than merely safer:

- **Fresh-upload race:** the write bumps the epoch, the diff started lower, suppressed.
- **Later genuine deletion:** the next diff starts at the higher epoch, so the recorded
  write is no longer `>` it, not suppressed, correctly reported dangling. Self-evicting —
  no eviction path to get wrong, and no unbounded suppression.
- **The §212 held-diff case** the entry proves by measurement: same mechanism reached from
  the other direction, suppressed identically.
- **Effect deps untouched**, so the §212 test keeps its shape and its mutant stays killable.

Recorded only after `await saveAssetData` resolves WITHOUT throwing. The retry/repair path
goes through the same call site, so one insertion point covers both.

### Test

Gated promises, not `waitFor`. A test that merely awaits both passes under whichever order
the harness happens to produce — the shape that let this go unnoticed.

1. Mount, upload a file so the metadata commits and the diff arms.
2. Hold the diff's `loadAssetDataIds` open on a promise the test controls.
3. Let `saveAssetData` resolve first.
4. Release `loadAssetDataIds`, resolving `[]` (it cannot see the new bytes).
5. Assert the id is NOT in `danglingIds`.

Must be mutation-proved: reverting the subtraction turns it red.

## §230 — a declined asset is indistinguishable from a missing one

### Mechanism

`attachAssetImages` declines an asset whose stored mime is outside the upload allowlist by
returning before `urls.set`. The apply loop stamps `data-asset-missing` on any element with
no url. `data-asset-missing` therefore has FIVE producers: bytes null, load threw,
whitespace-only byte row, `atob` reject, and declined mime. The first four are all genuine
"these bytes will not render" and group correctly. The fifth is different: the bytes are
present and intact, the library shows the row healthy (dangling detection compares metadata
ids against the byte table, and a declined asset HAS a byte row), and no repair is offered.

### Chosen shape

A `blocked` set carried alongside `urls`, and a third branch in the apply loop:

- url present: set `src`, clear both markers.
- id in `blocked`: stamp `data-asset-blocked`, clear `data-asset-missing`.
- otherwise: stamp `data-asset-missing`, clear `data-asset-blocked`.

Each branch clears the opposite marker. The module's own comment records that clearing is
load-bearing — a stale marker left behind is how a repaired image goes on reading broken.

`globals.css` gains an `img[data-asset-blocked]` rule styled to the same frame as the
missing one, with its own `::before` content.

### The library row

`asset-library.tsx` currently derives `isDangling` from `danglingIds`, which cannot see a
mime. Blocked is derivable from metadata alone. The row renders the same marker span shape
with a distinct string.

**The predicate must be exported once and imported twice.** Spelled separately in the
images module and the library it will drift from the truthy form §225 exists to protect.

### Rejected: offering re-upload on a blocked row

Dangling rows get a re-upload repair. Extending it here is a false affordance: §230
measured that a healthy duplicate matched by content hash returns early with no metadata
write, so the stale mime is never corrected. The button would silently do nothing.

### Second item in the same entry

`documents-history-modal.tsx` reads `assetAccess?.projectId` bare — the only asset consumer
of four that does not normalise to `ASSET_PARTITION_FALLBACK`. Not reachable today, since

> **Correction (2026-08-31, cold review).** "Of four" overstates the precedent. Only TWO
> consumers fold `""` with `||` (`document-edit-mode.tsx`, `documents-asset-section.tsx`).
> `document-preview.tsx` DEFAULTS the prop, which fires for `undefined` only and passes `""`
> through; it is normalised by its caller, not by itself. The fix below is still right — the
> precedent for it is two sites, not three.

the only production caller already normalises. A future caller passing `""` would query
`project_id = ""`, match nothing, and stamp every image in a version preview as missing.

## §225 — no code change

The entry is open BECAUSE the obvious tightening is a regression: `mime !== undefined`
would decline the empty-string mime that real rows carry after sanitising, blanking images
that work today. This slice touches the exact line §225 protects, so:

- the truthy spelling is preserved verbatim;
- the guard moves behind the shared predicate §230 needs, and §225's text is repointed at
  it so the next reader finds one definition rather than two.

The entry stays OPEN. Its closure is §207/§212/§213 territory or recording the mime
alongside the bytes, neither of which is in this slice.

## §205 — measured, not looked at

A spec in `e2e-crossengine/`, running in both real engines. Three judgments, and they are
not equally assertable:

- **Hard:** something paints in the `::before` at all.
- **Hard:** the declaration's trailing space separates the glyph from adjacent content.
- **Recorded, NOT asserted:** monochrome text presentation vs colour emoji. `\FE0E` is
  VARIATION SELECTOR-15 and requests text presentation, but a font with no text-presentation
  form for U+26A0 falls back to emoji anyway. That is a platform finding, not a CSS bug —
  asserting it hard would turn the gate red on the wrong machines. The spec reports what it
  observed and names the platform.

The entry stays OPEN until a human reads that output. A spec that runs is not an eye-verify.

## Out of scope

- Recording the mime alongside the bytes (§225's real closure).
- Anything touching the metadata-before-bytes ordering, which §212 established deliberately.
- The `documents` meta-blob and the six write paths — no persisted field changes here.

## Risks

- **The §212 test is load-bearing and adjacent.** Every §213 change must be checked against
  it explicitly, not just against a green suite.
- **Turso-gated surface.** The axe/e2e seed never renders it, so unit tests are the only
  detector that will ever exist for the library row. Same structural blindness as focusout.
- **DE i18n.** The new key needs a real umlaut and must be written via a node UTF-8 write
  with CRLF anchors, never the Edit or Write tool.
