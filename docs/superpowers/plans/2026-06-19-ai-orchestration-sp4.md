# AI Orchestration SP4 — Action Center AI suggestions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual "Analyze with AI" action to the Action Center that calls Claude once and renders a triage summary plus net-new, grounded, advisory suggestions above the existing rule-based tiers.

**Architecture:** Pure i18n-free contract module (`action-ai.ts`) + one-shot forced-tool hook (`use-action-analysis.ts`, mirroring SP3's `use-project-proposal.ts`) + a presentational row (`ai-action-row.tsx`) wired into `actions-panel.tsx` via an `aiAnalysis` bundle threaded from `task-manager.tsx` through `workspace-section.tsx`. The deterministic `next-actions/` engine is untouched; AI is additive in the surface only. Result lives in the hook (mounted in `task-manager.tsx`) so it survives view remounts. No new persisted `Workspace` field, no Turso table, no new CSP host.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript, vitest, Anthropic Messages API (browser direct, forced tool call), Tailwind + AIPM brand tokens.

---

## Reference facts (verified against the codebase)

- SP3 templates to copy: `src/app/ai-project-proposal.ts` (pure contract + `PROPOSAL_TOOL` shape) and `src/app/use-project-proposal.ts` (one-shot hook: `tool_choice:{type:"tool",name:…}`, `ANTHROPIC_VERSION = "2023-06-01"`, headers incl. `anthropic-dangerous-direct-browser-access`, status-only error).
- AI creds: `settings.ai?.apiKey` (string) and `settings.ai?.model ?? "claude-sonnet-4-6"`.
- Deep-linkable views + numeric ids the surface can open (from `next-actions/providers/*`): `"open-points"` (tasks), `"raid"`, `"milestones"`, `"changes"`, `"stakeholders"`. `requestOpen(view, Number(id))`.
- `task-manager.tsx`: `useWorkspaceTab()` (line ~165) gives `requestOpen` and `requestChat`; `nextActions` (`SuggestedAction[]`) at ~670; `tasks/raid/changes/milestones/stakeholders/today/project` all in scope; `openAction` (~740) wraps `requestOpen`; `workspaceProps` built ~1615 → `<WorkspaceSection {...workspaceProps}>`.
- `workspace-section.tsx`: `ActionsPanel` rendered at ~919 (`<ActionsPanel lang … actions={nextActions} onOpen={onOpenAction} … />`); `WorkspaceSectionProps` already carries `settings`, `nextActions`, `onOpenAction`.
- i18n: `i18n.ts` (EN) + `i18n.de.ts` (DE). `t(lang, key, …)` with 0-based `{0}`. DE file is **CRLF**; **edit via node UTF-8 write** (Edit tool corrupts umlauts + curls quotes). `tsc` enforces EN/DE key parity. `Lang = "en-US" | "en-GB" | "de"`; component tests use `"en-US"`; DE dict is lazy (`loadI18n("de")` in `beforeAll`).
- CI gates: `npm run lint` (`--max-warnings=0` — unused import/var fatal), `npx tsc --noEmit` (typechecks tests too — run after editing any test), `npm run test:run` (vitest), `npm run build`. Action Center is **not** in the axe 12-view list.

## File structure

- **Create** `src/app/action-ai.ts` — pure contract: types, `ANALYZE_TOOL`, `parseAnalysis`, `buildAnalysisContext`, `buildAnalysisSystemPrompt`, `GroundingIndex`, `buildGroundingIndex`, `groundEntity`.
- **Create** `src/app/action-ai.test.ts` — pure-module tests.
- **Create** `src/app/use-action-analysis.ts` — one-shot forced-tool hook.
- **Create** `src/app/use-action-analysis.test.tsx` — hook tests.
- **Create** `src/app/ai-action-row.tsx` — presentational AI suggestion row.
- **Modify** `src/app/actions-panel.tsx` — header button + AI section + `aiAnalysis` prop.
- **Modify** `src/app/actions-panel.test.tsx` — button/section/CTA tests.
- **Modify** `src/app/workspace-section.tsx` — thread `aiAnalysis` to `ActionsPanel`.
- **Modify** `src/app/task-manager.tsx` — instantiate hook, build context + grounding index, wire `onAnalyze`/`onOpenAiAction`, add to `workspaceProps`.
- **Modify** `src/app/settings-sections/ai-section.tsx` (+ its test) — `ai.actionSuggestions` toggle.
- **Modify** `src/app/settings.ts` (or wherever the `ai` settings type lives) — optional `actionSuggestions?: boolean`.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- **Modify** `src/app/version.ts`, `CHANGELOG.md` — release.

---

### Task 1: Pure contract — types, tool def, `parseAnalysis`

**Files:**
- Create: `src/app/action-ai.ts`
- Test: `src/app/action-ai.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/action-ai.test.ts
import { describe, it, expect } from "vitest";
import { parseAnalysis } from "./action-ai";

describe("parseAnalysis", () => {
  it("parses a valid analysis", () => {
    const out = parseAnalysis({
      summary: "Focus on the two overdue risks first.",
      actions: [
        { title: "Unblock milestone M2", why: "Tasks 4 and 7 block it.", severity: "now", entity: { view: "milestones", id: "2" } },
        { title: "Review stale risks", why: "Three risks untouched 30d.", severity: "soon" },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.summary).toContain("overdue");
    expect(out!.actions).toHaveLength(2);
    expect(out!.actions[0].entity).toEqual({ view: "milestones", id: "2" });
    expect(out!.actions[1].entity).toBeUndefined();
  });

  it("returns null when summary missing or actions not an array", () => {
    expect(parseAnalysis({ actions: [] })).toBeNull();
    expect(parseAnalysis({ summary: "x", actions: "nope" })).toBeNull();
    expect(parseAnalysis(null)).toBeNull();
  });

  it("clamps unknown severity to 'soon' and drops entries without title/why", () => {
    const out = parseAnalysis({
      summary: "s",
      actions: [
        { title: "Keep", why: "reason", severity: "whenever" },
        { title: "", why: "no title" },
        { title: "No why", why: "" },
      ],
    });
    expect(out!.actions).toHaveLength(1);
    expect(out!.actions[0].severity).toBe("soon");
  });

  it("drops a malformed entity and caps the actions array at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, why: "w", severity: "monitor" }));
    const out = parseAnalysis({
      summary: "s",
      actions: [{ title: "bad-entity", why: "w", severity: "now", entity: { view: 5, id: {} } }, ...many],
    });
    expect(out!.actions.length).toBeLessThanOrEqual(8);
    expect(out!.actions[0].entity).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- action-ai`
Expected: FAIL — `parseAnalysis` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/action-ai.ts
// Pure, i18n-free contract for the Action Center "Analyze with AI" feature.
// Defines the analysis shape Claude returns (via a forced tool call) plus the
// transforms that build its context and ground its entity refs. No React, no
// fetch, no i18n.
import type { AppView } from "./nav-config";

export type AiActionSeverity = "now" | "soon" | "monitor";
const SEVERITIES: ReadonlySet<string> = new Set<AiActionSeverity>(["now", "soon", "monitor"]);

/** Views an AI action may deep-link to (entities we ground against real ids). */
export const GROUNDABLE_VIEWS = ["open-points", "raid", "milestones", "changes", "stakeholders"] as const;
export type GroundableView = (typeof GROUNDABLE_VIEWS)[number];
const GROUNDABLE_SET: ReadonlySet<string> = new Set(GROUNDABLE_VIEWS);

export const MAX_AI_ACTIONS = 8;

export interface AiAction {
  title: string;
  why: string;
  severity: AiActionSeverity;
  entity?: { view: GroundableView; id: string };
}

export interface ActionAnalysis {
  summary: string;
  actions: AiAction[];
}

function asEntity(raw: unknown): { view: GroundableView; id: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { view?: unknown; id?: unknown };
  if (typeof r.view !== "string" || !GROUNDABLE_SET.has(r.view)) return undefined;
  if (typeof r.id !== "string" && typeof r.id !== "number") return undefined;
  return { view: r.view as GroundableView, id: String(r.id) };
}

/** Validate + clamp the model's tool input. Returns null only when the overall
 *  shape is unusable; individual malformed actions are dropped, not fatal. */
export function parseAnalysis(input: unknown): ActionAnalysis | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { summary?: unknown; actions?: unknown };
  if (typeof obj.summary !== "string" || !Array.isArray(obj.actions)) return null;
  const actions: AiAction[] = [];
  for (const raw of obj.actions) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as { title?: unknown; why?: unknown; severity?: unknown; entity?: unknown };
    const title = typeof a.title === "string" ? a.title.trim() : "";
    const why = typeof a.why === "string" ? a.why.trim() : "";
    if (!title || !why) continue;
    const severity = (typeof a.severity === "string" && SEVERITIES.has(a.severity) ? a.severity : "soon") as AiActionSeverity;
    actions.push({ title, why, severity, entity: asEntity(a.entity) });
    if (actions.length >= MAX_AI_ACTIONS) break;
  }
  return { summary: obj.summary.trim(), actions };
}

// AppView re-exported for surface convenience (groundEntity narrows to it).
export type { AppView };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- action-ai`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/action-ai.ts src/app/action-ai.test.ts
git commit -m "feat: action-ai pure contract + parseAnalysis (SP4)"
```

---

### Task 2: Pure contract — `buildAnalysisContext` + `buildAnalysisSystemPrompt`

**Files:**
- Modify: `src/app/action-ai.ts`
- Test: `src/app/action-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append to `action-ai.test.ts`)

```ts
import { buildAnalysisContext, buildAnalysisSystemPrompt, CONTEXT_CAP_PER_CATEGORY } from "./action-ai";

describe("buildAnalysisContext", () => {
  const base = {
    projectName: "Apollo", today: "2026-06-19", mode: "advanced", enabledModules: ["raid", "milestones"],
    taskCount: 3,
    tasks: [{ id: 7, title: "Wire auth" }],
    raid: [{ id: 1, title: "Vendor risk" }],
    milestones: [{ id: 2, title: "Beta" }],
    changes: [{ id: 9, title: "Scope add" }],
    stakeholders: [{ id: 3, name: "Acme" }],
    queue: [{ title: "Risk R1 needs owner", why: "no owner", tier: "now" as const }],
  };

  it("includes project name, real ids, the queue, and a view tag per entity", () => {
    const txt = buildAnalysisContext(base);
    expect(txt).toContain("Apollo");
    expect(txt).toContain("open-points#7");
    expect(txt).toContain("raid#1");
    expect(txt).toContain("milestones#2");
    expect(txt).toContain("changes#9");
    expect(txt).toContain("stakeholders#3");
    expect(txt).toContain("Risk R1 needs owner");
  });

  it("caps each category and notes truncation", () => {
    const many = Array.from({ length: CONTEXT_CAP_PER_CATEGORY + 5 }, (_, i) => ({ id: i + 1, title: `T${i}` }));
    const txt = buildAnalysisContext({ ...base, tasks: many });
    const matches = txt.match(/open-points#/g) ?? [];
    expect(matches.length).toBe(CONTEXT_CAP_PER_CATEGORY);
    expect(txt.toLowerCase()).toContain("truncated");
  });
});

describe("buildAnalysisSystemPrompt", () => {
  it("frames Claude as a PM advisor and is stable (cacheable prefix)", () => {
    const p = buildAnalysisSystemPrompt();
    expect(p).toBe(buildAnalysisSystemPrompt());
    expect(p.toLowerCase()).toContain("project manager");
    expect(p).toContain("report_analysis");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- action-ai`
Expected: FAIL — `buildAnalysisContext`/`buildAnalysisSystemPrompt`/`CONTEXT_CAP_PER_CATEGORY` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `action-ai.ts`)

```ts
export const CONTEXT_CAP_PER_CATEGORY = 30;

export interface AnalysisContextInput {
  projectName: string;
  today: string;
  mode: string;
  enabledModules: readonly string[];
  taskCount: number;
  tasks: readonly { id: number; title: string }[];
  raid: readonly { id: number; title: string }[];
  milestones: readonly { id: number; title: string }[];
  changes: readonly { id: number; title: string }[];
  stakeholders: readonly { id: number; name: string }[];
  queue: readonly { title: string; why: string; tier: "now" | "soon" | "monitor" }[];
}

function capList(view: GroundableView, rows: readonly { id: number; title?: string; name?: string }[]): string {
  const shown = rows.slice(0, CONTEXT_CAP_PER_CATEGORY);
  const lines = shown.map((r) => `- ${view}#${r.id}: ${(r.title ?? r.name ?? "").slice(0, 120)}`);
  if (rows.length > CONTEXT_CAP_PER_CATEGORY) lines.push(`- …(${rows.length - CONTEXT_CAP_PER_CATEGORY} more truncated)`);
  return lines.join("\n");
}

/** Compact, token-bounded workspace digest + the current deterministic queue.
 *  Volatile data — sent as the user message, never in the cached system block. */
export function buildAnalysisContext(input: AnalysisContextInput): string {
  const queue = input.queue.length
    ? input.queue.map((q) => `- [${q.tier}] ${q.title} — ${q.why}`).join("\n")
    : "(none)";
  return [
    `Project: ${input.projectName}. Today: ${input.today}. Mode: ${input.mode}.`,
    `Enabled modules: ${input.enabledModules.join(", ") || "(none)"}. Open task count: ${input.taskCount}.`,
    `Entities are listed as "view#id: title"; reference an entity only by an id shown here. Lists are capped at ${CONTEXT_CAP_PER_CATEGORY} per category.`,
    "",
    "## Open tasks", capList("open-points", input.tasks),
    "## Active RAID", capList("raid", input.raid),
    "## Upcoming milestones", capList("milestones", input.milestones),
    "## Pending changes", capList("changes", input.changes),
    "## Stakeholders", capList("stakeholders", input.stakeholders),
    "",
    "## Current rule-based action queue", queue,
  ].join("\n");
}

/** Stable, cacheable system prompt. Senior-PM framing consistent with SP0. */
export function buildAnalysisSystemPrompt(): string {
  return [
    "You are a senior project manager assisting with a project tracker.",
    "You are given a digest of the project's open work and the queue of actions the app's rules already surfaced.",
    "Call the report_analysis tool exactly once. In `summary`, briefly triage what the user should focus on now, reasoning over the existing queue (do not just repeat it).",
    "In `actions`, propose only NET-NEW, cross-cutting suggestions the rules cannot derive (root-cause links, sequencing, risks spanning entities). Do not duplicate the existing queue.",
    "Set an action's `entity` only to a view#id pair that appears in the digest; omit `entity` if you cannot ground it. Keep every title and why short (one line each).",
  ].join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- action-ai`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-ai.ts src/app/action-ai.test.ts
git commit -m "feat: action-ai context digest + system prompt (SP4)"
```

---

### Task 3: Pure contract — `GroundingIndex` + `groundEntity`

**Files:**
- Modify: `src/app/action-ai.ts`
- Test: `src/app/action-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { buildGroundingIndex, groundEntity } from "./action-ai";

describe("groundEntity", () => {
  const index = buildGroundingIndex({
    tasks: [{ id: 7 }], raid: [{ id: 1 }], milestones: [{ id: 2 }], changes: [{ id: 9 }], stakeholders: [{ id: 3 }],
  });

  it("returns the ref when the id exists in that view", () => {
    expect(groundEntity({ view: "milestones", id: "2" }, index)).toEqual({ view: "milestones", id: 2 });
    expect(groundEntity({ view: "open-points", id: "7" }, index)).toEqual({ view: "open-points", id: 7 });
  });

  it("returns null for unknown id, unknown view, non-numeric id, or undefined", () => {
    expect(groundEntity({ view: "milestones", id: "999" }, index)).toBeNull();
    expect(groundEntity({ view: "raid", id: "abc" }, index)).toBeNull();
    expect(groundEntity(undefined, index)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- action-ai`
Expected: FAIL — `buildGroundingIndex`/`groundEntity` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `action-ai.ts`)

```ts
export interface GroundingIndex {
  "open-points": ReadonlySet<number>;
  raid: ReadonlySet<number>;
  milestones: ReadonlySet<number>;
  changes: ReadonlySet<number>;
  stakeholders: ReadonlySet<number>;
}

export function buildGroundingIndex(ws: {
  tasks: readonly { id: number }[];
  raid: readonly { id: number }[];
  milestones: readonly { id: number }[];
  changes: readonly { id: number }[];
  stakeholders: readonly { id: number }[];
}): GroundingIndex {
  const ids = (rows: readonly { id: number }[]) => new Set(rows.map((r) => r.id));
  return {
    "open-points": ids(ws.tasks), raid: ids(ws.raid), milestones: ids(ws.milestones),
    changes: ids(ws.changes), stakeholders: ids(ws.stakeholders),
  };
}

/** Re-validate a model entity ref against the live workspace. Returns a numeric
 *  deep-link target, or null (→ surface falls back to Discuss-in-chat). */
export function groundEntity(
  entity: { view: GroundableView; id: string } | undefined,
  index: GroundingIndex,
): { view: GroundableView; id: number } | null {
  if (!entity) return null;
  const n = Number(entity.id);
  if (!Number.isInteger(n)) return null;
  const set = index[entity.view];
  if (!set || !set.has(n)) return null;
  return { view: entity.view, id: n };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- action-ai`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-ai.ts src/app/action-ai.test.ts
git commit -m "feat: action-ai grounding index + groundEntity (SP4)"
```

---

### Task 4: One-shot hook `use-action-analysis.ts`

**Files:**
- Create: `src/app/use-action-analysis.ts`
- Test: `src/app/use-action-analysis.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-action-analysis.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionAnalysis } from "./use-action-analysis";

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("useActionAnalysis", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("parses a successful tool_use response and stores the result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    let returned: unknown;
    await act(async () => { returned = await result.current.analyze("ctx"); });
    expect(returned).toEqual({ summary: "s", actions: [] });
    expect(result.current.result).toEqual({ summary: "s", actions: [] });
    expect(result.current.error).toBeNull();
  });

  it("sets a status-only error on HTTP failure (no key or body leaked)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as unknown as Response);
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "secret-key", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("429");
    expect(result.current.error).not.toContain("secret-key");
  });

  it("errors 'no-key' when apiKey is blank and 'parse' on malformed output", async () => {
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "  ", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("no-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ content: [{ type: "text", text: "nope" }] }));
    const { result: r2 } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    await act(async () => { await r2.current.analyze("ctx"); });
    expect(r2.current.error).toBe("parse");
  });

  it("clear() resets result and error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    act(() => result.current.clear());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- use-action-analysis`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/use-action-analysis.ts
"use client";
// One-shot Anthropic call for the Action Center "Analyze with AI" feature. Forces
// a single report_analysis tool call and returns the parsed ActionAnalysis. No
// agentic loop. Reuses the live in-memory API key (never logged). Mirrors
// use-project-proposal.ts.
import { useCallback, useState } from "react";
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";

const ANTHROPIC_VERSION = "2023-06-01";

interface AiCreds { apiKey: string; model: string }
interface ToolUseBlock { type: string; name?: string; input?: unknown }

export function useActionAnalysis(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionAnalysis | null>(null);

  const analyze = useCallback(
    async (context: string): Promise<ActionAnalysis | null> => {
      const key = ai.apiKey.trim();
      if (!key) { setError("no-key"); return null; }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: ai.model,
            max_tokens: 2048,
            system: buildAnalysisSystemPrompt(),
            messages: [{ role: "user", content: context }],
            tools: [ANALYZE_TOOL],
            tool_choice: { type: "tool", name: "report_analysis" },
          }),
        });
        if (!res.ok) throw new Error(String(res.status)); // status only — never echo key/body
        const json = (await res.json()) as { content?: ToolUseBlock[] };
        const toolUse = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "report_analysis");
        const parsed = toolUse ? parseAnalysis(toolUse.input) : null;
        if (!parsed) throw new Error("parse");
        setResult(parsed);
        return parsed;
      } catch (e) {
        setError(e instanceof Error ? e.message : "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [ai.apiKey, ai.model],
  );

  const clear = useCallback(() => { setResult(null); setError(null); }, []);

  return { analyze, busy, error, result, clear };
}
```

- [ ] **Step 4: Add `ANALYZE_TOOL` to `action-ai.ts`** (the hook imports it)

Append to `src/app/action-ai.ts`:

```ts
/** Anthropic tool definition. Forced via tool_choice so the model always emits
 *  one structured tool_use block. */
export const ANALYZE_TOOL = {
  name: "report_analysis",
  description: "Report a triage summary and net-new suggested actions for the project. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "Short triage of what to focus on now, reasoning over the existing queue." },
      actions: {
        type: "array",
        description: "Net-new, cross-cutting suggestions not already in the queue.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short action title." },
            why: { type: "string", description: "One-line rationale." },
            severity: { type: "string", enum: ["now", "soon", "monitor"] },
            entity: {
              type: "object",
              description: "Optional. Only a view#id present in the digest.",
              properties: {
                view: { type: "string", enum: [...GROUNDABLE_VIEWS] },
                id: { type: "string", description: "Numeric id as shown after '#'." },
              },
              required: ["view", "id"],
            },
          },
          required: ["title", "why", "severity"],
        },
      },
    },
    required: ["summary", "actions"],
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- use-action-analysis action-ai && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-action-analysis.ts src/app/use-action-analysis.test.tsx src/app/action-ai.ts
git commit -m "feat: useActionAnalysis one-shot hook + ANALYZE_TOOL (SP4)"
```

---

### Task 5: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add EN keys** — in `src/app/i18n.ts`, add these entries to the dictionary object (place near the other `action*` keys):

```ts
  actionAiAnalyze: "Analyze with AI",
  actionAiAnalyzing: "Analyzing…",
  actionAiSectionTitle: "AI suggestions",
  actionAiDisclaimer: "AI-generated — review before acting.",
  actionAiSummaryLabel: "Focus now",
  actionAiDiscuss: "Discuss in chat",
  actionAiDismiss: "Dismiss AI suggestions",
  actionAiErrorGeneric: "Couldn't analyze right now. Try again.",
  actionAiErrorStatus: "Analysis failed ({0}). Try again.",
  settingsAiActionSuggestions: "Action Center AI suggestions",
  settingsAiActionSuggestionsHelp: "Show an “Analyze with AI” button in the Action Center.",
```

Add the same keys to the `TranslationKey` union if the file maintains one explicitly (most are inferred from the EN dict — check the top of the file; if `TranslationKey = keyof typeof en`, nothing else needed).

- [ ] **Step 2: Add the matching DE keys via node UTF-8 write** (Edit corrupts umlauts; file is CRLF). Run:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "\r\n};\r\n"; // adjust if the DE dict closes differently — verify first with: grep -n "^};" src/app/i18n.de.ts
const block = [
  "  actionAiAnalyze: \"Mit KI analysieren\",",
  "  actionAiAnalyzing: \"Analysiere…\",",
  "  actionAiSectionTitle: \"KI-Vorschläge\",",
  "  actionAiDisclaimer: \"KI-generiert – vor dem Handeln prüfen.\",",
  "  actionAiSummaryLabel: \"Jetzt fokussieren\",",
  "  actionAiDiscuss: \"Im Chat besprechen\",",
  "  actionAiDismiss: \"KI-Vorschläge ausblenden\",",
  "  actionAiErrorGeneric: \"Analyse momentan nicht möglich. Bitte erneut versuchen.\",",
  "  actionAiErrorStatus: \"Analyse fehlgeschlagen ({0}). Bitte erneut versuchen.\",",
  "  settingsAiActionSuggestions: \"KI-Vorschläge im Action Center\",",
  "  settingsAiActionSuggestionsHelp: \"Zeigt eine Schaltfläche „Mit KI analysieren“ im Action Center.\",",
  "",
].join("\r\n");
const idx = s.lastIndexOf(anchor);
if (idx < 0) { console.error("anchor not found"); process.exit(1); }
s = s.slice(0, idx) + "\r\n" + block + s.slice(idx + 2); // keep the closing };
fs.writeFileSync(p, s, "utf8");
console.log("DE keys written");
'
```

> If the anchor strategy is fragile, instead insert each line after a known existing DE key line (match with `\r\n`). Verify umlauts after writing.

- [ ] **Step 3: Verify parity + encoding**

Run: `npx tsc --noEmit && npm run test:run -- i18n`
Expected: PASS — EN/DE key parity holds; `i18n-encoding` test passes (real umlauts, no `fuer`/`druecken`).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: i18n keys for Action Center AI suggestions (SP4)"
```

---

### Task 6: Settings toggle `ai.actionSuggestions`

**Files:**
- Modify: the `ai` settings type (find it: `grep -rn "groundInGuides" src/app/*.ts | grep -i interface` or check `src/app/settings.ts`)
- Modify: `src/app/settings-sections/ai-section.tsx`
- Test: `src/app/settings-sections/ai-section.test.tsx`

- [ ] **Step 1: Add the optional field to the AI settings type.** Locate the interface that declares `groundInGuides?: boolean` and add beside it:

```ts
  actionSuggestions?: boolean; // Action Center "Analyze with AI" button. Default ON (undefined = on).
```

- [ ] **Step 2: Write the failing test** (extend `ai-section.test.tsx`)

```tsx
it("renders the Action Center AI suggestions toggle (default on) and toggles it off", async () => {
  const onChange = vi.fn();
  render(<AiSection lang="en-US" ai={{ apiKey: "", model: "claude-sonnet-4-6", actionSuggestions: undefined }} onChange={onChange} /* …other required props… */ />);
  const toggle = screen.getByRole("checkbox", { name: /Action Center AI suggestions/i });
  expect(toggle).toBeChecked(); // undefined → on
  await userEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ actionSuggestions: false }));
});
```

> Match the existing `AiSection` test's prop-passing + change-handler convention exactly — copy from the `groundInGuides` test in the same file (it is the precedent; mirror its render props and assertion style).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- ai-section`
Expected: FAIL — no such checkbox.

- [ ] **Step 4: Implement the toggle** in `ai-section.tsx`, mirroring the `groundInGuides` row (same control markup, `aria-label`/`<label>` for axe — Settings → General is axe-scanned, but the AI section sits under Integrations; still label it). Checked = `ai.actionSuggestions !== false`; onChange sets `actionSuggestions: !current`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- ai-section && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-section.test.tsx src/app/settings.ts
git commit -m "feat: ai.actionSuggestions settings toggle (SP4)"
```

---

### Task 7: Presentational `ai-action-row.tsx`

**Files:**
- Create: `src/app/ai-action-row.tsx`
- Test: covered via `actions-panel.test.tsx` in Task 8 (row is rendered by the panel). A focused render test is included here.
- Test: `src/app/ai-action-row.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/ai-action-row.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiActionRow } from "./ai-action-row";
import type { AiAction } from "./action-ai";

const action: AiAction = { title: "Unblock M2", why: "Tasks block it.", severity: "now", entity: { view: "milestones", id: "2" } };

describe("AiActionRow", () => {
  it("renders title + why and fires onAct with an action-unique accessible name", async () => {
    const onAct = vi.fn();
    render(<AiActionRow lang="en-US" action={action} onAct={onAct} />);
    expect(screen.getByText("Unblock M2")).toBeInTheDocument();
    expect(screen.getByText("Tasks block it.")).toBeInTheDocument();
    // accessible name qualified by title (WCAG 2.4.6 — avoid N identical labels)
    const btn = screen.getByRole("button", { name: /Unblock M2/i });
    await userEvent.click(btn);
    expect(onAct).toHaveBeenCalledWith(action);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- ai-action-row`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/ai-action-row.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { AiAction, AiActionSeverity } from "./action-ai";
import { healthDot, type Health } from "./health";

const SEV_RAG: Record<AiActionSeverity, Health> = { now: "R", soon: "A", monitor: "G" };

const BTN_CLASS =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey";

interface AiActionRowProps {
  lang: Lang;
  action: AiAction;
  /** Surface decides Open vs Discuss-in-chat via groundEntity; the row just fires. */
  onAct: (action: AiAction) => void;
}

export function AiActionRow({ lang, action, onAct }: AiActionRowProps) {
  // Open if grounded to a real entity, else discuss in chat. The label is chosen
  // by the surface-validated presence of an entity ref on the action.
  const ctaKey = action.entity ? "openEntity" : "actionAiDiscuss";
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden className="mt-1 shrink-0">{healthDot(SEV_RAG[action.severity])}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{action.title}</p>
          <p className="text-xs text-muted-foreground">{action.why}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAct(action)}
        aria-label={`${t(lang, ctaKey)} – ${action.title}`}
        className={`${BTN_CLASS} shrink-0`}
      >
        {t(lang, ctaKey)}
      </button>
    </div>
  );
}
```

> `openEntity` key: reuse an existing "Open" translation key if one exists (grep `grep -n "open\":" src/app/i18n.ts` for a generic Open label such as `actionOpen`/`open`); use it for `ctaKey` when `action.entity` is set. If none fits, add `actionAiOpen: "Open"` (+ DE `"Öffnen"`) in Task 5's block. Ensure the key used here exists.

- [ ] **Step 4: Run test to verify it passes** (after confirming the Open key)

Run: `npm run test:run -- ai-action-row && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-action-row.tsx src/app/ai-action-row.test.tsx
git commit -m "feat: AiActionRow presentational row (SP4)"
```

---

### Task 8: Wire the AI section + button into `actions-panel.tsx`

**Files:**
- Modify: `src/app/actions-panel.tsx`
- Test: `src/app/actions-panel.test.tsx`

- [ ] **Step 1: Write the failing tests** (extend `actions-panel.test.tsx`)

```tsx
import type { ActionAnalysis } from "./action-ai";

const aiOff = undefined;
const baseAi = (over: Partial<{ enabled: boolean; busy: boolean; error: string | null; result: ActionAnalysis | null }>) => ({
  enabled: true, busy: false, error: null, result: null,
  onAnalyze: vi.fn(), onClear: vi.fn(), onActAi: vi.fn(), ...over,
});

it("hides the Analyze button when aiAnalysis is absent or disabled", () => {
  render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={aiOff} />);
  expect(screen.queryByRole("button", { name: /Analyze with AI/i })).toBeNull();
  render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={baseAi({ enabled: false })} />);
  expect(screen.queryByRole("button", { name: /Analyze with AI/i })).toBeNull();
});

it("shows the button when enabled and calls onAnalyze on click", async () => {
  const ai = baseAi({});
  render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={ai} />);
  await userEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
  expect(ai.onAnalyze).toHaveBeenCalled();
});

it("renders the AI section with summary + rows and a dismiss control", async () => {
  const result: ActionAnalysis = { summary: "Focus on M2.", actions: [
    { title: "Unblock M2", why: "blocked", severity: "now", entity: { view: "milestones", id: "2" } },
  ] };
  const ai = baseAi({ result });
  render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={ai} />);
  expect(screen.getByText("Focus on M2.")).toBeInTheDocument();
  expect(screen.getByText("Unblock M2")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Dismiss AI suggestions/i }));
  expect(ai.onClear).toHaveBeenCalled();
});

it("shows a status-only error when present", () => {
  render(<ActionsPanel lang="en-US" actions={[]} onOpen={vi.fn()} aiAnalysis={baseAi({ error: "429" })} />);
  expect(screen.getByText(/429/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- actions-panel`
Expected: FAIL — `aiAnalysis` prop unknown / button absent.

- [ ] **Step 3: Implement.** Add the bundle type + prop and render. In `src/app/actions-panel.tsx`:

```tsx
import { AiActionRow } from "./ai-action-row";
import type { AiAction, ActionAnalysis } from "./action-ai";

export interface AiAnalysisBundle {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  result: ActionAnalysis | null;
  onAnalyze: () => void;
  onClear: () => void;
  onActAi: (action: AiAction) => void;
}
```

Add `aiAnalysis?: AiAnalysisBundle;` to `ActionsPanelProps` and destructure it. In the header `<div className="flex shrink-0 items-center gap-2">` (before `<ResetSizeButton/>`), add the button:

```tsx
{aiAnalysis?.enabled && (
  <button
    type="button"
    onClick={aiAnalysis.onAnalyze}
    disabled={aiAnalysis.busy}
    aria-label={t(lang, "actionAiAnalyze")}
    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
  >
    {t(lang, aiAnalysis.busy ? "actionAiAnalyzing" : "actionAiAnalyze")}
  </button>
)}
```

Immediately inside the body, before the tiers block (i.e. before the `actions.length === 0 ?` ternary, or above the tier `<div>` so it sits at the top of the scroll area), add:

```tsx
{aiAnalysis?.error && (
  <p role="alert" className="mb-3 text-sm text-AIPM-red">
    {aiAnalysis.error === "no-key" || aiAnalysis.error === "parse"
      ? t(lang, "actionAiErrorGeneric")
      : t(lang, "actionAiErrorStatus", aiAnalysis.error)}
  </p>
)}
{aiAnalysis?.result && (
  <section className="mb-5 rounded-md border border-AIPM-dark-blue/30 bg-AIPM-dark-blue/5 p-3" aria-label={t(lang, "actionAiSectionTitle")}>
    <div className="mb-2 flex items-start justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {t(lang, "actionAiSectionTitle")}
      </h3>
      <button type="button" onClick={aiAnalysis.onClear} aria-label={t(lang, "actionAiDismiss")}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground">✕</button>
    </div>
    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t(lang, "actionAiDisclaimer")}</p>
    {aiAnalysis.result.summary && (
      <p className="mb-3 text-sm text-foreground"><span className="font-medium">{t(lang, "actionAiSummaryLabel")}: </span>{aiAnalysis.result.summary}</p>
    )}
    <div className="flex flex-col gap-2">
      {aiAnalysis.result.actions.map((a, i) => (
        <AiActionRow key={`${a.title}:${i}`} lang={lang} action={a} onAct={aiAnalysis.onActAi} />
      ))}
    </div>
  </section>
)}
```

> Note the `actions.length === 0` empty-state must still allow the AI section to show: render the error/AI-section block **above** the `actions.length === 0 ? … : …` ternary so an empty deterministic queue doesn't hide an AI result. Verify `AIPM-red` is the sanctioned token name (grep `globals.css`); if the token is named differently (e.g. `text-AIPM-error`), use that — no off-palette colors.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- actions-panel ai-action-row && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Lint** (catch unused imports — `--max-warnings=0`)

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions-panel.tsx src/app/actions-panel.test.tsx
git commit -m "feat: Action Center AI button + suggestions section (SP4)"
```

---

### Task 9: Thread `aiAnalysis` from `task-manager.tsx` through `workspace-section.tsx`

**Files:**
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Extend `WorkspaceSectionProps` + pass to `ActionsPanel`** in `workspace-section.tsx`:

Add the import + prop:

```tsx
import type { AiAnalysisBundle } from "./actions-panel";
```

Add to `WorkspaceSectionProps`:

```tsx
  aiAnalysis?: AiAnalysisBundle;
```

Destructure `aiAnalysis` in the component params, and pass it on the `ActionsPanel` at line ~919:

```tsx
<ActionsPanel lang={lang} actions={nextActions} onOpen={onOpenAction} onSnooze={onSnooze} onCreateTask={onCreateTask} onDraftMessage={onDraftMessage} assignOwner={assignOwner} escalate={escalate} rebaseline={rebaseline} learningEnabled={learningEnabled} expertMode={expertMode} onOpenLearningSettings={onOpenLearningSettings} aiAnalysis={aiAnalysis} />
```

- [ ] **Step 2: Wire the hook + handlers in `task-manager.tsx`.** Near the other AI hooks / after `nextActions` is computed (~line 705+), add:

```tsx
import { useActionAnalysis } from "./use-action-analysis";
import { buildAnalysisContext, buildGroundingIndex, groundEntity } from "./action-ai";
```

```tsx
const actionAnalysis = useActionAnalysis({
  apiKey: settings.ai?.apiKey?.trim() ?? "",
  model: settings.ai?.model ?? "claude-sonnet-4-6",
});

const groundingIndex = useMemo(
  () => buildGroundingIndex({ tasks, raid, milestones, changes, stakeholders }),
  [tasks, raid, milestones, changes, stakeholders],
);

const runActionAnalysis = useCallback(() => {
  const ctx = buildAnalysisContext({
    projectName: project?.name ?? "",
    today,
    mode: settings.mode,
    enabledModules: settings.features,
    taskCount: tasks.length,
    tasks: tasks.map((x) => ({ id: x.id, title: x.title })),
    raid: raid.map((x) => ({ id: x.id, title: x.title })),
    milestones: milestones.map((x) => ({ id: x.id, title: x.title })),
    changes: changes.map((x) => ({ id: x.id, title: x.title })),
    stakeholders: stakeholders.map((x) => ({ id: x.id, name: x.name })),
    queue: nextActions.map((a) => ({ title: t(lang, a.title.key, ...(a.title.params ?? [])), why: t(lang, a.why.key, ...(a.why.params ?? [])), tier: a.tier })),
  });
  void actionAnalysis.analyze(ctx);
}, [actionAnalysis, project, today, settings.mode, settings.features, tasks, raid, milestones, changes, stakeholders, nextActions, lang]);

const onActAi = useCallback(
  (a: AiAction) => {
    const g = groundEntity(a.entity, groundingIndex);
    if (g) { requestOpen(g.view, g.id); setActiveTab(g.view as AppView); }
    else { requestChat(`${a.title}\n\n${a.why}`, true); setActiveTab("chat"); }
  },
  [groundingIndex, requestOpen, requestChat, setActiveTab],
);

const aiAnalysisBundle = useMemo(
  () => ({
    enabled: !!settings.ai?.apiKey?.trim() && settings.ai?.actionSuggestions !== false,
    busy: actionAnalysis.busy,
    error: actionAnalysis.error,
    result: actionAnalysis.result,
    onAnalyze: runActionAnalysis,
    onClear: actionAnalysis.clear,
    onActAi,
  }),
  [settings.ai?.apiKey, settings.ai?.actionSuggestions, actionAnalysis.busy, actionAnalysis.error, actionAnalysis.result, actionAnalysis.clear, runActionAnalysis, onActAi],
);
```

> Use field names verified against the actual entity types: `Task.title`, `RaidItem.title`, `ChangeItem.title`, `Milestone.title`, `Stakeholder.name`. If any differ (e.g. a task uses `name`), adjust the `.map` — confirm by reading `src/app/types.ts`. `AppView` and `AiAction` need importing in task-manager (`AiAction` from `./action-ai`, `AppView` from `./nav-config`).

Add `aiAnalysis: aiAnalysisBundle` to the `workspaceProps` object (~line 1615):

```tsx
    aiAnalysis: aiAnalysisBundle,
```

- [ ] **Step 3: Typecheck + full unit run**

Run: `npx tsc --noEmit && npm run test:run`
Expected: tsc clean; all vitest green.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean (watch for unused imports; react-hooks/exhaustive-deps — hoist any `obj.member` deps into locals if it complains, e.g. `actionAnalysis.clear`).

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section.tsx src/app/task-manager.tsx
git commit -m "feat: wire Action Center AI analysis through workspace-section (SP4)"
```

---

### Task 10: Release — version, changelog, highlight key

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (highlight strings)

- [ ] **Step 1: Bump version + append highlight key** in `src/app/version.ts`:

```ts
export const APP_VERSION = "0.104.0";
export const APP_BUILD_DATE = "2026-06-19"; // 0.104.0 AI-orchestration SP4: Action Center AI suggestions — one-click Claude triage + net-new advisory actions
export const APP_MILESTONE = "<pick next sci-fi/fantasy author codename, not already used>";
```

Append to `APP_HIGHLIGHT_KEYS` (end of the array, before `] as const;`):

```ts
  "versionHighlightAiActionSuggestions",
```

- [ ] **Step 2: Add the highlight i18n strings.** EN (`i18n.ts`):

```ts
  versionHighlightAiActionSuggestions: "Action Center: one-click AI triage + suggested next actions",
```

DE (`i18n.de.ts`, via node UTF-8 write, same pattern as Task 5):

```
  versionHighlightAiActionSuggestions: "Action Center: KI-Triage per Klick + vorgeschlagene nächste Schritte",
```

- [ ] **Step 3: Add the CHANGELOG entry** at the top of `CHANGELOG.md`:

```markdown
## 0.104.0 "<Milestone>" — 2026-06-19

### Added
- **Action Center AI suggestions:** a manual "Analyze with AI" button runs one Claude call that returns a triage summary of the existing action queue plus net-new, cross-cutting advisory actions. Each AI action opens its referenced entity (when grounded to a real id) or seeds the AI chat. Advisory only — the deterministic engine is unchanged. Gated on a configured Anthropic key + the new Settings → AI "Action Center AI suggestions" toggle (default on).
```

- [ ] **Step 4: Verify everything**

Run: `npx tsc --noEmit && npm run lint && npm run test:run && npm run build`
Expected: all green (build runs the script-docs sync check + highlight-key parity).

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore: release v0.104.0 — Action Center AI suggestions (SP4)"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — clean (incl. test files + i18n parity).
- [ ] `npm run lint` — clean (`--max-warnings=0`).
- [ ] `npm run test:run` — all green.
- [ ] `npm run build` — passes.
- [ ] Manual eye-check (Action Center not in axe gate): button appears only with a key + toggle on; busy state; AI section renders summary + rows; Open vs Discuss CTA; dismiss; error message status-only. Confirm no off-palette color/shadow on the new section (palette-sweep only scans CSS, not Tailwind classes).

## Self-review notes (author)

- **Spec coverage:** §1 shape → Tasks 1–4; §2 UI/CTA → Tasks 7–9; §3 context/grounding/gating/errors → Tasks 2,3,4,6,8,9; §4 testing/i18n/release → Tasks 5,6,8,9,10. All covered.
- **Type consistency:** `ActionAnalysis`/`AiAction`/`AiActionSeverity`/`GroundableView`/`GroundingIndex`/`AiAnalysisBundle` defined once and reused; tool name `report_analysis` consistent in `ANALYZE_TOOL`, hook `tool_choice`, and the tool_use filter; `groundEntity` returns numeric id matching `requestOpen(view, number)`; bundle handler named `onActAi` consistently in `AiActionRow` (`onAct`), bundle, and panel wiring.
- **Open items the implementer must confirm against live code (flagged inline):** the DE-dict insertion anchor; entity title/name field names in `types.ts`; the generic "Open" i18n key (reuse vs add); the sanctioned red token name in `globals.css`; the exact `AiSection` test prop convention.
