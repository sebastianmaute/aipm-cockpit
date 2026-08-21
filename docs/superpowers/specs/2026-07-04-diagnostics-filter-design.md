# Diagnostics Panel Filtering + Summary — Design

**Goal:** Make the diagnostic-log panel analyzable: a level + code filter over the events table, plus a level-count summary line.

**Context:** Follow-up to sub-project B (diagnostic log, merged). The ring now holds ~20 distinct codes; the panel shows a flat, unfilterable table. This adds view-only filtering + a summary — no change to `diagnostics.ts`, the ring, the bundle, or persistence.

**Approved decisions:** panel filtering (level toggles + code substring) + a level summary line. Filter state is ephemeral (not persisted).

---

## Components

### `diagnostics-filter.ts` (pure, i18n-free)
```ts
import type { DiagEvent, DiagLevel } from "./diagnostics";

/** Filter by an allowed-level set + a case-insensitive code substring (empty query = all). */
export function filterDiag(events: readonly DiagEvent[], levels: ReadonlySet<DiagLevel>, codeQuery: string): DiagEvent[] {
  const q = codeQuery.trim().toLowerCase();
  return events.filter((e) => levels.has(e.level) && (q === "" || e.code.toLowerCase().includes(q)));
}

export interface DiagSummary { error: number; warn: number; info: number; newestErrorAt?: string; }

/** Counts per level + the newest error timestamp, from the FULL ring (events are newest-first). */
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
(`events` are newest-first, so the first error encountered is the newest → `newestErrorAt`.)

### `diagnostics-panel.tsx` (modify)
- New ephemeral state: `levels` (a `Set<DiagLevel>`, default all three) + `query` (string).
- **Summary line** above the controls: `summarizeDiag(events)` → "N errors · M warnings · K info" (+ the newest-error time via the existing timestamp formatter if one is used in the panel, else `e.at.slice(11,19)`). Uses i18n count nouns.
- **Filter controls** (in the control row, before/after the existing buttons): three labeled level checkboxes (toggle a level in/out of the set) + a code search `<input>` (`aria-label` = the search label). All labeled — the panel renders in Settings (axe-scanned).
- The table body renders `filterDiag(events, levels, query)` instead of `events`. An empty filtered result shows the existing empty-state text (or a "no matching events" variant).
- Refresh/Copy/Download/Clear unchanged (Copy/Download still bundle the FULL ring, not the filtered view — the bundle is for support, filtering is view-only).

## i18n
New keys: `diagnosticsFilterLevel` (or reuse), `diagnosticsFilterCode` (search placeholder/label), `diagnosticsSummary` (a positional `{0} errors · {1} warnings · {2} info` template — or three separate count keys), `diagnosticsNoMatch`. EN + DE (node write for umlauts if any — these are umlaut-free, still use node per the rule).

## Boundary / testing
- View-only: no persistence, no ring/bundle change. Copy/Download still export the full ring.
- Tests: `filterDiag` (level subset, code substring case-insensitive, empty query = all, empty levels = none); `summarizeDiag` (counts, newest-error from newest-first order, no errors → no `newestErrorAt`); panel renders the summary + filters rows + labeled inputs (axe-safe).

## Out of scope
- Configurable retention/`DIAG_MAX` (marginal).
- Auto-attach bundle to error toasts (toast-contract ripple).
- Persisting the filter across sessions (ephemeral is fine).
