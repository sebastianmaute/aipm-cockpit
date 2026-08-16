# AI Recall B2a — history search + ambient outcomes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI assistant read access to the project's history — a `search_history` tool over `activityLog`, plus acted-on insight outcomes surfaced ambiently in the system prompt.

**Architecture:** One render layer (`activity-prompt.ts`, may import `t`) turns `ActivityEntry` into English lines by reusing the existing EN i18n strings. One pure engine (`history-search.ts`, may not import `t`) filters, sorts and caps them. The dispatcher exposes `getActivityLog()` — deliberately **not** a snapshot field — and `runTool` routes the new tool to it. Separately, `buildInsightsPromptBlock` gains a capped "recent outcomes" section from the `acted`/`resolved` insights it currently filters away.

**Tech Stack:** TypeScript, React 19, Next 16, vitest, existing `chat-tools`/`chat-tool-defs` dispatcher harness.

**Spec:** `docs/superpowers/specs/2026-08-16-ai-recall-b2a-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/app/activity-prompt.ts` | create | Render layer: `ActivityEntry` → `{at, summary, detail?}` via `t("en-US", …)`. |
| `src/app/activity-prompt.test.ts` | create | Table-driven over every `ActivityKind`; unknown-kind safety. |
| `src/app/history-search.ts` | create | Pure engine: filter by kinds/date/query, sort newest-first, cap. |
| `src/app/history-search.test.ts` | create | Filters, cap, `truncated` semantics. |
| `src/app/chat-tools.ts` | modify | `getActivityLog()` on `ToolDispatcher`; one `runTool` case. |
| `src/app/chat-tool-defs.ts` | modify | The `search_history` tool schema. |
| `src/app/use-chat-dispatcher.ts` | modify | Destructure `activityLog` from `useWorkspace()`, ref, refresh effect, method. |
| `src/app/insights/insight-prompt.ts` | modify | `MAX_PROMPT_OUTCOMES` + the outcomes section. |
| `src/app/insights/insight-prompt.test.ts` | modify | Outcome section cases. |
| `src/app/chat-tools.test.ts` | modify | Snapshot guard + tool routing. |
| `AGENTS.md` | modify | Record the tool, the layer split, and the snapshot landmine. |

**No baselined file is touched.** `use-chat-dispatcher.ts` (765/800) and `chat-tools.ts` (763/800) are the only near-cap files in scope.

### Deviation from the spec, applied deliberately

The spec says `since`/`until` "resolve against a `today` passed in". **They do not need `today` at all** — the model passes absolute ISO dates, and comparison is a date-string prefix compare (`entry.timestamp.slice(0, 10) >= since`). Dropping the parameter keeps the engine clock-free with one less thing to wire. If a later slice wants relative windows, `today` can be added then.

---

### Task 1: Activity render layer

**Files:**
- Create: `src/app/activity-prompt.ts`
- Test: `src/app/activity-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/activity-prompt.test.ts
import { describe, expect, it } from "vitest";
import { ACTIVITY_KIND_TO_KEY, type ActivityEntry, type ActivityKind } from "./activity-log";
import { renderActivityEntry } from "./activity-prompt";

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: "dev-1-1",
  timestamp: "2026-08-10T09:00:00.000Z",
  kind: "task.created",
  args: [7, "Fix login"],
  ...over,
});

describe("renderActivityEntry", () => {
  it("renders the English message with args interpolated", () => {
    const r = renderActivityEntry(entry());
    expect(r.summary).toBe("Task #7 created: Fix login");
    expect(r.at).toBe("2026-08-10T09:00:00.000Z");
    expect(r.detail).toBeUndefined();
  });

  it("renders a field-diff suffix when the entry carries changes", () => {
    const r = renderActivityEntry(
      entry({ kind: "task.updated", changes: [{ field: "status", from: "To Do", to: "Done" }] }),
    );
    expect(r.detail).toBe("status: To Do → Done");
  });

  it("caps the diff suffix at MAX_FIELD_CHANGES", () => {
    const changes = Array.from({ length: 20 }, (_, i) => ({
      field: `f${i}`,
      from: "a",
      to: "b",
    }));
    const r = renderActivityEntry(entry({ kind: "task.updated", changes }));
    expect(r.detail?.split("; ")).toHaveLength(12);
  });

  // ★ The prototype-lookup crash: a bare ACTIVITY_KIND_TO_KEY[kind] resolves
  //   "toString" to a Function.prototype method, after which t() throws on
  //   undefined.replace. activityMessageKey's hasOwnProperty check is the guard.
  it("falls back for an unknown kind without crashing, including 'toString'", () => {
    for (const bogus of ["totally.bogus", "toString", "constructor"]) {
      const r = renderActivityEntry(entry({ kind: bogus as ActivityKind }));
      expect(r.summary).toBe(`Unrecognized activity (${bogus})`);
    }
  });

  // ★ Table-driven over the WHOLE union: proves the render path resolves for
  //   every kind and leaves no unfilled {N} placeholder. It deliberately does
  //   NOT assert wording — the i18n string IS the wording.
  it("renders every ActivityKind with no placeholder left unfilled", () => {
    const kinds = Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[];
    expect(kinds).toHaveLength(55);
    for (const kind of kinds) {
      const r = renderActivityEntry(entry({ kind, args: ["A", "B", "C", "D"] }));
      expect(r.summary, kind).not.toBe("");
      expect(r.summary, kind).not.toMatch(/\{\d\}/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/activity-prompt.test.ts`
Expected: FAIL — `Failed to resolve import "./activity-prompt"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/activity-prompt.ts
// RENDER LAYER for ActivityEntry → model-facing English lines.
//
// ★★ This file may import `t`; `history-search.ts` may NOT. That split is what
//    keeps AGENTS.md's "engines stay i18n-free" rule intact while letting the
//    model see exactly the wording the Activity panel shows. `insight-text.ts`
//    carries the same render-layer classification for the same reason.
//
// ★★ Always "en-US", never the user's language: the model-facing view must not
//    change when the UI switches to German. The EN dict is static (only DE is
//    lazily loaded), so no loadI18n call is needed.
//
// ★★★ Rendering goes through `activityMessageKey`, NEVER a bare
//     ACTIVITY_KIND_TO_KEY[kind] index. `sanitizeActivityEntry` deliberately
//     KEEPS an unrecognised string kind (forward-compat with newer releases),
//     so kind: "toString" reaches here — and a bare index resolves it to a
//     Function.prototype method, after which t() throws on undefined.replace
//     and takes the app down through the top-level ErrorBoundary.
import {
  type ActivityEntry,
  MAX_FIELD_CHANGES,
  activityMessageKey,
} from "./activity-log";
import { t } from "./i18n";

export interface RenderedActivity {
  /** The entry's ISO timestamp, verbatim. */
  at: string;
  /** English message with positional args interpolated. */
  summary: string;
  /** Field-diff suffix; omitted when the entry carries no changes. */
  detail?: string;
}

export function renderActivityEntry(entry: ActivityEntry): RenderedActivity {
  const key = activityMessageKey(entry.kind);
  const summary = key
    ? t("en-US", key, ...entry.args)
    : t("en-US", "activityUnknownKind", entry.kind);

  const changes = entry.changes ?? [];
  if (changes.length === 0) return { at: entry.timestamp, summary };

  const detail = changes
    .slice(0, MAX_FIELD_CHANGES)
    .map((c) => `${c.field}: ${c.from} → ${c.to}`)
    .join("; ");
  return { at: entry.timestamp, summary, detail };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/activity-prompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-check the unknown-kind guard**

Temporarily replace `activityMessageKey(entry.kind)` with `ACTIVITY_KIND_TO_KEY[entry.kind]` (adding the import). Re-run. Expected: the `'toString'` test FAILS. **Revert the mutation** before continuing — a live mutant left in the tree is a known past failure here.

- [ ] **Step 6: Commit**

```bash
git add src/app/activity-prompt.ts src/app/activity-prompt.test.ts
git commit -m "feat(ai): render activity entries into model-facing English lines"
```

---

### Task 2: History search engine

**Files:**
- Create: `src/app/history-search.ts`
- Test: `src/app/history-search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/history-search.test.ts
import { describe, expect, it } from "vitest";
import type { ActivityEntry, ActivityKind } from "./activity-log";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, searchHistory } from "./history-search";

const at = (day: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `dev-1-${day}`,
  timestamp: `2026-08-${day}T09:00:00.000Z`,
  kind: "task.created",
  args: [1, "Fix login"],
  ...over,
});

describe("searchHistory", () => {
  it("returns newest first", () => {
    const r = searchHistory([at("10"), at("12"), at("11")], {});
    expect(r.events.map((e) => e.at.slice(8, 10))).toEqual(["12", "11", "10"]);
  });

  it("filters by kind", () => {
    const r = searchHistory([at("10"), at("11", { kind: "milestone.deleted" })], {
      kinds: ["milestone.deleted"],
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].summary).toContain("Milestone");
  });

  it("filters by since and until inclusively on the date part", () => {
    const entries = [at("10"), at("11"), at("12")];
    expect(searchHistory(entries, { since: "2026-08-11" }).events).toHaveLength(2);
    expect(searchHistory(entries, { until: "2026-08-11" }).events).toHaveLength(2);
    expect(
      searchHistory(entries, { since: "2026-08-11", until: "2026-08-11" }).events,
    ).toHaveLength(1);
  });

  it("matches query case-insensitively across summary and detail", () => {
    const entries = [
      at("10", { args: [1, "Fix login"] }),
      at("11", {
        kind: "task.updated",
        args: [2, "Other"],
        changes: [{ field: "status", from: "To Do", to: "Done" }],
      }),
    ];
    expect(searchHistory(entries, { query: "FIX LOGIN" }).events).toHaveLength(1);
    expect(searchHistory(entries, { query: "to do" }).events).toHaveLength(1);
  });

  // ★ truncated must reflect whether the cap ACTUALLY cut, not whether a limit
  //   was supplied — the model uses it to decide whether to claim completeness.
  it("sets truncated only when the cap actually cuts", () => {
    const entries = Array.from({ length: 3 }, (_, i) => at(String(10 + i)));
    expect(searchHistory(entries, { limit: 3 }).truncated).toBe(false);
    expect(searchHistory(entries, { limit: 2 }).truncated).toBe(true);
    expect(searchHistory(entries, { limit: 2 }).events).toHaveLength(2);
  });

  it("defaults to DEFAULT_HISTORY_LIMIT and clamps to MAX_HISTORY_LIMIT", () => {
    const entries = Array.from({ length: 250 }, (_, i) =>
      at("10", { id: `e${i}`, timestamp: `2026-08-10T09:00:${String(i % 60).padStart(2, "0")}.000Z` }),
    );
    expect(searchHistory(entries, {}).events).toHaveLength(DEFAULT_HISTORY_LIMIT);
    expect(searchHistory(entries, { limit: 9999 }).events).toHaveLength(MAX_HISTORY_LIMIT);
    expect(searchHistory(entries, { limit: 0 }).events).toHaveLength(DEFAULT_HISTORY_LIMIT);
  });

  it("returns an empty result for an empty log", () => {
    expect(searchHistory([], { query: "anything" })).toEqual({ events: [], truncated: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/history-search.test.ts`
Expected: FAIL — `Failed to resolve import "./history-search"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/history-search.ts
// PURE ENGINE over the activity log: filter → sort → cap.
//
// ★★ i18n-FREE BY CONTRACT. It receives already-rendered lines from
//    `activity-prompt.ts` (the render layer) and must never import `t` itself.
//
// ★ No clock. `since`/`until` are absolute ISO dates supplied by the caller;
//   converting "last week" into a date is the model's job. Comparison is a
//   date-part prefix compare, so both bounds are inclusive of their whole day.
import type { ActivityEntry } from "./activity-log";
import { type RenderedActivity, renderActivityEntry } from "./activity-prompt";

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

export interface HistoryQuery {
  query?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  since?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  until?: string;
  kinds?: readonly string[];
  limit?: number;
}

export interface HistoryResult {
  events: RenderedActivity[];
  /** True only when the cap actually discarded matches. */
  truncated: boolean;
}

function resolveLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.floor(raw), MAX_HISTORY_LIMIT);
}

export function searchHistory(
  entries: readonly ActivityEntry[],
  q: HistoryQuery,
): HistoryResult {
  const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
  const needle = q.query?.trim().toLowerCase();

  const matched: RenderedActivity[] = [];
  for (const entry of entries) {
    if (kinds && !kinds.has(entry.kind)) continue;
    const day = entry.timestamp.slice(0, 10);
    if (q.since && day < q.since) continue;
    if (q.until && day > q.until) continue;

    const rendered = renderActivityEntry(entry);
    if (needle) {
      const hay = `${rendered.summary} ${rendered.detail ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    matched.push(rendered);
  }

  matched.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const limit = resolveLimit(q.limit);
  return { events: matched.slice(0, limit), truncated: matched.length > limit };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/history-search.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/history-search.ts src/app/history-search.test.ts
git commit -m "feat(ai): add the pure history-search engine over the activity log"
```

---

### Task 3: Dispatcher access — `getActivityLog()`, NOT a snapshot field

**Files:**
- Modify: `src/app/chat-tools.ts` (the `ToolDispatcher` type)
- Modify: `src/app/use-chat-dispatcher.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing guard test**

Add to `src/app/chat-tools.test.ts`:

```ts
// ★★★ activityLog must NEVER reach getSnapshot(). runTool's `get_app_state`
//     case returns getSnapshot() VERBATIM, and the log is unbounded
//     (mergeActivityLogs caps what is STORED, not what is read) — so mirroring
//     it beside `insights` would dump thousands of entries, with field diffs,
//     into the context window on a single get_app_state call. The tool reads it
//     through the dedicated getActivityLog() method instead.
//
//     This test exists because "completing the pattern" later is a natural,
//     plausible edit that every other test in the suite would stay green for.
it("keeps activityLog OFF the app-state snapshot", async () => {
  const d = makeDispatcher();
  const snapshot = (await runTool(d, "get_app_state", {})) as Record<string, unknown>;
  expect("activityLog" in snapshot).toBe(false);
});
```

> `chat-tools.test.ts` already has `makeDispatcher(over: Partial<ToolDispatcher> = {})`. Use it — do not introduce a second stub. Once Step 3 adds `getActivityLog` to the `ToolDispatcher` type, the stub's **default** must supply `getActivityLog: () => []` or every existing test in the file fails to typecheck.

- [ ] **Step 2: Run it to verify it passes for the wrong reason, then guard against that**

Run: `npx vitest run src/app/chat-tools.test.ts -t "OFF the app-state snapshot"`
Expected: PASS immediately — nothing has added the field yet.

To prove the test can fail, temporarily add `activityLog: []` to the stub's `getSnapshot()` return. Expected: FAIL. **Revert.**

- [ ] **Step 3: Add the dispatcher method to the type**

In `src/app/chat-tools.ts`, inside `export type ToolDispatcher = {`, beside `getSnapshot()`:

```ts
  /** The project's activity log. ★★★ Deliberately a METHOD rather than a
   *  `getSnapshot()` field: `get_app_state` returns the snapshot verbatim, and
   *  this collection is unbounded. See chat-tools.test.ts's guard test. */
  getActivityLog(): readonly ActivityEntry[];
```

Add the type import alongside the existing entity imports:

```ts
import type { ActivityEntry } from "./activity-log";
```

- [ ] **Step 4: Implement it in the hook**

In `src/app/use-chat-dispatcher.ts`:

1. Add `activityLog,` to the existing `useWorkspace()` destructure (it is already on that context).
2. Beside the other refs: `const activityLogRef = useRef(activityLog);`
3. Beside the other refresh effects:

```ts
  useEffect(() => {
    activityLogRef.current = activityLog;
  }, [activityLog]);
```

4. In the returned dispatcher object, beside `getSnapshot`:

```ts
      getActivityLog: () => activityLogRef.current,
```

- [ ] **Step 5: Verify types and size**

```bash
npx tsc --noEmit; echo "TSC=$?"
npm run size:check; echo "SIZE=$?"
```
Expected: both `0`. `use-chat-dispatcher.ts` should land near 771 of 800.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-tools.ts src/app/use-chat-dispatcher.ts src/app/chat-tools.test.ts
git commit -m "feat(ai): expose the activity log to tools without putting it on the snapshot"
```

---

### Task 4: The `search_history` tool

**Files:**
- Modify: `src/app/chat-tool-defs.ts`
- Modify: `src/app/chat-tools.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("search_history", () => {
  it("is registered in TOOL_DEFS", () => {
    expect(TOOL_DEFS.some((d) => d.name === "search_history")).toBe(true);
  });

  it("returns rendered events newest-first from the dispatcher's log", async () => {
    const d = makeDispatcher({ getActivityLog: () => [
      { id: "a", timestamp: "2026-08-10T09:00:00.000Z", kind: "task.created", args: [1, "Alpha"] },
      { id: "b", timestamp: "2026-08-12T09:00:00.000Z", kind: "task.created", args: [2, "Beta"] },
    ] });
    const r = (await runTool(d, "search_history", {})) as {
      events: { summary: string }[];
      truncated: boolean;
    };
    expect(r.events.map((e) => e.summary)).toEqual([
      "Task #2 created: Beta",
      "Task #1 created: Alpha",
    ]);
    expect(r.truncated).toBe(false);
  });

  it("passes the model's filters through", async () => {
    const d = makeDispatcher({ getActivityLog: () => [
      { id: "a", timestamp: "2026-08-10T09:00:00.000Z", kind: "task.created", args: [1, "Alpha"] },
      { id: "b", timestamp: "2026-08-12T09:00:00.000Z", kind: "task.created", args: [2, "Beta"] },
    ] });
    const r = (await runTool(d, "search_history", { query: "beta" })) as {
      events: { summary: string }[];
    };
    expect(r.events).toHaveLength(1);
  });

  // ★ The model is untrusted input: a non-object/garbage arg must not throw.
  it("ignores malformed arguments rather than throwing", async () => {
    const d = makeDispatcher({ getActivityLog: () => [] });
    await expect(
      runTool(d, "search_history", { query: 42, kinds: "nope", limit: "ten" }),
    ).resolves.toEqual({ events: [], truncated: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/chat-tools.test.ts -t "search_history"`
Expected: FAIL — the tool is not registered and `runTool` returns the unknown-tool result.

- [ ] **Step 3: Add the tool schema**

In `src/app/chat-tool-defs.ts`, append to `TOOL_DEFS` (order does not matter; keep it beside the other read-only `list_*`/`get_*` entries):

```ts
  {
    name: "search_history",
    description:
      "Search this project's activity history — the audit trail of every create, update, delete, " +
      "status change, AI action and integration sync, newest first. Use it for questions about what " +
      "CHANGED and WHEN (\"what happened last week\", \"who moved that milestone\", \"what did this " +
      "field say before\"); use the list_* tools for current state. Each event has an ISO timestamp, " +
      "an English summary, and an optional detail string carrying the field-level before/after diff. " +
      "If `truncated` is true, more events matched than were returned — say so rather than implying " +
      "the list is complete. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive substring matched against the summary and diff detail.",
        },
        since: {
          type: "string",
          description: "Inclusive lower bound as YYYY-MM-DD. Convert relative phrasing yourself.",
        },
        until: { type: "string", description: "Inclusive upper bound as YYYY-MM-DD." },
        kinds: {
          type: "array",
          items: { type: "string" },
          description:
            'Restrict to specific event kinds, e.g. ["task.updated", "milestone.deleted"].',
        },
        limit: {
          type: "number",
          description: "Max events to return. Defaults to 50, capped at 200.",
        },
      },
    },
  },
```

- [ ] **Step 4: Route it in `runTool`**

In `src/app/chat-tools.ts`, beside the other read-only cases:

```ts
    case "search_history":
      return searchHistory(d.getActivityLog(), {
        query: typeof input.query === "string" ? input.query : undefined,
        since: typeof input.since === "string" ? input.since : undefined,
        until: typeof input.until === "string" ? input.until : undefined,
        kinds: Array.isArray(input.kinds)
          ? input.kinds.filter((k): k is string => typeof k === "string")
          : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      });
```

Add the import:

```ts
import { searchHistory } from "./history-search";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/chat-tools.test.ts`
Expected: PASS, including the four new cases.

- [ ] **Step 6: Verify size**

```bash
npm run size:check; echo "SIZE=$?"
```
Expected: `0`. `chat-tools.ts` should land near 776 of 800; `chat-tool-defs.ts` near 630.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/chat-tools.test.ts
git commit -m "feat(ai): add the search_history tool over the project activity log"
```

---

### Task 5: Ambient insight outcomes

**Files:**
- Modify: `src/app/insights/insight-prompt.ts`
- Test: `src/app/insights/insight-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

> The file's existing factory is `make(id, type, severity, status, data)` — positional, five
> arguments, and it does **not** take an outcome. Build on it rather than adding a second factory.
>
> ★ The existing test `"returns empty string when no insight is active/acknowledged"` seeds
> `resolved` and `acted` insights with **no** `outcome`, so it must keep passing unchanged. It is a
> load-bearing control: it proves the new section requires a *measured* outcome, not merely an
> acted status. If it goes red, the filter is testing `status` alone.

```ts
import { buildInsightsPromptBlock, MAX_PROMPT_INSIGHTS, MAX_PROMPT_OUTCOMES } from "./insight-prompt";

const acted = (id: number, outcome?: Insight["outcome"]): Insight => ({
  ...make(id, "stalledWork", "high", "acted", { count: 4 }),
  outcome: outcome ?? {
    direction: "improved",
    baseline: 9,
    current: 3,
    delta: -6,
    measuredAt: "2026-08-10",
  },
});

describe("recent outcomes section", () => {
  it("surfaces acted/resolved insights that carry an outcome", () => {
    const out = buildInsightsPromptBlock([acted(1)]);
    expect(out).toContain("Recent outcomes");
    expect(out).toContain("improved");
  });

  it("omits the section entirely when no outcome exists", () => {
    expect(buildInsightsPromptBlock([])).toBe("");
    const activeOnly = buildInsightsPromptBlock([
      make(1, "stalledWork", "high", "active", { count: 4 }),
    ]);
    expect(activeOnly).not.toContain("Recent outcomes");
  });

  // ★ 'unchanged' must be INCLUDED: a tried-it-and-nothing-moved result is what
  //   stops the assistant re-recommending the same action. Filtering it would
  //   bias the model's view toward things that worked.
  it("includes unchanged outcomes", () => {
    const out = buildInsightsPromptBlock([
      acted(1, { direction: "unchanged", baseline: 5, measuredAt: "2026-08-10" }),
    ]);
    expect(out).toContain("unchanged");
  });

  // ★ TEST-VALIDITY NOTE: `measuredAt` never appears in the rendered line, so
  //   asserting on the date would be VACUOUS — it would pass whatever the sort
  //   does. The fixture varies `count`, which DOES render ("N tasks stalled"),
  //   so ordering is observable. Mutate the sort comparator to prove it fails.
  it("caps at MAX_PROMPT_OUTCOMES, newest measuredAt first", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...make(i + 1, "stalledWork", "high", "acted", { count: i + 1 }),
      outcome: {
        direction: "improved" as const,
        baseline: 1,
        measuredAt: `2026-08-0${i + 1}`,
      },
    }));
    const block = buildInsightsPromptBlock(many);
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(MAX_PROMPT_OUTCOMES);
    // measuredAt 08-09 → 08-05 survive, i.e. counts 9 down to 5; count 4 is cut.
    expect(lines[0]).toContain("9 tasks stalled");
    expect(lines[4]).toContain("5 tasks stalled");
    expect(block).not.toContain("4 tasks stalled");
  });

  it("ignores acted insights with no outcome measured yet", () => {
    const noOutcome = { ...make(1, "stalledWork", "high", "acted", { count: 4 }) };
    expect(buildInsightsPromptBlock([noOutcome])).not.toContain("Recent outcomes");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/insights/insight-prompt.test.ts`
Expected: FAIL — `MAX_PROMPT_OUTCOMES` is not exported and no outcomes section is emitted.

- [ ] **Step 3: Implement**

In `src/app/insights/insight-prompt.ts`:

```ts
/** Statuses whose insights have been acted on and may carry a measured outcome. */
const OUTCOME_STATUSES: ReadonlySet<Insight["status"]> = new Set(["acted", "resolved"]);

/** Top-N recent outcomes surfaced to the model. Small on purpose — this rides
 *  every turn. */
export const MAX_PROMPT_OUTCOMES = 5;

/** ★ No clock and no window: sorting by `measuredAt` and capping gives "recent"
 *  while keeping this module deterministic and its signature one-argument. */
function outcomeLine(insight: Insight): string {
  const o = insight.outcome;
  if (!o) return "";
  const move =
    typeof o.current === "number" && typeof o.delta === "number"
      ? ` (${o.baseline} → ${o.current}, ${signed(o.delta)})`
      : "";
  return `- ${factLine(insight)} → acted, ${o.direction}${move}`;
}
```

Then, at the end of `buildInsightsPromptBlock`, replace the single-block return with a two-section assembly:

```ts
  const outcomes = insights
    .filter((i) => OUTCOME_STATUSES.has(i.status) && i.outcome)
    .sort((a, b) => (a.outcome!.measuredAt < b.outcome!.measuredAt ? 1 : -1))
    .slice(0, MAX_PROMPT_OUTCOMES);

  const sections: string[] = [];
  if (surfaced.length > 0) {
    sections.push(
      [
        "Current project insights (deterministic, advisory — surfaced from automated detectors):",
        ...surfaced.map((i) => `- [${i.severity}] ${factLine(i)}`),
      ].join("\n"),
    );
  }
  if (outcomes.length > 0) {
    sections.push(
      [
        "Recent outcomes (acted-on insights and what happened):",
        ...outcomes.map(outcomeLine),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
```

Note the early `if (surfaced.length === 0) return "";` guard must be **removed** — an empty active set no longer means an empty block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/insights/insight-prompt.test.ts src/app/chat-api.system-prompt.test.ts`
Expected: PASS. The system-prompt test must still show the block in the **uncached** section — if it fails, the block was moved, not grown.

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/insight-prompt.ts src/app/insights/insight-prompt.test.ts
git commit -m "feat(ai): surface acted-on insight outcomes in the system prompt"
```

---

### Task 6: Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS/ai-assistant.md`

- [ ] **Step 1: Record the landmines**

Add to the AI-assistant material, citing **symbols only, never `path:LINE`** (the `docs:claims:check` ratchet fails on any new line citation):

- `search_history` exists and covers HISTORY; the `list_*` tools cover current STATE.
- ★★★ `activityLog` must never join `getSnapshot()` — `get_app_state` returns it verbatim and the log is unbounded. `getActivityLog()` is the access path; `chat-tools.test.ts` guards it.
- ★★ The layer split: `activity-prompt.ts` is a RENDER layer and may import `t`; `history-search.ts` is a pure engine and may not.
- ★★ `buildInsightsPromptBlock` now emits TWO sections and no longer returns `""` merely because the active set is empty.
- ★ Chat-thread search was deliberately deferred to B2c — `useChatThreads` sits below `useChatDispatcher` in the tree, so threads cannot reach the snapshot without touching three baselined files.

- [ ] **Step 2: Verify the doc gates**

```bash
npm run docs:symbols:check; echo "SYMBOLS=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
```
Expected: both `0`. A failure on `SYMBOLS` means a backticked mixed-case name does not exist in `src`; a failure on `CLAIMS` means a new `path:LINE` citation was added — remove it, do not re-baseline.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/AGENTS/ai-assistant.md
git commit -m "docs: record the search_history tool and the snapshot landmine"
```

---

### Task 7: Full gate run

- [ ] **Step 1: Run every blocking gate, unpiped**

★★★ Never read a gate's exit code through a pipe — you get the pipe's status. Redirect, then read the file.

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "SUITE=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"; grep -E "ERROR|All files" /tmp/cov.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

Expected: every variable `0`.

> `Tests no tests` printed alongside a non-zero exit is a vitest **worker-startup failure**, not a pass. Read the log body.

- [ ] **Step 2: Confirm coverage did not drop**

Both new modules are gated logic and must not be added to `coverage.exclude`. If `COV` fails on the global floors (lines 92 / funcs 91 / branch 80 / stmts 89), add the missing tests — **never lower a floor and never re-baseline a ratchet to pass it.**

- [ ] **Step 3: Sweep for live mutants**

Tasks 1 and 3 each ask for a temporary mutation. Confirm neither survived:

```bash
git diff --quiet; echo "CLEAN_IF_0=$?"
grep -rn "ACTIVITY_KIND_TO_KEY\[" src/app/activity-prompt.ts; echo "(expect no output)"
```

- [ ] **Step 4: Report**

Report the actual numbers — tests passed, coverage percentages, the final line counts of `use-chat-dispatcher.ts` and `chat-tools.ts` against the 800 cap. Do **not** report "all green" without the exit codes behind it.

---

## Out of scope for this plan

- Chat-thread search and its coverage disclaimer (B2c).
- An ambient recent-activity recap (B2b).
- A `source` discriminator on events — one source, so YAGNI.
- Any version bump, changelog entry, push, MR or merge. Those happen only on an explicit instruction.
