# AI project-creation fast-path ("Use AI") — SP3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user describe a new project in plain language; Claude returns one structured proposal (metadata patch + feature modules + optional starter content) that pre-fills the existing 3-step `CreateProjectWizard` for review/edit before creation.

**Architecture:** A new optional **Step 0 "Describe"** at the top of `CreateProjectWizard`. One forced-tool Anthropic call (pure contract in `ai-project-proposal.ts`, network in `use-project-proposal.ts`) returns a `ProjectProposal`. The proposal becomes (a) a `Partial<ProjectFormDraft>` prefilling the Step-1 form, (b) the Step-3 feature set, and (c) an `aiSeed: TemplateSeed` appended at create time via the existing `remapSeed` path. The AI seed is the bespoke "template"; choosing a stored template replaces it (transparent notice). No new persisted `Workspace` field.

**Tech Stack:** TypeScript, React 19, forked Next.js 16, Vitest, Anthropic Messages API (browser, forced `tool_choice`), existing per-entity `sanitizeX` validators.

**Spec:** `docs/superpowers/specs/2026-06-19-ai-orchestration-sp3-design.md`

---

## File structure

- **Create** `src/app/ai-project-proposal.ts` — pure, i18n-free: `ProjectProposal` types, `PROPOSAL_TOOL` (Anthropic tool def), `buildProposalSystemPrompt()`, `parseProposal()`, `proposalToDraftPatch()`, `proposalToSeed()`, `seedHasContent()`, `SEED_CAP_PER_ENTITY`.
- **Create** `src/app/ai-project-proposal.test.ts`.
- **Create** `src/app/use-project-proposal.ts` — hook wrapping the single forced-tool Anthropic call; returns `{ generate, busy, error, reset }` where `generate(description)` resolves to `ProjectProposal | null`.
- **Create** `src/app/use-project-proposal.test.tsx`.
- **Modify** `src/app/template-apply.ts` — extract `appendSeed(ws, seed)` and reuse it in `applyTemplate`.
- **Modify** `src/app/template-apply.test.ts` — add `appendSeed` test.
- **Modify** `src/app/new-project-workspace.ts` — add `aiSeed?: TemplateSeed` to `NewProjectOpts`; append it when Blank + `includeSeed`.
- **Modify** `src/app/new-project-workspace.test.ts` — aiSeed append / ignore-with-template tests.
- **Modify** `src/app/project-form.tsx` — add `initialDraftPatch?: Partial<ProjectFormDraft>` prop; apply over `emptyProjectDraft()` in create mode.
- **Modify** `src/app/create-project-form.tsx` — thread `initialDraftPatch` to `ProjectForm`.
- **Modify** `src/app/create-project-wizard.tsx` — Step 0 UI + AI state + gating + template-replace notice + Step-3 seed wiring + `handleCreate` passes `aiSeed`.
- **Modify** `src/app/create-project-wizard.test.tsx` — Step-0 behavior (mock `use-project-proposal`).
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys (DE via node utf8 write).
- **Modify** `src/app/version.ts`, `CHANGELOG.md` — release.

**Landmines (verified against the code):**
- Every entity sanitizer requires `id > 0` **and** a title/name — assign temp ids **before** sanitizing. `sanitizeMilestone` also requires a valid ISO `date` (drops otherwise).
- `draftFromMeta` spreads arrays (`[...meta.keyStakeholdersInternal]`, `meta.contactPersons.map`) → a sparse `ProjectMeta` would throw. We prefill via a **draft patch**, never a fake `ProjectMeta`.
- Seed `Task` objects are built directly (the dispatcher's `createTask` throws on empty assignee/dueDate; seed tasks bypass it and flow through `remapSeed`, which only clears `resourceId`).
- `react-hooks/set-state-in-effect` is fatal — `generate()` **returns** the proposal so the wizard applies it synchronously in the click handler, not in an effect.
- `Date.now()`/`new Date()` banned in render bodies — compute `today` inside the generate click handler (a callback), not in render.
- `eslint --max-warnings=0` — no unused imports. `i18n.de.ts` via node utf8 write (umlauts; CRLF). `t()` uses 0-based `{0}` placeholders.

---

### Task 1: Extract `appendSeed` in template-apply.ts

**Files:**
- Modify: `src/app/template-apply.ts:134-157`
- Test: `src/app/template-apply.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/template-apply.test.ts`:

```ts
import { appendSeed } from "./template-apply";
import { emptyWorkspace } from "./workspace";

describe("appendSeed", () => {
  it("appends re-mapped seed rows non-destructively", () => {
    const ws = emptyWorkspace();
    const seed = {
      milestones: [{ id: 9, name: "Kickoff", date: "2026-07-01", linkedTaskIds: [] }],
    } as const;
    const next = appendSeed(ws, seed);
    expect(next.milestones?.length).toBe((ws.milestones?.length ?? 0) + 1);
    expect(next.milestones?.at(-1)?.name).toBe("Kickoff");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/template-apply.test.ts`
Expected: FAIL — `appendSeed is not a function` / no export.

- [ ] **Step 3: Implement — extract the append block**

In `src/app/template-apply.ts`, add an exported helper and make `applyTemplate` call it:

```ts
/** Append an already-remapped seed onto a workspace, non-destructively. Pure. */
export function appendSeed(ws: Workspace, seed: TemplateSeed): Workspace {
  return {
    ...ws,
    tasks: seed.tasks ? [...ws.tasks, ...seed.tasks] : ws.tasks,
    milestones: seed.milestones
      ? [...(ws.milestones ?? []), ...seed.milestones]
      : ws.milestones,
    raid: seed.raid ? [...ws.raid, ...seed.raid] : ws.raid,
    changes: seed.changes
      ? [...(ws.changes ?? []), ...seed.changes]
      : ws.changes,
    stakeholders: seed.stakeholders
      ? [...(ws.stakeholders ?? []), ...seed.stakeholders]
      : ws.stakeholders,
    budgets: seed.budgets ? [...(ws.budgets ?? []), ...seed.budgets] : ws.budgets,
  };
}
```

Replace the body of `applyTemplate` after the field-visibility line with:

```ts
  const base: Workspace = { ...ws, fieldVisibility: tpl.fieldVisibility };
  if (!opts.includeSeed || !tpl.seed) return base;
  return appendSeed(base, remapSeed(ws, tpl.seed));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/template-apply.test.ts`
Expected: PASS (the new test + all existing `applyTemplate` tests — behavior is byte-identical).

- [ ] **Step 5: Commit**

```bash
git add src/app/template-apply.ts src/app/template-apply.test.ts
git commit -m "refactor: extract appendSeed from applyTemplate for reuse"
```

---

### Task 2: Pure proposal contract — types, tool def, parseProposal

**Files:**
- Create: `src/app/ai-project-proposal.ts`
- Test: `src/app/ai-project-proposal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/ai-project-proposal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseProposal, PROPOSAL_TOOL } from "./ai-project-proposal";
import { ALL_MODULE_IDS } from "./feature-modules";

describe("parseProposal", () => {
  it("returns null for a non-object or missing name", () => {
    expect(parseProposal(null)).toBeNull();
    expect(parseProposal({ meta: {}, features: [] })).toBeNull();
    expect(parseProposal({ meta: { name: "   " }, features: [] })).toBeNull();
  });

  it("keeps a valid proposal and drops unknown feature ids", () => {
    const p = parseProposal({
      meta: { name: "CRM Migration", products: "Salesforce" },
      features: [ALL_MODULE_IDS[0], "not-a-module", ALL_MODULE_IDS[1]],
      seed: { milestones: [{ name: "Go-live", date: "2026-12-01" }] },
    });
    expect(p).not.toBeNull();
    expect(p!.meta.name).toBe("CRM Migration");
    expect(p!.features).toEqual([ALL_MODULE_IDS[0], ALL_MODULE_IDS[1]]);
    expect(p!.seed?.milestones?.length).toBe(1);
  });
});

describe("PROPOSAL_TOOL", () => {
  it("forces a single structured tool named propose_project", () => {
    expect(PROPOSAL_TOOL.name).toBe("propose_project");
    expect(PROPOSAL_TOOL.input_schema.type).toBe("object");
    expect(PROPOSAL_TOOL.input_schema.properties.meta).toBeDefined();
    expect(PROPOSAL_TOOL.input_schema.properties.features).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/ai-project-proposal.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement the contract**

Create `src/app/ai-project-proposal.ts`:

```ts
// Pure, i18n-free contract for the "Use AI" project-creation fast-path.
// Defines the proposal shape Claude returns (via a forced tool call) and the
// transforms that turn it into wizard inputs. No React, no fetch, no i18n.

import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";

export const SEED_CAP_PER_ENTITY = 8;

const MODULE_ID_SET = new Set<string>(ALL_MODULE_IDS);

/** The metadata fields Claude can reasonably infer from a free-text brief.
 *  Everything here maps onto a ProjectFormDraft patch — the user completes the
 *  remaining required fields (code, NACE, deployment, …) in the Step-1 form. */
export interface ProposalMeta {
  name: string;
  customer?: string;
  projectManager?: string;
  products?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  jiraUrl?: string;
}

/** Raw, unvalidated seed lists straight off the model. Each list is validated
 *  + capped in proposalToSeed; here they are deliberately loose. */
export interface ProposalSeed {
  raid?: unknown[];
  changes?: unknown[];
  milestones?: unknown[];
  stakeholders?: unknown[];
  tasks?: unknown[];
}

export interface ProjectProposal {
  meta: ProposalMeta;
  features: FeatureModuleId[];
  seed?: ProposalSeed;
}

/** Anthropic tool definition. Invoked with tool_choice forcing this single tool
 *  so the model always emits one structured tool_use block (no JSON-from-text). */
export const PROPOSAL_TOOL = {
  name: "propose_project",
  description:
    "Propose the setup for a new project from the user's description. Call this exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      meta: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concise project name." },
          customer: { type: "string" },
          projectManager: { type: "string" },
          products: { type: "string", description: "Products/services involved." },
          startDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          endDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          description: { type: "string" },
          jiraUrl: { type: "string" },
        },
        required: ["name"],
      },
      features: {
        type: "array",
        description: "Feature modules to enable.",
        items: { type: "string", enum: [...ALL_MODULE_IDS] },
      },
      seed: {
        type: "object",
        description: "Optional starter content. Omit any list you have nothing for.",
        properties: {
          raid: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                category: { type: "string", enum: ["R", "A", "I", "D"] },
                description: { type: "string" },
                severity: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
              },
              required: ["title", "category"],
            },
          },
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, description: { type: "string" } },
              required: ["title"],
            },
          },
          milestones: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, date: { type: "string", description: "ISO date YYYY-MM-DD." } },
              required: ["name", "date"],
            },
          },
          stakeholders: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, organization: { type: "string" }, title: { type: "string" } },
              required: ["name"],
            },
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: { taskName: { type: "string" }, dueDate: { type: "string" }, notes: { type: "string" } },
              required: ["taskName"],
            },
          },
        },
      },
    },
    required: ["meta", "features"],
  },
} as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Narrow raw tool_use.input into a ProjectProposal. Requires a non-empty
 *  meta.name; drops unknown feature ids; passes seed lists through untouched
 *  (validation happens in proposalToSeed). Returns null when unusable. */
export function parseProposal(input: unknown): ProjectProposal | null {
  if (!isObj(input)) return null;
  const metaRaw = input.meta;
  if (!isObj(metaRaw)) return null;
  const name = typeof metaRaw.name === "string" ? metaRaw.name.trim() : "";
  if (!name) return null;

  const meta: ProposalMeta = { name };
  for (const k of ["customer", "projectManager", "products", "startDate", "endDate", "description", "jiraUrl"] as const) {
    const v = metaRaw[k];
    if (typeof v === "string" && v.trim()) meta[k] = v.trim();
  }

  const features = Array.isArray(input.features)
    ? (input.features.filter((f): f is FeatureModuleId => typeof f === "string" && MODULE_ID_SET.has(f)))
    : [];

  const seedRaw = isObj(input.seed) ? input.seed : undefined;
  const seed: ProposalSeed | undefined = seedRaw
    ? {
        raid: Array.isArray(seedRaw.raid) ? seedRaw.raid : undefined,
        changes: Array.isArray(seedRaw.changes) ? seedRaw.changes : undefined,
        milestones: Array.isArray(seedRaw.milestones) ? seedRaw.milestones : undefined,
        stakeholders: Array.isArray(seedRaw.stakeholders) ? seedRaw.stakeholders : undefined,
        tasks: Array.isArray(seedRaw.tasks) ? seedRaw.tasks : undefined,
      }
    : undefined;

  return { meta, features, seed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/ai-project-proposal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-project-proposal.ts src/app/ai-project-proposal.test.ts
git commit -m "feat: AI project-proposal contract (types, tool def, parseProposal)"
```

---

### Task 3: Proposal → wizard inputs (draft patch + validated seed)

**Files:**
- Modify: `src/app/ai-project-proposal.ts`
- Test: `src/app/ai-project-proposal.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/ai-project-proposal.test.ts`:

```ts
import { proposalToDraftPatch, proposalToSeed, seedHasContent, SEED_CAP_PER_ENTITY } from "./ai-project-proposal";

const TODAY = "2026-06-19";

describe("proposalToDraftPatch", () => {
  it("maps known meta fields to draft string fields", () => {
    const patch = proposalToDraftPatch({
      meta: { name: "Alpha", products: "Widget", customer: "ACME", startDate: "2026-07-01" },
      features: [],
    });
    expect(patch.name).toBe("Alpha");
    expect(patch.products).toBe("Widget");
    expect(patch.customer).toBe("ACME");
    expect(patch.startDate).toBe("2026-07-01");
    // Unsupplied fields are absent (not "")
    expect("jiraUrl" in patch).toBe(false);
  });
});

describe("proposalToSeed", () => {
  it("validates, assigns ids, and caps each list", () => {
    const many = Array.from({ length: SEED_CAP_PER_ENTITY + 4 }, (_, i) => ({ title: `Risk ${i}`, category: "R" }));
    const seed = proposalToSeed({ meta: { name: "x" }, features: [], seed: { raid: many } }, TODAY);
    expect(seed?.raid?.length).toBe(SEED_CAP_PER_ENTITY);
    expect(seed?.raid?.every((r) => r.id > 0)).toBe(true);
  });

  it("drops records that fail sanitization (e.g. milestone without a date)", () => {
    const seed = proposalToSeed(
      { meta: { name: "x" }, features: [], seed: { milestones: [{ name: "No date" }, { name: "Good", date: "2026-08-01" }] } },
      TODAY,
    );
    expect(seed?.milestones?.length).toBe(1);
    expect(seed?.milestones?.[0]?.name).toBe("Good");
  });

  it("builds seed tasks with today's lastUpdateDate", () => {
    const seed = proposalToSeed({ meta: { name: "x" }, features: [], seed: { tasks: [{ taskName: "Kickoff" }] } }, TODAY);
    expect(seed?.tasks?.[0]?.taskName).toBe("Kickoff");
    expect(seed?.tasks?.[0]?.lastUpdateDate).toBe(TODAY);
  });

  it("returns undefined when there is no usable seed content", () => {
    expect(proposalToSeed({ meta: { name: "x" }, features: [] }, TODAY)).toBeUndefined();
    expect(seedHasContent(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/ai-project-proposal.test.ts`
Expected: FAIL — `proposalToDraftPatch`/`proposalToSeed`/`seedHasContent` not exported.

- [ ] **Step 3: Implement the transforms**

Append to `src/app/ai-project-proposal.ts`:

```ts
import type { ProjectFormDraft } from "./project-form-fields";
import type { TemplateSeed } from "./templates";
import type { Task } from "./types";
import {
  sanitizeRaidItem,
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeStakeholder,
  sanitizeTaskName,
  sanitizeAssignee,
  sanitizeIsoDate,
  sanitizePriority,
  sanitizeNotes,
  sanitizeGroup,
} from "./sanitize";

/** Map the proposal's meta onto the Step-1 form draft. Only sets fields the
 *  model supplied; the form keeps its blank defaults for the rest and its own
 *  validation forces the user to complete required fields. */
export function proposalToDraftPatch(p: ProjectProposal): Partial<ProjectFormDraft> {
  const m = p.meta;
  const patch: Partial<ProjectFormDraft> = {};
  if (m.name) patch.name = m.name;
  if (m.customer) patch.customer = m.customer;
  if (m.projectManager) patch.projectManager = m.projectManager;
  if (m.products) patch.products = m.products;
  if (m.startDate) patch.startDate = m.startDate;
  if (m.endDate) patch.endDate = m.endDate;
  if (m.description) patch.description = m.description;
  if (m.jiraUrl) patch.jiraUrl = m.jiraUrl;
  return patch;
}

/** Validate one raw list: cap to SEED_CAP_PER_ENTITY, assign 1-based temp ids,
 *  run each record through its sanitizer, drop failures. */
function buildList<T>(raw: unknown[] | undefined, sanitize: (x: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  raw.slice(0, SEED_CAP_PER_ENTITY).forEach((item, i) => {
    const withId = isObj(item) ? { ...item, id: i + 1 } : item;
    const s = sanitize(withId);
    if (s) out.push(s);
  });
  return out;
}

function buildSeedTask(raw: unknown, id: number, today: string): Task | null {
  if (!isObj(raw)) return null;
  const taskName = sanitizeTaskName(raw.taskName ?? raw.name);
  if (!taskName) return null;
  return {
    id,
    taskName,
    assignee: sanitizeAssignee(raw.assignee),
    assigneeEmail: "",
    dueDate: sanitizeIsoDate(raw.dueDate),
    lastUpdateDate: today,
    priority: sanitizePriority(raw.priority),
    blockers: "",
    notes: sanitizeNotes(raw.notes),
    inquiriesSent: 0,
    group: sanitizeGroup(raw.group),
    labels: [],
  };
}

/** Turn the proposal's seed into a validated TemplateSeed (or undefined when no
 *  usable content). Person FKs are left unset; remapSeed clears them anyway. */
export function proposalToSeed(p: ProjectProposal, today: string): TemplateSeed | undefined {
  const s = p.seed;
  if (!s) return undefined;
  const raid = buildList(s.raid, sanitizeRaidItem);
  const changes = buildList(s.changes, sanitizeChangeItem);
  const milestones = buildList(s.milestones, sanitizeMilestone);
  const stakeholders = buildList(s.stakeholders, sanitizeStakeholder);
  const tasks: Task[] = Array.isArray(s.tasks)
    ? s.tasks
        .slice(0, SEED_CAP_PER_ENTITY)
        .map((t, i) => buildSeedTask(t, i + 1, today))
        .filter((t): t is Task => t !== null)
    : [];

  const seed: TemplateSeed = {};
  if (raid.length) seed.raid = raid;
  if (changes.length) seed.changes = changes;
  if (milestones.length) seed.milestones = milestones;
  if (stakeholders.length) seed.stakeholders = stakeholders;
  if (tasks.length) seed.tasks = tasks;
  return seedHasContent(seed) ? seed : undefined;
}

/** True when a seed carries at least one row in any list. */
export function seedHasContent(seed: TemplateSeed | undefined): boolean {
  if (!seed) return false;
  return Object.values(seed).some((v) => Array.isArray(v) && v.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/ai-project-proposal.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — verify no type errors (e.g. `Task` field names match).

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-project-proposal.ts src/app/ai-project-proposal.test.ts
git commit -m "feat: proposalToDraftPatch + proposalToSeed (validated, capped seed)"
```

---

### Task 4: `use-project-proposal` hook (the one forced-tool call)

**Files:**
- Create: `src/app/use-project-proposal.ts`
- Test: `src/app/use-project-proposal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-project-proposal.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectProposal } from "./use-project-proposal";

const ai = { apiKey: "sk-test", model: "claude-sonnet-4-6" };

afterEach(() => vi.restoreAllMocks());

function mockFetchToolUse(input: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: "tool_use", name: "propose_project", input }], stop_reason: "tool_use" }),
  } as Response);
}

describe("useProjectProposal", () => {
  it("returns a parsed proposal on a forced tool_use response", async () => {
    mockFetchToolUse({ meta: { name: "Alpha" }, features: [] });
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown;
    await act(async () => { p = await result.current.generate("a CRM project"); });
    expect((p as { meta: { name: string } }).meta.name).toBe("Alpha");
    expect(result.current.error).toBeNull();
  });

  it("sets error and resolves null on an HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, text: async () => "nope" } as Response);
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown = "x";
    await act(async () => { p = await result.current.generate("x"); });
    expect(p).toBeNull();
    expect(result.current.error).toBe("401");
  });

  it("refuses with no-key when the API key is blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useProjectProposal({ apiKey: "  ", model: "claude-sonnet-4-6" }));
    let p: unknown = "x";
    await act(async () => { p = await result.current.generate("x"); });
    expect(p).toBeNull();
    expect(result.current.error).toBe("no-key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/use-project-proposal.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the hook**

Create `src/app/use-project-proposal.ts`:

```ts
"use client";

// One-shot Anthropic call for the "Use AI" project-creation fast-path. Forces a
// single propose_project tool call and returns the parsed ProjectProposal. No
// agentic loop. Reuses the live in-memory API key (never logged).

import { useCallback, useState } from "react";
import { parseProposal, PROPOSAL_TOOL, buildProposalSystemPrompt, type ProjectProposal } from "./ai-project-proposal";

const ANTHROPIC_VERSION = "2023-06-01";

interface AiCreds {
  apiKey: string;
  model: string;
}

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export function useProjectProposal(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (description: string): Promise<ProjectProposal | null> => {
      const key = ai.apiKey.trim();
      if (!key) {
        setError("no-key");
        return null;
      }
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
            max_tokens: 4096,
            system: buildProposalSystemPrompt(),
            messages: [{ role: "user", content: description }],
            tools: [PROPOSAL_TOOL],
            tool_choice: { type: "tool", name: "propose_project" },
          }),
        });
        if (!res.ok) {
          // Surface only the status code — never echo the key or response body.
          throw new Error(String(res.status));
        }
        const json = (await res.json()) as { content?: ToolUseBlock[] };
        const toolUse = (json.content ?? []).find(
          (b) => b.type === "tool_use" && b.name === "propose_project",
        );
        const parsed = toolUse ? parseProposal(toolUse.input) : null;
        if (!parsed) throw new Error("parse");
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

  const reset = useCallback(() => setError(null), []);

  return { generate, busy, error, reset };
}
```

Add `buildProposalSystemPrompt` to `src/app/ai-project-proposal.ts` (pure, English; lists module ids so Claude picks valid features):

```ts
/** System prompt for the proposal call. English + the module catalog; not the
 *  chat assistant prompt and not operating-guide grounded (no active context at
 *  creation time). */
export function buildProposalSystemPrompt(): string {
  return [
    "You are a senior project manager helping set up a new project tracker.",
    "From the user's description, call the propose_project tool EXACTLY ONCE.",
    "Infer a concise name and any metadata you can; leave fields you cannot infer unset.",
    "Choose the feature modules that fit the project from this set:",
    ALL_MODULE_IDS.join(", ") + ".",
    "Optionally propose a small amount of realistic starter content (a few risks/issues,",
    "milestones, key stakeholders, opening tasks) — at most a handful of each. Omit a list",
    "if you have nothing concrete. Use ISO dates (YYYY-MM-DD). Do not invent owners or emails.",
  ].join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/use-project-proposal.test.tsx`
Expected: PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-project-proposal.ts src/app/use-project-proposal.test.tsx src/app/ai-project-proposal.ts
git commit -m "feat: useProjectProposal hook (forced-tool one-shot) + proposal system prompt"
```

---

### Task 5: Wire `aiSeed` into `NewProjectOpts` / `buildNewProjectWorkspace`

**Files:**
- Modify: `src/app/new-project-workspace.ts`
- Test: `src/app/new-project-workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/new-project-workspace.test.ts`:

```ts
import type { TemplateSeed } from "./templates";

const META = { name: "X" } as unknown as import("./types").ProjectMeta; // minimal; buildNewProjectWorkspace only stores it

const aiSeed: TemplateSeed = {
  milestones: [{ id: 1, name: "Go-live", date: "2026-12-01", linkedTaskIds: [] }],
};

describe("buildNewProjectWorkspace aiSeed", () => {
  it("appends aiSeed when Blank + includeSeed", () => {
    const ws = buildNewProjectWorkspace(META, { features: [], includeSeed: true, aiSeed });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(true);
  });

  it("ignores aiSeed when includeSeed is false", () => {
    const ws = buildNewProjectWorkspace(META, { features: [], includeSeed: false, aiSeed });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(false);
  });

  it("ignores aiSeed when a template is chosen (template seed wins)", () => {
    const ws = buildNewProjectWorkspace(META, {
      template: { id: "t", name: "T", features: [], fieldVisibility: {} } as never,
      features: [],
      includeSeed: true,
      aiSeed,
    });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/new-project-workspace.test.ts`
Expected: FAIL — `aiSeed` not on `NewProjectOpts` (tsc) / not appended.

- [ ] **Step 3: Implement**

In `src/app/new-project-workspace.ts`:

```ts
import { emptyWorkspace, type Workspace } from "./workspace";
import { applyTemplate, appendSeed, remapSeed } from "./template-apply";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { ProjectMeta } from "./types";
import type { FeatureModuleId } from "./feature-modules";

export interface NewProjectOpts {
  template?: ProjectTemplate;
  features?: readonly FeatureModuleId[];
  includeSeed?: boolean;
  /** AI fast-path starter content. Applied only when no stored template is
   *  chosen (a template replaces it) and includeSeed is set. */
  aiSeed?: TemplateSeed;
  storage?: "file" | "turso";
}

export function buildNewProjectWorkspace(meta: ProjectMeta, opts: NewProjectOpts): Workspace {
  let ws: Workspace = { ...emptyWorkspace(), project: meta };
  if (opts.template) {
    ws = applyTemplate(ws, opts.template, { includeSeed: !!opts.includeSeed });
  } else if (opts.aiSeed && opts.includeSeed) {
    ws = appendSeed(ws, remapSeed(ws, opts.aiSeed));
  }
  if (opts.features !== undefined) ws = { ...ws, features: opts.features };
  return ws;
}
```

(Keep the existing doc comment for the `storage` field.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/new-project-workspace.test.ts`
Expected: PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/new-project-workspace.ts src/app/new-project-workspace.test.ts
git commit -m "feat: append AI seed in buildNewProjectWorkspace (Blank + includeSeed only)"
```

---

### Task 6: `initialDraftPatch` prop on `ProjectForm`

**Files:**
- Modify: `src/app/project-form.tsx:31-49`, `:85-98`
- Test: `src/app/project-form.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Add to `src/app/project-form.test.tsx` (create the file if it does not exist; mirror the imports of a sibling form test):

```tsx
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectForm } from "./project-form";

describe("ProjectForm initialDraftPatch", () => {
  it("prefills supplied draft fields in create mode", () => {
    render(
      <ProjectForm
        lang="en-US"
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        initialDraftPatch={{ name: "Seeded Name", products: "Widget" }}
      />,
    );
    expect((screen.getByDisplayValue("Seeded Name") as HTMLInputElement)).toBeTruthy();
    expect((screen.getByDisplayValue("Widget") as HTMLInputElement)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/project-form.test.tsx`
Expected: FAIL — `initialDraftPatch` not a prop (tsc) / not applied.

- [ ] **Step 3: Implement**

Add the prop to `ProjectFormProps`:

```ts
  /** Create-mode prefill (e.g. the AI fast-path). Applied over emptyProjectDraft().
   *  Ignored when `initial` (edit mode) is provided. */
  initialDraftPatch?: Partial<ProjectFormDraft>;
```

(Import `ProjectFormDraft` type if not already imported: it lives in `./project-form-fields`.)

Change the state initializer (currently `initial ? draftFromMeta(initial) : emptyProjectDraft()`):

```ts
  const [draft, setDraft] = useState<ProjectFormDraft>(() =>
    initial ? draftFromMeta(initial) : { ...emptyProjectDraft(), ...initialDraftPatch },
  );
```

(Match the existing `useState` variable name/signature; only the initial value changes. Add `initialDraftPatch` to the destructured props.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/project-form.test.tsx`
Expected: PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/project-form.tsx src/app/project-form.test.tsx
git commit -m "feat: ProjectForm initialDraftPatch prefill (create mode)"
```

---

### Task 7: Thread `initialDraftPatch` through `CreateProjectForm`

**Files:**
- Modify: `src/app/create-project-form.tsx:37-65`, `:131-141`

- [ ] **Step 1: Add the prop + forward it**

In `CreateProjectFormProps` add:

```ts
  /** Create-mode prefill forwarded to ProjectForm (AI fast-path). */
  initialDraftPatch?: Partial<import("./project-form-fields").ProjectFormDraft>;
```

Destructure `initialDraftPatch` in the component params, and pass it to `<ProjectForm … initialDraftPatch={initialDraftPatch} />`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/create-project-form.tsx
git commit -m "feat: thread initialDraftPatch through CreateProjectForm"
```

---

### Task 8: Step 0 "Describe" in `CreateProjectWizard`

**Files:**
- Modify: `src/app/create-project-wizard.tsx`
- Test: `src/app/create-project-wizard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/create-project-wizard.test.tsx` (mock the hook so no network):

```tsx
import { vi } from "vitest";

const generateMock = vi.fn();
vi.mock("./use-project-proposal", () => ({
  useProjectProposal: () => ({ generate: generateMock, busy: false, error: null, reset: vi.fn() }),
}));

// Helper: render with an API key configured so Step 0 shows.
function renderWithKey(extraProps = {}) {
  const settings = { ...baseSettings, ai: { ...baseSettings.ai, apiKey: "sk-test" } };
  return render(<CreateProjectWizard {...baseProps} settings={settings} {...extraProps} />);
}

describe("CreateProjectWizard AI Step 0", () => {
  beforeEach(() => generateMock.mockReset());

  it("starts on Step 0 (Describe) when an API key is configured", () => {
    renderWithKey();
    expect(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") })).toBeInTheDocument();
  });

  it("starts on Step 1 (Details) when no API key is configured", () => {
    render(<CreateProjectWizard {...baseProps} settings={baseSettings} />);
    expect(screen.queryByLabelText(t("en-US", "aiCreateDescribeLabel"))).not.toBeInTheDocument();
  });

  it("Generate populates the Details form and advances to Step 1", async () => {
    generateMock.mockResolvedValue({ meta: { name: "Proposed Project" }, features: [], seed: undefined });
    renderWithKey();
    fireEvent.change(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), { target: { value: "a crm project" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }));
    await waitFor(() => expect(screen.getByDisplayValue("Proposed Project")).toBeInTheDocument());
  });

  it("Skip jumps straight to the Details form", () => {
    renderWithKey();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }));
    expect(screen.queryByLabelText(t("en-US", "aiCreateDescribeLabel"))).not.toBeInTheDocument();
  });
});
```

(Reuse the file's existing `baseProps`/`baseSettings` fixtures and imports — `screen`, `fireEvent`, `waitFor`, `t`. If the existing test renders the wizard differently, adapt these to its harness.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/create-project-wizard.test.tsx`
Expected: FAIL — no Step 0 / labels missing.

- [ ] **Step 3: Implement Step 0 + wiring**

Edits in `src/app/create-project-wizard.tsx`:

1. Imports:

```ts
import { useProjectProposal } from "./use-project-proposal";
import { proposalToDraftPatch, proposalToSeed, seedHasContent } from "./ai-project-proposal";
import type { ProjectFormDraft } from "./project-form-fields";
import type { TemplateSeed } from "./templates";
```

2. Widen the step type and state (replace `type Step = 1 | 2 | 3;`):

```ts
type Step = 0 | 1 | 2 | 3;
```

3. Inside the component, add state + the hook (place near the other `useState`s):

```ts
  const aiKey = settings.ai?.apiKey?.trim() ?? "";
  const aiEnabled = aiKey.length > 0;
  const { generate, busy: aiBusy, error: aiError } = useProjectProposal({
    apiKey: aiKey,
    model: settings.ai?.model ?? "claude-sonnet-4-6",
  });
  const [step, setStep] = useState<Step>(aiEnabled ? 0 : 1);
  const [description, setDescription] = useState("");
  const [draftPatch, setDraftPatch] = useState<Partial<ProjectFormDraft> | undefined>(undefined);
  const [aiSeed, setAiSeed] = useState<TemplateSeed | undefined>(undefined);
```

(Remove the old `const [step, setStep] = useState<Step>(1);` line — replaced above.)

4. Generate handler (add near `handleDetails`):

```ts
  const handleGenerate = async () => {
    const p = await generate(description);
    if (!p) return; // error surfaced via aiError
    const today = new Date().toISOString().slice(0, 10); // callback context — lint-safe
    setDraftPatch(proposalToDraftPatch(p));
    setFeatures(p.features.length ? p.features : [...ALL_MODULE_IDS]);
    const seed = proposalToSeed(p, today);
    setAiSeed(seed);
    setIncludeSeed(seedHasContent(seed));
    setStep(1);
  };
```

5. Derived flags (replace the `offerSeed` line):

```ts
  const aiSeedActive = selectedTemplate === null && seedHasContent(aiSeed);
  const offerSeed = hasSeedContent(selectedTemplate) || aiSeedActive;
```

6. `handleCreate` — pass `aiSeed`:

```ts
  const handleCreate = () => {
    if (!meta) return;
    onCreate(meta, format, {
      template: selectedTemplate ?? undefined,
      features,
      includeSeed,
      aiSeed: selectedTemplate === null ? aiSeed : undefined,
      storage,
    });
  };
```

7. Render the step indicator only for steps ≥ 1, and add the Step-0 body. Replace the indicator block:

```tsx
      <div className="flex shrink-0 items-start pb-4">
        {step >= 1 ? (
          <StepIndicator lang={lang} step={step as Step} />
        ) : (
          <h2 className="text-base font-semibold text-foreground">{t(lang, "aiCreateHeading")}</h2>
        )}
      </div>
```

Add the Step-0 body before the `{step === 1 && (` block:

```tsx
        {step === 0 && (
          <div className="flex flex-col gap-4 pb-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t(lang, "aiCreateDescribeLabel")}</span>
              <textarea
                aria-label={t(lang, "aiCreateDescribeLabel")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder={t(lang, "aiCreateDescribePlaceholder")}
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
              />
            </label>
            {aiError && (
              <p role="alert" className="text-sm text-AIPM-red">
                {t(lang, aiError === "no-key" ? "aiCreateNeedsKey" : "aiCreateError")}
              </p>
            )}
          </div>
        )}
```

8. Step-2 transparency notice — add inside the Step-2 block, right after the `<fieldset>`'s closing tag (or above it), guarded:

```tsx
            {aiSeedActive === false && seedHasContent(aiSeed) && selectedTemplate !== null && (
              <p role="status" className="text-xs text-AIPM-red">
                {t(lang, "aiCreateTemplateReplacesSeed")}
              </p>
            )}
```

(Equivalently: `seedHasContent(aiSeed) && selectedTemplate !== null`.)

9. Step-3 seed label — change the `offerSeed` label span to:

```tsx
                <span>{t(lang, aiSeedActive ? "aiCreateIncludeContent" : "wizardIncludeContent")}</span>
```

10. Step-0 footer — add a pinned footer block alongside the step-2/step-3 footers:

```tsx
      {step === 0 && (
        <div className="flex shrink-0 justify-between gap-2 border-t border-line pt-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className={SECONDARY_BUTTON_CLASS}>
              {t(lang, "aiCreateSkip")}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
                {t(lang, "cancel")}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={aiBusy || !description.trim()}
            className={PRIMARY_BUTTON_CLASS}
          >
            {aiBusy ? t(lang, "aiCreateBusy") : t(lang, "aiCreateGenerate")}
          </button>
        </div>
      )}
```

11. Pass `initialDraftPatch` to the Step-1 form:

```tsx
          <CreateProjectForm
            lang={lang}
            …existing props…
            initialMeta={meta ?? undefined}
            initialDraftPatch={meta ? undefined : draftPatch}
            initialFormat={format}
          />
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `npm run test:run -- src/app/create-project-wizard.test.tsx`
Expected: PASS (new Step-0 tests + existing wizard tests — existing tests start at Step 1 because their `settings` has no `ai.apiKey`).
Run: `npx tsc --noEmit` and `npm run lint` — expected clean (watch for unused `aiSeedActive`/imports).

- [ ] **Step 5: Commit**

```bash
git add src/app/create-project-wizard.tsx src/app/create-project-wizard.test.tsx
git commit -m "feat: AI 'Describe' Step 0 in CreateProjectWizard (gated, pre-fills wizard)"
```

---

### Task 9: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (node utf8 write — NOT the Edit tool)

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, add (alongside the other `aiCreate*`/wizard keys):

```ts
  aiCreateHeading: "Create with AI",
  aiCreateDescribeLabel: "Describe your project",
  aiCreateDescribePlaceholder:
    "e.g. A 6-month CRM migration for ACME, go-live in Q4, key risks around data quality and team ramp-up.",
  aiCreateGenerate: "Generate with AI",
  aiCreateBusy: "Generating…",
  aiCreateSkip: "Skip — set up manually",
  aiCreateError: "Couldn't generate a proposal. Try rephrasing, or set up manually.",
  aiCreateNeedsKey: "Add an Anthropic API key in Settings → AI to use this.",
  aiCreateTemplateReplacesSeed: "Choosing a template replaces the AI-generated starter content.",
  aiCreateIncludeContent: "Include AI-generated starter content",
  versionHighlightAiCreateWizard:
    "Create a project from a plain-language description — Claude proposes the setup and starter content.",
```

- [ ] **Step 2: Add DE keys via node utf8 write**

Create a throwaway script and run it (real umlauts; matches CRLF; does not touch other keys). Insert before the closing brace of the DE dict — adapt the anchor to an existing unique DE line:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  versionHighlightAiDocIngest:";
const block =
  "  aiCreateHeading: \"Mit KI erstellen\",\r\n" +
  "  aiCreateDescribeLabel: \"Projekt beschreiben\",\r\n" +
  "  aiCreateDescribePlaceholder: \"z. B. Eine 6-monatige CRM-Migration für ACME, Go-live in Q4, zentrale Risiken bei Datenqualität und Team-Aufbau.\",\r\n" +
  "  aiCreateGenerate: \"Mit KI erstellen\",\r\n" +
  "  aiCreateBusy: \"Wird erstellt…\",\r\n" +
  "  aiCreateSkip: \"Überspringen – manuell einrichten\",\r\n" +
  "  aiCreateError: \"Vorschlag konnte nicht erstellt werden. Bitte umformulieren oder manuell einrichten.\",\r\n" +
  "  aiCreateNeedsKey: \"Fügen Sie unter Einstellungen → KI einen Anthropic-API-Schlüssel hinzu, um dies zu nutzen.\",\r\n" +
  "  aiCreateTemplateReplacesSeed: \"Die Auswahl einer Vorlage ersetzt die von der KI erstellten Startinhalte.\",\r\n" +
  "  aiCreateIncludeContent: \"Von der KI erstellte Startinhalte einbeziehen\",\r\n" +
  "  versionHighlightAiCreateWizard: \"Erstellen Sie ein Projekt aus einer Beschreibung in natürlicher Sprache – Claude schlägt Einrichtung und Startinhalte vor.\",\r\n";
if (!s.includes(anchor)) throw new Error("anchor not found");
s = s.replace(anchor, block + anchor);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys inserted");
'
```

- [ ] **Step 3: Typecheck (enforces EN/DE parity) + encoding test**

Run: `npx tsc --noEmit`
Expected: clean (parity holds — same keys both dicts).
Run: `npm run test:run -- src/app/i18n` (the i18n-encoding test)
Expected: PASS (no ASCII umlaut substitutions).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: AI project-creation strings (EN + DE)"
```

---

### Task 10: Release — version, highlight, changelog

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version + register the highlight**

In `src/app/version.ts`:
- `APP_VERSION = "0.103.0";`
- `APP_BUILD_DATE = "2026-06-19"; // 0.103.0 AI-orchestration SP3: AI project-creation fast-path ("Use AI") (Watts)`
- `APP_MILESTONE = "Watts";` (and update the codename comment to "Peter Watts")
- Append to `APP_HIGHLIGHT_KEYS`: `"versionHighlightAiCreateWizard",`

- [ ] **Step 2: Changelog entry**

Add to the top of `CHANGELOG.md`:

```markdown
## [0.103.0] - 2026-06-19 "Watts"

### Added
- **AI project-creation fast-path ("Use AI").** When an Anthropic API key is configured, the
  create-project wizard opens on a new "Describe" step: write a plain-language brief and Claude
  proposes the project setup (name, dates, products, feature modules) plus optional starter content
  (risks/issues, milestones, key stakeholders, opening tasks). The proposal pre-fills the normal
  3-step wizard for review and edit before anything is created — nothing is written until you create.
  Choosing a stored template instead replaces the AI-generated starter content (shown inline). Skip
  the step any time to set up manually.
```

- [ ] **Step 3: Verify the highlight renders**

Run: `npx tsc --noEmit` (highlight key must have EN+DE strings — added in Task 9).
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release v0.103.0 \"Watts\" — AI project-creation fast-path"
```

---

### Task 11: Full-suite verification

- [ ] **Step 1: Run the full gates**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run build
```
Expected: all green. (`build` runs the script-docs sync check; unrelated here but must stay green.)

- [ ] **Step 2: a11y by eye**

The create wizard is not a guaranteed axe `A11Y_VIEWS` surface. Manually confirm: the Step-0 textarea has an accessible name (`aria-label`), both footer buttons have text labels, and the error `<p role="alert">` announces. Optionally run the General settings axe spec to confirm no regression elsewhere:
```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
```

- [ ] **Step 3: Commit any fixes, then the feature is ready for MR.**

---

## Self-review

**Spec coverage:**
- Step 0 fast-path atop wizard → Task 8. ✔
- One forced-tool call → Task 4 (`tool_choice`). ✔
- Fields + opt-out starter content → Tasks 3 (`proposalToSeed`), 8 (`includeSeed` wiring). ✔
- AI = Blank-base bespoke template; stored template replaces AI seed → Task 5 (`buildNewProjectWorkspace` guard) + Task 8 (notice). ✔
- Transparency notice → Task 8 step 8. ✔
- sanitizeX on every seed record + caps + FK clearing → Task 3 + Task 5 (`remapSeed`). ✔
- No schema / six-write-path change → confirmed (seed produces ordinary entities; `aiSeed` is a build-time opt, not persisted). ✔
- Error handling (no key / call fail / malformed / empty) → Task 4 (error states) + Task 8 (UI). ✔
- Gating on configured key → Task 8 step 3. ✔
- i18n EN/DE, version, changelog, highlight → Tasks 9–10. ✔
- Testing (pure / hook / wizard / workspace / template-apply) → Tasks 1–8. ✔

**Placeholder scan:** none — every code step shows complete code; the i18n/version edits give exact strings.

**Type consistency:** `ProjectProposal`/`ProposalSeed`/`ProposalMeta` defined in Task 2 and used unchanged in Tasks 3–4; `proposalToDraftPatch`/`proposalToSeed`/`seedHasContent`/`buildProposalSystemPrompt` names consistent across Tasks 3, 4, 8; `appendSeed` signature matches between Tasks 1 and 5; `aiSeed`/`initialDraftPatch` prop names consistent across Tasks 5–8; seed `Task` fields match the verified `createTask` shape.
