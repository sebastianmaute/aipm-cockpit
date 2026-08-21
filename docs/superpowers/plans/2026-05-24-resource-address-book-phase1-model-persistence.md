# Resource Address Book — Phase 1 (Model & Persistence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `Resource` to an address-book contact at the data layer — replace `name` with `firstName`/`lastName` plus optional contact fields, with backward-compatible persistence — without changing the Resources UI yet.

**Architecture:** Add pure `splitName`/`resourceDisplayName` helpers. Flip `Resource.name` → `firstName`+`lastName`+optional fields in one atomic change (a core type change breaks compilation everywhere at once, so type + sanitizer + backfill + CSV/MD serialization + every `r.name` read move together to a green build). Loaders stay backward-compatible: a legacy `name` (old file or IDB record) splits on the first space. Schema version stays 5 (additive fields, no IDB store changes).

**Tech Stack:** TypeScript, Next.js 16, Vitest, React Testing Library. Source under `src/app/`.

**Source spec:** [`docs/superpowers/specs/2026-05-24-resource-address-book-design.md`](../specs/2026-05-24-resource-address-book-design.md) — Phase 1 of 5.

---

### Task 1: Name helpers (`splitName`, `resourceDisplayName`)

**Files:**
- Modify: `src/app/resource-foundation.ts`
- Test: `src/app/resource-foundation.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/resource-foundation.test.ts` (extend the existing import from `./resource-foundation` to include `splitName, resourceDisplayName`):

```ts
import { splitName, resourceDisplayName } from "./resource-foundation";

describe("splitName", () => {
  it("splits on the first space", () => {
    expect(splitName("Alex Example")).toEqual({ firstName: "Sample", lastName: "Dummy" });
  });
  it("keeps multi-word surnames together", () => {
    expect(splitName("Sample Anne Dummy")).toEqual({ firstName: "Sample", lastName: "Anne Dummy" });
  });
  it("handles a single token", () => {
    expect(splitName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });
  it("collapses and trims whitespace", () => {
    expect(splitName("  Sample   Dummy  ")).toEqual({ firstName: "Sample", lastName: "Dummy" });
  });
  it("returns empty parts for empty input", () => {
    expect(splitName("")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("resourceDisplayName", () => {
  it("joins first and last", () => {
    expect(resourceDisplayName({ firstName: "Sample", lastName: "Dummy" })).toBe("Alex Example");
  });
  it("omits the trailing space when last name is empty", () => {
    expect(resourceDisplayName({ firstName: "Madonna", lastName: "" })).toBe("Madonna");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/resource-foundation.test.ts`
Expected: FAIL — `splitName`/`resourceDisplayName` are not exported.

- [ ] **Step 3: Implement the helpers**

Add to `src/app/resource-foundation.ts` (the file already imports `type Resource` from `./types`):

```ts
/** Split a display name on the FIRST space: "Sample Anne Dummy" → first "Sample", last "Anne Dummy". */
export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

/** Display name for a resource: "First Last", trimmed when last name is empty. */
export function resourceDisplayName(r: Pick<Resource, "firstName" | "lastName">): string {
  return `${r.firstName} ${r.lastName}`.trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/resource-foundation.test.ts`
Expected: PASS. (TypeScript will flag `Pick<Resource, "firstName" | "lastName">` until Task 2 adds those fields — that's expected; this task's tests still run because Vitest transpiles per-file. The green `tsc` build lands at the end of Task 2.)

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-foundation.ts src/app/resource-foundation.test.ts
git commit -m "feat(resources): add splitName and resourceDisplayName helpers"
```

---

### Task 2: Flip the Resource model (type + sanitize + backfill + persistence + reads)

This is one atomic change: it does not compile partway through, so all edits land together and the task ends on a fully green build + test run.

**Files:**
- Modify: `src/app/types.ts:286-300` (the `Resource` type)
- Modify: `src/app/sanitize.ts:465-488` (`sanitizeResource`) + add helpers
- Modify: `src/app/resource-foundation.ts:46-64` (`backfillResources` `ensure`)
- Modify: `src/app/resource-capacity.ts:92`
- Modify: `src/app/resource-report.ts:128`
- Modify: `src/app/storage.ts` (`RESOURCES_CSV_COLUMNS`, `RESOURCES_MD_COLUMNS`, `resourceFieldToString`, `markdownToResources`)
- Modify: `src/app/resources-panel.tsx:132,137,152,399,403,408,466`
- Modify: `src/app/resources-report.tsx:75`
- Modify (tests): `src/app/resource-foundation.test.ts:50,54`, `src/app/storage-serialization.test.ts:23`
- Test: `src/app/sanitize.test.ts`, `src/app/storage-serialization.test.ts`

- [ ] **Step 1: Write failing serialization + sanitize tests**

Add to `src/app/sanitize.test.ts`:

```ts
import { sanitizeResource, sanitizeBirthday } from "./sanitize";

describe("sanitizeResource — address-book fields", () => {
  it("reads firstName/lastName and all contact fields", () => {
    const r = sanitizeResource({
      id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com",
      title: "Architect", businessPhone: "+49 30 1", location: "Berlin",
      department: "IAM", company: "iC", birthday: "06-14",
      notes: "VIP, line two", roleId: 2, utilizationMode: "percent", utilization: {},
    });
    expect(r).toMatchObject({
      id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com",
      title: "Architect", businessPhone: "+49 30 1", location: "Berlin",
      department: "IAM", company: "iC", birthday: "06-14", notes: "VIP, line two",
    });
  });
  it("falls back to splitting a legacy name field", () => {
    const r = sanitizeResource({ id: 2, name: "Sam Placeholder", utilizationMode: "percent", utilization: {} });
    expect(r).toMatchObject({ firstName: "Fictional", lastName: "Jordan" });
  });
  it("drops a record with no usable name", () => {
    expect(sanitizeResource({ id: 3, utilizationMode: "percent", utilization: {} })).toBeNull();
  });
  it("rejects an invalid birthday", () => {
    const r = sanitizeResource({ id: 4, firstName: "A", lastName: "B", birthday: "13-40", utilizationMode: "percent", utilization: {} });
    expect(r?.birthday).toBeUndefined();
  });
});

describe("sanitizeBirthday", () => {
  it("accepts MM-DD in range", () => { expect(sanitizeBirthday("02-29")).toBe("02-29"); });
  it("rejects out-of-range", () => { expect(sanitizeBirthday("00-10")).toBeUndefined(); });
  it("rejects non MM-DD", () => { expect(sanitizeBirthday("2026-06-14")).toBeUndefined(); });
  it("rejects non-strings", () => { expect(sanitizeBirthday(614)).toBeUndefined(); });
});
```

Add to `src/app/storage-serialization.test.ts`:

```ts
import { csvToWorkspace, workspaceToCsv, workspaceToMarkdown, markdownToWorkspace } from "./storage";

describe("resource address-book round-trip", () => {
  const ws = {
    tasks: [], raid: [], absences: [], shifts: [], roles: [], disciplines: [], grades: [],
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" },
    resources: [{
      id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com",
      title: "Architect", businessPhone: "+49 30 1", location: "Berlin",
      department: "IAM", company: "iC", birthday: "06-14",
      notes: "Note with, comma | pipe\nand newline", roleId: null,
      utilizationMode: "percent" as const, utilization: {},
    }],
  };
  it("CSV preserves all address-book fields incl. tricky notes", () => {
    const back = csvToWorkspace(workspaceToCsv(ws as any)).resources[0];
    expect(back).toMatchObject({
      firstName: "Sample", lastName: "Dummy", title: "Architect", department: "IAM",
      company: "iC", birthday: "06-14", businessPhone: "+49 30 1", location: "Berlin",
      notes: "Note with, comma | pipe\nand newline",
    });
  });
  it("Markdown preserves all address-book fields", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(ws as any)).resources[0];
    expect(back).toMatchObject({ firstName: "Sample", lastName: "Dummy", birthday: "06-14" });
  });
  it("loads a legacy single-name CSV resource by splitting", () => {
    const legacy = "# RESOURCES\nid,name,email,roleId,utilizationMode,utilization,absenceOverride,active,localModifiedAt\n1,Sam Placeholder,m@x.com,,percent,,,,\n";
    const back = csvToWorkspace(legacy).resources.find((r) => r.id === 1);
    expect(back).toMatchObject({ firstName: "Fictional", lastName: "Jordan" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/sanitize.test.ts src/app/storage-serialization.test.ts`
Expected: FAIL — `sanitizeBirthday` not exported; resources come back with `name`, not `firstName`/`lastName`.

- [ ] **Step 3: Update the `Resource` type**

Replace `src/app/types.ts:286-300` with:

```ts
export type Resource = {
  id: number;
  firstName: string;
  lastName: string;
  title?: string;
  businessPhone?: string;
  location?: string;
  department?: string;
  email?: string;
  company?: string;
  birthday?: string;   // "MM-DD" (zero-padded month-day, no year)
  notes?: string;      // free text (may contain commas, pipes, newlines)
  /** FK -> Role.id; null when unassigned. */
  roleId: number | null;
  utilizationMode: UtilizationMode;
  /** periodKey ("2026-01" | "2026-W03") -> value (percent 0..100 or hours). */
  utilization: Record<string, number>;
  /** periodKey -> manual absence-hours override (auto-derived otherwise). */
  absenceOverride?: Record<string, number>;
  /** Soft archive; treated as true when absent. */
  active?: boolean;
  localModifiedAt?: string;
};
```

- [ ] **Step 4: Rewrite `sanitizeResource` + add field helpers**

In `src/app/sanitize.ts`, add an import at the top:

```ts
import { splitName } from "./resource-foundation";
```

Add these helpers above `sanitizeResource`:

```ts
function optText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s || undefined;
}

function optMultiline(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\r\n/g, "\n").trim();
  return s || undefined;
}

/** Validate a "MM-DD" birthday (no year). Month 01–12, day 01–31. */
export function sanitizeBirthday(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${m[1]}-${m[2]}`;
}
```

Replace `sanitizeResource` (lines 465-488) with:

```ts
export function sanitizeResource(input: unknown): Resource | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  // Prefer explicit firstName/lastName; fall back to splitting a legacy `name`.
  let firstName = sanitizeAssignee(input.firstName) ?? "";
  let lastName = sanitizeAssignee(input.lastName) ?? "";
  if (!firstName && !lastName && typeof input.name === "string") {
    const split = splitName(input.name);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  if (!firstName && !lastName) return null;

  const mode = sanitizeUtilizationMode(input.utilizationMode);
  const roleIdNum = Number(input.roleId);
  const roleId = Number.isFinite(roleIdNum) && roleIdNum > 0 ? roleIdNum : null;
  const utilization = coercePeriodMap(input.utilization, mode === "percent" ? 100 : HOURS_MAP_MAX);
  const overrideRaw = coercePeriodMap(input.absenceOverride, HOURS_MAP_MAX);

  const resource: Resource = {
    id,
    firstName,
    lastName,
    roleId,
    utilizationMode: mode,
    utilization,
  };
  const email = typeof input.email === "string" ? sanitizeEmail(input.email) || undefined : undefined;
  if (email) resource.email = email;
  const title = optText(input.title); if (title) resource.title = title;
  const phone = optText(input.businessPhone); if (phone) resource.businessPhone = phone;
  const location = optText(input.location); if (location) resource.location = location;
  const department = optText(input.department); if (department) resource.department = department;
  const company = optText(input.company); if (company) resource.company = company;
  const birthday = sanitizeBirthday(input.birthday); if (birthday) resource.birthday = birthday;
  const notes = optMultiline(input.notes); if (notes) resource.notes = notes;
  if (Object.keys(overrideRaw).length > 0) resource.absenceOverride = overrideRaw;
  if (input.active === false) resource.active = false;
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) resource.localModifiedAt = input.localModifiedAt;
  return resource;
}
```

(Note: `sanitize.ts` importing `resource-foundation` is acyclic — `resource-foundation` imports only `./types`.)

- [ ] **Step 5: Update `backfillResources` to populate first/last**

In `src/app/resource-foundation.ts`, inside `ensure` (lines ~51-64), replace the `if (!r) { … } else if (…) { … }` block with:

```ts
    if (!r) {
      const { firstName, lastName } = splitName(name);
      r = {
        id: nextId++,
        firstName,
        lastName,
        email: rawEmail?.trim() || undefined,
        roleId: null,
        utilizationMode: "percent",
        utilization: {},
      };
      byKey.set(key, r);
    } else if (!r.email && rawEmail?.trim()) {
      r.email = rawEmail.trim();
    }
```

- [ ] **Step 6: Update non-UI `name` reads to `resourceDisplayName`**

`src/app/resource-capacity.ts:92` — add `import { resourceDisplayName } from "./resource-foundation";` (or extend the existing import) and change the line to:

```ts
const nameKey = resourceDisplayName(resource).toLowerCase();
```

`src/app/resource-report.ts:128` — add the same import and change `name: r.name` to:

```ts
name: resourceDisplayName(r),
```

- [ ] **Step 7: Update RESOURCES persistence columns + encoders/decoders**

In `src/app/storage.ts`:

Replace `RESOURCES_CSV_COLUMNS` (line ~433):

```ts
const RESOURCES_CSV_COLUMNS = [
  "id", "firstName", "lastName", "title", "businessPhone", "location",
  "department", "email", "company", "birthday", "notes",
  "roleId", "utilizationMode", "utilization", "absenceOverride", "active", "localModifiedAt",
] as const;
```

Replace `resourceFieldToString` (lines ~693-706) — drop the `name` case and add the new fields:

```ts
function resourceFieldToString(r: Resource, c: string): string {
  switch (c) {
    case "id": return String(r.id);
    case "firstName": return r.firstName;
    case "lastName": return r.lastName;
    case "title": return r.title ?? "";
    case "businessPhone": return r.businessPhone ?? "";
    case "location": return r.location ?? "";
    case "department": return r.department ?? "";
    case "email": return r.email ?? "";
    case "company": return r.company ?? "";
    case "birthday": return r.birthday ?? "";
    case "notes": return r.notes ?? "";
    case "roleId": return r.roleId == null ? "" : String(r.roleId);
    case "utilizationMode": return r.utilizationMode;
    case "utilization": return encodePeriodMap(r.utilization);
    case "absenceOverride": return encodePeriodMap(r.absenceOverride);
    case "active": return r.active === false ? "false" : "";
    case "localModifiedAt": return r.localModifiedAt ?? "";
    default: return "";
  }
}
```

Replace `RESOURCES_MD_COLUMNS` (lines ~448-458):

```ts
const RESOURCES_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "firstName", label: "First" },
  { col: "lastName", label: "Last" },
  { col: "title", label: "Title" },
  { col: "businessPhone", label: "Phone" },
  { col: "location", label: "Location" },
  { col: "department", label: "Department" },
  { col: "email", label: "Email" },
  { col: "company", label: "Company" },
  { col: "birthday", label: "Birthday" },
  { col: "notes", label: "Notes" },
  { col: "roleId", label: "RoleId" },
  { col: "utilizationMode", label: "Mode" },
  { col: "utilization", label: "Utilization" },
  { col: "absenceOverride", label: "AbsenceOverride" },
  { col: "active", label: "Active" },
  { col: "localModifiedAt", label: "LocalModified" },
];
```

Replace the label-mapping block inside `markdownToResources` (lines ~1437-1448) so every new label maps to its sanitizer key, keeping the legacy `name` fallback:

```ts
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "first" || norm === "firstname") mapped["firstName"] = val;
      else if (norm === "last" || norm === "lastname") mapped["lastName"] = val;
      else if (norm === "name") mapped["name"] = val; // legacy single-name files
      else if (norm === "title") mapped["title"] = val;
      else if (norm === "phone" || norm === "businessphone") mapped["businessPhone"] = val;
      else if (norm === "location") mapped["location"] = val;
      else if (norm === "department") mapped["department"] = val;
      else if (norm === "email") mapped["email"] = val;
      else if (norm === "company") mapped["company"] = val;
      else if (norm === "birthday") mapped["birthday"] = val;
      else if (norm === "notes") mapped["notes"] = val;
      else if (norm === "roleid") mapped["roleId"] = val;
      else if (norm === "mode" || norm === "utilizationmode") mapped["utilizationMode"] = val;
      else if (norm === "utilization") mapped["utilization"] = val;
      else if (norm === "absenceoverride") mapped["absenceOverride"] = val;
      else if (norm === "active") mapped["active"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
```

(CSV decoding needs no change: `csvToResources` maps header→value generically and `sanitizeResource` reads the new keys plus the legacy `name`.)

- [ ] **Step 8: Update UI `name` reads (no behavior change)**

In `src/app/resources-panel.tsx`, add `resourceDisplayName` to the `./resource-foundation` import (add the import if none exists), then replace each `resource.name` / `r.name` (lines 132, 137, 152, 399, 403, 408, 466) with `resourceDisplayName(resource)` / `resourceDisplayName(r)` respectively. E.g. line 132 → `{resourceDisplayName(resource)}`; the `aria-label` template literals become `` `Discipline for ${resourceDisplayName(resource)}` `` and `` `Grade for ${resourceDisplayName(resource)}` ``.

In `src/app/resources-report.tsx:75`, add the import and change `<Td>{r.name}</Td>` to `<Td>{resourceDisplayName(r)}</Td>`.

- [ ] **Step 9: Fix the two existing tests that read `r.name`**

`src/app/resource-foundation.test.ts:50,54` — import `resourceDisplayName`; replace `r.name === "Alex Example"` with `resourceDisplayName(r) === "Alex Example"` and `r.name === "Bob Lee"` with `resourceDisplayName(r) === "Bob Lee"`.

`src/app/storage-serialization.test.ts:23` — import `resourceDisplayName`; replace `r.name === "Alex Example"` with `resourceDisplayName(r) === "Alex Example"`.

- [ ] **Step 10: Typecheck + run the full suite**

Run: `npx tsc --noEmit`
Expected: clean (no output).

Run: `npx vitest run`
Expected: PASS — all suites green, including the new sanitize + serialization tests.

- [ ] **Step 11: Commit**

```bash
git add src/app/types.ts src/app/sanitize.ts src/app/sanitize.test.ts src/app/resource-foundation.ts src/app/resource-foundation.test.ts src/app/resource-capacity.ts src/app/resource-report.ts src/app/storage.ts src/app/storage-serialization.test.ts src/app/resources-panel.tsx src/app/resources-report.tsx
git commit -m "feat(resources): replace name with firstName/lastName + address-book fields"
```

---

### Task 3: Regenerate the sample workspace with the new columns

**Files:**
- Modify: `sample-workspace.csv` (RESOURCES section)
- Regenerate: `sample-workspace.md`
- Temp (delete after): `src/app/_regen-sample.test.ts`

- [ ] **Step 1: Update the RESOURCES section of `sample-workspace.csv`**

Replace the `# RESOURCES` header row and the 5 data rows with the new column order, filling address-book values (birthday `MM-DD`, notes free text). Header:

```
id,firstName,lastName,title,businessPhone,location,department,email,company,birthday,notes,roleId,utilizationMode,utilization,absenceOverride,active,localModifiedAt
```

Example first row (keep the existing utilization/role/active values from the current file; quote `notes` if it contains commas):

```
1,Sample,Dummy,Lead Architect,+49 30 5550101,Berlin,IAM,Sample.Dummy@example.com,Acme,06-14,"Primary SSO architect; OIDC lead.",1,percent,2026-04=80|2026-05=100|2026-06=60|2026-07=50,2026-06=88,,
```

Do the same for resources 2–5 (Sam Placeholder, Taylor Specimen, Morgan Standin, Jamie Testcase), preserving their existing `roleId`, `utilizationMode`, `utilization`, `absenceOverride`, and `active` values from the current file and adding plausible contact fields + birthdays.

- [ ] **Step 2: Create the throwaway regenerator**

Create `src/app/_regen-sample.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { csvToWorkspace, workspaceToMarkdown } from "./storage";

it("regenerates sample-workspace.md from sample-workspace.csv", () => {
  const root = resolve(__dirname, "..", "..");
  const csv = readFileSync(resolve(root, "sample-workspace.csv"), "utf8");
  const ws = csvToWorkspace(csv);
  writeFileSync(resolve(root, "sample-workspace.md"), workspaceToMarkdown(ws), "utf8");
  expect(ws.resources).toHaveLength(5);
  expect(ws.resources[0]).toMatchObject({ firstName: "Sample", lastName: "Dummy", birthday: "06-14" });
});
```

- [ ] **Step 3: Run it to regenerate + verify**

Run: `npx vitest run src/app/_regen-sample.test.ts`
Expected: PASS; `sample-workspace.md` rewritten with the new Resources columns (First/Last/Title/.../Birthday/Notes).

- [ ] **Step 4: Delete the throwaway and re-confirm the suite**

Run: `Remove-Item -Force src/app/_regen-sample.test.ts`
Run: `npx vitest run`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add sample-workspace.csv sample-workspace.md
git commit -m "docs(sample): add address-book fields to sample workspace resources"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Resource fields (firstName/lastName/title/businessPhone/location/department/email/company/birthday/notes) → Task 2 Step 3. ✓
- `resourceDisplayName` / `splitName` → Task 1. ✓
- `sanitizeResource` new fields + name fallback + birthday validation → Task 2 Steps 1,4. ✓
- CSV/MD columns + decoders + `name`-fallback → Task 2 Step 7. ✓ (CSV decode is generic; MD decode + legacy `name` mapping covered.)
- Swap `r.name` reads → Task 2 Steps 6,8,9. ✓ (All sites from the grep: resource-capacity:92, resource-report:128, storage:696, resources-panel ×7, resources-report:75, two tests. Discipline/Grade `name` at storage:727/1208 intentionally untouched — those are REF entities, not Resource.)
- Sample workspace regen → Task 3. ✓
- Migration of prior IDB records: handled by `sanitizeResource`'s `name` fallback on the load path (no store/schema change). ✓

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `splitName` returns `{ firstName, lastName }` (Task 1) consumed identically in `sanitizeResource` (Task 2 Step 4) and `backfillResources` (Task 2 Step 5). `resourceDisplayName(Pick<Resource,"firstName"|"lastName">)` used consistently in capacity/report/panels/tests. `sanitizeBirthday` exported and used in `sanitizeResource` + tested. RESOURCES column names align across `RESOURCES_CSV_COLUMNS`, `resourceFieldToString`, `RESOURCES_MD_COLUMNS`, and the `markdownToResources` label map.

**Out of scope (later phases):** four-tab UI, Directory/edit modal, Workload rekey, pop-out, birthday banner/toast/settings — Phases 2–5.
