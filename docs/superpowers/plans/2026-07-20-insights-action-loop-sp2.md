# Insights → Action Loop SP2 — Proactive AI Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An insight can carry an AI-proposed, executable recommendation — generated per-insight on demand or by an opt-in background job — reviewed as a plan-then-apply diff and applied through the existing chat `runTool` dispatcher, recorded on the insight for SP3. Plus: thread `priorOverdueCount` so `overdueTrend` fires.

**Architecture:** Pure i18n-free engine in `src/app/insights/` (recommend contract + grounding + context + a plan-preview builder). One shared never-log forced-tool call (`recommend-call.ts` via `runForcedToolCall`). Two triggers share the generate path: an on-demand hook + a background runner mirroring `use-scheduled-job-runner.ts`. Apply reuses the inline-ai-edit `EditPlan` preview + the chat `runTool` dispatcher. The recommendation is one optional field on the SP1 `Insight`, riding the existing insights blob across all six write paths (byte-stable when empty).

**Tech Stack:** Forked Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest 4. Reuses SP1 insights modules, `ai-forced-call.ts`, `inline-ai-edit/plan.ts`, `chat-tools.ts` `runTool`.

**Reference precedents (read before starting):** `src/app/insights/insight.ts`, `sanitize-insights.ts`, `reconcile.ts` (SP1); `src/app/ai-forced-call.ts`, `task-dedup-call.ts`, `action-ai.ts` (forced-call + grounding); `src/app/inline-ai-edit/plan.ts`, `inline-ai-edit-popover.tsx`, `use-inline-ai-edit.ts`, `use-tasks-inline-ai-edit.tsx` (plan-then-apply + runTool); `src/app/use-scheduled-job-runner.ts` (background runner); `src/app/chat-tool-defs.ts` (`TOOL_DEFS` names); `src/app/settings-types.ts` (`AiConfig`/`sanitizeAiConfig`).

**Global constraints:** `npx tsc --noEmit` (trust it over IDE squiggles), `npm run lint` (`--max-warnings=0`; no unused imports; hoist `obj.member`/`?.length` out of dep arrays; no `set-state-in-effect`; no `Date.now()`/`new Date()` in render), `npm run test:run`, `npm run dup:check`, `npm run size:check`. DE i18n edits via node utf8 write (real umlauts, CRLF `\r\n` anchors) — NEVER the Edit tool. Secrets never logged/echoed.

---

### Task 1: Data model + sanitizer

**Files:**
- Modify: `src/app/insights/insight.ts`
- Modify: `src/app/insights/sanitize-insights.ts`
- Test: `src/app/insights/sanitize-insights.test.ts` (extend)

- [ ] **Step 1: Write failing sanitize tests**

Add to `sanitize-insights.test.ts`:

```ts
import { sanitizeInsights } from "./sanitize-insights";

function baseRaw() {
  return {
    id: 1, key: "raidAging:5", type: "raidAging", severity: "high", status: "active",
    data: {}, firstSeenAt: "2026-07-20", lastSeenAt: "2026-07-20", occurrences: 1,
  };
}

test("keeps a valid recommendation", () => {
  const rec = {
    summary: "Reschedule task 12 to next week", status: "proposed", generatedAt: "2026-07-20",
    proposedCalls: [{ name: "update_task", input: { id: 12, dueDate: "2026-07-27" } }],
  };
  const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: rec }]);
  expect(out.recommendation?.summary).toBe("Reschedule task 12 to next week");
  expect(out.recommendation?.proposedCalls).toHaveLength(1);
  expect(out.recommendation?.status).toBe("proposed");
});

test("drops recommendation with empty summary or non-array calls", () => {
  const [a] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "  ", proposedCalls: [] } }]);
  expect(a.recommendation).toBeUndefined();
  const [b] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "x", proposedCalls: "nope" } }]);
  expect(b.recommendation).toBeUndefined();
});

test("drops malformed proposedCalls and caps count", () => {
  const calls = [
    { name: "update_task", input: { id: 1 } },
    { name: 123, input: {} },            // bad name
    { name: "update_task", input: "no" },// bad input
    ...Array.from({ length: 10 }, () => ({ name: "update_task", input: { id: 2 } })),
  ];
  const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "s", proposedCalls: calls } }]);
  expect(out.recommendation!.proposedCalls.length).toBeLessThanOrEqual(5);
  expect(out.recommendation!.proposedCalls.every((c) => typeof c.name === "string" && typeof c.input === "object")).toBe(true);
});

test("defaults bad status to proposed", () => {
  const [out] = sanitizeInsights([{ ...baseRaw(), recommendation: { summary: "s", status: "weird", proposedCalls: [{ name: "update_task", input: {} }] } }]);
  expect(out.recommendation!.status).toBe("proposed");
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test:run -- sanitize-insights`
Expected: FAIL (`recommendation` not preserved).

- [ ] **Step 3: Extend `insight.ts`**

Add after the `Insight` interface / consts:

```ts
export interface InsightToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export const INSIGHT_REC_STATUSES = ["proposed", "applied", "rejected"] as const;
export type InsightRecommendationStatus = (typeof INSIGHT_REC_STATUSES)[number];

export interface InsightRecommendation {
  readonly summary: string;
  readonly proposedCalls: readonly InsightToolCall[];
  readonly generatedAt: string;
  readonly status: InsightRecommendationStatus;
  readonly appliedSummary?: string;
  readonly appliedAt?: string;
}

export const INSIGHT_REC_SUMMARY_MAX = 500;
export const INSIGHT_REC_MAX_CALLS = 5;
export const INSIGHT_REC_TOOL_NAME_MAX = 60;
export const MAX_BG_RECS_PER_TICK = 3;
```

Add `readonly recommendation?: InsightRecommendation;` to the `Insight` interface (after `metricAtAction`). Update the `InsightActions` interface:

```ts
export interface InsightActions {
  readonly onAcknowledge: (id: number) => void;
  readonly onAct: (id: number) => void;
  readonly onDismiss: (id: number, reason?: string) => void;
  readonly onGenerateRecommendation: (id: number) => void;
  readonly onApplyRecommendation: (id: number) => void;
  readonly onRejectRecommendation: (id: number) => void;
}
```

- [ ] **Step 4: Extend `sanitize-insights.ts`**

Add a helper (mirrors the existing `str`/`sanitizeData` posture) and wire it into the built `insight`:

```ts
import {
  /* existing… */ INSIGHT_REC_STATUSES, INSIGHT_REC_SUMMARY_MAX, INSIGHT_REC_MAX_CALLS,
  INSIGHT_REC_TOOL_NAME_MAX, type InsightRecommendation, type InsightToolCall,
  type InsightRecommendationStatus,
} from "./insight";

function sanitizeRecommendation(v: unknown): InsightRecommendation | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const summary = str(o.summary, INSIGHT_REC_SUMMARY_MAX);
  if (!summary || !Array.isArray(o.proposedCalls)) return undefined;
  const calls: InsightToolCall[] = [];
  for (const raw of o.proposedCalls) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const name = str(c.name, INSIGHT_REC_TOOL_NAME_MAX);
    if (!name || !c.input || typeof c.input !== "object" || Array.isArray(c.input)) continue;
    calls.push({ name, input: c.input as Record<string, unknown> });
    if (calls.length >= INSIGHT_REC_MAX_CALLS) break;
  }
  const status = (INSIGHT_REC_STATUSES as readonly string[]).includes(o.status as string)
    ? (o.status as InsightRecommendationStatus) : "proposed";
  const appliedSummary = str(o.appliedSummary, INSIGHT_REC_SUMMARY_MAX);
  const appliedAt = str(o.appliedAt, 40);
  const generatedAt = isoOr(o.generatedAt, "");
  return {
    summary, proposedCalls: calls, status,
    generatedAt: generatedAt || "",
    ...(appliedSummary ? { appliedSummary } : {}),
    ...(appliedAt ? { appliedAt } : {}),
  };
}
```

In the built `insight` object add: `...(sanitizeRecommendation(o.recommendation) ? { recommendation: sanitizeRecommendation(o.recommendation) } : {}),` — or compute once into a local `const rec = sanitizeRecommendation(o.recommendation);` above the object and spread `...(rec ? { recommendation: rec } : {})` (preferred, one call).

- [ ] **Step 5: Run tests, verify pass + tsc/lint**

Run: `npm run test:run -- sanitize-insights && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights/insight.ts src/app/insights/sanitize-insights.ts src/app/insights/sanitize-insights.test.ts
git commit -m "feat(insights): SP2 data model — persisted InsightRecommendation + sanitizer"
```

---

### Task 2: Reconcile preserves recommendation + material-equality guard

**Files:**
- Modify: `src/app/insights/reconcile.ts`
- Test: `src/app/insights/reconcile.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

```ts
import { reconcileInsights, insightsMateriallyEqual } from "./reconcile";
import type { Insight, DetectedInsight, InsightRecommendation } from "./insight";

const REC: InsightRecommendation = {
  summary: "do X", proposedCalls: [{ name: "update_task", input: { id: 1 } }],
  generatedAt: "2026-07-19", status: "proposed",
};
function stored(over: Partial<Insight> = {}): Insight {
  return { id: 1, key: "raidAging:5", type: "raidAging", severity: "high", status: "active",
    data: {}, firstSeenAt: "2026-07-18", lastSeenAt: "2026-07-18", occurrences: 1, ...over };
}
function det(): DetectedInsight { return { key: "raidAging:5", type: "raidAging", severity: "high", data: {} }; }

test("upsert preserves a pending recommendation", () => {
  const [out] = reconcileInsights([stored({ recommendation: REC })], [det()], "2026-07-20");
  expect(out.recommendation?.summary).toBe("do X");
  expect(out.occurrences).toBe(2);
});

test("re-fire drops a stale applied recommendation", () => {
  const applied = { ...REC, status: "applied" as const, appliedAt: "2026-07-19" };
  const prev = stored({ status: "dismissed", dismissedAt: "2026-07-19", recommendation: applied });
  const [out] = reconcileInsights([prev], [det()], "2026-07-20");
  expect(out.status).toBe("active");
  expect(out.recommendation).toBeUndefined();
});

test("insightsMateriallyEqual detects a recommendation change (data-loss guard)", () => {
  const a = [stored()];
  const b = [stored({ recommendation: REC })];
  expect(insightsMateriallyEqual(a, b)).toBe(false);
});

test("insightsMateriallyEqual detects a recommendation STATUS change", () => {
  const a = [stored({ recommendation: REC })];
  const b = [stored({ recommendation: { ...REC, status: "applied" } })];
  expect(insightsMateriallyEqual(a, b)).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm run test:run -- insights/reconcile`
Expected: FAIL (recommendation not carried / not compared).

- [ ] **Step 3: Preserve on upsert, drop on re-fire**

In `upsert()`: the non-re-fire branch already spreads `...prev`, so `recommendation` is preserved automatically for that path — confirm no field list drops it. In the re-fire rebuild object (the explicit `{ id, key, … }` literal), do NOT include `recommendation` (so it is dropped on re-fire). Add a code comment: `// recommendation intentionally dropped on re-fire — a stale proposal no longer describes the now-recurring problem; regenerate.`

- [ ] **Step 4: Extend `insightsMateriallyEqual`**

Add a `recommendationEqual(a, b)` helper and include it in the per-element comparison:

```ts
function toolCallsEqual(a: readonly { name: string; input: unknown }[], b: readonly { name: string; input: unknown }[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (JSON.stringify(a[i].input) !== JSON.stringify(b[i].input)) return false;
  }
  return true;
}
function recommendationEqual(a: Insight["recommendation"], b: Insight["recommendation"]): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.summary === b.summary && a.status === b.status && a.generatedAt === b.generatedAt &&
    a.appliedAt === b.appliedAt && a.appliedSummary === b.appliedSummary &&
    toolCallsEqual(a.proposedCalls, b.proposedCalls);
}
```

Add `|| !recommendationEqual(x.recommendation, y.recommendation)` to the existing `if (…) return false;` chain.

- [ ] **Step 5: Run tests + full reconcile suite + tsc/lint**

Run: `npm run test:run -- insights/reconcile && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights/reconcile.ts src/app/insights/reconcile.test.ts
git commit -m "feat(insights): SP2 reconcile preserves recommendation; material-equality guards it"
```

---

### Task 3: Pure recommend contract + grounding + context

**Files:**
- Create: `src/app/insights/recommend.ts`
- Create: `src/app/insights/recommend-context.ts`
- Test: `src/app/insights/recommend.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { parseRecommendation, ALLOWED_REC_TOOLS, RECOMMEND_TOOL } from "./recommend";
import { buildGroundingIndex } from "../action-ai";

const index = buildGroundingIndex({
  tasks: [{ id: 12 }], raid: [{ id: 5 }], milestones: [], changes: [], stakeholders: [],
});

test("grounds a valid update_task call", () => {
  const out = parseRecommendation(
    { summary: "reschedule 12", calls: [{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }] },
    index,
  );
  expect(out?.proposedCalls).toHaveLength(1);
  expect(out?.status).toBe("proposed");
});

test("drops a call whose id is not in the workspace", () => {
  const out = parseRecommendation(
    { summary: "x", calls: [{ name: "update_task", input: { id: 999 } }] },
    index,
  );
  expect(out).toBeNull(); // nothing survived
});

test("drops a call whose tool is not in the allow-set", () => {
  const out = parseRecommendation(
    { summary: "x", calls: [{ name: "delete_all_tasks", input: {} }, { name: "update_task", input: { id: 12 } }] },
    index,
  );
  expect(out?.proposedCalls).toHaveLength(1);
  expect(out?.proposedCalls[0].name).toBe("update_task");
});

test("returns null on empty summary", () => {
  expect(parseRecommendation({ summary: "", calls: [{ name: "update_task", input: { id: 12 } }] }, index)).toBeNull();
});

test("ALLOWED_REC_TOOLS are all real chat tools", async () => {
  const { TOOL_DEFS } = await import("../chat-tool-defs");
  const names = new Set(TOOL_DEFS.map((d: { name: string }) => d.name));
  for (const t of ALLOWED_REC_TOOLS) expect(names.has(t)).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail** — `npm run test:run -- insights/recommend` → FAIL (module missing).

- [ ] **Step 3: Implement `recommend.ts`**

Curated allow-set = safe update/create tools (NO delete/settings). Ground every id argument against the live workspace.

```ts
// Pure, i18n-free. Forced-tool contract for insight recommendations + untrusted
// output validation. Constrains the model to a safe subset of the chat write
// tools and re-grounds every entity id against the live workspace, so a
// hallucinated id can never reach runTool. No React/fetch/i18n.
import type { GroundingIndex, GroundableView } from "./../action-ai";
import type { InsightRecommendation, InsightToolCall } from "./insight";
import { INSIGHT_REC_MAX_CALLS, INSIGHT_REC_SUMMARY_MAX } from "./insight";

/** Safe, non-destructive write tools an AI recommendation may propose. */
export const ALLOWED_REC_TOOLS: ReadonlySet<string> = new Set([
  "update_task", "create_task",
  "update_raid_item", "create_raid_item",
  "update_milestone", "create_milestone",
  "update_change", "create_change",
  "update_stakeholder", "create_stakeholder",
]);

// tool name → the grounding view whose id-set an UPDATE targets. create_* tools
// mint a new row (no id to ground) so they are not listed here.
const UPDATE_VIEW: Record<string, GroundableView> = {
  update_task: "open-points", update_raid_item: "raid", update_milestone: "milestones",
  update_change: "changes", update_stakeholder: "stakeholders",
};

function groundCall(name: string, input: Record<string, unknown>, index: GroundingIndex): boolean {
  const view = UPDATE_VIEW[name];
  if (!view) return true; // create_* — nothing to ground
  const id = typeof input.id === "number" ? input.id : Number(input.id);
  if (!Number.isInteger(id)) return false;
  return index[view].has(id);
}

export function parseRecommendation(input: unknown, index: GroundingIndex): InsightRecommendation | null {
  if (!input || typeof input !== "object") return null;
  const o = input as { summary?: unknown; calls?: unknown };
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, INSIGHT_REC_SUMMARY_MAX) : "";
  if (!summary || !Array.isArray(o.calls)) return null;
  const calls: InsightToolCall[] = [];
  for (const raw of o.calls) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { name?: unknown; input?: unknown };
    if (typeof c.name !== "string" || !ALLOWED_REC_TOOLS.has(c.name)) continue;
    if (!c.input || typeof c.input !== "object" || Array.isArray(c.input)) continue;
    const inputObj = c.input as Record<string, unknown>;
    if (!groundCall(c.name, inputObj, index)) continue;
    calls.push({ name: c.name, input: inputObj });
    if (calls.length >= INSIGHT_REC_MAX_CALLS) break;
  }
  if (calls.length === 0) return null;
  // generatedAt/status stamped by the caller (needs `today`); default here so the
  // pure fn stays clock-free — the call site overwrites generatedAt with `today`.
  return { summary, proposedCalls: calls, generatedAt: "", status: "proposed" };
}

/** Anthropic tool definition. Forced via tool_choice. */
export const RECOMMEND_TOOL = {
  name: "propose_insight_actions",
  description: "Propose concrete, applicable actions that resolve the given project insight. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "One line: what to do and why." },
      calls: {
        type: "array",
        description: "Concrete tool calls that fix the insight. Use only the listed tools; reference only ids present in the digest.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", enum: [...ALLOWED_REC_TOOLS] },
            input: { type: "object", description: "Arguments for the tool. For update_*, include the numeric id shown in the digest." },
          },
          required: ["name", "input"],
        },
      },
    },
    required: ["summary", "calls"],
  },
};
```

> Note: verify `action-ai.ts` exports `GroundableView` and `GroundingIndex` (it does — lines 12, 117). If `GroundableView` is not exported, export it.

- [ ] **Step 4: Implement `recommend-context.ts`**

```ts
// Pure, i18n-free. Compact per-insight digest for the recommendation call +
// the stable cacheable system prompt. Volatile digest is sent as the user
// message (never the cached prefix). Mirrors action-ai's cap discipline.
import type { Insight } from "./insight";
import { insightTitle, insightDetail } from "./insight-text"; // NB: title/detail are i18n — see step note

// The recommend context is model-facing English, so build it from the raw
// type/data, NOT the i18n renderer. Keep this module i18n-free.
export function buildRecommendSystemPrompt(): string {
  return [
    "You are a senior project manager assisting with a project tracker.",
    "You are given ONE project insight and a compact slice of the project.",
    "Call the propose_insight_actions tool exactly once with concrete, minimal actions that resolve the insight.",
    "Use only the tools offered. Reference an entity only by a numeric id shown in the digest. Prefer editing an existing item over creating a new one. Keep the summary to one line.",
  ].join(" ");
}

export interface RecommendContextInput {
  projectName: string;
  today: string;
  insightType: string;
  severity: string;
  data: Readonly<Record<string, string | number>>;
  entity?: { view: string; id: number; title: string; fields: string };
  relatedTasks: readonly { id: number; title: string }[];
}

export function buildRecommendContext(input: RecommendContextInput): string {
  const dataLines = Object.entries(input.data).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)";
  const entity = input.entity
    ? `Linked ${input.entity.view}#${input.entity.id}: ${input.entity.title}\n${input.entity.fields}`
    : "(no linked entity)";
  const tasks = input.relatedTasks.length
    ? input.relatedTasks.slice(0, 30).map((t) => `- open-points#${t.id}: ${t.title.slice(0, 120)}`).join("\n")
    : "(none)";
  return [
    `Project: ${input.projectName}. Today: ${input.today}.`,
    `Insight: ${input.insightType} (severity ${input.severity}).`,
    "## Insight data", dataLines,
    "## Linked entity", entity,
    "## Related open tasks (reference by id)", tasks,
  ].join("\n");
}
```

> Remove the unused `insight-text` import from the final file — the context builder must NOT pull i18n. The `Insight` import may be dropped too if unused (lint is fatal on unused imports).

- [ ] **Step 5: Run tests + tsc/lint** — `npm run test:run -- insights/recommend && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights/recommend.ts src/app/insights/recommend-context.ts src/app/insights/recommend.test.ts src/app/action-ai.ts
git commit -m "feat(insights): SP2 recommend contract, grounding, and context builder"
```

---

### Task 4: The forced-tool call

**Files:**
- Create: `src/app/insights/recommend-call.ts`
- Test: `src/app/insights/recommend-call.test.ts`

- [ ] **Step 1: Write failing test** (mirror `task-dedup-call` test if one exists; mock `runForcedToolCall`).

```ts
import { vi, test, expect } from "vitest";
import { runInsightRecommendation } from "./recommend-call";
import { buildGroundingIndex } from "../action-ai";

vi.mock("../ai-forced-call", () => ({
  runForcedToolCall: vi.fn(async () => ({
    summary: "reschedule 12", calls: [{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }],
  })),
}));

test("returns a grounded recommendation stamped with today", async () => {
  const index = buildGroundingIndex({ tasks: [{ id: 12 }], raid: [], milestones: [], changes: [], stakeholders: [] });
  const out = await runInsightRecommendation({
    apiKey: "sk-ant-x", model: "claude-x", context: "ctx", index, today: "2026-07-20",
  });
  expect(out?.generatedAt).toBe("2026-07-20");
  expect(out?.proposedCalls).toHaveLength(1);
});

test("throws parse when nothing grounds", async () => {
  const mod = await import("../ai-forced-call");
  (mod.runForcedToolCall as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ summary: "x", calls: [{ name: "update_task", input: { id: 777 } }] });
  const index = buildGroundingIndex({ tasks: [], raid: [], milestones: [], changes: [], stakeholders: [] });
  await expect(runInsightRecommendation({ apiKey: "k", model: "m", context: "c", index, today: "2026-07-20" }))
    .rejects.toThrow("parse");
});
```

- [ ] **Step 2: Run, verify fail** — module missing.

- [ ] **Step 3: Implement `recommend-call.ts`** (mirror `task-dedup-call.ts` exactly):

```ts
// Non-hook single forced-tool Anthropic call for insight recommendations.
// Mirrors task-dedup-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Grounding happens in parseRecommendation; the api key/body are NEVER logged
// (the shared runForcedToolCall envelope guarantees it).
import { runForcedToolCall } from "../ai-forced-call";
import { RECOMMEND_TOOL, parseRecommendation, buildRecommendSystemPrompt } from "./recommend";
import type { GroundingIndex } from "../action-ai";
import type { InsightRecommendation } from "./insight";

export interface RecommendCallArgs {
  apiKey: string;
  model: string;
  context: string;
  index: GroundingIndex;
  today: string;
  signal?: AbortSignal;
}

export async function runInsightRecommendation(args: RecommendCallArgs): Promise<InsightRecommendation | null> {
  const input = await runForcedToolCall({
    apiKey: args.apiKey,
    model: args.model,
    system: buildRecommendSystemPrompt(),
    tools: [RECOMMEND_TOOL],
    toolName: RECOMMEND_TOOL.name,
    messages: [{ role: "user", content: args.context }],
    maxTokens: 2048,
    signal: args.signal,
  });
  const parsed = parseRecommendation(input, args.index);
  if (!parsed) throw new Error("parse");
  return { ...parsed, generatedAt: args.today };
}
```

> Import `buildRecommendSystemPrompt` from `./recommend` — MOVE that export from `recommend-context.ts` into `recommend.ts` if cleaner, or import from `recommend-context`. Keep one source; update the Task 3 file accordingly and the test import.

- [ ] **Step 4: Run + tsc/lint** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/recommend-call.ts src/app/insights/recommend-call.test.ts
git commit -m "feat(insights): SP2 forced-tool recommendation call (never-log envelope)"
```

---

### Task 5: Recommendation plan-preview builder

**Files:**
- Create: `src/app/insights/recommend-plan.ts`
- Test: `src/app/insights/recommend-plan.test.ts`

Reuses the inline-ai-edit descriptor engine, but grounds each call by ITS OWN target id (not a fixed "opened row") so a multi-entity recommendation previews correctly.

- [ ] **Step 1: Write failing test**

```ts
import { describeRecommendationPlan } from "./recommend-plan";
import type { Workspace } from "../workspace";

function ws(over: Partial<Workspace> = {}): Workspace {
  return { tasks: [{ id: 12, taskName: "T", dueDate: "2026-07-01" }], raid: [], changes: [],
    milestones: [], stakeholders: [] } as unknown as Workspace;
}

test("previews an update_task field diff", () => {
  const plan = describeRecommendationPlan(
    [{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }],
    ws(),
  );
  expect(plan.updates.some((u) => u.field === "dueDate" && u.after === "2026-08-01")).toBe(true);
});

test("rejects an update whose id is gone", () => {
  const plan = describeRecommendationPlan([{ name: "update_task", input: { id: 999 } }], ws());
  expect(plan.rejected.length).toBe(1);
});

test("previews a create as a new item", () => {
  const plan = describeRecommendationPlan([{ name: "create_task", input: { taskName: "New" } }], ws());
  expect(plan.creates).toHaveLength(1);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `recommend-plan.ts`** — loop calls, dispatch per tool via `describeEntityCalls` with the target row as `item`:

```ts
// Pure, i18n-free. Build an EditPlan preview for a persisted insight
// recommendation, grounding each update against the call's OWN target id (a
// recommendation may touch several entities and is not bound to one opened
// row). Reuses the inline-ai-edit descriptor engine + preview shape so the
// existing preview list renders it.
import type { Workspace } from "../workspace";
import { describeEntityCalls, type EditPlan, type ToolUseLike } from "../inline-ai-edit/plan";
import { INLINE_DESCRIPTORS } from "../inline-ai-edit/entity-descriptor";
import type { InsightToolCall } from "./insight";

// tool name → the inline descriptor key whose row an update_* call targets.
const UPDATE_DESCRIPTOR: Record<string, keyof typeof INLINE_DESCRIPTORS> = {
  update_task: "task", update_raid_item: "raid", update_milestone: "milestone",
  update_change: "change", update_stakeholder: "stakeholder",
};

function emptyPlan(): EditPlan { return { updates: [], creates: [], deletes: [], rejected: [] }; }

export function describeRecommendationPlan(calls: readonly InsightToolCall[], ws: Workspace): EditPlan {
  const merged = emptyPlan();
  for (const call of calls) {
    const block: ToolUseLike = { type: "tool_use", name: call.name, input: call.input };
    const descKey = UPDATE_DESCRIPTOR[call.name];
    if (descKey) {
      // Update: find the target row by the call's own id; describeEntityCalls
      // diffs against item.id, so pass the found row (or a sentinel that forces
      // an unknown-id rejection when absent).
      const d = INLINE_DESCRIPTORS[descKey];
      const rows = ws[d.wsKey] as ReadonlyArray<{ id: number }>;
      const id = Number((call.input as { id?: unknown }).id);
      const item = rows.find((r) => r.id === id) ?? ({ id: NaN } as { id: number });
      const p = describeEntityCalls([block], { descriptor: d, item: item as never, ws });
      merged.updates.push(...p.updates);
      merged.creates.push(...p.creates);
      merged.deletes.push(...p.deletes);
      merged.rejected.push(...p.rejected);
    } else {
      // create_* (and any non-update): use the task descriptor so create/delete
      // routing runs; its own-item guards don't apply to creates.
      const p = describeEntityCalls([block], { descriptor: INLINE_DESCRIPTORS.task, item: { id: NaN } as never, ws });
      merged.creates.push(...p.creates);
      merged.deletes.push(...p.deletes);
      merged.rejected.push(...p.rejected);
    }
  }
  return merged;
}
```

> Verify `INLINE_DESCRIPTORS` exports the keys `task`/`raid`/`milestone`/`change`/`stakeholder` and each descriptor exposes `wsKey` (per `plan.ts` usage). Adjust key names to match `entity-descriptor.ts` exactly. If a create_* passed through the task descriptor mis-routes, gate creates by the `CREATE_TOOLS` map — read `entity-descriptor.ts` first and mirror its contract.

- [ ] **Step 4: Run + tsc/lint** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/recommend-plan.ts src/app/insights/recommend-plan.test.ts
git commit -m "feat(insights): SP2 recommendation plan-preview builder (reuses inline-ai-edit engine)"
```

---

### Task 6: `overdueTrend` fires — thread priorOverdueCount

**Files:**
- Modify: `src/app/task-manager.tsx` (the `buildInsightInput` useCallback, ~L740)
- Test: `src/app/insights/detect.test.ts` (add an overdueTrend live case if not present) + a task-manager characterization check is optional.

- [ ] **Step 1: Write/confirm the detector test fires with a prior count**

In `detect.test.ts`, add (or confirm) a case: given `priorOverdueCount: 2` and 5 currently-overdue tasks, `detectInsights` yields an `overdueTrend` insight; given `priorOverdueCount: null`, it yields none. (Read `detect.ts` `overdueTrend` to match its exact threshold/shape.)

- [ ] **Step 2: Run, verify current behavior** (null → no insight already holds; the rising case is the new assertion).

- [ ] **Step 3: Thread the prior count in task-manager**

Read the per-project `landing-state` metrics for the CURRENT project and pass it. Resolve the project id EXACTLY as workspace-section keys its landing-state write (per AGENTS.md #6A landmine: turso mode uses `tursoProjectId`, else `registry.currentProjectId ?? "default"`). Add near the top of the insights section:

```ts
import { loadLandingState } from "./landing-state";
// … inside the component, before buildInsightInput:
const landingProjectId = portfolioMode === "turso" ? (tursoProjectId ?? "default") : (currentProjectId ?? "default");
const priorOverdueCount = useMemo(
  () => loadLandingState(landingProjectId).metrics?.overdue ?? null,
  [landingProjectId, /* recompute when the overdue snapshot may have advanced */ activityLog.length],
);
```

Change `buildInsightInput`'s `priorOverdueCount: null` → `priorOverdueCount` and add it to the `useCallback` dep array. Update the stale SP1 comment (remove "null in SP1 … acceptable").

> VERIFY the key matches workspace-section's landing-state write key (open `workspace-section.tsx`, find `saveLandingState`/`use-landing-delta` `projectId`). If it differs, use that exact derivation — a mismatch means reading a different project's snapshot (silent wrong-trend).

- [ ] **Step 4: Run detect suite + tsc/lint + the task-manager characterization test** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx src/app/insights/detect.test.ts
git commit -m "feat(insights): SP2 thread priorOverdueCount so overdueTrend fires"
```

---

### Task 7: AiConfig flag + Settings toggle

**Files:**
- Modify: `src/app/settings-types.ts` (`AiConfig` + `sanitizeAiConfig`)
- Modify: `src/app/settings-sections/ai-section.tsx` (toggle, mirroring `scheduledJobs`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (label + description)
- Test: `src/app/settings-types.test.ts` (or wherever `sanitizeAiConfig` is tested)

- [ ] **Step 1: Failing test** — `sanitizeAiConfig({ insightRecommendations: true }).insightRecommendations === true`; absent → `undefined`/falsey; `"yes"` → falsey.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add the field** — in `AiConfig`: `insightRecommendations?: boolean; // Background insight recommendations (SP2). Default OFF (opt-in) — recurring billed calls.` In `sanitizeAiConfig`: `insightRecommendations: obj.insightRecommendations === true,`.

- [ ] **Step 4: Settings toggle** — in `ai-section.tsx`, add a checkbox mirroring the `scheduledJobs` toggle (same disclaimer/enable path); label `aiInsightRecommendations`, description key `aiInsightRecommendationsDesc`. Fires the integration-disclaimer path on first enable (reuse the existing wiring). i18n EN + DE (DE via node utf8 write).

- [ ] **Step 5: Run + tsc/lint + i18n parity (`npx tsc --noEmit` enforces EN/DE key parity)** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-sections/ai-section.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-types.test.ts
git commit -m "feat(insights): SP2 opt-in ai.insightRecommendations setting + Settings toggle"
```

---

### Task 8: On-demand generate hook + background runner

**Files:**
- Create: `src/app/use-insight-recommend.ts` (on-demand generate)
- Create: `src/app/use-insight-recommend-runner.ts` (background)
- Test: `src/app/use-insight-recommend-runner.test.ts`

- [ ] **Step 1: Failing runner test** (mirror any `use-scheduled-job-runner` test): gated OFF by default → never calls generate; enabled → generates only for insights lacking a fresh rec; capped at `MAX_BG_RECS_PER_TICK`; a throw advances (fail-once, next tick still runs). Use fake timers + a mocked generate fn.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `use-insight-recommend-runner.ts`** — mirror `use-scheduled-job-runner.ts` (refs for stable tick, `[]`-dep effect, mount + `visibilitychange` + interval, overlap guard). Args:

```ts
export interface InsightRecommendRunnerArgs {
  enabled: boolean;                       // isAiEnabled && ai.insightRecommendations && !isPopout
  insights: readonly Insight[];
  ai: { apiKey: string; model: string };
  today: string;
  buildIndex: () => GroundingIndex;       // closes over live workspace
  buildContextFor: (insight: Insight) => string;
  applyRecommendation: (id: number, rec: InsightRecommendation) => void; // functional setInsights writer
  now?: () => Date;
}
```

Tick: for each active/acknowledged insight with no `recommendation` (or a stale one), up to `MAX_BG_RECS_PER_TICK`, SERIALLY `await runInsightRecommendation({...ai, context: buildContextFor(i), index: buildIndex(), today})`; on success `applyRecommendation(i.id, rec)`; on throw, swallow (log nothing sensitive) and continue — but mark the insight attempted for this tick so it isn't retried immediately (a simple in-tick `Set` of attempted ids; the overlap guard + interval give the fail-once cadence). NEVER log key/body. Skip when `!enabled`.

- [ ] **Step 4: Implement `use-insight-recommend.ts`** (on-demand) — a small state machine `{ busyId: number | null, error: string | null, generate: (id) => Promise<void> }`. `generate(id)` finds the insight, builds context+index, awaits `runInsightRecommendation`, calls the injected `applyRecommendation(id, rec)`; classifies errors via `classifyAiError` for the usage-limit notice. Popout guard. This is render-scope glue — if it stays a `.ts` with logic, keep it unit-tested; if it becomes trivial glue, add to `vitest.config.ts` `coverage.exclude` per the AGENTS.md convention.

- [ ] **Step 5: Run runner test + tsc/lint** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-insight-recommend.ts src/app/use-insight-recommend-runner.ts src/app/use-insight-recommend-runner.test.ts
git commit -m "feat(insights): SP2 on-demand generate hook + opt-in background runner"
```

---

### Task 9: task-manager wiring (handlers, runner mount, review modal, threading)

**Files:**
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/workspace-section-types.ts` (extend the insight-actions bag / add generate-apply-reject)
- Modify: `src/app/workspace-section.tsx` (thread through)
- Create: `src/app/insights/recommendation-review-modal.tsx` (the apply preview modal)
- Modify: `src/app/dashboard-panel.tsx` if the InsightActions bag is assembled there
- Test: `src/app/insights/recommendation-review-modal.test.tsx`; extend the task-manager characterization test for the new prop contract.

- [ ] **Step 1: Failing modal test** — renders the EditPlan preview (updates/creates), Confirm calls `onConfirm`, Cancel calls `onCancel`, empty plan disables Confirm (reuse `isEmptyPlan`).

- [ ] **Step 2: Implement `recommendation-review-modal.tsx`** — a `Modal`/`EditModalShell`-based dialog showing the summary + the `EditPlan` preview list (reuse the markup pattern from `inline-ai-edit-popover.tsx` lines 81-96) with Confirm/Cancel. Props: `{ lang, summary, plan: EditPlan, onConfirm, onCancel }`. Row-unique labels; primitives only.

- [ ] **Step 3: task-manager handlers** — add:
  - `onGenerateRecommendation(id)` → `use-insight-recommend`'s `generate` writing via functional `setInsights(prev => prev.map(i => i.id===id ? {...i, recommendation: rec} : i))`.
  - `onApplyRecommendation(id)` → open the review modal for that insight's `recommendation`; on Confirm, replay each `proposedCalls` through the chat `runTool` dispatcher (reuse the same dispatcher `use-tasks-inline-ai-edit`/chat uses — build the `ToolDispatcher` once), each via functional setters; then set `recommendation.status="applied"` + `appliedAt: today` + `appliedSummary` (derive from the applied plan), advance the insight via the existing `onAct` path (deep-link + `logActivity`), and record ONE undo entry. Log `ai.inlineEdit`-style new activity kind `ai.insightRecommendation`.
  - `onRejectRecommendation(id)` → functional `setInsights` set `recommendation.status="rejected"`.
  - All gated `isAiEnabled(settings.ai) && !isPopout`; popout → undefined.
- [ ] **Step 4: Mount the background runner** — `useInsightRecommendRunner({ enabled: isAiEnabled(settings.ai) && settings.ai.insightRecommendations === true && !isPopout, insights: insights ?? [], ai: { apiKey, model }, today, buildIndex, buildContextFor, applyRecommendation })`. `buildIndex` = `buildGroundingIndex({tasks,raid,milestones,changes,stakeholders})`; `buildContextFor(insight)` assembles `buildRecommendContext(...)` from live entities.
- [ ] **Step 5: Extend the InsightActions bag + thread** — add the three methods to the bag built in task-manager and threaded through `WorkspaceSectionProps` → `workspace-section` → `InsightsCard`/`InsightsPanel` (same chain SP1 established). Mount the review modal in the shared non-popout modal block (like SP1 handlers live above the view).
- [ ] **Step 6: Run** `npx tsc --noEmit && npm run lint && npm run test:run -- task-manager.characterization recommendation-review-modal` — PASS. Watch the task-manager size ratchet.
- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(insights): SP2 task-manager wiring — generate/apply/reject + review modal + runner mount"
```

---

### Task 10: Card + panel UI + i18n

**Files:**
- Modify: `src/app/dashboard-sections/insights-card.tsx`
- Modify: `src/app/insights-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: extend `insights-card`/`insights-panel` tests; live axe.

- [ ] **Step 1: Failing UI tests** — with a `proposed` recommendation, the row shows `AI suggests: <summary>` + a Review button (calls `onApplyRecommendation`) + Reject (calls `onRejectRecommendation`); with no rec + AI enabled, shows a Recommend button (calls `onGenerateRecommendation`); popout → none of these.

- [ ] **Step 2: Implement the UI** in both surfaces — per the spec's priority order (proposed → Review/Reject; applied/rejected → muted note; none + AI on → `✨ Recommend fix`). Reuse `Button variant="ghost" size="xs"`, row-unique `aria-label`s, severity on `RagDot`. Gate on new props `aiEnabled`/`isPopout`. Busy state from the generate hook (a per-id busy flag threaded, or a simple `generatingId` prop).

- [ ] **Step 3: i18n keys** (EN + DE via node utf8 write): `insightRecommendCta`, `insightRecommendReview`, `insightRecommendReject`, `insightRecommendSuggests` (`AI suggests: {0}`), `insightRecommendApplied`, `insightRecommendRejected`, `insightRecommendGenerating`, `insightRecommendNoAction`, `aiInsightRecommendations`, `aiInsightRecommendationsDesc`.

- [ ] **Step 4: Verify** `npx tsc --noEmit && npm run lint && npm run test:run` (full unit suite) — PASS.

- [ ] **Step 5: Live axe** — after markup lands, run on the two axe-scanned surfaces on a FRESH isolated server:
```bash
PORT=3100 npm run dev &   # then, once up:
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"
PORT=3100 npm run stop
```
Expected: pass (labeled controls, palette-safe, severity on non-text dot).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(insights): SP2 recommendation UI on dashboard card + insights view + i18n"
```

---

### Task 11: Release

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `AGENTS.md`, `docs/baselines/file-sizes.json` (if needed).

- [ ] **Step 1: Codename** — `grep -i "^## " CHANGELOG.md | head` to confirm the current milestone block; keep the "Pinsker" milestone (per `milestone-codename-unique`). Bump `APP_VERSION` (e.g. `0.190.45`).
- [ ] **Step 2: Highlight** — add `versionHighlightInsightsRecommend` to `APP_HIGHLIGHT_KEYS` + EN/DE strings.
- [ ] **Step 3: CHANGELOG** — new entry describing SP2.
- [ ] **Step 4: AGENTS.md** — extend the `### Insights → action loop` section with the SP2 bullets (recommendation field, two triggers, opt-in flag, apply-via-runTool, overdueTrend now live, SP3/SP4 remaining).
- [ ] **Step 5: Full verification**
```bash
npx tsc --noEmit && npm run lint && npm run test:run && npm run dup:check
node scripts/check-file-sizes.mjs   # if a file grew, run --update and commit the baseline
```
- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "chore(release): 0.190.45 — Insights SP2 proactive AI recommendations"
```

---

### Final: whole-branch review + release chain (ONLY on explicit user say-so)

- [ ] Dispatch a final `superpowers:requesting-code-review` over the full branch diff (`git rev-parse main`..HEAD). Fix Critical/Important.
- [ ] STOP. Do NOT push/MR/merge until the user says "release" (per `mr-only-on-explicit-say`). On "release": push via HTTPS, open the MR (0.190.45), poll the pipeline, merge-on-green (squash).

## Self-review notes (plan author)

- **Spec coverage:** data model (T1), reconcile+equality guard (T2), recommend contract/ground/context (T3), forced call (T4), plan preview (T5), overdueTrend thread (T6), setting (T7), both triggers (T8), wiring+apply+modal (T9), UI+i18n (T10), release (T11). All spec sections mapped.
- **Type consistency:** `InsightRecommendation`/`InsightToolCall` defined once (T1), consumed by sanitize (T1), reconcile (T2), recommend (T3), call (T4), plan (T5), runner/hook (T8), UI (T10). `GroundingIndex`/`GroundableView`/`buildGroundingIndex` reused from `action-ai.ts`. `EditPlan`/`describeEntityCalls`/`INLINE_DESCRIPTORS` reused from inline-ai-edit.
- **Open verifications flagged inline** (implementer must confirm, not guess): `entity-descriptor.ts` exact descriptor keys + `wsKey`; `action-ai.ts` `GroundableView` export; workspace-section's landing-state project-id key (must match T6's read); the chat `runTool` dispatcher assembly for apply (T9).
- **Landmines carried from spec:** `insightsMateriallyEqual` MUST compare the recommendation (data-loss) — pinned by a T2 test; background proposals re-grounded + re-diffed at APPLY time (T5/T9), never at generate time; opt-in flag default OFF; never log key/body.
