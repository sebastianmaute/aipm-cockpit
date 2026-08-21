# Diagnostics Panel Filtering + Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a level+code filter and a level-count summary to the diagnostics panel (view-only; the bundle/ring are untouched).

**Architecture:** A pure `diagnostics-filter.ts` (`filterDiag`/`summarizeDiag`); the panel adds ephemeral `levels`/`query` state, a summary line, level checkboxes + a code search, and renders the filtered rows.

**Tech Stack:** TypeScript, React 19, vitest. No new deps; no change to `diagnostics.ts`.

**Verify:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` (i18n parity) · lint `npm run lint`. ★★ i18n.de.ts: node utf8 write (keys here are umlaut-free but use node per the rule).

---

## Task 1: pure filter + summary

**Files:** Create `src/app/diagnostics-filter.ts` + `src/app/diagnostics-filter.test.ts`

- [ ] **Step 1:** Implement `src/app/diagnostics-filter.ts`:
```ts
import type { DiagEvent, DiagLevel } from "./diagnostics";

/** Filter by an allowed-level set + a case-insensitive code substring (empty query = all). */
export function filterDiag(events: readonly DiagEvent[], levels: ReadonlySet<DiagLevel>, codeQuery: string): DiagEvent[] {
  const q = codeQuery.trim().toLowerCase();
  return events.filter((e) => levels.has(e.level) && (q === "" || e.code.toLowerCase().includes(q)));
}

export interface DiagSummary { error: number; warn: number; info: number; newestErrorAt?: string; }

/** Counts per level + the newest error timestamp, from the full ring (events are newest-first). */
export function summarizeDiag(events: readonly DiagEvent[]): DiagSummary {
  const s: DiagSummary = { error: 0, warn: 0, info: 0 };
  for (const e of events) {
    if (e.level === "error") { s.error++; if (!s.newestErrorAt) s.newestErrorAt = e.at; }
    else if (e.level === "warn") s.warn++;
    else s.info++;
  }
  return s;
}
```

- [ ] **Step 2:** Test `src/app/diagnostics-filter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { filterDiag, summarizeDiag } from "./diagnostics-filter";
import type { DiagEvent } from "./diagnostics";

const evts: DiagEvent[] = [
  { at: "2026-07-04T10:00:03.000Z", level: "error", code: "storage.saveFailed" },
  { at: "2026-07-04T10:00:02.000Z", level: "warn", code: "dataloss.refused" },
  { at: "2026-07-04T10:00:01.000Z", level: "info", code: "storage.loaded" },
];

describe("filterDiag", () => {
  it("filters by level set", () => {
    expect(filterDiag(evts, new Set(["error"]), "").map((e) => e.code)).toEqual(["storage.saveFailed"]);
  });
  it("filters by code substring (case-insensitive)", () => {
    expect(filterDiag(evts, new Set(["error", "warn", "info"]), "STORAGE").map((e) => e.code)).toEqual(["storage.saveFailed", "storage.loaded"]);
  });
  it("empty query returns all (of the allowed levels)", () => {
    expect(filterDiag(evts, new Set(["error", "warn", "info"]), "").length).toBe(3);
  });
  it("empty level set returns none", () => {
    expect(filterDiag(evts, new Set(), "").length).toBe(0);
  });
});

describe("summarizeDiag", () => {
  it("counts per level + newest error (events newest-first)", () => {
    const s = summarizeDiag(evts);
    expect(s).toMatchObject({ error: 1, warn: 1, info: 1, newestErrorAt: "2026-07-04T10:00:03.000Z" });
  });
  it("no errors → no newestErrorAt", () => {
    expect(summarizeDiag([evts[2]]).newestErrorAt).toBeUndefined();
  });
});
```

- [ ] **Step 3:** `npm run test:run -- diagnostics-filter` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/diagnostics-filter.ts src/app/diagnostics-filter.test.ts && git commit -m "feat(diagnostics): pure filterDiag + summarizeDiag"`

---

## Task 2: panel wiring + i18n

**Files:** Modify `src/app/diagnostics-panel.tsx` + `src/app/diagnostics-panel.test.tsx` + `src/app/i18n.ts` + `src/app/i18n.de.ts`

- [ ] **Step 1:** i18n keys — EN (`i18n.ts`, near the other `diagnostics*` keys):
```ts
  diagnosticsSummary: "{0} errors · {1} warnings · {2} info",
  diagnosticsLevelError: "Errors",
  diagnosticsLevelWarn: "Warnings",
  diagnosticsLevelInfo: "Info",
  diagnosticsSearchCode: "Filter by code",
  diagnosticsNoMatch: "No events match the current filter.",
```
DE (`i18n.de.ts`, node utf8 write, same anchor):
```
  diagnosticsSummary: "{0} Fehler · {1} Warnungen · {2} Infos",
  diagnosticsLevelError: "Fehler",
  diagnosticsLevelWarn: "Warnungen",
  diagnosticsLevelInfo: "Infos",
  diagnosticsSearchCode: "Nach Code filtern",
  diagnosticsNoMatch: "Keine Ereignisse entsprechen dem aktuellen Filter.",
```
Run `npx tsc --noEmit` — parity enforced. `diagnosticsSummary` uses positional `{0}`/`{1}`/`{2}` → `t(lang, "diagnosticsSummary", s.error, s.warn, s.info)`.

- [ ] **Step 2:** In `src/app/diagnostics-panel.tsx`:
  - Add imports: `import { filterDiag, summarizeDiag } from "./diagnostics-filter";` and `import type { DiagLevel } from "./diagnostics";`.
  - Add state after `const [events, setEvents] = useState(...)`:
```tsx
  const [levels, setLevels] = useState<Set<DiagLevel>>(() => new Set<DiagLevel>(["error", "warn", "info"]));
  const [query, setQuery] = useState("");
  const summary = summarizeDiag(events);
  const shown = filterDiag(events, levels, query);
  const toggleLevel = (lv: DiagLevel) => setLevels((prev) => {
    const next = new Set(prev);
    if (next.has(lv)) next.delete(lv); else next.add(lv);
    return next;
  });
```
  - Render a **summary line** right after the intro `<p>` (line 40):
```tsx
      <p className="text-xs text-muted-foreground">{t(lang, "diagnosticsSummary", summary.error, summary.warn, summary.info)}</p>
```
  - Add **filter controls** — a labeled row after the button row (before the table). Three level checkboxes + a code search input:
```tsx
      <div className="flex flex-wrap items-center gap-3">
        {(["error", "warn", "info"] as DiagLevel[]).map((lv) => (
          <label key={lv} className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={levels.has(lv)} onChange={() => toggleLevel(lv)} aria-label={t(lang, lv === "error" ? "diagnosticsLevelError" : lv === "warn" ? "diagnosticsLevelWarn" : "diagnosticsLevelInfo")} />
            {t(lang, lv === "error" ? "diagnosticsLevelError" : lv === "warn" ? "diagnosticsLevelWarn" : "diagnosticsLevelInfo")}
          </label>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "diagnosticsSearchCode")}
          aria-label={t(lang, "diagnosticsSearchCode")}
          className={`flex-1 min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-xs`}
        />
      </div>
```
  - Change the table body to render `shown` instead of `events` (the `.map` at line 85). Change the empty-state branch: currently `events.length === 0 ? <EmptyState.../> : <table>`. Make it:
    - `events.length === 0` → the existing `diagnosticsEmpty` EmptyState.
    - else render the filter row + (`shown.length === 0` ? a `diagnosticsNoMatch` line/EmptyState : the table over `shown`).
    Keep the filter controls VISIBLE even when `shown` is empty (so the user can widen the filter). Simplest: always render the summary + filter row when `events.length > 0`; the table area shows the `diagnosticsNoMatch` text when `shown` is empty.
  - Keep Copy/Download exporting `buildDiagnosticBundle()` (the FULL ring) — do NOT filter the bundle.

- [ ] **Step 3: Test** — extend `src/app/diagnostics-panel.test.tsx`: seed events of mixed levels (via `logDiag`), render, assert the summary text shows the counts; toggle off "info" (uncheck) → info rows disappear; type a code substring → only matching rows; clearing shows all. Assert the search input + level checkboxes have accessible names (`getByRole("checkbox", { name: /errors/i })`, `getByLabelText(/filter by code/i)`).

- [ ] **Step 4:** `npx tsc --noEmit` → 0 (parity); `npm run test:run -- diagnostics-panel i18n-encoding` → PASS; `npm run lint` → 0; `npm run size:check` → ok; axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → pass (labeled inputs).

- [ ] **Step 5: Commit** `git add src/app/diagnostics-panel.tsx src/app/diagnostics-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(diagnostics): panel level/code filter + summary line"`

---

## Final verification
- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] Grep: Copy/Download still call `buildDiagnosticBundle()` (full ring, not `shown`); the summary uses the full `events`, the table uses `shown`.

Then follow **superpowers:finishing-a-development-branch**.
