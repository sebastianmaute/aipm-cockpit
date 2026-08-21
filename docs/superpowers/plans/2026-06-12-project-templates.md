# Project/Task Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-project library of reusable `ProjectTemplate`s (built-in + user-created) bundling a feature-module preset, a field-visibility config, and optional starter content, with save-as-template, apply-to-current, and a Settings manager.

**Architecture:** A pure `templates.ts` (types + sanitizers + save-as builder), `templates-builtin.ts` (constant starters), and `template-apply.ts` (the pure `applyTemplate`/`remapSeed` core that replaces field-visibility and non-destructively appends re-id'd seed content). User templates persist in `Settings.templates[]` (the existing localStorage settings blob). UI: a `templates-section.tsx` Settings manager + Save/Apply entries in `action-menus.tsx`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + @testing-library/react, existing `useSettings`/`useWorkspace` contexts, `sanitize.ts` entity sanitizers.

**Spec:** `docs/superpowers/specs/2026-06-12-project-templates-design.md`

**Conventions:** run one test file `npx vitest run src/app/<f>.test.ts`; full suite `npm run test:run`; lint gate `--max-warnings=0`; build `npm run build` (tsc + next). No `console.log`. Immutable updates. No version bump in this plan (orchestrator releases). i18n.de.ts curly-quote hazard — grep after edits.

**Reality notes (verified):**
- All entity ids are `number`. `nextId(items: ReadonlyArray<{id:number}>): number` from `resource-foundation.ts` (`max(ids)+1`, or 1 when empty).
- Reference fields to remap within seed: `Task.dependencies: number[]`, `Milestone.linkedTaskIds: number[]`, `RaidItem.linkedTaskIds: number[]`, `ChangeItem.linkedTaskIds/linkedRaidIds/stakeholderIds: number[]`, `Stakeholder.raci: Record<string,RaciRole>` (keys are milestone ids as strings), `BudgetBucket.successorId?: number|null`. RaidItem may also have a raid-link field for predecessors — verify the exact name in `types.ts` and remap it too if present.
- Person FKs that point OUTSIDE the seed (resources aren't seeded): `RaidItem.ownerResourceId?: number|null`, `Stakeholder.resourceId?: number|null` → set to `null` on apply.
- Entity sanitizers (sanitize.ts): `sanitizeMilestone`, `sanitizeChangeItem`, `sanitizeStakeholder`, `sanitizeBudgetBucket` return `T | null`. Tasks/RAID are sanitized elsewhere — see Task 1 step for how to sanitize Task/RaidItem seed (use the same sanitizers the workspace load path uses; verify names in `sanitize.ts`/`workspace.ts`).
- Reused exports: `sanitizeFeatures`, `ALL_MODULE_IDS`, `FeatureModuleId` (feature-modules.ts; **10 modules** incl. stakeholders/history — use the real union); `sanitizeFieldVisibility`, `applyTier`, `FieldVisibilityConfig`, `MODAL_IDS` (field-visibility.ts/modal-fields.ts).

---

## File Structure

| File | Responsibility | New? |
|------|----------------|------|
| `src/app/templates.ts` | `ProjectTemplate`/`TemplateSeed` types, `sanitizeTemplate`/`sanitizeTemplates`, `templateFromWorkspace` | new |
| `src/app/templates-builtin.ts` | `BUILT_IN_TEMPLATES` constant (3 starters) | new |
| `src/app/template-apply.ts` | `remapSeed` + `applyTemplate` (pure) | new |
| `src/app/use-templates.ts` | hook over `useSettings` (merge built-ins + user, CRUD) | new |
| `src/app/settings-types.ts` | `Settings.templates?` + default `[]` | modify |
| `src/app/use-settings.ts` | sanitize `templates` on read | modify |
| `src/app/settings-sections/templates-section.tsx` | library manager UI | new |
| `src/app/settings-view.tsx` + `settings-menu.tsx` | register the section | modify |
| `src/app/template-menus.tsx` | `SaveTemplateMenu` + `ApplyTemplateMenu` (dialogs + buttons) | new |
| `src/app/action-menus.tsx` | render the two new menus + thread handlers | modify |
| `src/app/task-manager.tsx` (or the ActionMenus parent) | wire apply→setters, save→addTemplate | modify |
| `src/app/i18n.ts` / `i18n.de.ts` | section/action/dialog/built-in keys | modify |

---

## Task 1: Template types + sanitizers (`templates.ts`)

**Files:** Create `src/app/templates.ts`, `src/app/templates.test.ts`.

- [ ] **Step 1: Read** `src/app/sanitize.ts` to confirm the exact exported names for sanitizing a single **Task** and a single **RaidItem** (e.g. `sanitizeTask`, `sanitizeRaidItem` — they may be named differently or live in another module; check `workspace.ts`/`jsonToWorkspace` for how tasks/raid are sanitized on load and reuse those). Note the names; you'll use them below.

- [ ] **Step 2: Write the failing test** `src/app/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeTemplate, sanitizeTemplates } from "./templates";

describe("sanitizeTemplates", () => {
  it("returns [] for junk / legacy", () => {
    expect(sanitizeTemplates(undefined)).toEqual([]);
    expect(sanitizeTemplates(null)).toEqual([]);
    expect(sanitizeTemplates("x")).toEqual([]);
    expect(sanitizeTemplates({})).toEqual([]);
  });
  it("keeps a valid template and coerces features/fieldVisibility", () => {
    const out = sanitizeTemplates([
      { id: "t1", name: "T1", features: ["raid", "nope"], fieldVisibility: { milestone: { fields: ["name"] } } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
    expect(out[0].features).toEqual(["raid"]);            // junk dropped via sanitizeFeatures
    expect(out[0].fieldVisibility.milestone.fields).toContain("name");
  });
  it("drops entries without id or name", () => {
    expect(sanitizeTemplates([{ name: "no id" }, { id: "x" }])).toEqual([]);
  });
  it("forces builtIn off on stored user templates", () => {
    const out = sanitizeTemplates([{ id: "t", name: "T", builtIn: true, features: [], fieldVisibility: {} }]);
    expect(out[0].builtIn).toBeFalsy();
  });
  it("sanitizeTemplate returns null for junk, object for valid", () => {
    expect(sanitizeTemplate(5)).toBeNull();
    expect(sanitizeTemplate({ id: "a", name: "A", features: [], fieldVisibility: {} })?.id).toBe("a");
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/app/templates.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** `src/app/templates.ts`:

```ts
import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
import {
  sanitizeMilestone, sanitizeChangeItem, sanitizeStakeholder, sanitizeBudgetBucket,
} from "./sanitize";
// NOTE: import the real Task & RaidItem sanitizers you identified in Step 1:
import { /* sanitizeTask */ } from "./sanitize"; // adjust to the real name
import type {
  Task, Milestone, RaidItem, ChangeItem, Stakeholder, BudgetBucket,
} from "./types";

export interface TemplateSeed {
  tasks?: readonly Task[];
  milestones?: readonly Milestone[];
  raid?: readonly RaidItem[];
  changes?: readonly ChangeItem[];
  stakeholders?: readonly Stakeholder[];
  budgets?: readonly BudgetBucket[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  features: readonly FeatureModuleId[];
  fieldVisibility: FieldVisibilityConfig;
  seed?: TemplateSeed;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function nonEmptyStr(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x.trim() : null;
}

// Sanitize an array via an entity sanitizer that returns T | null.
function sanitizeArr<T>(raw: unknown, fn: (x: unknown) => T | null): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map(fn).filter((x): x is T => x !== null);
  return out.length ? out : undefined;
}

function sanitizeSeed(raw: unknown): TemplateSeed | undefined {
  if (!isObj(raw)) return undefined;
  const seed: TemplateSeed = {};
  const tasks = sanitizeArr<Task>(raw.tasks, /* sanitizeTask */ ((x) => x as Task | null)); // replace with real
  const milestones = sanitizeArr<Milestone>(raw.milestones, sanitizeMilestone);
  const rd = sanitizeArr<RaidItem>(raw.raid, /* sanitizeRaidItem */ ((x) => x as RaidItem | null)); // replace with real
  const changes = sanitizeArr<ChangeItem>(raw.changes, sanitizeChangeItem);
  const stakeholders = sanitizeArr<Stakeholder>(raw.stakeholders, sanitizeStakeholder);
  const budgets = sanitizeArr<BudgetBucket>(raw.budgets, sanitizeBudgetBucket);
  if (tasks) seed.tasks = tasks;
  if (milestones) seed.milestones = milestones;
  if (rd) seed.raid = rd;
  if (changes) seed.changes = changes;
  if (stakeholders) seed.stakeholders = stakeholders;
  if (budgets) seed.budgets = budgets;
  return Object.keys(seed).length ? seed : undefined;
}

export function sanitizeTemplate(raw: unknown): ProjectTemplate | null {
  if (!isObj(raw)) return null;
  const id = nonEmptyStr(raw.id);
  const name = nonEmptyStr(raw.name);
  if (!id || !name) return null;
  const tpl: ProjectTemplate = {
    id,
    name,
    features: sanitizeFeatures(raw.features),
    fieldVisibility: sanitizeFieldVisibility(raw.fieldVisibility) ?? {},
  };
  const desc = nonEmptyStr(raw.description);
  if (desc) tpl.description = desc;
  const seed = sanitizeSeed(raw.seed);
  if (seed) tpl.seed = seed;
  // builtIn is never honored from stored data (a user template can't masquerade as built-in)
  return tpl;
}

export function sanitizeTemplates(raw: unknown): ProjectTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeTemplate).filter((t): t is ProjectTemplate => t !== null);
}
```

> Replace the two `/* sanitizeTask */` / `/* sanitizeRaidItem */` placeholders with the real sanitizers from Step 1. If a single-item Task sanitizer does not exist, write a minimal one inline in `templates.ts` that validates `{ id:number>0, taskName:string }` using the existing field sanitizers — but PREFER the canonical one. The fallback `((x)=>x as T)` casts in the code above MUST be replaced; do not ship raw casts.

- [ ] **Step 5: Run** `npx vitest run src/app/templates.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/app/templates.ts src/app/templates.test.ts
git commit -m "feat: add ProjectTemplate types and sanitizers"
```

---

## Task 2: Settings wiring (`Settings.templates`)

**Files:** Modify `src/app/settings-types.ts`, `src/app/use-settings.ts`. Test: `src/app/use-settings.test.ts` (add a case; the file likely exists).

- [ ] **Step 1: Write the failing test** (append to `src/app/use-settings.test.ts`; if absent, create it mirroring an existing settings test):

```ts
import { describe, expect, it } from "vitest";
import { sanitizeTemplates } from "./templates";
// If use-settings exposes a pure merge/parse helper, test that; otherwise test sanitizeTemplates is wired.
describe("settings templates field", () => {
  it("defaults to [] and round-trips valid templates", () => {
    const stored = JSON.stringify({ templates: [{ id: "t", name: "T", features: [], fieldVisibility: {} }] });
    const parsed = JSON.parse(stored);
    expect(sanitizeTemplates(parsed.templates)).toHaveLength(1);
    expect(sanitizeTemplates(undefined)).toEqual([]);
  });
});
```
(This is a thin guard; the real integration is the merge edit below — verified by tsc + the full suite.)

- [ ] **Step 2: Implement** in `settings-types.ts`:
  - Add to the `Settings` type (after `versionHistoryRetention?`): `templates?: ProjectTemplate[];`
  - Import the type: `import type { ProjectTemplate } from "./templates";`
  - Add to `defaultSettings`: `templates: [],`

- [ ] **Step 3: Implement** in `use-settings.ts`:
  - Import: `import { sanitizeTemplates } from "./templates";`
  - In the `merged` object, add: `templates: sanitizeTemplates((parsed as Record<string, unknown>).templates),`

- [ ] **Step 4: Run** `npx vitest run src/app/use-settings.test.ts` → PASS. `npm run test:run` → green (settings persistence unaffected). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts
git commit -m "feat: persist user templates in Settings.templates"
```

---

## Task 3: Built-in starters (`templates-builtin.ts`)

**Files:** Create `src/app/templates-builtin.ts`, `src/app/templates-builtin.test.ts`.

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import { sanitizeTemplate } from "./templates";
import { ALL_MODULE_IDS } from "./feature-modules";

describe("BUILT_IN_TEMPLATES", () => {
  it("has three starters, all marked builtIn with unique ids", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(3);
    for (const t of BUILT_IN_TEMPLATES) expect(t.builtIn).toBe(true);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(3);
  });
  it("each built-in survives sanitizeTemplate (valid shape, ignoring builtIn flag)", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const s = sanitizeTemplate(t);
      expect(s, t.id).not.toBeNull();
      expect(s!.name.length).toBeGreaterThan(0);
    }
  });
  it("Full delivery enables all modules; Minimal enables none", () => {
    const full = BUILT_IN_TEMPLATES.find((t) => t.id === "builtin-full")!;
    const min = BUILT_IN_TEMPLATES.find((t) => t.id === "builtin-minimal")!;
    expect([...full.features].sort()).toEqual([...ALL_MODULE_IDS].sort());
    expect(min.features).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/app/templates-builtin.ts`. Build three `ProjectTemplate`s with `builtIn: true`. Use `applyTier(modalId, tier)` from `field-visibility.ts` to build the `fieldVisibility` per modal so tiers match the registry. Seed content uses small numeric ids (1,2,3…) — they are template-local and get remapped on apply.

```ts
import type { ProjectTemplate } from "./templates";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { applyTier, type FieldVisibilityConfig } from "./field-visibility";
import { MODAL_IDS } from "./modal-fields";
import type { FieldTier } from "./modal-fields";

function fvAll(tier: FieldTier): FieldVisibilityConfig {
  const cfg: FieldVisibilityConfig = {};
  for (const id of MODAL_IDS) cfg[id] = applyTier(id, tier);
  return cfg;
}

const STANDARD_FEATURES: FeatureModuleId[] = ["dashboard", "gantt", "milestones", "raid", "changes"];

export const BUILT_IN_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "builtin-minimal",
    name: "Minimal",
    description: "Simple mode, fewest fields, a 3-task skeleton.",
    builtIn: true,
    features: [],
    fieldVisibility: fvAll("simple"),
    seed: {
      tasks: [
        { id: 1, taskName: "Kickoff", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] },
        { id: 2, taskName: "Plan the work", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [1] },
        { id: 3, taskName: "Wrap up", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [2] },
      ],
    },
  },
  {
    id: "builtin-standard",
    name: "Standard PM",
    description: "Advanced mode with dashboard, gantt, milestones, RAID and changes; a phased skeleton.",
    builtIn: true,
    features: STANDARD_FEATURES,
    fieldVisibility: fvAll("advanced"),
    seed: {
      tasks: [/* ~12 tasks, ids 1..12, phased, dependencies referencing earlier ids */],
      milestones: [/* ~3 milestones, ids 1..3, linkedTaskIds referencing seed task ids */],
    },
  },
  {
    id: "builtin-full",
    name: "Full delivery",
    description: "All modules, full field detail, a richer skeleton with RAID and stakeholders.",
    builtIn: true,
    features: [...ALL_MODULE_IDS],
    fieldVisibility: fvAll("full"),
    seed: {
      tasks: [/* ~24 tasks */],
      milestones: [/* milestones */],
      raid: [/* a few RAID items, linkedTaskIds referencing seed tasks */],
      stakeholders: [/* a couple stakeholders */],
    },
  },
];
```

> Fill the `/* ... */` seed arrays with CONCRETE objects using the REAL required fields of each entity (read `types.ts` + an existing default/empty-item factory if present, e.g. how the app builds a new Task/Milestone/RaidItem/Stakeholder — search for `newTask`/`emptyTask`/the add-handlers — and mirror the required fields). Every seed object must satisfy its sanitizer (the test in Step 1 runs each built-in through `sanitizeTemplate`, which runs each seed item through its entity sanitizer — so a malformed seed item gets dropped and you'll see the count change). Keep assignees empty and any resource FKs (`ownerResourceId`, `resourceId`) absent/null. Do NOT leave `/* ... */` placeholders in the committed file.

- [ ] **Step 4: Run** `npx vitest run src/app/templates-builtin.test.ts` → PASS. `npx tsc --noEmit` → clean. Add a stronger assertion: each built-in's seed survives sanitize WITHOUT losing items (compare counts) so malformed seed is caught.

- [ ] **Step 5: Commit**
```bash
git add src/app/templates-builtin.ts src/app/templates-builtin.test.ts
git commit -m "feat: add three built-in project templates"
```

---

## Task 4: The pure apply core (`template-apply.ts`) — THE CRUX

**Files:** Create `src/app/template-apply.ts`, `src/app/template-apply.test.ts`.

This re-ids seed content relative to a target workspace, rewrites internal references, drops external/person references, and appends non-destructively. Field-visibility is replaced.

- [ ] **Step 1: Read** `types.ts` to CONFIRM the exact reference field names on RaidItem (does it have a `linkedRaidIds`/predecessor field?), and confirm `Stakeholder.raci` is `Record<string, RaciRole>` keyed by milestone id. Note any field you must remap.

- [ ] **Step 2: Write the failing test** `src/app/template-apply.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyTemplate } from "./template-apply";
import { emptyWorkspace } from "./workspace";
import type { ProjectTemplate } from "./templates";

function tpl(seed: ProjectTemplate["seed"]): ProjectTemplate {
  return { id: "t", name: "T", features: [], fieldVisibility: { task: { fields: ["taskName"] } }, seed };
}

describe("applyTemplate", () => {
  it("replaces fieldVisibility", () => {
    const ws = applyTemplate(emptyWorkspace(), tpl(undefined), { includeSeed: false });
    expect(ws.fieldVisibility?.task.fields).toEqual(["taskName"]);
  });

  it("does not mutate the input workspace (immutable)", () => {
    const base = emptyWorkspace();
    applyTemplate(base, tpl({ tasks: [{ id: 1, taskName: "A", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] }] }), { includeSeed: true });
    expect(base.tasks).toHaveLength(0);
  });

  it("appends seed tasks with fresh ids after the workspace max, remapping internal dependencies", () => {
    const base = { ...emptyWorkspace(), tasks: [{ id: 5, taskName: "Existing", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] }] as any };
    const seedTasks = [
      { id: 1, taskName: "S1", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] },
      { id: 2, taskName: "S2", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [1] },
    ];
    const ws = applyTemplate(base, tpl({ tasks: seedTasks as any }), { includeSeed: true });
    expect(ws.tasks).toHaveLength(3);                      // existing + 2 (non-destructive)
    const s1 = ws.tasks.find((t) => t.taskName === "S1")!;
    const s2 = ws.tasks.find((t) => t.taskName === "S2")!;
    expect(s1.id).toBeGreaterThan(5);                      // fresh ids after max
    expect(s2.id).toBeGreaterThan(5);
    expect(s1.id).not.toBe(s2.id);
    expect(s2.dependencies).toEqual([s1.id]);              // internal ref remapped
  });

  it("does NOT append seed when includeSeed is false", () => {
    const ws = applyTemplate(emptyWorkspace(), tpl({ tasks: [{ id: 1, taskName: "S", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] }] as any }), { includeSeed: false });
    expect(ws.tasks).toHaveLength(0);
  });

  it("drops references that point outside the seed", () => {
    const seedTasks = [{ id: 1, taskName: "S1", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [999] }]; // 999 not in seed
    const ws = applyTemplate(emptyWorkspace(), tpl({ tasks: seedTasks as any }), { includeSeed: true });
    expect(ws.tasks[0].dependencies).toEqual([]);          // external ref dropped
  });

  it("remaps milestone.linkedTaskIds to the new seed task ids", () => {
    const seed = {
      tasks: [{ id: 1, taskName: "S1", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] }] as any,
      milestones: [{ id: 1, name: "M1", date: "", linkedTaskIds: [1] }] as any,
    };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    const newTaskId = ws.tasks[0].id;
    expect(ws.milestones?.[0].linkedTaskIds).toEqual([newTaskId]);
  });
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `src/app/template-apply.ts`:

```ts
import type { Workspace } from "./workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import { nextId } from "./resource-foundation";

export interface ApplyTemplateOptions { includeSeed: boolean; }

// Build oldId -> newId for one collection: new ids start right after the workspace collection's max.
function idMap(existing: ReadonlyArray<{ id: number }>, seed: ReadonlyArray<{ id: number }>): Map<number, number> {
  const map = new Map<number, number>();
  let next = nextId(existing);
  for (const item of seed) { map.set(item.id, next); next += 1; }
  return map;
}
// Remap a list of ids, dropping any not present in the map (external refs).
function remapIds(ids: readonly number[] | undefined, map: Map<number, number>): number[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => map.get(id)).filter((id): id is number => id !== undefined);
}

export function remapSeed(ws: Workspace, seed: TemplateSeed): TemplateSeed {
  const taskMap = idMap(ws.tasks, seed.tasks ?? []);
  const milestoneMap = idMap(ws.milestones ?? [], seed.milestones ?? []);
  const raidMap = idMap(ws.raid, seed.raid ?? []);
  const changeMap = idMap(ws.changes ?? [], seed.changes ?? []);
  const stakeholderMap = idMap(ws.stakeholders ?? [], seed.stakeholders ?? []);
  const budgetMap = idMap(ws.budgets ?? [], seed.budgets ?? []);

  const out: TemplateSeed = {};

  if (seed.tasks) out.tasks = seed.tasks.map((t) => ({
    ...t, id: taskMap.get(t.id)!, dependencies: remapIds(t.dependencies, taskMap),
  }));
  if (seed.milestones) out.milestones = seed.milestones.map((m) => ({
    ...m, id: milestoneMap.get(m.id)!, linkedTaskIds: remapIds(m.linkedTaskIds, taskMap),
  }));
  if (seed.raid) out.raid = seed.raid.map((r) => ({
    ...r, id: raidMap.get(r.id)!,
    linkedTaskIds: remapIds(r.linkedTaskIds, taskMap),
    ownerResourceId: null,                                 // resources not seeded
    // if RaidItem has a linkedRaidIds field, add: linkedRaidIds: remapIds(r.linkedRaidIds, raidMap),
  }));
  if (seed.changes) out.changes = seed.changes.map((c) => ({
    ...c, id: changeMap.get(c.id)!,
    linkedTaskIds: remapIds(c.linkedTaskIds, taskMap),
    linkedRaidIds: remapIds(c.linkedRaidIds, raidMap),
    stakeholderIds: remapIds(c.stakeholderIds, stakeholderMap),
  }));
  if (seed.stakeholders) out.stakeholders = seed.stakeholders.map((s) => {
    const raci: Record<string, (typeof s.raci)[string]> = {};
    for (const [milestoneId, role] of Object.entries(s.raci ?? {})) {
      const newId = milestoneMap.get(Number(milestoneId));
      if (newId !== undefined) raci[String(newId)] = role;  // remap raci keys; drop external
    }
    return { ...s, id: stakeholderMap.get(s.id)!, resourceId: null, raci };
  });
  if (seed.budgets) out.budgets = seed.budgets.map((b) => ({
    ...b, id: budgetMap.get(b.id)!,
    successorId: b.successorId != null ? budgetMap.get(b.successorId) ?? null : null,
  }));

  return out;
}

export function applyTemplate(ws: Workspace, tpl: ProjectTemplate, opts: ApplyTemplateOptions): Workspace {
  const base: Workspace = { ...ws, fieldVisibility: tpl.fieldVisibility };
  if (!opts.includeSeed || !tpl.seed) return base;
  const seed = remapSeed(ws, tpl.seed);
  return {
    ...base,
    tasks: seed.tasks ? [...ws.tasks, ...seed.tasks] : ws.tasks,
    milestones: seed.milestones ? [...(ws.milestones ?? []), ...seed.milestones] : ws.milestones,
    raid: seed.raid ? [...ws.raid, ...seed.raid] : ws.raid,
    changes: seed.changes ? [...(ws.changes ?? []), ...seed.changes] : ws.changes,
    stakeholders: seed.stakeholders ? [...(ws.stakeholders ?? []), ...seed.stakeholders] : ws.stakeholders,
    budgets: seed.budgets ? [...(ws.budgets ?? []), ...seed.budgets] : ws.budgets,
  };
}
```

> Adjust the RaidItem block to remap its real predecessor/link field if it exists (you confirmed the name in Step 1). If TypeScript complains that a remapped object isn't assignable (e.g. extra/typed fields), spread the original first (`{ ...r, ... }`) — already done — and only override the specific id/ref fields. Do not cast to `any` in the implementation.

- [ ] **Step 5: Run** `npx vitest run src/app/template-apply.test.ts` → PASS. `npx tsc --noEmit` → clean. (The test casts seed literals with `as any` for brevity — that's fine in TEST code; the implementation must stay cast-free.)

- [ ] **Step 6: Commit**
```bash
git add src/app/template-apply.ts src/app/template-apply.test.ts
git commit -m "feat: add pure applyTemplate with seed re-id and reference remap"
```

---

## Task 5: `templateFromWorkspace` (save-as builder)

**Files:** Modify `src/app/templates.ts`; add tests to `src/app/templates.test.ts`.

- [ ] **Step 1: Write the failing test** (append):

```ts
import { templateFromWorkspace } from "./templates";
import { emptyWorkspace } from "./workspace";

describe("templateFromWorkspace", () => {
  it("captures features + fieldVisibility, no seed when includeContent is false", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName"] } } };
    const t = templateFromWorkspace(ws, ["raid"], { name: "My T", includeContent: false }, "id1");
    expect(t.id).toBe("id1");
    expect(t.name).toBe("My T");
    expect(t.features).toEqual(["raid"]);
    expect(t.fieldVisibility.task.fields).toEqual(["taskName"]);
    expect(t.seed).toBeUndefined();
    expect(t.builtIn).toBeFalsy();
  });
  it("captures seedable content when includeContent is true", () => {
    const ws = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "A", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] }] as any };
    const t = templateFromWorkspace(ws, [], { name: "T", includeContent: true }, "id2");
    expect(t.seed?.tasks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `templates.ts` (add to the file):

```ts
import type { Workspace } from "./workspace";
import { sanitizeFieldVisibility } from "./field-visibility"; // already importing? keep one import

export interface SaveTemplateInput {
  name: string;
  description?: string;
  includeContent: boolean;
}

export function templateFromWorkspace(
  ws: Workspace,
  features: readonly FeatureModuleId[],
  input: SaveTemplateInput,
  newId: string,
): ProjectTemplate {
  const tpl: ProjectTemplate = {
    id: newId,
    name: input.name.trim(),
    features: sanitizeFeatures(features),
    fieldVisibility: sanitizeFieldVisibility(ws.fieldVisibility) ?? {},
  };
  if (input.description?.trim()) tpl.description = input.description.trim();
  if (input.includeContent) {
    const seed: TemplateSeed = {};
    if (ws.tasks.length) seed.tasks = ws.tasks;
    if (ws.milestones?.length) seed.milestones = ws.milestones;
    if (ws.raid.length) seed.raid = ws.raid;
    if (ws.changes?.length) seed.changes = ws.changes;
    if (ws.stakeholders?.length) seed.stakeholders = ws.stakeholders;
    if (ws.budgets?.length) seed.budgets = ws.budgets;
    if (Object.keys(seed).length) tpl.seed = seed;
  }
  return tpl;
}
```

- [ ] **Step 4: Run** `npx vitest run src/app/templates.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/templates.ts src/app/templates.test.ts
git commit -m "feat: add templateFromWorkspace (save current project as template)"
```

---

## Task 6: `useTemplates` hook

**Files:** Create `src/app/use-templates.ts`, `src/app/use-templates.test.tsx`.

- [ ] **Step 1: Read** `use-settings.ts` to confirm how the rest of the app reads/writes settings (the `useSettings()` hook returns `{ settings, writeSettings }` or similar — confirm the setter name). The hook will read `settings.templates ?? []` and write via that setter.

- [ ] **Step 2: Write the failing test** `src/app/use-templates.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTemplates } from "./use-templates";

afterEach(() => window.localStorage.clear());

describe("useTemplates", () => {
  it("merges built-ins with user templates", () => {
    const { result } = renderHook(() => useTemplates());
    expect(result.current.templates.length).toBeGreaterThanOrEqual(3);     // built-ins present
    expect(result.current.userTemplates).toEqual([]);
  });
  it("adds, updates, and removes user templates", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.addTemplate({ id: "u1", name: "Mine", features: [], fieldVisibility: {} }));
    expect(result.current.userTemplates.map((t) => t.id)).toContain("u1");
    act(() => result.current.updateTemplate("u1", { name: "Renamed" }));
    expect(result.current.userTemplates.find((t) => t.id === "u1")!.name).toBe("Renamed");
    act(() => result.current.removeTemplate("u1"));
    expect(result.current.userTemplates).toEqual([]);
  });
  it("duplicate of a built-in creates an editable user copy", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.duplicateTemplate("builtin-minimal"));
    const copy = result.current.userTemplates[0];
    expect(copy.builtIn).toBeFalsy();
    expect(copy.id).not.toBe("builtin-minimal");
    expect(copy.name).toMatch(/Minimal/);
  });
  it("update/remove are no-ops on built-in ids", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.removeTemplate("builtin-minimal"));
    expect(result.current.templates.some((t) => t.id === "builtin-minimal")).toBe(true);
  });
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `src/app/use-templates.ts`:

```ts
import { useCallback, useMemo } from "react";
import { useSettings } from "./use-settings";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import type { ProjectTemplate } from "./templates";

export function useTemplates() {
  const { settings, writeSettings } = useSettings(); // adjust to the real hook return (Step 1)
  const userTemplates = useMemo(() => settings.templates ?? [], [settings.templates]);
  const templates = useMemo(() => [...BUILT_IN_TEMPLATES, ...userTemplates], [userTemplates]);

  const writeUser = useCallback(
    (next: ProjectTemplate[]) => writeSettings({ ...settings, templates: next }),
    [settings, writeSettings],
  );

  const addTemplate = useCallback((t: ProjectTemplate) => writeUser([...userTemplates, { ...t, builtIn: false }]), [userTemplates, writeUser]);
  const updateTemplate = useCallback(
    (id: string, patch: Partial<ProjectTemplate>) =>
      writeUser(userTemplates.map((t) => (t.id === id ? { ...t, ...patch, id: t.id, builtIn: false } : t))),
    [userTemplates, writeUser],
  );
  const removeTemplate = useCallback((id: string) => writeUser(userTemplates.filter((t) => t.id !== id)), [userTemplates, writeUser]);
  const duplicateTemplate = useCallback((id: string) => {
    const src = [...BUILT_IN_TEMPLATES, ...userTemplates].find((t) => t.id === id);
    if (!src) return;
    const copy: ProjectTemplate = { ...src, id: `tpl-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: `${src.name} copy`, builtIn: false };
    writeUser([...userTemplates, copy]);
  }, [userTemplates, writeUser]);

  return { templates, userTemplates, addTemplate, updateTemplate, removeTemplate, duplicateTemplate };
}
```

> `Date.now()`/`Math.random()` for the copy id are fine in app runtime code (only workflow SCRIPTS forbid them). If the app has a `crypto.randomUUID()` convention for ids (the create-project flow uses it), prefer `crypto.randomUUID()` for the new template id — check and match. Adjust `useSettings()`'s destructure to the real return shape from Step 1 (it may be `const settings = useSettings()` with a separate `writeSettings` import — match exactly).

- [ ] **Step 5: Run** `npx vitest run src/app/use-templates.test.tsx` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/app/use-templates.ts src/app/use-templates.test.tsx
git commit -m "feat: add useTemplates hook (merge built-ins, CRUD over settings)"
```

---

## Task 7: Templates Settings section

**Files:** Create `src/app/settings-sections/templates-section.tsx`, `src/app/settings-sections/templates-section.test.tsx`. Modify `src/app/settings-view.tsx`, `src/app/settings-menu.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n keys** — add to `i18n.ts` (EN) and `i18n.de.ts` (DE, identical keys): `settingsSectionTemplates` ("Templates"/"Vorlagen"), `templatesIntro`, `templatesBuiltInLabel` ("Built-in"/"Vorinstalliert"), `templatesYoursLabel` ("Your templates"/"Eigene Vorlagen"), `templatesDuplicate`/`templatesRename`/`templatesDelete`/`templatesEmpty`, `templatesSaveCurrent` ("Save current project as a template…"/"Aktuelles Projekt als Vorlage speichern…"). Grep each first; after editing de.ts run `grep -nP '[“”]' src/app/i18n.de.ts` and fix stray curly quotes. Keep EN/DE key sets identical.

- [ ] **Step 2: Write the failing test** `templates-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TemplatesSection } from "./templates-section";
import { t } from "../i18n";

afterEach(() => window.localStorage.clear());

describe("TemplatesSection", () => {
  it("lists the three built-in templates", () => {
    render(<TemplatesSection lang="en-US" />);
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.getByText("Standard PM")).toBeInTheDocument();
    expect(screen.getByText("Full delivery")).toBeInTheDocument();
  });
  it("duplicating a built-in adds a user template row", () => {
    render(<TemplatesSection lang="en-US" />);
    const dupButtons = screen.getAllByRole("button", { name: t("en-US", "templatesDuplicate") });
    fireEvent.click(dupButtons[0]);
    expect(screen.getByText(/copy/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `templates-section.tsx` using `useTemplates()`. Props: `{ lang: Lang }` (it reads/writes via the hook, like sections that self-manage). Render an intro, a "Built-in" group (each row: name + summary + a **Duplicate** button) and a "Your templates" group (each row: name + **Rename**/**Delete**; Rename via an inline text input or `window.prompt`-free inline edit — prefer an inline input toggled by a Rename button to stay test-friendly), and a **Save current project as a template…** button that is wired in Task 8 (here it can be a button that calls an optional `onSaveCurrent?` prop; if the section can't reach the workspace, leave the Save button to Task 8 — render it disabled/with a TODO-free note, OR omit it here and add in Task 8). Use AIPM palette tokens (grep an existing settings-section for classNames). Each built-in row shows a short summary: mode (derive from `features.length`: 0→Simple, all→Full, else Modular) + seed counts.

```tsx
import type { Lang } from "../i18n";
import { t } from "../i18n";
import { useTemplates } from "../use-templates";
import { ALL_MODULE_IDS } from "../feature-modules";

function modeLabel(lang: Lang, features: readonly string[]): string {
  if (features.length === 0) return t(lang, "modeSimple");          // reuse existing mode labels if present
  if (features.length >= ALL_MODULE_IDS.length) return t(lang, "modeAdvanced");
  return t(lang, "modeModular");
}

interface TemplatesSectionProps { lang: Lang; }

export function TemplatesSection({ lang }: TemplatesSectionProps) {
  const { templates, userTemplates, removeTemplate, updateTemplate, duplicateTemplate } = useTemplates();
  const builtIns = templates.filter((x) => x.builtIn);
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted">{t(lang, "templatesIntro")}</p>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted mb-1">{t(lang, "templatesBuiltInLabel")}</div>
        {builtIns.map((tpl) => (
          <div key={tpl.id} className="flex items-center justify-between border border-line rounded-md px-3 py-2 mb-1.5">
            <span className="text-sm"><strong>{tpl.name}</strong> <span className="text-muted">· {modeLabel(lang, tpl.features)}</span></span>
            <button type="button" className="text-xs text-AIPM-green" onClick={() => duplicateTemplate(tpl.id)}>{t(lang, "templatesDuplicate")}</button>
          </div>
        ))}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted mb-1">{t(lang, "templatesYoursLabel")}</div>
        {userTemplates.length === 0 && <div className="text-sm text-muted">{t(lang, "templatesEmpty")}</div>}
        {userTemplates.map((tpl) => (
          <div key={tpl.id} className="flex items-center justify-between border border-line rounded-md px-3 py-2 mb-1.5">
            <input className="text-sm bg-transparent" defaultValue={tpl.name} aria-label={tpl.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tpl.name) updateTemplate(tpl.id, { name: v }); }} />
            <button type="button" className="text-xs text-AIPM-dark-blue" onClick={() => removeTemplate(tpl.id)}>{t(lang, "templatesDelete")}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
```
> Match the real palette/muted-text tokens (grep `appearance-section.tsx`). If `modeSimple`/`modeModular`/`modeAdvanced` keys don't exist, reuse whatever mode labels `mode-section.tsx` uses, or inline plain text. The inline rename-on-blur keeps the test simple; if the app prefers an explicit Rename button, add one.

- [ ] **Step 5: Register the section** in `settings-view.tsx`: import `TemplatesSection`; add `{ id: "templates", labelKey: "settingsSectionTemplates" }` to the `RAIL` array (place it right after `mode`); add `{active === "templates" && <TemplatesSection lang={lang} />}` to the render. Also add to `settings-menu.tsx` (import + inline render in the stacked dropdown) for the classic layout. Confirm `SectionId` union includes `"templates"`.

- [ ] **Step 6: Run** `npx vitest run src/app/settings-sections/templates-section.test.tsx` → PASS. `npm run test:run` → green. `npx tsc --noEmit` clean. `npm run lint` → 0 warnings.

- [ ] **Step 7: Commit**
```bash
git add src/app/settings-sections/templates-section.tsx src/app/settings-sections/templates-section.test.tsx src/app/settings-view.tsx src/app/settings-menu.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add Templates settings section (list, duplicate, rename, delete)"
```

---

## Task 8: Save / Apply action-menu entries

**Files:** Create `src/app/template-menus.tsx`, `src/app/template-menus.test.tsx`. Modify `src/app/action-menus.tsx` + its parent (`task-manager.tsx` or wherever ActionMenus is rendered with workspace access). Modify `i18n.ts`/`i18n.de.ts`.

- [ ] **Step 1: i18n keys** — add (EN+DE): `templateApplyTitle` ("Apply template to current project"), `templateApplyAction` ("Apply"), `templatePick` ("Template"), `templateIncludeSeed` ("Also add starter content"), `templateSeedSummary` (a `{0}`-arg "{0} starter items" or compose counts), `templateSaveTitle` ("Save project as a template"), `templateSaveName` ("Name"), `templateIncludeContent` ("Include current content as starter"), `templateSaveAction` ("Save"). Grep first; verify de.ts curly quotes; keep EN/DE identical.

- [ ] **Step 2: Write the failing test** `template-menus.test.tsx` — render `ApplyTemplateMenu` with a fake `onApply` and a couple of templates; open it, pick a template, toggle include-seed, click Apply; assert `onApply(templateId, { includeSeed })` was called. Render `SaveTemplateMenu` with `onSave`; type a name, click Save; assert `onSave({ name, includeContent })`. (Write concrete assertions; reuse the provider wrapper pattern only if these components call workspace/settings hooks — design them to take data via props so they're testable in isolation.)

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `template-menus.tsx` — two small dropdown/dialog components mirroring `ExportMenu`'s structure (a trigger button + a popover). They are PRESENTATIONAL: they take `templates`/handlers via props and render the pick + toggles + action button. No direct hook calls inside (so they're unit-testable and match the ExportMenu "data via props" pattern).
  - `ApplyTemplateMenu({ lang, templates, onApply })`: dropdown to pick a template, a checkbox for include-seed showing the seed summary (counts from `tpl.seed`), Apply button → `onApply(tpl.id, { includeSeed })`.
  - `SaveTemplateMenu({ lang, onSave })`: name input, include-content checkbox, Save button → `onSave({ name, includeContent })`.

- [ ] **Step 5: Wire into `action-menus.tsx`** — add props to `ActionMenusProps`: `templates: ProjectTemplate[]`, `onApplyTemplate(id, opts)`, `onSaveTemplate(input)`. Render `<SaveTemplateMenu .../>` and `<ApplyTemplateMenu .../>` alongside `ExportMenu`. Then in the PARENT that renders `<ActionMenus>` (grep for `<ActionMenus`), wire the handlers:
  - `templates` ← `useTemplates().templates`.
  - `onApplyTemplate(id, opts)` → find the template, compute `next = applyTemplate(currentWorkspace, tpl, opts)` (build `currentWorkspace` from the workspace context the same way the save path does — OR call `applyTemplate` and then push each changed collection through the setters: `setFieldVisibility(tpl.fieldVisibility)`, and if `opts.includeSeed`, `setTasks(next.tasks)`, `setMilestones(next.milestones)`, `setRaid(next.raid)`, `setChanges(next.changes)`, `setStakeholders(next.stakeholders)`, `setBudgets(next.budgets)`). The setters trigger the existing autosave.
  - `onSaveTemplate(input)` → `addTemplate(templateFromWorkspace(currentWorkspace, settings.features, input, crypto.randomUUID()))`.
  - Show a toast on success (reuse the existing toast mechanism).

> The parent already has access to the workspace collections + setters (it renders ActionMenus inside the providers). Read how the parent builds a Workspace for saving (the Explore notes `currentWorkspace()` in use-storage-backend, but ActionMenus' parent may assemble from `useWorkspace()` directly) and reuse that to pass a complete `Workspace` to `applyTemplate`. Apply must go through the SAME setters the rest of the app uses so autosave fires.

- [ ] **Step 6: Run** the new test + `npm run test:run` (existing action-menus tests may need the new required props — give them sensible defaults: `templates = []`, `onApplyTemplate`/`onSaveTemplate` default to no-ops, OR update the existing action-menus test to pass them). `npx tsc --noEmit` clean. `npm run lint` 0 warnings.

- [ ] **Step 7: Commit**
```bash
git add src/app/template-menus.tsx src/app/template-menus.test.tsx src/app/action-menus.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: Save/Apply template entries in the actions menu"
```

---

## Task 9: Integration test + docs

**Files:** Create `src/app/templates.integration.test.tsx`. Modify `docs/CODEMAPS/frontend.md`.

- [ ] **Step 1: Integration test** — apply each built-in to an `emptyWorkspace()` with `includeSeed: true` and assert: (a) `fieldVisibility` is set; (b) seed counts appended correctly; (c) no id collisions (all task ids unique); (d) every remapped internal reference points at an appended item (no dangling internal refs); (e) applying with `includeSeed:false` only sets field-visibility. Also assert `sanitizeTemplates(BUILT_IN_TEMPLATES)` keeps all 3 (round-trip).

```tsx
import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import { applyTemplate } from "./template-apply";
import { sanitizeTemplates } from "./templates";
import { emptyWorkspace } from "./workspace";

describe("templates integration", () => {
  it("every built-in applies cleanly with seed", () => {
    for (const tpl of BUILT_IN_TEMPLATES) {
      const ws = applyTemplate(emptyWorkspace(), tpl, { includeSeed: true });
      expect(ws.fieldVisibility).toBeDefined();
      const ids = ws.tasks.map((t) => t.id);
      expect(new Set(ids).size, `${tpl.id} task id collision`).toBe(ids.length);
      for (const t of ws.tasks) for (const dep of t.dependencies) {
        expect(ids, `${tpl.id} dangling dep`).toContain(dep);
      }
    }
  });
  it("built-ins survive sanitize round-trip", () => {
    expect(sanitizeTemplates(BUILT_IN_TEMPLATES)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run** → PASS.

- [ ] **Step 3: Docs** — add a short `## Templates` subsection to `docs/CODEMAPS/frontend.md` (match its style): `templates.ts` (types/sanitizers/save-as), `templates-builtin.ts`, `template-apply.ts` (`applyTemplate`/`remapSeed`), `use-templates.ts`, the Settings section + action-menu Save/Apply, persisted in `Settings.templates[]`.

- [ ] **Step 4: Full gates** — `npm run test:run` + `npm run lint` + `npm run build` all green.

- [ ] **Step 5: Commit**
```bash
git add src/app/templates.integration.test.tsx docs/CODEMAPS/frontend.md
git commit -m "test: templates integration; document the templates framework"
```

---

## Self-Review notes (for the executor)

- **No release/version bump here** — the orchestrator cuts the release after the final review (mirrors sub-project #1).
- **Crux is Task 4** (`remapSeed`). The integration test (Task 9) re-checks dangling refs across all built-ins — run it after any seed change.
- **Features are NOT applied** by `applyTemplate` in #2 (deferred to #3). The Apply dialog only sets field-visibility + seed. Don't wire features into the apply path here.
- **No byte-stability surface** — templates never touch the workspace CSV/MD/Turso/JSON codecs; they live only in the settings localStorage blob. Don't add codec changes.
- **Replace every `/* ... */` and cast placeholder** in Tasks 1 & 3 with real code before committing (the no-placeholder rule). Test-code `as any` on seed literals is acceptable; implementation code must be cast-free.
- **i18n**: keep EN/DE key sets identical; grep de.ts for curly quotes after each edit.
