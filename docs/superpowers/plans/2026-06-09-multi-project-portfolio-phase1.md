# Multi-Project / Portfolio Management — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are
> ordered for **sequential** execution — many share `storage.ts`, `types.ts`, `i18n.ts`,
> `task-manager.tsx`, so do NOT run implementers in parallel.

**Goal:** Add a project/portfolio layer where each project is a complete `Workspace` + a metadata
header (`ProjectMeta`), with a portfolio registry, switching, a Projects management view, a
create/edit form, an empty-state, and per-project export — working end-to-end for **file-based**
projects.

**Architecture:** `ProjectMeta` is a new optional field on `Workspace` (round-trips through every
serializer). A localStorage registry (`projects-registry.ts`) tracks `{id,name,code,storageConfig}`
per project + a `currentProjectId`; file handles persist in IndexedDB. Switching reuses the
existing storage-switch machinery in `use-storage-backend.ts`. New UI: a "Portfolio" nav group +
Projects view, a current-project indicator in the top bar/header, a shared two-group form, and an
empty-state modal. Turso multi-tenancy is **Phase 2** (out of scope).

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Vitest 4. No zod (hand-rolled sanitizers).
9-color AIPM palette. `lint --max-warnings=0`, `tsc` clean. Pure modules avoid
`Date.now()`/`Math.random()`; ids generated in the UI layer via `crypto.randomUUID()`. No side
effects in `setState` updaters. Immutable updates.

**Spec:** `docs/superpowers/specs/2026-06-09-multi-project-portfolio-phase1-design.md`

---

## File Structure

**New**
- `src/app/project-options.ts` — IdentityType / Deployment / Regulatory option sets (pure).
- `src/app/nace-sections.ts` — 21 NACE Rev. 2.1 sections A–U (pure).
- `src/app/project-validation.ts` — per-field validation (pure). + `.test.ts`
- `src/app/projects-registry.ts` — localStorage portfolio registry (pure core + thin IO). + `.test.ts`
- `src/app/project-file-handles.ts` — IndexedDB FileSystemFileHandle persistence.
- `src/app/use-project-switch.ts` — switching + create-project hook.
- `src/app/stakeholder-recipient-input.tsx` — recipient token input. + `.test.tsx`
- `src/app/project-form-fields.tsx` — form field groups (presentational).
- `src/app/project-form.tsx` — shared create/edit form (logic + validation wiring). + `.test.tsx`
- `src/app/projects-panel.tsx` — management view.
- `src/app/project-empty-state.tsx` — empty-state modal.

**Modified**
- `src/app/types.ts` — `ProjectMeta`, `ContactPerson`, `IdentityType`, `Deployment`, `RegulatoryRequirement`.
- `src/app/sanitize.ts` — `sanitizeProjectMeta`.
- `src/app/storage.ts` — `Workspace.project`; `PROJECT_CSV_COLUMNS` + `projectFieldToString` + `buildProjectFromObj`; include in JSON/CSV/MD + parse back; BrowserBackend KV load/save.
- `src/app/settings-types.ts` — add `"project"` to `EXPORT_SECTION_KEYS` + default ON.
- `src/app/export-sections.ts` — `projectSection` builder.
- `src/app/nav-config.ts` — `projects` view + `navPortfolio` group + label.
- `src/app/workspace-context.tsx` — `project` + `setProject` state.
- `src/app/use-storage-backend.ts` — load/save `project`.
- `src/app/task-manager.tsx` — registry/switch/empty-state wiring + handlers.
- `src/app/workspace-section.tsx` — render `ProjectsPanel` + empty-state.
- modern `TopBar` + classic `AppHeader` — current-project indicator + switcher.
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — new keys.
- `src/app/version.ts`, `package.json` — 0.58.0.

---

## Task 1: Static option sets + types

**Files:**
- Modify: `src/app/types.ts`
- Create: `src/app/project-options.ts`, `src/app/nace-sections.ts`
- Test: `src/app/project-options.test.ts`

- [ ] **Step 1: Add types to `types.ts`**

```ts
export type IdentityType = "B2E" | "B2B" | "B2C" | "NHI";
export type Deployment = "Cloud" | "On-premise" | "Hybrid";
export type RegulatoryRequirement =
  | "Not applicable"
  | "GDPR / data protection regulation"
  | "DORA" | "MaRisk" | "BAIT" | "NIS2" | "HIPAA" | "SOX"
  | "EU AI Act"
  | "Export control / sanctions compliance";

export type ContactPerson = {
  name: string;
  email: string;
  /** true = copied from the address book; false = manual, never synced back. */
  synced: boolean;
};

export type ProjectMeta = {
  // Identity
  name: string;
  code: string;
  description?: string;
  // People — internal group
  sponsor?: string;
  projectManager: string;
  keyStakeholdersInternal: string[];
  keyStakeholdersExternal: string[];
  // Customer group
  customer: string;
  naceSection: string;            // NACE section letter, e.g. "C"
  identityTypes: IdentityType[];
  identityCount?: number;
  products: string;
  platform?: string;
  deployment: Deployment;
  startDate: string;              // ISO YYYY-MM-DD
  endDate: string;               // ISO YYYY-MM-DD
  profitCenter: string;
  quotes?: string;
  salesforceUrl?: string;
  sharepointUrl?: string;
  confluenceUrl?: string;
  contactPersons: ContactPerson[];
  docRepoLocation?: string;
  regulatory: RegulatoryRequirement[];
  notes?: string;
};
```

- [ ] **Step 2: Create `project-options.ts`**

```ts
import type { IdentityType, Deployment, RegulatoryRequirement } from "./types";

export const IDENTITY_TYPES: readonly IdentityType[] = ["B2E", "B2B", "B2C", "NHI"];
export const DEPLOYMENTS: readonly Deployment[] = ["Cloud", "On-premise", "Hybrid"];
export const REGULATORY_REQUIREMENTS: readonly RegulatoryRequirement[] = [
  "Not applicable",
  "GDPR / data protection regulation",
  "DORA", "MaRisk", "BAIT", "NIS2", "HIPAA", "SOX",
  "EU AI Act",
  "Export control / sanctions compliance",
];
export const REGULATORY_NOT_APPLICABLE: RegulatoryRequirement = "Not applicable";

export const IDENTITY_TYPE_SET = new Set<string>(IDENTITY_TYPES);
export const DEPLOYMENT_SET = new Set<string>(DEPLOYMENTS);
export const REGULATORY_SET = new Set<string>(REGULATORY_REQUIREMENTS);
```

- [ ] **Step 3: Create `nace-sections.ts`** (verify exact titles against the official NACE Rev. 2.1)

```ts
export type NaceSection = { code: string; title: string };

export const NACE_SECTIONS: readonly NaceSection[] = [
  { code: "A", title: "Agriculture, forestry and fishing" },
  { code: "B", title: "Mining and quarrying" },
  { code: "C", title: "Manufacturing" },
  { code: "D", title: "Electricity, gas, steam and air conditioning supply" },
  { code: "E", title: "Water supply; sewerage, waste management and remediation activities" },
  { code: "F", title: "Construction" },
  { code: "G", title: "Wholesale and retail trade; repair of motor vehicles and motorcycles" },
  { code: "H", title: "Transportation and storage" },
  { code: "I", title: "Accommodation and food service activities" },
  { code: "J", title: "Information and communication" },
  { code: "K", title: "Financial and insurance activities" },
  { code: "L", title: "Real estate activities" },
  { code: "M", title: "Professional, scientific and technical activities" },
  { code: "N", title: "Administrative and support service activities" },
  { code: "O", title: "Public administration and defence; compulsory social security" },
  { code: "P", title: "Education" },
  { code: "Q", title: "Human health and social work activities" },
  { code: "R", title: "Arts, entertainment and recreation" },
  { code: "S", title: "Other service activities" },
  { code: "T", title: "Activities of households as employers; undifferentiated goods- and services-producing activities of households for own use" },
  { code: "U", title: "Activities of extraterritorial organisations and bodies" },
];

export const NACE_SECTION_SET = new Set<string>(NACE_SECTIONS.map((s) => s.code));
```

- [ ] **Step 4: Write `project-options.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { IDENTITY_TYPES, DEPLOYMENTS, REGULATORY_REQUIREMENTS, REGULATORY_NOT_APPLICABLE } from "./project-options";
import { NACE_SECTIONS, NACE_SECTION_SET } from "./nace-sections";

describe("project option sets", () => {
  it("has the four identity types", () => {
    expect(IDENTITY_TYPES).toEqual(["B2E", "B2B", "B2C", "NHI"]);
  });
  it("has the three deployments", () => {
    expect(DEPLOYMENTS).toEqual(["Cloud", "On-premise", "Hybrid"]);
  });
  it("lists 'Not applicable' first and ten regulatory options total", () => {
    expect(REGULATORY_REQUIREMENTS[0]).toBe(REGULATORY_NOT_APPLICABLE);
    expect(REGULATORY_REQUIREMENTS).toHaveLength(10);
  });
  it("has 21 NACE sections A–U with unique codes", () => {
    expect(NACE_SECTIONS).toHaveLength(21);
    expect(NACE_SECTION_SET.size).toBe(21);
    expect(NACE_SECTIONS[0].code).toBe("A");
    expect(NACE_SECTIONS[20].code).toBe("U");
  });
});
```

- [ ] **Step 5: Run** `npx vitest run src/app/project-options.test.ts` → PASS. **Commit** `feat: ProjectMeta types + NACE/option static sets`.

---

## Task 2: `sanitizeProjectMeta`

**Files:**
- Modify: `src/app/sanitize.ts`
- Test: `src/app/sanitize.project.test.ts`

Inspect `src/app/sanitize.ts` first for the exact existing helpers (`isPlainObject`, `sanitizeText`,
`toNumber`, `sanitizeIsoDate`, `sanitizeEmail`, `sanitizeAssignee`) and the text-length caps
(e.g. `BUDGET_NAME_MAX`, `TEXTAREA_MAX`). Reuse them; do not invent new ones.

- [ ] **Step 1: Write failing test `sanitize.project.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeProjectMeta } from "./sanitize";

const valid = {
  name: "Apollo", code: "APL-1", projectManager: "Jane",
  keyStakeholdersInternal: ["Bob"], keyStakeholdersExternal: ["Cara"],
  customer: "Acme", naceSection: "C", identityTypes: ["B2B", "NHI"],
  identityCount: 1200, products: "Widget", deployment: "Cloud",
  startDate: "2026-01-01", endDate: "2026-12-31", profitCenter: "PC-9",
  contactPersons: [{ name: "Dee", email: "dee@acme.test", synced: true }],
  regulatory: ["GDPR / data protection regulation", "NIS2"],
};

describe("sanitizeProjectMeta", () => {
  it("accepts a fully valid object", () => {
    const m = sanitizeProjectMeta(valid);
    expect(m?.name).toBe("Apollo");
    expect(m?.identityTypes).toEqual(["B2B", "NHI"]);
    expect(m?.contactPersons[0].synced).toBe(true);
  });
  it("returns null when a required field is missing", () => {
    expect(sanitizeProjectMeta({ ...valid, name: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, customer: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, naceSection: "ZZ" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, deployment: "Quantum" })).toBeNull();
  });
  it("drops unknown enum members and de-dupes identity types", () => {
    const m = sanitizeProjectMeta({ ...valid, identityTypes: ["B2B", "B2B", "junk"] });
    expect(m?.identityTypes).toEqual(["B2B"]);
  });
  it("collapses regulatory to ['Not applicable'] when present with others", () => {
    const m = sanitizeProjectMeta({ ...valid, regulatory: ["Not applicable", "DORA"] });
    expect(m?.regulatory).toEqual(["Not applicable"]);
  });
  it("coerces identityCount to a non-negative integer or drops it", () => {
    expect(sanitizeProjectMeta({ ...valid, identityCount: -5 })?.identityCount).toBeUndefined();
    expect(sanitizeProjectMeta({ ...valid, identityCount: "1200" })?.identityCount).toBe(1200);
  });
  it("keeps only well-formed contact persons", () => {
    const m = sanitizeProjectMeta({ ...valid, contactPersons: [
      { name: "Ok", email: "ok@x.test", synced: false },
      { name: "", email: "bad", synced: true },
    ]});
    expect(m?.contactPersons).toHaveLength(1);
    expect(m?.contactPersons[0].synced).toBe(false);
  });
  it("returns null for non-objects", () => {
    expect(sanitizeProjectMeta(null)).toBeNull();
    expect(sanitizeProjectMeta("x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL (no export).

- [ ] **Step 3: Implement `sanitizeProjectMeta` in `sanitize.ts`** following the `sanitizeStakeholder` shape:
  - Guard `isPlainObject`.
  - Required strings via `sanitizeText(v, cap)`; if any of `name, code, projectManager, customer, products, profitCenter` is empty → return `null`.
  - `naceSection`: must be in `NACE_SECTION_SET` else `null`. `deployment`: must be in `DEPLOYMENT_SET` else `null`.
  - `startDate`/`endDate`: `sanitizeIsoDate`; both required (null if missing). (Ordering is a *validation* concern, not sanitize — sanitize keeps whatever parses.)
  - `keyStakeholdersInternal`/`keyStakeholdersExternal`: required non-empty arrays of sanitized non-empty strings → `null` if empty after cleaning.
  - `regulatory`: filter to `REGULATORY_SET` members, de-dupe; if it contains `"Not applicable"` collapse to `["Not applicable"]`; required → `null` if empty.
  - `identityTypes`: filter to `IDENTITY_TYPE_SET`, de-dupe (optional → `[]` allowed).
  - `identityCount`: `toNumber`; keep only when finite and `>= 0` → `Math.floor`.
  - URLs / optional text: `sanitizeText`; include only when non-empty.
  - `contactPersons`: array → map to `{name: sanitizeAssignee, email: sanitizeEmail, synced: boolean}`, drop entries with empty name; default `synced` to `false` when not boolean.
  - Build the object adding optional fields only when present (match `sanitizeStakeholder` style).

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: sanitizeProjectMeta`.

---

## Task 3: `project-validation.ts`

**Files:** Create `src/app/project-validation.ts` + `src/app/project-validation.test.ts`

Mirror `task-validation.ts` exactly in spirit (pure, returns i18n KEYS keyed by field).

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { validateProjectMeta, hasProjectErrors, type ProjectDraft } from "./project-validation";

const ok: ProjectDraft = {
  name: "A", code: "C1", projectManager: "PM",
  keyStakeholdersInternal: ["x"], keyStakeholdersExternal: ["y"],
  customer: "Cust", naceSection: "C", products: "P", deployment: "Cloud",
  startDate: "2026-01-01", endDate: "2026-02-01", profitCenter: "PC",
  regulatory: ["DORA"], identityTypes: [], contactPersons: [],
  salesforceUrl: "", sharepointUrl: "", confluenceUrl: "",
};

describe("validateProjectMeta", () => {
  it("passes a valid draft", () => {
    expect(hasProjectErrors(validateProjectMeta(ok))).toBe(false);
  });
  it("flags every missing required field", () => {
    const e = validateProjectMeta({ ...ok, name: "", customer: "", products: "",
      profitCenter: "", projectManager: "", code: "", naceSection: "",
      keyStakeholdersInternal: [], keyStakeholdersExternal: [], regulatory: [] });
    expect(e.name).toBe("errorProjectNameRequired");
    expect(e.code).toBe("errorProjectCodeRequired");
    expect(e.regulatory).toBe("errorRegulatoryRequired");
    expect(e.keyStakeholdersInternal).toBeDefined();
  });
  it("flags endDate before startDate", () => {
    expect(validateProjectMeta({ ...ok, endDate: "2025-01-01" }).endDate).toBe("errorEndBeforeStart");
  });
  it("flags a malformed URL but allows blank", () => {
    expect(validateProjectMeta({ ...ok, salesforceUrl: "not a url" }).salesforceUrl).toBe("errorInvalidUrl");
    expect(validateProjectMeta({ ...ok, salesforceUrl: "https://x.test" }).salesforceUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — define `ProjectDraft` (the form's in-progress shape: same fields as
  `ProjectMeta` but the user is mid-edit, so strings may be blank), `ProjectErrorField`,
  `ProjectErrorKey` union, `ProjectFieldErrors = Partial<Record<...>>`. Checks:
  required text fields → `errorXRequired`; `naceSection`/`deployment` empty → required; arrays
  `keyStakeholdersInternal`/`keyStakeholdersExternal`/`regulatory` empty → required; `startDate`/
  `endDate` parse via `sanitizeIsoDate` (required); if both valid and `endDate < startDate` →
  `errorEndBeforeStart`; for each of the three URL fields, if non-blank and not a valid URL →
  `errorInvalidUrl` (use a small `isLikelyUrl` helper: try `new URL(v)` in a try/catch, require
  http/https). `hasProjectErrors` = `Object.keys(...).length > 0`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: project-validation (pure per-field)`.

---

## Task 4: `Workspace.project` + serialization + storage round-trip

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage.project.test.ts`

Read `storage.ts` around: `Workspace` type (≈64–89), `STAKEHOLDERS_CSV_COLUMNS` /
`stakeholderFieldToString` / `buildStakeholderFromObj` (≈813–832), `workspaceToJson` (≈1045),
`workspaceToCsv` (≈1166) + its parse (`csvToWorkspace`), `workspaceToMarkdown` (≈1968) +
`markdownToWorkspace`, and BrowserBackend load (≈2709) / save (≈2828) + the KV key constants
(≈257). `ProjectMeta` is a single object (like `status`/`plan`), NOT an array — serialize it the
same way `status` is handled (a labelled block / KV), not as a row table.

- [ ] **Step 1: Write failing round-trip + safety tests** `storage.project.test.ts`:
  - JSON round-trip: `jsonToWorkspace(workspaceToJson(ws))` preserves `ws.project` deeply (build a
    full valid `ProjectMeta`).
  - CSV round-trip: `csvToWorkspace(workspaceToCsv(ws))` preserves `project` (all scalar + array +
    contactPersons fields).
  - Markdown round-trip: same via `markdownToWorkspace(workspaceToMarkdown(ws))`.
  - **Safety:** for a workspace with `project: undefined`, `workspaceToCsv(ws)` and
    `workspaceToMarkdown(ws)` output is unchanged vs. a captured baseline (no spurious project
    block emitted). Snapshot the baseline within the test by constructing a workspace without
    `project` and asserting the serialized string contains no project marker.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `storage.ts`:
  - Add `project?: ProjectMeta;` to `Workspace`.
  - `export const PROJECT_CSV_COLUMNS: Array<keyof ProjectMeta> = [...]` (all fields).
  - `projectFieldToString(p, col)` — scalars via `String`; arrays (`keyStakeholders*`,
    `identityTypes`, `regulatory`) joined with the existing list delimiter; `contactPersons`
    encoded as a compact reversible string (e.g. `name|email|synced` per entry joined by the list
    delimiter, each sub-field escaped). Provide matching `encodeContactPersons` /
    `decodeContactPersons` helpers.
  - `buildProjectFromObj(obj)` → `sanitizeProjectMeta({...decoded fields...})`.
  - JSON: `project` already flows through `JSON.stringify`/parse; ensure `jsonToWorkspace` runs it
    through `sanitizeProjectMeta` (guard: only when present).
  - CSV/MD: emit a dedicated project block ONLY when `ws.project` is defined (mirror how `status`
    is conditionally emitted); parse it back in `csvToWorkspace`/`markdownToWorkspace` and assign
    `project` only when a block is present.
  - BrowserBackend: add `KV_PROJECT_KEY = "project"`; load `project = (await idbGet<ProjectMeta>(KV_PROJECT_KEY)) ?? undefined` (sanitized); save `idbSet(KV_PROJECT_KEY, ws.project)` when present (else delete the key).
  - Bump `SCHEMA_VERSION` only if the JSON/round-trip migration requires it; `project` is additive
    and optional, so a bump is NOT required for Phase 1 — leave it unless a reviewer disagrees.

- [ ] **Step 4: Run** → PASS (round-trip + safety). **Step 5: Commit** `feat: ProjectMeta on Workspace + serializers (JSON/CSV/MD) + BrowserBackend KV`.

---

## Task 5: `"project"` export section

**Files:** Modify `src/app/settings-types.ts`, `src/app/export-sections.ts`; Test `src/app/export-sections.project.test.ts`

- [ ] **Step 1: Failing test** — `buildExportSections(ws, {...defaultExportConfig, project: true}, "en-US")`
  includes a section with `key: "project"`, two columns `["field","value"]`, and a row per
  non-empty metadata field; with `project: false` it's absent; with `ws.project` undefined it's
  absent even when enabled.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - `settings-types.ts`: add `"project"` to `EXPORT_SECTION_KEYS` (place it FIRST so project
    details lead the export), and `project: true` in `defaultExportConfig`. `sanitizeExportConfig`
    auto-covers it via the loop.
  - `export-sections.ts`: add a `projectSection(p, lang)` that pivots `ProjectMeta` to
    `["field","value"]` rows (skip empty optional fields; join arrays for display; render
    contactPersons as `name <email>` lines). Add to `BUILDERS`:
    `project: (ws, lang) => ws.project ? projectSection(ws.project, lang) : null`. Add the
    `"project"` title via a new i18n key `exportSectionProject` (Task 11 supplies it; for now use
    `t(lang, "exportSectionProject")`).

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: project export section (default on)`.

---

## Task 6: Portfolio registry

**Files:** Create `src/app/projects-registry.ts` + `src/app/projects-registry.test.ts`

Pure core takes ids/values as args (no `crypto`/`Date` inside). Thin IO wrappers read/write
localStorage like `contacts.ts`.

- [ ] **Step 1: Failing test** covering: `addProject` appends immutably and can set current;
  `removeProject` drops it and clears `currentProjectId` if it was current (selecting the first
  remaining, or null); `setCurrentProject` ignores unknown ids; `renameProject` updates name/code;
  `loadRegistry` returns `{projects:[],currentProjectId:null}` on empty/garbage; serialize→parse
  round-trip.

```ts
import { describe, it, expect } from "vitest";
import { addProject, removeProject, setCurrentProject, renameProject,
  emptyRegistry, type ProjectRegistryEntry } from "./projects-registry";

const entry = (id: string): ProjectRegistryEntry =>
  ({ id, name: "P" + id, code: "C" + id, storageConfig: { kind: "local-json" } as never });

describe("projects-registry (pure)", () => {
  it("adds and selects", () => {
    const r = addProject(emptyRegistry(), entry("1"), true);
    expect(r.projects).toHaveLength(1);
    expect(r.currentProjectId).toBe("1");
  });
  it("removing the current selects another or null", () => {
    let r = addProject(emptyRegistry(), entry("1"), true);
    r = addProject(r, entry("2"), false);
    r = removeProject(r, "1");
    expect(r.currentProjectId).toBe("2");
    r = removeProject(r, "2");
    expect(r.currentProjectId).toBeNull();
  });
  it("setCurrentProject ignores unknown ids", () => {
    const r = addProject(emptyRegistry(), entry("1"), true);
    expect(setCurrentProject(r, "nope").currentProjectId).toBe("1");
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the pure functions + `emptyRegistry()` +
  `loadRegistry()`/`saveRegistry()` (localStorage key `lop-app:projects`, guarded like
  `loadContacts`). **Step 4: Run** → PASS. **Step 5: Commit** `feat: portfolio registry (localStorage)`.

---

## Task 7: IndexedDB file-handle store

**Files:** Create `src/app/project-file-handles.ts`

- [ ] **Step 1:** Implement `saveHandle(projectId, handle)`, `getHandle(projectId)`,
  `deleteHandle(projectId)` over a dedicated IDB store (reuse the app's existing idb helpers in
  `storage.ts` if exported, else a tiny local `openDB`). `FileSystemFileHandle` is
  structured-cloneable, so it stores directly. Guard `typeof window`/`indexedDB`.
- [ ] **Step 2:** Light test with a fake handle object asserting save→get→delete round-trips under
  a mocked `indexedDB` (or skip if the repo lacks an IDB mock — note that in the commit message).
- [ ] **Step 3: Commit** `feat: per-project file-handle persistence (IDB)`.

---

## Task 8: Workspace context — `project` state

**Files:** Modify `src/app/workspace-context.tsx`

- [ ] **Step 1:** Add `project: ProjectMeta | undefined; setProject: Dispatch<SetStateAction<ProjectMeta | undefined>>;`
  to the context value interface; `useState<ProjectMeta | undefined>(undefined)`; include both in
  the provider value. **Step 2:** `tsc` clean. **Step 3: Commit** `feat: project state in workspace context`.

---

## Task 9: Storage backend bridge — load/save `project`

**Files:** Modify `src/app/use-storage-backend.ts`

Read the load destructure + save assembly (the architecture map: load ≈ where it calls
`setStakeholders(workspace.stakeholders ?? [])`; save ≈ where it assembles the `Workspace` to
`backend.save`).

- [ ] **Step 1:** On load, `setProject(workspace.project)`. On save, include `project` in the
  assembled `Workspace`. Thread `project`/`setProject` from context. **Step 2:** `tsc` + existing
  storage tests still green. **Step 3: Commit** `feat: persist project through storage backend bridge`.

---

## Task 10: Switching + create-project hook

**Files:** Create `src/app/use-project-switch.ts`

Study `onRequestStorageSwitch` in `use-storage-backend.ts` (≈291–338) and `createBackend`,
`pickFileForBackend`, `openFileForBackend`, `requestWriteAccessForBackend` in `storage.ts`
(≈3020–3070).

- [ ] **Step 1:** Implement a hook returning:
  - `switchToProject(id)` — save current ws → look up registry entry + file handle → `createBackend` →
    reopen file (re-prompt permission if needed) → `backend.load()` → push all workspace state via
    a provided `applyWorkspace(ws)` callback (sets tasks…stakeholders + `setProject`) →
    `setCurrentProject(id)` + persist registry. Reuse `suppressNextLoadRef`/`suppressNextSaveRef`.
  - `createProject(meta, format)` — `crypto.randomUUID()` id → build empty `Workspace` with
    `project: meta` → `createBackend({kind: localKindFor(format)})` → save-file picker → save →
    persist handle → `addProject(registry, entry, true)` → switch to it.
  - `loadProjectFromFile()` — open-file picker → load ws → register a new entry (id from uuid,
    name/code from `ws.project` or file name) → switch.
- [ ] **Step 2:** Keep all `crypto`/picker calls in this hook (UI layer), never in pure modules.
  Unit-test the *pure* glue you can (e.g. `localKindFor`, entry-from-workspace derivation) in a
  small companion `.test.ts`; the picker/IDB paths are covered by manual + e2e. **Step 3: Commit**
  `feat: project switch + create + load-from-file hook`.

---

## Task 11: i18n keys

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1:** Add keys (EN + DE). After editing `i18n.de.ts`, **grep for curly quotes** to
  confirm the Edit tool didn't corrupt ASCII `"` (known gotcha). Keys (non-exhaustive — add every
  label/tooltip/error you reference):
  - Nav/group: `navPortfolio`, `navProjects`.
  - Form sections/labels: `projectFormIdentity`, `projectFormPeople`, `projectFormCustomer`,
    `projectName`, `projectCode`, `projectDescription`, `projectSponsor`, `projectManager`,
    `projectStakeholdersInternal`, `projectStakeholdersExternal`, `projectCustomer`,
    `projectNaceSection`, `projectIdentityTypes`, `projectIdentityCount`, `projectProducts`,
    `projectPlatform`, `projectDeployment`, `projectStartDate`, `projectEndDate`,
    `projectProfitCenter`, `projectQuotes`, `projectSalesforce`, `projectSharepoint`,
    `projectConfluence`, `projectContactPersons`, `projectDocRepo`, `projectRegulatory`,
    `projectNotes`.
  - Tooltips: `projectSalesforceTip` ("Link to Salesforce opportunity"),
    `projectSharepointTip` ("Link to Sales SharePoint"), `projectConfluenceTip` ("Link to Confluence").
  - Validation: `errorProjectNameRequired`, `errorProjectCodeRequired`, `errorProjectManagerRequired`,
    `errorStakeholdersInternalRequired`, `errorStakeholdersExternalRequired`, `errorCustomerRequired`,
    `errorNaceRequired`, `errorProductsRequired`, `errorDeploymentRequired`, `errorStartDateRequired`,
    `errorEndDateRequired`, `errorProfitCenterRequired`, `errorRegulatoryRequired`,
    `errorEndBeforeStart`, `errorInvalidUrl`.
  - Management/empty/switcher: `projectsTitle`, `projectsNew`, `projectsSwitch`, `projectsEdit`,
    `projectsExport`, `projectsDelete`, `projectsDeleteConfirm` (mentions the file is NOT deleted),
    `projectsEmptyTitle`, `projectsEmptyCreate`, `projectsEmptyLoad`, `projectCurrentLabel`,
    `projectSwitcherLoadFile`, `exportSectionProject`, `contactAddFromBook`, `contactAddManual`.
- [ ] **Step 2:** `tsc` clean (TranslationKey union picks up new keys). **Commit** `feat: i18n keys for projects (EN/DE)`.

---

## Task 12: Nav entry — Portfolio group

**Files:** Modify `src/app/nav-config.ts`

- [ ] **Step 1:** Add `"projects"` to the `AppView` union. Add a `LABEL_KEYS["projects"] = "navProjects"`.
  Insert a NEW group at the TOP of `NAV_GROUPS`:
  ```ts
  { labelKey: "navPortfolio", items: [{ view: "projects" }] },
  ```
  Since `projects` is not owned by any feature module, `isViewEnabled` treats it as core (always
  enabled) — confirm by reading `feature-modules.ts` `isViewEnabled`; if it defaults unknown views
  to disabled, add `projects` to the always-core allowlist there.
- [ ] **Step 2:** `tsc` clean; existing nav tests green. **Commit** `feat: Portfolio nav group + projects view`.

---

## Task 13: `StakeholderRecipientInput`

**Files:** Create `src/app/stakeholder-recipient-input.tsx` + `.test.tsx`

Recipient/token input (Outlook-style). Props:
```ts
interface StakeholderRecipientInputProps {
  value: string[];                 // current names
  onChange: (next: string[]) => void;
  suggestions: string[];           // names from the workspace stakeholder register
  label: string;
  id: string;
}
```
- [ ] **Step 1: Failing test (RTL):** typing a name + Enter adds a chip; typing a substring shows
  matching suggestions; clicking a suggestion adds it; free text with no match is still addable;
  removing a chip calls `onChange` without it; duplicates are ignored.
- [ ] **Step 2: Implement** — controlled chips with a text box; on Enter/comma commit the trimmed
  value (dedupe, case-insensitive); a filtered suggestion list (substring, case-insensitive,
  excluding already-chosen) shown while typing; chips have a remove ×. Render matched chips with a
  subtle "known" affordance (a small dot/title), unmatched as plain — matching computed against
  `suggestions` at render time. AIPM palette only. **Step 3: Run** → PASS. **Commit**
  `feat: StakeholderRecipientInput (free-text + register match)`.

---

## Task 14: Project form (shared)

**Files:** Create `src/app/project-form-fields.tsx`, `src/app/project-form.tsx` + `src/app/project-form.test.tsx`

- [ ] **Step 1: Failing test (RTL)** — render `<ProjectForm>` with empty initial draft: Save is
  disabled; fill all required fields (name, code, projectManager, internal+external stakeholders,
  customer, nace, products, deployment, start/end, profitCenter, regulatory) → Save enabled;
  submitting calls `onSubmit` with a sanitized `ProjectMeta`; setting endDate < startDate shows the
  `errorEndBeforeStart` message and disables Save; a manual contact person is recorded with
  `synced:false`; choosing an address-book contact records `synced:true`.
- [ ] **Step 2: Implement**
  - `project-form-fields.tsx`: presentational two-group layout. Group 1 (Identity + internal
    People) and a **visually separated** Group 2 ("Customer" block — distinct heading + divider,
    AIPM palette). Reuse the shared `TaskFormSection` style if it fits, else a local `FormSection`.
    Each field uses the existing `FieldError` (`role="alert"`) for inline errors revealed on
    blur/submit (mirror `task-form-fields.tsx`). The two key-stakeholder fields use
    `StakeholderRecipientInput` (suggestions = `props.stakeholderNames`). Contact persons: a list +
    "Add from address book" (select from `listContacts`) and "Add manually" (name/email inputs →
    `synced:false`). NACE/deployment = `<select>`; identityTypes/regulatory = checkbox groups
    (regulatory enforces "Not applicable" exclusivity in the change handler). Links are URL inputs
    with `title=` tooltips.
  - `project-form.tsx`: owns the `ProjectDraft` state, `validateProjectMeta` wiring,
    `submitted`/blur reveal, `saveDisabled = hasProjectErrors(...)`, and on submit builds +
    `sanitizeProjectMeta` → `onSubmit(meta)`. Props: `{ initial?: ProjectMeta; stakeholderNames:
    string[]; addressBook: Contact[]; lang: Lang; onSubmit; onCancel }`.
- [ ] **Step 3: Run** → PASS. **Commit** `feat: shared project create/edit form`.

---

## Task 15: Projects management view

**Files:** Create `src/app/projects-panel.tsx`

- [ ] **Step 1:** Implement the management content: a list/cards of registry entries (name, code,
  customer/dates from the *current* project's meta where available; for non-current file projects
  show registry name/code only). Per entry: **Switch**, **Edit** (opens `ProjectForm` for the
  current project; editing a non-current project first switches to it), **Export** (a format menu
  reusing `exportWorkspace(currentWs, fmt, settings.export ?? defaultExportConfig, lang)`),
  **Delete** (confirm dialog using `projectsDeleteConfirm` — states the file is NOT removed).
  Prominent **"+ New project"** opens `ProjectForm` in create mode (calls `createProject`). Use the
  shared `report-table.tsx`/card styles where they fit; AIPM palette.
- [ ] **Step 2:** `tsc`/lint clean. **Commit** `feat: projects management view`.

---

## Task 16: Empty-state modal

**Files:** Create `src/app/project-empty-state.tsx`

- [ ] **Step 1:** A modal shown when the registry has no projects: two actions — **Create project**
  (opens `ProjectForm` create) and **Load from file** (`loadProjectFromFile`). Non-dismissable
  until one path completes (no current project to show otherwise). **Step 2:** lint/tsc clean.
  **Commit** `feat: no-project empty-state modal`.

---

## Task 17: Current-project indicator + switcher

**Files:** Modify modern `TopBar` + classic `AppHeader` (locate via grep for the New-task button /
header; the AI-Assistant button added in v0.57 sits to the left of New task — place the indicator
prominently near the title).

- [ ] **Step 1:** Add a button showing `currentProject?.name` (fallback `projectCurrentLabel`).
  Clicking opens a switcher popover/modal listing registry projects (name + code, current marked),
  with **Load from file** and **+ New project** actions, wired to `switchToProject` /
  `loadProjectFromFile` / create. Render in BOTH layouts (prop-drill the needed callbacks +
  current name; mirror how `ActionMenus` is shared). AIPM palette; prominent but not garish.
- [ ] **Step 2:** lint/tsc clean. **Commit** `feat: current-project indicator + switcher (modern + classic)`.

---

## Task 18: Wire it together in task-manager / workspace-section

**Files:** Modify `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`

- [ ] **Step 1:** In `task-manager.tsx`: load the registry on mount; instantiate `useProjectSwitch`
  with an `applyWorkspace` that sets every workspace slice (incl. `setProject`); compute
  `hasNoProject = registry.projects.length === 0`; render `ProjectEmptyState` when true; pass
  current-project name + switch callbacks to `TopBar`/`AppHeader`; pass `exportConfig`/handlers to
  `ProjectsPanel`. Ensure NO side effects inside `setState` updaters (compute, set, then
  side-effect) per the React-19 gotcha. Generate ids via `crypto.randomUUID()` here/in the hook,
  never in reducers.
- [ ] **Step 2:** In `workspace-section.tsx`: lazy-load `ProjectsPanel`
  (`const ProjectsPanel = dynamic(() => import("./projects-panel").then(m => m.ProjectsPanel), { ssr: false })`)
  and render under `{activeTab === "projects" && (<div id="panel-projects" role="tabpanel" ...><ProjectsPanel .../></div>)}`.
  Confirm classic + modern + popout all reach it.
- [ ] **Step 3:** `npx vitest run` (full suite) green; `tsc`; `eslint --max-warnings=0`.
  **Commit** `feat: wire multi-project (registry, switch, empty-state, Projects view)`.

---

## Task 19: Version bump + final verification

**Files:** Modify `src/app/version.ts`, `package.json`

- [ ] **Step 1:** Bump to `0.58.0` with the next author codename (follow the existing scheme).
- [ ] **Step 2:** Full gate: `npx vitest run` (all green), `npx tsc --noEmit`, `npm run lint`
  (`--max-warnings=0`), `npm run build`. Manually sanity-check (or e2e) the create→switch→export
  loop in file mode.
- [ ] **Step 3: Commit** `chore: v0.58.0 (multi-project phase 1)`.

---

## Final review

After all tasks: dispatch a holistic code review (spec compliance + quality + the dual-use
serializer safety + React-19 setState purity + i18n parity). Then use
**superpowers:finishing-a-development-branch**.

## Self-review notes (plan author)
- **Spec coverage:** every spec section maps to a task (model→T1–4, export→T5, registry→T6–7,
  switching→T10, nav→T12, indicator→T17, management→T15, form→T13–14, empty-state→T16, wiring→T18).
- **Dual-use safety:** explicitly tested in T4 step 1 (no project block when `project` undefined).
- **Type consistency:** `ProjectMeta`/`ProjectDraft`/`ContactPerson` names used identically across
  T1, T2, T3, T4, T14.
- **No-placeholder:** option sets, NACE list, sanitizer rules, validation keys, and i18n keys are
  all enumerated; UI components give full prop contracts + test expectations rather than verbatim
  300-line JSX, deliberately (the implementer matches the cited existing components' style).
