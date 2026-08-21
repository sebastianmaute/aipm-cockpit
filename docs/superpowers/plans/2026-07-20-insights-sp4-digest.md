# Insights SP4 — Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rolling 7-day digest card at the top of the Insights view (fired / acted / wins / regressions / open now), plus a user-settable cadence for the SP2 background recommendation runner, defaulting to 60 minutes.

**Architecture:** One pure i18n-free engine (`insights/digest.ts`) derived entirely from timestamps SP1–SP3 already persist — no new `Workspace` field, no backend write path, no golden-fixture regeneration. One presentational card. One `AiConfig` field guarded by a single exported clamp.

**Tech Stack:** TypeScript, React 19, forked Next.js 16, Tailwind v4, Vitest 4, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-07-20-insights-sp4-digest-design.md`

---

## COMMIT RULE (applies to EVERY task)

Commits must carry **NO attribution trailer**. Do NOT append `Co-Authored-By:`,
`Claude-Session:`, or any `🤖 Generated with` line. Attribution is disabled
globally for this user. A commit carrying one must be rewritten.

Conventional-commit format: `feat(insights): ...` / `fix(insights): ...` / `test(insights): ...`.

## Standing constraints

- `npx tsc --noEmit` is AUTHORITATIVE. The IDE's inline diagnostics produce
  phantom "declared but never read" / "cannot find module" errors mid-edit that
  real tsc contradicts. Trust tsc, not squiggles.
- Lint runs `--max-warnings=0`: an unused import or var is FATAL.
- `react-hooks/exhaustive-deps` REJECTS an `obj.member` dep — hoist to a scalar
  local first. `react-hooks/set-state-in-effect` is BANNED. A purity rule bans
  `Date.now()`/`new Date()` in a render body.
- Never log or echo an API key or a response body.
- `i18n.de.ts` is CRLF and the Edit tool CORRUPTS its umlauts and curls its
  double quotes. Patch it via a node utf8 write with `\r\n` anchors. Real
  umlauts only — no ASCII substitutions (`fuer`), no `\uXXXX` escapes.

---

## Task 1: Digest engine — window math

**Files:**
- Create: `src/app/insights/digest.ts`
- Create: `src/app/insights/digest.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { computeInsightDigest, DIGEST_WINDOW_DAYS } from "./digest";

describe("computeInsightDigest window", () => {
  it("defaults to a 7-day window ending today, inclusive of both ends", () => {
    const d = computeInsightDigest([], "2026-07-20");
    expect(d.windowDays).toBe(DIGEST_WINDOW_DAYS);
    expect(d.to).toBe("2026-07-20");
    expect(d.from).toBe("2026-07-14"); // today minus 6 days
  });

  it("honours an explicit windowDays", () => {
    expect(computeInsightDigest([], "2026-07-20", 1).from).toBe("2026-07-20");
    expect(computeInsightDigest([], "2026-07-20", 30).from).toBe("2026-06-21");
  });

  it("returns an empty digest for an unparseable today rather than throwing", () => {
    const d = computeInsightDigest([], "not-a-date");
    expect(d.isEmpty).toBe(true);
    expect(d.firedCount).toBe(0);
  });

  it("treats a non-positive or non-finite windowDays as the default", () => {
    expect(computeInsightDigest([], "2026-07-20", 0).windowDays).toBe(DIGEST_WINDOW_DAYS);
    expect(computeInsightDigest([], "2026-07-20", -5).windowDays).toBe(DIGEST_WINDOW_DAYS);
    expect(computeInsightDigest([], "2026-07-20", Number.NaN).windowDays).toBe(DIGEST_WINDOW_DAYS);
  });

  it("is empty for an empty input", () => {
    const d = computeInsightDigest([], "2026-07-20");
    expect(d).toMatchObject({ firedCount: 0, actedCount: 0, openNow: 0, isEmpty: true });
    expect(d.wins).toEqual([]);
    expect(d.regressions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/insights/digest.test.ts`
Expected: FAIL — cannot find module `./digest`.

- [ ] **Step 3: Implement the engine skeleton**

```ts
// Pure, i18n-free. Derives a rolling-window digest from the lifecycle
// timestamps SP1-SP3 already persist. No clock in this module — `today` is
// passed in. Adds NO persisted field: everything here is derivation.
import type { Insight } from "./insight";

export const DIGEST_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface InsightDigest {
  readonly windowDays: number;
  readonly from: string;
  readonly to: string;
  readonly firedCount: number;
  readonly actedCount: number;
  readonly wins: readonly Insight[];
  readonly regressions: readonly Insight[];
  readonly openNow: number;
  readonly isEmpty: boolean;
}

/** A bare YYYY-MM-DD. In-app every lifecycle stamp is exactly that, but
 *  sanitizeInsights admits up to 40 chars from an imported blob — slice before
 *  the lexicographic compare so a longer ISO string still lands in its day. */
function dayOf(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function emptyDigest(windowDays: number, from: string, to: string): InsightDigest {
  return {
    windowDays, from, to,
    firedCount: 0, actedCount: 0,
    wins: [], regressions: [],
    openNow: 0, isEmpty: true,
  };
}

export function computeInsightDigest(
  insights: readonly Insight[],
  today: string,
  windowDays?: number,
): InsightDigest {
  const days =
    typeof windowDays === "number" && Number.isFinite(windowDays) && windowDays > 0
      ? Math.floor(windowDays)
      : DIGEST_WINDOW_DAYS;
  const to = dayOf(today);
  if (to === null) return emptyDigest(days, "", "");
  // UTC-midnight parse (the bucketMilestonesByHorizon pattern) — never `new Date()` of now.
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(toMs)) return emptyDigest(days, "", to);
  // Inclusive of BOTH ends: a 7-day window is today plus the 6 prior days.
  const from = new Date(toMs - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return emptyDigest(days, from, to);
}
```

- [ ] **Step 4: Run to verify the window tests pass**

Run: `npx vitest run src/app/insights/digest.test.ts`
Expected: PASS (bucket tests land in Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/digest.ts src/app/insights/digest.test.ts
git commit -m "feat(insights): add SP4 digest engine window math"
```

---

## Task 2: Digest engine — buckets and sort

**Files:**
- Modify: `src/app/insights/digest.ts`
- Modify: `src/app/insights/digest.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `digest.test.ts`. Build fixtures with a helper so each test states only what it varies:

```ts
import type { Insight } from "./insight";

function ins(over: Partial<Insight> & { id: number }): Insight {
  return {
    key: `k${over.id}`,
    type: "stalledWork",
    severity: "medium",
    data: { count: 5 },
    status: "active",
    firstSeenAt: "2026-07-20",
    lastSeenAt: "2026-07-20",
    occurrences: 1,
    ...over,
  } as Insight;
}

describe("computeInsightDigest buckets", () => {
  const today = "2026-07-20"; // window 2026-07-14 .. 2026-07-20

  it("counts firstSeenAt inside the window and excludes older", () => {
    const d = computeInsightDigest(
      [ins({ id: 1, firstSeenAt: "2026-07-14" }), ins({ id: 2, firstSeenAt: "2026-07-13" })],
      today,
    );
    expect(d.firedCount).toBe(1);
  });

  it("EXCLUDES future-dated events so a skewed clock cannot inflate counts", () => {
    const d = computeInsightDigest([ins({ id: 1, firstSeenAt: "2026-07-21" })], today);
    expect(d.firedCount).toBe(0);
  });

  it("counts actedAt in window regardless of the record's current status", () => {
    const d = computeInsightDigest(
      [ins({ id: 1, status: "resolved", actedAt: "2026-07-18", resolvedAt: "2026-07-19" })],
      today,
    );
    expect(d.actedCount).toBe(1);
  });

  it("collects resolved records that carry an outcome as wins", () => {
    const win = ins({
      id: 1, status: "resolved", actedAt: "2026-07-15", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    });
    const noOutcome = ins({ id: 2, status: "resolved", resolvedAt: "2026-07-18" });
    const d = computeInsightDigest([win, noOutcome], today);
    expect(d.wins.map((w) => w.id)).toEqual([1]);
  });

  it("collects worsened outcomes measured in the window as regressions", () => {
    const bad = ins({
      id: 1, status: "acted", actedAt: "2026-07-15",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-07-19" },
    });
    const stale = ins({
      id: 2, status: "acted", actedAt: "2026-03-01",
      outcome: { direction: "worsened", baseline: 4, current: 9, delta: -5, measuredAt: "2026-03-02" },
    });
    const d = computeInsightDigest([bad, stale], today);
    expect(d.regressions.map((r) => r.id)).toEqual([1]);
  });

  it("counts openNow as live active+acknowledged, NOT windowed", () => {
    const d = computeInsightDigest(
      [
        ins({ id: 1, status: "active", firstSeenAt: "2025-01-01" }),
        ins({ id: 2, status: "acknowledged", firstSeenAt: "2025-01-01" }),
        ins({ id: 3, status: "dismissed" }),
        ins({ id: 4, status: "resolved" }),
      ],
      today,
    );
    expect(d.openNow).toBe(2);
    expect(d.isEmpty).toBe(false);
  });

  it("sorts wins by date descending, then id ascending", () => {
    const mk = (id: number, on: string) =>
      ins({ id, status: "resolved", resolvedAt: on,
        outcome: { direction: "improved", baseline: 3, measuredAt: on } });
    const d = computeInsightDigest([mk(2, "2026-07-16"), mk(9, "2026-07-18"), mk(4, "2026-07-18")], today);
    expect(d.wins.map((w) => w.id)).toEqual([4, 9, 2]);
  });

  it("is not empty when only wins exist", () => {
    const d = computeInsightDigest(
      [ins({ id: 1, status: "resolved", firstSeenAt: "2025-01-01", resolvedAt: "2026-07-18",
        outcome: { direction: "improved", baseline: 3, measuredAt: "2026-07-18" } })],
      today,
    );
    expect(d.isEmpty).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/insights/digest.test.ts`
Expected: FAIL — counts are 0, arrays empty.

- [ ] **Step 3: Implement the buckets**

Replace the `return emptyDigest(days, from, to)` tail of `computeInsightDigest`:

```ts
  const inWindow = (v: string | undefined): boolean => {
    const d = dayOf(v);
    // Future-dated is EXCLUDED: a clock-skewed or imported record must not
    // inflate "this week".
    return d !== null && d >= from && d <= to;
  };

  let firedCount = 0;
  let actedCount = 0;
  let openNow = 0;
  const wins: Insight[] = [];
  const regressions: Insight[] = [];

  for (const i of insights) {
    if (inWindow(i.firstSeenAt)) firedCount++;
    if (inWindow(i.actedAt)) actedCount++;
    if (i.status === "active" || i.status === "acknowledged") openNow++;
    if (i.status === "resolved" && i.outcome !== undefined && inWindow(i.resolvedAt)) {
      wins.push(i);
    }
    // Gated on measuredAt, not status: a worsened outcome is a live measurement
    // on a still-firing acted record, and a months-old one is not "this week".
    if (i.outcome?.direction === "worsened" && inWindow(i.outcome.measuredAt)) {
      regressions.push(i);
    }
  }

  // Date descending, id ascending as the tiebreak. Date strings compare
  // lexicographically — no Date construction needed.
  const byDateDesc = (aDate: string, bDate: string, aId: number, bId: number): number => {
    if (aDate !== bDate) return aDate < bDate ? 1 : -1;
    return aId - bId;
  };
  wins.sort((a, b) => byDateDesc(a.resolvedAt ?? "", b.resolvedAt ?? "", a.id, b.id));
  regressions.sort((a, b) =>
    byDateDesc(a.outcome?.measuredAt ?? "", b.outcome?.measuredAt ?? "", a.id, b.id));

  return {
    windowDays: days, from, to,
    firedCount, actedCount, wins, regressions, openNow,
    isEmpty:
      firedCount === 0 && actedCount === 0 && openNow === 0 &&
      wins.length === 0 && regressions.length === 0,
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/insights/digest.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights/digest.ts src/app/insights/digest.test.ts
git commit -m "feat(insights): add SP4 digest buckets and deterministic sort"
```

---

## Task 3: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

Interpolated strings use 0-based POSITIONAL placeholders: `t(lang, key, a)` → `{0}`.

- [ ] **Step 1: Add the EN keys**

Add to `i18n.ts` near the other `insight*` keys:

```ts
  insightDigestTitle: "Last {0} days",
  insightDigestFired: "{0} new",
  insightDigestActed: "{0} acted on",
  insightDigestOpen: "{0} open now",
  insightDigestWins: "Resolved after you acted",
  insightDigestRegressions: "Got worse after you acted",
  insightDigestMore: "+{0} more",
  aiInsightRecInterval: "Check every (minutes)",
  aiInsightRecIntervalHint: "How often to look for new recommendations while the app is open. Each check can make billed API calls. Minimum 15, maximum 1440.",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write**

The Edit tool corrupts umlauts and curls double quotes in this CRLF file. Write
a throwaway script (do NOT commit it) that anchors on `\r\n` and writes utf8.
Use REAL umlauts — `i18n-encoding.test.ts` BANS ASCII substitutions:

```js
// scratch only
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  insightOutcomeResolved:";           // an existing DE insight key
const add =
  '  insightDigestTitle: "Letzte {0} Tage",\r\n' +
  '  insightDigestFired: "{0} neu",\r\n' +
  '  insightDigestActed: "{0} bearbeitet",\r\n' +
  '  insightDigestOpen: "{0} offen",\r\n' +
  '  insightDigestWins: "Nach Ihrer Maßnahme gelöst",\r\n' +
  '  insightDigestRegressions: "Nach Ihrer Maßnahme verschlechtert",\r\n' +
  '  insightDigestMore: "+{0} weitere",\r\n' +
  '  aiInsightRecInterval: "Prüfintervall (Minuten)",\r\n' +
  '  aiInsightRecIntervalHint: "Wie oft bei geöffneter App nach neuen Empfehlungen gesucht wird. Jede Prüfung kann kostenpflichtige API-Aufrufe auslösen. Minimum 15, Maximum 1440.",\r\n';
if (!s.includes(anchor)) throw new Error("anchor not found — check the exact key and CRLF");
s = s.replace(anchor, add + anchor);
fs.writeFileSync(p, s, "utf8");
```

Note: the `\uXXXX` escapes above are for the SCRIPT SOURCE only — node writes
real umlaut BYTES into the file. The committed `i18n.de.ts` must contain literal
`ö`/`ü`/`ß`, never escapes (`i18n-encoding.test.ts` bans those too).

- [ ] **Step 3: Verify parity and encoding**

```bash
npx tsc --noEmit                      # enforces EN/DE key parity
npx vitest run src/app/i18n-encoding.test.ts
grep -c "insightDigest" src/app/i18n.ts src/app/i18n.de.ts
```
Expected: tsc exit 0; encoding test PASS; both files report the same count.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(insights): add SP4 digest and cadence i18n strings"
```

---

## Task 4: Digest card component

**Files:**
- Create: `src/app/insights/insight-digest-card.tsx`
- Create: `src/app/insights/insight-digest-card.test.tsx`

Read `src/app/insights/insight-outcome-badge.tsx` and `src/app/insights-panel.tsx`
first — reuse the panel's existing row title/summary helpers from
`insights/insight-text.ts` rather than writing new label logic.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightDigestCard } from "./insight-digest-card";
import { computeInsightDigest } from "./digest";
import type { Insight } from "./insight";

const base = {
  key: "k", type: "stalledWork", severity: "medium", data: { count: 5 },
  lastSeenAt: "2026-07-18", occurrences: 1,
} as const;

describe("InsightDigestCard", () => {
  it("renders nothing when the digest is empty", () => {
    const { container } = render(
      <InsightDigestCard digest={computeInsightDigest([], "2026-07-20")} lang="en-US" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the window title and the counts", () => {
    const list = [{ ...base, id: 1, status: "active", firstSeenAt: "2026-07-18" }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, "2026-07-20")} lang="en-US" />);
    expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/1 new/i)).toBeInTheDocument();
  });

  it("renders a win with its outcome badge", () => {
    const list = [{
      ...base, id: 1, status: "resolved", firstSeenAt: "2026-07-10",
      actedAt: "2026-07-15", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, current: 2, delta: 7, measuredAt: "2026-07-18" },
    }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, "2026-07-20")} lang="en-US" />);
    expect(screen.getByText(/resolved after you acted/i)).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it("renders the direction-only shape without inventing a magnitude", () => {
    const list = [{
      ...base, id: 1, status: "resolved", firstSeenAt: "2026-07-10",
      actedAt: "2026-07-15", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, "2026-07-20")} lang="en-US" />);
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });

  it("caps a long win list and shows a non-interactive +N more", () => {
    const list = Array.from({ length: 8 }, (_, n) => ({
      ...base, id: n + 1, key: `k${n}`, status: "resolved", firstSeenAt: "2026-07-10",
      resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    })) as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, "2026-07-20")} lang="en-US" />);
    const more = screen.getByText(/\+3 more/i);
    expect(more).toBeInTheDocument();
    expect(more.closest("button")).toBeNull(); // deliberately not an affordance
  });

  it("gives each deep-link row a row-unique accessible name", () => {
    const mk = (id: number, count: number) => ({
      ...base, id, key: `k${id}`, data: { count }, status: "resolved",
      firstSeenAt: "2026-07-10", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    });
    const list = [mk(1, 4), mk(2, 7)] as Insight[];
    render(
      <InsightDigestCard
        digest={computeInsightDigest(list, "2026-07-20")}
        lang="en-US"
        onOpenInsight={vi.fn()}
      />,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/insights/insight-digest-card.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the card**

Requirements the implementer must satisfy (match the surrounding panel's markup
idiom rather than inventing one):

- `"use client"` at the top; props-only, no context (`digest`, `lang`,
  `onOpenInsight?: (insight: Insight) => void`).
- `if (digest.isEmpty) return null;` FIRST.
- Title from `t(lang, "insightDigestTitle", String(digest.windowDays))`.
- Counts as a compact meta line using `insightDigestFired` / `insightDigestActed`
  / `insightDigestOpen`. Muted text, no KPI tiles.
- Wins and regressions each render as a section with its heading key, capped:
  `const MAX_DIGEST_ROWS = 5;`. The overflow renders
  `t(lang, "insightDigestMore", String(n - MAX_DIGEST_ROWS))` inside a plain
  `<span>` — NOT a button.
- Each row renders the insight's existing text helper output plus
  `<InsightOutcomeBadge outcome={i.outcome!} lang={lang} />`.
- A row is a `<button>` ONLY when `onOpenInsight` is passed; its accessible name
  must include the insight's own descriptor so N rows are not N identical names.
  Use the `${label} – ${detail}` idiom the panel already uses.
- Palette: AIPM tokens only. Direction colour rides the badge's DOT — do NOT tint
  small text. No `shadow-*`, no gradient, no off-palette class.
- Compose `INTERACTIVE` from `interaction-styles.ts` on any button; do not
  hand-roll hover/focus.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/insights/insight-digest-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights/insight-digest-card.tsx src/app/insights/insight-digest-card.test.tsx
git commit -m "feat(insights): add SP4 digest card"
```

---

## Task 5: Mount the card in the Insights view

**Files:**
- Modify: `src/app/insights-panel.tsx`
- Modify: `src/app/insights-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `insights-panel.test.tsx` (it already has ~29 tests — match their
render-helper idiom rather than building a new one):

```tsx
it("renders the digest card above the list when the window has activity", () => {
  renderPanel({
    insights: [
      { id: 1, key: "k1", type: "stalledWork", severity: "medium", data: { count: 5 },
        status: "active", firstSeenAt: TODAY, lastSeenAt: TODAY, occurrences: 1 },
    ],
    today: TODAY,
  });
  expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
});

it("renders no digest card for an empty record", () => {
  renderPanel({ insights: [], today: TODAY });
  expect(screen.queryByText(/last 7 days/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/insights-panel.test.tsx`
Expected: FAIL on the first new test.

- [ ] **Step 3: Mount the card**

In `insights-panel.tsx`:

```tsx
const digest = useMemo(
  () => computeInsightDigest(insights, today),
  [insights, today],
);
```

Render `<InsightDigestCard digest={digest} lang={lang} onOpenInsight={...} />`
as the FIRST child inside the existing
`<div className="min-h-[240px] flex-1 overflow-auto pr-2">` scroller, above the
row list — so it scrolls with the content instead of squeezing the list, and it
prints (the pane is `print-root`).

★ If `today` is not already a prop on this panel, thread it the way the panel's
siblings receive it rather than deriving a date in the component — a
`new Date()` in a render body is a FATAL purity-rule violation.

Wire `onOpenInsight` to the panel's EXISTING deep-link handler. Do not add a
second navigation channel.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/insights-panel.test.tsx`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/insights-panel.tsx src/app/insights-panel.test.tsx
git commit -m "feat(insights): mount the SP4 digest card in the Insights view"
```

---

## Task 6: Cadence setting — type, default, clamp, sanitizer

**Files:**
- Modify: `src/app/settings-types.ts`
- Modify: `src/app/settings-types.test.ts` (create if absent)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  clampInsightRecInterval,
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  sanitizeAiConfig,
} from "./settings-types";

describe("clampInsightRecInterval", () => {
  it("defaults to 60 minutes", () => {
    expect(DEFAULT_INSIGHT_REC_INTERVAL_MIN).toBe(60);
    expect(clampInsightRecInterval(undefined)).toBe(60);
  });

  it("accepts a value inside the range", () => {
    expect(clampInsightRecInterval(15)).toBe(15);
    expect(clampInsightRecInterval(120)).toBe(120);
    expect(clampInsightRecInterval(1440)).toBe(1440);
  });

  it("rejects out-of-range and non-numeric values so billed calls stay bounded", () => {
    expect(clampInsightRecInterval(1)).toBe(60);      // below the floor
    expect(clampInsightRecInterval(0)).toBe(60);
    expect(clampInsightRecInterval(-30)).toBe(60);
    expect(clampInsightRecInterval(5000)).toBe(60);   // above the ceiling
    expect(clampInsightRecInterval("abc")).toBe(60);
    expect(clampInsightRecInterval(Number.NaN)).toBe(60);
    expect(clampInsightRecInterval(Number.POSITIVE_INFINITY)).toBe(60);
  });

  it("rounds a fractional value", () => {
    expect(clampInsightRecInterval(59.6)).toBe(60);
  });

  it("is applied by sanitizeAiConfig on load", () => {
    expect(sanitizeAiConfig({ insightRecommendationIntervalMinutes: 3 })
      .insightRecommendationIntervalMinutes).toBe(60);
    expect(sanitizeAiConfig({ insightRecommendationIntervalMinutes: 90 })
      .insightRecommendationIntervalMinutes).toBe(90);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/settings-types.test.ts`
Expected: FAIL — `clampInsightRecInterval` is not exported.

- [ ] **Step 3: Implement**

In `settings-types.ts`, add to the `AiConfig` type beside `insightRecommendations`:

```ts
  insightRecommendationIntervalMinutes?: number; // Background recommendation cadence (SP4). Integer minutes 15–1440. Default 60.
```

Beside `clampMaxChatTurns`:

```ts
export const DEFAULT_INSIGHT_REC_INTERVAL_MIN = 60;
export const MIN_INSIGHT_REC_INTERVAL_MIN = 15;
export const MAX_INSIGHT_REC_INTERVAL_MIN = 1440;

/** Clamp the background-recommendation cadence to whole minutes in
 *  [15, 1440]; anything invalid or out of range → the 60-minute default. The
 *  SINGLE source of truth used by the settings sanitizer, the settings input,
 *  and the runner read site, so a directly-typed out-of-range value can never
 *  drive an unbounded rate of billed API calls. The floor exists specifically
 *  to stop the setting being used to hammer the API. */
export function clampInsightRecInterval(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) &&
    n >= MIN_INSIGHT_REC_INTERVAL_MIN &&
    n <= MAX_INSIGHT_REC_INTERVAL_MIN
    ? n
    : DEFAULT_INSIGHT_REC_INTERVAL_MIN;
}
```

Add to `defaultAiConfig`:
```ts
  insightRecommendationIntervalMinutes: DEFAULT_INSIGHT_REC_INTERVAL_MIN,
```

Add to the `sanitizeAiConfig` return literal:
```ts
    insightRecommendationIntervalMinutes: clampInsightRecInterval(obj.insightRecommendationIntervalMinutes),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/settings-types.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-types.test.ts
git commit -m "feat(insights): add a clamped background-recommendation cadence setting"
```

---

## Task 7: Runner — configurable interval via an effect split

**Files:**
- Modify: `src/app/use-insight-recommend-runner.ts`
- Create: `src/app/use-insight-recommend-runner.test.ts`
- Modify: `src/app/task-manager.tsx`

★★ THE LANDMINE THIS TASK EXISTS FOR: the runner's `setInterval` currently lives
inside a `[]`-dep effect. Mirroring the new interval into a ref would NOT re-arm
the already-created timer — the setting would silently do nothing until reload.
But simply adding `[intervalMs]` to the existing effect re-runs its mount
`tick()` on every settings change, firing an EXTRA BILLED ROUND. The fix is to
split into two effects. Do not collapse them back.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInsightRecommendRunner } from "./use-insight-recommend-runner";

vi.mock("./insights/recommend-call", () => ({
  runInsightRecommendation: vi.fn(async () => ({
    summary: "s", proposedCalls: [], generatedAt: "2026-07-20", status: "proposed" as const,
  })),
}));

// ★ A candidate insight AND enabled:true are both required. With enabled:false
// (or an empty list) `tick` returns before doing anything, so the
// "no extra tick fired" assertion below would pass VACUOUSLY — it would still
// pass if the effect split were wrong. The runner must be genuinely live.
const CANDIDATE = {
  id: 1, key: "k1", type: "stalledWork", severity: "medium", data: { count: 5 },
  status: "active", firstSeenAt: "2026-07-20", lastSeenAt: "2026-07-20", occurrences: 1,
} as never;

function args(over: Partial<Parameters<typeof useInsightRecommendRunner>[0]> = {}) {
  return {
    enabled: true,
    insights: [CANDIDATE],
    ai: { apiKey: "k", model: "claude-x" },
    today: "2026-07-20",
    intervalMinutes: 60,
    buildIndex: () => ({}) as never,
    buildContextFor: () => "ctx",
    applyRecommendation: vi.fn(),
    ...over,
  };
}

describe("useInsightRecommendRunner cadence", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("arms the interval from intervalMinutes", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    renderHook((p: { m: number }) => useInsightRecommendRunner(args({ intervalMinutes: p.m })), {
      initialProps: { m: 60 },
    });
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
  });

  it("re-arms the interval when the setting changes WITHOUT firing an extra tick", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const apply = vi.fn();
    const { rerender } = renderHook(
      (p: { m: number }) =>
        useInsightRecommendRunner(args({ intervalMinutes: p.m, applyRecommendation: apply })),
      { initialProps: { m: 60 } },
    );
    // Let the mount tick's async chain settle so its call is actually counted —
    // otherwise "still 1" below would be true simply because nothing had run.
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    setSpy.mockClear();
    clearSpy.mockClear();
    rerender({ m: 30 });

    expect(clearSpy).toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
    // The mount tick must NOT re-fire — that would be an extra BILLED round on
    // every settings change. Still exactly one call, not two.
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("clamps an out-of-range interval rather than trusting it", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    renderHook(() => useInsightRecommendRunner(args({ intervalMinutes: 0 })));
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/use-insight-recommend-runner.test.ts`
Expected: FAIL — `intervalMinutes` is not a recognised arg; interval is 15 min.

- [ ] **Step 3: Implement the effect split**

Delete `const TICK_INTERVAL_MS = 15 * 60 * 1000;`.

Add to `InsightRecommendRunnerArgs`:
```ts
  /** Cadence in minutes. Re-clamped here — this hook drives BILLED calls, so it
   *  never trusts a caller-supplied rate. */
  intervalMinutes: number;
```

Extract `tick` so both effects can reach it — keep it in a ref so effect 2 does
not need it as a dep:

```ts
  const tickRef = useRef<() => Promise<void>>(async () => {});
  tickRef.current = async () => { /* the existing tick body, unchanged */ };

  // Effect 1: mount tick + visibility. `[]`-dep — fires exactly once per hook
  // lifetime, exactly as before.
  useEffect(() => {
    void tickRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tickRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Effect 2: the interval ONLY. Re-arms when the cadence changes; deliberately
  // does NOT re-fire the mount tick (that would be an extra billed round per
  // settings edit). Do not merge these two effects.
  const intervalMs = clampInsightRecInterval(args.intervalMinutes) * 60_000;
  useEffect(() => {
    const interval = setInterval(() => { void tickRef.current(); }, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
```

`intervalMs` is a hoisted SCALAR local — `react-hooks/exhaustive-deps` REJECTS
an `args.intervalMinutes` member expression in a dep array.

Import `clampInsightRecInterval` from `./settings-types`.

Update the file's header comment: the cadence is now user-settable, default 60.

In `task-manager.tsx`, pass the new arg at the `useInsightRecommendRunner` call
site:
```ts
  intervalMinutes: settings.ai.insightRecommendationIntervalMinutes ?? DEFAULT_INSIGHT_REC_INTERVAL_MIN,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/use-insight-recommend-runner.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, no lint output.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-insight-recommend-runner.ts src/app/use-insight-recommend-runner.test.ts src/app/task-manager.tsx
git commit -m "feat(insights): make the background recommendation cadence configurable"
```

---

## Task 8: Settings UI for the cadence

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`

- [ ] **Step 1: Add the input**

Beside the existing `insightRecommendations` toggle, rendered only when that
toggle is on:

- Use the `Input` primitive from `form-controls.tsx` with `type="number"`,
  `min={15}`, `max={1440}`, `step={15}`. Do NOT hand-roll an `<input>`.
- The onChange routes through `clampInsightRecInterval` — the SAME clamp as the
  sanitizer and the runner. A directly-typed value must never reach the runner
  unclamped.
- Persist via the existing `onChangeSettings` path (→ `writeSettings` spread).
  NEVER a raw `localStorage.setItem` — that path dumps decrypted in-memory
  secrets to disk.
- Label from `aiInsightRecInterval`, hint from `aiInsightRecIntervalHint` via
  the existing `FieldHint` idiom in this file.
- ★ Settings → General IS axe-scanned: the input needs a real
  `aria-label`/`<label>`. A placeholder is NOT an accessible name.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run test:run
```
Expected: exit 0; full suite green.

- [ ] **Step 3: Axe-check the settings surface**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings-sections/ai-section.tsx
git commit -m "feat(insights): add the recommendation cadence control to AI settings"
```

---

## Task 9: Release prep

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `AGENTS.md`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (the highlight key)
- Modify: `docs/baselines/file-sizes.json` (only if a baselined file grew)

- [ ] **Step 1: Pick a UNIQUE milestone codename**

```bash
grep -oE '^## [0-9.]+ "[A-Za-z]+"' CHANGELOG.md | sed 's/.*"//;s/"//' | sort
```
Choose a science-fiction author surname NOT in that list.

- [ ] **Step 2: Bump the version**

`src/app/version.ts`: `APP_VERSION = "0.193.0"`, `APP_MILESTONE = "<name>"`, and
append `versionHighlightInsightsDigest` to `APP_HIGHLIGHT_KEYS`.
`package.json`: version `0.193.0`.
Add the EN + DE `versionHighlightInsightsDigest` strings (DE via the node utf8
write, per Task 3).

- [ ] **Step 3: CHANGELOG entry**

Cover: the rolling 7-day digest card, the wins section closing the SP3
visibility gap, and the configurable recommendation cadence (default 60 min,
was a fixed 15).

- [ ] **Step 4: AGENTS.md**

Extend the "Insights → action loop" section with an SP4 bullet. Record the two
landmines specifically: the runner's **two-effect split** (why it must not be
merged), and that the digest adds **zero persisted fields** (pure derivation —
no six-write-path, no golden regen).

- [ ] **Step 5: Full gate run**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run dup:check
npm run size:check
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"
```
Expected: all green. If `size:check` fails on a grown baselined file, update
`docs/baselines/file-sizes.json` to the new count.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "0.193.0 \"<name>\" — Insights SP4: digest"
```

- [ ] **Step 7: STOP**

Do NOT push, open an MR, or merge. The user triggers the release chain
explicitly with the word "release".
