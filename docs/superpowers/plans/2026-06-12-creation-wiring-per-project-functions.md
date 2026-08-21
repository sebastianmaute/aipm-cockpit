# Creation Wiring + Per-Project Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enabled functions/modules a per-project setting (reactive, no page reload), and add a 3-step project-creation wizard that picks a template and configures functions, applying both at creation.

**Architecture:** `Workspace.features?: readonly FeatureModuleId[]` (per-project, serialized like `fieldVisibility`) is the source of truth; a single effect in task-manager syncs it into the reactive `settings.features` that all 45 consumers already read (so consumers don't change, and the reload is dropped). A `create-project-wizard.tsx` assembles the new project's workspace via `applyTemplate` + the configured functions.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-12-creation-wiring-per-project-functions-design.md`

**Conventions:** one test file `npx vitest run src/app/<f>.test.ts`; full suite `npm run test:run`; lint gate `--max-warnings=0`; build `npm run build`. No `console.log`. Immutable. No version bump (orchestrator releases). i18n.de.ts curly-quote hazard — grep after edits. KNOWN pre-existing flakes (ignore/ re-run in isolation): `due-dates.property.test.ts`, `task-manager.portfolio-mode.test.tsx`.

**THE CRITICAL NUANCE (read first):** `sanitizeFeatures(undefined)` returns `[...ALL_MODULE_IDS]` and `sanitizeFeatures([])` returns `[]` (feature-modules.ts:73). For the per-project field we MUST distinguish "no override" (absent ⇒ `undefined`) from "explicit Simple" (`[]`). So **every decoder calls `sanitizeFeatures` ONLY when the value/section/row is present**; absence ⇒ leave `ws.features` undefined. This differs from `fieldVisibility` (whose sanitizer returns undefined for empty). Do NOT copy the fieldVisibility decode blindly — add the present-check.

**`fieldVisibility` is the serialization template** (mirror it, with the present-check above). Exact current lines: workspace.ts (type :91, toJson :268, fromJson :326), csv-codecs.ts (const :196, enc/dec :676, emit :982, dispatch :1397), markdown-codecs.ts (enc/dec :213, emit :591, dispatch :1034), turso-schema.ts (load :130, dirty :174, save :218), workspace-context.tsx (decl :77, state :104, value :260, deps :285), use-storage-backend.ts (applyWorkspace :146).

---

## File Structure

| File | Responsibility | New? |
|------|----------------|------|
| `workspace.ts` | `Workspace.features?` + JSON envelope (present-only) | modify |
| `csv-codecs.ts` / `markdown-codecs.ts` | features section (present-only, byte-stable) | modify |
| `turso-schema.ts` | `meta`-KV `features` row + dirty | modify |
| `workspace-context.tsx` | `features`/`setFeatures` | modify |
| `use-storage-backend.ts` | applyWorkspace `setFeatures`; save-gather; create `opts` + apply seam | modify |
| `use-turso-projects.ts` | thread create `opts` through the create router | modify |
| `task-manager.tsx` | sync effect (ws.features → settings.features); `handleCommitFeatures`=setFeatures, drop reload; render wizard | modify |
| `settings-sections/mode-section.tsx` | per-project copy | modify |
| `create-project-wizard.tsx` | 3-step wizard | new |
| `project-empty-state.tsx`, `projects-panel.tsx` | open the wizard instead of the bare form | modify |
| `i18n.ts` / `i18n.de.ts` | wizard + mode copy keys | modify |

---

## Task 1: `Workspace.features` type + JSON envelope (present-only)

**Files:** Modify `src/app/workspace.ts`. Test: `src/app/workspace.test.ts` (append).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./workspace";

describe("workspace features (per-project)", () => {
  it("omits features from JSON when undefined (byte-stability)", () => {
    expect(JSON.parse(workspaceToJson(emptyWorkspace()))).not.toHaveProperty("features");
  });
  it("round-trips a features array including explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "budget"] as const };
    expect(jsonToWorkspace(workspaceToJson(ws)).features).toEqual(["raid", "budget"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(jsonToWorkspace(workspaceToJson(simple)).features).toEqual([]); // empty preserved, NOT all
  });
  it("legacy JSON with no features key stays undefined (not all-modules)", () => {
    const json = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())) }); // no features key
    expect(jsonToWorkspace(json).features).toBeUndefined();
  });
  it("sanitizes junk feature ids on read", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), features: ["raid", "nope"] });
    expect(jsonToWorkspace(raw).features).toEqual(["raid"]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/workspace.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `workspace.ts`:
  1. Import: `import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";`
  2. Add to the `Workspace` type after `fieldVisibility?`:
  ```ts
    /** Per-project enabled feature modules. Optional & additive: undefined = no override
     *  (legacy / inherits the current active set); [] = Simple mode. Serializes to nothing
     *  when undefined. */
    features?: readonly FeatureModuleId[];
  ```
  3. In `workspaceToJson`, beside the fieldVisibility spread:
  ```ts
      ...(ws.features ? { features: ws.features } : {}),
  ```
  4. In `jsonToWorkspace`, beside the fieldVisibility read — **present-check** (do NOT call sanitizeFeatures on undefined):
  ```ts
      if ((p as Record<string, unknown>).features !== undefined) {
        raw.features = sanitizeFeatures((p as Record<string, unknown>).features);
      }
  ```
  (Use the real parsed-object variable name `p`/`parsed`.)

- [ ] **Step 4: Run** `npx vitest run src/app/workspace.test.ts` → PASS. `npm run test:run` (golden fixtures unchanged). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/workspace.ts src/app/workspace.test.ts
git commit -m "feat: per-project Workspace.features in the JSON envelope (present-only)"
```

---

## Task 2: CSV codec section (present-only)

**Files:** Modify `src/app/csv-codecs.ts`. Test: `src/app/csv-codecs.test.ts` (append).

- [ ] **Step 1: Write the failing test**
```ts
import { emptyWorkspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";

describe("csv features section", () => {
  it("emits no section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# FUNCTIONS");
  });
  it("emits and round-trips features, preserving explicit empty", () => {
    const ws = { ...emptyWorkspace(), features: ["raid"] as const };
    expect(workspaceToCsv(ws)).toContain("# FUNCTIONS");
    expect(csvToWorkspace(workspaceToCsv(ws)).features).toEqual(["raid"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(csvToWorkspace(workspaceToCsv(simple)).features).toEqual([]); // empty preserved
  });
});
```
> NOTE: `features: []` must STILL emit the section (so empty Simple round-trips). The emit gate is `ws.features !== undefined` (NOT `.length > 0` — that's the difference from fieldVisibility). Reflect this in the test: even `[]` produces `# FUNCTIONS`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** mirroring the field-visibility section:
  1. Constant near line 196: `const CSV_SECTION_FUNCTIONS = "# FUNCTIONS";`
  2. Import `sanitizeFeatures`, `type FeatureModuleId` from `./feature-modules`.
  3. Encoder/decoder (store the array as one JSON cell):
  ```ts
  export function featuresToCsv(features: readonly FeatureModuleId[], neutralize = false): string {
    return ["config", csvCellEscape(JSON.stringify(features), neutralize)].join(",");
  }
  export function csvToFeatures(text: string): FeatureModuleId[] | undefined {
    const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
    if (rows.length === 0) return undefined;
    try { return sanitizeFeatures(JSON.parse(rows[0][1])); } catch { return undefined; }
  }
  ```
  4. Emit in `workspaceToCsv` (gate on PRESENCE, not length):
  ```ts
  if (ws.features !== undefined) csvPush(CSV_SECTION_FUNCTIONS, featuresToCsv(ws.features, neutralize));
  ```
  5. Dispatch in `csvToWorkspace`: add a `functionsText` section field (mirror how `fieldVisText` is split/dispatched), then:
  ```ts
  if (s.functionsText.trim()) { const f = csvToFeatures(s.functionsText); if (f) ws.features = f; }
  ```
  > For `features: []`, `csvToFeatures` returns `[]` (sanitizeFeatures([])→[]); `if (f)` is truthy for `[]` (arrays are truthy), so `ws.features = []` is set. Confirm `[]` passes the `if (f)` guard (it does — `[]` is truthy). The `s.functionsText.trim()` is non-empty because the cell is `config,[]`.

- [ ] **Step 4: Run** `npx vitest run src/app/csv-codecs.test.ts` → PASS. `npm run test:run` (CSV golden unchanged). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/csv-codecs.ts src/app/csv-codecs.test.ts
git commit -m "feat: serialize per-project features in the CSV codec"
```

---

## Task 3: Markdown codec section (present-only)

**Files:** Modify `src/app/markdown-codecs.ts`. Test: `src/app/markdown-codecs.test.ts` (append).

- [ ] **Step 1: Write the failing test**
```ts
import { emptyWorkspace } from "./workspace";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";

describe("markdown features section", () => {
  it("emits nothing when undefined", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Functions");
  });
  it("emits and round-trips features incl. explicit empty", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "gantt"] as const };
    expect(workspaceToMarkdown(ws)).toContain("## Functions");
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).features).toEqual(["raid", "gantt"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(markdownToWorkspace(workspaceToMarkdown(simple)).features).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** mirroring the field-visibility markdown section:
  1. Import `sanitizeFeatures`, `type FeatureModuleId`.
  2. Encoder/decoder:
  ```ts
  export function featuresToMarkdown(features: readonly FeatureModuleId[]): string {
    return ["## Functions", "", "```json", JSON.stringify(features, null, 2), "```", ""].join("\n");
  }
  export function markdownToFeatures(md: string): FeatureModuleId[] | undefined {
    const m = /## Functions\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
    if (!m) return undefined;
    try { return sanitizeFeatures(JSON.parse(m[1])); } catch { return undefined; }
  }
  ```
  3. Emit in `workspaceToMarkdown` (gate on the storage path `config === undefined` AND presence):
  ```ts
  if (config === undefined && ws.features !== undefined) mdParts.push(featuresToMarkdown(ws.features));
  ```
  4. Dispatch in `markdownToWorkspace` (operates on the full md string, like fieldVisibility):
  ```ts
  const fns = markdownToFeatures(md); if (fns) ws.features = fns;
  ```
  > `[]` → `markdownToFeatures` returns `[]`, `if (fns)` truthy → `ws.features = []`. Good.

- [ ] **Step 4: Run** `npx vitest run src/app/markdown-codecs.test.ts` → PASS. `npm run test:run` (MD golden `sample-workspace.md` unchanged — NEVER re-emit it via the serializer). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/markdown-codecs.ts src/app/markdown-codecs.test.ts
git commit -m "feat: serialize per-project features in the Markdown codec"
```

---

## Task 4: Turso `meta`-KV features row

**Files:** Modify `src/app/turso-schema.ts`. Test: `src/app/turso-schema.test.ts` (append).

- [ ] **Step 1: Write the failing test** (mirror the `field_visibility` meta tests in this file):
```ts
describe("turso features (meta KV)", () => {
  it("marks meta dirty when features changes by reference", () => {
    const a = emptyWorkspace();
    const b = { ...a, features: ["raid"] as const };
    expect(dirtyWorkspaceTables(a, b).has("meta")).toBe(true);
  });
});
```
Plus a round-trip test mirroring the existing `field_visibility` round-trip: `rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)))` for `ws.features = ["raid"]` → `back.features` equals `["raid"]`; and for `features: []` → `back.features` equals `[]`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** mirroring `field_visibility` meta handling:
  1. Import `sanitizeFeatures`.
  2. **Save** (inside the `isDirty("meta")` block, beside the field_visibility upsert) — gate on PRESENCE:
  ```ts
  if (ws.features !== undefined) {
    out.push({ sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
      args: [{ type: "text", value: "features" }, { type: "text", value: JSON.stringify(ws.features) }] });
  }
  ```
  3. **Load** (beside the field_visibility decode):
  ```ts
  const fnRow = rowObjects(byTable.get("meta")).find((r) => r.key === "features");
  if (fnRow?.value) {
    try { const f = sanitizeFeatures(JSON.parse(fnRow.value)); if (f) ws.features = f; } catch { /* leave undefined */ }
  }
  ```
  > `features: []` → JSON `"[]"` → `fnRow.value` is `"[]"` (truthy string) → parsed → sanitizeFeatures([])→[] → `if (f)` truthy → set. Good.
  4. **Dirty**: `if (prev.features !== next.features) dirty.add("meta");`

- [ ] **Step 4: Run** `npx vitest run src/app/turso-schema.test.ts` → PASS. `npm run test:run` — the TABLE_NAMES guard test still passes (no new table). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -m "feat: persist per-project features as a Turso meta KV row"
```

---

## Task 5: WorkspaceProvider `features` + storage bridge

**Files:** Modify `src/app/workspace-context.tsx`, `src/app/use-storage-backend.ts`. Test: `src/app/workspace-context.test.tsx` (append).

- [ ] **Step 1: Write the failing test**
```tsx
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
// (use the same provider-wrapper the other workspace-context tests use, e.g. FiltersProvider+WorkspaceProvider)
it("exposes features state and setter", () => {
  const { result } = renderHook(() => useWorkspace(), { wrapper: /* providers */ });
  expect(result.current.features).toBeUndefined();
  act(() => result.current.setFeatures(["raid"]));
  expect(result.current.features).toEqual(["raid"]);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  In `workspace-context.tsx` (mirror `fieldVisibility`):
  - Import `type { FeatureModuleId } from "./feature-modules";`
  - Interface: `features: readonly FeatureModuleId[] | undefined; setFeatures: Dispatch<SetStateAction<readonly FeatureModuleId[] | undefined>>;`
  - State: `const [features, setFeatures] = useState<readonly FeatureModuleId[] | undefined>(undefined);`
  - Add `features, setFeatures` to the context value object + `features` to the memo dep array.
  In `use-storage-backend.ts`:
  - Pull `setFeatures` from `useWorkspace()` (beside `setFieldVisibility`).
  - In `applyWorkspace`, add `setFeatures(workspace.features);` (beside `setFieldVisibility(workspace.fieldVisibility)`).
  - On SAVE: add `features` to the `Workspace` object assembled at EACH save-gather site (the same sites `fieldVisibility` appears in — `doSave`, `onRequestStorageSwitch`, `onPickStorageFile`, `currentWorkspace`). Add `features` to the save effect's dependency array if `fieldVisibility` is there.

- [ ] **Step 4: Run** `npx vitest run src/app/workspace-context.test.tsx` → PASS. `npm run test:run` green. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/workspace-context.tsx src/app/use-storage-backend.ts src/app/workspace-context.test.tsx
git commit -m "feat: expose per-project features in WorkspaceProvider + storage bridge"
```

---

## Task 6: Sync effect + drop the reload (THE no-reload core)

**Files:** Modify `src/app/task-manager.tsx`. Test: `src/app/task-manager.*.test.tsx` (add a focused case or a new small test).

**Context:** `settings.features` is the reactive source all 45 consumers read. `Workspace.features` is the per-project source of truth. A single effect keeps `settings.features` synced to the current project's features; `handleCommitFeatures` now writes the project's features (no reload).

- [ ] **Step 1: Write the failing test** — a focused test that mounting/loading a workspace whose `features` is `["raid"]` results in `settings.features` becoming `["raid"]` (reactive), and that `handleCommitFeatures(["budget"])` updates without calling `window.location.reload`. Practical approach: extract the sync into a tiny pure-ish helper and test it, OR test via a component harness. Minimal viable test:
```tsx
// task-manager.features-sync.test.tsx — render a probe inside the real providers,
// set workspace features via useWorkspace().setFeatures(["raid"]), and assert the
// app's settings.features (read via useSettings) becomes ["raid"]. Mock window.location.reload
// (vi.stubGlobal) and assert handleCommitFeatures path does NOT call it.
```
Write it concretely against the real providers; if wiring a full TaskManager is too heavy, extract the sync logic (below) into `use-features-sync.ts` and unit-test that hook in isolation (preferred — smaller surface).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  Option (preferred) — extract `src/app/use-features-sync.ts`:
  ```ts
  import { useEffect } from "react";
  import type { Dispatch, SetStateAction } from "react";
  import { useWorkspace } from "./workspace-context";
  import type { Settings } from "./settings-types";
  /** Keep the reactive settings.features synced to the current project's Workspace.features.
   *  Undefined (legacy project) leaves settings.features untouched. */
  export function useFeaturesSync(setSettings: Dispatch<SetStateAction<Settings>>): void {
    const { features } = useWorkspace();
    useEffect(() => {
      if (features === undefined) return;
      setSettings((s) => (s.features === features ? s : { ...s, features: [...features] }));
    }, [features, setSettings]);
  }
  ```
  In `task-manager.tsx`:
  - Call `useFeaturesSync(setSettings);` (the component already has `setSettings` from `useSettings()`).
  - Pull `setFeatures` from `useWorkspace()`.
  - Change `handleCommitFeatures` to write the PROJECT's features (no reload, no writeSettings — the effect propagates to settings.features):
  ```ts
  const handleCommitFeatures = useCallback(
    (features: FeatureModuleId[]) => { setFeatures(features); },
    [setFeatures],
  );
  ```
  - DELETE the `window.location.reload()` and the `writeSettings({...settings, features})` from the old body.

- [ ] **Step 4: Run** the new test + `npm run test:run`. **CRITICAL manual/automated check:** existing tests that asserted a reload on mode change must be updated (search for `location.reload` / `reload` in task-manager tests and mode-section tests; the behavior is now reactive, no reload). Update them to assert `setFeatures`/reactive update instead — do NOT restore the reload. `npx tsc --noEmit` clean. `npm run lint` 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/app/use-features-sync.ts src/app/task-manager.tsx src/app/use-features-sync.test.ts
git commit -m "feat: sync per-project features into settings reactively; drop the reload"
```

---

## Task 7: Mode section — per-project copy

**Files:** Modify `src/app/settings-sections/mode-section.tsx`, `i18n.ts`, `i18n.de.ts`. Test: `mode-section.test.tsx` (adjust if it asserted reload).

- [ ] **Step 1:** Update the Mode section's intro copy to say functions are per-project. Reuse `modeIntro` or add `modeIntroPerProject` (EN: "These functions apply to the current project. Switching projects loads each project's own set." / DE accurate). Add to i18n.ts + i18n.de.ts (identical keys; grep curly quotes after de.ts).
- [ ] **Step 2:** If `mode-section.test.tsx` asserted a commit/reload behavior, update it to the new no-reload commit (it calls `onCommitFeatures(features)` which now just sets the project's features). Don't weaken assertions.
- [ ] **Step 3:** `npx vitest run src/app/settings-sections/mode-section.test.tsx` → PASS. `npx tsc --noEmit` clean. `npm run lint` 0 warnings.
- [ ] **Step 4: Commit**
```bash
git add src/app/settings-sections/mode-section.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-sections/mode-section.test.tsx
git commit -m "feat: clarify Mode section is per-project"
```

---

## Task 8: Create flow — opts + apply seam

**Files:** Modify `src/app/use-storage-backend.ts`, `src/app/use-turso-projects.ts`. Test: `use-storage-backend.test.ts` (or a focused create test; create if absent).

**Context:** `createProject(meta, format)` / `createTursoProject(meta)` build `{ ...emptyWorkspace(), project: meta }` then `applyWorkspace`. Extend with `opts` to apply a template + per-project features at the seam.

- [ ] **Step 1: Write the failing test** — a unit test for a small pure helper `buildNewProjectWorkspace(meta, opts)` that you'll extract (so the assembly is testable without the storage hook):
```ts
import { buildNewProjectWorkspace } from "./new-project-workspace";
import type { ProjectTemplate } from "./templates";

const tpl: ProjectTemplate = { id: "t", name: "T", features: ["raid"], fieldVisibility: { task: { fields: ["taskName"] } }, seed: { tasks: [{ id: 1, taskName: "S", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "", priority: "Medium", blockers: "", notes: "", dependencies: [] }] } };
const meta = { name: "P", code: "P", projectManager: "", keyStakeholdersInternal: [], keyStakeholdersExternal: [], contactPersons: [], regulatory: [], documentLinks: [] } as any;

it("applies template field-visibility + seed + configured features", () => {
  const ws = buildNewProjectWorkspace(meta, { template: tpl, features: ["raid", "budget"], includeSeed: true });
  expect(ws.project).toEqual(meta);
  expect(ws.fieldVisibility?.task.fields).toEqual(["taskName"]);   // from template
  expect(ws.tasks).toHaveLength(1);                                 // seed appended
  expect(ws.features).toEqual(["raid", "budget"]);                 // configured (overrides template's)
});
it("blank: no template → default field-visibility, configured features, no seed", () => {
  const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: false });
  expect(ws.fieldVisibility).toBeUndefined();
  expect(ws.features).toEqual([]);
  expect(ws.tasks).toHaveLength(0);
});
it("no opts → today's behavior (no features override)", () => {
  const ws = buildNewProjectWorkspace(meta, {});
  expect(ws.features).toBeUndefined();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/app/new-project-workspace.ts`:
```ts
import { emptyWorkspace, type Workspace } from "./workspace";
import { applyTemplate } from "./template-apply";
import type { ProjectTemplate } from "./templates";
import type { ProjectMeta } from "./types";
import type { FeatureModuleId } from "./feature-modules";

export interface NewProjectOpts {
  template?: ProjectTemplate;
  features?: readonly FeatureModuleId[];
  includeSeed?: boolean;
}
export function buildNewProjectWorkspace(meta: ProjectMeta, opts: NewProjectOpts): Workspace {
  let ws: Workspace = { ...emptyWorkspace(), project: meta };
  if (opts.template) ws = applyTemplate(ws, opts.template, { includeSeed: !!opts.includeSeed });
  if (opts.features !== undefined) ws = { ...ws, features: opts.features };
  return ws;
}
```

- [ ] **Step 4: Wire into the create flow** in `use-storage-backend.ts`:
  - `createProject(meta, format, opts: NewProjectOpts = {})`: replace `const ws = { ...emptyWorkspace(), project: meta };` with `const ws = buildNewProjectWorkspace(meta, opts);`.
  - `createTursoProject(meta, opts: NewProjectOpts = {})`: replace `applyWorkspace({ ...emptyWorkspace(), project: meta })` with `applyWorkspace(buildNewProjectWorkspace(meta, opts))`. (For Turso, the per-project features persist via the meta-KV save on the next dirty save; confirm the create path triggers a save or that the features land — if Turso create doesn't immediately persist features, add a save after applyWorkspace mirroring how the project row is created.)
  - In `use-turso-projects.ts`, thread `opts` through `handleCreateProjectByMode(meta, format, opts)` → `createFileProject`/`createTursoProject`. Default `opts = {}`.

- [ ] **Step 5: Run** `npx vitest run src/app/new-project-workspace.test.ts` → PASS. `npm run test:run` green. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**
```bash
git add src/app/new-project-workspace.ts src/app/new-project-workspace.test.ts src/app/use-storage-backend.ts src/app/use-turso-projects.ts
git commit -m "feat: apply template + per-project features at project creation"
```

---

## Task 9: Creation wizard

**Files:** Create `src/app/create-project-wizard.tsx`, `src/app/create-project-wizard.test.tsx`. Modify `src/app/project-empty-state.tsx`, `src/app/projects-panel.tsx`, `i18n.ts`, `i18n.de.ts`.

- [ ] **Step 1: i18n** — add (EN+DE, identical, grep curly quotes): `wizardStepDetails` ("Details"), `wizardStepTemplate` ("Template"), `wizardStepFunctions` ("Functions"), `wizardNext` ("Next"), `wizardBack` ("Back"), `wizardBlankTemplate` ("Blank — choose functions yourself"), `wizardIncludeContent` ("Include starter content"), `wizardCreate` ("Create project"), `wizardFunctionsIntro` ("Choose which functions this project uses").

- [ ] **Step 2: Write the failing test** `create-project-wizard.test.tsx`: render the wizard inside providers; Step 1 fill name; Next → Step 2 pick a template (or Blank); Next → Step 3 shows functions pre-filled from the template (assert a module checkbox state reflects the template's `features`); toggle one; click Create; assert `onCreate(meta, format, opts)` was called with `opts.template`, `opts.features` (the tweaked set), `opts.includeSeed`. (Keep the asserted `onCreate` shape; adjust selectors to your markup.)

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `create-project-wizard.tsx`:
  - Props: `{ lang, stakeholderNames, addressBook, resources, onCreate: (meta, format, opts: NewProjectOpts) => void, onCancel? }` (superset of `CreateProjectFormProps` + opts on onCreate).
  - State: `step` (1|2|3), the collected `meta`+`format` (from Step 1), `selectedTemplate: ProjectTemplate | null` (null = Blank), `features: FeatureModuleId[]`, `includeSeed: boolean`.
  - **Step 1:** reuse the existing `ProjectForm`/`CreateProjectForm` field group; on its submit, capture meta+format and advance to Step 2 (don't create yet). (Extract the field group from `create-project-form.tsx` if needed so Step 1 doesn't show a premature "Create" button — or repurpose its submit as "Next".)
  - **Step 2:** list `useTemplates().templates` + a Blank row. Selecting a template sets `selectedTemplate` and initializes `features` from `template.features` (Blank → `[...ALL_MODULE_IDS]`).
  - **Step 3:** the mode presets + per-module checkboxes (reuse the shape from `mode-section.tsx`: Simple→[], Advanced→all, `FEATURE_MODULES.map` checkboxes toggling `features`); an "Include starter content" checkbox shown only when `selectedTemplate?.seed` is non-empty. Create button → `onCreate(meta, format, { template: selectedTemplate ?? undefined, features, includeSeed })`.
  - Back/Next nav between steps. AIPM palette tokens (grep mode-section / create-project-form).

- [ ] **Step 5: Wire entry points** — in `project-empty-state.tsx` (~:117) and `projects-panel.tsx` (~:396), replace `<CreateProjectForm .../>` with `<CreateProjectWizard .../>`, passing an `onCreate` that routes to the create flow with the new `opts` (thread `opts` to `handleCreateProjectByMode`/`createTursoProject`). Keep `onCancel`.

- [ ] **Step 6: Run** `npx vitest run src/app/create-project-wizard.test.tsx` → PASS. `npm run test:run` green (update the empty-state/projects-panel tests if they assert the bare form — they now render the wizard; adjust to the wizard's Step 1). `npx tsc --noEmit` clean. `npm run lint` 0 warnings.

- [ ] **Step 7: Commit**
```bash
git add src/app/create-project-wizard.tsx src/app/create-project-wizard.test.tsx src/app/project-empty-state.tsx src/app/projects-panel.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: 3-step project creation wizard (details, template, functions)"
```

---

## Task 10: Integration test (no-reload reactivity) + docs

**Files:** Create `src/app/per-project-functions.integration.test.tsx`. Modify `docs/CODEMAPS/{frontend,data}.md`.

- [ ] **Step 1: Integration test** — the highest-risk behaviors:
  1. **Reactive nav, no reload:** render the app shell (or a nav-bearing harness) inside real providers; set the workspace's `features` to a reduced set (e.g. `["raid"]`) via `setFeatures` → assert the nav/enabled views reflect the reduced set WITHOUT a remount (no `location.reload`). Use `vi.stubGlobal("location", { ...location, reload: vi.fn() })` and assert reload was never called.
  2. **Redirect on shrink:** with the active view set to a module that the new features set disables, after `setFeatures` to a set excluding it, assert the active view redirected (via `disabledViewRedirect`'s effect) to an enabled view.
  Write these concretely against the real components; if the full shell is too heavy, target the smallest component that owns nav filtering + the redirect effect.

- [ ] **Step 2: Run** → PASS. If a reactive gap surfaces (a consumer not updating without reload), report it — that's the spec's flagged risk; fix the specific consumer to depend on `settings.features` reactively rather than restoring the global reload.

- [ ] **Step 3: Docs** — update `docs/CODEMAPS/data.md` (Workspace.features per-project + serialization) and `docs/CODEMAPS/frontend.md` (the creation wizard + the features-sync effect + Mode section now per-project). Short, matching the existing style.

- [ ] **Step 4: Full gates** — `npm run test:run` + `npx tsc --noEmit` + `npm run lint` + `npm run build` all green (known flakes excepted).

- [ ] **Step 5: Commit**
```bash
git add src/app/per-project-functions.integration.test.tsx docs/CODEMAPS/frontend.md docs/CODEMAPS/data.md
git commit -m "test: per-project functions reactivity integration; document the framework"
```

---

## Self-Review notes (for the executor)

- **No release/version bump** — orchestrator releases after the final review.
- **The present-check is the #1 correctness gotcha** (Tasks 1–4): `sanitizeFeatures(undefined)→ALL`, so decoders must only sanitize when the value is present; `[]` (Simple) must round-trip as `[]`, and the emit gate is `!== undefined` (NOT `.length > 0`). The Task 1–4 tests each assert the empty-vs-absent distinction.
- **Task 6 is the risk** (drop the reload). The Task 10 integration test is the safety net. If a consumer doesn't react, fix that consumer — do not restore the global reload.
- **Turso create persistence:** verify `createTursoProject` actually persists `ws.features` (the meta-KV save fires on a dirty save). If the create path doesn't save immediately, add an explicit save.
- **`applyTemplate` already exists** (sub-project #2) and is reused verbatim by `buildNewProjectWorkspace` — do not reimplement seed re-id.
- **Features applied at creation resolves #2's deferral** — the "(coming soon)" copy from #2 can be updated at release time.
