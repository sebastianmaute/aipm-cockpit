# Silent-Sanitization Feedback — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Topic:** Surface, in the UI, the input transformations that `sanitize.ts` currently performs silently (text truncation, numeric clamping, character stripping).

## Problem

The app sanitizes user input through `sanitize.ts` (length caps, numeric clamps, character stripping) but gives the user **no feedback** when a value is changed. Examples:

- Paste a 6000-char note → silently saved as 5000 (`sanitizeNotes`, `TEXTAREA_MAX = 5000`).
- Type `25` shift hours → silently rewritten to `24` (`clampHour`, `MAX_HOURS_PER_DAY = 24`).
- Type a label `api,documentation` → comma silently stripped to `api documentation` (`sanitizeLabel`).

Text `<input>`s already set `maxLength` (e.g. `task-form-fields.tsx:119`), so *typed* text is stopped by the browser — but that stop is itself silent (the cursor just stops), and **paste** still truncates with no notice. Numeric clamps and label stripping rewrite the value with no explanation. The transformation is invisible until the user reopens the record.

This is both a UX problem and a data-trust problem: the user cannot tell that what they entered is not what was stored.

## Goals

1. Make every silent transformation visible at the moment it happens, in context.
2. Never block the user — feedback is informational, not a hard gate (consistent with the app, which never disables Save).
3. One reusable toolkit, applied consistently across the data-entry editors.
4. Honor the AIPM palette (9 tokens, no shadows/gradients) and the EN+DE i18n parity + DE-encoding guards.

## Non-Goals

- Per-field *validation* errors / required-field gating / submit-button disabling (the broader P2/P3 form-feedback work). Out of scope for this batch.
- Introducing a validation library (zod/yup/react-hook-form). Manual + the existing sanitizers are sufficient (YAGNI).
- Changing what the sanitizers actually do. Caps/clamps stay; only their *visibility* changes.

## Approved Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Classes covered | **All three**: capped text (counter), clamped numerics (notice), stripped labels (notice) — via one shared toolkit |
| Feedback model | **Inline live feedback + save-time summary toast** |
| Counter visibility | **Only near the cap** — hidden below 80%, shown muted at ≥80%, `AIPM-pink` at 100% |
| Clamp timing | **On blur, uniform** — free entry while typing; normalize when the field loses focus |
| `maxLength` on text | **Removed** — so the counter can climb past the cap in pink and paste is visibly over-limit; value trimmed on blur + at save |
| Editor surface | Task, RAID, Change, Shift, Budget-bucket, **Stakeholder, Resource** |

## Architecture

Two new modules plus wiring into the editors. Storage-layer sanitizers are unchanged (defense in depth).

### 1. `sanitize-report.ts` (new, pure, no React)

Runs the same caps/clamps as `sanitize.ts` but **reports** what changed. Bounds/caps are imported from `sanitize.ts` — single source of truth, no duplicated magic numbers.

```ts
export type Adjustment =
  | { kind: "truncated"; max: number; removed: number }
  | { kind: "clamped"; bound: "min" | "max"; to: number }
  | { kind: "stripped"; chars: string[] }
  | null;

export interface Report<T> { value: T; adjustment: Adjustment }

export function describeTextCap(raw: string, max: number): Report<string>;
export function describeClamp(
  raw: string,
  opts: { min?: number; max?: number; round?: number },
): Report<number | undefined>;
export function describeLabelStrip(raw: string): Report<string>; // detects , | \r \n \t
```

- `describeTextCap`: if `raw.length > max`, value is the slice and `adjustment = { kind: "truncated", max, removed: raw.length - max }`; else `adjustment = null`.
- `describeClamp`: parses the raw string; empty/blank → `{ value: undefined, adjustment: null }` (empty cell is valid). Out-of-range → clamps to the violated bound and reports `{ kind: "clamped", bound, to }`. Rounds to `round` decimals if given. Mirrors `sanitizeAmount` / `clampHour` semantics.
- `describeLabelStrip`: if any of `, | \r \n \t` were removed, reports `{ kind: "stripped", chars: [...uniqueRemoved] }`.

### 2. `field-feedback.tsx` (new, UI toolkit)

- **`<CharCounter value max id />`** — renders nothing while `value.length < 0.8 * max`; at ≥80% shows muted `count / max`; at ≥100% turns `AIPM-pink` and appends the `fieldTrimmedToFit` label. Used in an `aria-describedby` chain.
- **`<FieldNotice id>{children}</FieldNotice>`** — a `text-xs text-AIPM-pink` line under a field with `role="status"` / `aria-live="polite"` so clamps/strips are announced to assistive tech. The existing `EffortField` inline invalid message (`task-form-fields.tsx:517`) is re-pointed at this component for one consistent look.
- **`useAdjustmentTracker()`** — a submit-time collector. Returns `{ track, count, reset }`. Each sanitized field is passed through `track(report)`; it increments `count` when `report.adjustment !== null`. The editor's submit handler, after sanitizing, fires one toast `t(lang, "fieldsAdjusted", count)` when `count > 0`.

### 3. Unified entry model

Free entry, normalize on blur + at save, live counter — applied to both text and numerics:

- **Text / textarea:** drop the `maxLength` attribute. The `<CharCounter>` shows the live count; past 100% it is pink. On blur, `describeTextCap` trims the value and (when truncated) the counter shows "trimmed to fit". The submit path trims again via the existing `sanitize*` calls and records through `useAdjustmentTracker`.
- **Numerics:** type freely. On blur, `describeClamp` normalizes; if `adjustment !== null`, `<FieldNotice>` shows `fieldAdjustedMax` / `fieldAdjustedMin` with the bound value. Replaces shift-hours' current type-time clamp (`shift-edit-modal.tsx` `clampOnInput`).
- **Labels:** on entry, `describeLabelStrip` drives a `<FieldNotice>` listing the removed separators (`fieldCharsRemoved`).

### 4. Wiring surface

Counters on capped text, clamp-on-blur notices on numerics, label strip notice, and a save-time toast in each submit handler:

- **Task** (`task-form-fields.tsx`, `use-task-submit.ts`): counters on name (500), assignee (200), email (320), group (100), blockers (5000), notes (5000); label strip notice via the shared labels input; align `EffortField` to `<FieldNotice>`. Toast in `use-task-submit`.
- **RAID** (`raid-panel.tsx` editor): counters on title, description, owner. Toast in its submit.
- **Change** (`change-edit-modal.tsx`): counters on title, description, requestor, approver; clamp-on-blur on schedule-days and cost. Toast in `handleSubmit`.
- **Shift** (`shift-edit-modal.tsx`): clamp-on-blur on hours per weekday (0–`MAX_HOURS_PER_DAY`). Toast in `handleSubmit`.
- **Budget bucket** (`budget-bucket-modal.tsx`): counters on name (200), PO# (64); clamp-on-blur on fixed amount and internal/external rate overrides (0–`AMOUNT_MAX`). Toast in `handleSubmit`.
- **Stakeholder** (`stakeholder-edit-modal.tsx`): counters on name, organization, title, notes. Toast in `handleSubmit`.
- **Resource** (`resource-edit-modal.tsx`): counters on the capped text fields (first/last name, email, title, department, location, company, notes). Toast in `handleSubmit`.

### 5. Accessibility

Each capped/clamped input gets `aria-describedby` pointing at its counter/notice id; the notice region is `aria-live="polite"`. Add `aria-required` to inputs that already render a required asterisk while editing each field.

### 6. Palette

Counter: `text-muted-foreground` → `text-AIPM-pink` at the cap. Notices: `text-xs text-AIPM-pink` (matches `EffortField`). No new colors; no shadows/gradients.

### 7. Unchanged

Storage-layer sanitizers in `sanitize.ts` and `storage.ts` remain the final guard. This feature is additive feedback only; load/save normalization behavior is untouched.

## Data Flow

```
user types/pastes ──> editor field state (raw, free)
        │
        ├─ render ─> <CharCounter value max>  (hidden <80%, pink at cap)
        │
   on blur ─> describeTextCap / describeClamp / describeLabelStrip
        │         ├─ value normalized ─> field state
        │         └─ adjustment ─> <FieldNotice> (aria-live)
        │
   on submit ─> existing sanitize*() + useAdjustmentTracker.track(report)
                  └─ count>0 ─> one toast "Saved — N field(s) adjusted to fit limits"
                  └─ sanitized values ─> onSave ─> storage (sanitizers still run)
```

## Testing

- **Pure unit tests** — `sanitize-report.test.ts`: `describeTextCap` (no-change / truncated + `removed` count), `describeClamp` (in-range / clamp-max / clamp-min / empty→undefined / rounding), `describeLabelStrip` (no-change / stripped chars list). AAA style.
- **Component tests** — `CharCounter` (renders nothing <80%; shows `count / max` at ≥80%; pink + `fieldTrimmedToFit` at ≥100%); `FieldNotice` (renders children, has `aria-live`).
- **Hook test** — `useAdjustmentTracker` counts only non-null adjustments; toast fires once when `count > 0`.
- **Integration (representative, light)** — task notes: paste over cap → pink counter, trims on blur; shift hours: type `250`, blur → value `24` + clamp notice.
- **i18n** — new keys added to **both** `i18n.ts` and `i18n.de.ts`; DE authored in literal UTF-8; verify zero curly-quote *delimiters* with the ripgrep `[\x{201C}\x{201D}]` check (the byte-level `grep -c '[“”]'` over-counts ellipsis/en-dash and is a false alarm); i18n parity + encoding guards green.

## New i18n keys (EN + DE)

- `fieldCounter` — `"{0} / {1}"` (count / max)
- `fieldTrimmedToFit` — "trimmed to fit" / "auf Maximallänge gekürzt"
- `fieldAdjustedMax` — "adjusted to max {0}" / "auf Maximum {0} angepasst"
- `fieldAdjustedMin` — "adjusted to min {0}" / "auf Minimum {0} angepasst"
- `fieldCharsRemoved` — "removed: {0}" / "entfernt: {0}"
- `fieldsAdjusted` — "Saved — {0} field(s) adjusted to fit limits" / DE equivalent

(Exact wording finalized during implementation; both bundles must stay in parity.)

## Risks / Notes

- **`maxLength` removal is a deliberate behavior change.** Text fields can briefly hold more than the cap; the value is trimmed on blur and again at save. This is what makes paste-over-limit visible. Storage sanitizers guarantee the stored value is always within the cap regardless.
- Editors use divergent input markup (the `Field` wrapper in the task form vs raw `INPUT_CLASS` in modals); the toolkit is additive (drop-in counter/notice elements) rather than a wholesale input replacement, to avoid visual drift.
- Keep new files focused (target < 300 lines each); `sanitize-report.ts` and `field-feedback.tsx` are small and single-purpose.
