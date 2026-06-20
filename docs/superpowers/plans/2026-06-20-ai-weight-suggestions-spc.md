# SP-C - AI-Suggested Next-Actions Weight Adjustments - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In the next-actions settings, a "Suggest with AI" button runs one forced-tool Anthropic call that proposes numeric adjustments to the next-actions weights (clamped, advisory), shown in a second "AI suggested" column with per-row Accept.

**Architecture:** Pure i18n-free contract (`next-actions-tuning.ts` parse/clamp/apply) + forced-tool contract (`weight-suggestion-ai.ts`, mirrors `action-ai.ts`) + non-hook call (`weight-suggestion-call.ts`, mirrors `scheduled-job-analysis.ts`) + hook (`use-weight-suggestions.ts`, mirrors `use-action-analysis.ts`). UI augments the existing next-actions settings section. Ephemeral, advisory; Accept writes a clamped value via `setSettings`.

**Tech Stack:** Forked Next.js 16 / React 19 / TS; vitest; Anthropic direct-browser forced-tool call; i18n EN+DE (tsc parity); Tailwind AIPM tokens; axe gate (Settings IS scanned).

Spec: `docs/superpowers/specs/2026-06-20-ai-weight-suggestions-spc-design.md`. Reuses SP4 AI pattern.

---

## Conventions (read first)
- After editing ANY test run `npx tsc --noEmit` (build+vitest don't typecheck tests). `getByRole` string `name` is already exact - no `{exact}`.
- `npm run lint` `--max-warnings=0`: unused import/var FATAL.
- i18n EN (`i18n.ts`) + DE (`i18n.de.ts`) key sets identical (tsc enforces). DE is CRLF; the Edit tool corrupts umlauts/curls quotes - add DE keys via a node UTF-8 write script (anchor on `\r\n`), then delete the script. Tests use `lang="en-US"`; assert DE via `loadI18n("de")` in `beforeAll`.
- AIPM palette tokens only. Settings view IS in the axe `A11Y_VIEWS` 12-view gate - per-row controls need ROW-UNIQUE accessible names.
- **SECURITY:** the AI call NEVER logs/echoes the apiKey or response body; thrown errors carry only the HTTP status (digits) or `"parse"`. Mirror `scheduled-job-analysis.ts` exactly.
- Persist settings ONLY via `setSettings`/`writeSettings` - never raw `setItem`.
- `npm run test:run` green before each commit; commit per task.

---

## File Map
- `src/app/settings-types.ts` - extract per-field coercers to module level + a field-coercer map; add `ai.suggestAllNextActionThresholds`.
- `src/app/next-actions-tuning.ts` (NEW pure) - `WeightSuggestion`, field lists, `parseWeightSuggestions`, `applyWeightSuggestion`.
- `src/app/weight-suggestion-ai.ts` (NEW) - `SUGGEST_TOOL`, `buildSuggestionSystemPrompt`, `buildSuggestionContext`, `parseSuggestionResponse`.
- `src/app/weight-suggestion-call.ts` (NEW) - non-hook `runWeightSuggestion(context, ai, current, scope)`.
- `src/app/use-weight-suggestions.ts` (NEW) - hook.
- `src/app/settings-view.tsx` (+ the next-actions settings section component it renders) - second column + Suggest/Accept/Accept-all/Enable-learning/scope-toggle UI.
- `src/app/i18n.ts` / `i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`.

---

## Task 1: Extract per-field coercers + pure tuning contract

**Files:** Modify `src/app/settings-types.ts`; Create `src/app/next-actions-tuning.ts`, `src/app/next-actions-tuning.test.ts`.

Context: `settings-types.ts` `resolveNextActionsConfig` (~line 291) has local closures `intMin1` (>=1 round), `intMin0` (>=0 round), `ratio` (>0 and <=2) applied per field. We hoist these to module level + a per-field map so a SINGLE field can be clamped, then build the pure tuning contract on top.

- [ ] **Step 1: Write the failing test** - `src/app/next-actions-tuning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWeightSuggestions, applyWeightSuggestion, WEIGHT_FIELDS } from "./next-actions-tuning";
import { defaultNextActionsConfig } from "./settings-types";

const cur = defaultNextActionsConfig; // clarityBonus 15, semiClarityBonus 7, staticPenalty 25, ...

describe("parseWeightSuggestions", () => {
  it("parses valid weight suggestions and drops no-ops", () => {
    const out = parseWeightSuggestions(
      { suggestions: [
        { field: "clarityBonus", suggested: 20, rationale: "you act on clear fixes" },
        { field: "staticPenalty", suggested: 25, rationale: "no change" }, // no-op (===current)
      ] },
      cur, "weights",
    );
    expect(out.map((s) => s.field)).toEqual(["clarityBonus"]);
    expect(out[0]).toMatchObject({ field: "clarityBonus", current: 15, suggested: 20 });
    expect(out[0].rationale).toBe("you act on clear fixes");
  });
  it("clamps an out-of-bounds value through the per-field coercer", () => {
    const out = parseWeightSuggestions({ suggestions: [{ field: "clarityBonus", suggested: -9, rationale: "x" }] }, cur, "weights");
    // intMin0 floors at >=0 -> -9 becomes the default (15) which equals current -> dropped as no-op
    expect(out).toEqual([]);
  });
  it("drops fields outside the weights scope", () => {
    const out = parseWeightSuggestions({ suggestions: [{ field: "scopePendingRed", suggested: 9, rationale: "x" }] }, cur, "weights");
    expect(out).toEqual([]);
  });
  it("allows threshold fields when scope is 'all'", () => {
    const out = parseWeightSuggestions({ suggestions: [{ field: "scopePendingRed", suggested: 9, rationale: "x" }] }, cur, "all");
    expect(out.map((s) => s.field)).toEqual(["scopePendingRed"]);
    expect(out[0].suggested).toBe(9);
  });
  it("ignores malformed entries and never throws; caps the list", () => {
    expect(parseWeightSuggestions(null, cur, "weights")).toEqual([]);
    expect(parseWeightSuggestions({ suggestions: "x" }, cur, "weights")).toEqual([]);
    expect(parseWeightSuggestions({ suggestions: [{ field: "clarityBonus" }] }, cur, "weights")).toEqual([]); // no suggested
  });
  it("only exposes the 3 weight fields by default scope", () => {
    expect(WEIGHT_FIELDS).toEqual(["clarityBonus", "semiClarityBonus", "staticPenalty"]);
  });
});

describe("applyWeightSuggestion", () => {
  it("sets one field immutably", () => {
    const next = applyWeightSuggestion(cur, { field: "clarityBonus", current: 15, suggested: 22, rationale: "x" });
    expect(next.clarityBonus).toBe(22);
    expect(next).not.toBe(cur);
    expect(cur.clarityBonus).toBe(15);
  });
});
```

- [ ] **Step 2:** `npm run test:run -- next-actions-tuning` -> FAIL (module + exports missing).

- [ ] **Step 3: Hoist coercers in `settings-types.ts`.** Replace the inline closures in `resolveNextActionsConfig` with module-level functions + a field map (behavior identical):

```ts
const intMin1 = (v: unknown, def: number): number => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? Math.round(n) : def; };
const intMin0 = (v: unknown, def: number): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : def; };
const ratio = (v: unknown, def: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 2 ? n : def; };

/** Per-field validator for NextActionsConfig - the SINGLE source of clamping,
 *  used by both resolveNextActionsConfig and the AI weight-suggestion parser. */
export const NEXT_ACTIONS_FIELD_COERCE: Record<keyof NextActionsConfig, (v: unknown, def: number) => number> = {
  scopePendingRed: intMin1,
  scheduleSpiWarn: ratio,
  scheduleSpiCritical: ratio,
  workloadAllocatedPct: intMin1,
  workloadAllocatedCritical: intMin1,
  workloadOverdueThreshold: intMin1,
  workloadOverdueUrgent: intMin1,
  clarityBonus: intMin0,
  semiClarityBonus: intMin0,
  staticPenalty: intMin0,
};
```
Rewrite the `return { ... }` of `resolveNextActionsConfig` to use these exported coercers (keep the explicit per-field calls, just referencing the hoisted functions) - confirm the existing settings tests still pass unchanged.

- [ ] **Step 4: Implement `src/app/next-actions-tuning.ts`:**

```ts
// src/app/next-actions-tuning.ts - pure, i18n-free contract for AI weight suggestions.
import { NEXT_ACTIONS_FIELD_COERCE, type NextActionsConfig } from "./settings-types";

export type TunableField = keyof NextActionsConfig;
export const WEIGHT_FIELDS: TunableField[] = ["clarityBonus", "semiClarityBonus", "staticPenalty"];
export const ALL_TUNABLE_FIELDS: TunableField[] = Object.keys(NEXT_ACTIONS_FIELD_COERCE) as TunableField[];

export type SuggestionScope = "weights" | "all";
export interface WeightSuggestion { field: TunableField; current: number; suggested: number; rationale: string; }

const MAX_SUGGESTIONS = ALL_TUNABLE_FIELDS.length;
const MAX_RATIONALE = 240;
// Strip ASCII control chars (0x00-0x1F) from untrusted rationale text.
const CONTROL_CHARS = /[\x00-\x1f]/g;

function allowedFields(scope: SuggestionScope): Set<TunableField> {
  return new Set(scope === "all" ? ALL_TUNABLE_FIELDS : WEIGHT_FIELDS);
}

/** Validate + clamp untrusted model output. Never throws. Clamps each suggested
 *  value through the SAME per-field coercer the config uses, drops no-ops, drops
 *  out-of-scope/unknown fields, sanitizes rationale, caps the list. */
export function parseWeightSuggestions(input: unknown, current: NextActionsConfig, scope: SuggestionScope): WeightSuggestion[] {
  if (!input || typeof input !== "object") return [];
  const arr = (input as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(arr)) return [];
  const allow = allowedFields(scope);
  const seen = new Set<TunableField>();
  const out: WeightSuggestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { field?: unknown; suggested?: unknown; rationale?: unknown };
    if (typeof r.field !== "string" || !allow.has(r.field as TunableField)) continue;
    const field = r.field as TunableField;
    if (seen.has(field)) continue;
    if (typeof r.suggested !== "number" && typeof r.suggested !== "string") continue;
    const cur = current[field];
    const clamped = NEXT_ACTIONS_FIELD_COERCE[field](r.suggested, cur);
    if (clamped === cur) continue; // no-op
    const rationale = (typeof r.rationale === "string" ? r.rationale : "").replace(CONTROL_CHARS, " ").trim().slice(0, MAX_RATIONALE);
    out.push({ field, current: cur, suggested: clamped, rationale });
    seen.add(field);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Pure: return a new config with the one field set to the suggested value. */
export function applyWeightSuggestion(config: NextActionsConfig, s: WeightSuggestion): NextActionsConfig {
  return { ...config, [s.field]: s.suggested };
}
```

- [ ] **Step 5:** `npm run test:run -- next-actions-tuning settings-types` -> PASS (tuning + the existing settings tests). `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 6: commit**
```bash
git add src/app/settings-types.ts src/app/next-actions-tuning.ts src/app/next-actions-tuning.test.ts
git commit -m "feat(sp-c): per-field coercer map + pure weight-suggestion parse/apply"
```

---

## Task 2: Settings flag (suggest-all-thresholds toggle)

**Files:** Modify the `ai` settings type + sanitizer (find via `rg "scheduledJobs|actionSuggestions" src/app/settings-types.ts src/app/use-settings.ts` - the `AiConfig`-style group). Test: the settings/ai-config sanitize test.

- [ ] **Step 1: failing test** - mirror the `ai.scheduledJobs`/`ai.actionSuggestions` sanitize tests:
```ts
it("defaults ai.suggestAllNextActionThresholds to false and coerces to === true", () => {
  // parse ai config with no field -> false; with true -> true; with "x" -> false
});
```

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3:** Add `suggestAllNextActionThresholds?: boolean` to the `ai` config type (where `scheduledJobs`/`actionSuggestions` live) + default `false`; in the AI-config sanitizer add `suggestAllNextActionThresholds: obj.suggestAllNextActionThresholds === true` (opt-in, default OFF - like `scheduledJobs`).

- [ ] **Step 4:** `npm run test:run -- use-settings settings-types` -> PASS. `npx tsc --noEmit` -> 0.

- [ ] **Step 5: commit**
```bash
git add -A
git commit -m "feat(sp-c): ai.suggestAllNextActionThresholds flag (opt-in, default OFF)"
```

---

## Task 3: Forced-tool contract + non-hook call

**Files:** Create `src/app/weight-suggestion-ai.ts`, `src/app/weight-suggestion-call.ts`, `src/app/weight-suggestion-ai.test.ts`.

- [ ] **Step 1: failing test** - `src/app/weight-suggestion-ai.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SUGGEST_TOOL, buildSuggestionSystemPrompt, buildSuggestionContext, parseSuggestionResponse } from "./weight-suggestion-ai";
import { defaultNextActionsConfig } from "./settings-types";

describe("weight-suggestion-ai", () => {
  it("SUGGEST_TOOL is the forced suggest_weights tool", () => {
    expect(SUGGEST_TOOL.name).toBe("suggest_weights");
    expect(SUGGEST_TOOL.input_schema.required).toContain("suggestions");
  });
  it("system prompt is stable (no volatile data) and frames a senior PM", () => {
    const p = buildSuggestionSystemPrompt();
    expect(p).toMatch(/suggest_weights/);
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no date baked into the cached prompt
  });
  it("buildSuggestionContext includes current weights + scope + learning summary", () => {
    const ctx = buildSuggestionContext({
      workspaceDigest: "Project: X. Today: 2026-06-20.",
      current: defaultNextActionsConfig,
      scope: "weights",
      learning: "acted=12 snoozed=3 dismissed=1 (by signal: ...)",
      trends: "(no snapshots)",
      learningEnabled: true,
    });
    expect(ctx).toMatch(/clarityBonus/);
    expect(ctx).toMatch(/acted=12/);
    expect(ctx).toMatch(/weights/);
  });
  it("parseSuggestionResponse extracts suggestions + recommendEnableLearning", () => {
    const res = parseSuggestionResponse(
      { suggestions: [{ field: "clarityBonus", suggested: 20, rationale: "x" }], recommendEnableLearning: true, overallRationale: "tune up clarity" },
      defaultNextActionsConfig, "weights",
    );
    expect(res.suggestions.map((s) => s.field)).toEqual(["clarityBonus"]);
    expect(res.recommendEnableLearning).toBe(true);
    expect(res.overallRationale).toBe("tune up clarity");
  });
});
```

- [ ] **Step 2:** `npm run test:run -- weight-suggestion-ai` -> FAIL.

- [ ] **Step 3: implement `src/app/weight-suggestion-ai.ts`** (mirror `action-ai.ts`):
```ts
// src/app/weight-suggestion-ai.ts - pure, i18n-free forced-tool contract for SP-C.
import { type NextActionsConfig } from "./settings-types";
import { ALL_TUNABLE_FIELDS, parseWeightSuggestions, WEIGHT_FIELDS, type SuggestionScope, type WeightSuggestion } from "./next-actions-tuning";

export interface SuggestionResult { suggestions: WeightSuggestion[]; overallRationale: string; recommendEnableLearning: boolean; }
const CONTROL_CHARS = /[\x00-\x1f]/g;

export interface SuggestionContextInput {
  workspaceDigest: string;           // from buildAiContext/buildAnalysisContext
  current: NextActionsConfig;
  scope: SuggestionScope;
  learning: string;                  // act/snooze/dismiss summary, or "(learning disabled)"
  trends: string;                    // snapshot-delta summary, or "(no snapshots)"
  learningEnabled: boolean;
}

export function buildSuggestionSystemPrompt(): string {
  return [
    "You are a senior project manager tuning a project tracker's next-actions ranking weights.",
    "Higher clarityBonus/semiClarityBonus raise clear/semi-clear actions; higher staticPenalty lowers vague aggregate signals.",
    "Call the suggest_weights tool exactly once. Propose a new value for a field ONLY when the user's behaviour (what they act on vs snooze/dismiss) and the project data support it; otherwise omit it.",
    "Give a one-sentence rationale per field. Set recommendEnableLearning=true only if learning is disabled and enabling it would improve future suggestions. Keep values within sane bounds; the app re-clamps anyway.",
  ].join(" ");
}

export function buildSuggestionContext(i: SuggestionContextInput): string {
  const weights = Object.entries(i.current).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const fields = i.scope === "all" ? ALL_TUNABLE_FIELDS : WEIGHT_FIELDS;
  return [
    i.workspaceDigest,
    "",
    `## Tuning scope: ${i.scope === "all" ? "all next-actions thresholds" : "the 3 confidence weights only"}`,
    `Suggestable fields: ${fields.join(", ")}.`,
    "",
    "## Current next-actions config", weights,
    "",
    `## Action-learning history (${i.learningEnabled ? "enabled" : "disabled"})`, i.learning,
    "",
    "## Snapshot trends", i.trends,
  ].join("\n");
}

export function parseSuggestionResponse(input: unknown, current: NextActionsConfig, scope: SuggestionScope): SuggestionResult {
  const suggestions = parseWeightSuggestions(input, current, scope);
  const obj = (input && typeof input === "object" ? input : {}) as { recommendEnableLearning?: unknown; overallRationale?: unknown };
  const overallRationale = (typeof obj.overallRationale === "string" ? obj.overallRationale : "").replace(CONTROL_CHARS, " ").trim().slice(0, 280);
  return { suggestions, overallRationale, recommendEnableLearning: obj.recommendEnableLearning === true };
}

export const SUGGEST_TOOL = {
  name: "suggest_weights",
  description: "Suggest numeric adjustments to next-actions ranking weights. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        description: "Per-field suggested adjustments. Only include a field you actually want to change.",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "A suggestable config field name." },
            suggested: { type: "number", description: "Proposed new value." },
            rationale: { type: "string", description: "One-sentence justification from the data." },
          },
          required: ["field", "suggested", "rationale"],
        },
      },
      overallRationale: { type: "string", description: "One-line summary of the tuning recommendation." },
      recommendEnableLearning: { type: "boolean", description: "True only if learning is disabled and enabling it would help." },
    },
    required: ["suggestions"],
  },
};
```

- [ ] **Step 4: implement `src/app/weight-suggestion-call.ts`** (mirror `scheduled-job-analysis.ts` EXACTLY for the security/error contract):
```ts
// src/app/weight-suggestion-call.ts - non-hook forced suggest_weights call. NEVER
// logs/echoes the api key or response body; thrown errors carry only HTTP status
// (digits) or "parse". Mirrors scheduled-job-analysis.ts.
import { type NextActionsConfig } from "./settings-types";
import { type SuggestionScope } from "./next-actions-tuning";
import { SUGGEST_TOOL, buildSuggestionSystemPrompt, parseSuggestionResponse, type SuggestionResult } from "./weight-suggestion-ai";

const ANTHROPIC_VERSION = "2023-06-01";
interface AiCreds { apiKey: string; model: string }
interface ToolUseBlock { type: string; name?: string; input?: unknown }

export async function runWeightSuggestion(context: string, ai: AiCreds, current: NextActionsConfig, scope: SuggestionScope): Promise<SuggestionResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ai.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 2048,
      system: buildSuggestionSystemPrompt(),
      messages: [{ role: "user", content: context }],
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "suggest_weights" },
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "suggest_weights");
  if (!toolUse) throw new Error("parse");
  return parseSuggestionResponse(toolUse.input, current, scope);
}
```

- [ ] **Step 5:** `npm run test:run -- weight-suggestion-ai` -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-c): suggest_weights forced-tool contract + non-hook call"
```

---

## Task 4: Hook

**Files:** Create `src/app/use-weight-suggestions.ts`, `src/app/use-weight-suggestions.test.tsx`.

- [ ] **Step 1: failing test** - `src/app/use-weight-suggestions.test.tsx` (mock `./weight-suggestion-call`):
```ts
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
vi.mock("./weight-suggestion-call", () => ({ runWeightSuggestion: vi.fn() }));
import { runWeightSuggestion } from "./weight-suggestion-call";
import { useWeightSuggestions } from "./use-weight-suggestions";
import { defaultNextActionsConfig } from "./settings-types";

describe("useWeightSuggestions", () => {
  it("sets error 'no-key' and does not call when key blank", async () => {
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "  ", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.error).toBe("no-key");
    expect(runWeightSuggestion).not.toHaveBeenCalled();
  });
  it("stores the result on success", async () => {
    (runWeightSuggestion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ suggestions: [{ field: "clarityBonus", current: 15, suggested: 20, rationale: "x" }], overallRationale: "", recommendEnableLearning: false });
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.result?.suggestions[0].field).toBe("clarityBonus");
  });
  it("maps a numeric-status throw to that status and a generic throw to 'network'", async () => {
    (runWeightSuggestion as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("429"));
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.error).toBe("429");
  });
});
```

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: implement `src/app/use-weight-suggestions.ts`** (mirror `use-action-analysis.ts`):
```ts
"use client";
import { useCallback, useState } from "react";
import { type NextActionsConfig } from "./settings-types";
import { type SuggestionScope } from "./next-actions-tuning";
import { runWeightSuggestion } from "./weight-suggestion-call";
import { type SuggestionResult } from "./weight-suggestion-ai";

interface AiCreds { apiKey: string; model: string }

export function useWeightSuggestions(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestionResult | null>(null);

  const run = useCallback(
    async (context: string, current: NextActionsConfig, scope: SuggestionScope): Promise<SuggestionResult | null> => {
      const key = ai.apiKey.trim();
      if (!key) { setError("no-key"); return null; }
      setBusy(true); setError(null);
      try {
        const parsed = await runWeightSuggestion(context, { apiKey: key, model: ai.model }, current, scope);
        setResult(parsed);
        return parsed;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        setError(/^\d+$/.test(msg) || msg === "parse" ? msg : "network");
        return null;
      } finally { setBusy(false); }
    },
    [ai.apiKey, ai.model],
  );

  const clear = useCallback(() => { setResult(null); setError(null); }, []);
  return { run, busy, error, result, clear };
}
```

- [ ] **Step 4:** `npm run test:run -- use-weight-suggestions` -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add -A
git commit -m "feat(sp-c): useWeightSuggestions hook (forced-tool, ephemeral, key-gated)"
```

---

## Task 5: Settings UI - AI-suggested column + Suggest/Accept/Enable-learning

**Files:** Modify `src/app/settings-view.tsx` and the next-actions settings section it renders (the `active === "nextActions"` block ~line 283 - it may delegate to a section component; find it: `rg "nextActions" src/app/settings-view.tsx src/app/settings-sections` and locate where the `NextActionsConfig` rows are edited). Modify `src/app/i18n.ts` + `i18n.de.ts`. Test: the relevant settings test (`settings-view.test.tsx` or a section test).

Context: the section already renders each `NextActionsConfig` field as an editable numeric input bound to `settings.nextActions` via `setSettings`. We add: a Suggest button, a per-row "AI suggested" cell (value + rationale tooltip + Accept), Accept-all, an Enable-learning control, and the scope toggle.

- [ ] **Step 1: failing test** - extend the settings section test:
```ts
it("shows an AI suggestion and Accept applies it via setSettings", () => {
  // render the next-actions settings with: configured AI key; a mocked useWeightSuggestions
  // returning result.suggestions = [{ field: "clarityBonus", current: 15, suggested: 20, rationale: "act on clear" }].
  // assert the suggested value "20" renders in the clarityBonus row;
  // click Accept (getByRole("button", { name: "Accept - Clarity bonus" }));  // use the real field label string
  // assert setSettings was called and the updater sets nextActions.clarityBonus = 20.
});
```
(Mock `./use-weight-suggestions` so the test doesn't hit the network; seed a result. Follow how the section test currently stubs settings/hooks.)

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: wire the UI.** In the next-actions section component:
- Instantiate the hook: `const { run, busy, error, result, clear } = useWeightSuggestions({ apiKey: settings.ai?.apiKey ?? "", model: settings.ai?.model ?? DEFAULT_MODEL });` (use the app's existing default-model constant; find via `rg "DEFAULT_MODEL|claude-" src/app/settings-types.ts src/app/ai-*`).
- **Suggest button** (gated on `settings.ai?.apiKey?.trim()`): on click, build the context and call `run`. Build context via `buildSuggestionContext({...})`: `workspaceDigest` from the shared workspace-digest builder the SP4 Action-Center analysis uses (reuse `buildAnalysisContext`/`buildAiContext`; thread it from task-manager the way SP4 does, OR if the section cannot reach it, pass a minimal one-line digest - PREFER reusing the existing builder and REPORT how you sourced it), `current = resolveNextActionsConfig(settings.nextActions)`, `scope = settings.ai?.suggestAllNextActionThresholds ? "all" : "weights"`, `learning` = a summary read from the action-learning store (read-only; `rg "action_learning|action-learning" src/app` to find the reader; if learning disabled/empty pass "(learning disabled)" / "(no history)"), `trends` = a Turso-gated snapshot summary or "(no snapshots)", `learningEnabled = settings.nextActionsLearning?.enabled ?? false`. Then `run(context, current, scope)`.
- **Per-row "AI suggested" cell:** for each rendered field, look up `result?.suggestions.find((s) => s.field === field)`; if present, render the `suggested` value + an InfoTooltip with `rationale` + an **Accept** button with a ROW-UNIQUE label `` `${t(lang,"weightSuggestAccept")} - ${fieldLabel}` ``. Accept: `setSettings((s) => ({ ...s, nextActions: applyWeightSuggestion(resolveNextActionsConfig(s.nextActions), suggestion) }))` then drop that suggestion from the displayed result (local state filter) so the row clears.
- **Accept all:** applies every current suggestion (fold them into ONE `setSettings` updater that reduces over the suggestions with `applyWeightSuggestion`) then `clear()`.
- **Enable-learning control:** when `result?.recommendEnableLearning && !settings.nextActionsLearning?.enabled`, show a button that `setSettings((s) => ({ ...s, nextActionsLearning: { ...(s.nextActionsLearning ?? defaultNextActionsLearning), enabled: true } }))`.
- **Scope toggle:** a labeled checkbox bound to `settings.ai?.suggestAllNextActionThresholds` -> `setSettings`. Label explains it widens suggestions to all thresholds.
- **Busy/error:** spinner while `busy`; on `error` show a sanitized message (map "no-key"/"network"/"parse"/digits -> friendly i18n strings; never show key/body).
- Only sanctioned AIPM tokens. Per-row Accept labels MUST be row-unique (Settings is axe-scanned).

- [ ] **Step 4: i18n.** EN (`i18n.ts`) - add (reuse existing keys where present; `rg '"accept"|"acceptAll"' src/app/i18n.ts`):
```ts
  weightSuggestRun: "Suggest with AI",
  weightSuggestColumn: "AI suggested",
  weightSuggestAccept: "Accept",
  weightSuggestAcceptAll: "Accept all",
  weightSuggestEnableLearning: "Enable learning",
  weightSuggestScopeAll: "Also suggest firing thresholds",
  weightSuggestBusy: "Analyzing...",
  weightSuggestErrorKey: "Configure an AI key first.",
  weightSuggestErrorNetwork: "Could not reach the AI service.",
  weightSuggestErrorParse: "The AI returned an unexpected response.",
  weightSuggestNone: "No adjustments suggested.",
```
DE (`i18n.de.ts`) via node UTF-8 write (real umlauts; delete script after): German equivalents - e.g. `weightSuggestRun: "Mit KI vorschlagen"`, `weightSuggestColumn: "KI-Vorschlag"`, `weightSuggestAccept: "Uebernehmen"` (use the real umlaut: "Übernehmen"), `weightSuggestAcceptAll: "Alle uebernehmen"` (real: "Alle übernehmen"), `weightSuggestEnableLearning: "Lernen aktivieren"`, `weightSuggestScopeAll: "Auch Ausloeseschwellen vorschlagen"` (real: "Auch Auslöseschwellen vorschlagen"), `weightSuggestBusy: "Analysiere..."`, errors translated. ALL umlauts MUST be real characters (the i18n-encoding test bans ASCII subs like ue/oe/ae) - write them via the node UTF-8 script. Confirm EN/DE parity (tsc).

- [ ] **Step 5:** `npm run test:run -- settings i18n` -> PASS. `npm run test:run` (full) -> green. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-c): next-actions settings AI-suggested column + Suggest/Accept/Enable-learning"
```

---

## Task 6: i18n highlight + release + axe verify

**Files:** `src/app/version.ts`, `src/app/i18n.ts` / `i18n.de.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** - `APP_VERSION = "0.109.0"`, `APP_MILESTONE = "Leckie"` (Ann Leckie); update the build-date comment + milestone JSDoc; append `"versionHighlightWeightSuggest"` as the LAST `APP_HIGHLIGHT_KEYS` entry.

- [ ] **Step 2: EN highlight** (`i18n.ts`):
```ts
  versionHighlightWeightSuggest: "Claude can now suggest adjustments to your next-actions ranking weights from your project, trends, and what you act on - review each in the settings and Accept the ones you want.",
```

- [ ] **Step 3: DE highlight** (`i18n.de.ts`) via node UTF-8 write (real umlauts; delete script):
DE value (write with the real ue->ü, ae->ä, oe->ö, fuer->für, pruefen->prüfen, uebernehmen->übernehmen, naechste->nächste characters):
`"Claude kann jetzt Anpassungen Ihrer Priorisierungsgewichte fuer naechste Aktionen aus Projekt, Trends und Ihrem Verhalten vorschlagen - pruefen Sie jeden Vorschlag in den Einstellungen und uebernehmen Sie die gewuenschten."`
=> with real umlauts: "...Gewichte **für** **nächste** Aktionen ... **prüfen** Sie ... und **übernehmen** Sie die **gewünschten**." Confirm parity + the i18n-encoding test (real umlauts, no ASCII subs).

- [ ] **Step 4: CHANGELOG.md** - new top entry, mirror the existing format (`## [0.109.0] - 2026-06-20 "Leckie"`):
```markdown
### Added
- AI-suggested next-actions weight adjustments: a "Suggest with AI" button in the next-actions settings proposes new values for the confidence weights (and, optionally, all firing thresholds) from your project, snapshot trends, and your act/snooze/dismiss history. Review the per-row rationale and Accept the ones you want; values are always clamped to safe bounds.
```

- [ ] **Step 5: build + suites** - `npm run build` (prebuild highlight-key + script-docs sync) -> PASS. `npm run test:run` -> green. `npx tsc --noEmit` -> 0. `npm run lint` -> clean.

- [ ] **Step 6: axe gate (Settings IS scanned)** - `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` -> PASS (the new Suggest/Accept controls + per-row Accept labels). Report verbatim. If it fails on a label/duplicate, report the exact rule. (Don't fake it.)

- [ ] **Step 7: commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(sp-c): release v0.109.0 Leckie (AI weight suggestions)"
```

---

## Final review
After all tasks, review `git diff main...HEAD`:
- `parseWeightSuggestions` clamps EVERY accepted value through `NEXT_ACTIONS_FIELD_COERCE` (no out-of-bounds/hallucinated value can land); no-ops + out-of-scope dropped; rationale control-char-stripped.
- The AI call never logs/echoes apiKey or body; errors carry only status / `"parse"`.
- Accept writes only via `setSettings` (clamped); scope toggle is per-device; no new Workspace field.
- Per-row Accept labels are row-unique; Settings axe gate passes; AIPM tokens only.
- i18n EN/DE parity + real umlauts; tsc clean incl tests.

Then use **superpowers:finishing-a-development-branch**.
