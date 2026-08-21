# Modal Field-Visibility Framework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every entity edit modal a Simple/Advanced/Full field-view switcher plus a cog for per-field show/hide, persisted per project on the Workspace, defaulting to Advanced.

**Architecture:** A pure `modal-fields.ts` registry defines each modal's fields and their tier; a pure `field-visibility.ts` resolver turns a stored visible-set (or undefined) into the set of visible field ids; a new optional `Workspace.fieldVisibility` singleton persists per project (JSON in the existing Turso `meta` KV table, dedicated byte-stable CSV/MD sections, JSON envelope); a `useModalVisibility` hook + `<ModalFieldControls>` component wire the switcher/cog into each modal with `isVisible(id) && (…)` guards.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + @testing-library/react, existing codec layer (csv-codecs.ts, markdown-codecs.ts, turso-schema.ts), WorkspaceProvider context.

**Spec:** `docs/superpowers/specs/2026-06-12-modal-field-visibility-design.md`

**Conventions:**
- Run a single test file: `npx vitest run src/app/<file>.test.ts`
- Run all tests: `npm run test:run`
- Lint gate is `--max-warnings=0`; build runs `tsc`. No `console.log`. Immutable updates only.
- Commit messages: conventional (`feat:`/`test:`/`refactor:`). No attribution footer.

---

## File Structure

| File | Responsibility | New? |
|------|----------------|------|
| `src/app/modal-fields.ts` | `MODAL_FIELDS` registry, `ModalId`/`FieldTier`/`ModalField` types | new |
| `src/app/modal-fields.test.ts` | Registry invariants | new |
| `src/app/field-visibility.ts` | Pure resolver: `tierFields`/`visibleFields`/`applyTier`/`toggleField`/`tierOf` + `ModalVisibility`/`FieldVisibilityConfig` types + `sanitizeFieldVisibility` | new |
| `src/app/field-visibility.test.ts` | Resolver + sanitizer tests | new |
| `src/app/workspace.ts` | Add optional `fieldVisibility` field; include in `workspaceToJson`/`jsonToWorkspace` | modify |
| `src/app/csv-codecs.ts` | `fieldVisibilityToCsv`/`csvToFieldVisibility` + section wiring | modify |
| `src/app/markdown-codecs.ts` | `fieldVisibilityToMarkdown`/`markdownToFieldVisibility` + section wiring | modify |
| `src/app/turso-schema.ts` | Persist/read `field_visibility` row in `meta`; dirty detection | modify |
| `src/app/workspace-context.tsx` | `fieldVisibility` + `setFieldVisibility` | modify |
| `src/app/use-storage-backend.ts` | Bridge load/save of `fieldVisibility` | modify |
| `src/app/use-modal-visibility.ts` | Hook bridging resolver ↔ context | new |
| `src/app/use-modal-visibility.test.tsx` | Hook tests | new |
| `src/app/modal-field-controls.tsx` | Segmented control + cog popover | new |
| `src/app/modal-field-controls.test.tsx` | Component tests | new |
| `src/app/i18n.ts` / `i18n.de.ts` | New keys | modify |
| `task-form-fields.tsx`, `task-form-modal.tsx`, `task-edit-view.tsx` | Task wiring (controls + guards) | modify |
| `raid-edit-modal.tsx`, `change-edit-modal.tsx`, `milestone-edit-modal.tsx`, `stakeholder-edit-modal.tsx`, `resource-edit-modal.tsx`, `absence-edit-modal.tsx`, `budget-bucket-modal.tsx` | Per-modal wiring | modify |

---

## Task 1: Field registry (`modal-fields.ts`)

**Files:**
- Create: `src/app/modal-fields.ts`
- Test: `src/app/modal-fields.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/modal-fields.test.ts
import { describe, expect, it } from "vitest";
import { MODAL_FIELDS, MODAL_IDS, type ModalId } from "./modal-fields";

const TIER_RANK = { simple: 0, advanced: 1, full: 2 } as const;

describe("MODAL_FIELDS registry", () => {
  it("covers all 8 modals", () => {
    expect(MODAL_IDS).toEqual([
      "task", "raid", "change", "milestone",
      "stakeholder", "resource", "absence", "budget",
    ]);
  });

  it("every modal has unique field ids", () => {
    for (const id of MODAL_IDS) {
      const ids = MODAL_FIELDS[id].map((f) => f.id);
      expect(new Set(ids).size, `${id} has duplicate ids`).toBe(ids.length);
    }
  });

  it("every required field is in the simple tier (so it's always shown)", () => {
    for (const id of MODAL_IDS) {
      for (const f of MODAL_FIELDS[id]) {
        if (f.required) expect(TIER_RANK[f.tier], `${id}.${f.id}`).toBe(0);
      }
    }
  });

  it("each modal has at least one simple field", () => {
    for (const id of MODAL_IDS) {
      expect(MODAL_FIELDS[id].some((f) => f.tier === "simple"), id).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/modal-fields.test.ts`
Expected: FAIL — cannot find module `./modal-fields`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/modal-fields.ts
import type { TranslationKey } from "./i18n";

export type FieldTier = "simple" | "advanced" | "full";

export interface ModalField {
  /** Stable id, unique within its modal. Used as the persisted key and the guard arg. */
  id: string;
  /** Existing i18n key for the field's label (reused for the cog checklist). */
  labelKey: TranslationKey;
  /** Lowest tier in which the field appears; it also shows in every higher tier. */
  tier: FieldTier;
  /** Required/validated fields are always shown and locked in the cog. */
  required?: boolean;
}

export type ModalId =
  | "task" | "raid" | "change" | "milestone"
  | "stakeholder" | "resource" | "absence" | "budget";

export const MODAL_IDS: readonly ModalId[] = [
  "task", "raid", "change", "milestone",
  "stakeholder", "resource", "absence", "budget",
] as const;

// Tiers nest: a "simple" field shows in S/A/F; "advanced" in A/F; "full" in F only.
export const MODAL_FIELDS: Record<ModalId, readonly ModalField[]> = {
  task: [
    { id: "taskName", labelKey: "taskName", tier: "simple", required: true },
    { id: "assignee", labelKey: "assignee", tier: "simple" },
    { id: "dueDate", labelKey: "dueDate", tier: "simple" },
    { id: "status", labelKey: "status", tier: "simple" },
    { id: "notes", labelKey: "notes", tier: "simple" },
    { id: "priority", labelKey: "priority", tier: "advanced" },
    { id: "startDate", labelKey: "startDate", tier: "advanced" },
    { id: "estimate", labelKey: "originalEstimate", tier: "advanced" },
    { id: "labels", labelKey: "labels", tier: "advanced" },
    { id: "dependencies", labelKey: "dependencies", tier: "advanced" },
    { id: "blockers", labelKey: "blockers", tier: "advanced" },
    { id: "health", labelKey: "health", tier: "advanced" },
    { id: "email", labelKey: "email", tier: "full" },
    { id: "timeSpent", labelKey: "timeSpent", tier: "full" },
    { id: "lastUpdate", labelKey: "lastUpdate", tier: "full" },
    { id: "completedDate", labelKey: "completedDate", tier: "full" },
    { id: "jiraLink", labelKey: "jiraLink", tier: "full" },
    { id: "healthOverride", labelKey: "healthOverride", tier: "full" },
  ],
  raid: [
    { id: "title", labelKey: "title", tier: "simple", required: true },
    { id: "category", labelKey: "category", tier: "simple" },
    { id: "status", labelKey: "status", tier: "simple" },
    { id: "owner", labelKey: "owner", tier: "simple" },
    { id: "description", labelKey: "description", tier: "simple" },
    { id: "scoring", labelKey: "raidScoring", tier: "advanced" },
    { id: "mitigation", labelKey: "mitigation", tier: "advanced" },
    { id: "targetDate", labelKey: "targetDate", tier: "advanced" },
    { id: "linkedTasks", labelKey: "linkedTasks", tier: "advanced" },
    { id: "riskMatrix", labelKey: "riskMatrix", tier: "full" },
    { id: "raisedDate", labelKey: "raisedDate", tier: "full" },
    { id: "linkedRaid", labelKey: "linkedRaid", tier: "full" },
    { id: "linkedStakeholders", labelKey: "linkedStakeholders", tier: "full" },
  ],
  change: [
    { id: "title", labelKey: "title", tier: "simple", required: true },
    { id: "type", labelKey: "type", tier: "simple" },
    { id: "status", labelKey: "status", tier: "simple" },
    { id: "description", labelKey: "description", tier: "simple" },
    { id: "impact", labelKey: "impact", tier: "advanced" },
    { id: "requestor", labelKey: "requestor", tier: "advanced" },
    { id: "deltas", labelKey: "changeDeltas", tier: "advanced" },
    { id: "decisionDate", labelKey: "decisionDate", tier: "advanced" },
    { id: "links", labelKey: "linkedItems", tier: "full" },
  ],
  milestone: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "targetDate", labelKey: "targetDate", tier: "simple" },
    { id: "description", labelKey: "description", tier: "advanced" },
    { id: "achievedDate", labelKey: "achievedDate", tier: "advanced" },
    { id: "linkedTasks", labelKey: "linkedTasks", tier: "advanced" },
    { id: "documentLinks", labelKey: "documentLinks", tier: "full" },
  ],
  stakeholder: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "organization", labelKey: "organization", tier: "simple" },
    { id: "category", labelKey: "category", tier: "simple" },
    { id: "contact", labelKey: "titleEmail", tier: "advanced" },
    { id: "influenceInterest", labelKey: "influenceInterest", tier: "advanced" },
    { id: "resourceLink", labelKey: "resourceLink", tier: "advanced" },
    { id: "notes", labelKey: "notes", tier: "full" },
    { id: "raci", labelKey: "raci", tier: "full" },
  ],
  resource: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "email", labelKey: "email", tier: "simple" },
    { id: "role", labelKey: "role", tier: "simple" },
    { id: "classification", labelKey: "gradeDiscipline", tier: "advanced" },
    { id: "utilization", labelKey: "utilization", tier: "advanced" },
    { id: "birthday", labelKey: "birthday", tier: "full" },
    { id: "documentLinks", labelKey: "documentLinks", tier: "full" },
  ],
  absence: [
    { id: "resource", labelKey: "resource", tier: "simple", required: true },
    { id: "dates", labelKey: "dateRange", tier: "simple" },
    { id: "reason", labelKey: "reason", tier: "advanced" },
    { id: "cover", labelKey: "cover", tier: "advanced" },
    { id: "coverEmail", labelKey: "coverEmail", tier: "full" },
    { id: "notes", labelKey: "notes", tier: "full" },
  ],
  budget: [
    { id: "name", labelKey: "name", tier: "simple", required: true },
    { id: "funding", labelKey: "funding", tier: "simple" },
    { id: "period", labelKey: "period", tier: "advanced" },
    { id: "burnRate", labelKey: "burnRate", tier: "advanced" },
    { id: "planningFlags", labelKey: "planningDetail", tier: "full" },
  ],
};
```

> **Implementer note:** the `labelKey` values above must be REAL keys in `i18n.ts`. Before finalizing, grep each key (`grep -n '"priority":' src/app/i18n.ts`). For any that don't exist (e.g. `raidScoring`, `changeDeltas`, `titleEmail`, `gradeDiscipline`, `influenceInterest`, `resourceLink`, `dateRange`, `planningDetail`, `linkedItems`, `healthOverride`, `lastUpdate`, `raisedDate`, `linkedRaid`, `linkedStakeholders`, `riskMatrix`, `raci`, `utilization`, `funding`, `burnRate`, `period`, `cover`, `coverEmail`, `targetDate`, `achievedDate`, `decisionDate`, `originalEstimate`, `timeSpent`, `completedDate`, `jiraLink`, `mitigation`, `owner`, `category`), add them in Task 9's i18n step (EN+DE) — the cog reuses them. Keep this list; Task 9 depends on it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/modal-fields.test.ts`
Expected: PASS (4 tests). If a `labelKey` isn't yet in `i18n.ts`, tsc/the test will flag it — add a placeholder key now or defer to Task 9 and use `as TranslationKey` only if blocked (avoid; prefer adding the key).

- [ ] **Step 5: Commit**

```bash
git add src/app/modal-fields.ts src/app/modal-fields.test.ts
git commit -m "feat: add modal-fields registry with tiered field visibility baselines"
```

---

## Task 2: Resolver + sanitizer (`field-visibility.ts`)

**Files:**
- Create: `src/app/field-visibility.ts`
- Test: `src/app/field-visibility.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/field-visibility.test.ts
import { describe, expect, it } from "vitest";
import {
  applyTier, sanitizeFieldVisibility, tierFields, tierOf, toggleField, visibleFields,
} from "./field-visibility";

describe("tierFields", () => {
  it("nests: advanced includes simple, full includes advanced", () => {
    const s = new Set(tierFields("milestone", "simple"));
    const a = new Set(tierFields("milestone", "advanced"));
    const f = new Set(tierFields("milestone", "full"));
    for (const x of s) expect(a.has(x)).toBe(true);
    for (const x of a) expect(f.has(x)).toBe(true);
    expect(s.has("name")).toBe(true);
    expect(s.has("description")).toBe(false);
    expect(a.has("description")).toBe(true);
    expect(f.has("documentLinks")).toBe(true);
  });
});

describe("visibleFields", () => {
  it("defaults to Advanced when config is undefined", () => {
    const vis = visibleFields("milestone", undefined);
    expect(vis.has("description")).toBe(true);   // advanced
    expect(vis.has("documentLinks")).toBe(false); // full
  });
  it("uses the stored field set and drops unknown ids", () => {
    const vis = visibleFields("milestone", { fields: ["name", "ghost"] });
    expect(vis.has("name")).toBe(true);
    expect(vis.has("ghost")).toBe(false);
    expect(vis.has("targetDate")).toBe(false);
  });
});

describe("applyTier / tierOf", () => {
  it("applyTier produces a config whose tierOf is that tier", () => {
    const cfg = applyTier("milestone", "simple");
    expect(tierOf("milestone", cfg)).toBe("simple");
  });
  it("tierOf(undefined) is advanced (the default)", () => {
    expect(tierOf("milestone", undefined)).toBe("advanced");
  });
});

describe("toggleField", () => {
  it("removing a field from advanced yields custom", () => {
    const adv = applyTier("milestone", "advanced");
    const cfg = toggleField("milestone", adv, "description");
    expect(cfg.fields).not.toContain("description");
    expect(tierOf("milestone", cfg)).toBe("custom");
  });
  it("required fields cannot be toggled off", () => {
    const cfg = toggleField("milestone", applyTier("milestone", "simple"), "name");
    expect(cfg.fields).toContain("name");
  });
  it("re-adding a removed field snaps back to the named tier", () => {
    const adv = applyTier("milestone", "advanced");
    const removed = toggleField("milestone", adv, "description");
    const restored = toggleField("milestone", removed, "description");
    expect(tierOf("milestone", restored)).toBe("advanced");
  });
});

describe("sanitizeFieldVisibility", () => {
  it("returns undefined for junk / empty (byte-stability)", () => {
    expect(sanitizeFieldVisibility(undefined)).toBeUndefined();
    expect(sanitizeFieldVisibility(null)).toBeUndefined();
    expect(sanitizeFieldVisibility("x")).toBeUndefined();
    expect(sanitizeFieldVisibility({})).toBeUndefined();
  });
  it("keeps known modals/fields, drops unknown, always re-adds required", () => {
    const out = sanitizeFieldVisibility({
      milestone: { fields: ["targetDate", "ghost"] },
      nope: { fields: ["x"] },
    });
    expect(out).toBeDefined();
    expect(out!.milestone.fields).toContain("name");      // required re-added
    expect(out!.milestone.fields).toContain("targetDate");
    expect(out!.milestone.fields).not.toContain("ghost");
    expect(out!.nope).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/field-visibility.test.ts`
Expected: FAIL — cannot find module `./field-visibility`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/field-visibility.ts
import { MODAL_FIELDS, MODAL_IDS, type FieldTier, type ModalId } from "./modal-fields";

export interface ModalVisibility {
  /** Explicit visible field ids; always includes every required field. */
  fields: readonly string[];
}
export interface FieldVisibilityConfig {
  [modalId: string]: ModalVisibility;
}

const TIER_RANK: Record<FieldTier, number> = { simple: 0, advanced: 1, full: 2 };
const TIERS: readonly FieldTier[] = ["simple", "advanced", "full"];
const DEFAULT_TIER: FieldTier = "advanced";

function knownIds(modalId: ModalId): Set<string> {
  return new Set(MODAL_FIELDS[modalId].map((f) => f.id));
}
function requiredIds(modalId: ModalId): string[] {
  return MODAL_FIELDS[modalId].filter((f) => f.required).map((f) => f.id);
}

/** Field ids belonging to a tier (this tier and all lower ones). */
export function tierFields(modalId: ModalId, tier: FieldTier): string[] {
  const rank = TIER_RANK[tier];
  return MODAL_FIELDS[modalId].filter((f) => TIER_RANK[f.tier] <= rank).map((f) => f.id);
}

/** Visible field ids for a modal given its config (undefined → Advanced default). */
export function visibleFields(modalId: ModalId, cfg?: ModalVisibility): Set<string> {
  const known = knownIds(modalId);
  if (!cfg) return new Set(tierFields(modalId, DEFAULT_TIER));
  return new Set(cfg.fields.filter((id) => known.has(id)));
}

/** Build a config from a tier baseline. */
export function applyTier(modalId: ModalId, tier: FieldTier): ModalVisibility {
  return { fields: tierFields(modalId, tier) };
}

/** Toggle a field in/out of the visible set (required ids are no-ops). */
export function toggleField(
  modalId: ModalId,
  cfg: ModalVisibility,
  fieldId: string,
): ModalVisibility {
  if (requiredIds(modalId).includes(fieldId)) return cfg;
  if (!knownIds(modalId).has(fieldId)) return cfg;
  const set = new Set(cfg.fields);
  if (set.has(fieldId)) set.delete(fieldId);
  else set.add(fieldId);
  // Re-order to registry order for byte-stable serialization.
  const ordered = MODAL_FIELDS[modalId].filter((f) => set.has(f.id)).map((f) => f.id);
  return { fields: ordered };
}

/** Derive the segmented-control label: a named tier if the set matches it exactly, else "custom". */
export function tierOf(modalId: ModalId, cfg?: ModalVisibility): FieldTier | "custom" {
  const have = cfg ? new Set(cfg.fields.filter((id) => knownIds(modalId).has(id)))
                   : new Set(tierFields(modalId, DEFAULT_TIER));
  for (const tier of TIERS) {
    const want = new Set(tierFields(modalId, tier));
    if (want.size === have.size && [...want].every((id) => have.has(id))) return tier;
  }
  return "custom";
}

/** Validate stored config: drop unknown modals/fields, always re-add required, drop empties. */
export function sanitizeFieldVisibility(raw: unknown): FieldVisibilityConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: FieldVisibilityConfig = {};
  for (const modalId of MODAL_IDS) {
    const entry = src[modalId];
    if (!entry || typeof entry !== "object") continue;
    const fieldsRaw = (entry as Record<string, unknown>).fields;
    if (!Array.isArray(fieldsRaw)) continue;
    const known = knownIds(modalId);
    const kept = new Set(fieldsRaw.filter((x): x is string => typeof x === "string" && known.has(x)));
    for (const r of requiredIds(modalId)) kept.add(r);
    const ordered = MODAL_FIELDS[modalId].filter((f) => kept.has(f.id)).map((f) => f.id);
    out[modalId] = { fields: ordered };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/field-visibility.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/field-visibility.ts src/app/field-visibility.test.ts
git commit -m "feat: add field-visibility resolver and config sanitizer"
```

---

## Task 3: Workspace type + JSON envelope

**Files:**
- Modify: `src/app/workspace.ts` (type `Workspace`, `workspaceToJson`, `jsonToWorkspace`)
- Test: `src/app/workspace.test.ts` (add cases; if absent, create it)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/workspace.test.ts  (add to existing file, or create)
import { describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./workspace";

describe("workspace fieldVisibility envelope", () => {
  it("omits fieldVisibility from JSON when undefined (byte-stability)", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(JSON.parse(json)).not.toHaveProperty("fieldVisibility");
  });
  it("round-trips a fieldVisibility config", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { milestone: { fields: ["name", "targetDate"] } } };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.fieldVisibility?.milestone.fields).toEqual(["name", "targetDate"]);
  });
  it("sanitizes junk fieldVisibility on read to undefined", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), fieldVisibility: "bad" });
    expect(jsonToWorkspace(raw).fieldVisibility).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace.test.ts`
Expected: FAIL — `fieldVisibility` not on the type / not round-tripped.

- [ ] **Step 3: Implement**

In `src/app/workspace.ts`:

1. Add the import near the other local imports:
```ts
import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
```

2. Add the field to the `Workspace` type (after `project?`):
```ts
  /** Per-project modal field-visibility config. Optional & additive: when
   *  undefined a workspace serializes byte-for-byte as before (no block / no
   *  JSON key), and every modal falls back to its Advanced default. */
  fieldVisibility?: Readonly<FieldVisibilityConfig>;
```

3. In `workspaceToJson`, where the envelope object is assembled, conditionally include it (mirror how `project`/`status` are added — only when present). Find the object literal returned/stringified and add:
```ts
    ...(ws.fieldVisibility ? { fieldVisibility: ws.fieldVisibility } : {}),
```

4. In `jsonToWorkspace`, after the other singletons are read, add:
```ts
    fieldVisibility: sanitizeFieldVisibility((parsed as Record<string, unknown>).fieldVisibility),
```
(Match the existing destructuring/return style. If `jsonToWorkspace` builds `ws` then assigns optional singletons like `ws.status = …`, instead write `const fv = sanitizeFieldVisibility(...); if (fv) ws.fieldVisibility = fv;` to keep `undefined` truly absent.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/workspace.test.ts`
Expected: PASS. Also run `npm run test:run` for the codec/golden suites to confirm no byte-stability regression.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace.ts src/app/field-visibility.ts src/app/workspace.test.ts
git commit -m "feat: persist fieldVisibility in the workspace JSON envelope"
```

---

## Task 4: CSV codec section

**Files:**
- Modify: `src/app/csv-codecs.ts`
- Test: `src/app/csv-codecs.test.ts` (add cases)

**Context:** singletons emit a named section ONLY when non-empty. Mirror `statusToCsv`/`csvToStatus` and the `workspaceToCsv` orchestration (`csv-codecs.ts:647` and `:922`). Use a section constant like the existing `CSV_SECTION_STATUS`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/csv-codecs.test.ts (add)
import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";

describe("csv fieldVisibility section", () => {
  it("emits no field-visibility section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("field-visibility");
  });
  it("round-trips fieldVisibility through CSV", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName", "assignee"] } } };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.fieldVisibility?.task.fields).toEqual(["taskName", "assignee"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/csv-codecs.test.ts`
Expected: FAIL — section not emitted / not parsed.

- [ ] **Step 3: Implement**

1. Near the other section constants, add: `const CSV_SECTION_FIELD_VIS = "field-visibility";` (match the existing constant naming/style for `CSV_SECTION_STATUS`).

2. Add encoder/decoder (the config is small JSON; store it as a single CSV cell to avoid a bespoke grammar):
```ts
export function fieldVisibilityToCsv(cfg: FieldVisibilityConfig, neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(cfg), neutralize)].join(",");
}
export function csvToFieldVisibility(text: string): FieldVisibilityConfig | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    return sanitizeFieldVisibility(JSON.parse(rows[0][1]));
  } catch {
    return undefined;
  }
}
```
Add imports at the top of `csv-codecs.ts`:
```ts
import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
```

3. In `workspaceToCsv`, beside the `status` push (`csv-codecs.ts:~957`):
```ts
if (enabled("fieldVisibility") && ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0)
  csvPush(CSV_SECTION_FIELD_VIS, fieldVisibilityToCsv(ws.fieldVisibility, neutralize));
```
> If `enabled(section)` is driven by an export-config allowlist that would need a new key, gate only on the value instead (`if (ws.fieldVisibility && Object.keys(...).length > 0)`) — field visibility is not a user-exportable section toggle. Confirm by reading how `enabled` is defined; prefer NOT adding it to the export UI.

4. In `csvToWorkspace`, where sections are dispatched into the workspace (next to `status`), add:
```ts
const fvSection = sections.get(CSV_SECTION_FIELD_VIS);
if (fvSection) { const fv = csvToFieldVisibility(fvSection); if (fv) ws.fieldVisibility = fv; }
```
(Match the actual local variable names for the parsed section map and the workspace being built.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/csv-codecs.test.ts`
Expected: PASS. Run `npm run test:run` to confirm the CSV golden fixture is unchanged (undefined ⇒ no new section).

- [ ] **Step 5: Commit**

```bash
git add src/app/csv-codecs.ts src/app/csv-codecs.test.ts
git commit -m "feat: serialize fieldVisibility in the CSV codec (byte-stable when empty)"
```

---

## Task 5: Markdown codec section

**Files:**
- Modify: `src/app/markdown-codecs.ts`
- Test: `src/app/markdown-codecs.test.ts` (add cases)

**Context:** mirror `statusToMarkdown`/`markdownToStatus` (`markdown-codecs.ts:191`, `:200`) and the `workspaceToMarkdown` push at `:546`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/markdown-codecs.test.ts (add)
import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "./workspace";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";

describe("markdown fieldVisibility section", () => {
  it("emits nothing when undefined", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("Field Visibility");
  });
  it("round-trips fieldVisibility through Markdown", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { raid: { fields: ["title", "status", "owner", "category", "description"] } } };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.fieldVisibility?.raid.fields).toContain("title");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/markdown-codecs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

1. Add imports:
```ts
import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
```

2. Encoder/decoder (store the JSON in a fenced code block under a heading — robust against Markdown escaping):
```ts
export function fieldVisibilityToMarkdown(cfg: FieldVisibilityConfig): string {
  return ["## Field Visibility", "", "```json", JSON.stringify(cfg, null, 2), "```", ""].join("\n");
}
export function markdownToFieldVisibility(md: string): FieldVisibilityConfig | undefined {
  const m = /## Field Visibility\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    return sanitizeFieldVisibility(JSON.parse(m[1]));
  } catch {
    return undefined;
  }
}
```

3. In `workspaceToMarkdown`, beside the `status` push (`:546`):
```ts
if (ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0)
  mdParts.push(fieldVisibilityToMarkdown(ws.fieldVisibility));
```

4. In `markdownToWorkspace`, after other singletons are parsed from the full md text:
```ts
const fv = markdownToFieldVisibility(md);
if (fv) ws.fieldVisibility = fv;
```
(Use the actual parameter name for the full markdown string and the workspace being assembled.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/markdown-codecs.test.ts`
Expected: PASS. Run `npm run test:run` — confirm the Markdown golden fixture (`sample-workspace.md`) is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/markdown-codecs.ts src/app/markdown-codecs.test.ts
git commit -m "feat: serialize fieldVisibility in the Markdown codec (byte-stable when empty)"
```

---

## Task 6: Turso persistence (`meta` KV)

**Files:**
- Modify: `src/app/turso-schema.ts`
- Test: `src/app/turso-schema.test.ts` (add cases)

**Context:** singletons live as JSON rows in the existing `meta` table keyed by a string (`status` ⇒ `"project_status"`, `turso-schema.ts:121`). `meta` is already in `TABLE_NAMES` (`:81`). Dirty detection at `:156` uses reference equality (`if (prev.status !== next.status) dirty.add("meta")`). DO NOT add a new table (the guard test forbids new TABLE_NAMES entries that get swept). Reuse `meta` with key `"field_visibility"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/turso-schema.test.ts (add) — match the existing test's helpers for building meta rows
import { describe, expect, it } from "vitest";
import { dirtyWorkspaceTables } from "./turso-schema";
import { emptyWorkspace } from "./workspace";

describe("turso fieldVisibility (meta KV)", () => {
  it("marks meta dirty when fieldVisibility changes by reference", () => {
    const a = emptyWorkspace();
    const b = { ...a, fieldVisibility: { task: { fields: ["taskName"] } } };
    expect(dirtyWorkspaceTables(a, b).has("meta")).toBe(true);
  });
});
```
> Also add a load test mirroring the existing `status` decode test: build a fake `meta` result containing a `field_visibility` row whose `value` is `JSON.stringify({task:{fields:["taskName","assignee"]}})` using the SAME nested `PipelineResultLike` fixture shape the file already uses, decode the workspace, and assert `ws.fieldVisibility?.task.fields`. Copy the existing status-decode test verbatim and adapt the key/field.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/turso-schema.test.ts`
Expected: FAIL — no dirty marking / no decode.

- [ ] **Step 3: Implement**

1. **Save:** where the `meta` upsert statements are built (the same place `project_status` is written), add a row when `ws.fieldVisibility` is present:
```ts
if (ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0) {
  metaUpserts.push(metaUpsert("field_visibility", JSON.stringify(ws.fieldVisibility)));
}
```
(Use the actual helper that builds a meta upsert statement — mirror the `project_status` line exactly.)

2. **Load:** beside the `project_status` decode (`:121`):
```ts
const fvRow = rowObjects(byTable.get("meta")).find((r) => r.key === "field_visibility");
if (fvRow?.value) {
  const fv = sanitizeFieldVisibility(safeJsonParse(fvRow.value));
  if (fv) ws.fieldVisibility = fv;
}
```
If there's no `safeJsonParse` helper, wrap `JSON.parse` in try/catch like the existing status decode. Add the import:
```ts
import { sanitizeFieldVisibility } from "./field-visibility";
```

3. **Dirty:** beside `if (prev.status !== next.status) dirty.add("meta");` add:
```ts
if (prev.fieldVisibility !== next.fieldVisibility) dirty.add("meta");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/turso-schema.test.ts`
Expected: PASS. Run `npm run test:run` — the `TABLE_NAMES` guard test must still pass (no new table added).

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -m "feat: persist fieldVisibility as a Turso meta KV row"
```

---

## Task 7: WorkspaceProvider + storage bridge

**Files:**
- Modify: `src/app/workspace-context.tsx`
- Modify: `src/app/use-storage-backend.ts`
- Test: `src/app/workspace-context.test.tsx` (add a case)

**Context:** the provider owns every collection + singleton (`status`/`setStatus`, `project`/`setProject`, `workspace-context.tsx:40-103`). The storage bridge maps loaded `Workspace` → setters and reads current state back to save.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/workspace-context.test.tsx (add)
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

describe("workspace-context fieldVisibility", () => {
  it("exposes fieldVisibility state and setter", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper: WorkspaceProvider });
    expect(result.current.fieldVisibility).toBeUndefined();
    act(() => result.current.setFieldVisibility({ task: { fields: ["taskName"] } }));
    expect(result.current.fieldVisibility?.task.fields).toEqual(["taskName"]);
  });
});
```
(Use the same hook accessor the other tests use — if the project exports `useWorkspace`, use it; otherwise read context as the existing tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: FAIL — `fieldVisibility`/`setFieldVisibility` undefined.

- [ ] **Step 3: Implement**

1. In `workspace-context.tsx`:
   - Import the type: `import type { FieldVisibilityConfig } from "./field-visibility";`
   - Add to the `WorkspaceValue` interface:
```ts
  fieldVisibility: FieldVisibilityConfig | undefined;
  setFieldVisibility: Dispatch<SetStateAction<FieldVisibilityConfig | undefined>>;
```
   - In the provider body:
```ts
  const [fieldVisibility, setFieldVisibility] = useState<FieldVisibilityConfig | undefined>(undefined);
```
   - Add `fieldVisibility, setFieldVisibility` to the context `value` object (and to its memo dep array if one exists).

2. In `use-storage-backend.ts`:
   - On LOAD (where it calls `setStatus(ws.status ?? {})`, `setProject(ws.project)`), add:
```ts
   setFieldVisibility(ws.fieldVisibility);
```
   - On SAVE (where it assembles the `Workspace` from current state to hand to the backend, including `status`, `project`), add:
```ts
   fieldVisibility,
```
   - Thread `fieldVisibility`/`setFieldVisibility` from `useWorkspace()` into this hook the same way `status`/`project` are obtained. Ensure `fieldVisibility` is in the save effect's dependency array so the dirty-table autosave fires on change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: PASS. Run `npm run test:run`.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-context.tsx src/app/use-storage-backend.ts src/app/workspace-context.test.tsx
git commit -m "feat: expose fieldVisibility in WorkspaceProvider and storage bridge"
```

---

## Task 8: `useModalVisibility` hook

**Files:**
- Create: `src/app/use-modal-visibility.ts`
- Test: `src/app/use-modal-visibility.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-modal-visibility.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceProvider } from "./workspace-context";
import { useModalVisibility } from "./use-modal-visibility";

const wrapper = WorkspaceProvider;

describe("useModalVisibility", () => {
  it("defaults to Advanced (isVisible true for advanced, false for full)", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    expect(result.current.mode).toBe("advanced");
    expect(result.current.isVisible("description")).toBe(true);   // advanced
    expect(result.current.isVisible("documentLinks")).toBe(false); // full
  });
  it("setMode('simple') hides advanced fields and persists", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    act(() => result.current.setMode("simple"));
    expect(result.current.mode).toBe("simple");
    expect(result.current.isVisible("description")).toBe(false);
  });
  it("toggleField off makes mode custom; reset returns to Advanced", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    act(() => result.current.toggleField("description"));
    expect(result.current.mode).toBe("custom");
    expect(result.current.isVisible("description")).toBe(false);
    act(() => result.current.reset());
    expect(result.current.mode).toBe("advanced");
    expect(result.current.isVisible("description")).toBe(true);
  });
  it("required field stays visible when toggled", () => {
    const { result } = renderHook(() => useModalVisibility("milestone"), { wrapper });
    act(() => result.current.setMode("simple"));
    act(() => result.current.toggleField("name"));
    expect(result.current.isVisible("name")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-modal-visibility.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/app/use-modal-visibility.ts
import { useCallback, useMemo } from "react";
import { useWorkspace } from "./workspace-context";
import type { FieldTier, ModalId } from "./modal-fields";
import {
  applyTier, tierOf, toggleField as toggleFieldPure, visibleFields,
  type FieldVisibilityConfig, type ModalVisibility,
} from "./field-visibility";

export interface ModalVisibilityApi {
  mode: FieldTier | "custom";
  isVisible: (fieldId: string) => boolean;
  setMode: (tier: FieldTier) => void;
  toggleField: (fieldId: string) => void;
  reset: () => void;
}

const DEFAULT_TIER: FieldTier = "advanced";

export function useModalVisibility(modalId: ModalId): ModalVisibilityApi {
  const { fieldVisibility, setFieldVisibility } = useWorkspace();
  const cfg: ModalVisibility | undefined = fieldVisibility?.[modalId];

  const visible = useMemo(() => visibleFields(modalId, cfg), [modalId, cfg]);
  const mode = useMemo(() => tierOf(modalId, cfg), [modalId, cfg]);

  const write = useCallback(
    (next: ModalVisibility | undefined) => {
      setFieldVisibility((prev: FieldVisibilityConfig | undefined) => {
        const base = { ...(prev ?? {}) };
        if (next === undefined) delete base[modalId];
        else base[modalId] = next;
        return Object.keys(base).length > 0 ? base : undefined;
      });
    },
    [modalId, setFieldVisibility],
  );

  const setMode = useCallback((tier: FieldTier) => write(applyTier(modalId, tier)), [modalId, write]);
  const toggle = useCallback(
    (fieldId: string) => write(toggleFieldPure(modalId, cfg ?? applyTier(modalId, DEFAULT_TIER), fieldId)),
    [modalId, cfg, write],
  );
  // Reset to the (future) template default; for sub-project #1 that is the Advanced built-in,
  // represented as "no stored entry" so it tracks any later default change.
  const reset = useCallback(() => write(undefined), [write]);

  const isVisible = useCallback((fieldId: string) => visible.has(fieldId), [visible]);

  return { mode, isVisible, setMode, toggleField: toggle, reset };
}
```
> If the project has no `useWorkspace` export, add one to `workspace-context.tsx` (`export function useWorkspace() { const v = useContext(WorkspaceContext); if (!v) throw new Error("useWorkspace outside provider"); return v; }`) in Task 7 and use it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-modal-visibility.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-modal-visibility.ts src/app/use-modal-visibility.test.tsx
git commit -m "feat: add useModalVisibility hook bridging resolver and workspace state"
```

---

## Task 9: `<ModalFieldControls>` + i18n keys

**Files:**
- Create: `src/app/modal-field-controls.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/modal-field-controls.test.tsx`

- [ ] **Step 1: Add i18n keys (EN + DE)**

Add to `i18n.ts` `enUS` (and the SAME keys to `i18n.de.ts` with German values). Include BOTH the control-chrome keys and any field `labelKey` from Task 1 not already present (grep first; only add missing ones):
```ts
  // Field-visibility controls
  fieldViewSimple: "Simple",
  fieldViewAdvanced: "Advanced",
  fieldViewFull: "Full",
  fieldViewCustom: "Custom",
  configureFields: "Configure fields",
  resetToDefault: "Reset to default",
  fieldViewLabel: "Field view",
```
German (`i18n.de.ts`):
```ts
  fieldViewSimple: "Einfach",
  fieldViewAdvanced: "Erweitert",
  fieldViewFull: "Vollständig",
  fieldViewCustom: "Benutzerdefiniert",
  configureFields: "Felder konfigurieren",
  resetToDefault: "Auf Standard zurücksetzen",
  fieldViewLabel: "Feldansicht",
```
> For any missing field `labelKey` (see Task 1's list), add EN+DE entries too. After editing `i18n.de.ts`, grep for stray curly quotes (`grep -nP '[“”]' src/app/i18n.de.ts`) — the Edit tool has corrupted ASCII quotes there before; prefer minimal edits and verify.

- [ ] **Step 2: Write the failing test**

```tsx
// src/app/modal-field-controls.test.tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceProvider } from "./workspace-context";
import { ModalFieldControls } from "./modal-field-controls";
import { t } from "./i18n";

function setup() {
  return render(<ModalFieldControls modalId="milestone" lang="en-US" />, { wrapper: WorkspaceProvider });
}

describe("ModalFieldControls", () => {
  it("renders the three tier buttons and highlights Advanced by default", () => {
    setup();
    const adv = screen.getByRole("button", { name: t("en-US", "fieldViewAdvanced") });
    expect(adv).toHaveAttribute("aria-pressed", "true");
  });
  it("clicking Simple updates the pressed state", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }));
    expect(screen.getByRole("button", { name: t("en-US", "fieldViewSimple") })).toHaveAttribute("aria-pressed", "true");
  });
  it("opens the cog and disables required-field checkboxes", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "configureFields") }));
    const nameBox = screen.getByRole("checkbox", { name: t("en-US", "name") });
    expect(nameBox).toBeDisabled();
    expect(nameBox).toBeChecked();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/modal-field-controls.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

```tsx
// src/app/modal-field-controls.tsx
import { useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { MODAL_FIELDS, type FieldTier, type ModalId } from "./modal-fields";
import { useModalVisibility } from "./use-modal-visibility";

interface ModalFieldControlsProps {
  modalId: ModalId;
  lang: Lang;
}

const TIERS: readonly FieldTier[] = ["simple", "advanced", "full"];
const TIER_LABEL: Record<FieldTier, "fieldViewSimple" | "fieldViewAdvanced" | "fieldViewFull"> = {
  simple: "fieldViewSimple", advanced: "fieldViewAdvanced", full: "fieldViewFull",
};

export function ModalFieldControls({ modalId, lang }: ModalFieldControlsProps) {
  const { mode, isVisible, setMode, toggleField, reset } = useModalVisibility(modalId);
  const [cogOpen, setCogOpen] = useState(false);

  return (
    <div className="flex items-center gap-2" aria-label={t(lang, "fieldViewLabel")}>
      <div role="group" aria-label={t(lang, "fieldViewLabel")} className="inline-flex overflow-hidden rounded-md border border-line text-xs">
        {TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            aria-pressed={mode === tier}
            onClick={() => setMode(tier)}
            className={`px-2 py-1 ${mode === tier ? "bg-accent text-white" : "bg-surface"}`}
          >
            {t(lang, TIER_LABEL[tier])}
          </button>
        ))}
        {mode === "custom" && (
          <span className="px-2 py-1 bg-accent text-white" aria-current="true">{t(lang, "fieldViewCustom")}</span>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label={t(lang, "configureFields")}
          aria-expanded={cogOpen}
          onClick={() => setCogOpen((o) => !o)}
          className="rounded-md border border-line px-2 py-1 text-sm"
        >
          ⚙
        </button>
        {cogOpen && (
          <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">
              {MODAL_FIELDS[modalId].map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isVisible(f.id)}
                      disabled={f.required}
                      onChange={() => toggleField(f.id)}
                    />
                    <span>{t(lang, f.labelKey)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" onClick={reset} className="mt-2 w-full rounded border border-line py-1 text-xs">
              {t(lang, "resetToDefault")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```
> Match the project's actual Tailwind tokens (`bg-accent`, `border-line`, `bg-surface`) — grep an existing control (e.g. `SegmentedControl`) and reuse its classes so styling stays on-palette (AIPM brand: green accent, dark-blue headers, no gradients/shadows beyond existing usage). If shadows are off-palette here, drop `shadow-lg`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/modal-field-controls.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/modal-field-controls.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/modal-field-controls.test.tsx
git commit -m "feat: add ModalFieldControls (tier switch + field cog) and i18n keys"
```

---

## Task 10: Wire into the Task editor (exemplar)

**Files:**
- Modify: `src/app/task-form-fields.tsx`
- Modify: `src/app/task-form-modal.tsx`
- Modify: `src/app/task-edit-view.tsx`
- Test: `src/app/task-form-fields.test.tsx` (add a case; create if absent)

**Context:** both the modal and full-page view render `TaskFormFields`. Insert the controls in the modal header (`task-form-modal.tsx:87`) and the full-page section heading (`task-edit-view.tsx`), and guard each field row in `task-form-fields.tsx` with `isVisible("<id>")` using the Task ids from Task 1.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/task-form-fields.test.tsx (add) — render TaskFormFields inside WorkspaceProvider,
// set the task modal to "simple", and assert an advanced-only field (Priority) is gone.
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
// ...import TaskFormFields + the minimal props it needs (copy from an existing task test if present).

it("hides Priority when the task modal is in Simple view", () => {
  function Harness() {
    const { setFieldVisibility } = useWorkspace();
    // force simple before first paint
    if (true) { /* set once */ }
    return <>{/* render TaskFormFields with required props + a button to set simple */}</>;
  }
  // Pragmatic version: render TaskFormFields, then act(() => setFieldVisibility({ task: applyTier("task","simple") }))
  // and assert screen.queryByLabelText(t("en-US","priority")) is null while taskName remains.
});
```
> The implementer should write this concretely using whatever minimal prop set an existing task-form test already constructs (search for an existing render of `TaskFormFields`/`TaskFormModal`). The assertion: in Simple, `priority`/`startDate`/etc. inputs are absent; `taskName` present. In Advanced (default), `priority` present; `email`/`jiraLink` absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-form-fields.test.tsx`
Expected: FAIL — fields not yet guarded.

- [ ] **Step 3: Implement**

1. In `task-form-fields.tsx`:
   - Add `import { useModalVisibility } from "./use-modal-visibility";`
   - At the top of the component: `const { isVisible } = useModalVisibility("task");`
   - Wrap each non-required field's `<Field>` (or row) in `{isVisible("<id>") && ( … )}` using the Task ids: `assignee`, `dueDate`, `status`, `notes`, `priority`, `startDate`, `estimate`, `labels`, `dependencies`, `blockers`, `health`, `email`, `timeSpent`, `lastUpdate`, `completedDate`, `jiraLink`, `healthOverride`. Leave `taskName` (required) always rendered. Map each id to its existing JSX block; where a section becomes entirely empty (all children hidden), also guard the `TaskFormSection` wrapper so no empty numbered section shows: `{(isVisible("estimate") || isVisible("timeSpent") || isVisible("labels")) && (<TaskFormSection…>…</TaskFormSection>)}`.

2. In `task-form-modal.tsx`: the `ModalHeader` has no slot for extra controls. Render `<ModalFieldControls modalId="task" lang={lang} />` immediately AFTER `<ModalHeader … />` inside the modal container (a thin sub-header row), e.g.:
```tsx
<ModalHeader lang={lang} title={…} onClose={onCancel} dragHandleProps={handleProps} />
<div className="flex justify-end border-b border-line px-4 py-2">
  <ModalFieldControls modalId="task" lang={lang} />
</div>
```
Add `import { ModalFieldControls } from "./modal-field-controls";`.

3. In `task-edit-view.tsx`: add the same controls row above `<TaskFormFields … />` inside the `<form>` (or just above it in the `<section>`):
```tsx
<div className="flex justify-end border-b border-line px-6 py-2">
  <ModalFieldControls modalId="task" lang={fieldProps.lang} />
</div>
```
Add the import. (Confirm `lang` is available in `fieldProps`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-fields.test.tsx`
Expected: PASS. Manually confirm the full-page editor and modal both show the switcher.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-form-fields.tsx src/app/task-form-modal.tsx src/app/task-edit-view.tsx src/app/task-form-fields.test.tsx
git commit -m "feat: wire field-visibility controls and guards into the Task editor"
```

---

## Tasks 11–17: Wire the remaining seven modals

Each task follows the **same three moves** as Task 10, scoped to one modal. For each:
- **a)** Add `import { useModalVisibility } from "./use-modal-visibility";` and `import { ModalFieldControls } from "./modal-field-controls";`.
- **b)** At the top of the editor component: `const { isVisible } = useModalVisibility("<modalId>");`.
- **c)** Render `<ModalFieldControls modalId="<modalId>" lang={lang} />` in a thin row right after the modal's `ModalHeader`.
- **d)** Wrap each non-required field block in `{isVisible("<id>") && ( … )}` using that modal's ids from Task 1. Required field always rendered.
- **e)** Add a focused component test: set the modal to `simple` via `setFieldVisibility({ <modalId>: applyTier("<modalId>","simple") })` and assert an advanced-only field disappears while the required field remains.
- **f)** Commit: `feat: wire field-visibility into the <Modal> editor`.

Field ids per modal (from Task 1):

### Task 11 — RAID (`raid-edit-modal.tsx`)
ids: `title`(req), `category`, `status`, `owner`, `description`, `scoring`, `mitigation`, `targetDate`, `linkedTasks`, `riskMatrix`, `raisedDate`, `linkedRaid`, `linkedStakeholders`. `scoring` guards the probability/impact/severity inputs together; `riskMatrix` guards the matrix visual. Test: Simple hides `scoring` + `riskMatrix`, keeps `title`.

### Task 12 — Change (`change-edit-modal.tsx`)
ids: `title`(req), `type`, `status`, `description`, `impact`, `requestor`, `deltas`, `decisionDate`, `links`. `impact` guards impact + impact-description; `deltas` guards cost+schedule delta; `links` guards linked tasks/RAID/stakeholders. Test: Simple hides `deltas`, keeps `title`.

### Task 13 — Milestone (`milestone-edit-modal.tsx`)
ids: `name`(req), `targetDate`, `description`, `achievedDate`, `linkedTasks`, `documentLinks`. Test: Simple hides `description`+`linkedTasks`, keeps `name`+`targetDate`.

### Task 14 — Stakeholder (`stakeholder-edit-modal.tsx`)
ids: `name`(req), `organization`, `category`, `contact`, `influenceInterest`, `resourceLink`, `notes`, `raci`. `contact` guards title+email; `raci` guards the RACI map. Test: Simple hides `influenceInterest`+`raci`, keeps `name`.

### Task 15 — Resource (`resource-edit-modal.tsx`)
ids: `name`(req), `email`, `role`, `classification`, `utilization`, `birthday`, `documentLinks`. `classification` guards title+grade+discipline. Test: Simple hides `utilization`+`birthday`, keeps `name`+`email`.

### Task 16 — Absence (`absence-edit-modal.tsx`)
ids: `resource`(req), `dates`, `reason`, `cover`, `coverEmail`, `notes`. `dates` guards start+end. Test: Simple hides `reason`+`cover`, keeps `resource`+`dates`.

### Task 17 — Budget bucket (`budget-bucket-modal.tsx`)
ids: `name`(req), `funding`, `period`, `burnRate`, `planningFlags`. `funding` guards amount+currency; `period` guards start+end. Test: Simple hides `period`+`burnRate`, keeps `name`+`funding`. **Caution:** this modal is large (~27KB) with blended/detailed planning — guard the planning-detail UI behind `planningFlags` (Full only) and confirm validation still passes when those inputs are hidden (hidden ≠ cleared).

> For each, exact insertion JSX mirrors Task 10 step 3.2. If a given modal's `ModalHeader` is rendered differently, place the controls row in the equivalent header area. Verify `lang` is in scope (every modal already receives `lang`).

---

## Task 18: Cross-modal integration check + docs note

**Files:**
- Test: `src/app/field-visibility.integration.test.tsx` (new)
- Modify: `docs/CODEMAPS/frontend.md` (one line)

- [ ] **Step 1: Integration test**

```tsx
// src/app/field-visibility.integration.test.tsx
import { describe, expect, it } from "vitest";
import { MODAL_IDS } from "./modal-fields";
import { applyTier, sanitizeFieldVisibility, visibleFields } from "./field-visibility";

describe("field-visibility integration", () => {
  it("every modal survives a simple→advanced→full→sanitize round-trip", () => {
    for (const id of MODAL_IDS) {
      for (const tier of ["simple", "advanced", "full"] as const) {
        const cfg = { [id]: applyTier(id, tier) };
        const back = sanitizeFieldVisibility(cfg);
        expect(back?.[id], `${id}/${tier}`).toBeDefined();
        const vis = visibleFields(id, back![id]);
        // required fields always present
        expect(vis.size).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/field-visibility.integration.test.tsx`
Expected: PASS.

- [ ] **Step 3: Docs note**

Add one line under the relevant section of `docs/CODEMAPS/frontend.md` describing `modal-fields.ts` + `field-visibility.ts` + `useModalVisibility` + `ModalFieldControls` and that visibility persists per project on `Workspace.fieldVisibility`. (Keep it short; full docs come with the feature release at the end of sub-project #4.)

- [ ] **Step 4: Full suite + lint + build**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all green; no new lint warnings (`--max-warnings=0`); tsc passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/field-visibility.integration.test.tsx docs/CODEMAPS/frontend.md
git commit -m "test: cross-modal field-visibility integration; document the framework"
```

---

## Self-Review notes (for the executor)

- **No release/version bump here.** The orchestrator bumps `version.ts`/`package.json`/`CHANGELOG.md` and adds a `versionHighlight*` key at sub-project release time, consistent with prior slices. This plan stops at green tests/build.
- **Byte-stability is the top risk.** Tasks 3–6 each assert "undefined ⇒ no new output." Run the full golden-fixture suite (`npm run test:run`) after each.
- **`labelKey` integrity.** Task 1's registry references i18n keys; Task 9 adds any missing ones. If tsc fails on a missing key between Task 1 and Task 9, add the key early (don't cast).
- **Reset semantics.** `reset()` writes `undefined` (no stored entry) so the modal tracks the Advanced default and, later, whatever template seed sub-project #2 introduces — no code change needed there.
