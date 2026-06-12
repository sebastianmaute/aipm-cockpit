# Create-Wizard & Empty-State Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the create-project wizard and the fresh-install empty-state: backend-config entry points, a resizable wider/shorter modal, a unified Storage dropdown (incl. Turso), "Link to" link fields + a new Jira link, optional end date, stepped identity-count suggestions, field tooltips, and fix the "Next disabled" gating.

**Architecture:** All changes are in the existing create-project / empty-state React components and the `ProjectMeta` data layer. The new `jiraUrl` field is threaded through every serializer the same way `confluenceUrl` already is. The wizard reuses the existing `useResizable` hook and `ResetSizeButton`/`ResizeCornerHint`; the Turso/M365 config reuses existing Settings components.

**Tech Stack:** Next 16 / React 19 / TypeScript / Tailwind v4 / Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-13-create-wizard-empty-state-overhaul-design.md`

**Conventions:** lint is `eslint --max-warnings=0`; tests run with `npx vitest run <pattern>`. Commit after each task. i18n strings go in BOTH `src/app/i18n.ts` (enUS) and `src/app/i18n.de.ts` (de) — keys must match exactly. NEVER edit `i18n.de.ts` with the Edit tool's quote-prone path; use Write/byte-safe edits and re-grep after (known curly-quote corruption).

---

### Task 1: Add `jiraUrl` to ProjectMeta + all serializers (data layer, TDD)

**Files:**
- Modify: `src/app/types.ts:581` (after `confluenceUrl?`)
- Modify: `src/app/sanitize.ts:1163`
- Modify: `src/app/csv-codecs.ts:727` and `:910`
- Modify: `src/app/export-sections.ts:166`
- Modify: `src/app/project-validation.ts:43`, `:67`, `:150-151`
- Modify: `src/app/project-form-fields.tsx:78` (emptyProjectDraft)
- Modify: `src/app/project-form.tsx:70` (draftFromMeta) and `:137` (handleSubmit meta)
- Test: `src/app/sanitize.test.ts` (add a round-trip case) and `src/app/csv-codecs.test.ts`

- [ ] **Step 1: Write the failing test** — add to `src/app/sanitize.test.ts`:

```ts
import { sanitizeProjectMeta } from "./sanitize";
test("sanitizeProjectMeta keeps a valid jiraUrl and drops a blank one", () => {
  const withUrl = sanitizeProjectMeta({ name: "P", code: "C", projectManager: "M", customer: "X", products: "Y", profitCenter: "Z", naceSection: "A", deployment: "Cloud", identityTypes: [], identityCount: "0", regulatory: ["Not applicable"], keyStakeholdersInternal: ["a"], keyStakeholdersExternal: ["b"], startDate: "2026-01-01", endDate: "2026-02-01", contactPersons: [], jiraUrl: "https://acme.atlassian.net/browse/AB-1" });
  expect(withUrl?.jiraUrl).toBe("https://acme.atlassian.net/browse/AB-1");
  const blank = sanitizeProjectMeta({ ...withUrl!, jiraUrl: "" });
  expect(blank?.jiraUrl).toBeUndefined();
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run sanitize` → FAIL (`jiraUrl` not on type / not sanitized).

- [ ] **Step 3: Implement.** Add `jiraUrl?: string;` to `ProjectMeta` (types.ts after line 581). In `sanitize.ts` after line 1163 add the analogue:

```ts
const jiraUrl = sanitizeText(o.jiraUrl, BUDGET_NAME_MAX); if (jiraUrl) meta.jiraUrl = jiraUrl;
```

In `csv-codecs.ts`: add `"jiraUrl"` to the header array at line 727 (after `"confluenceUrl"`) and add `jiraUrl: scalar("jiraUrl"),` at line 910. In `export-sections.ts:166` add `jiraUrl: "projectJira",` (label key, defined in Task 4). In `project-validation.ts`: add `jiraUrl: string;` to the draft interface (after line 43), `| "jiraUrl"` to the field union (after line 67), and after line 151:

```ts
if (draft.jiraUrl && !isLikelyUrl(draft.jiraUrl)) errors.jiraUrl = "errorInvalidUrl";
```

In `project-form-fields.tsx:78` add `jiraUrl: "",` to `emptyProjectDraft`. In `project-form.tsx:70` add `jiraUrl: meta.jiraUrl ?? "",` to `draftFromMeta` and at line 137 add `jiraUrl: draft.jiraUrl,` to the `sanitizeProjectMeta({...})` call.

- [ ] **Step 4: Run** — `npx vitest run sanitize csv-codecs` → PASS. Also `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: add optional jiraUrl to ProjectMeta across all serializers"`

---

### Task 2: Make end date optional (validation, TDD)

**Files:**
- Modify: `src/app/project-validation.ts:139-141`
- Test: `src/app/project-validation.test.ts`

- [ ] **Step 1: Failing test** — add:

```ts
test("end date is optional", () => {
  expect(validateProjectMeta({ ...ok, endDate: "" }).endDate).toBeUndefined();
});
test("end-before-start still flagged when both set", () => {
  expect(validateProjectMeta({ ...ok, endDate: "2025-01-01" }).endDate).toBe("errorEndBeforeStart");
});
```

(`ok` is the existing valid-draft fixture in that test file.)

- [ ] **Step 2: Run, verify fail** — `npx vitest run project-validation` → FAIL (`errorEndDateRequired`).

- [ ] **Step 3: Implement.** In `project-validation.ts` replace the end-date block (lines ~139-141):

```ts
  // End date is optional; if present it must not precede the start date.
  if (endDate && startDate && endDate < startDate) {
    errors.endDate = "errorEndBeforeStart";
  }
```

(Delete the `if (!endDate) errors.endDate = "errorEndDateRequired";` branch.)

- [ ] **Step 4: Run** — `npx vitest run project-validation` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat: make project end date optional"`

---

### Task 3: Stepped identity-count datalist

**Files:**
- Modify: `src/app/project-form-fields.tsx` (identity-count Field, ~line 346-354)
- Test: `src/app/project-form.test.tsx` (assert the datalist options render)

- [ ] **Step 1: Failing test** — render `ProjectForm`, assert a datalist option for `"5000000"` exists:

```ts
expect(container.querySelector('datalist#identity-count-steps option[value="5000000"]')).not.toBeNull();
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Add a module-level const in `project-form-fields.tsx`:

```ts
const IDENTITY_COUNT_STEPS = [50, 100, 500, 1000, 2500, 5000, 10000, 30000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000, 50000000] as const;
```

Change the identity-count `<input>` to add `list="identity-count-steps"` and render a sibling datalist:

```tsx
<input type="number" min={0} value={draft.identityCount} list="identity-count-steps"
  onChange={(e) => setDraft((p) => ({ ...p, identityCount: e.target.value }))} className={inputClass} />
<datalist id="identity-count-steps">
  {IDENTITY_COUNT_STEPS.map((n) => <option key={n} value={n} />)}
</datalist>
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat: stepped identity-count suggestions via datalist"`

---

### Task 4: "Link to" labels, Jira field, and field tooltips

**Files:**
- Modify: `src/app/project-form-fields.tsx` (Field component + the link fields + tooltips)
- Modify: `src/app/i18n.ts` and `src/app/i18n.de.ts` (new keys)
- Test: `src/app/project-form.test.tsx`

i18n keys to add (enUS / de):

| key | enUS | de |
|---|---|---|
| `projectLinkSalesforce` | "Link to Salesforce" | "Link zu Salesforce" |
| `projectLinkSharepoint` | "Link to SharePoint" | "Link zu SharePoint" |
| `projectLinkConfluence` | "Link to Confluence" | "Link zu Confluence" |
| `projectLinkJira` | "Link to Jira" | "Link zu Jira" |
| `projectJira` | "Jira" | "Jira" |
| `tipProjectName` | "Short, human-readable project name." | "Kurzer, lesbarer Projektname." |
| `tipProjectCode` | "Unique short code (e.g. ACME-01)." | "Eindeutiger Kurzcode (z. B. ACME-01)." |
| `tipProjectManager` | "Person accountable for delivery." | "Verantwortliche Person für die Lieferung." |
| `tipCustomer` | "Client organisation." | "Kundenorganisation." |
| `tipStakeholdersInternal` | "Internal stakeholders — type a name and press Enter." | "Interne Stakeholder — Name eingeben, Enter drücken." |
| `tipStakeholdersExternal` | "External stakeholders — type a name and press Enter." | "Externe Stakeholder — Name eingeben, Enter drücken." |
| `tipStartDate` | "Planned project start." | "Geplanter Projektstart." |
| `tipEndDate` | "Planned end (optional)." | "Geplantes Ende (optional)." |
| `tipIdentityCount` | "Approximate number of identities; pick a step or type a number." | "Ungefähre Anzahl Identitäten; Schritt wählen oder Zahl eingeben." |
| `tipDeployment` | "Hosting model for the solution." | "Hosting-Modell der Lösung." |
| `tipProducts` | "Products in scope." | "Produkte im Umfang." |
| `tipProfitCenter` | "Profit centre for billing." | "Profitcenter für die Abrechnung." |
| `tipNace` | "NACE industry classification." | "NACE-Branchenklassifikation." |
| `tipRegulatory` | "Applicable regulatory requirements." | "Geltende regulatorische Anforderungen." |
| `tipLinkUrl` | "Optional URL (https://…)." | "Optionale URL (https://…)." |

- [ ] **Step 1: Failing test** — assert "Link to Jira" label renders and the Salesforce label now reads "Link to Salesforce":

```ts
expect(screen.getByText("Link to Jira")).toBeInTheDocument();
expect(screen.getByText("Link to Salesforce")).toBeInTheDocument();
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**
  1. Add a `tooltip?: string` prop to `Field` (project-form-fields.tsx) and render it as a `title` on the label span plus a muted `ⓘ`:

```tsx
export function Field({ label, required, className, tooltip, children }: { label: string; required?: boolean; className?: string; tooltip?: string; children: React.ReactNode; }) {
  return (
    <label className={`block ${className ?? ""}`} title={tooltip}>
      <span className="mb-1 block text-sm font-medium text-foreground">
        {label}{required && <span className="ml-0.5 text-AIPM-pink">*</span>}
        {tooltip && <span aria-hidden className="ml-1 text-muted-foreground" title={tooltip}>ⓘ</span>}
      </span>
      {children}
    </label>
  );
}
```

  2. Change the three existing link Field labels to use the new keys (`projectLinkSalesforce`/`Sharepoint`/`Confluence`) and add `tooltip={t(lang, "tipLinkUrl")}`.
  3. Add the **Jira** Field after Confluence, mirroring the confluence field (value `draft.jiraUrl`, onChange sets `jiraUrl`, onBlur `markTouched("jiraUrl")`, `errorFor("jiraUrl")`, `FieldError id="jiraUrl-error"`), label `t(lang, "projectLinkJira")`.
  4. Add `tooltip={t(lang, "tip…")}` to every required/optional Field per the table.

- [ ] **Step 4: Run** — `npx vitest run project-form` → PASS. `npx tsc --noEmit` clean. `grep -c '[""]' src/app/i18n.de.ts` unchanged (no curly-quote corruption).

- [ ] **Step 5: Commit** — `git commit -am "feat: Link-to labels, Jira link field, and field tooltips"`

---

### Task 5: Resizable wider/shorter wizard modal (2-column, footer pinned)

**Files:**
- Modify: `src/app/create-project-wizard.tsx` (the outer panel + footer structure)
- Modify: `src/app/project-form.tsx` and `project-form-fields.tsx` (2-column grid)
- Modify: `src/app/project-empty-state.tsx` (panel width)
- Test: `src/app/create-project-wizard.test.tsx`

- [ ] **Step 1: Failing test** — assert the reset-size control renders in the wizard header:

```ts
expect(screen.getByRole("button", { name: /reset size/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**
  1. In `create-project-wizard.tsx` import `useResizable` and `ResetSizeButton`, `ResizeCornerHint` from `./task-manager-ui`. At the top of the component: `const { ref: sizeRef, reset: resetSize } = useResizable("lop-app:create-wizard-size");`
  2. Wrap the wizard body in the resizable panel: attach `ref={sizeRef}` to the outer container, make it `flex flex-col` with a fixed header row (StepIndicator + `<ResetSizeButton onClick={resetSize} lang={lang} />`), a `flex-1 overflow-auto` body, and the step footer (Back/Cancel/Next/Create) as the last child so it pins to the bottom; add `<ResizeCornerHint lang={lang} />`.
  3. Widen the hosting modal panel: in `project-empty-state.tsx` change the panel `w-[720px]` to `w-[880px] max-w-[95vw]`; ensure the `useResizable` min-width allows shrinking (it uses CSS `resize`; set `min-w-[520px]` on the resizable container).
  4. Make the form 2-column: in `project-form-fields.tsx`, wrap each `FormSection`'s field group in `className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2"`; give full-width fields (description, stakeholders, identity-types, regulatory, contactPersons, notes, documentLinks) `className="sm:col-span-2"` via the `Field`/wrapper `className` prop.

- [ ] **Step 4: Run** — `npx vitest run create-project-wizard project-form` → PASS. Manually verify nothing overflows.

- [ ] **Step 5: Commit** — `git commit -am "feat: resizable wider 2-column create-project wizard with pinned footer"`

---

### Task 6: Storage dropdown (rename + Turso) and Turso-config-modal flow

**Files:**
- Modify: `src/app/create-project-form.tsx` (the selector) and `create-project-wizard.tsx` (Turso branch)
- Modify: `src/app/i18n.ts` / `i18n.de.ts` (`projectStorage`, `storageTurso`, `storageNeedsTursoConfig`)
- Reuse: `src/app/storage-config.tsx` (`StorageConfigSection`) inside a `Modal`
- Test: `src/app/create-project-form.test.tsx`

- [ ] **Step 1: Failing test** — assert the selector is labelled "Storage" and offers a Turso option:

```ts
expect(screen.getByLabelText("Storage")).toBeInTheDocument();
expect(screen.getByRole("option", { name: /Turso/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**
  1. In `create-project-form.tsx` rename the `<select>` aria-label/label from "File format" to `t(lang, "projectStorage")`; extend `CREATE_FORMATS` handling with a `"turso"` value whose label is `t(lang, "storageTurso")`. Keep file kinds json/csv/md.
  2. Add a `tursoConfigured: boolean` prop (passed from the host: `settings.storageConfig.kind === "turso"` OR a non-empty `tursoDatabaseUrl`/`tursoAuthToken`). When the user picks "turso" and `!tursoConfigured`, render a `Modal` wrapping `StorageConfigSection` (Turso fields); on save, set the in-memory config and keep the selection.
  3. In the wizard, when storage === "turso", `handleCreate` calls `onCreate(meta, "json", { ...opts })` but the host's `handleCreateProjectByMode` must run the Turso branch — pass a `storage` discriminator through `NewProjectOpts` (add `storage?: "file" | "turso"`) so `use-turso-projects.ts handleCreateProjectByMode` chooses `createTursoProject` when `storage === "turso"`, regardless of `portfolioMode`.

- [ ] **Step 4: Run** — `npx vitest run create-project-form use-turso-projects` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat: unified Storage dropdown with Turso option + config modal at create time"`

---

### Task 7: Empty-state — remove ✕, add backend-config buttons

**Files:**
- Modify: `src/app/project-empty-state.tsx`
- Modify: `src/app/modal-header.tsx` (optional `hideClose` prop) OR render the empty-state header without the close button
- Modify: `src/app/i18n.ts` / `i18n.de.ts` (`emptyStateConfigTuro`, `emptyStateConfigM365`, `backendSetup`, tooltips)
- Reuse: `StorageConfigSection` (Turso) and the M365 sign-in block from `settings-sections/integrations-section.tsx`
- Test: `src/app/project-empty-state.test.tsx`

- [ ] **Step 1: Failing test:**

```ts
expect(screen.queryByLabelText(/close/i)).toBeNull(); // no X
expect(screen.getByRole("button", { name: /configure turso/i })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /configure m365/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**
  1. Add `hideClose?: boolean` to `ModalHeader` (when true, don't render the ✕ button). Pass `hideClose` from `project-empty-state.tsx`.
  2. In the `view === "choices"` branch, after the two primary buttons, add a labelled "Backend setup" section with two buttons (`title` tooltips): **Configure Turso backend** (opens a `Modal` with `StorageConfigSection`) and **Configure M365 integration** (opens a `Modal` with the M365 sign-in block). Use local `useState` for which config modal is open.

- [ ] **Step 4: Run** — `npx vitest run project-empty-state` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat: empty-state backend config buttons; drop the dead close X"`

---

### Task 8: Verify "Next disabled" is resolved

**Files:**
- Test: `src/app/project-validation.test.ts` (or `create-project-form.test.tsx`)

- [ ] **Step 1: Add a test** that a fully-filled draft (all required text fields, both stakeholder arrays non-empty, ≥1 regulatory, start date set, **end date empty**) yields no errors and Next is enabled:

```ts
test("a complete draft with no end date has no errors (Next enabled)", () => {
  expect(hasProjectErrors(validateProjectMeta({ ...ok, endDate: "" }))).toBe(false);
});
```

- [ ] **Step 2: Run** — if it already passes (Task 2 made end date optional), the original blocker was the required end date; document that in the commit. If it FAILS, a genuine field-wiring bug remains — find the field whose value isn't threaded into the draft (compare `emptyProjectDraft` keys vs `validateProjectMeta` reads), fix it, re-run.

- [ ] **Step 3: Commit** — `git commit -am "test: confirm Next is enabled for a complete draft without an end date"`

---

### Task 9: Full verification

- [ ] **Step 1:** `npm run lint` → 0 errors. `npx tsc --noEmit` → clean.
- [ ] **Step 2:** `npm run test:run` → all pass; `npm run test:coverage` meets the gate.
- [ ] **Step 3:** `npm run build` → compiles.
- [ ] **Step 4:** With a dev server, `npm run e2e` (functional) green; if the empty-state/wizard visuals changed materially, regenerate visual baselines (`npm run e2e:visual:update`) and review.
- [ ] **Step 5:** Final commit if any baseline/docs updates: `git commit -am "chore: refresh baselines/docs for wizard overhaul"`

---

## Self-review notes (addressed)

- Spec A (empty-state) → Task 7. B (shell) → Task 5. C (fields/validation) → Tasks 2,3,4,5. D (Turso) → Task 6. E (jiraUrl) → Task 1. F (Next bug) → Task 8.
- `jiraUrl` write-paths enumerated against every current `confluenceUrl` site (grepped) — no missing serializer.
- Markdown codec intentionally excluded: `confluenceUrl` is not serialized there today, so `jiraUrl` follows suit (byte-stable).
