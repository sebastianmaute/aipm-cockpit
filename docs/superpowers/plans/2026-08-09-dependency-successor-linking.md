# Dependency Search and Successor Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the task modal link a task to its successors as well as its predecessors, through a searchable picker, with the cross-task writes staged in the draft and applied on Save.

**Architecture:** The modal's single "Dependencies" field becomes two labelled groups (Predecessors / Successors), each an instance of one internal `DependencyLinkGroup` component built on the existing shared `EntityLinkPicker` + `useTaskPickerOptions`. Successor links are staged in the form draft and resolved on Save by a new pure engine, `successor-links.ts`, which writes a predecessor entry onto each target task and returns per-target before/after images for undo. The inline row popover, which has no draft to stage into, is deleted and its cell becomes read-only chips.

**Tech Stack:** Next.js 16 / React / TypeScript, vitest + React Testing Library, Playwright + axe for e2e, ESLint at `--max-warnings=0`.

**Spec:** `docs/superpowers/specs/2026-08-09-dependency-successor-linking-design.md`

---

## Orientation for someone new to this codebase

Read these before Task 1. They are short and each one prevents a specific failure mode you will otherwise hit.

**Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s exit code, so a failing suite reads as green. Always:

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

For a single test file, run it unpiped and read the output directly:

```bash
npx vitest run src/app/successor-links.test.ts --reporter=dot
```

`--reporter=basic` does not exist in this vitest version and errors at startup.

**`npm run lint` does not reproduce CI.** It is bare `eslint` with no `--max-warnings` flag, so it exits 0 with warnings present. The real gate is:

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

An unused import or variable is **fatal**. There is no `argsIgnorePattern`, so even an `_`-prefixed unused parameter fails.

**`npx tsc --noEmit` is a separate gate from the test run.** `next build` does not typecheck `*.test.tsx`, and vitest never typechecks at all, so a test-only type error passes both and fails CI. Run `tsc` after editing any test.

**`i18n.ts` and `i18n.de.ts` must have identical key sets** — tsc enforces this. Both files are **CRLF**. The Edit tool corrupts umlauts and curls double quotes in `i18n.de.ts`, so every DE edit in this plan is done with a node script that reads and writes UTF-8 and anchors on `\r\n`. Interpolated strings use 0-based positional placeholders: `t(lang, key, a)` fills `{0}`.

**`react-hooks/set-state-in-effect` is banned and fatal.** Nothing in this plan needs it. `react-hooks/exhaustive-deps` rejects an `obj.member` dependency — hoist it to a local `const` and depend on that.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/picker-filter.ts` | modify | Add `#`-prefixed id matching to the shared picker filter |
| `src/app/picker-filter.test.ts` | modify | Cover the `#` behaviour |
| `src/app/successor-links.ts` | **create** | Pure resolver: staged links → per-target before/after images + a skipped count |
| `src/app/successor-links.test.ts` | **create** | Its tests (coverage-gated file) |
| `src/app/i18n.ts` | modify | EN strings |
| `src/app/i18n.de.ts` | modify | DE strings |
| `src/app/task-form-context.tsx` | modify | `successorLinks` on the form draft |
| `src/app/dependencies-editor.tsx` | modify | Becomes `DependencyLinkGroup`: one direction-parameterised picker group |
| `src/app/dependencies-editor.test.tsx` | **create** | Group behaviour + the distinct-accessible-names test |
| `src/app/task-form-fields.tsx` | modify | Two `Field`s + the single shared help line |
| `src/app/use-task-submit.ts` | modify | Apply staged links on Save (both paths) + undo captures + skipped toast |
| `src/app/use-task-submit.test.ts` | modify | Save-path behaviour (an existing `renderHook` harness — extend it, do not add a file) |
| `src/app/task-row.tsx` | modify | Inline relations cell becomes read-only chips |
| `src/app/version.ts`, `CHANGELOG.md`, + 5 ungated sites | modify | Release |

---

## Task 1: `#`-prefixed id matching in the shared picker filter

`filterPickerOptions` (`src/app/picker-filter.ts`) already matches a query against an item's id or its text, with `*` as a wildcard. Today an id query must be bare digits (`42`). Users write `#42`. This adds that, **for the id comparison only** — the text matcher keeps seeing the raw query, so a `#` typed inside a task name still matches by name.

**Files:**
- Modify: `src/app/picker-filter.ts:27-40`
- Test: `src/app/picker-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/picker-filter.test.ts`. Note the **local** row set — the existing `ROWS` const is shared by the tests above and must not change.

```ts
describe("filterPickerOptions — # id queries", () => {
  const HASH_ROWS: readonly Row[] = [
    { id: 1, name: "Draft the API spec" },
    { id: 2, name: "Review the API docs" },
    { id: 4, name: "Fix #42 crash" },
  ];

  it("matches an id written with a leading #", () => {
    const out = filterPickerOptions(HASH_ROWS, { ...base, query: "#2" });
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it("does not treat a bare # as an empty query", () => {
    // The strip leaves "" for the id compare, which must match no id. The row
    // that comes back does so via the TEXT matcher, not the id one.
    const out = filterPickerOptions(HASH_ROWS, { ...base, query: "#" });
    expect(out.map((r) => r.id)).toEqual([4]);
  });

  it("falls through to the text matcher when the stripped id matches nothing", () => {
    const out = filterPickerOptions(HASH_ROWS, { ...base, query: "#42" });
    expect(out.map((r) => r.id)).toEqual([4]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/picker-filter.test.ts --reporter=dot
```

Expected: FAIL. `"#2"` returns `[]` (no id equals `"#2"`, and no name contains `"#2"`).

- [ ] **Step 3: Implement**

In `src/app/picker-filter.ts`, replace the body of `filterPickerOptions` from the `const q` line onward:

```ts
  const { query, excludeIds, getId, getText, extraFilter, limit = 20 } = opts;
  const q = query.trim().toLowerCase();
  // A leading `#` is stripped for the ID comparison ONLY — users write "#42".
  // The text matcher below still sees the raw query, so a `#` inside a name
  // keeps matching by name, and a bare "#" does not collapse into an
  // everything-matches empty query.
  const idQuery = q.startsWith("#") ? q.slice(1) : q;
  // Built once per call — a matcher per item would recompile the RegExp for
  // every row on every keystroke.
  const matches = wildcardMatcher(q);
  return items
    .filter((item) => !excludeIds.has(getId(item)))
    .filter((item) => (extraFilter ? extraFilter(item) : true))
    .filter((item) => {
      if (!q) return true;
      if (idQuery !== "" && String(getId(item)) === idQuery) return true;
      return matches(getText(item));
    })
    .slice(0, limit);
```

Also update the file's header comment: the line reading `` // drop already-selected ids, then match a query against the id OR a text field `` becomes `` // drop already-selected ids, then match a query against the id (bare or `#`-prefixed) OR a text field ``.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/picker-filter.test.ts --reporter=dot
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/app/picker-filter.ts src/app/picker-filter.test.ts
git commit -F - <<'EOF'
feat: accept #-prefixed ids in the shared picker filter

The chip pickers matched an id query only as bare digits. Users write "#42".
Stripped for the id comparison only, so the text matcher still sees the raw
query and a bare "#" does not become an everything-matches empty query.
EOF
```

---

## Task 2: `successor-links.ts` — the pure resolver

Dependencies are stored as **predecessors on the owning task**, so linking a successor `S` means writing an entry onto `S`. This engine turns the staged link list into per-target before/after dependency arrays, plus a count of links it had to drop.

Note on types: a staged successor link is `{ taskId, type }`, which is exactly `TaskDependency`. The engine reuses that type rather than declaring a structurally identical twin.

**Files:**
- Create: `src/app/successor-links.ts`
- Test: `src/app/successor-links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/successor-links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveSuccessorLinks } from "./successor-links";
import { wouldCreateDependencyCycle } from "./sanitize";
import type { Task, TaskDependency } from "./types";

function task(id: number, name: string, dependencies: TaskDependency[] = []): Task {
  return {
    id,
    taskName: name,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    group: "",
    labels: [],
    inquiriesSent: 0,
    createdDate: "2026-01-01",
    dependencies,
  } as Task;
}

describe("resolveSuccessorLinks", () => {
  it("writes the owning task onto each successor as a predecessor", () => {
    const tasks = [task(1, "Own"), task(2, "Target")];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(0);
    expect(edits.get(2)).toEqual({ before: [], after: [{ taskId: 1, type: "FS" }] });
    expect(edits.has(1)).toBe(false);
  });

  it("preserves the target's existing dependencies", () => {
    const tasks = [task(1, "Own"), task(2, "Target", [{ taskId: 3, type: "SS" }]), task(3, "Other")];
    const { edits } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(edits.get(2)?.before).toEqual([{ taskId: 3, type: "SS" }]);
    expect(edits.get(2)?.after).toEqual([
      { taskId: 3, type: "SS" },
      { taskId: 1, type: "FS" },
    ]);
  });

  // ★★★ THE test for this feature. A chain-free fixture returns false for BOTH
  // argument orders, so it cannot tell a correct guard from a reversed one.
  // This seeds the collision and asserts the two orders DISAGREE on it.
  it("runs the cycle guard reversed for successors", () => {
    // Own(1) already depends on Target(2). Making 2 a SUCCESSOR of 1 would
    // mean 2 depends on 1, closing 1 -> 2 -> 1.
    const tasks = [task(1, "Own", [{ taskId: 2, type: "FS" }]), task(2, "Target")];
    const byId = new Map(tasks.map((t) => [t.id, t]));

    // Control: the two argument orders must not agree on this fixture, or the
    // assertion below would hold for a guard called either way.
    expect(wouldCreateDependencyCycle(2, 1, byId)).toBe(true);
    expect(wouldCreateDependencyCycle(1, 2, byId)).toBe(false);

    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("skips a link to the owning task itself", () => {
    const tasks = [task(1, "Own")];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 1, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("skips a target deleted between staging and save, and still applies the rest", () => {
    const tasks = [task(1, "Own"), task(3, "Survivor")];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [
        { taskId: 99, type: "FS" },
        { taskId: 3, type: "FS" },
      ],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.get(3)?.after).toEqual([{ taskId: 1, type: "FS" }]);
  });

  it("skips a target already at the 20-link cap", () => {
    // 20 existing predecessors on the target; sanitizeDependencies caps at 20,
    // so the 21st cannot land and the link is reported as skipped.
    const fillers = Array.from({ length: 20 }, (_, i) => task(100 + i, `Filler ${i}`));
    const targetDeps: TaskDependency[] = fillers.map((f) => ({ taskId: f.id, type: "FS" }));
    const tasks = [task(1, "Own"), task(2, "Target", targetDeps), ...fillers];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("skips a duplicate link to a target that already has one", () => {
    const tasks = [task(1, "Own"), task(2, "Target", [{ taskId: 1, type: "FS" }])];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("returns an empty resolution for an empty link list", () => {
    const tasks = [task(1, "Own"), task(2, "Target")];
    const { edits, skipped } = resolveSuccessorLinks({ ownId: 1, links: [], tasks });
    expect(skipped).toBe(0);
    expect(edits.size).toBe(0);
  });

  // ★★★ The create-path contract. Resolving against the PRE-mint array makes
  // the new id a dangling reference that sanitizeDependencies strips, so every
  // staged link is silently dropped — green tests, no error, no links. Same
  // inputs, two arrays, opposite outcomes.
  it("needs a task list that already contains the newly minted task", () => {
    const existing = [task(2, "Target")];
    const minted = task(7, "Brand new");

    const withoutNew = resolveSuccessorLinks({
      ownId: 7,
      links: [{ taskId: 2, type: "FS" }],
      tasks: existing,
    });
    expect(withoutNew.edits.size).toBe(0);
    expect(withoutNew.skipped).toBe(1);

    const withNew = resolveSuccessorLinks({
      ownId: 7,
      links: [{ taskId: 2, type: "FS" }],
      tasks: [...existing, minted],
    });
    expect(withNew.edits.get(2)?.after).toEqual([{ taskId: 7, type: "FS" }]);
  });

  it("catches a task staged as BOTH predecessor and successor on create", () => {
    // Reachable from the UI: the picker skips its cycle guard while ownTaskId
    // is null. Resolving against a list that includes the new task AND its
    // staged predecessors is what lets the walk see the collision.
    const minted = task(7, "Brand new", [{ taskId: 2, type: "FS" }]);
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 7,
      links: [{ taskId: 2, type: "FS" }],
      tasks: [task(2, "Target"), minted],
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/successor-links.test.ts --reporter=dot
```

Expected: FAIL at import — `successor-links.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/app/successor-links.ts`:

```ts
// src/app/successor-links.ts — pure resolver for the task modal's staged
// successor links. Dependencies are stored as PREDECESSORS on the owning task,
// so linking a successor S is a write to S. This turns the staged list into
// per-target before/after dependency arrays (ready for both the setTasks map
// and the undo capture) plus a count of links that could not be applied.
//
// Composes the two existing guards — sanitizeDependencies (the sole owner of
// the 20-link cap and the dangling-ref check) and wouldCreateDependencyCycle —
// instead of reimplementing either. No React, no I/O, no i18n.
import { sanitizeDependencies, wouldCreateDependencyCycle } from "./sanitize";
import type { Task, TaskDependency } from "./types";

/** One target task's dependency array before and after the successor write. */
export interface SuccessorEdit {
  before: TaskDependency[];
  after: TaskDependency[];
}

export interface SuccessorResolution {
  /** Keyed by TARGET task id. Empty when nothing could be applied. */
  edits: Map<number, SuccessorEdit>;
  /** Links dropped: target gone, cycle, at the link cap, or already present. */
  skipped: number;
}

/**
 * Resolve staged successor links for task `ownId`.
 *
 * A staged link `{ taskId: S, type }` means "S should depend on ownId with this
 * type" — the stored form is a `TaskDependency` on S pointing back at ownId.
 *
 * `tasks` MUST already contain the owning task. On the create path that means
 * calling this AFTER the new id is minted and appended, for two reasons: the
 * new id would otherwise be a dangling reference that `sanitizeDependencies`
 * strips (silently applying nothing), and the cycle walk needs the new task's
 * own predecessors to be visible.
 *
 * Mutates nothing passed in.
 */
export function resolveSuccessorLinks(args: {
  ownId: number;
  links: readonly TaskDependency[];
  tasks: readonly Task[];
}): SuccessorResolution {
  const { ownId, links, tasks } = args;
  const edits = new Map<number, SuccessorEdit>();
  let skipped = 0;
  const taskById = new Map<number, Task>(tasks.map((t) => [t.id, t]));
  const knownIds = new Set(tasks.map((t) => t.id));

  for (const link of links) {
    const target = taskById.get(link.taskId);
    if (!target) {
      skipped += 1;
      continue;
    }
    // ★★★ REVERSED relative to the predecessor form. Adding successor S means S
    // gains a dependency on ownId, so the walk starts at ownId and looks for S
    // — i.e. ownTaskId = S, candidatePredecessorId = ownId. Writing this the
    // predecessor way round compiles, passes any chain-free fixture, and lets
    // the user close a cycle. A self-link (link.taskId === ownId) is caught
    // here too: the guard returns true when its two ids are equal.
    if (wouldCreateDependencyCycle(link.taskId, ownId, taskById)) {
      skipped += 1;
      continue;
    }
    const staged = edits.get(target.id);
    const before = staged?.before ?? target.dependencies ?? [];
    const current = staged?.after ?? target.dependencies ?? [];
    // The real sanitizer owns the 20-link cap, the dangling-ref check and
    // de-duplication. If the array did not grow, one of those refused the link.
    const after = sanitizeDependencies(
      [...current, { taskId: ownId, type: link.type }],
      knownIds,
      target.id,
    );
    if (after.length === current.length) {
      skipped += 1;
      continue;
    }
    edits.set(target.id, { before, after });
  }

  return { edits, skipped };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/successor-links.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: all tests PASS, tsc `EXIT=0`.

If the `task()` helper's `as Task` cast fails because `Task` has a required field the literal omits, add that field to the helper — do not widen the cast to `as unknown as Task`, which would hide a real shape mismatch.

- [ ] **Step 5: Commit**

```bash
git add src/app/successor-links.ts src/app/successor-links.test.ts
git commit -F - <<'EOF'
feat: add the pure successor-link resolver

Turns the modal's staged successor links into per-target before/after
dependency arrays plus a skipped count. Composes sanitizeDependencies (which
owns the 20-link cap) and wouldCreateDependencyCycle, run REVERSED: adding
successor S means S gains a dependency on this task, so the walk starts here
and looks for S. The test seeds that collision explicitly, because a fixture
with no existing chain passes whichever direction the guard runs.
EOF
```

---

## Task 3: i18n — add the new strings and reword `depHelp`

Only **additions** and one rewording here. Key removals happen in the tasks that delete the last use, so `tsc` stays green at every commit.

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN strings**

In `src/app/i18n.ts`, immediately after the `depDependencies: "Dependencies",` line (around `:1368`), insert:

```ts
  depPredecessors: "Predecessors",
  depSuccessors: "Successors",
  depSearchPredecessors: "Search predecessor tasks",
  depSearchSuccessors: "Search successor tasks",
  depSearchPlaceholder: "Type to find a task…",
  depTypePredecessor: "Predecessor dependency type",
  depTypeSuccessor: "Successor dependency type",
  depUnlinkPredecessor: "Remove predecessor",
  depUnlinkSuccessor: "Remove successor",
  depSuccessorsSkipped:
    "{0} successor link(s) were not applied — the task was removed, is at its dependency limit, already has this link, or would create a cycle.",
```

Then replace the existing `depHelp` value (around `:1378`). It currently opens "Link this task to a predecessor", which is false for the successor group:

```ts
  depHelp:
    "FS — the predecessor finishes before the successor starts (most common). SS — both can start together. FF — both can finish together. SF — the predecessor starts before the successor finishes (rare).",
```

Finally, next to `taskHintDependencies` (around `:34`), add:

```ts
  taskHintSuccessors: "Tasks that cannot start until this one is done.",
```

- [ ] **Step 2: Add the DE strings via a node script**

Do **not** use the Edit tool on `i18n.de.ts` — it corrupts umlauts and curls double quotes there. The file is CRLF, so every anchor below uses `\r\n`. Run:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const add = [
  "  depPredecessors: \"Vorgänger\",",
  "  depSuccessors: \"Nachfolger\",",
  "  depSearchPredecessors: \"Vorgängeraufgaben suchen\",",
  "  depSearchSuccessors: \"Nachfolgeraufgaben suchen\",",
  "  depSearchPlaceholder: \"Zum Suchen tippen…\",",
  "  depTypePredecessor: \"Abhängigkeitstyp des Vorgängers\",",
  "  depTypeSuccessor: \"Abhängigkeitstyp des Nachfolgers\",",
  "  depUnlinkPredecessor: \"Vorgänger entfernen\",",
  "  depUnlinkSuccessor: \"Nachfolger entfernen\",",
  "  depSuccessorsSkipped:",
  "    \"{0} Nachfolgerverknüpfung(en) wurden nicht angewendet – die Aufgabe wurde entfernt, hat ihr Abhängigkeitslimit erreicht, besitzt die Verknüpfung bereits oder würde einen Zyklus erzeugen.\",",
].join("\r\n");

const anchorDeps = "  depDependencies: \"Abhängigkeiten\",\r\n";
if (!s.includes(anchorDeps)) throw new Error("anchor depDependencies not found");
s = s.replace(anchorDeps, anchorDeps + add + "\r\n");

const oldHelp = "    \"Diese Aufgabe mit einer Vorgänger-Aufgabe verknüpfen. FS – Vorgänger endet vor Start dieser Aufgabe (am häufigsten). SS – beide können gleichzeitig starten. FF – beide können gleichzeitig enden. SF – Vorgänger startet vor Ende dieser Aufgabe (selten).\",";
if (!s.includes(oldHelp)) throw new Error("anchor depHelp not found");
s = s.replace(oldHelp, "    \"FS – der Vorgänger endet, bevor der Nachfolger startet (am häufigsten). SS – beide können gleichzeitig starten. FF – beide können gleichzeitig enden. SF – der Vorgänger startet, bevor der Nachfolger endet (selten).\",");

const anchorHint = s.match(/^  taskHintDependencies: .*\r\n/m);
if (!anchorHint) throw new Error("anchor taskHintDependencies not found");
s = s.replace(anchorHint[0], anchorHint[0] + "  taskHintSuccessors: \"Aufgaben, die erst starten können, wenn diese fertig ist.\",\r\n");

fs.writeFileSync(p, s, "utf8");
console.log("ok");
'
```

If any `throw` fires, the anchor text in this plan does not match the file — read the file and re-anchor rather than loosening the match. In particular, `depDependencies`' German value is asserted here as `"Abhängigkeiten"`; confirm it with `grep -n 'depDependencies:' src/app/i18n.de.ts` before editing if the script throws.

- [ ] **Step 3: Verify the bytes and the key parity**

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");
for (const k of ["depPredecessors","depSuccessors","depSearchPredecessors","depSearchSuccessors","depSearchPlaceholder","depTypePredecessor","depTypeSuccessor","depUnlinkPredecessor","depUnlinkSuccessor","depSuccessorsSkipped","taskHintSuccessors"]) {
  if (!s.includes(k+":")) throw new Error("missing "+k);
}
if (/fuer|druecken|ae\b|oe\b|ue\b/.test(s.split("\n").filter(l=>/dep(Predecessors|Successors|Search|Type|Unlink)|taskHintSuccessors/.test(l)).join("\n"))) throw new Error("ASCII umlaut substitution");
console.log("de ok; CRLF lines:", (s.match(/\r\n/g)||[]).length);'
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding --reporter=dot
```

Expected: `de ok`, tsc `EXIT=0` (key parity holds), the encoding suite PASSES.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: add predecessor/successor strings and make depHelp direction-neutral

depHelp opened with "Link this task to a predecessor", which is false once the
field is split into two direction groups. The four dependency-type
explanations that follow are already direction-neutral and stay.
EOF
```

---

## Task 4: `successorLinks` on the form draft

**Files:**
- Modify: `src/app/task-form-context.tsx:20-46`

- [ ] **Step 1: Add the field**

In `emptyForm()`, immediately after the `dependencies` line:

```ts
    dependencies: [] as TaskDependency[],
    // Successor links STAGED for this modal session, applied on Save by
    // resolveSuccessorLinks. Same `{taskId, type}` shape as a dependency, but
    // stored the other way round: the entry names the OTHER task, and the
    // write lands on that task, not this one.
    //
    // ★ Deliberately NOT hydrated from the live graph on open. Successors are
    // derived, not stored, so listing existing ones would mix them with stored
    // predecessors in the same chip list and give a remove button no staging
    // story. This list is additive-only within one modal session.
    successorLinks: [] as TaskDependency[],
```

`TaskFormDraft` is `ReturnType<typeof emptyForm>`, so it picks the field up automatically. `handleCancelEdit` and the post-save reset both already call `emptyForm()`, so discard-on-cancel needs no code.

- [ ] **Step 2: Add the field to the existing test fixture**

`src/app/use-task-submit.test.ts` builds a literal `TaskFormDraft` in `validForm()`. Adding a draft field makes that literal incomplete, which is a `tsc` error the test run will not show you. Add it beside `dependencies: [],`:

```ts
    dependencies: [],
    successorLinks: [],
```

Then grep for any other hand-built draft literal and do the same:

```bash
grep -rln "TaskFormDraft" src/app --include=*.test.ts --include=*.test.tsx
```

- [ ] **Step 3: Verify nothing else breaks**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx vitest run src/app/use-task-submit.test.ts --reporter=dot
```

Expected: both `EXIT=0`, tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-form-context.tsx src/app/use-task-submit.test.ts
git commit -F - <<'EOF'
feat: stage successor links on the task form draft

Additive-only within one modal session and never hydrated from the live graph
— successors are derived, so listing existing ones would put a remove button
on a chip with no staging story.
EOF
```

---

## Task 5: `DependencyLinkGroup` — one direction-parameterised picker group

Rewrite `dependencies-editor.tsx`. The exported component becomes `DependencyLinkGroup`, rendered **twice** by the caller (once per direction) rather than rendering both groups itself — that keeps each group inside its own labelled `Field`, and one component used twice is what keeps `dup:check` green.

**Files:**
- Modify: `src/app/dependencies-editor.tsx` (full rewrite)
- Test: `src/app/dependencies-editor.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/app/dependencies-editor.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DependencyLinkGroup } from "./dependencies-editor";
import type { Task, TaskDependency } from "./types";

function task(id: number, name: string, dependencies: TaskDependency[] = []): Task {
  return {
    id,
    taskName: name,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    group: "",
    labels: [],
    inquiriesSent: 0,
    createdDate: "2026-01-01",
    dependencies,
  } as Task;
}

const TASKS = [task(1, "Own task"), task(2, "Draft the API spec"), task(3, "Ship the release")];

describe("DependencyLinkGroup", () => {
  it("adds the picked task with the currently selected type", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DependencyLinkGroup
        lang="en-US"
        direction="predecessor"
        links={[]}
        allTasks={TASKS}
        ownTaskId={1}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Predecessor dependency type" }), "SS");
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
    await user.click(screen.getByRole("option", { name: /Draft the API spec/ }));
    expect(onChange).toHaveBeenCalledWith([{ taskId: 2, type: "SS" }]);
  });

  it("excludes the owning task and anything already linked from the options", async () => {
    const user = userEvent.setup();
    render(
      <DependencyLinkGroup
        lang="en-US"
        direction="predecessor"
        links={[{ taskId: 2, type: "FS" }]}
        allTasks={TASKS}
        ownTaskId={1}
        onChange={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "task");
    expect(screen.queryByRole("option", { name: /Own task/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("combobox", { name: "Search predecessor tasks" }));
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
    expect(screen.queryByRole("option", { name: /Draft the API spec/ })).not.toBeInTheDocument();
  });

  // ★★★ Same collision shape as the engine test. Own(1) depends on 2, so
  // offering 2 as a SUCCESSOR would close 1 -> 2 -> 1. A guard written the
  // predecessor way round still offers it.
  it("filters successor options with the cycle guard run reversed", async () => {
    const user = userEvent.setup();
    const tasks = [task(1, "Own task", [{ taskId: 2, type: "FS" }]), task(2, "Draft the API spec")];
    const { rerender } = render(
      <DependencyLinkGroup
        lang="en-US"
        direction="predecessor"
        links={[]}
        allTasks={tasks}
        ownTaskId={1}
        onChange={vi.fn()}
      />,
    );
    // CONTROL: as a predecessor candidate the same task IS offered, so the
    // assertion below cannot pass for the trivial reason that nothing matches.
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
    expect(screen.getByRole("option", { name: /Draft the API spec/ })).toBeInTheDocument();

    rerender(
      <DependencyLinkGroup
        lang="en-US"
        direction="successor"
        links={[]}
        allTasks={tasks}
        ownTaskId={1}
        onChange={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "Search successor tasks" }), "api");
    expect(screen.queryByRole("option", { name: /Draft the API spec/ })).not.toBeInTheDocument();
  });

  it("names each remove button for its direction and its link", () => {
    render(
      <DependencyLinkGroup
        lang="en-US"
        direction="successor"
        links={[{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]}
        allTasks={TASKS}
        ownTaskId={1}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Remove successor FS #2 Draft the API spec" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove successor SS #3 Ship the release" }),
    ).toBeInTheDocument();
  });

  it("removes only the clicked link", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DependencyLinkGroup
        lang="en-US"
        direction="predecessor"
        links={[{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]}
        allTasks={TASKS}
        ownTaskId={1}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Remove predecessor FS #2/ }));
    expect(onChange).toHaveBeenCalledWith([{ taskId: 3, type: "SS" }]);
  });

  it("offers every task on the create path, where no cycle is possible", async () => {
    const user = userEvent.setup();
    render(
      <DependencyLinkGroup
        lang="en-US"
        direction="successor"
        links={[]}
        allTasks={TASKS}
        ownTaskId={null}
        onChange={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "Search successor tasks" }), "task");
    expect(screen.getByRole("option", { name: /Own task/ })).toBeInTheDocument();
  });

  // ★★ axe CANNOT detect duplicate accessible names, at any seed size, in any
  // view — and the task modal is not reached by the view scan at all. This is
  // the only detector for the six fixed controls the two groups contribute.
  it("gives the two groups' controls six distinct accessible names", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <DependencyLinkGroup
          lang="en-US"
          direction="predecessor"
          links={[]}
          allTasks={TASKS}
          ownTaskId={1}
          onChange={vi.fn()}
        />
        <DependencyLinkGroup
          lang="en-US"
          direction="successor"
          links={[]}
          allTasks={TASKS}
          ownTaskId={1}
          onChange={vi.fn()}
        />
      </div>,
    );
    // The clear ✕ renders only once its field has a value, so both fields have
    // to be typed into before all six controls exist.
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "a");
    await user.type(screen.getByRole("combobox", { name: "Search successor tasks" }), "a");

    const names = [
      ...within(container).getAllByRole("combobox"), // 2 search inputs + 2 type selects
      ...within(container).getAllByRole("button", { name: /^Clear/ }), // 2 clears
    ].map((el) => el.getAttribute("aria-label") ?? el.textContent);

    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });
});
```

If the clear button turns out not to carry an `aria-label` (it may take its name from `title` or from content), read `ClearableSearchInput` and match however it actually names itself — but keep the assertion at **six distinct names**. Do not lower the count to make it pass; the count is the point.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/dependencies-editor.test.tsx --reporter=dot
```

Expected: FAIL at import — `DependencyLinkGroup` is not exported.

- [ ] **Step 3: Rewrite `dependencies-editor.tsx`**

Replace the **entire** file with:

```tsx
"use client";

// One direction's worth of a task's relation links, rendered by the task modal
// TWICE — once for predecessors, once for successors. Chips + a searchable
// dropdown come from the shared EntityLinkPicker (the same primitive the
// knowledge/change/raid linked-task fields use), and the option filtering from
// the shared useTaskPickerOptions, so link-to-tasks behaviour cannot drift.
//
// Direction is STRUCTURAL — the caller wraps each instance in its own labelled
// Field — so it needs no toggle, no arrow glyph and no colour. That is also
// what makes it announce correctly: EntityLinkPicker takes ONE removeLabel for
// all chips, so the direction word has to come from the instance, not the chip.
//
// The caller owns both link lists (they live on the form draft) and applies the
// successor ones on Save. Nothing here writes to another task.

import { useCallback, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Select } from "./form-controls";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import { useTaskPickerOptions } from "./use-task-picker-options";
import { wouldCreateDependencyCycle } from "./sanitize";
import {
  DEPENDENCY_TYPES,
  type DependencyType,
  type Task,
  type TaskDependency,
} from "./types";

export type LinkDirection = "predecessor" | "successor";

/** Per-direction translation keys. Exhaustive by construction, so a new
 *  direction is a type error rather than a silently reused label. */
const DIRECTION_KEYS = {
  predecessor: {
    search: "depSearchPredecessors",
    type: "depTypePredecessor",
    remove: "depUnlinkPredecessor",
  },
  successor: {
    search: "depSearchSuccessors",
    type: "depTypeSuccessor",
    remove: "depUnlinkSuccessor",
  },
} as const;

export function DependencyLinkGroup({
  lang,
  direction,
  links,
  allTasks,
  ownTaskId,
  onChange,
}: {
  lang: Lang;
  direction: LinkDirection;
  /** This direction's links. For successors the entry names the OTHER task and
   *  the write lands there on Save — the shape is identical either way. */
  links: readonly TaskDependency[];
  /** Snapshot of all tasks; populates the dropdown and validates cycles. */
  allTasks: readonly Task[];
  /** Id of the task being edited; null when creating (no graph yet). */
  ownTaskId: number | null;
  onChange: (next: TaskDependency[]) => void;
}) {
  const [pendingType, setPendingType] = useState<DependencyType>("FS");
  const [query, setQuery] = useState("");
  const keys = DIRECTION_KEYS[direction];

  const taskById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const tk of allTasks) m.set(tk.id, tk);
    return m;
  }, [allTasks]);

  const selectedIds = useMemo(() => links.map((l) => l.taskId), [links]);

  // ★★★ The successor arm runs the guard REVERSED. Adding successor S means S
  // gains a dependency on this task, so the walk starts here and looks for S:
  // wouldCreateDependencyCycle(S, ownTaskId, …), NOT the predecessor form.
  // Written the predecessor way round it compiles, passes any chain-free
  // fixture, and lets the user close a cycle.
  //
  // ★ The self case needs no branch: the guard returns true when its two ids
  // are equal, so the owning task filters itself out of both directions. On the
  // create path ownTaskId is null and nothing can depend on a task that does
  // not exist yet, so the guard is skipped entirely.
  //
  // ★ useCallback, not an inline arrow: useTaskPickerOptions memoises on this
  // identity, and a fresh one each render would re-filter on every keystroke-
  // free re-render.
  const extraFilter = useCallback(
    (task: Task) => {
      if (ownTaskId === null) return true;
      return direction === "successor"
        ? !wouldCreateDependencyCycle(task.id, ownTaskId, taskById)
        : !wouldCreateDependencyCycle(ownTaskId, task.id, taskById);
    },
    [direction, ownTaskId, taskById],
  );

  const available = useTaskPickerOptions(allTasks, selectedIds, query, extraFilter);

  const selected = useMemo<LinkPickerEntry[]>(
    () =>
      links.map((link) => ({
        id: link.taskId,
        // The type rides `code`, which EntityLinkPicker renders monospace and
        // appends to each remove button's name — so two links to different
        // tasks get row-unique names (WCAG 2.4.6).
        code: `${link.type} #${link.taskId}`,
        label: taskById.get(link.taskId)?.taskName ?? t(lang, "depMissing"),
      })),
    [links, taskById, lang],
  );

  const options = useMemo<LinkPickerEntry[]>(
    () => available.map((tk) => ({ id: tk.id, code: `#${tk.id}`, label: tk.taskName })),
    [available],
  );

  const searchLabel = t(lang, keys.search);

  return (
    <div className="space-y-2">
      <EntityLinkPicker
        selected={selected}
        options={options}
        query={query}
        onQueryChange={setQuery}
        onAdd={(id) => {
          onChange([...links, { taskId: id, type: pendingType }]);
          setQuery("");
        }}
        onRemove={(id) => onChange(links.filter((l) => l.taskId !== id))}
        searchLabel={searchLabel}
        // The group's own label is already direction-unique, so the clear
        // inherits that uniqueness instead of announcing a bare "Clear" twice
        // on one modal (TaskLinkPicker precedent).
        clearLabel={`${t(lang, "clear")} – ${searchLabel}`}
        placeholder={t(lang, "depSearchPlaceholder")}
        removeLabel={t(lang, keys.remove)}
      />
      <Select
        size="xs"
        value={pendingType}
        onChange={(e) => setPendingType(e.target.value as DependencyType)}
        aria-label={t(lang, keys.type)}
        className="font-mono"
      >
        {DEPENDENCY_TYPES.map((dt) => (
          <option key={dt} value={dt}>
            {dt} — {t(lang, depTypeShortKey(dt))}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Translation key for a one-word friendly name of each dependency type. */
function depTypeShortKey(
  type: DependencyType,
): "depTypeFsShort" | "depTypeSsShort" | "depTypeFfShort" | "depTypeSfShort" {
  switch (type) {
    case "FS":
      return "depTypeFsShort";
    case "SS":
      return "depTypeSsShort";
    case "FF":
      return "depTypeFfShort";
    case "SF":
      return "depTypeSfShort";
  }
}
```

Note what is gone deliberately: `depTypeHelpKey` and the per-chip `title` it fed (`LinkPickerEntry` has no title slot, and the type `<Select>`'s own option labels plus the shared help line carry that explanation now), the `IconButton`/`XMarkIcon`/`Button` imports (EntityLinkPicker owns the chip and its remove), the `depHelp` paragraph (the caller renders it once for both groups), and the whole add-row.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/dependencies-editor.test.tsx --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: tests PASS. `tsc` will FAIL on `task-form-fields.tsx` and `task-row.tsx`, which still import `DependenciesEditor` — that is the next two tasks. Do not commit yet.

- [ ] **Step 5: Hold the commit**

This task leaves the tree non-compiling by design. Commit it together with Task 6, which restores it.

---

## Task 6: two `Field`s in the task modal

**Files:**
- Modify: `src/app/task-form-fields.tsx:9` (import), `:461-475` (the dependencies block)

- [ ] **Step 1: Swap the import**

```ts
import { DependencyLinkGroup } from "./dependencies-editor";
```

- [ ] **Step 2: Replace the dependencies block**

Replace the whole `{isVisible("dependencies") && ( … )}` block — the `Field` labelled `depDependencies` and its `DependenciesEditor` — with:

```tsx
        {isVisible("dependencies") && (
        <>
        {/* `group` on BOTH: once a group holds a chip, that chip's remove ✕ is
            the first labelable element inside the Field, so a plain <label>
            caption would adopt it and clicking the caption would fire a
            removal. Same trap the single field already carried. */}
        <Field label={t(lang, "depPredecessors")} hint={t(lang, "taskHintDependencies")} className="sm:col-span-2" group>
          <DependencyLinkGroup
            lang={lang}
            direction="predecessor"
            links={form.dependencies}
            allTasks={tasksForDeps}
            ownTaskId={editingId}
            onChange={(dependencies) => setForm((prev) => ({ ...prev, dependencies }))}
          />
        </Field>
        <Field label={t(lang, "depSuccessors")} hint={t(lang, "taskHintSuccessors")} className="sm:col-span-2" group>
          <DependencyLinkGroup
            lang={lang}
            direction="successor"
            links={form.successorLinks}
            allTasks={tasksForDeps}
            ownTaskId={editingId}
            onChange={(successorLinks) => setForm((prev) => ({ ...prev, successorLinks }))}
          />
        </Field>
        {/* Rendered ONCE for both groups — it lived inside the editor, which is
            now instantiated twice, and printing the type legend twice on one
            modal is noise. */}
        <p className="sm:col-span-2 text-xs text-muted-foreground">{t(lang, "depHelp")}</p>
        </>
        )}
```

Both groups stay under the one `isVisible("dependencies")` flag on purpose — adding a second field-visibility key would ripple into the modal-field-visibility settings for no user-visible gain.

- [ ] **Step 3: Remove the now-dead EN/DE key `depDependencies`**

`task-form-fields.tsx:464` was its only use outside the two dictionaries. Delete the `depDependencies:` line from `src/app/i18n.ts`, then from `src/app/i18n.de.ts` via node (do not use Edit on the DE file):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const before = s.length;
s = s.replace(/^  depDependencies: .*\r\n/m, "");
if (s.length === before) throw new Error("depDependencies line not found");
fs.writeFileSync(p, s, "utf8");
console.log("removed");
'
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx vitest run src/app/dependencies-editor.test.tsx src/app/task-form-fields --reporter=dot
```

Expected: `tsc` still FAILS, but now **only** on `task-row.tsx`'s `DependenciesEditor` import (Task 7 fixes it). Everything else `EXIT=0`. If `tsc` reports an error anywhere other than `task-row.tsx`, fix it before moving on.

`task-form-fields.test.tsx` may assert on the old single "Dependencies" field label. Update those assertions to the two new labels — do not delete the tests.

- [ ] **Step 5: Hold the commit**

Commit together with Task 7.

---

## Task 7: inline relations cell becomes read-only

The row popover writes through live via `onInlinePatch` and has no draft, so it cannot stage successor links. It is removed rather than given a second commit model.

**Files:**
- Modify: `src/app/task-row.tsx:25` (import), `:606` (call site), `:759-821` (the cell)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (drop `depEditRelations`)

- [ ] **Step 1: Replace the cell**

Replace lines `759-821` (from `interface DepRelationsCellProps` through `const DepRelationsCell = memo(DepRelationsCellImpl);`) with:

```tsx
/** Dependency (relations) cell: read-only chips. Editing lives in the task
 *  modal, which is the only surface with a draft to stage successor links in —
 *  this popover wrote through live and had none. */
function DepRelationsCellImpl({ task }: { task: Task }) {
  return <DependencyChips deps={task.dependencies ?? []} />;
}

const DepRelationsCell = memo(DepRelationsCellImpl);
```

- [ ] **Step 2: Update the call site**

`task-row.tsx:606` becomes:

```tsx
          <DepRelationsCell task={task} />
```

`inlineEditable` is used by other cells in the same render — do not delete it. The lint run in Step 4 will say if it became unused.

- [ ] **Step 3: Remove `depEditRelations`**

Its only three uses were the deleted popover. Delete the `depEditRelations:` line from `src/app/i18n.ts`, then from the DE file:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const before = s.length;
s = s.replace(/^  depEditRelations: .*\r\n/m, "");
if (s.length === before) throw new Error("depEditRelations line not found");
fs.writeFileSync(p, s, "utf8");
console.log("removed");
'
```

- [ ] **Step 4: Sweep the strandings**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `tsc` `EXIT=0` for the first time since Task 5. ESLint will now name every import and const the deletion stranded — likely the `DependenciesEditor` import (`:25`), the `EMPTY_TASKS` module const (`:92`), and possibly `PopoverPanel`, `PencilIcon`, or `IconButton` if `task-row.tsx` has no other use for them. Delete exactly what it names, then re-run until `EXIT=0`.

★ `useTaskLookup` at `:733` (inside `DependencyChipsImpl`) must **stay**. It is what the `RowLookupContext` split exists for.

★ Leave `task-inline-patch.ts` alone. Its `dependencies` branch loses its only caller, but the file is allowlist-style — an unhandled key is dropped, not written unsanitized — so the dead branch fails safe, and removing it would force `ownTaskId` and `knownTaskIds` out of `InlinePatchContext` and its caller for no behavioural gain.

- [ ] **Step 5: Run the affected suites**

```bash
npx vitest run src/app/task-row src/app/tasks-section src/app/dependencies-editor --reporter=dot
```

Expected: PASS. Any test asserting the row's "Edit relations" button must be deleted — the affordance is gone by design; do not re-add the button to keep a test green.

- [ ] **Step 6: Commit Tasks 5, 6 and 7 together**

```bash
git add src/app/dependencies-editor.tsx src/app/dependencies-editor.test.tsx \
        src/app/task-form-fields.tsx src/app/task-row.tsx \
        src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: split the modal's dependency field into predecessor and successor groups

One DependencyLinkGroup rendered twice, built on the shared EntityLinkPicker
and useTaskPickerOptions rather than a third hand-rolled listbox. Direction is
structural, so it needs no toggle, no glyph and no colour — and because
EntityLinkPicker takes one removeLabel for all chips, the instance is the only
place the direction word can come from.

The successor arm runs the cycle guard reversed: adding successor S means S
gains a dependency on this task.

The inline row popover is removed and its cell is now read-only chips. It
wrote through live and had no draft, so it could not stage a successor link,
and giving one component two commit models was the wrong trade.
EOF
```

---

## Task 8: apply staged successor links on Save

**Files:**
- Modify: `src/app/use-task-submit.ts:187-273`
- Test: `src/app/use-task-submit.test.ts` (extend — it already has a `renderHook` harness with `makeArgs` / `validForm` / `makeTask` / `fakeSubmitEvent`)

- [ ] **Step 1: Write the failing tests**

Append to `src/app/use-task-submit.test.ts`. These reuse the file's existing helpers — do not redefine them.

★ `setTasks` is a `vi.fn()`, so a functional updater is captured but never run. The update-path tests invoke it by hand; the create path passes a plain array and is asserted directly.

```ts
describe("useTaskSubmit — staged successor links", () => {
  it("applies a staged successor link to the target task on save", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 1, taskName: "Own" }), makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const updater = setTasks.mock.calls[0][0] as (prev: readonly Task[]) => readonly Task[];
    const next = updater(tasks);
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    // The edited task itself is still written in the same pass.
    expect(next.find((t) => t.id === 1)?.taskName).toBe("Valid Task");
  });

  it("captures one dependencies-only undo entry per successor target", () => {
    const captureFieldEdit = vi.fn();
    const tasks = [makeTask({ id: 1, taskName: "Own" }), makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          captureFieldEdit,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const call = captureFieldEdit.mock.calls
      .map(([o]) => o as { id: number; before: object; after: object; name?: string })
      .find((o) => o.id === 2);
    expect(call).toBeDefined();
    // ★ Nothing but `dependencies`. A whole-row capture would list every field
    // here and would revert values this save never touched (open-followups §50).
    expect(Object.keys(call!.before)).toEqual(["dependencies"]);
    expect(Object.keys(call!.after)).toEqual(["dependencies"]);
    expect(call!.after).toEqual({ dependencies: [{ taskId: 1, type: "FS" }] });
    expect(call!.name).toBe("Target");
  });

  // ★★★ Asserts the target points at the MINTED id, not merely that some link
  // exists. Resolving before the mint yields no link at all; resolving against
  // the wrong id would yield a link to the wrong task.
  it("applies staged successor links against the newly minted id on create", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: null,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const next = setTasks.mock.calls[0][0] as readonly Task[];
    const created = next.find((t) => t.taskName === "Valid Task");
    expect(created).toBeDefined();
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([
      { taskId: created!.id, type: "FS" },
    ]);
  });

  it("reports links it could not apply", () => {
    const showToast = vi.fn();
    const tasks = [makeTask({ id: 1 })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          showToast,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 99, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // Matched on content, not on call index — the `fieldsAdjusted` toast can
    // also fire on this path and a positional assertion would be fragile.
    const skippedToast = showToast.mock.calls.find(
      ([kind, text]) => kind === "info" && String(text).includes("not applied"),
    );
    expect(skippedToast).toBeDefined();
  });

  it("discards staged successor links on cancel", () => {
    const setTasks = vi.fn();
    const setForm = vi.fn();
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          setForm,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleCancelEdit());

    expect(setTasks).not.toHaveBeenCalled();
    const reset = setForm.mock.calls.at(-1)?.[0] as { successorLinks: unknown[] };
    expect(reset.successorLinks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/use-task-submit.test.ts --reporter=dot
```

Expected: FAIL on all five — nothing applies the links yet. The `discards on cancel` one may pass already (`handleCancelEdit` resets via `emptyForm()`); that is fine, it is a regression guard.

- [ ] **Step 3: Add the import and the shared capture helper**

In `src/app/use-task-submit.ts`, add:

```ts
import { resolveSuccessorLinks } from "./successor-links";
```

`Task` must also be available as a type in this file — check the existing import list and add it if missing.

Then inside `handleSubmit`, **above** the `if (editingId !== null)` branch (both branches call it, so it has to be defined first or the `const` is in its temporal dead zone):

```ts
      // ★ Called AFTER each branch's own-task captures, so the target entries
      // land on top of the stack: a bare undo() peels the successor links first
      // (the most recently-intended act), and undoThrough from the own-task's
      // oldest entry unwinds the whole save as one commit.
      //
      // ★★ captureFieldEdit MERGES before/after onto the live row by id rather
      // than replacing it, so these entries cannot revert a field this save
      // never touched. A whole-row capture() would give one tidier entry and
      // inherit open-followups §50, where undo restores a stale row.
      const captureSuccessorEdits = (
        resolution: ReturnType<typeof resolveSuccessorLinks>,
        nameSource: readonly Task[],
      ) => {
        for (const [targetId, edit] of resolution.edits) {
          captureFieldEdit?.({
            setter: setTasks,
            kind: "task.updated",
            id: targetId,
            before: { dependencies: edit.before },
            after: { dependencies: edit.after },
            stampField: "localModifiedAt",
            name: nameSource.find((r) => r.id === targetId)?.taskName,
          });
        }
      };
```

- [ ] **Step 4: Wire the update path**

In the `editingId !== null` branch, replace from `const stamp = …` through the end of the `if (prevTask) { … } else { … }` block:

```ts
        const stamp = new Date().toISOString();
        const updatedId = editingId;
        const prevTask = tasksRef.current.find((r) => r.id === editingId);
        const successors = resolveSuccessorLinks({
          ownId: editingId,
          links: form.successorLinks,
          tasks: tasksRef.current,
        });
        if (successors.skipped > 0) {
          showToast("info", t(lang, "depSuccessorsSkipped", successors.skipped));
        }
        // ONE functional setter for the edited task AND every successor target:
        // they all live in the same array, so a second setTasks would be a
        // second pass over it for no benefit.
        setTasks((prev) =>
          prev.map((row) => {
            if (row.id === editingId) {
              return applyStatusChange(
                { ...row, ...payload, localModifiedAt: stamp },
                form.status,
                today,
              );
            }
            const edit = successors.edits.get(row.id);
            return edit
              ? { ...row, dependencies: edit.after, localModifiedAt: stamp }
              : row;
          }),
        );
        setEditingId(null);
        if (prevTask) {
          // Single-item edit, so tasksRef's row equals the mapped row — recompute
          // the same next value to diff prev→next for the undo capture + audit detail.
          const nextTask = applyStatusChange(
            { ...prevTask, ...payload, localModifiedAt: stamp },
            form.status,
            today,
          );
          captureFieldChanges(captureFieldEdit, {
            setter: setTasks,
            kind: "task.updated",
            id: updatedId,
            prev: prevTask,
            next: nextTask,
            groups: TASK_UNDO_GROUPS,
            stampField: "localModifiedAt",
            name: taskName,
          });
          if (logActivityChanges) {
            logActivityChanges("task.updated", diffFields(prevTask, nextTask), updatedId, taskName);
          } else {
            logActivity("task.updated", updatedId, taskName);
          }
        } else {
          logActivity("task.updated", updatedId, taskName);
        }
        captureSuccessorEdits(successors, tasksRef.current);
```

- [ ] **Step 5: Wire the create path**

In the `else` branch, replace from `const nextList = …` through `setTasks(nextList);`:

```ts
        const stamp = new Date().toISOString();
        const withNew = [...tasksRef.current, newTask];
        // ★★★ Resolve AFTER the mint, against a list that CONTAINS the new
        // task. Resolving against tasksRef.current makes newId a dangling
        // reference that sanitizeDependencies strips, so every staged link is
        // silently dropped — green tests, no error, no links. It also lets the
        // cycle walk see the new task's own predecessors, which is how a task
        // staged as both predecessor and successor gets caught here.
        const successors = resolveSuccessorLinks({
          ownId: newId,
          links: form.successorLinks,
          tasks: withNew,
        });
        if (successors.skipped > 0) {
          showToast("info", t(lang, "depSuccessorsSkipped", successors.skipped));
        }
        const nextList =
          successors.edits.size === 0
            ? withNew
            : withNew.map((row) => {
                const edit = successors.edits.get(row.id);
                return edit
                  ? { ...row, dependencies: edit.after, localModifiedAt: stamp }
                  : row;
              });
        // ★ Patch BEFORE this assignment so the ref and the state agree.
        tasksRef.current = nextList;
        setTasks(nextList);
        captureSuccessorEdits(successors, nextList);
```

`const newId = newTask.id;` already sits above this; keep it where it is.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/app/use-task-submit.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all PASS, both `EXIT=0`. If `react-hooks/exhaustive-deps` complains, add what it names to `handleSubmit`'s dependency array — `form` is already there and covers `form.successorLinks`.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-task-submit.ts src/app/use-task-submit.test.ts
git commit -F - <<'EOF'
feat: apply staged successor links on task save

One functional setter covers the edited task and every target on the update
path. The create path resolves AFTER the id mint against a list containing the
new task — resolving against the pre-mint array makes the new id a dangling
reference that sanitizeDependencies strips, silently applying nothing.

Undo is one captureFieldEdit per target carrying `dependencies` alone. That
merges by id rather than replacing the row, so it cannot revert a field the
save never touched — the whole-row alternative inherits open-followups §50.
EOF
```

---

## Task 9: full gate sweep

**Files:** none — this task fixes whatever the gates name.

- [ ] **Step 1: Remove the last dead i18n keys**

`depRemove`, `depAdd`, `depType`, `depPickTask` and `depPickTaskPlaceholder` had their only uses in the old `dependencies-editor.tsx`. Confirm each is now dictionary-only, then delete:

```bash
for k in depRemove depAdd depType depPickTask depPickTaskPlaceholder; do
  n=$(grep -rn "\"$k\"" src/app e2e --include=*.ts --include=*.tsx | grep -v "i18n.ts:\|i18n.de.ts:" | wc -l)
  echo "$k -> $n non-dict uses"
done
```

Expected: `0` for all five. If any is non-zero, look at the use before deleting — do not delete a key that something still reads.

`depMissing`, `depHelp` and the four `depType*Short` / `depType*Help` keys **stay**. `depMissing` is still used by `task-row.tsx:739` and by the group's dangling-chip label; `depHelp` by the modal; the `*Short` keys by the type `<Select>`.

Delete the five from `src/app/i18n.ts` with Edit, then from the DE file:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
for (const k of ["depRemove","depAdd","depType","depPickTask","depPickTaskPlaceholder"]) {
  const re = new RegExp("^  " + k + ": .*\\r\\n", "m");
  if (!re.test(s)) throw new Error("not found: " + k);
  s = s.replace(re, "");
}
fs.writeFileSync(p, s, "utf8");
console.log("removed 5");
'
```

★ `depType` and `depTypeFsShort` both start with `depType`. The regexes above are anchored on `^  <key>: `, so they cannot match a longer key — verify with `grep -c "depTypeFsShort" src/app/i18n.de.ts` (expect `1`) before continuing.

- [ ] **Step 2: Run every blocking gate, unpiped**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
```

Run them **serially**, never two vitest processes at once — concurrent runs saturate the machine and produce load-timeout flakes that never reproduce in isolation.

All must be `0`.

- [ ] **Step 3: If `size:check` fails**

The gate counts `readFileSync().split("\n").length`, which is **one more** than `wc -l`. Read the real number with:

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-form-fields.tsx','utf8').split('\n').length)"
```

`task-row.tsx` shrinks in this branch, so a failure will be on `task-form-fields.tsx` or `use-task-submit.ts`. Update `docs/baselines/file-sizes.json` only for a file whose growth is genuine; a file at or over 800 needs an extraction instead.

- [ ] **Step 4: If `dup:check` fails**

It compares the **total duplicated-line percentage across all formats** against the `--threshold` in `package.json`'s `dup:check` script — not per-format, not tokens. The most likely new clone is the modal's two `<Field>` blocks in `task-form-fields.tsx`. If so, extract a local helper in that file that takes `direction`, the label key and the hint key.

- [ ] **Step 5: Targeted axe on the one scanned surface that changed**

The task modal opens only on interaction and is not reached by the view scan, but Open Points is in `A11Y_VIEWS` and its rows lost the "Edit relations" button.

```bash
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3000/
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points" --workers=1
```

Warm the route first (the 60s per-test timeout also covers the first navigation's Turbopack compile) and always pass `--workers=1` — local runs default to CPU-count while CI runs serially, and over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and no impact. A real violation names a rule id.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
chore: drop the i18n keys the old dependency add-row owned

depRemove, depAdd, depType, depPickTask and depPickTaskPlaceholder had their
only uses in the replaced editor. depMissing and depHelp stay — both still have
live readers.
EOF
```

---

## Task 10: release 0.227.0

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (5 files)

- [ ] **Step 1: Pick a codename**

Sci-fi/fantasy author surname, not previously used. Check with **two** greps — older `CHANGELOG.md` entries separate version and codename with an em-dash, so a single quote-form search reports a used name as free:

```bash
grep -n '"' CHANGELOG.md | grep -oE '"[A-Z][a-z]+"' | sort -u > /tmp/names-quoted.txt
grep -oE '— [A-Z][a-z]+' CHANGELOG.md | sort -u > /tmp/names-dash.txt
grep -c . /tmp/names-quoted.txt /tmp/names-dash.txt
```

Confirm your candidate appears in neither.

- [ ] **Step 2: Bump `src/app/version.ts`**

```ts
export const APP_VERSION = "0.227.0";
export const APP_BUILD_DATE = "<today>"; // 0.227.0: link successors from the task editor (<Codename>)
```

Update the milestone codename const in the same file.

- [ ] **Step 3: Add the `CHANGELOG.md` entry**

Cover: the modal's predecessor/successor split, the searchable picker, successor links applied on Save with per-target undo, and the inline relations cell becoming read-only (a removal — say so plainly).

★ No `[session link removed]...` URL in `CHANGELOG.md` or any MR description.

- [ ] **Step 4: Add the highlight key**

Append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` and add its EN and DE strings (DE via the node-write pattern from Task 3).

- [ ] **Step 5: Update the five ungated version sites**

No gate checks any of these, and all five have drifted before:

```bash
grep -n '"version"' package.json
grep -n '"version"' package-lock.json | head -3   # root + packages[""] — TWO occurrences
grep -n 'shields' README.md | head -3              # version AND codename
grep -rn 'Generated:' docs/CODEMAPS/*.md           # all five headers
```

- [ ] **Step 6: Final verification**

```bash
npx tsc --noEmit; echo "TSC=$?"
npm run test:run > /tmp/final.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/final.log
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

All `0`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
chore: release 0.227.0 "<Codename>"

Bumps version.ts plus the five ungated sites (package.json, both
package-lock.json occurrences, the README badge, and the five codemap
headers).
EOF
```

★ Do not push, open an MR, or merge without an explicit instruction.

---

## Follow-ups to record, not to do here

- `task-inline-patch.ts`'s `dependencies` branch (`:53`) has no caller after Task 7. Removing it would force `ownTaskId` and `knownTaskIds` out of `InlinePatchContext`.
- The task modal is not reached by the axe view scan, so every control in it is covered by unit tests alone.
- The create path still takes no undo capture for the new task itself, so a create-with-successors produces entries for the targets only. Pre-existing.
- Browsing dependency candidates without typing is gone — `EntityLinkPicker` opens only on a non-blank query. Restoring it means relaxing `hasQuery` in a primitive two other callers share.
