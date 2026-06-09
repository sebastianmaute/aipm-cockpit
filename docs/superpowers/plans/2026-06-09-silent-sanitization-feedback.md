# Silent-Sanitization Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the input transformations that `sanitize.ts` performs silently (text truncation, numeric clamping, label character-stripping) visible to the user — inline live feedback plus a save-time summary toast.

**Architecture:** A pure `sanitize-report.ts` describes each transformation; a small `field-feedback.tsx` toolkit (`CharCounter`, `FieldNotice`, `useAdjustmentTracker`) renders it. Both are wired into the seven data-entry editors. Storage-layer sanitizers are unchanged (defense in depth). Spec: `docs/superpowers/specs/2026-06-09-silent-sanitization-feedback-design.md`.

**Tech Stack:** TypeScript, React (Next.js), Tailwind + AIPM palette tokens, Vitest + React Testing Library. No new runtime dependencies.

## Conventions for every task

- Tests live beside source as `*.test.ts(x)`.
- Run a single test file with `npx vitest run <path>`.
- Lint: `npm run lint` (eslint, `--max-warnings=0`). Typecheck: `npx tsc --noEmit` (ignore any pre-existing `routes.d.ts` noise).
- Commit with the Bash tool heredoc: `git commit -F - <<'EOF' ... EOF`.
- Branch is already `feat-field-feedback`.
- AIPM palette only (no new colors, no shadows/gradients): counter uses `text-muted-foreground` → `text-AIPM-pink` at cap; notices use `text-xs text-AIPM-pink`.
- DE i18n must be literal UTF-8. After editing `i18n.de.ts`, verify zero curly-quote *delimiters* with the ripgrep Grep tool pattern `[\x{201C}\x{201D}]` (the shell `grep -c '[“”]'` over-counts ellipsis/en-dash — ignore it).
- **Accessibility (applies to every wiring task, Tasks 5–11):** when you add a `<CharCounter>` or `<FieldNotice>` after an input, give it a stable `id` (e.g. `id={`${fieldKey}-counter`}`) and set `aria-describedby={`${fieldKey}-counter`}` on the corresponding input (space-join multiple ids if a field has both a counter and a notice). Add `aria-required` to any input that already renders a required asterisk. This satisfies spec §5 uniformly; it is not repeated in each task's steps.

## File structure

- Create `src/app/sanitize-report.ts` — pure: `Adjustment`, `Report<T>`, `describeTextCap`, `describeClamp`, `describeLabelStrip`.
- Create `src/app/sanitize-report.test.ts` — pure unit tests.
- Create `src/app/field-feedback.tsx` — `CharCounter`, `FieldNotice`, `useAdjustmentTracker`.
- Create `src/app/field-feedback.test.tsx` — component + hook tests.
- Modify `src/app/i18n.ts` and `src/app/i18n.de.ts` — six new keys.
- Modify editors: `task-form-fields.tsx` (+ `use-task-submit.ts`, `labels-input.tsx`), `shift-edit-modal.tsx`, `change-edit-modal.tsx`, `budget-bucket-modal.tsx`, `raid-panel.tsx`, `stakeholder-edit-modal.tsx`, `resource-edit-modal.tsx`.
- Modify `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md` (release task).

---

## Task 1: `sanitize-report.ts` pure module

**Files:**
- Create: `src/app/sanitize-report.ts`
- Test: `src/app/sanitize-report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { describeTextCap, describeClamp, describeLabelStrip } from "./sanitize-report";

describe("describeTextCap", () => {
  it("returns the value unchanged with no adjustment when under the cap", () => {
    expect(describeTextCap("hello", 10)).toEqual({ value: "hello", adjustment: null });
  });

  it("truncates and reports the removed count when over the cap", () => {
    expect(describeTextCap("hello world", 5)).toEqual({
      value: "hello",
      adjustment: { kind: "truncated", max: 5, removed: 6 },
    });
  });
});

describe("describeClamp", () => {
  it("returns undefined and no adjustment for an empty string", () => {
    expect(describeClamp("", { min: 0, max: 24 })).toEqual({ value: undefined, adjustment: null });
  });

  it("passes an in-range value through, rounded", () => {
    expect(describeClamp("8.25", { min: 0, max: 24, round: 1 })).toEqual({ value: 8.3, adjustment: null });
  });

  it("clamps above max and reports the max bound", () => {
    expect(describeClamp("250", { min: 0, max: 24, round: 1 })).toEqual({
      value: 24,
      adjustment: { kind: "clamped", bound: "max", to: 24 },
    });
  });

  it("clamps below min and reports the min bound", () => {
    expect(describeClamp("-5", { min: 0, max: 24 })).toEqual({
      value: 0,
      adjustment: { kind: "clamped", bound: "min", to: 0 },
    });
  });

  it("treats a non-numeric entry as the min bound", () => {
    expect(describeClamp("abc", { min: 0, max: 24 })).toEqual({
      value: 0,
      adjustment: { kind: "clamped", bound: "min", to: 0 },
    });
  });
});

describe("describeLabelStrip", () => {
  it("returns the value unchanged when there are no separator chars", () => {
    expect(describeLabelStrip("frontend")).toEqual({ value: "frontend", adjustment: null });
  });

  it("replaces separators with a space and reports which chars were stripped", () => {
    expect(describeLabelStrip("api,docs")).toEqual({
      value: "api docs",
      adjustment: { kind: "stripped", chars: [","] },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/sanitize-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sanitize-report.ts`**

```ts
import { LABEL_MAX } from "./sanitize";

/** A single transformation a sanitizer applied to user input, or null if none. */
export type Adjustment =
  | { kind: "truncated"; max: number; removed: number }
  | { kind: "clamped"; bound: "min" | "max"; to: number }
  | { kind: "stripped"; chars: string[] }
  | null;

export interface Report<T> {
  value: T;
  adjustment: Adjustment;
}

/** Cap a string to `max`, reporting how many characters were removed. */
export function describeTextCap(raw: string, max: number): Report<string> {
  if (typeof raw !== "string" || raw.length <= max) {
    return { value: typeof raw === "string" ? raw : "", adjustment: null };
  }
  return {
    value: raw.slice(0, max),
    adjustment: { kind: "truncated", max, removed: raw.length - max },
  };
}

/** Parse + clamp a numeric string. Empty -> undefined (a blank cell is valid). */
export function describeClamp(
  raw: string,
  opts: { min?: number; max?: number; round?: number },
): Report<number | undefined> {
  const trimmed = (typeof raw === "string" ? raw : "").trim();
  if (trimmed === "") return { value: undefined, adjustment: null };
  const round = (n: number) =>
    opts.round != null ? Math.round(n * 10 ** opts.round) / 10 ** opts.round : n;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    const to = round(opts.min ?? 0);
    return { value: to, adjustment: { kind: "clamped", bound: "min", to } };
  }
  if (opts.min != null && num < opts.min) {
    const to = round(opts.min);
    return { value: to, adjustment: { kind: "clamped", bound: "min", to } };
  }
  if (opts.max != null && num > opts.max) {
    const to = round(opts.max);
    return { value: to, adjustment: { kind: "clamped", bound: "max", to } };
  }
  return { value: round(num), adjustment: null };
}

const LABEL_SEPARATORS = /[|,\r\n\t]/g;

/** Mirror sanitizeLabel: collapse separators to a space, trim, cap. Report stripped chars. */
export function describeLabelStrip(raw: string): Report<string> {
  if (typeof raw !== "string") return { value: "", adjustment: null };
  const matches = raw.match(LABEL_SEPARATORS);
  const value = raw.replace(/[|,\r\n\t]+/g, " ").trim().slice(0, LABEL_MAX);
  if (!matches) return { value, adjustment: null };
  const label = (c: string) =>
    c === "\r" ? "\\r" : c === "\n" ? "\\n" : c === "\t" ? "\\t" : c;
  const chars = [...new Set(matches.map(label))];
  return { value, adjustment: { kind: "stripped", chars } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/sanitize-report.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize-report.ts src/app/sanitize-report.test.ts
git commit -F - <<'EOF'
feat: sanitize-report — describe text-cap / clamp / label-strip adjustments
EOF
```

---

## Task 2: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (add to the `enUS` object, before its closing `} as const;`)
- Modify: `src/app/i18n.de.ts` (add to the `de` object, before its closing `};`)
- Test: `src/app/i18n.test.ts` (existing key-parity guard — no new test code, just must stay green)

**Context:** `t(lang, key, ...args)` replaces `{0}`, `{1}` positionally (`i18n.ts:1424`). Both bundles must contain identical keys or the parity guard fails.

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, add these lines just before the `} as const;` that closes the `enUS` object:

```ts
  fieldCounter: "{0} / {1}",
  fieldTrimmedToFit: "trimmed to fit",
  fieldAdjustedMax: "adjusted to max {0}",
  fieldAdjustedMin: "adjusted to min {0}",
  fieldCharsRemoved: "removed: {0}",
  fieldsAdjusted: "Saved — {0} field(s) adjusted to fit limits",
```

- [ ] **Step 2: Add the DE keys**

In `src/app/i18n.de.ts`, add these lines just before the `};` that closes the `de` object. Type the umlauts/ß directly as UTF-8 — do not use escapes:

```ts
  fieldCounter: "{0} / {1}",
  fieldTrimmedToFit: "auf Maximallänge gekürzt",
  fieldAdjustedMax: "auf Maximum {0} angepasst",
  fieldAdjustedMin: "auf Minimum {0} angepasst",
  fieldCharsRemoved: "entfernt: {0}",
  fieldsAdjusted: "Gespeichert — {0} Feld(er) auf Grenzwerte angepasst",
```

- [ ] **Step 3: Run the guards**

Run: `npx vitest run src/app/i18n.test.ts src/app/i18n-encoding.test.ts`
Expected: PASS (key parity + DE encoding).

Then verify zero curly-quote delimiters with the ripgrep Grep tool on `src/app/i18n.de.ts` using pattern `[\x{201C}\x{201D}]` → expect "No matches". (Do NOT rely on shell `grep -c '[“”]'`; it over-counts the `…`/`–` bytes.)

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: i18n strings for field sanitization feedback (EN+DE)
EOF
```

---

## Task 3: `field-feedback.tsx` — CharCounter + FieldNotice

**Files:**
- Create: `src/app/field-feedback.tsx`
- Test: `src/app/field-feedback.test.tsx`

**Context:** `CharCounter` is hidden below 80% of the cap, muted at ≥80%, `AIPM-pink` + "trimmed to fit" at ≥100%. `FieldNotice` is an `aria-live` line reusing the `EffortField` look (`text-xs text-AIPM-pink`).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CharCounter, FieldNotice } from "./field-feedback";

describe("CharCounter", () => {
  it("renders nothing below 80% of the cap", () => {
    const { container } = render(<CharCounter value={"x".repeat(70)} max={100} lang="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows count / max at >=80% of the cap", () => {
    render(<CharCounter value={"x".repeat(85)} max={100} lang="en-US" />);
    expect(screen.getByText("85 / 100")).toBeInTheDocument();
  });

  it("appends the trimmed-to-fit hint at the cap", () => {
    render(<CharCounter value={"x".repeat(100)} max={100} lang="en-US" />);
    expect(screen.getByText(/100 \/ 100/)).toHaveTextContent("trimmed to fit");
  });
});

describe("FieldNotice", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<FieldNotice>{null}</FieldNotice>);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders children inside an aria-live region", () => {
    render(<FieldNotice>adjusted to max 24</FieldNotice>);
    const el = screen.getByText("adjusted to max 24");
    expect(el).toHaveAttribute("aria-live", "polite");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/field-feedback.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `field-feedback.tsx`**

```tsx
import type { ReactNode } from "react";
import { type Lang, t } from "./i18n";

/** Below this fraction of the cap the counter is hidden to avoid noise. */
const WARN_RATIO = 0.8;

interface CharCounterProps {
  value: string;
  max: number;
  id?: string;
  lang: Lang;
}

/** Character counter: hidden < 80% of max, muted at >= 80%, pink + hint at the cap. */
export function CharCounter({ value, max, id, lang }: CharCounterProps) {
  const len = value.length;
  if (len < max * WARN_RATIO) return null;
  const atCap = len >= max;
  return (
    <p id={id} className={`mt-1 text-xs ${atCap ? "text-AIPM-pink" : "text-muted-foreground"}`}>
      {t(lang, "fieldCounter", len, max)}
      {atCap ? ` — ${t(lang, "fieldTrimmedToFit")}` : ""}
    </p>
  );
}

interface FieldNoticeProps {
  id?: string;
  children: ReactNode;
}

/** Inline, announced notice under a field (clamp/strip messages). */
export function FieldNotice({ id, children }: FieldNoticeProps) {
  if (!children) return null;
  return (
    <p id={id} role="status" aria-live="polite" className="mt-1 text-xs text-AIPM-pink">
      {children}
    </p>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/field-feedback.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/field-feedback.tsx src/app/field-feedback.test.tsx
git commit -F - <<'EOF'
feat: field-feedback — CharCounter + FieldNotice primitives
EOF
```

---

## Task 4: `useAdjustmentTracker` hook

**Files:**
- Modify: `src/app/field-feedback.tsx` (append the hook)
- Test: `src/app/field-feedback.test.tsx` (append a describe block)

**Context:** Submit handlers pass each sanitized field's `Report` through `track()`; if any had a non-null adjustment, the editor fires one toast with `fieldsAdjusted`.

- [ ] **Step 1: Write the failing test**

Append to `src/app/field-feedback.test.tsx`:

```tsx
import { renderHook, act } from "@testing-library/react";
import { useAdjustmentTracker } from "./field-feedback";
import type { Report } from "./sanitize-report";

describe("useAdjustmentTracker", () => {
  const changed: Report<string> = { value: "x", adjustment: { kind: "truncated", max: 1, removed: 3 } };
  const clean: Report<string> = { value: "x", adjustment: null };

  it("counts only reports with a non-null adjustment", () => {
    const { result } = renderHook(() => useAdjustmentTracker());
    let a = "", b = "";
    act(() => {
      a = result.current.track(changed);
      b = result.current.track(clean);
    });
    expect(a).toBe("x");
    expect(b).toBe("x");
    expect(result.current.count()).toBe(1);
  });

  it("resets the count", () => {
    const { result } = renderHook(() => useAdjustmentTracker());
    act(() => {
      result.current.track(changed);
      result.current.reset();
    });
    expect(result.current.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/field-feedback.test.tsx`
Expected: FAIL — `useAdjustmentTracker` not exported.

- [ ] **Step 3: Implement the hook**

Append to `src/app/field-feedback.tsx`:

```tsx
import { useRef } from "react";
import type { Report } from "./sanitize-report";

/**
 * Submit-time collector. Pass each sanitized field's Report through `track`
 * (it returns the clean value); after sanitizing, read `count()` to decide
 * whether to fire the "N fields adjusted" toast, then `reset()`.
 */
export function useAdjustmentTracker() {
  const adjusted = useRef(0);
  return {
    track<T>(report: Report<T>): T {
      if (report.adjustment !== null) adjusted.current += 1;
      return report.value;
    },
    count: () => adjusted.current,
    reset: () => {
      adjusted.current = 0;
    },
  };
}
```

(Move the `import { useRef } from "react";` to the top with the other imports — do not leave a second import statement mid-file.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/field-feedback.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/field-feedback.tsx src/app/field-feedback.test.tsx
git commit -F - <<'EOF'
feat: useAdjustmentTracker — count sanitization adjustments for the save toast
EOF
```

---

## Task 5: Wire the Task editor (template task)

**Files:**
- Modify: `src/app/task-form-fields.tsx`
- Modify: `src/app/use-task-submit.ts`
- Test: `src/app/task-form-feedback.test.tsx` (new integration test)

**Context:** `task-form-fields.tsx` renders capped text via the `Field` wrapper with a shared `inputClass` (line ~41) and `maxLength={...}` on each input (e.g. name `:119`). The `EffortField` (`:479`) already has an inline invalid message. The submit path sanitizes in `use-task-submit.ts`.

**This task establishes the wiring pattern reused by Tasks 6–11:**
1. Remove `maxLength` from capped text inputs.
2. Add `<CharCounter value={form.<field>} max={<CAP>} lang={lang} />` immediately after each capped input, inside its `Field`.
3. On blur of each capped text input, trim via `describeTextCap` and write the value back.
4. Replace `EffortField`'s ad-hoc `<p className="...text-AIPM-pink">` with `<FieldNotice>`.
5. Save-time toast: thread the tracker through `use-task-submit.ts`.

- [ ] **Step 1: Write the failing integration test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskFormFields } from "./task-form-fields";
// NOTE: import + render TaskFormFields with the minimal props the component needs.
// If TaskFormFields requires context providers, wrap with them here (see
// task-form-fields existing tests for the provider/harness shape).

describe("task form sanitization feedback", () => {
  it("shows the character counter when notes approach the cap", () => {
    // Arrange: render the task form with a notes value at >=80% of TEXTAREA_MAX (5000).
    // Act: (value provided via the form context / props harness used by existing tests)
    // Assert: a counter like "4900 / 5000" is visible.
    render(/* <TaskFormFields ...harness with notes = "x".repeat(4900) /> */ <div />);
    expect(screen.queryByText(/\/ 5000/)).toBeTruthy();
  });
});
```

> The exact harness mirrors existing tests that render the task form — read `src/app/tasks-section.test.tsx` and `src/app/task-manager.comms.test.tsx` for the provider/context wrapper shape (`WorkspaceTabProvider` + the task-form context) and reuse it; do not invent a new provider. If a full render proves heavy, fall back to a focused unit test that renders only the affected `Field` + `CharCounter` block. Keep this test to two assertions: (a) the counter appears near the cap, (b) blur trims an over-cap value back to the cap.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-form-feedback.test.tsx`
Expected: FAIL (counter not rendered yet).

- [ ] **Step 3: Implement — add imports**

At the top of `task-form-fields.tsx`:

```ts
import { CharCounter, FieldNotice } from "./field-feedback";
import { describeTextCap, describeLabelStrip } from "./sanitize-report";
```

- [ ] **Step 4: Implement — capped text fields**

For EACH capped text/textarea input (name `TASK_NAME_MAX`, assignee `ASSIGNEE_MAX`, email `EMAIL_MAX`, group `GROUP_MAX`, blockers `TEXTAREA_MAX`, notes `TEXTAREA_MAX`):
- Delete the `maxLength={...}` attribute.
- Add `onBlur` that trims: e.g. for notes
  ```tsx
  onBlur={(e) => setForm({ ...form, notes: describeTextCap(e.target.value, TEXTAREA_MAX).value })}
  ```
- Add the counter directly after the input, still inside its `Field`:
  ```tsx
  <CharCounter value={form.notes} max={TEXTAREA_MAX} lang={lang} />
  ```
Caps are already imported from `./sanitize` in this file; if a cap (e.g. `GROUP_MAX`) is not imported, add it to the existing `from "./sanitize"` import.

- [ ] **Step 5: Implement — EffortField uses FieldNotice**

Replace the EffortField message block (`task-form-fields.tsx:517-521`):

```tsx
{invalid && (
  <p className="mt-1 text-xs text-AIPM-pink">
    {t(lang, "taskEffortInvalid")}
  </p>
)}
```
with:
```tsx
{invalid && <FieldNotice>{t(lang, "taskEffortInvalid")}</FieldNotice>}
```

- [ ] **Step 6: Implement — labels strip notice**

In the labels input usage within the task form, after a label is entered, derive a transient notice. Add local state near the labels field:
```tsx
const [labelNotice, setLabelNotice] = useState<string | null>(null);
```
When committing a typed label, run it through `describeLabelStrip`; if `adjustment` is non-null, set the notice; clear it on the next clean entry:
```tsx
const report = describeLabelStrip(rawLabel);
setLabelNotice(report.adjustment ? t(lang, "fieldCharsRemoved", report.adjustment.kind === "stripped" ? report.adjustment.chars.join(" ") : "") : null);
// use report.value as the label to add
```
Render under the labels input:
```tsx
<FieldNotice>{labelNotice}</FieldNotice>
```
(If label-adding lives in `labels-input.tsx`, add the same `describeLabelStrip` call + a `<FieldNotice>` there instead, so the notice sits under that control.)

- [ ] **Step 7: Implement — save-time toast in use-task-submit**

In `use-task-submit.ts`, import and use the tracker:
```ts
import { useAdjustmentTracker } from "./field-feedback";
import { describeTextCap } from "./sanitize-report";
```
Instantiate `const adj = useAdjustmentTracker();` in the hook body. In the submit handler, where fields are sanitized (`notes: sanitizeNotes(form.notes)` etc.), route the capped text fields through the tracker, e.g.:
```ts
adj.reset();
const notes = adj.track(describeTextCap(form.notes, TEXTAREA_MAX)).slice(0, TEXTAREA_MAX);
// ...repeat for name/assignee/email/group/blockers using their caps...
```
After building the task object, before/after the existing success path:
```ts
if (adj.count() > 0) onShowToast("info", t(lang, "fieldsAdjusted", adj.count()));
```
`onShowToast` and `lang` are already available in this hook (used elsewhere). Keep the existing `sanitize*` calls as the authoritative cap — `describeTextCap` here is only to count adjustments; you may replace the `sanitize*` call with `adj.track(describeTextCap(...)).` and rely on it, since both cap identically.

- [ ] **Step 8: Run tests + checks**

Run: `npx vitest run src/app/task-form-feedback.test.tsx`
Run: `npx tsc --noEmit` (clean), `npm run lint` (clean)
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-form-fields.tsx src/app/use-task-submit.ts src/app/labels-input.tsx src/app/task-form-feedback.test.tsx
git commit -F - <<'EOF'
feat: surface input sanitization in the task editor (counters, label strip, save toast)
EOF
```

---

## Task 6: Wire the Shift editor (clamp-on-blur integration test)

**Files:**
- Modify: `src/app/shift-edit-modal.tsx`
- Test: `src/app/shift-edit-feedback.test.tsx` (new)

**Context:** `clampOnInput` (`shift-edit-modal.tsx:60`) currently clamps as the user types. Replace with clamp-on-blur + a `FieldNotice`. `updateHour(index, value)` (`:99`) sets a day's hours. `MAX_HOURS_PER_DAY` is in scope.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShiftEditModal } from "./shift-edit-modal";

function baseShift() {
  return { assignee: "Alice", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] };
}

describe("shift editor clamp feedback", () => {
  it("clamps an over-max hours entry on blur and shows a notice", () => {
    render(
      <ShiftEditModal
        lang="en-US"
        shift={baseShift() as never}
        isNew={false}
        existingAssigneeKeys={[]}
        knownAssignees={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const mon = screen.getByLabelText(/Mon/i) as HTMLInputElement; // adjust matcher to actual label
    fireEvent.change(mon, { target: { value: "250" } });
    fireEvent.blur(mon);
    expect(mon.value).toBe("24");
    expect(screen.getByText(/adjusted to max 24/i)).toBeInTheDocument();
  });
});
```

> If the day inputs are not associated with accessible labels, query by role `spinbutton`/`textbox` and index, mirroring how the existing shift tests (if any) locate them.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/shift-edit-feedback.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add imports:
```ts
import { FieldNotice } from "./field-feedback";
import { describeClamp } from "./sanitize-report";
import { MAX_HOURS_PER_DAY } from "./resource-foundation"; // or wherever it is defined; reuse the existing import in this file
```
Add per-row notice state:
```ts
const [hourNotice, setHourNotice] = useState<Record<number, string>>({});
```
Change the day inputs so typing is free (store the raw value or the parsed number without clamping), and clamp on blur:
```tsx
onChange={(e) => updateHour(i, Number(e.target.value))}
onBlur={(e) => {
  const r = describeClamp(e.target.value, { min: 0, max: MAX_HOURS_PER_DAY, round: 1 });
  updateHour(i, r.value ?? 0);
  setHourNotice((n) => ({
    ...n,
    [i]: r.adjustment
      ? t(lang, r.adjustment.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", r.adjustment.to)
      : "",
  }));
}}
```
Render the notice under each day input:
```tsx
<FieldNotice>{hourNotice[i]}</FieldNotice>
```
Delete the now-unused `clampOnInput` function.

- [ ] **Step 4: Run tests + checks**

Run: `npx vitest run src/app/shift-edit-feedback.test.tsx`
Run: `npx tsc --noEmit`, `npm run lint`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/shift-edit-modal.tsx src/app/shift-edit-feedback.test.tsx
git commit -F - <<'EOF'
feat: shift editor — clamp hours on blur with an inline notice
EOF
```

---

## Task 7: Wire the Change editor

**Files:**
- Modify: `src/app/change-edit-modal.tsx`
- Test: covered by typecheck + the shared toolkit tests (no new integration test required)

**Context:** Capped text fields: title, description, requestor, approver. Numeric fields: schedule-days and cost. The modal stores a `draft` and uses an `update(key, value)` helper; `INPUT_CLASS` is local. `onShowToast` may not exist as a prop — add it as optional.

- [ ] **Step 1: Add imports**

```ts
import { CharCounter, FieldNotice, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap, describeClamp } from "./sanitize-report";
import { TEXTAREA_MAX, TASK_NAME_MAX, ASSIGNEE_MAX, AMOUNT_MAX } from "./sanitize";
```
(Use the caps that match each field: title → `TASK_NAME_MAX`, description → `TEXTAREA_MAX`, requestor/approver → `ASSIGNEE_MAX`.)

- [ ] **Step 2: Capped text — counters + blur trim**

For title/description/requestor/approver: remove any `maxLength`, add
```tsx
onBlur={(e) => update("title", describeTextCap(e.target.value, TASK_NAME_MAX).value)}
```
and after each input:
```tsx
<CharCounter value={draft.title} max={TASK_NAME_MAX} lang={lang} />
```

- [ ] **Step 3: Numeric — clamp on blur**

For schedule-days (`{ min: 0, round: 0 }`) and cost (`{ min: 0, max: AMOUNT_MAX, round: 2 }`), add a `notice` state object keyed by field name and, on blur:
```tsx
const r = describeClamp(e.target.value, { min: 0, max: AMOUNT_MAX, round: 2 });
update("cost", r.value);
setNotice((n) => ({ ...n, cost: r.adjustment ? t(lang, r.adjustment.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", r.adjustment.to) : "" }));
```
Render `<FieldNotice>{notice.cost}</FieldNotice>` under each.

- [ ] **Step 4: Save-time toast (optional prop)**

Add `onShowToast?: (kind: "info" | "error", msg: string) => void` to the modal's `Props`. Instantiate `const adj = useAdjustmentTracker();`. In `handleSubmit`, route the capped fields through `adj.track(describeTextCap(...))` when building the saved item, then:
```ts
if (adj.count() > 0) onShowToast?.("info", t(lang, "fieldsAdjusted", adj.count()));
```
At the render site (`change-panel.tsx`), pass `onShowToast={showToast}` if a `showToast` is available there; otherwise leave it unset (toast simply won't fire — inline feedback still works).

- [ ] **Step 5: Checks + commit**

Run: `npx tsc --noEmit`, `npm run lint`
```bash
git add src/app/change-edit-modal.tsx src/app/change-panel.tsx
git commit -F - <<'EOF'
feat: change editor — text counters + numeric clamp notices + save toast
EOF
```

---

## Task 8: Wire the Budget-bucket editor

**Files:**
- Modify: `src/app/budget-bucket-modal.tsx`
- Test: typecheck + toolkit tests

**Context:** Capped text: name (`BUDGET_NAME_MAX`), PO# (`PO_NUMBER_MAX`). Numerics: fixed amount and internal/external rate overrides (`{ min: 0, max: AMOUNT_MAX, round: 2 }`). Import the caps from `./sanitize`.

- [ ] **Step 1:** Add imports (`CharCounter`, `FieldNotice`, `useAdjustmentTracker`, `describeTextCap`, `describeClamp`, and caps `BUDGET_NAME_MAX`, `PO_NUMBER_MAX`, `AMOUNT_MAX`).
- [ ] **Step 2:** name + PO#: remove `maxLength`, add blur-trim via `describeTextCap`, add `<CharCounter>` after each.
- [ ] **Step 3:** fixed amount + rate overrides: clamp on blur via `describeClamp({ min: 0, max: AMOUNT_MAX, round: 2 })`, add `<FieldNotice>` per field (notice state keyed by field).
- [ ] **Step 4:** Save toast: optional `onShowToast` prop + `useAdjustmentTracker`, fire `fieldsAdjusted` when `count() > 0`.
- [ ] **Step 5:** Run `npx tsc --noEmit`, `npm run lint`; commit:
```bash
git add src/app/budget-bucket-modal.tsx
git commit -F - <<'EOF'
feat: budget bucket editor — text counters + amount/rate clamp notices + save toast
EOF
```

---

## Task 9: Wire the RAID editor

**Files:**
- Modify: `src/app/raid-panel.tsx` (the RAID edit form within)
- Test: typecheck + toolkit tests

**Context:** Capped text: title (`TASK_NAME_MAX`), description (`TEXTAREA_MAX`), owner (`ASSIGNEE_MAX`). No numeric clamps. The editor uses a `draft` + `update(key, value)` pattern (`raid-panel.tsx:859`).

- [ ] **Step 1:** Add imports (`CharCounter`, `useAdjustmentTracker`, `describeTextCap`, caps).
- [ ] **Step 2:** For title/description/owner: remove `maxLength`, add blur-trim via `describeTextCap`, add `<CharCounter value={draft.title} max={TASK_NAME_MAX} lang={lang} />` after each.
- [ ] **Step 3:** Save toast: optional `onShowToast` prop + `useAdjustmentTracker`; fire `fieldsAdjusted` when `count() > 0`. If `raid-panel` already has access to a toast, pass it; otherwise leave optional.
- [ ] **Step 4:** Run `npx tsc --noEmit`, `npm run lint`; commit:
```bash
git add src/app/raid-panel.tsx
git commit -F - <<'EOF'
feat: RAID editor — text counters + save toast
EOF
```

---

## Task 10: Wire the Stakeholder editor

**Files:**
- Modify: `src/app/stakeholder-edit-modal.tsx`
- Test: typecheck + toolkit tests

**Context:** Capped text: name (`ASSIGNEE_MAX`), organization (`ASSIGNEE_MAX`), title (`ASSIGNEE_MAX`), notes (`TEXTAREA_MAX`). `draft` + `update` pattern; `saveDisabled` already computed (`:103`). No numerics.

- [ ] **Step 1:** Add imports (`CharCounter`, `useAdjustmentTracker`, `describeTextCap`, caps `ASSIGNEE_MAX`, `TEXTAREA_MAX`).
- [ ] **Step 2:** For name/organization/title/notes: remove `maxLength`, add blur-trim via `describeTextCap`, add `<CharCounter>` after each.
- [ ] **Step 3:** Save toast: optional `onShowToast` prop + `useAdjustmentTracker`; fire `fieldsAdjusted` when `count() > 0`.
- [ ] **Step 4:** Run `npx tsc --noEmit`, `npm run lint`; commit:
```bash
git add src/app/stakeholder-edit-modal.tsx
git commit -F - <<'EOF'
feat: stakeholder editor — text counters + save toast
EOF
```

---

## Task 11: Wire the Resource editor

**Files:**
- Modify: `src/app/resource-edit-modal.tsx`
- Test: typecheck + toolkit tests

**Context:** Capped text fields: first name, last name, email (`EMAIL_MAX`), title, department, location, company, notes (`TEXTAREA_MAX`). Use `ASSIGNEE_MAX` for the short name/title/department/location/company fields (or the field-specific cap if the resource sanitizer defines one — check `sanitizeResource` in `sanitize.ts` and reuse its caps). `draft` + `update` pattern.

- [ ] **Step 1:** Add imports (`CharCounter`, `useAdjustmentTracker`, `describeTextCap`, caps).
- [ ] **Step 2:** For each capped text field: remove `maxLength`, add blur-trim via `describeTextCap`, add `<CharCounter>` after each.
- [ ] **Step 3:** Save toast: optional `onShowToast` prop + `useAdjustmentTracker`; fire `fieldsAdjusted` when `count() > 0`.
- [ ] **Step 4:** Run `npx tsc --noEmit`, `npm run lint`; commit:
```bash
git add src/app/resource-edit-modal.tsx
git commit -F - <<'EOF'
feat: resource editor — text counters + save toast
EOF
```

---

## Task 12: Release v0.56.0 "Bradbury" + full verification

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`

- [ ] **Step 1: Version + highlight**

`version.ts`: add a narrative comment at the top; set `APP_VERSION = "0.56.0"`, `APP_BUILD_DATE` to today, `APP_MILESTONE = "Bradbury"`; add `"versionHighlightFieldFeedback"` to `APP_HIGHLIGHT_KEYS`. `package.json`: `"version": "0.56.0"`.

- [ ] **Step 2: Highlight i18n (EN+DE)**

Add `versionHighlightFieldFeedback` to both bundles, e.g. EN "Input feedback: character counters, clamp notices, and a save-time summary when entries are adjusted to fit limits." + a DE equivalent (literal UTF-8). Run `npx vitest run src/app/i18n.test.ts` → PASS.

- [ ] **Step 3: CHANGELOG + codemap**

Add a `## [0.56.0] — <date> "Bradbury"` entry summarizing the feature. Add rows for `sanitize-report.ts` and `field-feedback.tsx` to `docs/CODEMAPS/frontend.md` and bump its header stamp to include 0.56.0.

- [ ] **Step 4: Full verification**

Run: `npm run test:run` → all green (a lone pre-existing flaky timeout in `due-dates.property.test.ts` is acceptable; re-run it solo with `--testTimeout=30000` to confirm).
Run: `npm run lint` → clean.
Run: `npx tsc --noEmit` → clean.
Verify DE curly-quote delimiters via the ripgrep Grep tool `[\x{201C}\x{201D}]` on `i18n.de.ts` → no matches.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md docs/CODEMAPS/frontend.md src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
chore: release 0.56.0 "Bradbury" — input sanitization feedback
EOF
```

---

## Final review (after all tasks)

Dispatch a holistic code reviewer over the whole branch diff. Specifically check:
- Every capped text field across the seven editors lost its `maxLength` AND gained a `<CharCounter>` + blur-trim (no field left half-wired).
- Numeric clamps (shift hours, change schedule-days/cost, budget amount/rates) clamp on blur and show a `<FieldNotice>`; no remaining type-time clamp.
- `describeClamp` empty-string → `undefined` is honored where the field is optional (budget rate overrides, cost) so a blank cell is not turned into 0.
- No off-palette colors; DE bundle has 0 curly-quote delimiters and 0 mojibake; i18n parity holds.
- Storage sanitizers in `sanitize.ts`/`storage.ts` are unchanged.

Then use **superpowers:finishing-a-development-branch** → push + GitLab MR → merge on green.
