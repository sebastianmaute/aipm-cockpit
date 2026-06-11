# Resource-linked Project Contacts (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ContactPerson` a `resourceId` FK and make the project contact-persons editor a link-only resource picker — normalizing the last person surface.

**Architecture:** Add `resourceId?: number | null` to `ContactPerson`, extend its single string encoder to append the id only when set (byte-stable; no Turso DDL, no schema bump, no golden change), and swap `ContactPersonsControl`'s add UI for a link-only `ResourcePicker` + Add button. `resources` is threaded through the project forms.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL, Tailwind (AIPM palette).

**Spec:** `docs/superpowers/specs/2026-06-11-contact-person-fk-sp4-design.md`. **Branch:** `feat-contacts-retire-sp4`. Do NOT edit `eslint.config.mjs`.

**Verified facts:**
- `ContactPerson = { name: string; email: string; synced: boolean }` (types.ts). `synced`: true = from address book, false = manual.
- `encodeContactPersons`/`decodeContactPersons` (csv-codecs.ts) — entry `name;email;synced` (sub-fields escape `\ ; |`), joined by `PROJECT_LIST_DELIM`. Used by CSV, Markdown (`projectFieldToString`), and the Turso `projects` row's `contactPersons` text column. JSON round-trips ProjectMeta directly.
- `sanitizeContactPerson` (sanitize.ts:1034). `fkIdOrUndefined` (sanitize.ts — positive-int FK guard) is exported and used by other sanitizers.
- `ContactPersonsControl` (project-form-fields.tsx:542) — chip list + an "add from address book" `<select>` (synced:true) + manual name/email inputs + Add (synced:false). It gets `contactPersons`/`addressBook`/`onChange`.
- Threading: `ContactPersonsControl` ← `ProjectFormFields` (gets `addressBook`) ← `CreateProjectForm` / `ProjectForm` (edit) ← `ProjectEmptyState` / `projects-panel` ← `task-manager` (has `resources` + `contactsList`).
- `ResourcePicker` (resource-picker.tsx): `value:{name,email,resourceId}`, `resources`, `contacts`, `onChange:(next:{name,email,resourceId:number|null})=>void`, optional `onCreateResource` (omit → link-only, no "+ Add"), `placeholder`/`aria-*`.

---

## Task 1: ContactPerson FK — type, sanitizer, encoding

**Files:**
- Modify: `src/app/types.ts`
- Modify: `src/app/sanitize.ts`
- Modify: `src/app/csv-codecs.ts`
- Test: `src/app/csv-codecs.test.ts` (or wherever encodeContactPersons is tested — grep `encodeContactPersons`; if no test exists, add a small one) + a sanitize test

- [ ] **Step 1: Write the failing tests**

Grep for an existing `encodeContactPersons` test file (`grep -rn "encodeContactPersons\|decodeContactPersons" src/app/*.test.ts`). Add to it (or create `src/app/contact-persons-codec.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { encodeContactPersons, decodeContactPersons } from "./csv-codecs";

describe("contactPersons codec — resourceId", () => {
  it("omits resourceId for an unlinked contact (byte-identical 3-field form)", () => {
    const s = encodeContactPersons([{ name: "Ann Lee", email: "a@x.com", synced: false }]);
    expect(s).toBe("Ann Lee;a@x.com;0");
  });
  it("appends resourceId only when set, and round-trips", () => {
    const people = [
      { name: "Ann Lee", email: "a@x.com", synced: false },
      { name: "Alex Example", email: "s@x.com", synced: true, resourceId: 7 },
    ];
    const s = encodeContactPersons(people);
    const back = decodeContactPersons(s);
    expect(back[0]).toEqual({ name: "Ann Lee", email: "a@x.com", synced: false });
    expect(back[1]).toEqual({ name: "Alex Example", email: "s@x.com", synced: true, resourceId: 7 });
  });
  it("decodes legacy 3-field entries with resourceId unset", () => {
    const back = decodeContactPersons("Bob;b@x.com;1");
    expect(back[0].resourceId).toBeUndefined();
  });
});
```

Add to the sanitize test file (`grep -rn "sanitizeProjectMeta\|sanitizeContactPerson" src/app/*.test.ts` — use the file that tests project meta; assert via `sanitizeProjectMeta` since `sanitizeContactPerson` is not exported):

```ts
it("sanitizeProjectMeta keeps a positive contactPerson resourceId and drops a bad one", () => {
  const meta = sanitizeProjectMeta({ name: "P", contactPersons: [
    { name: "A", email: "", synced: false, resourceId: 5 },
    { name: "B", email: "", synced: false, resourceId: 0 },
    { name: "C", email: "", synced: false, resourceId: -1 },
  ] });
  expect(meta?.contactPersons[0].resourceId).toBe(5);
  expect(meta?.contactPersons[1].resourceId).toBeUndefined();
  expect(meta?.contactPersons[2].resourceId).toBeUndefined();
});
```
(Use the file's existing `sanitizeProjectMeta` import / required-field helpers; if `name` alone isn't a valid ProjectMeta, build a minimal valid meta the way that file's other tests do.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run <those test files>`
Expected: FAIL (resourceId not encoded/decoded/sanitized).

- [ ] **Step 3: Add the type field**

`src/app/types.ts`, in `ContactPerson` after `synced`:
```ts
  /** Optional FK -> Resource.id; null/absent for an external (unlinked) contact. */
  resourceId?: number | null;
```

- [ ] **Step 4: Sanitizer**

`src/app/sanitize.ts`, in `sanitizeContactPerson`, change the return to include the FK via the existing guard:
```ts
  const synced = typeof input.synced === "boolean" ? input.synced : false;
  const resourceId = fkIdOrUndefined(input.resourceId);
  return resourceId === undefined ? { name, email, synced } : { name, email, synced, resourceId };
```
(`fkIdOrUndefined` is already defined/exported in this file — no new import.)

- [ ] **Step 5: Encoder/decoder**

`src/app/csv-codecs.ts`, `encodeContactPersons` — append the id only when set:
```ts
  return people
    .map((p) => {
      const base = `${esc(p.name)};${esc(p.email)};${p.synced ? "1" : "0"}`;
      return typeof p.resourceId === "number" ? `${base};${p.resourceId}` : base;
    })
    .join(PROJECT_LIST_DELIM);
```
`decodeContactPersons` — read the optional 4th sub-field (the `for (const entry of entries)` block):
```ts
  for (const entry of entries) {
    const [name = "", email = "", synced = "0", rid = ""] = splitFields(entry);
    const person: ContactPerson = { name: unescape(name), email: unescape(email), synced: synced === "1" };
    if (rid !== "") person.resourceId = Number(rid);
    people.push(person);
  }
```
(`resourceId` from decode is re-validated by `sanitizeContactPerson` on the project-load path, so `Number(rid)` is safe here.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run <those test files>` → PASS. Then `npx vitest run src/app/golden-workspace.test.ts` → PASS (byte-unchanged — the sample has no linked contacts).

- [ ] **Step 7: tsc + lint + commit**

Run: `npx tsc --noEmit` (0), `npm run lint` (0).
```bash
git add src/app/types.ts src/app/sanitize.ts src/app/csv-codecs.ts <test files>
git commit -m "feat: ContactPerson.resourceId FK + byte-stable encoding"
```

---

## Task 2: Link-only ResourcePicker in the contact-persons editor + thread resources

**Files:**
- Modify: `src/app/project-form-fields.tsx` (`ContactPersonsControl` + `ProjectFormFields` props)
- Modify: `src/app/create-project-form.tsx`, `src/app/project-form.tsx`, `src/app/project-empty-state.tsx` (forward `resources`)
- Modify: `src/app/task-manager.tsx` (pass `resources` to the project-form render sites)
- Modify: `src/app/projects-panel.tsx` if it renders the edit `ProjectForm` (grep)
- Test: `src/app/project-form-fields.test.tsx` if present, else a focused render test

- [ ] **Step 1: Write the failing test**

Find/choose a test that renders `ProjectFormFields` or `ContactPersonsControl` (grep `ContactPersonsControl\|ProjectFormFields` in `*.test.tsx`). Add a test: with `resources=[{id:1,firstName:"Sample",lastName:"Dummy",email:"s@x.com",roleId:null,utilizationMode:"percent",utilization:{}}]`, type "Sample" in the contact-person picker, pick "Alex Example", click Add, and assert the `onChange` (project draft) carries a `contactPersons` entry `{ name: "Alex Example", email: "s@x.com", resourceId: 1, ... }`. Also assert NO "+ Add as resource" row appears (link-only). Model on the file's harness; if none renders these, render `ProjectFormFields` directly with a spy.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run <that test>` → FAIL.

- [ ] **Step 3: Rewrite `ContactPersonsControl`'s add UI**

In `src/app/project-form-fields.tsx`:
1. Add `import { ResourcePicker } from "./resource-picker";` and `import type { Resource } from "./types";` (extend existing `./types` import).
2. `ContactPersonsControl`'s prop type gains `resources: readonly Resource[];`. Destructure `resources`.
3. Replace BOTH add mechanisms (the "add from address book" `<select>` block AND the manual name/email + Add block) with one draft picker + Add button. Replace the manual-state with a single draft:
```tsx
  const [draft, setDraft] = useState<{ name: string; email: string; resourceId: number | null }>(
    { name: "", email: "", resourceId: null },
  );

  const addDraft = () => {
    const name = draft.name.trim();
    if (!name || hasName(name)) return;
    const synced = draft.resourceId != null || addressBook.some((c) => c.name === name);
    const cp: ContactPerson = draft.resourceId != null
      ? { name, email: draft.email.trim(), synced, resourceId: draft.resourceId }
      : { name, email: draft.email.trim(), synced };
    onChange([...contactPersons, cp]);
    setDraft({ name: "", email: "", resourceId: null });
  };
```
And the add-row JSX (replacing the select + manual inputs):
```tsx
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <ResourcePicker
            lang={lang}
            value={draft}
            resources={resources}
            contacts={addressBook}
            onChange={(next) => setDraft({ name: next.name, email: next.email, resourceId: next.resourceId })}
            placeholder={t(lang, "contactAddManual")}
            aria-label={t(lang, "contactAddManual")}
          />
        </div>
        <button
          type="button"
          onClick={addDraft}
          className="shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
        >
          {t(lang, "add")}
        </button>
      </div>
```
Remove the now-unused `manualName`/`manualEmail`/`bookSel` state, `addFromBook`, `addManual`, `nameId`, `emailId`. Keep the chip list. In the chip `<li>`, add a linked indicator when `cp.resourceId != null` (a small AIPM-green dot before the name):
```tsx
              <span className="flex items-center gap-1.5">
                {cp.resourceId != null && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-AIPM-green" title={t(lang, "resourcePickerLinked")} />}
                {cp.name}{cp.email ? ` <${cp.email}>` : ""}
              </span>
```

- [ ] **Step 4: Add `resources` to `ProjectFormFields` + forward to the control**

`ProjectFormFields` props gain `resources: readonly Resource[];` (near `addressBook`); destructure it; pass `resources={resources}` to `<ContactPersonsControl>`.

- [ ] **Step 5: Thread `resources` through the project-form parents**

For each of `create-project-form.tsx`, `project-form.tsx`, `project-empty-state.tsx`: add `resources: readonly Resource[];` to the props interface (near `addressBook`), destructure, and forward to the child it renders (`<ProjectFormFields resources={resources} .../>`, `<CreateProjectForm resources={resources} .../>`). Add the `Resource` type import where needed.

- [ ] **Step 6: Provide `resources` from `task-manager` + edit path**

In `task-manager.tsx`: at the `<ProjectEmptyState ... addressBook={contactsList} />` render, add `resources={resources}`. For the edit `ProjectForm` path: grep `ProjectForm\b` / `projectAddressBook` and ensure the props object / render site that feeds the edit form also passes `resources={resources}` (likely via the portfolio props object at ~line 1125 and its consumer `projects-panel.tsx`). Add `resources` to that object + the consumer's prop interface + the `<ProjectForm>` render.

- [ ] **Step 7: tsc-driven completeness**

Run: `npx tsc --noEmit`. It will flag every render site still missing `resources` (required prop) and any test fixtures. Add `resources={[]}` / `resources: []` to fixtures; add `resources` to any missed render site. Repeat until clean.

- [ ] **Step 8: Gates + commit**

Run: `npx tsc --noEmit` (0), `npm run lint` (0), `npx vitest run <project-form tests>`, then broad `npx vitest run src/app`.
```bash
git add src/app/project-form-fields.tsx src/app/create-project-form.tsx src/app/project-form.tsx src/app/project-empty-state.tsx src/app/task-manager.tsx src/app/projects-panel.tsx <tests/fixtures>
git commit -m "feat: resource-aware link-only picker for project contact persons"
```

---

## Task 3: Release 0.65.0 + final gates

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version bump**

`package.json`: `0.64.0` → `0.65.0`. `src/app/version.ts`: `APP_VERSION = "0.65.0"`, update the `APP_BUILD_DATE` comment, set `APP_MILESTONE = "Cherryh"` (C.J. Cherryh — fresh codename for the 0.65.x line), update the codename JSDoc to say the 0.65.x line is "Cherryh".

- [ ] **Step 2: CHANGELOG entry**

Prepend above `## [0.64.0]`:
```markdown
## [0.65.0] - 2026-06-11 "Cherryh"

Resource-linked project contacts (identity normalization SP4 — final slice).

### Added
- A project's contact persons can now link to a Resource: the add control is a resource-aware picker (registry-first, address-book fallback) that links a contact to a registry person or leaves it external. Contacts gain a `resourceId` link, completing the resource-normalization of every person surface (tasks, RAID owners, shifts, stakeholders, and now project contacts).
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts; confirm `golden-workspace.test.ts` passes / fixtures byte-unchanged), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.65.0 \"Cherryh\" — resource-linked project contacts (SP4)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual: in a project's contact-persons editor, link a registry person (linked dot shows on the chip), add a free-text external contact (no "+ Add" offered), save + reload — both round-trip; an unlinked contact's serialized form is unchanged.

## Notes / landmines

- **Byte stability:** the encoder appends `;<id>` ONLY when `resourceId` is a number — existing unlinked data stays 3-field, so golden fixtures don't change. Do NOT always-emit a 4th field.
- **No Turso DDL / no schema bump:** `resourceId` lives inside the existing `contactPersons` text column; decode tolerates 3- or 4-field entries.
- `fkIdOrUndefined` returns `number | undefined`; `ContactPerson.resourceId` is `number | null | undefined` — assign the sanitizer's result directly (undefined = unset).
- AIPM palette only (the linked dot uses `bg-AIPM-green`).
- Out of scope: retiring the contacts store, the import's contacts seeding, keyStakeholders fields.
