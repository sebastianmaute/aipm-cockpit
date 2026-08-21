# Directory / Roles / Birthday UX Refinements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Six UX refinements — Tasks click-to-edit + correct tooltips, sortable/filterable Directory, a calendar birthday picker with optional year, and discipline/grade delete + drag-reorder in Manage Roles.

**Architecture:** Pure data-layer changes first (birthday format widening), then the UI that consumes them. Each task is independently testable and committable. No IndexedDB schema bump — birthday is a backward-compatible string-format widening; deleted disciplines/grades degrade roles to an `n/a` sentinel (id `0`) with zero rates.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + React Testing Library. Source in `src/app/`.

**Source spec:** [`../specs/2026-05-25-directory-roles-birthday-ux-design.md`](../specs/2026-05-25-directory-roles-birthday-ux-design.md).

**Conventions:** Windows; `npx vitest run <file>`, `npx tsc --noEmit`, `npx eslint <files>` all work. After EVERY task: `npx tsc --noEmit` clean + `npx eslint <changed files>` zero problems (no rule relaxations — a hook blocks `eslint.config.mjs` edits). The known `use-holiday-set.test.ts` `waitFor` flake is acceptable if it appears (re-run in isolation to confirm).

---

### Task 1: Birthday format widening (pure data layer)

Widen `Resource.birthday` to accept `"MM-DD"` (year unknown) OR `"YYYY-MM-DD"` (year known). `birthday` stays typed `string`.

**Files:** Modify `src/app/birthdays.ts`, `src/app/birthdays.test.ts`, `src/app/sanitize.ts`, `src/app/sanitize.test.ts`.

- [ ] **Step 1: Failing tests for the new helpers + widened reminder.** Add to `src/app/birthdays.test.ts`:
```ts
import { getUpcomingBirthdays, birthdayMonthDay, birthdayHasYear } from "./birthdays";
// ...
describe("birthdayMonthDay / birthdayHasYear", () => {
  it("extracts MM-DD from either format", () => {
    expect(birthdayMonthDay("03-14")).toBe("03-14");
    expect(birthdayMonthDay("1990-03-14")).toBe("03-14");
  });
  it("returns null for missing/invalid", () => {
    expect(birthdayMonthDay(undefined)).toBeNull();
    expect(birthdayMonthDay("nope")).toBeNull();
    expect(birthdayMonthDay("13-40")).toBeNull();
  });
  it("birthdayHasYear true only for the 10-char form", () => {
    expect(birthdayHasYear("1990-03-14")).toBe(true);
    expect(birthdayHasYear("03-14")).toBe(false);
    expect(birthdayHasYear(undefined)).toBe(false);
  });
});

it("triggers for a YYYY-MM-DD birthday the same as MM-DD", () => {
  const holidays = new Set<string>();
  const withYear = getUpcomingBirthdays(
    [{ id: 1, firstName: "Y", lastName: "Z", roleId: null, utilizationMode: "percent", utilization: {}, birthday: "1990-06-03" } as never],
    "2026-06-03", 0, holidays, [],
  );
  expect(withYear).toHaveLength(1);
});
```
(Keep existing `getUpcomingBirthdays` tests.) Run `npx vitest run src/app/birthdays.test.ts` → FAIL (no `birthdayMonthDay` export).

- [ ] **Step 2: Implement helpers + rewire `getUpcomingBirthdays`** in `src/app/birthdays.ts`. Add near the top (after imports):
```ts
/** Extract the "MM-DD" slice from "MM-DD" or "YYYY-MM-DD"; null if missing/invalid. */
export function birthdayMonthDay(b?: string): string | null {
  if (!b) return null;
  const m = b.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[1]}-${m[2]}`;
}

/** True when the birthday carries a year ("YYYY-MM-DD"). */
export function birthdayHasYear(b?: string): boolean {
  return !!b && /^\d{4}-\d{2}-\d{2}$/.test(b);
}
```
Then in `getUpcomingBirthdays`, replace the `const m = (r.birthday ?? "").match(/^(\d{2})-(\d{2})$/); if (!m) continue; const mm = Number(m[1]); const dd = Number(m[2]); if (mm < 1 ...) continue;` block with:
```ts
    const md = birthdayMonthDay(r.birthday);
    if (!md) continue;
    const mm = Number(md.slice(0, 2));
    const dd = Number(md.slice(3, 5));
```
(Leave the rest of the function unchanged.) Run tests → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 3: Widen `sanitizeResource` birthday — failing test.** First read `src/app/sanitize.ts` to find how `birthday` is currently sanitized (look for the `birthday` field / a MM-DD regex inside `sanitizeResource`). Add to `src/app/sanitize.test.ts` (inside the existing `sanitizeResource` describe block — match its existing call style):
```ts
it("keeps a MM-DD birthday", () => {
  expect(sanitizeResource({ id: 1, firstName: "A", lastName: "B", birthday: "06-03" })?.birthday).toBe("06-03");
});
it("keeps a YYYY-MM-DD birthday", () => {
  expect(sanitizeResource({ id: 1, firstName: "A", lastName: "B", birthday: "1990-06-03" })?.birthday).toBe("1990-06-03");
});
it("drops a malformed birthday", () => {
  expect(sanitizeResource({ id: 1, firstName: "A", lastName: "B", birthday: "nope" })?.birthday).toBeUndefined();
});
```
Run `npx vitest run src/app/sanitize.test.ts` → the YYYY-MM-DD case FAILS (current regex is MM-DD only).

- [ ] **Step 4: Implement the widened validation** in `src/app/sanitize.ts`. Locate the birthday validation in `sanitizeResource` (a `/^\d{2}-\d{2}$/`-style check). Do NOT import from `./birthdays` if it would create a cycle — validate inline with the widened regex:
```ts
// birthday: accept "MM-DD" or "YYYY-MM-DD"; else undefined
const birthday =
  typeof raw.birthday === "string" && /^(?:\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw.birthday)
    ? raw.birthday
    : undefined;
```
Wire `birthday` into the returned object exactly where the old value was. Run tests → PASS. `npx tsc --noEmit` clean; `npx eslint src/app/birthdays.ts src/app/sanitize.ts` zero problems.

- [ ] **Step 5: Verify storage round-trip.** Read `src/app/storage.ts` for any birthday-specific (`MM-DD`) assumption in resource serialization (CSV/MD/JSON). It should store/read the string verbatim. If a format-specific guard exists, widen it; otherwise no change. Run `npx vitest run src/app/storage-serialization.test.ts` → green.

- [ ] **Step 6: Commit.**
```bash
git add src/app/birthdays.ts src/app/birthdays.test.ts src/app/sanitize.ts src/app/sanitize.test.ts
git commit -m "feat(resources): accept MM-DD or YYYY-MM-DD birthdays"
```

---

### Task 2: Birthday picker UI (calendar + optional year)

**Files:** Modify `src/app/resource-edit-modal.tsx`, `src/app/resource-edit-modal.test.tsx` (create), `src/app/i18n.ts`, `src/app/i18n.de.ts`. Depends on Task 1.

- [ ] **Step 1: i18n.** In `i18n.ts` add `resourceBirthdayYearUnknown: "Exact year unknown"` and remove the now-unused `resourceBirthdayMonth` / `resourceBirthdayDay` keys (grep to confirm only `resource-edit-modal.tsx` used them). Mirror in `i18n.de.ts`: `resourceBirthdayYearUnknown: "Genaues Jahr unbekannt"`, removing the German `resourceBirthdayMonth`/`resourceBirthdayDay`.

- [ ] **Step 2: Replace the birthday selects** in `resource-edit-modal.tsx`. Remove `parseBirthday`, the `months`/`days` arrays, the `{ mm, dd } = parseBirthday(...)` line, and `handleBirthdayChange`. Add an anchor constant near the top: `const BIRTHDAY_ANCHOR_YEAR = "2000";`. Update the import to add `birthdayHasYear, birthdayMonthDay` from `./birthdays`. Add module-scope helpers above the component:
```tsx
// "" | "MM-DD" | "YYYY-MM-DD"  ->  a full "YYYY-MM-DD" for the <input type=date>
function birthdayToInput(b?: string): string {
  const md = birthdayMonthDay(b);
  if (!md) return "";
  return birthdayHasYear(b) ? (b as string) : `${BIRTHDAY_ANCHOR_YEAR}-${md}`;
}
// full "YYYY-MM-DD" from the input  ->  stored value honoring the year-unknown toggle
function inputToBirthday(input: string, yearUnknown: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  return yearUnknown ? input.slice(5) : input;
}
```
Add `yearUnknown` state and re-sync it in the existing `prevResource` block:
```tsx
const [yearUnknown, setYearUnknown] = useState(() => !birthdayHasYear(resource?.birthday));
// inside the existing `if (prevResource !== resource) { ... }` block, add:
setYearUnknown(!birthdayHasYear(resource?.birthday));
```
Replace the "Birthday — two selects" block with:
```tsx
{/* Birthday — native date picker with optional year */}
<div className="flex flex-col gap-1 text-sm sm:col-span-2">
  <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
    {t(lang, "resourceBirthday")}
  </span>
  <div className="flex flex-wrap items-center gap-3">
    <input
      type="date"
      value={birthdayToInput(draft.birthday)}
      onChange={(e) => update("birthday", inputToBirthday(e.target.value, yearUnknown))}
      aria-label={t(lang, "resourceBirthday")}
      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
    <label className="flex items-center gap-1.5 text-sm text-AIPM-dark-grey dark:text-AIPM-light-grey">
      <input
        type="checkbox"
        checked={yearUnknown}
        onChange={(e) => {
          setYearUnknown(e.target.checked);
          update("birthday", inputToBirthday(birthdayToInput(draft.birthday), e.target.checked));
        }}
      />
      {t(lang, "resourceBirthdayYearUnknown")}
    </label>
  </div>
</div>
```

- [ ] **Step 3: Component test.** Create `src/app/resource-edit-modal.test.tsx`:
```tsx
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceEditModal } from "./resource-edit-modal";

const base = { id: 1, firstName: "A", lastName: "B", roleId: null, utilizationMode: "percent" as const, utilization: {} };

it("saves a full date when year is known", () => {
  const onSave = vi.fn();
  render(<ResourceEditModal lang="en-US" resource={{ ...base }} isNew={false} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/exact year unknown/i)); // uncheck (defaults checked)
  fireEvent.change(screen.getByLabelText(/^birthday$/i), { target: { value: "1990-06-03" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "1990-06-03" }));
});

it("strips the year to MM-DD when year is unknown", () => {
  const onSave = vi.fn();
  render(<ResourceEditModal lang="en-US" resource={{ ...base }} isNew={false} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/^birthday$/i), { target: { value: "2000-06-03" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "06-03" }));
});
```
Run `npx vitest run src/app/resource-edit-modal.test.tsx` → PASS. `npx tsc --noEmit` clean; `npx eslint` on changed files zero problems.

- [ ] **Step 4: Commit.**
```bash
git add src/app/resource-edit-modal.tsx src/app/resource-edit-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): calendar birthday picker with optional year"
```

---

### Task 3: Manage Roles — delete + reorder disciplines/grades

**Files:** Modify `src/app/resource-foundation.ts`, `src/app/resource-foundation.test.ts`, `src/app/use-resource-planner.ts`, `src/app/use-resource-planner.test.tsx`, `src/app/roles-modal.tsx`, `src/app/roles-modal.test.tsx`, and the wiring site that renders `RolesModal` (find via grep — likely `resources-panel.tsx` props ⇐ `task-manager.tsx`/`app-modals.tsx`), `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: `roleLabel` renders the n/a sentinel — failing test.** In `resource-foundation.test.ts` add:
```ts
it("renders an unresolved/sentinel dimension as n/a", () => {
  const role = { id: 5, disciplineId: 0, gradeId: 2, internalRate: 0, externalRate: 0 };
  expect(roleLabel(role as never, [], [{ id: 2, name: "Senior" }])).toBe("n/a Senior");
});
```
Run → FAIL (currently `"? Senior"`).

- [ ] **Step 2: Implement.** In `resource-foundation.ts` change both `?? "?"` fallbacks in `roleLabel` to `?? "n/a"`. Run → PASS.

- [ ] **Step 3: Planner delete/reorder — failing tests.** Read `src/app/use-resource-planner.ts` to learn how `disciplines`/`grades`/`roles` and their setters are obtained from `useWorkspace()`. Add to `src/app/use-resource-planner.test.tsx` (mirror the file's existing harness):
```tsx
it("deleting a discipline degrades its roles to n/a (id 0) with zero rates", () => {
  // seed: discipline {id:1}, grade {id:1}, role {disciplineId:1, gradeId:1, internalRate:100, externalRate:200}
  // act: result.current.onDeleteDiscipline(1)
  // assert: disciplines has no id 1; role.disciplineId === 0; role.internalRate === 0; role.externalRate === 0; role.gradeId === 1
});
it("deleting a grade degrades its roles to n/a (id 0) with zero rates", () => { /* symmetric on gradeId */ });
it("reordering disciplines applies the given id order", () => {
  // seed three disciplines ids [1,2,3]; act onReorderDisciplines([3,1,2]); assert order is [3,1,2]
});
```
Fill these against the actual harness (seed via the wrapper, call in `act`, assert on exposed workspace state). Run → FAIL.

- [ ] **Step 4: Implement planner handlers** in `use-resource-planner.ts` (use the real setter names found in Step 3 — shown here as `setDisciplines`/`setGrades`/`setRoles`):
```ts
const onDeleteDiscipline = useCallback((id: number) => {
  setDisciplines((prev) => prev.filter((d) => d.id !== id));
  setRoles((prev) => prev.map((r) =>
    r.disciplineId === id ? { ...r, disciplineId: 0, internalRate: 0, externalRate: 0 } : r));
}, [setDisciplines, setRoles]);

const onDeleteGrade = useCallback((id: number) => {
  setGrades((prev) => prev.filter((g) => g.id !== id));
  setRoles((prev) => prev.map((r) =>
    r.gradeId === id ? { ...r, gradeId: 0, internalRate: 0, externalRate: 0 } : r));
}, [setGrades, setRoles]);

const onReorderDisciplines = useCallback((orderedIds: number[]) => {
  setDisciplines((prev) => orderedIds
    .map((id) => prev.find((d) => d.id === id))
    .filter((d): d is (typeof prev)[number] => !!d));
}, [setDisciplines]);

const onReorderGrades = useCallback((orderedIds: number[]) => {
  setGrades((prev) => orderedIds
    .map((id) => prev.find((g) => g.id === id))
    .filter((g): g is (typeof prev)[number] => !!g));
}, [setGrades]);
```
Add the four to the hook's return type + return object. Run → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Roles modal UI** (`roles-modal.tsx`):
  - Extend `Props`: `onDeleteDiscipline: (id: number) => void`, `onDeleteGrade: (id: number) => void`, `onReorderDisciplines: (ids: number[]) => void`, `onReorderGrades: (ids: number[]) => void`.
  - Change the rate-card resolved-name `?? "?"` fallbacks (lines ~76–77) to `?? "n/a"`.
  - Extend `RefList` props with `lang: Lang` (re-add), `onDelete: (id: number) => void`, `onReorder: (ids: number[]) => void`. Pass them from both call sites (disciplines → delete/reorder discipline handlers; grades → grade handlers).
  - In `RefList`, make each `<li>` `draggable` with HTML5 DnD mirroring the Gantt row-reorder pattern in `gantt.tsx` (`onDragStart` stash dragged id via a `useRef`, `onDragOver` `preventDefault`, `onDrop` build the new id order from `items` and call `onReorder(newIds)`). Add a grip span (`≡`) with `title={t(lang, "reorderHint")}`. Add a delete (×) button per item calling `onDelete(it.id)` after `window.confirm(t(lang, "rolesConfirmDeleteRef"))`.
  - i18n (`i18n.ts` + `i18n.de.ts`): add `reorderHint` (EN "Drag to reorder" / DE "Zum Umsortieren ziehen") and `rolesConfirmDeleteRef` (EN "Remove this entry? Roles using it become n/a with zero rates." / DE "Eintrag entfernen? Rollen, die ihn verwenden, werden n/a mit Sätzen 0.").

- [ ] **Step 6: Wire handlers through.** Grep where `RolesModal` is rendered and where `onAddDiscipline` etc. are threaded (e.g. `resources-panel.tsx` ⇐ `task-manager.tsx`). Pass the four new handlers from `useResourcePlanner` down to `RolesModal` alongside the existing role handlers.

- [ ] **Step 7: Verify + commit.** Update `roles-modal.test.tsx` renders to pass the four new props (`vi.fn()`); add a delete-click and a reorder assertion. `npx tsc --noEmit` clean; `npx eslint` on changed files zero problems; `npx vitest run src/app/use-resource-planner.test.tsx src/app/resource-foundation.test.ts src/app/roles-modal.test.tsx` green.
```bash
git add src/app/resource-foundation.ts src/app/resource-foundation.test.ts src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx src/app/roles-modal.tsx src/app/roles-modal.test.tsx src/app/resources-panel.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): delete + drag-reorder disciplines/grades (roles fall back to n/a)"
```

---

### Task 4: Directory — sortable + filterable

**Files:** Modify `src/app/resource-directory.tsx`, `src/app/resource-directory.test.tsx` (create), `src/app/i18n.ts`, `src/app/i18n.de.ts`. Depends on Task 1 (`birthdayMonthDay`).

- [ ] **Step 1: i18n.** Add `directorySearchPlaceholder` (EN "Filter by name, title, department, email…" / DE "Nach Name, Titel, Abteilung, E-Mail filtern…") and `sortBy` (EN "Sort by {0}" / DE "Sortieren nach {0}").

- [ ] **Step 2: Failing test.** Create `src/app/resource-directory.test.tsx`:
```tsx
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ResourceDirectory } from "./resource-directory";

const rs = [
  { id: 1, firstName: "Zoe", lastName: "Adams", title: "PM", roleId: null, utilizationMode: "percent" as const, utilization: {} },
  { id: 2, firstName: "Amy", lastName: "Bell", title: "Dev", roleId: null, utilizationMode: "percent" as const, utilization: {} },
];
const common = { lang: "en-US" as const, roles: [], disciplines: [], grades: [], onAssignRole: vi.fn(), onEditResource: vi.fn(), onAddResource: vi.fn() };

it("filters rows by the search box", () => {
  render(<ResourceDirectory {...common} resources={rs} />);
  fireEvent.change(screen.getByPlaceholderText(/filter by/i), { target: { value: "amy" } });
  expect(screen.queryByText("Zoe Adams")).toBeNull();
  expect(screen.getByText("Amy Bell")).toBeInTheDocument();
});

it("sorts by name when the Name header is clicked", () => {
  render(<ResourceDirectory {...common} resources={rs} />);
  fireEvent.click(screen.getByRole("button", { name: /sort by/i }));
  const rows = screen.getAllByRole("row").slice(1); // skip header
  expect(within(rows[0]).getByText("Amy Bell")).toBeInTheDocument();
});
```
Run → FAIL.

- [ ] **Step 3: Implement** in `ResourceDirectoryInner`:
  - State: `const [filter, setFilter] = useState("")`; `type SortKey = "name" | "discipline" | "grade" | "title" | "department" | "phone" | "email" | "birthday"`; `const [sortKey, setSortKey] = useState<SortKey>("name")`; `const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")`.
  - A `roleFor(r)` helper resolving discipline/grade names (via `roles`/`disciplines`/`grades`).
  - `const rows = useMemo(() => { ... }, [resources, roles, disciplines, grades, filter, sortKey, sortDir])`: case-insensitive substring filter across `resourceDisplayName(r)` + `title`/`department`/`businessPhone`/`email`/`company`; then sort by the active key (birthday via `birthdayMonthDay(r.birthday) ?? ""`; blanks last), honoring `sortDir`.
  - Render the search `<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t(lang, "directorySearchPlaceholder")} />` in the toolbar row beside the buttons.
  - Make each `<th>` a sort `<button>` toggling `sortKey`/`sortDir`, with `title={t(lang, "sortBy", <column label>)}` and a ▲/▼ on the active column.
  - Map over `rows` (not `resources`). Add per-cell `title` = the cell value. Import `birthdayMonthDay` from `./birthdays`.
- Run the test → PASS. `npx tsc --noEmit` clean; `npx eslint src/app/resource-directory.tsx` zero problems.

- [ ] **Step 4: Commit.**
```bash
git add src/app/resource-directory.tsx src/app/resource-directory.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): sortable + filterable Directory table"
```

---

### Task 5: Tasks — click-to-edit + tooltip fix

**Files:** Modify `src/app/task-row.tsx`, `src/app/tasks-section.tsx`, `src/app/notifications.tsx`, `src/app/jira-conflicts-modal.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, plus the existing test that renders a row (`src/app/task-row.test.tsx` or `src/app/tasks-section.test.tsx`).

- [ ] **Step 1: i18n.** Add `clickToEdit` (EN "click to edit" / DE "zum Bearbeiten klicken").

- [ ] **Step 2: Failing test for click-to-edit.** Read the test file that renders a `TaskRow`/`TasksSection` to reuse its render helper + `RowContextProvider` value; add:
```tsx
it("opens the editor when the task id is clicked", () => {
  const onEdit = vi.fn();
  // render a row (task #7) with onEdit in the row context
  fireEvent.click(screen.getByRole("button", { name: /#7|task #7/i }));
  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
});
it("opens the editor when the task name is clicked", () => {
  const onEdit = vi.fn();
  fireEvent.click(screen.getByRole("button", { name: /review the deck/i })); // the task name text
  expect(onEdit).toHaveBeenCalled();
});
```
Run → FAIL.

- [ ] **Step 3: Click-to-edit in `task-row.tsx`.** `onEdit` and `lang` are already in scope from `useTaskRowContext()`.
  - ID cell: replace the bare `#{task.id}` with
    ``<button type="button" onClick={() => onEdit(task)} title={`#${task.id} — ${t(lang, "clickToEdit")}`} className="cursor-pointer rounded font-mono text-zinc-500 hover:text-AIPM-dark-blue hover:underline">#{task.id}</button>``
    (keep the Jira link + `RaidBadge` siblings unchanged, outside the button).
  - Name cell: replace `<span>{task.taskName}</span>` with
    ``<button type="button" onClick={() => onEdit(task)} title={`${task.taskName} — ${t(lang, "clickToEdit")}`} className="cursor-pointer text-left font-medium hover:text-AIPM-dark-blue hover:underline">{task.taskName}</button>``
    (keep the group/label chips below it unchanged).

- [ ] **Step 4: Per-cell titles (`task-row.tsx`).** Give the `Td` helper an optional `title?: string` prop and forward it to the `<td>`. Add `title={`${t(lang, "<colKey>")}: ${value}`}` to the assignee, startDate, dueDate, and lastUpdateDate cells (colKeys: `assignee`, `startDate`, `dueDate`, `lastUpdateDate`). Leave the status dot (already titled).

- [ ] **Step 5: Remove the misplaced resize hint + add a corner grip.** In `tasks-section.tsx` remove `title={t(lang, "tableResizeHint")}` from the `<section>` (line ~201) and ensure that `<section>` className includes `relative`. Add, as the last child inside the `<section>`:
```tsx
<span aria-hidden title={t(lang, "tableResizeHint")}
  className="pointer-events-none absolute bottom-1 right-1 select-none text-zinc-300 dark:text-zinc-600">⠿</span>
```
In `notifications.tsx` (line ~163) and `jira-conflicts-modal.tsx` (line ~121): remove the inherited `title={t(lang, "tableResizeHint")}` from the wrapping container. If that container is user-resizable (has the `resize` class), add the same corner-grip span (ensure `relative`); if not, just remove the stray title.

- [ ] **Step 6: Verify + commit.** Run the click-to-edit test → PASS. `npx tsc --noEmit` clean; `npx eslint` on changed files zero problems; `npx vitest run` for touched test files green.
```bash
git add src/app/task-row.tsx src/app/tasks-section.tsx src/app/notifications.tsx src/app/jira-conflicts-modal.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/task-row.test.tsx src/app/tasks-section.test.tsx
git commit -m "feat(tasks): click id/name to edit; fix mis-scoped resize tooltip"
```

---

## Final verification (after all tasks)

- `npx tsc --noEmit` → clean.
- `npx eslint src` → 0 problems.
- `npx vitest run` → all green (known `use-holiday-set` flake excepted).
- Manual smoke (optional): Directory sort/filter; create a resource birthday with and without a year; delete a discipline in use → its roles show n/a with 0 rates; drag-reorder disciplines; click a task id/name → editor opens; hover a task cell → field hint (not the resize text).

## Self-Review

**Spec coverage:** Goal 1 (click-to-edit) → Task 5; Goal 2 (tooltip) → Task 5; Goal 3 (directory sort/filter) → Task 4; Goal 4 (birthday picker) → Tasks 1+2; Goal 5 (delete discipline/grade → n/a + 0 rates) → Task 3; Goal 6 (drag reorder) → Task 3. All covered.

**Placeholder scan:** Pure-logic steps carry full code; UI steps carry concrete snippets + exact file/line anchors and the pattern to mirror (Gantt DnD). Steps that require reading the live file first (sanitize birthday location, planner setter names, RolesModal wiring site, the row test harness) say so explicitly — that is reading, not a content gap.

**Type consistency:** `birthdayMonthDay`/`birthdayHasYear` (Task 1) reused verbatim in Tasks 2 + 4. The n/a sentinel is the literal id `0` and the display string `"n/a"` consistently (Task 3, `roleLabel` + roles-modal rows). New handler names (`onDeleteDiscipline`/`onDeleteGrade`/`onReorderDisciplines`/`onReorderGrades`) are identical across planner, RolesModal props, and wiring. New i18n keys (`resourceBirthdayYearUnknown`, `clickToEdit`, `sortBy`, `directorySearchPlaceholder`, `reorderHint`, `rolesConfirmDeleteRef`) are each added once in EN+DE; removed keys (`resourceBirthdayMonth`/`Day`) are noted.

**Out of scope:** No schema bump; no touch-drag polish; native date input localization left to the browser.
