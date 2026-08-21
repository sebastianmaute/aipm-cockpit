# Slice C — Timelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give both Time-bookings filter fields a single keyboard-reachable ✕, make the customer/project picker selection survive a reload even without fetching, and let the apply-to-budget confirm list grow with its content.

**Architecture:** One new presentational primitive (✕ overlay, caller keeps its own field), one new per-device store (`aipm-cockpit:timelog-picker`) that is deliberately separate from the workspace-level `timelogLinks`, and one new pure module holding the three-way seeding precedence so the panel's fragile render-time reconcile stays thin and testable.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Tailwind v4, vitest + Testing Library, Playwright (axe gate).

**Spec:** `docs/superpowers/specs/2026-07-27-slice-c-timelog-design.md`
**Release:** 0.204.0 "Benford"

---

## STATUS: implemented 2026-07-28, unpushed. Two deviations from this plan.

Every step below is ticked, but **two were not implemented as written**. The roadmap spec carries
the full reasoning under "Slice C — what the plan got wrong"; in short:

1. **Task 5 Step 5 — the ladder is a monotonic RANK, not a `pickerSeeded` boolean.** As written the
   plan silently dropped a documented behaviour: `timelogLinks` hydrates asynchronously and today's
   block (1) gates on `!linksSeeded` alone, so late links override a name auto-resolve. A boolean
   latches on the weaker seed. Shipped `none 0 < auto 1 < links 2 < picker 3`, re-seeding only on a
   strictly higher source, plus a `useMemo`'d device-store read (the plan's claim that `"none"` only
   means "directory not loaded" is contradicted by its own Task 3 test). Two regression tests added
   to `timelog-panel.test.tsx`, both mutation-verified.
2. **A ninth task was required: `use-timelog-picker-scope.ts`.** The plan did not account for the
   size ratchet. `timelog-panel.tsx` went 777 → 856, over the 800 cap; the picker cluster was
   extracted, taking it to 721. No `coverage.exclude` entry was needed — the panel suite covers it.

Gates at completion: lint 0 · `tsc` 0 · **8286/8286** unit tests · coverage 94.27 lines / 93 funcs /
84.11 branch / 91.48 stmts (all above floors) · `dup:check` 1.16% / 1.47% · `size:check` ok · axe
Time bookings **5/5** combos.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/clearable-search-input.tsx` | **Create.** Presentational ✕ overlay. Owns the `relative` wrapper + button only; caller supplies the field. |
| `src/app/clearable-search-input.test.tsx` | **Create.** Component test. |
| `src/app/timelog-picker-store.ts` | **Create.** Per-device, per-project picker scope. Pure storage + validation + cap. |
| `src/app/timelog-picker-store.test.ts` | **Create.** Store test. |
| `src/app/timelog-initial-scope.ts` | **Create.** Pure seeding precedence + mismatch predicate. No clock, no i18n. |
| `src/app/timelog-initial-scope.test.ts` | **Create.** Ladder test. |
| `src/app/timelog-customer-scope.tsx` | **Modify.** Wrap its `Input` in the new primitive. |
| `src/app/timelog-project-scope.tsx` | **Modify.** Same; keep `role="searchbox"`. |
| `src/app/timelog-panel.tsx` | **Modify.** New `projectKey` prop; persist on pick; use the resolver; render the hint. |
| `src/app/workspace-section.tsx:921` | **Modify.** Pass `projectKey`. |
| `src/app/timelog-apply-confirm.tsx` | **Modify.** Sizing. |
| `src/app/i18n.ts` / `i18n.de.ts` | **Modify.** One new key. |

★ **Two hard constraints that will bite:**
1. `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts in it. Use the node write in Task 6 verbatim.
2. Lint runs `--max-warnings=0`. An unused import is **fatal**. Re-check after every extraction.

---

### Task 1: `ClearableSearchInput` primitive

**Files:**
- Create: `src/app/clearable-search-input.tsx`
- Test: `src/app/clearable-search-input.test.tsx`

- [x] **Step 1: Write the failing test**

Create `src/app/clearable-search-input.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClearableSearchInput } from "./clearable-search-input";

function setup(value: string, onClear = vi.fn()) {
  render(
    <ClearableSearchInput value={value} onClear={onClear} clearLabel="Clear">
      <input aria-label="Filter" defaultValue={value} readOnly />
    </ClearableSearchInput>,
  );
  return { onClear };
}

describe("ClearableSearchInput", () => {
  it("renders no clear button while the value is empty", () => {
    setup("");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("renders a labelled clear button once the value is non-empty", () => {
    setup("abc");
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("calls onClear when the button is activated", async () => {
    const { onClear } = setup("abc");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps the clear button keyboard-reachable", async () => {
    setup("abc");
    const btn = screen.getByRole("button", { name: "Clear" });
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it("renders the caller's field as its child", () => {
    setup("abc");
    expect(screen.getByLabelText("Filter")).toBeTruthy();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/clearable-search-input.test.tsx`
Expected: FAIL — `Failed to resolve import "./clearable-search-input"`.

- [x] **Step 3: Write the implementation**

Create `src/app/clearable-search-input.tsx`:

```tsx
"use client";

// Shared "✕ to clear" overlay for search/filter fields. Owns ONLY the relative
// wrapper and the overlaid button — the caller supplies its own field, so each
// site keeps its existing shell (report-table uses a raw <input>, the timelog
// panel uses `Input size="xs"`; unifying those would re-baseline visual
// snapshots across seven panels for no user-visible gain).
//
// Every non-obvious choice below is load-bearing and was paid for once already
// in TableFilter:
//  - The button is OVERLAID, not a sibling. A sibling next to a `type=search`
//    field reads as TWO clears in Chrome/Safari and ONE in Firefox.
//  - FOCUS_RING + TRANSITION, never the full INTERACTIVE atom: INTERACTIVE
//    bundles PRESS (`active:translate-y-px`), which writes the same
//    --tw-translate-y as the -translate-y-1/2 centring here, so the glyph
//    jumped out of centre for the duration of every press.
//  - h-6 w-6 = 24px is the WCAG 2.2 SC 2.5.8 target floor; the icon is 14px, so
//    padding alone left a ~20px target.
//  - right-1.5 + 24px = 30px stays inside the caller's pr-8 (32px), so field
//    text never runs under the button.
//
// i18n-free (the EntityLinkPicker convention): the caller passes an
// already-translated `clearLabel`.
import { type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

export interface ClearableSearchInputProps {
  /** Current field value — the ✕ renders only while this is non-empty. */
  value: string;
  /** Invoked when the ✕ is activated; the caller clears its own state. */
  onClear: () => void;
  /** Already-translated accessible name (also used as the title). */
  clearLabel: string;
  /** The field. It must reserve room via `pr-8` while `value` is non-empty and,
   *  if it is `type="search"`, suppress the native control with
   *  `[&::-webkit-search-cancel-button]:appearance-none`. */
  children: ReactNode;
  /** Extra classes for the positioning wrapper — sizing stays with the caller. */
  className?: string;
}

export function ClearableSearchInput({
  value,
  onClear,
  clearLabel,
  children,
  className,
}: ClearableSearchInputProps) {
  return (
    <div className={`relative${className ? ` ${className}` : ""}`}>
      {children}
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
        >
          <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/clearable-search-input.test.tsx`
Expected: PASS, 5 tests.

- [x] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` → expected exit 0.

```bash
git add src/app/clearable-search-input.tsx src/app/clearable-search-input.test.tsx
git commit -m "feat(ui): add ClearableSearchInput overlay primitive"
```

---

### Task 2: Per-device picker store

**Files:**
- Create: `src/app/timelog-picker-store.ts`
- Test: `src/app/timelog-picker-store.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/app/timelog-picker-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  TIMELOG_PICKER_MAX_PROJECTS,
  clearPickerScope,
  loadPickerScope,
  savePickerScope,
} from "./timelog-picker-store";

const KEY = "aipm-cockpit:timelog-picker";

describe("timelog-picker-store", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a scope for a project", () => {
    savePickerScope("p1", { customerId: 7, projectIds: [1, 2] });
    expect(loadPickerScope("p1")).toEqual({ customerId: 7, projectIds: [1, 2] });
  });

  it("keeps projects isolated from each other", () => {
    savePickerScope("p1", { customerId: 7, projectIds: [1] });
    savePickerScope("p2", { customerId: 9, projectIds: [2] });
    expect(loadPickerScope("p1").customerId).toBe(7);
    expect(loadPickerScope("p2").customerId).toBe(9);
  });

  it("returns an empty scope for an unknown project", () => {
    expect(loadPickerScope("nope")).toEqual({});
  });

  it("does not leak the internal ordering field to callers", () => {
    savePickerScope("p1", { customerId: 7 });
    expect("seq" in loadPickerScope("p1")).toBe(false);
  });

  it("falls back to an empty scope on malformed JSON", () => {
    window.localStorage.setItem(KEY, "{ not json");
    expect(loadPickerScope("p1")).toEqual({});
  });

  it("drops entries whose shape is wrong, keeping valid siblings", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ bad: { customerId: "seven" }, good: { customerId: 7 } }),
    );
    expect(loadPickerScope("bad")).toEqual({});
    expect(loadPickerScope("good").customerId).toBe(7);
  });

  it("rejects a projectIds array containing non-numbers", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ p1: { projectIds: [1, "2"] } }));
    expect(loadPickerScope("p1")).toEqual({});
  });

  it("caps stored projects, evicting the least-recently-saved", () => {
    for (let i = 0; i < TIMELOG_PICKER_MAX_PROJECTS + 5; i++) {
      savePickerScope(`p${i}`, { customerId: i });
    }
    // p0..p4 evicted; p5 onward retained.
    expect(loadPickerScope("p0")).toEqual({});
    expect(loadPickerScope("p4")).toEqual({});
    expect(loadPickerScope("p5").customerId).toBe(5);
    expect(loadPickerScope(`p${TIMELOG_PICKER_MAX_PROJECTS + 4}`).customerId).toBe(
      TIMELOG_PICKER_MAX_PROJECTS + 4,
    );
  });

  it("re-saving an old project keeps it alive through eviction", () => {
    savePickerScope("keepme", { customerId: 1 });
    for (let i = 0; i < TIMELOG_PICKER_MAX_PROJECTS - 1; i++) {
      savePickerScope(`p${i}`, { customerId: i });
    }
    savePickerScope("keepme", { customerId: 2 }); // touch → newest
    savePickerScope("overflow", { customerId: 99 });
    expect(loadPickerScope("keepme").customerId).toBe(2);
  });

  it("clears every stored scope", () => {
    savePickerScope("p1", { customerId: 7 });
    clearPickerScope();
    expect(loadPickerScope("p1")).toEqual({});
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/timelog-picker-store.test.ts`
Expected: FAIL — `Failed to resolve import "./timelog-picker-store"`.

- [x] **Step 3: Write the implementation**

Create `src/app/timelog-picker-store.ts`:

```ts
// Per-device, per-project Time-bookings PICKER scope — which customer and which
// of that customer's projects are currently selected in the two-step fetch flow.
//
// Deliberately NOT `Workspace.timelogLinks`. That field means "the scope of the
// LAST FETCH", and `handleRefreshBookings` depends on it meaning exactly that
// ("re-fetches the LAST-FETCHED scope, independent of the live picker"). It is
// also workspace data, so writing it on every dropdown change would dirty the
// workspace and fire an autosave — a network write under Turso — per twiddle.
// This store means "what is currently picked" and never leaves the device.
//
// NOT a Workspace field: never exported, never in Turso, absent from the
// recovery CONFIG_KEYS; cleared by app-reset's `aipm-cockpit:*` sweep purely via
// the key prefix, so it needs no wiring there.

import { readDeviceJson, removeDeviceKey, writeDeviceJson } from "./device-store";

const TIMELOG_PICKER_KEY = "aipm-cockpit:timelog-picker";
export const TIMELOG_PICKER_MAX_PROJECTS = 50;

export interface TimelogPickerScope {
  customerId?: number;
  projectIds?: number[];
}

/** Stored shape. `seq` is a monotonic recency counter used only for eviction and
 *  is stripped before the scope reaches a caller.
 *
 *  Why a counter and not a timestamp: this module must stay clock-free (pure and
 *  trivially testable — landing-state can sort on a `lastVisitAt` it already
 *  stores for its own reasons; there is no such field here and inventing one
 *  just to cap would be worse). Why not rely on object key insertion order:
 *  JS orders integer-like string keys NUMERICALLY ahead of insertion-ordered
 *  string keys, and a project key can be numeric, so insertion order is not
 *  trustworthy here. */
interface StoredScope extends TimelogPickerScope {
  seq?: number;
}

type ScopeMap = Record<string, StoredScope>;

function isStoredScope(v: unknown): v is StoredScope {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as StoredScope;
  if (s.customerId !== undefined && (typeof s.customerId !== "number" || !Number.isFinite(s.customerId))) {
    return false;
  }
  if (s.seq !== undefined && (typeof s.seq !== "number" || !Number.isFinite(s.seq))) return false;
  if (s.projectIds !== undefined) {
    if (!Array.isArray(s.projectIds)) return false;
    if (s.projectIds.some((n) => typeof n !== "number" || !Number.isFinite(n))) return false;
  }
  return true;
}

function readMap(): ScopeMap {
  const parsed = readDeviceJson<unknown>(TIMELOG_PICKER_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ScopeMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isStoredScope(v)) out[k] = v;
  }
  return out;
}

export function loadPickerScope(projectKey: string): TimelogPickerScope {
  const stored = readMap()[projectKey];
  if (!stored) return {};
  const { seq: _seq, ...scope } = stored;
  void _seq;
  return scope;
}

export function savePickerScope(projectKey: string, scope: TimelogPickerScope): void {
  const map = readMap();
  let maxSeq = 0;
  for (const v of Object.values(map)) if ((v.seq ?? 0) > maxSeq) maxSeq = v.seq ?? 0;
  map[projectKey] = { ...scope, seq: maxSeq + 1 };

  const entries = Object.entries(map);
  if (entries.length > TIMELOG_PICKER_MAX_PROJECTS) {
    entries.sort((a, b) => (b[1].seq ?? 0) - (a[1].seq ?? 0));
    const kept: ScopeMap = {};
    for (const [k, v] of entries.slice(0, TIMELOG_PICKER_MAX_PROJECTS)) kept[k] = v;
    writeDeviceJson(TIMELOG_PICKER_KEY, kept);
    return;
  }
  writeDeviceJson(TIMELOG_PICKER_KEY, map);
}

export function clearPickerScope(): void {
  removeDeviceKey(TIMELOG_PICKER_KEY);
}
```

★ The `const { seq: _seq, ...scope }` + `void _seq;` shape is deliberate: lint has **no** `argsIgnorePattern`, so a bare unused `_seq` binding is a fatal warning. The `void` reference satisfies it.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/timelog-picker-store.test.ts`
Expected: PASS, 10 tests.

- [x] **Step 5: Lint, typecheck, commit**

Run: `npm run lint` → expected 0 warnings.
Run: `npx tsc --noEmit` → expected exit 0.

```bash
git add src/app/timelog-picker-store.ts src/app/timelog-picker-store.test.ts
git commit -m "feat(timelog): add per-device picker scope store"
```

---

### Task 3: Pure seeding precedence

**Files:**
- Create: `src/app/timelog-initial-scope.ts`
- Test: `src/app/timelog-initial-scope.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/app/timelog-initial-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveInitialScope, scopeMismatch } from "./timelog-initial-scope";

const customers = [
  { id: 1, name: "Acme" },
  { id: 2, name: "Globex" },
];

describe("resolveInitialScope", () => {
  it("prefers the device picker scope over everything else", () => {
    const r = resolveInitialScope({
      picker: { customerId: 2, projectIds: [5] },
      links: { customerId: 1, projectIds: [9] },
      customers,
      customerName: "Acme",
    });
    expect(r).toEqual({ customerId: 2, projectIds: [5], source: "picker" });
  });

  it("falls back to the last-fetched links scope", () => {
    const r = resolveInitialScope({
      picker: {},
      links: { customerId: 1, projectIds: [9] },
      customers,
      customerName: "Globex",
    });
    expect(r).toEqual({ customerId: 1, projectIds: [9], source: "links" });
  });

  it("auto-resolves the project's customer name when nothing is persisted", () => {
    const r = resolveInitialScope({
      picker: {},
      links: {},
      customers,
      customerName: "Globex",
    });
    expect(r).toEqual({ customerId: 2, projectIds: [], source: "auto" });
  });

  it("reports none when the directory has not loaded yet", () => {
    const r = resolveInitialScope({
      picker: {},
      links: {},
      customers: [],
      customerName: "Globex",
    });
    expect(r).toEqual({ customerId: "", projectIds: [], source: "none" });
  });

  it("reports none when the customer name matches nothing", () => {
    const r = resolveInitialScope({
      picker: {},
      links: {},
      customers,
      customerName: "Initech",
    });
    expect(r.source).toBe("none");
  });

  it("treats a picker scope with no projects as still authoritative", () => {
    const r = resolveInitialScope({
      picker: { customerId: 2 },
      links: { customerId: 1, projectIds: [9] },
      customers,
      customerName: "Acme",
    });
    expect(r).toEqual({ customerId: 2, projectIds: [], source: "picker" });
  });
});

describe("scopeMismatch", () => {
  it("is true when the picker and the last fetch disagree", () => {
    expect(scopeMismatch(2, 1)).toBe(true);
  });

  it("is false when they agree", () => {
    expect(scopeMismatch(1, 1)).toBe(false);
  });

  it("is false when nothing has been fetched yet", () => {
    expect(scopeMismatch(2, undefined)).toBe(false);
  });

  it("is false when the picker is empty", () => {
    expect(scopeMismatch("", 1)).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/timelog-initial-scope.test.ts`
Expected: FAIL — `Failed to resolve import "./timelog-initial-scope"`.

- [x] **Step 3: Write the implementation**

Create `src/app/timelog-initial-scope.ts`:

```ts
// Pure decision for "which customer/project scope should the Time-bookings
// picker start from?", plus the predicate for "is the picker now showing a
// different customer than the loaded bookings came from?".
//
// Extracted out of the panel's render-time reconcile because that block is a
// guarded one-shot ladder (userPicked / pickerSeeded / linksSeeded /
// autoResolved, all reset by a last-seen project key) which is easy to break
// silently and expensive to test through a mounted panel.
//
// i18n-free, clock-free, no React.

import { resolveCustomerByName } from "./timelog-match";
import type { TimelogPickerScope } from "./timelog-picker-store";

export type InitialScopeSource = "picker" | "links" | "auto" | "none";

export interface InitialScope {
  customerId: number | "";
  projectIds: number[];
  source: InitialScopeSource;
}

export function resolveInitialScope(input: {
  /** Per-device picker scope for this project (what is currently selected). */
  picker: TimelogPickerScope;
  /** Workspace-level last-fetched scope. */
  links: { customerId?: number; projectIds?: number[] };
  /** Loaded customer directory — empty until it has been fetched. */
  customers: readonly { id: number; name: string }[];
  /** The project's free-text customer name, for the auto-resolve fallback. */
  customerName: string | undefined;
}): InitialScope {
  const { picker, links, customers, customerName } = input;

  // (1) The device picker wins. It exists precisely so a selection made WITHOUT
  //     fetching survives a reload, so it must outrank the last-fetched scope.
  if (picker.customerId !== undefined) {
    return { customerId: picker.customerId, projectIds: picker.projectIds ?? [], source: "picker" };
  }

  // (2) Else the last-fetched scope.
  if (links.customerId !== undefined) {
    return { customerId: links.customerId, projectIds: links.projectIds ?? [], source: "links" };
  }

  // (3) Else resolve the project's customer name against the directory — only
  //     possible once it has loaded. resolveCustomerByName returns null unless
  //     exactly one customer matches, so an ambiguous name resolves to nothing.
  if (customers.length > 0) {
    const hit = resolveCustomerByName(customers, customerName);
    if (hit) return { customerId: hit.id, projectIds: [], source: "auto" };
  }

  return { customerId: "", projectIds: [], source: "none" };
}

/** True when the picker shows a different customer than the one the currently
 *  loaded bookings came from. The panel surfaces this instead of letting the
 *  picker silently misrepresent what is on screen. */
export function scopeMismatch(
  pickerCustomerId: number | "",
  lastFetchedCustomerId: number | undefined,
): boolean {
  return (
    lastFetchedCustomerId !== undefined &&
    pickerCustomerId !== "" &&
    pickerCustomerId !== lastFetchedCustomerId
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/timelog-initial-scope.test.ts`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

Run: `npx tsc --noEmit` → expected exit 0.

```bash
git add src/app/timelog-initial-scope.ts src/app/timelog-initial-scope.test.ts
git commit -m "feat(timelog): add pure picker-scope precedence resolver"
```

---

### Task 4: Wire the ✕ into both filter fields

**Files:**
- Modify: `src/app/timelog-customer-scope.tsx:33-45`
- Modify: `src/app/timelog-project-scope.tsx:61-73`

- [x] **Step 1: Replace the customer filter field**

In `src/app/timelog-customer-scope.tsx`, add to the imports:

```tsx
import { ClearableSearchInput } from "./clearable-search-input";
```

Replace the whole `<Input …/>` element (currently the first child of the fragment) with:

```tsx
      <ClearableSearchInput
        value={filter}
        onClear={() => onFilterChange("")}
        clearLabel={t(lang, "clear")}
        className="w-28 print:hidden"
      >
        <Input
          type="search"
          size="xs"
          aria-label={t(lang, "timelogCustomerFilter")}
          placeholder={t(lang, "timelogCustomerFilter")}
          value={filter}
          disabled={disabled}
          onFocus={onFocusLoad}
          onChange={(e) => onFilterChange(e.target.value)}
          className={`w-full ${filter ? "pr-8" : ""} [&::-webkit-search-cancel-button]:appearance-none`}
        />
      </ClearableSearchInput>
```

★ The sizing (`w-28 print:hidden`) moves to the wrapper and the field becomes `w-full`; leaving `w-28` on the field would size it independently of the positioning box and the ✕ would land off-target.

- [x] **Step 2: Replace the project filter field**

In `src/app/timelog-project-scope.tsx`, add to the imports:

```tsx
import { ClearableSearchInput } from "./clearable-search-input";
```

Replace the `{hasCustomer && ( <Input … /> )}` block with:

```tsx
      {hasCustomer && (
        <ClearableSearchInput
          value={filter}
          onClear={() => onFilterChange("")}
          clearLabel={t(lang, "clear")}
        >
          <Input
            type="text"
            role="searchbox"
            size="xs"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={t(lang, "timelogProjectFilter")}
            aria-label={t(lang, "timelogProjectFilter")}
            disabled={disabled}
            className={`w-full ${filter ? "pr-8" : ""}`}
          />
        </ClearableSearchInput>
      )}
```

★ Keep `type="text" role="searchbox"` exactly as-is — the role is a deliberate a11y choice on a text input, and switching to `type="search"` would reintroduce the native control this task removes. No `appearance-none` needed here: a text input draws no native ✕.

- [x] **Step 3: Verify both render and clear**

Run: `npx vitest run src/app/timelog`
Expected: PASS — existing timelog suites unaffected.

Run: `npm run lint`
Expected: 0 warnings. If `Input` is now unused in either file, the build FAILS — it is still used in both, so it must remain imported.

- [x] **Step 4: Commit**

Run: `npx tsc --noEmit` → expected exit 0.

```bash
git add src/app/timelog-customer-scope.tsx src/app/timelog-project-scope.tsx
git commit -m "fix(timelog): give both scope filters one keyboard-reachable clear"
```

---

### Task 5: Persist and restore the picker scope

**Files:**
- Modify: `src/app/timelog-panel.tsx`
- Modify: `src/app/workspace-section.tsx:921`

- [x] **Step 1: Add the `projectKey` prop**

In `src/app/timelog-panel.tsx`, change the component signature (line 56):

```tsx
export function TimelogPanel({
  lang,
  isPopout = false,
  projectKey = "default",
}: {
  lang: Lang;
  isPopout?: boolean;
  /** Canonical per-device store key (`portfolioCurrentId ?? "default"`).
   *  ★ Deliberately SEPARATE from the `projectId` local below, which is
   *  `ws.project?.code` and already keys the per-device ACTUALS cache via
   *  useTimelogSync. Re-pointing that local would silently orphan every existing
   *  user's cached actuals. */
  projectKey?: string;
}) {
```

★ Do **not** touch `const projectId = ws.project?.code ?? "default";` — see the comment above.

Add to the imports:

```tsx
import { loadPickerScope, savePickerScope } from "./timelog-picker-store";
import { resolveInitialScope, scopeMismatch } from "./timelog-initial-scope";
```

- [x] **Step 2: Pass it from workspace-section**

In `src/app/workspace-section.tsx`, replace line 921:

```tsx
            <TimelogPanel lang={lang} isPopout={isPopout} projectKey={currentProjectId ?? "default"} />
```

★ `currentProjectId` here already **is** `portfolioCurrentId` — `task-manager.tsx:2289` passes `currentProjectId: portfolioCurrentId`. Lines 349 and 820 in this same file already use `currentProjectId ?? "default"` for exactly this class of per-device store, so this matches the established convention.

- [x] **Step 3: Persist on every pick**

In `src/app/timelog-panel.tsx`, add this helper immediately after the `toggleAllProjects` declaration (currently ending at line 360):

```tsx
  // Persist the CURRENT picker selection per device. Distinct from the workspace
  // `timelogLinks` write in handleFetchBookings, which records the LAST-FETCHED
  // scope and must not move when the user merely changes the picker.
  const persistPicker = (customerId: number | "", projectIds: ReadonlySet<number>) => {
    if (isPopout) return;
    savePickerScope(projectKey, {
      customerId: customerId === "" ? undefined : customerId,
      projectIds: [...projectIds],
    });
  };
```

Then update the two project mutators. Replace `toggleProject` and `toggleAllProjects` with:

```tsx
  const toggleProject = (id: number) => {
    const next = new Set(selectedProjectIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedProjectIds(next);
    persistPicker(projectCustomerId, next);
  };
  // Select-all toggles the CURRENTLY-VISIBLE (filtered) projects, preserving any
  // selection hidden by the active filter.
  const toggleAllProjects = () => {
    const allVisible =
      filteredProjects.length > 0 && filteredProjects.every((p) => selectedProjectIds.has(p.id));
    const next = new Set(selectedProjectIds);
    for (const p of filteredProjects) { if (allVisible) next.delete(p.id); else next.add(p.id); }
    setSelectedProjectIds(next);
    persistPicker(projectCustomerId, next);
  };
```

★★ These deliberately move OFF the functional-updater form. `persistPicker` writes localStorage, and
React 19 StrictMode **double-invokes** state updaters — a side effect inside one would fire twice and
violates the react-hooks purity rule the lint config enforces as fatal. Computing `next` in the
handler body and then calling both `setSelectedProjectIds` and `persistPicker` keeps the write out of
the updater.

★ Reading live `selectedProjectIds` here is safe: these are single user gestures, not the
"N saves in one tick" bulk-edit pattern that makes functional setters mandatory elsewhere in this
codebase. Do **not** generalise this away from bulk-edit handlers.

- [x] **Step 4: Persist on customer change**

★ **No change to `timelog-panel-toolbar.tsx` is needed.** It already declares
`onCustomerSelectChange: (value: number | "") => void` (line 21) and already forwards it to
`TimelogCustomerScope`'s `onSelectChange` (line 69). Only the panel's inline handler changes.

Add this beside `persistPicker`:

```tsx
  // A customer change invalidates the project selection (projects belong to a
  // customer), so clear it in the same beat and persist the cleared pair.
  const handleCustomerSelect = (next: number | "") => {
    setUserPicked(true);
    setProjectCustomerId(next);
    setSelectedProjectIds(new Set());
    setProjectFilter("");
    persistPicker(next, new Set());
  };
```

Then in the `<TimelogToolbar …>` call, replace line 520 exactly:

```tsx
        onCustomerSelectChange={(v) => { setUserPicked(true); setProjectCustomerId(v); setSelectedProjectIds(new Set()); setProjectFilter(""); }}
```

with:

```tsx
        onCustomerSelectChange={handleCustomerSelect}
```

★ `setUserPicked(true)` and `setProjectFilter("")` must both survive the move — the first is what stops the seeding ladder from overriding an explicit pick on a later render, and the second clears a stale project filter that would otherwise hide the new customer's projects.

- [x] **Step 5: Replace the seeding ladder**

Replace the two seed blocks (the `linksSeeded` block and the `autoResolved` block, currently lines ~414-436) with a single picker-aware ladder. Add `pickerSeeded` beside the existing one-shot flags:

```tsx
  const [pickerSeeded, setPickerSeeded] = useState(false);
```

Add `setPickerSeeded(false);` to the `if (projectChanged) { … }` reset block.

Then replace both seed blocks with:

```tsx
  // Seed the picker once per project, in precedence order: the per-device picker
  // scope (what was last SELECTED) beats the workspace links scope (what was last
  // FETCHED), which beats resolving the project's customer name. An explicit user
  // pick outranks all three via `userPicked`.
  if (!projectChanged && !pickerSeeded && !userPicked) {
    const seed = resolveInitialScope({
      picker: loadPickerScope(projectKey),
      links: { customerId: links.customerId, projectIds: links.projectIds },
      customers: syncCustomers,
      customerName: projectCustomerName,
    });
    // "none" only ever means "the directory has not loaded yet", so leave the
    // one-shot ARMED in that case and re-resolve on a later render.
    if (seed.source !== "none") {
      setPickerSeeded(true);
      setProjectCustomerId(seed.customerId);
      if (seed.projectIds.length > 0) setSelectedProjectIds(new Set(seed.projectIds));
    }
  }
```

Delete the now-unused `linksSeeded` and `autoResolved` state declarations and every remaining reference to them (including in the `projectChanged` reset block). ★ Lint is `--max-warnings=0`; a leftover unused state variable is fatal.

- [x] **Step 6: Verify**

Run: `npx vitest run src/app/timelog`
Expected: PASS.

Run: `npm run lint` → 0 warnings. Run: `npx tsc --noEmit` → exit 0.

- [x] **Step 7: Commit**

```bash
git add src/app/timelog-panel.tsx src/app/workspace-section.tsx
git commit -m "fix(timelog): retain picker scope across reload and navigation"
```

---

### Task 6: Scope-mismatch hint

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Modify: `src/app/timelog-panel.tsx`

- [x] **Step 1: Add the EN string**

In `src/app/i18n.ts`, immediately after the `timelogFetchScopedNote` line (currently line 1420), add:

```ts
  timelogScopeMismatchNote: "Showing bookings for {0}. Fetch to load {1}.",
```

- [x] **Step 2: Add the DE string via a node write**

★ **Do not use the Edit tool on `i18n.de.ts`.** It corrupts umlauts and curls double quotes, and the file is CRLF so a `\n`-anchored replace silently no-ops.

Run this exact command:

```bash
node -e "
const fs=require('fs');
const p='src/app/i18n.de.ts';
let s=fs.readFileSync(p,'utf8');
const anchor='  timelogFetchScopedNote: \"Buchungen werden nur für {0} abgerufen (Projekte dieses Kunden).\",\r\n';
if(!s.includes(anchor)){console.error('ANCHOR NOT FOUND');process.exit(1);}
s=s.replace(anchor, anchor+'  timelogScopeMismatchNote: \"Es werden Buchungen für {0} angezeigt. Abrufen, um {1} zu laden.\",\r\n');
fs.writeFileSync(p,s,'utf8');
console.log('ok');
"
```

Expected output: `ok`. If it prints `ANCHOR NOT FOUND`, re-read the line and retry with the exact bytes — do not fall back to the Edit tool.

- [x] **Step 3: Verify the umlauts survived**

Run: `node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8'); const m=s.match(/timelogScopeMismatchNote.*/); console.log(m && m[0]);"`
Expected: the line prints with `für` intact (not `fuer`, not a mojibake sequence).

Run: `npx vitest run src/app/i18n-encoding`
Expected: PASS — this suite BANS ASCII umlaut substitutions.

- [x] **Step 4: Render the hint**

In `src/app/timelog-panel.tsx`, immediately after the existing customer-scope note block (the one rendering `timelogFetchScopedNote`, around line 542-546), add:

```tsx
      {/* The picker can legitimately show a different customer than the loaded
          bookings came from (device picker outranks last-fetched on seed), so say
          so rather than letting the picker misrepresent what is on screen. */}
      {!isPopout && scopeMismatch(projectCustomerId, links.customerId) && (
        <p className="mb-2 text-xs text-muted-foreground print:hidden">
          {t(
            lang,
            "timelogScopeMismatchNote",
            syncCustomers.find((c) => c.id === links.customerId)?.name ?? String(links.customerId),
            scopedCustomerName,
          )}
        </p>
      )}
```

★ `t(lang, key, a, b)` uses **0-based positional** placeholders — `{0}` is the last-fetched customer, `{1}` is the picked one. Getting these backwards inverts the sentence.

- [x] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0. This is what enforces EN/DE key parity — a missing DE key fails here.

- [x] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/timelog-panel.tsx
git commit -m "feat(timelog): warn when the picker scope differs from loaded bookings"
```

---

### Task 7: Apply-confirm sizing

**Files:**
- Modify: `src/app/timelog-apply-confirm.tsx:31,36`
- Test: `src/app/timelog-apply-confirm.test.tsx`

- [x] **Step 1: Write the failing test**

Append to `src/app/timelog-apply-confirm.test.tsx`, inside the existing top-level `describe`:

```tsx
  it("lets the diff list grow with its content instead of capping at 10rem", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      bucketId: 1,
      allocIndex: 0,
      period: `2026-0${(i % 9) + 1}`,
      bucketName: "Build",
      lineName: "Dev",
      current: "0",
      next: String(i + 1),
    }));
    const { container } = render(
      <TimelogApplyConfirm lang="en-US" rows={rows} onApply={() => {}} onCancel={() => {}} />,
    );
    const list = container.querySelector("ul");
    expect(list).toBeTruthy();
    expect(list?.className).not.toContain("max-h-40");
    expect(list?.className).toContain("max-h-[50vh]");
  });
```

★ If the existing test file imports differ, match them — do not add a second import block.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/timelog-apply-confirm.test.tsx`
Expected: FAIL — `expected '… max-h-40 …' not to contain 'max-h-40'`.

- [x] **Step 3: Apply the change**

In `src/app/timelog-apply-confirm.tsx`, change the card wrapper (line 31) from `items-center` to `items-start`:

```tsx
    <div className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 print:hidden">
```

and the list (line 36) from `max-h-40` to `max-h-[50vh]`:

```tsx
        <ul className="mt-1 max-h-[50vh] overflow-auto pr-2 text-xs text-muted-foreground">
```

★ Bounded on purpose. This card gates a **financial** write into `actualHours`, so Apply and Cancel must never be pushed out of reach by a long diff.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/timelog-apply-confirm.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/app/timelog-apply-confirm.tsx src/app/timelog-apply-confirm.test.tsx
git commit -m "fix(timelog): let the apply-to-budget diff list scale with content"
```

---

### Task 8: Gates, release chain, archive

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/open-followups.md`

- [x] **Step 1: Run the full local gate**

```bash
npm run lint && npx tsc --noEmit && npm run test:run && npm run dup:check && npm run size:check
```

Expected: all pass. `dup:check` is the one most likely to complain — if it flags the two new filter call sites, the shared primitive was not actually reused; fix that rather than raising the threshold.

- [x] **Step 2: Run the coverage gate**

```bash
npm run test:coverage
```

Expected: pass. Both new `.ts` modules are coverage-gated and are covered by Tasks 2 and 3. `clearable-search-input.tsx` is `.tsx` and therefore excluded.

- [x] **Step 3: Run the axe gate for this view**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Time bookings"
```

Expected: PASS. Time bookings **is** in `A11Y_VIEWS`, and this task adds two new buttons to it. The unit suite never runs Playwright, so skipping this defers the failure to CI.

- [x] **Step 4: Log the deferred inconsistency**

In `docs/open-followups.md`, add a new numbered section after the existing item 13:

```markdown
## 14. Timelog has two per-device stores keyed differently — open, low priority

`timelog-panel.tsx` computes `projectId = ws.project?.code ?? "default"`, which keys the per-device
**actuals cache** via `useTimelogSync`. Slice C (0.204.0) added a second per-device store, the picker
scope, keyed on the canonical `portfolioCurrentId ?? "default"` instead — matching `landing-state`
and project-appearance.

They were deliberately NOT unified. Re-pointing `projectId` at the canonical key would silently
orphan every existing user's cached actuals: they would open Time bookings and find their fetched
data gone. Fixing it properly needs a read-both-keys migration, which is its own change.

★ The project *code* is user-editable, so the actuals cache already orphans on a code rename today.
That is the pre-existing bug this note records, not one slice C introduced.
```

- [x] **Step 5: Bump the version**

In `src/app/version.ts`:

```ts
export const APP_VERSION = "0.204.0";
export const APP_BUILD_DATE = "2026-07-27"; // 0.204.0: Timelog picker scope + clear affordance (Benford)
```

and

```ts
/** Minor-series milestone codename (sci-fi/fantasy author names). The
 *  0.204.x line is "Benford" (Gregory Benford, science-fiction author). */
export const APP_MILESTONE = "Benford";
```

★ Verify the codename is still unused before committing:
`grep -c '"Benford"' CHANGELOG.md` → expected `0`.

- [x] **Step 6: Add the CHANGELOG entry**

Open `CHANGELOG.md`, copy the heading style of the existing 0.203.0 entry, and insert this above it:

```markdown
## 0.204.0 "Benford" — 2026-07-27

### Time bookings

- Both scope filters (customer and projects) now show a single, keyboard-reachable ✕ to clear.
  Previously the customer filter relied on the browser's own control — which Chrome and Safari draw
  but Firefox does not, and which keyboard users cannot reach — and the projects filter had no clear
  at all.
- The selected customer and projects now survive a reload or navigating away and back, even if you
  never pressed Fetch. The selection is stored per device and per project; it is not written into the
  project file or database.
- When the restored selection differs from the customer the loaded bookings actually came from, a
  note now says so instead of letting the picker misrepresent what is on screen.
- The apply-to-budget confirmation list grows with its content instead of being capped at a small
  fixed height, while staying bounded so Apply and Cancel remain reachable.
```

★ Match the surrounding file's exact heading depth and date format before committing — if 0.203.0 uses a different shape, follow that one rather than this template.

★ No `versionHighlight*` key is needed unless you choose to surface this in the Version popover; if you add one, it must go into `APP_HIGHLIGHT_KEYS` with **both** EN and DE strings (DE via the node write from Task 6).

- [x] **Step 7: Commit the release chain**

```bash
git add src/app/version.ts CHANGELOG.md docs/open-followups.md
git commit -m "chore(release): 0.204.0 Benford — timelog picker scope, clear affordance"
```

- [x] **Step 8: Re-archive the gitignored spec tree**

★ **Mandatory per the roadmap.** `docs/superpowers/` is gitignored, so these specs and plans exist only on this machine; the archive is the only thing standing between this roadmap and the failure that already consumed its predecessor.

★★★ **THE COMMAND BELOW IS WRONG — DO NOT RUN IT AS WRITTEN.** It walks the working tree only. The
tree holds 36 files; the 2026-07-27 archive holds **334**, because the tree was pruned and ~298
historical plans/specs survive only inside that zip. Running this produces a newer archive that is a
strict SUBSET of the older one, so the next tidy-up destroys 298 documents — the exact failure the
step exists to prevent. Merge the prior archive's unique entries in (tree wins on collision) and
assert `set(old.namelist()) - set(new.namelist()) == set()` before trusting it. The roadmap spec
carries the working script; 2026-07-28 was rebuilt that way (298 + 36 = 334, verified).

```bash
cd /c/Projects/aipm-cockpit && python -c "
import zipfile, os
out = 'docs/superpowers/_archive-slice-docs-2026-07-27.zip'
z = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for root, dirs, files in os.walk('docs/superpowers'):
    for f in files:
        if f.endswith('.zip'):
            continue
        p = os.path.join(root, f)
        z.write(p, os.path.relpath(p, 'docs/superpowers'))
z.close()
print('archived', out)
"
```

Expected: `archived docs/superpowers/_archive-slice-docs-2026-07-27.zip`.

---

## Verification checklist

Against the spec's acceptance criteria:

- [x] Both filters show exactly one ✕, keyboard-reachable, appearing only when non-empty (Task 4; verify in **Firefox** too — it draws no native control, so a regression there is invisible in Chrome)
- [x] Selecting customer + projects **without fetching**, then reloading, restores the selection (Task 5)
- [x] A restored picker scope differing from the last fetch shows the hint; agreeing scopes show nothing (Task 6)
- [x] Switching project in place re-seeds and never leaks the previous project's selection (Task 5, `projectChanged` reset)
- [x] Existing actuals cache still resolves — `projectId` untouched (Task 5 Step 1)
- [x] Refresh still re-fetches the last-fetched scope independent of the picker (unchanged; confirm `handleRefreshBookings` was not edited)
- [x] Apply-confirm list grows to 50vh; Apply/Cancel stay reachable (Task 7)
- [x] No new backend write path, no golden regen, nothing added to exports or Turso (confirm `npm run test:run` shows no golden-workspace diff)
