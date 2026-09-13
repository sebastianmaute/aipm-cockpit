# MR A — O-1 project creation from a name alone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project be created and persisted with only a name, without any backend's decoder discarding the record, and without any consumer mis-handling the blank values that become legal.

**Architecture:** One gate is removed in four layers that must move together: the sanitizer (which today discards the whole project on any blank key fact), the `ProjectMeta` type, the form validator with its error keys and strings, and the form's required markers. Around that core, the one consumer that mishandles a blank (`fetchWindow`) is fixed, three code render sites gain an explicit `—`, and the one consequence this MR does not fix is filed as a follow-up.

**Tech Stack:** Next.js 16.2.11 (exact-pinned), React, TypeScript, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-12-project-key-facts-and-shell-polish-design.md` — section 4 (as corrected in `14ff588f`), plus §8's cross-cutting constraints. Read it alongside this plan; the plan argues from it.

## Global Constraints

- **Gates are CI-only. The push is the first check.** Do NOT run `npm run lint`, `npx tsc --noEmit`, `npm run test:run`, `npm run test:coverage`, or any `docs:*` / `followups:*` gate. The targeted single-file `npx vitest run <file> --maxWorkers=1` calls below are the TDD loop, not a gate.
- **Never run two vitest processes at once.** Finish one targeted run before starting another.
- **Never read an exit code through a pipe.** Redirect to a log in your scratchpad, `echo "EXIT=$?"` unpiped, then read the log. A run printing `Test Files no tests` is worker contention, not a result — re-run it alone.
- `src/app/*.ts(x)` is CRLF in the working tree over LF blobs. Use the **Edit tool** for every source change. Never `sed -i`.
- **`src/app/i18n.de.ts` is never touched with Edit or Write.** Task 2 gives the exact node script; it matches `\r\n`, and a `\n` anchor silently no-ops.
- **`??` is the wrong idiom over the widened fields.** `""` is falsy but not nullish, so `??` lets a blank through and `||` catches it. Never rewrite an existing `||` to `??` on `code`, `projectManager`, `customer`, `products`, `profitCenter`, `naceSection`, `deployment` or `startDate`.
- **Golden fixtures must not move.** `src/app/__fixtures__/golden-workspace.*` pin a full-valued sample. If one diffs, stop: that is a real format change, never something to regenerate.
- **No new i18n keys in this MR.** Thirteen are deleted; none are added. The `—` in Task 4 is a literal, as it already is in the NACE and deployment `<option value="">`.
- **No pushing, no MR, no merge, no version bump** without explicit instruction from the user. Commit locally, path-limited: `git commit -F <msgfile> -- <paths>`. Never `git add -A` / `git add .`, never `--amend`, never bare `git stash`.
- Commits end with the trailer `Claude-Session: https://[session link removed]`. The MR description and CHANGELOG must NOT carry it.
- Do not disturb the dev server on port **3000** or `.next/`.
- The author is "Sebastian Maute".

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/types.ts` | `ProjectMeta.deployment` widens to `Deployment \| ""` | 1 |
| `src/app/template-suggest.ts` | `DEPLOYMENT_POINTS` gains the `""` key the widened type demands | 1 |
| `src/app/sanitize-records.ts` | `sanitizeProjectMeta` rejects only a non-object or a blank name; drops `lenientRequiredArrays` | 1 |
| `src/app/csv-codecs-config.ts` | `buildProjectFromObjLenient` deleted; two docstrings corrected | 1 |
| `src/app/turso-tenant-schema.ts` | `rowsToProjectList` decodes through `buildProjectFromObj` | 1 |
| `e2e/version-history-documents.spec.ts` | `PROJECT_ROW` docstring stops stating the old rule | 1 |
| `src/app/sanitize.project.test.ts`, `sanitize-branches.test.ts`, `sanitize.test.ts`, `turso-tenant-schema.test.ts`, `template-suggest.test.ts` | migrated + new decode pins | 1 |
| `src/app/project-validation.ts` | validator keeps name, end-before-start, URLs; key and field unions shrink | 2 |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | 13 dead error keys deleted | 2 |
| `src/app/project-form-fields.tsx` | ten required markers and nine dead error wirings removed | 2 |
| `src/app/ai-project-proposal.ts` | two docstrings stop promising required fields | 2 |
| `src/app/project-validation.test.ts`, `src/app/project-form.test.tsx` | migrated + name-only Save pin + one-asterisk pin | 2 |
| `src/app/timelog-panel.tsx` | `fetchWindow` falls back on a blank start date | 3 |
| `src/app/timelog-panel.test.tsx` | blank-start and set-start pins | 3 |
| `src/app/projects-panel.tsx`, `src/app/turso-project-picker.tsx` | blank code renders `—` | 4 |
| `src/app/projects-panel.test.tsx`, `src/app/turso-project-picker.test.tsx` | `—` pins with controls | 4 |
| `docs/open-followups.md` | follow-up for code-less projects sharing one TimeLog switch signal | 5 |

Task order is load-bearing: Task 2's name-only Save test submits through the sanitizer, so it is red until Task 1 lands.

---

### Task 1: The decoder keeps a name-only project

The data-loss core. After this task every load path — CSV, Markdown, JSON, IndexedDB and the Turso tenant list — keeps a project whose only non-blank field is its name, and still rejects a non-blank garbage NACE section or deployment.

**Files:**
- Modify: `src/app/types.ts` (`ProjectMeta.deployment`)
- Modify: `src/app/template-suggest.ts` (`DEPLOYMENT_POINTS`)
- Modify: `src/app/sanitize-records.ts` (`sanitizeProjectMeta`)
- Modify: `src/app/csv-codecs-config.ts` (`decodeProjectObj` docstring, `buildProjectFromObjLenient`)
- Modify: `src/app/turso-tenant-schema.ts` (import + `rowsToProjectList`)
- Modify: `e2e/version-history-documents.spec.ts` (`PROJECT_ROW` docstring only)
- Test: `src/app/sanitize.project.test.ts`, `src/app/sanitize-branches.test.ts`, `src/app/sanitize.test.ts`, `src/app/turso-tenant-schema.test.ts`, `src/app/template-suggest.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `ProjectMeta.deployment: Deployment | ""`; `sanitizeProjectMeta(input: unknown): ProjectMeta | null` — **one parameter, the `opts` parameter is gone**; `buildProjectFromObj(obj: Record<string, string>): ProjectMeta | null` is now the only project row builder (`buildProjectFromObjLenient` no longer exists).

**Invalidated tests (from the spec's §4.7 table — handle each explicitly):**
- `sanitize.project.test.ts` "returns null when a required field is missing" — **MIGRATE**
- `sanitize-branches.test.ts` "returns null when code / projectManager / products / profitCenter is blank" — **DELETE** (replaced)
- `sanitize-branches.test.ts` "treats a missing/blank endDate as '' and tolerates non-array regulatory/identity/contacts" — **MIGRATE**
- `sanitize.test.ts` "accepts a blank end date (optional since 0.74) → endDate ''" — **MIGRATE**
- `turso-tenant-schema.test.ts` "rowsToProjectList keeps a project with empty required arrays that the STRICT decoder would reject" — **MIGRATE**

- [ ] **Step 1: Write the failing decode pins in `sanitize.project.test.ts`**

Replace the whole `it("returns null when a required field is missing", …)` block (lines 21–26) with:

```ts
  it("rejects only a blank name, and garbage in the two enum fields", () => {
    expect(sanitizeProjectMeta({ ...valid, name: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, naceSection: "ZZ" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, deployment: "Quantum" })).toBeNull();
  });
  it("keeps a project whose only non-blank field is its name (O-1 data-loss pin)", () => {
    const m = sanitizeProjectMeta({ name: "Solo" });
    expect(m).not.toBeNull();
    expect(m).toMatchObject({
      name: "Solo", code: "", projectManager: "", customer: "", products: "",
      profitCenter: "", naceSection: "", deployment: "", startDate: "", endDate: "",
      keyStakeholdersInternal: [], keyStakeholdersExternal: [], identityTypes: [],
      contactPersons: [], regulatory: [],
    });
  });
  it("keeps every key fact blank when they arrive as empty strings", () => {
    const m = sanitizeProjectMeta({
      ...valid, code: "", projectManager: "", customer: "", products: "", profitCenter: "",
      naceSection: "", deployment: "", startDate: "", regulatory: [], contactPersons: [],
    });
    expect(m?.name).toBe("Apollo");
    expect(m?.naceSection).toBe("");
    expect(m?.deployment).toBe("");
    expect(m?.startDate).toBe("");
    expect(m?.regulatory).toEqual([]);
  });
```

- [ ] **Step 2: Write the failing codec-level pins**

The sanitizer tests prove the function; these prove the two text decoders a user's file actually goes through. Append to `src/app/sanitize.project.test.ts` (add the two imports at the top of the file, below the existing one):

```ts
import { csvToProject } from "./csv-codecs-config";
import { markdownToProject } from "./markdown-codecs-core";
```

```ts
describe("project text decoders keep a name-only project (O-1)", () => {
  it("CSV", () => {
    const m = csvToProject("field,value\nname,Solo\n");
    expect(m?.name).toBe("Solo");
    expect(m?.code).toBe("");
  });
  it("Markdown", () => {
    const m = markdownToProject("- name: Solo\n");
    expect(m?.name).toBe("Solo");
    expect(m?.deployment).toBe("");
  });
});
```

- [ ] **Step 3: Run the file and watch it fail**

Run: `npx vitest run src/app/sanitize.project.test.ts --maxWorkers=1 > <scratchpad>/t1a.log 2>&1; echo "EXIT=$?"` then read the log.
Expected: EXIT=1. The name-only pin, the all-blank pin and both codec pins FAIL (each receives `null`). The first rewritten case PASSES — it asserts rejections the old code already makes, which is correct: it is the guard that the relaxation must not remove.

- [ ] **Step 4: Widen the type**

In `src/app/types.ts`, inside `export type ProjectMeta`, change:

```ts
  deployment: Deployment;
```

to:

```ts
  /** "" = not set (O-1: every key fact but `name` may be blank). */
  deployment: Deployment | "";
```

- [ ] **Step 5: Give `DEPLOYMENT_POINTS` the key the widened type now demands**

In `src/app/template-suggest.ts`, change:

```ts
const DEPLOYMENT_POINTS: Record<ProjectMeta["deployment"], number> = { Cloud: 0, "On-premise": 1, Hybrid: 2 };
```

to:

```ts
const DEPLOYMENT_POINTS: Record<ProjectMeta["deployment"], number> = { "": 0, Cloud: 0, "On-premise": 1, Hybrid: 2 };
```

Do not retype the key as `Deployment` — that would restate the union a second time.

- [ ] **Step 6: Relax the sanitizer**

In `src/app/sanitize-records.ts`, replace from the function signature through the line `const endDate = sanitizeIsoDate(o.endDate) ?? "";` with:

```ts
export function sanitizeProjectMeta(input: unknown): ProjectMeta | null {
  if (!isPlainObject(input)) return null;
  const o = input;

  // ★★ Only `name` is required (O-1). Every other key fact may be blank, and ""
  // means "not set". Returning null here discards the WHOLE project, not the
  // field — so a guard on anything but `name` makes a legitimately incomplete
  // project vanish on its next load from any backend.
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const code = sanitizeText(o.code, BUDGET_NAME_MAX);
  const projectManager = sanitizeText(o.projectManager, BUDGET_NAME_MAX);
  const customer = sanitizeText(o.customer, BUDGET_NAME_MAX);
  const products = sanitizeText(o.products, BUDGET_NAME_MAX);
  const profitCenter = sanitizeText(o.profitCenter, BUDGET_NAME_MAX);

  // Enum fields: blank is "not set" and is kept. A NON-blank value outside the
  // set is garbage, and still rejects the record — the one guard O-1 keeps.
  const naceSection = sanitizeText(o.naceSection, 4);
  if (naceSection && !NACE_SECTION_SET.has(naceSection)) return null;

  const deploymentRaw = sanitizeText(o.deployment, BUDGET_NAME_MAX);
  if (deploymentRaw && !DEPLOYMENT_SET.has(deploymentRaw)) return null;
  const deployment = deploymentRaw as Deployment | "";

  // Both dates are optional; an unparseable value reads as "" (not set).
  const startDate = sanitizeIsoDate(o.startDate);
  const endDate = sanitizeIsoDate(o.endDate);
```

Then, in the same function:

1. Replace the key-stakeholder comment block (the five lines beginning `// Key stakeholders (internal / external) are OPTIONAL`) with:

```ts
  // Key stakeholders (internal / external): any sanitized array, including empty.
```

2. Replace `  // Required array: regulatory — filter to known set, de-dupe, collapse "Not applicable".` with:

```ts
  // regulatory — filter to the known set, de-dupe, collapse "Not applicable". Empty is kept.
```

3. Delete the line:

```ts
  if (!opts.lenientRequiredArrays && regulatoryFiltered.length === 0) return null;
```

4. Replace `  // Build required-fields-first object (sanitizeStakeholder style).` with:

```ts
  // Build the always-present fields first (sanitizeStakeholder style).
```

- [ ] **Step 7: Delete the lenient builder**

In `src/app/csv-codecs-config.ts`:

1. Replace the `decodeProjectObj` docstring's last two lines:

```ts
 *  Shared by the strict `buildProjectFromObj` and the lenient
 *  `buildProjectFromObjLenient` so the per-field decode logic lives once. */
```

with:

```ts
 *  Consumed only by `buildProjectFromObj`, which serves the CSV and Markdown
 *  parsers and the Turso `projects` row decoder alike. */
```

2. Delete the whole `buildProjectFromObjLenient` export together with its docstring — the block from `/** Lenient decode for an ALREADY-PERSISTED project row` through the closing `}` of that function.

In `src/app/turso-tenant-schema.ts`:

1. In the `./csv-codecs` import, change `buildProjectFromObjLenient,` to `buildProjectFromObj,`.
2. In `rowsToProjectList`, change `const meta = buildProjectFromObjLenient(o);` to `const meta = buildProjectFromObj(o);`.

Confirm nothing else referenced it: `git grep -n "buildProjectFromObjLenient\|lenientRequiredArrays" -- src e2e scripts` must return only the e2e docstring you fix in Step 9 and the test line you remove in Step 8.

- [ ] **Step 8: Migrate the remaining invalidated tests**

`src/app/sanitize-branches.test.ts` — replace the `it("returns null when code / projectManager / products / profitCenter is blank", …)` block with:

```ts
  it("keeps blank code / projectManager / products / profitCenter as ''", () => {
    const m = sanitizeProjectMeta({ ...valid, code: "", projectManager: "", products: "", profitCenter: "" });
    expect(m).toMatchObject({ code: "", projectManager: "", products: "", profitCenter: "" });
  });
```

In the next `it(…)` block, replace these four lines:

```ts
    // regulatory not an array → empty → null (required unless lenient)
    expect(sanitizeProjectMeta({ ...valid, regulatory: "NIS2" })).toBeNull();
    // lenient mode keeps an empty regulatory array
    expect(sanitizeProjectMeta({ ...valid, regulatory: [] }, { lenientRequiredArrays: true })?.regulatory).toEqual([]);
```

with:

```ts
    // regulatory not an array → [] (kept; O-1 made it optional)
    expect(sanitizeProjectMeta({ ...valid, regulatory: "NIS2" })?.regulatory).toEqual([]);
```

`src/app/sanitize.test.ts` — in "accepts a blank end date (optional since 0.74) → endDate ''", replace:

```ts
    // startDate stays required.
    expect(sanitizeProjectMeta({ ...base, startDate: "" })).toBeNull();
```

with:

```ts
    // startDate is optional too since O-1 — a blank one is kept as "".
    expect(sanitizeProjectMeta({ ...base, startDate: "" })?.startDate).toBe("");
```

`src/app/turso-tenant-schema.test.ts` — replace the whole `it("rowsToProjectList keeps a project with empty required arrays that the STRICT decoder would reject", …)` block with:

```ts
  it("rowsToProjectList keeps a project whose key facts are all blank (O-1)", () => {
    // Only `name` is load-bearing. A row with blank scalar key facts AND empty
    // arrays must decode on the tenant path exactly as on the file paths — this
    // replaces a test that pinned a strict/lenient split which no longer exists.
    const m: ProjectMeta = {
      ...meta(), code: "", projectManager: "", customer: "", products: "",
      profitCenter: "", naceSection: "", deployment: "", startDate: "",
    };
    const up = upsertProjectStatement(m, "p1", false);
    const colNames = parseInsertCols(up.sql);
    const cols = colNames.map((name) => ({ name }));
    const rows = [up.args!.map((a) => ({ value: a.value ?? "" }))];
    const list = rowsToProjectList({ type: "ok", response: { type: "execute", result: { cols, rows } } });
    expect(list).toHaveLength(1);
    expect(list[0].meta).toMatchObject({ name: m.name, code: "", deployment: "", startDate: "" });
  });
```

If `buildProjectFromObj` is no longer used anywhere else in that test file, remove it from the `./storage` import on line 10 — check with `grep -n "buildProjectFromObj" src/app/turso-tenant-schema.test.ts`. An unused import is a fatal lint in CI.

`src/app/template-suggest.test.ts` — in `it("deployment Hybrid +2, On-premise +1, Cloud +0", …)`, add as the last assertion:

```ts
    expect(complexityScore(meta({ deployment: "" })).score).toBe(0);
```

- [ ] **Step 9: Correct the e2e docstring that states the old rule**

In `e2e/version-history-documents.spec.ts`, replace the `PROJECT_ROW` docstring (from `/** The \`projects\` columns a row must carry to survive decoding, and NOT ONE` through `genuinely optional. */`) with:

```ts
/** A deliberately FULL `projects` row. ★★ Since O-1 only `name` is load-bearing
 *  for decoding: `sanitizeProjectMeta` returns null for a blank name, or for a
 *  NON-blank `naceSection` / `deployment` outside its set, and for nothing else.
 *  This docstring used to list six required scalars, a required start date and a
 *  lenient array-only decoder — all true before O-1, none true after. The row
 *  stays full because the probe is about version history, not about decoding,
 *  and a sparse row would couple it to a rule it does not test.
 *  ★ Still a deliberate subset of `PROJECT_CSV_COLUMNS` — restating that whole
 *  list here would rot the moment a column is added. */
```

- [ ] **Step 10: Run every touched test file, one at a time**

For each of `src/app/sanitize.project.test.ts`, `src/app/sanitize-branches.test.ts`, `src/app/sanitize.test.ts`, `src/app/turso-tenant-schema.test.ts`, `src/app/template-suggest.test.ts`:

Run: `npx vitest run <file> --maxWorkers=1 > <scratchpad>/t1-<name>.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0 for each, and the log's `Tests` line shows a non-zero passed count with 0 failed.

Then the golden check — it must stay green, untouched:
Run: `npx vitest run src/app/golden-workspace.test.ts --maxWorkers=1 > <scratchpad>/t1-golden.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0. If it fails, STOP and report; do not regenerate a fixture.

- [ ] **Step 11: Mutation-check the two load-bearing guards**

Each new pin must be able to fail. Apply one mutant at a time with the Edit tool, run the file, then revert with the Edit tool and prove the revert with `git diff --stat -- src/app/sanitize-records.ts` showing only your intended change.

1. Delete `if (naceSection && !NACE_SECTION_SET.has(naceSection)) return null;` → `sanitize.project.test.ts` must FAIL on "rejects only a blank name…". Revert.
2. Change `if (deploymentRaw && !DEPLOYMENT_SET.has(deploymentRaw)) return null;` to `if (!DEPLOYMENT_SET.has(deploymentRaw)) return null;` → the name-only pin must FAIL. Revert.

Record both outcomes (mutant, test that failed) for the commit message.

- [ ] **Step 12: Commit**

```bash
git commit -F <scratchpad>/c1.txt -- src/app/types.ts src/app/template-suggest.ts src/app/sanitize-records.ts src/app/csv-codecs-config.ts src/app/turso-tenant-schema.ts e2e/version-history-documents.spec.ts src/app/sanitize.project.test.ts src/app/sanitize-branches.test.ts src/app/sanitize.test.ts src/app/turso-tenant-schema.test.ts src/app/template-suggest.test.ts
```

Message (`c1.txt`): subject `fix(project): keep a project whose only key fact is its name`, a body naming the nine removed guards, the two narrowed ones, the deleted lenient builder, the two mutation outcomes, and the `Claude-Session` trailer.

---

### Task 2: The form accepts a name alone

**Files:**
- Modify: `src/app/project-validation.ts`
- Modify: `src/app/i18n.ts` (EN — Edit tool)
- Modify: `src/app/i18n.de.ts` (DE — **node script only**)
- Modify: `src/app/project-form-fields.tsx`
- Modify: `src/app/ai-project-proposal.ts` (two docstrings)
- Test: `src/app/project-validation.test.ts`, `src/app/project-form.test.tsx`

**Interfaces:**
- Consumes: Task 1's `sanitizeProjectMeta`, which the form's submit calls.
- Produces: `ProjectErrorField = "name" | "endDate" | "salesforceUrl" | "sharepointUrl" | "confluenceUrl" | "jiraUrl"`; `ProjectErrorKey = "errorProjectNameRequired" | "errorEndBeforeStart" | "errorInvalidUrl"`.

**Invalidated tests:**
- `project-validation.test.ts` "flags every missing required field" — **MIGRATE**
- `project-validation.test.ts` "requires at least one contact person" — **DELETE** (replaced by its opposite)
- `project-form.test.tsx` — no invalidation. "disables Save initially in create mode" still holds (the name is blank); `fillRequired` still produces a valid draft.

These four edits are one commit because `tsc` couples them: shrinking `ProjectErrorField` breaks every `errorFor("code")` in the form, and shrinking `ProjectErrorKey` breaks EN/DE key parity until both dictionaries lose the same keys.

- [ ] **Step 1: Write the failing validator pins**

In `src/app/project-validation.test.ts`, replace the `it("flags every missing required field", …)` block AND the `it("requires at least one contact person", …)` block with:

```ts
  it("flags a blank name and nothing else when every key fact is blank (O-1)", () => {
    const e = validateProjectMeta({
      ...ok, name: "", code: "", projectManager: "", customer: "", naceSection: "",
      products: "", deployment: "", startDate: "", endDate: "", profitCenter: "",
      contactPersons: [], regulatory: [],
    });
    expect(e).toEqual({ name: "errorProjectNameRequired" });
  });
  it("accepts a draft carrying a name alone (O-1)", () => {
    const e = validateProjectMeta({
      ...ok, name: "Solo", code: "", projectManager: "", customer: "", naceSection: "",
      products: "", deployment: "", startDate: "", endDate: "", profitCenter: "",
      contactPersons: [], regulatory: [],
    });
    expect(hasProjectErrors(e)).toBe(false);
  });
  it("does not flag end-before-start while the start date is blank", () => {
    expect(validateProjectMeta({ ...ok, startDate: "", endDate: "2025-01-01" }).endDate).toBeUndefined();
  });
```

- [ ] **Step 2: Write the failing form pins**

In `src/app/project-form.test.tsx`, inside `describe("ProjectForm", …)`, directly after the `it("enables Save once all required fields are filled", …)` block, add:

```tsx
  it("enables Save and submits with only the project name filled (O-1)", () => {
    const { onSubmit } = setup();
    setText("Project name", "Solo");
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const meta = onSubmit.mock.calls[0][0];
    expect(meta.name).toBe("Solo");
    expect(meta.code).toBe("");
    expect(meta.deployment).toBe("");
    expect(meta.startDate).toBe("");
    expect(meta.regulatory).toEqual([]);
    expect(meta.contactPersons).toEqual([]);
  });

  it("marks only the project name as required", () => {
    setup();
    // One asterisk per required field, rendered by `Field` and by
    // `ContactPersonsControl`. Ten came off with O-1; name keeps its own.
    expect(screen.getAllByText("*")).toHaveLength(1);
  });
```

- [ ] **Step 3: Run both and watch them fail**

Run: `npx vitest run src/app/project-validation.test.ts --maxWorkers=1 > <scratchpad>/t2a.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 — the first two new cases fail (the validator still flags the key facts); the third PASSES already (a blank start date never had an end-before-start error), which is correct: it guards the refactor below.

Run: `npx vitest run src/app/project-form.test.tsx --maxWorkers=1 > <scratchpad>/t2b.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 — the Save test fails on `toBeEnabled`, and the asterisk test fails reporting **11** elements, not 1. If it reports another number, stop and recount the `required` markers before continuing.

- [ ] **Step 4: Shrink the validator**

In `src/app/project-validation.ts`:

1. Replace the `ProjectDraft` docstring:

```ts
/** In-progress form shape for project-meta editing. Required string fields
 *  may be blank while the user is typing; array fields are always arrays. */
```

with:

```ts
/** In-progress form shape for project-meta editing. Only `name` is required
 *  (O-1); every other string may stay blank and every array may stay empty. */
```

2. Replace the whole `export type ProjectErrorField = …;` union with:

```ts
export type ProjectErrorField =
  | "name"
  | "endDate"
  | "salesforceUrl"
  | "sharepointUrl"
  | "confluenceUrl"
  | "jiraUrl";
```

3. Replace the whole `export type ProjectErrorKey = …;` union with:

```ts
export type ProjectErrorKey =
  | "errorProjectNameRequired"
  | "errorEndBeforeStart"
  | "errorInvalidUrl";
```

4. In `validateProjectMeta`, replace everything from `  // Required non-empty (trimmed) string fields.` down to and including the closing `}` of `if (!startDate) { … }` with:

```ts
  // Only the name is required (O-1). Every other key fact may stay blank.
  if (!draft.name.trim()) errors.name = "errorProjectNameRequired";

  // Date validation — both optional.
  const startDate = sanitizeIsoDate(draft.startDate);
  const endDate = sanitizeIsoDate(draft.endDate);
```

The `// End date is optional; …` block and the URL block below it stay as they are.

- [ ] **Step 5: Delete the 13 dead keys from EN**

In `src/app/i18n.ts`, under `// Validation messages`, delete these thirteen lines with the Edit tool (they are contiguous, between `errorProjectNameRequired` and `errorEndBeforeStart`):

```ts
  errorProjectCodeRequired: "Project code is required.",
  errorProjectManagerRequired: "Project manager is required.",
  errorStakeholdersInternalRequired: "At least one internal stakeholder is required.",
  errorStakeholdersExternalRequired: "At least one external stakeholder is required.",
  errorContactsRequired: "At least one contact is required.",
  errorCustomerRequired: "Customer is required.",
  errorNaceRequired: "NACE section is required.",
  errorProductsRequired: "At least one product is required.",
  errorDeploymentRequired: "Deployment is required.",
  errorStartDateRequired: "Start date is required.",
  errorEndDateRequired: "End date is required.",
  errorProfitCenterRequired: "Profit center is required.",
  errorRegulatoryRequired: "Regulatory classification is required.",
```

- [ ] **Step 6: Delete the same 13 keys from DE, by script**

Write `<scratchpad>/drop-de-keys.cjs` (with the Write tool, into the scratchpad — never into the repo):

```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const keys = [
  "errorProjectCodeRequired", "errorProjectManagerRequired",
  "errorStakeholdersInternalRequired", "errorStakeholdersExternalRequired",
  "errorContactsRequired", "errorCustomerRequired", "errorNaceRequired",
  "errorProductsRequired", "errorDeploymentRequired", "errorStartDateRequired",
  "errorEndDateRequired", "errorProfitCenterRequired", "errorRegulatoryRequired",
];
let s = fs.readFileSync(p, "utf8");
const loneLfBefore = (s.match(/(?<!\r)\n/g) || []).length;
for (const k of keys) {
  const re = new RegExp("^  " + k + ': "[^"\\r\\n]*",\\r\\n', "m");
  if (!re.test(s)) throw new Error("anchor not found: " + k);
  s = s.replace(re, "");
}
const loneLfAfter = (s.match(/(?<!\r)\n/g) || []).length;
if (loneLfAfter !== loneLfBefore) throw new Error("line endings changed");
fs.writeFileSync(p, s, "utf8");
console.log("removed", keys.length, "keys; lone LF", loneLfBefore, "->", loneLfAfter);
```

Run: `node <scratchpad>/drop-de-keys.cjs; echo "EXIT=$?"`
Expected: `removed 13 keys; lone LF 0 -> 0` (the before count must equal the after count, whatever it is) and EXIT=0. A thrown "anchor not found" means nothing was written — read the error, do not loosen the regex.

Verify both dictionaries:
Run: `git grep -c -E "error(ProjectCode|ProjectManager|StakeholdersInternal|StakeholdersExternal|Contacts|Customer|Nace|Products|Deployment|StartDate|EndDate|ProfitCenter|Regulatory)Required" -- src; echo "EXIT=$?"`
Expected: no output, EXIT=1 (git grep's "nothing found"). Then `git grep -n "errorProjectNameRequired\|errorEndBeforeStart\|errorInvalidUrl" -- src/app/i18n.ts src/app/i18n.de.ts` returns exactly six lines, and `git diff -- src/app/i18n.de.ts` shows 13 deleted lines, no added ones, and every umlaut in the surrounding context intact.

- [ ] **Step 7: Take the dead wiring off the form**

In `src/app/project-form-fields.tsx`, for each of these **nine** fields — `code`, `projectManager`, `customer`, `naceSection`, `products`, `deployment`, `startDate`, `profitCenter`, `regulatory` — remove from its `<Field …>` the ` required` attribute, and from its control the `onBlur={() => markTouched("<field>")}`, `aria-invalid={errorFor("<field>") ? true : undefined}` and `aria-describedby={errorFor("<field>") ? "<field>-error" : undefined}` lines, and the `<FieldError id="<field>-error">{errorFor("<field>")}</FieldError>` line. Worked example for `code`:

```tsx
      <Field lang={lang} label={t(lang,"projectCode")} tooltip={t(lang, "tipProjectCode")}>
        <input
          type="text"
          value={draft.code}
          onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))}
          className={inputClass}
        />
      </Field>
```

`regulatory` has no single control carrying those attributes: remove ` required` from its `<Field …>`, the `<FieldError id="regulatory-error">…</FieldError>` line, and the `markTouched("regulatory");` first line of `toggleRegulatory`.

Leave `name` exactly as it is (`required`, `onBlur`, `aria-*`, `FieldError`), and leave every `endDate` and URL field's wiring exactly as it is — those three validations survive.

For contacts:

1. At the `ContactPersonsControl` call site, replace:

```tsx
      {/* Contacts are MANDATORY (≥1). Consumes registry resources + the address
          book via the link-only ResourcePicker. */}
```

with:

```tsx
      {/* Contacts are optional (O-1). Consumes registry resources + the address
          book via the link-only ResourcePicker. */}
```

and in its props delete the `required` line and the `error={errorFor("contactPersons")}` line, and change the `onChange` body to the single statement `setDraft((p) => ({ ...p, contactPersons: next }));`.

2. In `function ContactPersonsControl`, delete `required,` and `error,` from the destructured parameters, delete `required?: boolean;` and `error?: string | null;` from its prop type, delete the line `{required && <span className="text-ui-pink-strong">*</span>}` inside its caption, and delete `<FieldError id="contactPersons-error">{error}</FieldError>`.

Verify: `grep -n "required" src/app/project-form-fields.tsx` now shows only the `Field` wrapper's own comment, prop, type and asterisk line, plus `projectName`'s `required`. `grep -on 'errorFor("[a-zA-Z]*")' src/app/project-form-fields.tsx | sort -t'"' -k2 -u` lists only `name`, `endDate` and the four URL fields.

- [ ] **Step 8: Correct the two AI-proposal docstrings**

In `src/app/ai-project-proposal.ts`, replace:

```ts
 *  Everything here maps onto a ProjectFormDraft patch — the user completes the
 *  remaining required fields (code, NACE, deployment, …) in the Step-1 form. */
```

with:

```ts
 *  Everything here maps onto a ProjectFormDraft patch — the user may complete
 *  the remaining key facts (code, NACE, deployment, …) in the Step-1 form, or
 *  leave them blank: only `name` is required (O-1). */
```

and replace:

```ts
 *  model supplied; the form keeps its blank defaults for the rest and its own
 *  validation forces the user to complete required fields. */
```

with:

```ts
 *  model supplied; the form keeps its blank defaults for the rest, all of
 *  which may be submitted blank except `name` (O-1). */
```

- [ ] **Step 9: Run both files green**

Run: `npx vitest run src/app/project-validation.test.ts --maxWorkers=1 > <scratchpad>/t2c.log 2>&1; echo "EXIT=$?"` → EXIT=0.
Run: `npx vitest run src/app/project-form.test.tsx --maxWorkers=1 > <scratchpad>/t2d.log 2>&1; echo "EXIT=$?"` → EXIT=0.
Run: `npx vitest run src/app/create-project-wizard.test.tsx --maxWorkers=1 > <scratchpad>/t2e.log 2>&1; echo "EXIT=$?"` → EXIT=0 (it drives the same form through `fillRequired`; it must be unaffected).
Run: `npx vitest run src/app/i18n --maxWorkers=1 > <scratchpad>/t2f.log 2>&1; echo "EXIT=$?"` → EXIT=0, and the log's `Test Files` count is non-zero (the encoding test bans ASCII umlaut substitutes; a zero count means the filter matched nothing).

- [ ] **Step 10: Mutation-check the asterisk pin**

Put ` required` back on the `projectCode` `<Field>` with the Edit tool, run `project-form.test.tsx`, expect "marks only the project name as required" to FAIL with 2 elements, revert, and prove the revert with `git diff -- src/app/project-form-fields.tsx | grep -c 'label={t(lang,"projectCode")} required'` printing `0`.

- [ ] **Step 11: Commit**

```bash
git commit -F <scratchpad>/c2.txt -- src/app/project-validation.ts src/app/i18n.ts src/app/i18n.de.ts src/app/project-form-fields.tsx src/app/ai-project-proposal.ts src/app/project-validation.test.ts src/app/project-form.test.tsx
```

Subject: `feat(project): create a project from a name alone`. Body: the three surviving validations, the 13 keys (noting three were already dead: `errorStakeholdersInternalRequired`, `errorStakeholdersExternalRequired`, `errorEndDateRequired`), the ten markers, the mutation outcome, and the trailer.

---

### Task 3: The TimeLog fetch window survives a blank start date

**Files:**
- Modify: `src/app/timelog-panel.tsx` (`fetchWindow`)
- Test: `src/app/timelog-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1's widened `ProjectMeta` (a blank `startDate` is now a real value).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing pin and its control**

In `src/app/timelog-panel.test.tsx`, directly below `function SeedProjectCustomer(…) { … }`, add:

```tsx
/** Seed a project with a given start date — "" is legal since O-1. */
function SeedProjectStart({ startDate }: { startDate: string }) {
  const ws = useWorkspace();
  useEffect(() => {
    ws.setProject({ name: "Solo", code: "", startDate } as unknown as Parameters<typeof ws.setProject>[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
```

Inside `describe("Refresh bookings", …)`, after the first `it(…)`, add:

```tsx
    it("falls back to a real date when the project's start date is blank (O-1)", async () => {
      enableTimelog();
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 0, projectCount: 1 });
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 5, projectIds: [9] }} />
          <SeedProjectStart startDate="" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const btn = await screen.findByRole("button", { name: t("en-US", "timelogRefresh") });
      await waitFor(() => expect(btn).toBeEnabled()); // §39: wait for ENABLED, not present
      fireEvent.click(btn);
      await waitFor(() =>
        expect(fetchBookingsForProjects).toHaveBeenCalledWith(
          [9], expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.any(String),
        ),
      );
    });

    it("uses the project's start date when it is set (control)", async () => {
      enableTimelog();
      const fetchBookingsForProjects = vi.fn().mockResolvedValue({ failedProjects: 0, projectCount: 1 });
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue(
        { ...defaultSyncReturn(), fetchBookingsForProjects } as unknown as ReturnType<typeof useTimelogSync>,
      );
      render(
        <>
          <SeedWorkspace links={{ ...INITIAL_LINKS, customerId: 5, projectIds: [9] }} />
          <SeedProjectStart startDate="2026-01-01" />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const btn = await screen.findByRole("button", { name: t("en-US", "timelogRefresh") });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      await waitFor(() =>
        expect(fetchBookingsForProjects).toHaveBeenCalledWith([9], "2026-01-01", expect.any(String)),
      );
    });
```

★ The control is what makes the first test worth anything: without a seeded project `ws.project` is `undefined`, `??` falls back, and the first test would pass against the unfixed code. The control proves the seed reaches `fetchWindow`.

- [ ] **Step 2: Run and watch the right one fail**

Run: `npx vitest run src/app/timelog-panel.test.tsx -t "start date" --maxWorkers=1 > <scratchpad>/t3a.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 — "falls back to a real date…" FAILS (called with `""`), and the control PASSES. If the control also fails, the seed is not reaching the panel: fix the test, not the code.

- [ ] **Step 3: Fix the fallback**

In `src/app/timelog-panel.tsx` `fetchWindow`, change:

```ts
    const start =
      ws.project?.startDate ??
      new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
```

to:

```ts
    // `||`, not `??`: since O-1 a project's startDate may be "" (not set), which
    // is not nullish and would be sent to TimeLog as an empty start.
    const start =
      ws.project?.startDate ||
      new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
```

- [ ] **Step 4: Run green**

Run: `npx vitest run src/app/timelog-panel.test.tsx --maxWorkers=1 > <scratchpad>/t3b.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, whole file.

- [ ] **Step 5: Read the rest of the blank-value consumers**

The spec's sweep grep bounds only fallback operators. Run:

```bash
git grep -n -E '\b(ws\.project|workspace\.project|project|meta|currentProject)\??\.(code|projectManager|customer|products|profitCenter|naceSection|deployment|startDate)\b' -- src ':!*.test.*' ':!src/app/i18n*' > <scratchpad>/t3-consumers.txt; echo "EXIT=$?"
```

Read every hit. `report.project.*` off a budget report is a different entity (`ProjectReport`) and out of scope. For each remaining hit, decide whether a `""` value is mishandled — a length check, an equality against a known value, a date parse, a string sent outward. Expected: none beyond the three the spec already records. If you find one, STOP and report it with the file and line; do not fix it in this task.

- [ ] **Step 6: Commit**

```bash
git commit -F <scratchpad>/c3.txt -- src/app/timelog-panel.tsx src/app/timelog-panel.test.tsx
```

Subject: `fix(timelog): fall back when the project has no start date`. Body names the consumer read in Step 5 and its result, plus the trailer.

---

### Task 4: A blank code renders as `—`

**Files:**
- Modify: `src/app/projects-panel.tsx` (two sites)
- Modify: `src/app/turso-project-picker.tsx` (one site)
- Test: `src/app/projects-panel.test.tsx`, `src/app/turso-project-picker.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks at runtime.
- Produces: nothing other tasks use.

`project-switcher.tsx` already wraps its code line in `{p.code && (…)}` and omits it when blank — leave it alone.

- [ ] **Step 1: Write the failing pins**

In `src/app/projects-panel.test.tsx`, inside the top-level `describe`, add:

```tsx
  it("renders a blank project code as — in the active list", () => {
    setup({
      projects: [
        ...PROJECTS,
        { id: "p3", name: "Codeless", code: "", storageConfig: { kind: "local-json" } as never },
      ],
    });
    expect(within(screen.getByText("Codeless").parentElement!).getByText("—")).toBeInTheDocument();
    // Control: a real code still renders as itself.
    expect(within(screen.getByText("Gemini").parentElement!).getByText("GEM-2")).toBeInTheDocument();
  });

  it("renders a blank project code as — in the archived list", () => {
    setup({
      mode: "turso",
      archivedProjects: [{ id: "p9", name: "Codeless archived", code: "", storageConfig: { kind: "turso" } as never }],
    });
    fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
    expect(within(screen.getByText("Codeless archived").parentElement!).getByText("—")).toBeInTheDocument();
  });
```

In `src/app/turso-project-picker.test.tsx`, inside `describe("TursoProjectPicker", …)`, add (and add `within` to the `@testing-library/react` import):

```tsx
  it("renders a blank project code as —", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Codeless", code: "" }, archived: false } as never,
      { id: "p2", meta: { name: "Gemini", code: "GEM-2" }, archived: false } as never,
    ]);
    setup();
    const row = (await screen.findByText("Codeless")).parentElement!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByText("Gemini").parentElement!).getByText("GEM-2")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run each file alone: `npx vitest run src/app/projects-panel.test.tsx --maxWorkers=1 > <scratchpad>/t4a.log 2>&1; echo "EXIT=$?"`, then the same for `turso-project-picker.test.tsx` into `t4b.log`.
Expected: EXIT=1 for both — the three `—` assertions fail with "Unable to find an element with the text: —"; the `GEM-2` controls pass. If `getByText("Codeless")` itself throws for multiple matches, scope it with the row's list instead of widening the text.

- [ ] **Step 3: Render the dash**

In `src/app/projects-panel.tsx`, both occurrences of:

```tsx
                          {p.code}
```

and

```tsx
                        {p.code}
```

become `{p.code || "—"}` (keep each site's indentation).

In `src/app/turso-project-picker.tsx`, change:

```tsx
                    <span className="font-mono text-xs text-muted-foreground">{p.meta.code}</span>
```

to:

```tsx
                    <span className="font-mono text-xs text-muted-foreground">{p.meta.code || "—"}</span>
```

Verify: `git grep -n "{p.code}\|{p.meta.code}" -- src ':!*.test.*'` now returns only `project-switcher.tsx`.

- [ ] **Step 4: Run green, one file at a time**

Both files: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git commit -F <scratchpad>/c4.txt -- src/app/projects-panel.tsx src/app/turso-project-picker.tsx src/app/projects-panel.test.tsx src/app/turso-project-picker.test.tsx
```

Subject: `fix(projects): show a blank project code as a dash`. Trailer.

---

### Task 5: File the consequence this MR does not fix

Two code-less projects now produce the same `projectId` signal for `useTimelogPickerScope` (spec §4.4), so an in-place switch between them does not reset the TimeLog picker's one-shots. `||` would not fix it, and two projects sharing a code already had the flaw. Record it; do not patch it.

**Files:**
- Modify: `docs/open-followups.md` (LF file — Edit tool)

- [ ] **Step 1: Take the next free number from `origin/main`, not from this plan**

Run: `git fetch origin main && git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1`
The entry's number is that value plus one. Call it `N` below. (It was 478 on 2026-09-13; do not assume it still is.) Also check the local branch does not already use `N`: `grep -n "^## N\." docs/open-followups.md` must print nothing.

- [ ] **Step 2: Derive the anchor**

The heading is `## N. Two projects without a code look like the same project to the TimeLog picker — OPEN`. Derive its anchor rather than typing it — an em dash between spaces yields a DOUBLE hyphen:

```bash
node -e 'const h=process.argv[1];console.log("#"+h.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu,"").replace(/ /g,"-"))' "N. Two projects without a code look like the same project to the TimeLog picker — OPEN"
```

(substituting the real number). Control it against a real anchor: the same command on `478. Switching back to the modern layout moves the user off their current view — OPEN` must print exactly the `§478` row's link target.

- [ ] **Step 3: Add the entry**

Append the section after the last `## ` entry, before any trailing matter, using this text (substitute `N`):

```markdown
## N. Two projects without a code look like the same project to the TimeLog picker — OPEN

**Status:** OPEN 2026-09-13 — never machine-verified. Reasoned from the call site, which is presence-checked
with `grep -n "projectId: projectCode" src/app/timelog-panel.tsx` and
`grep -n "seenProjectId !== projectId" src/app/use-timelog-picker-scope.ts`; no test or browser run has
switched between two code-less projects.

`timelog-panel.tsx` passes `ws.project?.code ?? "default"` to `useTimelogPickerScope` as `projectId`. The
hook does not send it anywhere: it compares it against the last value it saw, and a change resets its
one-shot picker seeding on an in-place project switch. The actuals cache is keyed on `projectKey`, not on
this value.

Since O-1 (project creation from a name alone) a project's `code` may be blank. Two code-less projects
therefore both produce `""`, and an in-place switch from one to the other is not seen as a switch: the
picker keeps the first project's customer and project selection.

★ Rewriting the fallback to `||` does NOT fix this — both projects would then produce `"default"` instead.
★ It is not new with O-1: two projects that share a code already collapsed the same way. O-1 only makes
it likely, because a blank code is now the normal state of a new project.

The fix is a signal that is unique per project (the registry or Turso project id), which is what the hook
actually needs to detect a switch. Not done in O-1's MR because it changes the hook's contract and its
tests, which that MR does not otherwise touch.
```

- [ ] **Step 4: Add the index row**

Inside the index table between the whole-line `<!-- INDEX:BEGIN -->` and `<!-- INDEX:END -->` markers (the real ones, not the copies inside the fenced sample near the top), directly after the row for the previous highest number, add:

```markdown
| [§N](<anchor from Step 2>) | Two projects without a code look like the same project to the TimeLog picker — OPEN | found 2026-09-13 while correcting the O-1 spec's TimeLog claim against `origin/main` `c3598637` | S — pass a per-project id as the switch signal, and pin a switch between two code-less projects | open |
```

- [ ] **Step 5: Check the entry the way the two gates will read it**

These are the gates' own parsers, used as a probe, not the gates:

```bash
node --input-type=module -e '
import { readFileSync } from "fs";
import { parseEntries, isClosed } from "./scripts/followup-claims-lib.mjs";
import { statusViolations } from "./scripts/followup-status-lib.mjs";
const src = readFileSync("docs/open-followups.md", "utf8");
const n = Number(process.argv[1]);
const e = parseEntries(src).find((x) => x.n === n);
if (!e) { console.log("NOT PARSED"); process.exit(1); }
console.log("closed:", isClosed(e.title), "violations:", JSON.stringify(statusViolations(e)));
' N
```

Expected: `closed: false violations: []`. If the import names differ, read `scripts/check-followup-status.mjs` for the gate's actual call shape and match it exactly — do not guess.

Then: `grep -c "^| \[§N\]" docs/open-followups.md` prints `1` and `grep -c "^## N\." docs/open-followups.md` prints `1`.

- [ ] **Step 6: Commit**

```bash
git commit -F <scratchpad>/c5.txt -- docs/open-followups.md
```

Subject: `docs(followups): file §N — code-less projects share one TimeLog switch signal`. Trailer.

---

## After the last task

Do not push. Report to the controller: the five commit SHAs, every mutation outcome, the Task 3 Step 5 consumer read, and the follow-up number used. The MR description, CHANGELOG entry and version bump are separate user-gated steps. Nothing in CI can see these, so list them in the MR description as owed:

1. Create a project with only a name in the running app, reload, and confirm it is still there — once per backend you can reach (local JSON file, IndexedDB, Turso).
2. Open that project's Projects row and the Turso picker, and confirm the `—` reads acceptably in light and dark schemes (Projects is not axe-scanned).
