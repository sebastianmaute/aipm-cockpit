# Row-unique Accessible Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every per-row control on four surfaces an accessible name that cannot collide with another row's, and add the only detector that can catch a regression — because no gate in this repo can.

**Architecture:** Two promotions of proven, in-use code, then adoption. `buildRowTokens` (today private in `asset-library.tsx`) moves to a shared pure module and is generalised over the id type; `expectNoDuplicateButtonNames`/`buttonNames` become a shared test helper whose `minRows` guard throws, making a vacuous fixture unreachable. The four defective surfaces then consume the shared token builder.

**Tech Stack:** TypeScript, React 19, Next 16, vitest + @testing-library/react, Playwright (axe + seed specs), i18n EN/DE with tsc-enforced key parity.

**Spec:** `docs/superpowers/specs/2026-08-25-row-unique-accessible-names-design.md` (73569d51, corrected 6d70042c, D0 added 42809229). **Read D0 first — it supersedes D1 and D2, which are retained in the spec only as a record.**

---

## Context an engineer needs before Task 1

**The defect.** A per-row control whose accessible name derives from a value that is not unique to the row. N rows render N identically-named buttons. WCAG 2.4.6.

**Why no gate catches it.** axe has no rule that flags two controls sharing an accessible name, under any tag the gate requests, at any seed size. Verify yourself:

```bash
node -e "const a=require('axe-core');const t=['wcag2a','wcag2aa','wcag21a','wcag21aa'];for(const r of a.getRules(t).filter(r=>/identical|duplicate|unique/i.test(r.ruleId)))console.log(r.ruleId,'|',r.description)"
```

Two rules print; `duplicate-id-aria` is about `id` attributes and `frame-title-unique` about iframes. Neither is relevant. **Unit tests are the only possible detector.**

**The naming rule (D0).** A name unique in the rendered list is used **bare**. Rows sharing a name get a 1-based occurrence index over *only* the rows sharing that name, and **all** colliding rows are numbered including the first. Never the id (uuids read as character-salad aloud). Never a whole-list ordinal (shifts under sorting).

**No new i18n keys are needed.** The occurrence index is `(2)` — language-neutral. Any earlier note in the spec about adding EN/DE keys is obsolete under D0. This also removes the `i18n.de.ts` CRLF/umlaut hazard from this slice entirely.

**Gate traps that will bite you.**

- Never read a gate's exit code through a pipe — you get the pipe's status. Redirect, check unpiped, then read the file.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1. vitest never typechecks, so a test-only type error passes the suite and fails CI. Run tsc after editing **any** test.
- A vitest run reporting `Failed to start forks worker` is machine contention, not a result. Re-run with `--maxWorkers=1`.
- Never run two vitest processes at once.
- `src/app/*.ts(x)` are CRLF (`i/lf w/crlf`). Do not `sed -i` them.

---

## File structure

| file | responsibility | status |
|---|---|---|
| `src/app/row-tokens.ts` | **new.** Pure, i18n-free. `buildRowTokens` + `rowLabel`, generic over the id type. | create |
| `src/app/row-tokens.test.ts` | **new.** Unit tests for the above, including the escalation loop. | create |
| `src/app/asset-library.tsx` | drops its two private copies, imports the shared module. Behaviour unchanged. | modify |
| `src/test/row-unique-names.ts` | **new.** `expectRowUniqueNames` — the shared detector. | create |
| `src/test/row-unique-names.test.tsx` | **new.** Its own test, incl. mutation proof and the throw-on-too-few-rows guard. | create |
| `src/test/toolbar-order.ts` | `buttonNames` gains an optional scope + roles. Existing callers unaffected. | modify |
| `src/app/documents-list.tsx` | §111 — six controls, plus deleting the false comment. | modify |
| `src/app/insights/insight-text.ts` | §126 — new `insightRowTitles`, the row-unique headline map. | modify |
| `src/app/insights-panel.tsx` | §126 surface 1. | modify |
| `src/app/dashboard-sections/insights-card.tsx` | §126 surface 2 (found by triage). | modify |
| `src/app/history-panel.tsx` | §243 — two row controls, the compare-header button, the `labelOf` collapse. | modify |
| `src/app/budget-panel-people-rows.tsx` | triaged red #1. | modify |
| `e2e/seed-content.spec.ts` | the §126 characterization flip. | modify |
| `AGENTS.md`, `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts` + 5 ungated version sites | docs and release. | modify |

---

### Task 1: Promote the row-token builder to a shared pure module

**Files:**
- Create: `src/app/row-tokens.ts`
- Create: `src/app/row-tokens.test.ts`
- Modify: `src/app/asset-library.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/row-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRowTokens, rowLabel } from "./row-tokens";

describe("buildRowTokens", () => {
  it("leaves a name that is unique in the list BARE", () => {
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
    ]);
    expect(tokens.get(1)).toBe("Alpha");
    expect(tokens.get(2)).toBe("Beta");
  });

  it("numbers EVERY colliding row, the first included", () => {
    // ★ The first row is numbered too. A bare "Alpha" beside "Alpha (2)" leaves
    // a user unable to tell "the only one" from "the first of several".
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Alpha" },
    ]);
    expect(tokens.get(1)).toBe("Alpha (1)");
    expect(tokens.get(2)).toBe("Alpha (2)");
  });

  it("indexes occurrences only within the colliding group", () => {
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Alpha" },
    ]);
    expect(tokens.get(1)).toBe("Alpha (1)");
    expect(tokens.get(2)).toBe("Beta");
    expect(tokens.get(3)).toBe("Alpha (2)");
  });

  it("escalates when a row is literally NAMED like a generated token", () => {
    // ★ Rename accepts any string. Without the escalation loop the generated
    // token for the pair's first row would collide with row 3's bare name.
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Alpha" },
      { id: 3, name: "Alpha (1)" },
    ]);
    const all = [tokens.get(1), tokens.get(2), tokens.get(3)];
    expect(new Set(all).size).toBe(3);
  });

  it("works with string ids", () => {
    const tokens = buildRowTokens([
      { id: "a", name: "Same" },
      { id: "b", name: "Same" },
    ]);
    expect(tokens.get("a")).toBe("Same (1)");
    expect(tokens.get("b")).toBe("Same (2)");
  });

  it("returns an empty map for an empty list", () => {
    expect(buildRowTokens([]).size).toBe(0);
  });
});

describe("rowLabel", () => {
  it("keeps the verb at the FRONT so the name CONTAINS the visible text", () => {
    // WCAG 2.5.3 is containment, case-insensitive, NOT prefix — but front
    // position is the documented best practice and what every caller assumes.
    expect(rowLabel("Delete", "Alpha (2)")).toBe("Delete – Alpha (2)");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/row-tokens.test.ts --reporter=dot --maxWorkers=1 > /tmp/rowunique-t1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find module" /tmp/rowunique-t1.log
```

Expected: FAIL — `Cannot find module './row-tokens'`.

★ If it reports `no tests` with EXIT=1, the path did not match vitest's `include` (`src/**/*.{test,spec}.{ts,tsx}`) — that is a missing file, not a failing test.

- [ ] **Step 3: Create the module**

Create `src/app/row-tokens.ts`. This is `buildRowTokens` and `rowLabel` MOVED verbatim from `asset-library.tsx`, generalised from `readonly DocumentAsset[]` to a structural row type so every surface can use it:

```ts
// Shared row-name disambiguator.
//
// ★★ THE DISAMBIGUATOR IS DELIBERATELY NOT THE ID. Ids are `crypto.randomUUID()`
// on several entities, so "Delete – image.png (3f2a…-…)" reads 36 characters of
// character-salad aloud on every control — trading a 2.4.6 failure for a
// usability regression hitting exactly the users 2.4.6 protects. It is also NOT
// a whole-list positional ordinal, which shifts under sorting. An occurrence
// index ranges only over the rows sharing one name and tells the user there are
// several and which one they are on.
//
// ★ ALL colliding rows are numbered, including the first — hearing a bare
// "image.png" would otherwise leave a user unable to tell "the only one" from
// "the first of several".
//
// ★★ THE ESCALATION LOOP IS LOAD-BEARING, not defensive padding. A user can name
// a row literally "image.png (1)"; with two other rows called "image.png" the
// GENERATED token for the pair's first row would then collide with that row's
// BARE one.
//
// ★ Cross-MOUNT uniqueness is not required: a modal sets `aria-modal`, which
// hides the background copy from AT, and 2.4.6 is about distinguishability
// within one context.
//
// ★ Callers pass rows in the order the USER navigates (sorted/filtered as
// rendered), not the raw entity order — the occurrence index has to follow what
// is on screen.

/** A row reduced to what disambiguation needs: an identity and a display name. */
export interface TokenRow<Id> {
  readonly id: Id;
  readonly name: string;
}

/** Maps each row's id to the display TOKEN used in every one of that row's labels. */
export function buildRowTokens<Id>(rows: readonly TokenRow<Id>[]): Map<Id, string> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);

  const seen = new Map<string, number>();
  const used = new Set<string>();
  const tokens = new Map<Id, string>();
  for (const row of rows) {
    let token = row.name;
    if ((counts.get(row.name) ?? 0) > 1) {
      const occurrence = (seen.get(row.name) ?? 0) + 1;
      seen.set(row.name, occurrence);
      token = `${row.name} (${occurrence})`;
    }
    if (used.has(token)) {
      let bump = 2;
      while (used.has(`${row.name} (${bump})`)) bump += 1;
      token = `${row.name} (${bump})`;
    }
    used.add(token);
    tokens.set(row.id, token);
  }
  return tokens;
}

/** ★ `verb` stays at the FRONT so the accessible name still CONTAINS each
 *  control's visible text (WCAG 2.5.3 — containment, case-insensitive, NOT
 *  prefix). axe's `label-content-name-mismatch` is `experimental` and excluded
 *  by the gate's default tagExclude, so that is unit-tested too. */
export function rowLabel(verb: string, token: string): string {
  return `${verb} – ${token}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/row-tokens.test.ts --reporter=dot --maxWorkers=1 > /tmp/rowunique-t1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t1.log
```

Expected: EXIT=0, 7 tests passing.

- [ ] **Step 5: Point `asset-library.tsx` at the shared module**

In `src/app/asset-library.tsx`: delete the local `buildRowTokens` function and the local `rowLabel` function together with the long comment block above `buildRowTokens` (that comment now lives in `row-tokens.ts` — do not leave a second copy). Add to the imports:

```ts
import { buildRowTokens, rowLabel } from "./row-tokens";
```

Leave every call site (`buildRowTokens(sorted)`, `rowTokens.get(asset.id) ?? asset.name`, and every `rowLabel(...)`) exactly as it is. `DocumentAsset` has `id: string` and `name: string`, so it satisfies `TokenRow<string>` structurally with no cast.

- [ ] **Step 6: Prove asset-library is behaviourally unchanged**

```bash
npx vitest run src/app/asset-library.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t1b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t1b.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: asset-library suite EXIT=0 with the same test count as before the change; TSC_EXIT=0.

★ This is the regression check that matters for this task. If asset-library goes red, the move changed behaviour — fix the module, do not edit asset-library's tests.

- [ ] **Step 7: Commit**

```bash
git add src/app/row-tokens.ts src/app/row-tokens.test.ts src/app/asset-library.tsx
git commit -m "refactor(a11y): promote the row-token disambiguator to a shared module

buildRowTokens and rowLabel were private to asset-library.tsx. Three
other surfaces need exactly this algorithm, so they move to
src/app/row-tokens.ts, generalised over the id type. asset-library now
imports them; its behaviour and tests are unchanged."
```

---

### Task 2: Promote the duplicate-name detector to a shared test helper

**Files:**
- Modify: `src/test/toolbar-order.ts`
- Create: `src/test/row-unique-names.ts`
- Create: `src/test/row-unique-names.test.tsx`

**Why a shared helper.** 29 test files hand-roll this assertion today, and the failure mode is silent: a fixture rendering one row passes against defective code. `minRows` makes that unreachable. This mirrors why AGENTS.md already mandates `src/test/toolbar-order.ts` over a hand-rolled `findIndex`.

- [ ] **Step 1: Write the failing test**

Create `src/test/row-unique-names.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectRowUniqueNames } from "./row-unique-names";

function Rows({ names, role = "button" }: { names: string[]; role?: string }) {
  return (
    <ul data-testid="rows">
      {names.map((n, i) => (
        <li key={i}>
          {role === "button" ? (
            <button type="button" aria-label={n}>
              x
            </button>
          ) : (
            <input type="checkbox" aria-label={n} readOnly checked={false} />
          )}
        </li>
      ))}
    </ul>
  );
}

describe("expectRowUniqueNames", () => {
  it("passes when every control has a distinct name", () => {
    render(<Rows names={["Delete – Alpha", "Delete – Beta"]} />);
    expect(() => expectRowUniqueNames({ minRows: 2 })).not.toThrow();
  });

  it("FAILS when two controls share a name", () => {
    // ★ The mutation proof. Without this the helper could be a no-op and every
    // adopting test would pass vacuously.
    render(<Rows names={["Delete – Alpha", "Delete – Alpha"]} />);
    expect(() => expectRowUniqueNames({ minRows: 2 })).toThrow(/Delete – Alpha/);
  });

  it("THROWS rather than passing when the fixture renders too few controls", () => {
    // ★ This is the whole point. A one-row fixture cannot express a collision,
    // so silently passing would be a vacuous green.
    render(<Rows names={["Delete – Alpha"]} />);
    expect(() => expectRowUniqueNames({ minRows: 2 })).toThrow(/minRows/);
  });

  it("scopes to a container when one is given", () => {
    render(
      <div>
        <button type="button" aria-label="Outside">
          x
        </button>
        <Rows names={["Delete – Alpha", "Delete – Beta"]} />
      </div>,
    );
    const scope = screen.getByTestId("rows");
    expect(() => expectRowUniqueNames({ minRows: 2, scope })).not.toThrow();
  });

  it("checks roles beyond button when asked", () => {
    render(<Rows names={["Pick – Alpha", "Pick – Alpha"]} role="checkbox" />);
    expect(() => expectRowUniqueNames({ minRows: 2, roles: ["checkbox"] })).toThrow(/Pick – Alpha/);
  });

  it("does not see a checkbox collision when only buttons are checked", () => {
    // ★ Anti-vacuity control for the test above: proves `roles` is load-bearing
    // and the previous case did not pass for an unrelated reason.
    render(<Rows names={["Pick – Alpha", "Pick – Alpha"]} role="checkbox" />);
    expect(() => expectRowUniqueNames({ minRows: 2, roles: ["checkbox"] })).toThrow();
    expect(() => expectRowUniqueNames({ minRows: 1, roles: ["button"] })).toThrow(/minRows/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/test/row-unique-names.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find module" /tmp/rowunique-t2.log
```

Expected: FAIL — `Cannot find module './row-unique-names'`.

- [ ] **Step 3: Generalise `buttonNames` without changing its current behaviour**

In `src/test/toolbar-order.ts`, replace the `buttonNames` function with:

```ts
/** Accessible names of every rendered button, in DOM order. */
export function buttonNames(scope?: HTMLElement): string[] {
  return controlNames(["button"], scope);
}

/**
 * Accessible names of every rendered control of the given roles, in DOM order.
 *
 * ★ `aria-label || textContent`, not a real accessible-name computation. That
 * is the convention every caller in this repo already relies on, and it avoids
 * a live hazard: `dom-accessibility-api` is installed TWICE (0.6.3 under
 * jest-dom, 0.5.16 under @testing-library/dom) and is undeclared in
 * package.json, so a bare import could disagree with testing-library's own
 * `{name}` queries. Reproduce: `npm ls dom-accessibility-api`.
 *
 * ★ `||`, not `??`: aria-label="" returns "" (not null), which would otherwise
 * shadow the textContent fallback and contribute an empty name.
 */
export function controlNames(roles: readonly string[], scope?: HTMLElement): string[] {
  const q = scope ? within(scope) : screen;
  return roles
    .flatMap((role) => q.queryAllByRole(role))
    .map((el) => el.getAttribute("aria-label") || el.textContent || "");
}
```

and extend the import at the top of that file:

```ts
import { screen, within } from "@testing-library/react";
```

★ `buttonNames()` with no argument behaves exactly as before, so its existing callers are untouched. It now uses `queryAllByRole` rather than `getAllByRole`, which returns `[]` instead of throwing when nothing matches — that difference is invisible to `buttonIndex`, which already throws its own error on an empty list.

- [ ] **Step 4: Create the detector**

Create `src/test/row-unique-names.ts`:

```ts
// Shared assertion: no two controls in a scope share an accessible name.
//
// ★★★ WHY THIS EXISTS. axe has NO rule that flags two controls sharing an
// accessible name, under any tag `e2e/a11y.spec.ts` requests, at any seed size.
// A unit test is the only detector that can exist for WCAG 2.4.6 here — so a
// VACUOUS one is worse than none, because it reads as coverage.
//
// ★★ `minRows` is REQUIRED and THROWS when unmet. A fixture rendering one row
// cannot express a collision and would pass against defective code. Making that
// a throw rather than a pass is the difference between a detector and a decoration.
import { expect } from "vitest";
import { controlNames } from "./toolbar-order";

export interface RowUniqueOptions {
  /** Minimum controls the scope must render. Throws below this — never passes. */
  readonly minRows: number;
  /** Container to scope to. Defaults to the whole document. */
  readonly scope?: HTMLElement;
  /** Roles to check. Defaults to buttons. */
  readonly roles?: readonly string[];
}

export function expectRowUniqueNames(opts: RowUniqueOptions): void {
  const { minRows, scope, roles = ["button"] } = opts;
  const names = controlNames(roles, scope);

  if (names.length < minRows) {
    throw new Error(
      `expectRowUniqueNames: minRows is ${minRows} but the scope rendered ${names.length} ` +
        `control(s) of role(s) [${roles.join(", ")}]. A fixture too small to express a ` +
        `collision would pass against defective code, so this is a hard failure. ` +
        `Seed more rows. Rendered: [${names.join(" | ")}]`,
    );
  }

  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, c]) => c > 1);

  expect(
    dupes,
    dupes.length === 0
      ? ""
      : `WCAG 2.4.6: ${dupes.length} accessible name(s) are shared by more than one control — ` +
        dupes.map(([n, c]) => `"${n}" x${c}`).join(", "),
  ).toEqual([]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/test/row-unique-names.test.tsx src/app/documents-panel.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t2.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, 6 new tests passing, `documents-panel` unchanged (it is the heaviest existing `buttonNames` consumer), TSC_EXIT=0.

- [ ] **Step 6: Mutation-prove the guard**

Temporarily change `if (names.length < minRows)` to `if (false)` and re-run **only** `row-unique-names.test.tsx`. The "THROWS rather than passing" test must go RED. Restore the line and confirm `git diff --stat` is empty for `src/test/row-unique-names.ts`.

★ `git checkout -- <file>` is deny-blocked in this environment. Revert by writing the original line back with an anchored edit, then prove the diff is empty.

- [ ] **Step 7: Commit**

```bash
git add src/test/row-unique-names.ts src/test/row-unique-names.test.tsx src/test/toolbar-order.ts
git commit -m "test(a11y): promote the duplicate-name assertion to a shared detector

29 test files hand-roll a row-unique naming assertion, and the failure
mode is silent: a one-row fixture passes against defective code. The
shared helper makes that unreachable - minRows THROWS rather than
passing. buttonNames() gains an optional scope and a roles-general
sibling; its existing no-argument behaviour is unchanged."
```

---

### Task 3: §111 — documents-list row controls

**Files:**
- Modify: `src/app/documents-list.tsx`
- Test: `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/documents-panel.test.tsx`, inside the describe that already renders the live panel:

```tsx
it("keeps every per-row control distinct when two documents share a title", () => {
  // ★★ TWO documents, SAME title. A one-row fixture, or two rows with distinct
  // titles, passes against the unfixed code - which is how this shipped.
  renderLive([doc(1, "Q3 report"), doc(2, "Q3 report")]);
  expectRowUniqueNames({ minRows: 2 });
});
```

and add the import:

```tsx
import { expectRowUniqueNames } from "../test/row-unique-names";
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/documents-panel.test.tsx -t "two documents share a title" --reporter=dot --maxWorkers=1 > /tmp/rowunique-t3.log 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|Tests " /tmp/rowunique-t3.log
```

Expected: FAIL, listing the shared names (`"Delete – Q3 report" x2`, `"Rename – Q3 report" x2`, and so on).

- [ ] **Step 3: Fix the source**

In `src/app/documents-list.tsx`:

1. Import the shared module:

```tsx
import { buildRowTokens, rowLabel } from "./row-tokens";
```

2. Derive the tokens once, from the list **in the order it is rendered** (if the component sorts or filters before mapping, derive from that array, not the raw prop):

```tsx
const rowTokens = useMemo(
  () => buildRowTokens(docs.map((d) => ({ id: d.id, name: d.title }))),
  [docs],
);
```

3. Inside the row map, take the token once:

```tsx
const token = rowTokens.get(doc.id) ?? doc.title;
```

4. Replace each of the five `aria-label` expressions of the form
   ``aria-label={`${t(lang, "documentsDelete")} – ${doc.title}`}`` with
   ``aria-label={rowLabel(t(lang, "documentsDelete"), token)}``, and the same for
   `documentsDownload`, `documentsHistory`, `documentsRename`, `documentsDuplicate`.

5. Give the **selection button** — whose accessible name is currently the raw title text — an explicit name, keeping the visible text unchanged so WCAG 2.5.3 containment holds:

```tsx
<button
  type="button"
  onClick={() => onSelect(doc.id)}
  aria-current={doc.id === selectedId ? "true" : undefined}
  aria-label={token}
  className={`text-left underline-offset-2 hover:underline ${INTERACTIVE}`}
>
  {doc.title}
</button>
```

6. **Delete the false comment.** Remove the sentence asserting the document's title is *"row-unique by construction"*. It is not, and §111's position is that the comment is the defect: a false invariant in a comment outlives the code, because the next reader stops checking. Replace it with:

```tsx
{/* Selection rides a real button so it is keyboard-operable. The name is the
    DISAMBIGUATED token, not the raw title - titles are NOT unique
    (uniqueDocumentTitle is bypassed by commitRename and the AI createDocument
    path). `aria-current` marks the current item in a set, not a toggle, so it
    is not aria-pressed. */}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/documents-panel.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t3.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t3.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0 — the whole file, including the six existing `expectNoDuplicateButtonNames()` call sites; TSC_EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/documents-list.tsx src/app/documents-panel.test.tsx
git commit -m "fix(a11y): give document row controls distinct accessible names (111)

Six controls per row were named with doc.title, which is not unique -
uniqueDocumentTitle runs at only two of the four title-writing paths.
Names now use the shared disambiguated token. Also deletes the comment
asserting the title is row-unique by construction: it is not, and a
false invariant in a comment outlives the code it describes."
```

---

### Task 4: §126 — insights, both surfaces

**Files:**
- Modify: `src/app/insights/insight-text.ts`
- Modify: `src/app/insights-panel.tsx`
- Modify: `src/app/dashboard-sections/insights-card.tsx`
- Test: `src/app/insights-panel.test.tsx`, `src/app/dashboard-sections/insights-card.test.tsx`

**Why both.** `insightTitle` is `t(lang, TITLE_KEY[insight.type])` — type-driven and nothing else. Three call sites build control names from it. Verify:

```bash
grep -rn "insightTitle(" src/app --include=*.tsx --include=*.ts | grep -v "\.test\." | grep -v "insight-text.ts"
```

`insight-digest-card.tsx` already disambiguates on collision and is **not** changed by this task. The other two are.

- [ ] **Step 1: Write the failing tests**

In `src/app/insights-panel.test.tsx`:

```tsx
it("keeps every per-row control distinct when two insights share a type", () => {
  // ★★ detect.ts mints one milestoneSlip per overdue milestone, so two rows of
  // one type is the ORDINARY case, not a contrived one. The panel's existing
  // fixture renders ONE insight and cannot express the collision.
  renderPanel({
    insights: [
      makeInsight({ id: 7, type: "milestoneSlip" }),
      makeInsight({ id: 8, type: "milestoneSlip" }),
    ],
  });
  expectRowUniqueNames({ minRows: 2 });
});
```

In `src/app/dashboard-sections/insights-card.test.tsx`:

```tsx
it("keeps ack/act/dismiss distinct when two insights share a type", () => {
  render(<InsightsCard insights={[insight, { ...insight, id: insight.id + 1 }]} {...cardProps} />);
  expectRowUniqueNames({ minRows: 2 });
});
```

Add to both files:

```tsx
import { expectRowUniqueNames } from "../test/row-unique-names";
```

(from `dashboard-sections/`, the path is `"../../test/row-unique-names"`).

★ Match each file's own existing fixture-builder names (`makeInsight`, `renderPanel`, `insight`, `cardProps`) — read the file before writing; do not invent helpers.

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/insights-panel.test.tsx src/app/dashboard-sections/insights-card.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t4.log 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|Tests " /tmp/rowunique-t4.log
```

Expected: both FAIL, naming the shared labels.

- [ ] **Step 3: Add the single row-unique headline**

In `src/app/insights/insight-text.ts`, beside `insightTitle`:

```ts
/**
 * Row-unique headline for one insight within a RENDERED LIST.
 *
 * ★★ `insightTitle` is type-driven and nothing else, so two insights of one
 * type produce byte-identical control names - WCAG 2.4.6. Both list surfaces
 * (insights-panel, dashboard InsightsCard) must build names from THIS, never
 * from `insightTitle` directly.
 *
 * ★ Takes the whole rendered list because the disambiguator is an occurrence
 * index over the colliding rows, not a property of one insight.
 */
export function insightRowTitles(insights: readonly Insight[], lang: Lang): Map<number, string> {
  return buildRowTokens(insights.map((i) => ({ id: i.id, name: insightTitle(i, lang) })));
}
```

with the import:

```ts
import { buildRowTokens } from "../row-tokens";
```

★ `Insight.id` is a number. If tsc disagrees, use the real type rather than casting.

- [ ] **Step 4: Consume it on both surfaces**

In `src/app/insights-panel.tsx`, derive once above the row map (from the **filtered/sorted** array actually rendered):

```tsx
const rowTitles = useMemo(() => insightRowTitles(visible, lang), [visible, lang]);
```

and replace `const title = insightTitle(insight, lang);` with:

```tsx
const title = rowTitles.get(insight.id) ?? insightTitle(insight, lang);
```

That single change fixes all seven controls, because the four in-panel `aria-label`s and `insight-recommendation-controls.tsx`'s `nameQualifier` plus its Apply/Reject pair all derive from `title`.

Apply the identical two edits in `src/app/dashboard-sections/insights-card.tsx`, deriving from `active` (the sliced array it maps) and replacing its `const title = insightTitle(insight, lang);`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/app/insights-panel.test.tsx src/app/dashboard-sections/insights-card.test.tsx src/app/insights-card.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t4.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t4.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights/insight-text.ts src/app/insights-panel.tsx src/app/dashboard-sections/insights-card.tsx src/app/insights-panel.test.tsx src/app/dashboard-sections/insights-card.test.tsx
git commit -m "fix(a11y): give insight row controls distinct accessible names (126)

insightTitle is type-driven, so two insights of one type produced
byte-identical names on every per-row control. detect.ts mints one
milestoneSlip per overdue milestone, so this is the ordinary case.

Fixes BOTH surfaces. 126 names only insights-panel; the triage found
dashboard-sections/insights-card.tsx builds names the same way and was
equally affected. insight-digest-card already disambiguates and is
unchanged."
```

---

### Task 5: Flip the §126 e2e characterization assertion

**Files:**
- Modify: `e2e/seed-content.spec.ts`

**Read this before editing.** The spec asserts a count of **2** on the accessible name `"Dismiss – Milestone at risk"`. That assertion **characterizes the defect** — it pins the bug, not the wanted behaviour. Task 4 turns it RED, and **the red run is the fix working**. The spec's own comment already anticipates this and tells you to change the expectation rather than loosen it.

**Do NOT** relax it to a range and **do NOT** delete it. It is the only detector in the repo for that surface; a loosened form is equivalent to no detector.

- [ ] **Step 1: Confirm it is red for the right reason**

```bash
npx playwright test e2e/seed-content.spec.ts --project=chromium --workers=1 > /tmp/rowunique-t5.log 2>&1; echo "EXIT=$?"
grep -E "Dismiss|expected|received" /tmp/rowunique-t5.log | head
```

Expected: FAIL — expected 2, received 0.

★ Add `--workers=1` whenever you match more than one spec: `playwright.config.ts` sets `workers: CI ? 1 : undefined`, so local runs go at CPU count and over-subscription produces `Test timeout` failures that carry no violation text and are contention, not findings.

- [ ] **Step 2: Flip the assertion**

Change the expected count from `2` to `0`, and add positive assertions for the two now-distinct names:

```ts
await expect(
  page.getByRole("button", { name: "Dismiss – Milestone at risk", exact: true }),
).toHaveCount(0);
await expect(
  page.getByRole("button", { name: "Dismiss – Milestone at risk (1)", exact: true }),
).toHaveCount(1);
await expect(
  page.getByRole("button", { name: "Dismiss – Milestone at risk (2)", exact: true }),
).toHaveCount(1);
```

Update the comment above it so the next reader knows it is now pinning the FIXED behaviour, and point it at §126 as closed.

- [ ] **Step 3: Run to verify it passes**

```bash
npx playwright test e2e/seed-content.spec.ts --project=chromium --workers=1 > /tmp/rowunique-t5.log 2>&1; echo "EXIT=$?"
grep -E "passed|failed" /tmp/rowunique-t5.log | tail -2
```

Expected: EXIT=0.

★ If the `(1)`/`(2)` suffixes do not appear, the seeded insights are of **different** types and never collided — in which case the count-0 assertion passes vacuously. Confirm by grepping the seed for the insight types it plants before accepting green.

- [ ] **Step 4: Commit**

```bash
git add e2e/seed-content.spec.ts
git commit -m "test(e2e): flip the 126 characterization assertion to the fixed behaviour

The count-2 assertion pinned the BUG. It is flipped to 0 plus positive
assertions for the two now-distinct names - not loosened to a range and
not deleted, because it is the only detector in the repo for this
surface and a loosened form is equivalent to no detector."
```

---

### Task 6: §243 — history rows and the compare header

**Files:**
- Modify: `src/app/history-panel.tsx`
- Test: `src/app/history-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("keeps every per-row control distinct across versions", () => {
  // ★★ TWO versions. This surface collides from N=2 unconditionally - the
  // "Compared with current" and "Restore this state" buttons are named by their
  // TEXT, with nothing row-specific in them at all.
  renderPanel({
    versions: [
      { id: "v1", label: "Checkpoint", capturedAt: "2026-03-14T10:00:00.000Z" },
      { id: "v2", label: "Checkpoint", capturedAt: "2026-03-15T10:00:00.000Z" },
    ],
  });
  expectRowUniqueNames({ minRows: 2 });
});
```

★ Both versions carry the SAME label deliberately — `labelOf` falls back to a timestamp, so distinct labels would let a weaker fix pass. Match the file's own fixture builder and `ProjectVersionMeta` shape (`id: string`, `label: string | null`, `capturedAt` ISO, plus `projectId`, `trigger`, `summary`).

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/history-panel.test.tsx -t "distinct across versions" --reporter=dot --maxWorkers=1 > /tmp/rowunique-t6.log 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|Tests " /tmp/rowunique-t6.log
```

Expected: FAIL, naming `"Compared with current" x2` and `"Restore this state" x3` (three, because the compare-header button collides with both rows).

- [ ] **Step 3: Fix the source**

In `src/app/history-panel.tsx`:

1. Import: `import { buildRowTokens, rowLabel } from "./row-tokens";`

2. Derive tokens from the rendered version list:

```tsx
const rowTokens = useMemo(
  () => buildRowTokens(versions.map((v) => ({ id: v.id, name: labelOf(v) }))),
  [versions, displayTz, lang],
);
```

★ `labelOf` closes over `displayTz` and `lang`, so both belong in the dependency array. `react-hooks/exhaustive-deps` rejects an `obj.member` dependency — hoist to a local const if it complains.

3. Inside the row map take `const token = rowTokens.get(v.id) ?? labelOf(v);` and:
   - give the "Compared with current" button `aria-label={rowLabel(t(lang, "historyCompareVsNow"), token)}`;
   - give the row's "Restore this state" button `aria-label={rowLabel(t(lang, "historyRestoreState"), token)}`;
   - change the delete button to `aria-label={rowLabel(t(lang, "historyDelete"), token)}`;
   - change the compare checkbox to `aria-label={rowLabel(t(lang, "historyCompareSelect"), token)}` — **D3**: it currently inlines `v.label ?? formatDisplayTimestamp(v.capturedAt, displayTz, lang)`, a duplicate of `labelOf`'s body, which is exactly the drift the rule forbids.

4. The **compare-header** restore button currently sets `aria-label={t(lang, "historyRestoreState")}` — the bare string, colliding with every row. It restores the compared state, and `compareLabels` (`{left, right} | null`) is in scope:

```tsx
aria-label={
  compareLabels
    ? rowLabel(t(lang, "historyRestoreState"), `${compareLabels.left} → ${compareLabels.right}`)
    : t(lang, "historyRestoreState")
}
```

★ The verb stays at the front so the visible text "Restore this state" is still CONTAINED in the accessible name (WCAG 2.5.3). The button only renders while a comparison is active, so the fallback is defensive; keep it rather than asserting non-null.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/history-panel.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t6.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t6.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/history-panel.tsx src/app/history-panel.test.tsx
git commit -m "fix(a11y): give history row controls distinct accessible names (243)

Compared-with-current and Restore-this-state were named by their text
alone, so N versions rendered N identical names of each - and the
compare header's own restore button set the bare string as an
aria-label, making the second set N+1. All four row controls now use the
shared disambiguated token, and the header button names the comparison
it restores.

Also collapses the compare checkbox's inlined copy of labelOf's body,
which was the duplicated expression D3 forbids."
```

---

### Task 7: Triaged red #1 — budget people-rows disclosure

**Files:**
- Modify: `src/app/budget-panel-people-rows.tsx`
- Test: `src/app/budget-panel-people-rows.test.tsx`

**The defect.** The disclosure name is `` `${t(lang,"budgetShowPeople")} – ${label}` `` where the caller passes `label = roleLabel(role, disciplines, grades)` — a function of discipline and grade text only, carrying no bucket or role id. Two buckets whose role lines share a discipline+grade combo render identical names. The file's own docstring already says *"the axe gate cannot protect this"*.

- [ ] **Step 1: Write the failing test**

The existing `row-unique` block renders ONE `PeopleDisclosureLabel`. Add a second, colliding row:

```tsx
it("keeps the disclosure name distinct when two role lines share a discipline and grade", () => {
  // ★★ Two DIFFERENT roles whose discipline+grade text is identical - the
  // collision roleLabel() cannot express. A one-row fixture cannot see this.
  renderTwoLabels([
    { roleId: 3, label: "Design / Senior" },
    { roleId: 4, label: "Design / Senior" },
  ]);
  expectRowUniqueNames({ minRows: 2 });
});
```

★ Read the file's existing `renderLabel()` helper and extend it rather than inventing `renderTwoLabels` if a two-row helper already exists.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/budget-panel-people-rows.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t7.log 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|Tests " /tmp/rowunique-t7.log
```

Expected: FAIL — `"Show people – Design / Senior" x2`.

- [ ] **Step 3: Fix the source**

In `src/app/budget-panel.tsx`, where the `label` prop is passed, build tokens across the rendered role lines and pass the token instead of the raw `roleLabel(...)`:

```tsx
const roleTokens = useMemo(
  () => buildRowTokens(rows.map((r) => ({ id: r.roleId, name: roleLabel(r.role, disciplines, grades) }))),
  [rows, disciplines, grades],
);
```

then pass `label={roleTokens.get(row.roleId) ?? roleLabel(row.role, disciplines, grades)}`.

★ Derive from the FILTERED rows actually rendered — the panel has a role filter, and the occurrence index must follow what is on screen.

★ `budget-panel-people-rows.tsx` itself needs no change: it already composes `verb – label`. Fix the value, not the composition.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/budget-panel-people-rows.test.tsx src/app/budget-panel.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t7.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/rowunique-t7.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 5: Update the now-false docstring**

`budget-panel-people-rows.tsx`'s docstring says the axe gate cannot protect this. That is still true and stays. Add one line recording that a unit test now does, and name it — otherwise the next reader assumes nothing covers it.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel-people-rows.tsx src/app/budget-panel-people-rows.test.tsx
git commit -m "fix(a11y): disambiguate budget people-disclosure names

The disclosure name was verb + roleLabel(discipline, grade), which
carries no bucket or role id, so two buckets sharing a discipline+grade
combo rendered identical names. Found by the row-unique triage, not by
any gate - the file's own docstring already noted axe cannot see it."
```

---

### Task 8: Convert the 30 already-adequate fixtures

**Files:** the CONVERT bucket from the spec's triage — 30 blocks across these files:
`asset-library` · `budget-panel` · `calendar-series-list` · `change-panel` (4 blocks) · `chat-thread-list` (2) · `dashboard-sections/registers-band` · `document-block-gutter` · `documents-deleted-section` · `documents-panel` (2) · `entity-link-picker` · `milestones-panel` (2) · `project-empty-state` · `raid-panel` · `reports` · `resource-calendar` · `roles-editor` (3) · `segmented-control` · `settings-sections/timezone-settings-section` · `steering-committee-panel` · `task-kanban-card` · `task-row` · `timelog-panel`

**The transformation is identical in every case.** The existing block enumerates expected names; add the distinctness assertion **without deleting the enumeration** — the enumeration pins *which* names, the helper pins that *no two* collide, and they are complementary.

- [ ] **Step 1: Convert one file and prove the pattern**

Start with `src/app/document-block-gutter.test.tsx`, whose block already renders two rows:

```tsx
it("gives every control a row-unique accessible name", () => {
  renderRows([P, P]);
  expect(screen.getByRole("button", { name: "Reorder – Block 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reorder – Block 2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Block actions – Block 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Block actions – Block 2" })).toBeInTheDocument();
  expectRowUniqueNames({ minRows: 4 });
});
```

★ `minRows` is the number of CONTROLS the scope renders, not rows. Set it to what the fixture actually renders — if you guess low the guard stops protecting you; if you guess high the test throws and tells you the real number, which is the cheap way to find it.

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/document-block-gutter.test.tsx --reporter=dot --maxWorkers=1 > /tmp/rowunique-t8.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |minRows|WCAG" /tmp/rowunique-t8.log
```

Expected: EXIT=0. If it reports a collision, that is a **finding** — stop, record it, and fix the source under D0 before continuing.

- [ ] **Step 3: Convert the remaining files, one batch per commit**

Batches are file-disjoint, so each can be verified and committed on its own:

| batch | files |
|---|---|
| B1 registers | `src/app/change-panel.test.tsx` (4 blocks) · `src/app/raid-panel.test.tsx` (the "badges only the referenced rows" block) · `src/app/milestones-panel.test.tsx` (2 blocks) |
| B2 documents | `src/app/documents-panel.test.tsx` (2 blocks) · `src/app/documents-deleted-section.test.tsx` · `src/app/asset-library.test.tsx` |
| B3 tasks | `src/app/task-row.test.tsx` (the "badges only the referenced rows" block) · `src/app/task-kanban-card.test.tsx` (the "badges only the referenced cards" block) |
| B4 planning | `src/app/roles-editor.test.tsx` (3 blocks) · `src/app/budget-panel.test.tsx` · `src/app/resource-calendar.test.tsx` · `src/app/calendar-series-list.test.tsx` |
| B5 shell + settings | `src/app/chat-thread-list.test.tsx` (2 blocks) · `src/app/entity-link-picker.test.tsx` · `src/app/segmented-control.test.tsx` · `src/app/settings-sections/timezone-settings-section.test.tsx` |
| B6 dashboard + misc | `src/app/dashboard-sections/registers-band.test.tsx` · `src/app/project-empty-state.test.tsx` · `src/app/reports.test.tsx` · `src/app/steering-committee-panel.test.tsx` · `src/app/timelog-panel.test.tsx` |

★ `segmented-control` is in B5 deliberately. An earlier draft of the spec called it a LEAVE case; it is not — it renders three radios whose names interpolate the option value, so it needs `roles: ["radio"]`.

After each batch (substitute that batch row s files):

```bash
npx vitest run <every path in the batch> --reporter=dot --maxWorkers=1 > /tmp/rowunique-t8.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |minRows|WCAG" /tmp/rowunique-t8.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Any `WCAG 2.4.6` failure is a real defect: fix the source by deriving `buildRowTokens(rows.map(r => ({id: r.id, name: <the visible name>})))` once above the map and naming each control `rowLabel(t(lang, <verb key>), token)`, then note it for the register. Any `minRows` throw means your count was wrong — read the number the error reports and correct it.

- [ ] **Step 4: Commit per batch**

```bash
git add <every path in the batch>
git commit -m "test(a11y): assert row-unique names via the shared detector (batch N)

Adds distinctness alongside each block's existing name enumeration. The
enumeration pins WHICH names; the helper pins that no two collide - the
pair a hand-rolled enumeration cannot express."
```

---

### Task 9: Extend the 9 one-row fixtures, then convert

**Files:** the EXTEND bucket — `insights-panel` (done in Task 4), `raid-panel` (2 blocks), `budget-panel-people-rows` (done in Task 7), `dashboard-sections/insights-card` (done in Task 4), `settings-sections/appearance-section`, `task-kanban-card` (2), `task-kanban-swimlanes`, `task-row`

**Four of the nine are already handled** by Tasks 4 and 7. The rest need a second row seeded before the helper will run at all.

★★ **This bucket is where reds concentrate, for a structural reason: a fixture that has never rendered two rows has never been checked.** Treat every failure as a genuine finding until proven otherwise.

- [ ] **Step 1: For each remaining file, add a second peer row to the fixture**

Example, `src/app/raid-panel.test.tsx`'s "renders a row-unique Send inquiry button" block, which today passes `raid: [item]`:

```tsx
const item = makeRaidItem({ id: 7, title: "Vendor risk" });
const twin = makeRaidItem({ id: 8, title: "Vendor risk" });
renderPanel({ raid: [item, twin] });
expectRowUniqueNames({ minRows: 2 });
```

★ Give the two rows the SAME title. Distinct titles let a broken implementation pass.

- [ ] **Step 2: Run each and triage the result**

```bash
npx vitest run <path> --reporter=dot --maxWorkers=1 > /tmp/rowunique-t9.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |minRows|WCAG" /tmp/rowunique-t9.log
```

GREEN means the surface was already correct and now has a real detector. A `WCAG 2.4.6` failure is a finding — fix the source under D0.

- [ ] **Step 3: Handle the one block outside the model**

`task-kanban-swimlanes.test.tsx`'s row-unique block renders **zero** controls of the kind in question — both its assertions are `.not.toBeInTheDocument()`. It is a visibility-gating test, not a distinctness one. **Do not force the helper into it.** Leave it as-is and add a one-line comment saying why, so the next sweep does not retry it.

- [ ] **Step 4: Commit**

```bash
git add <paths>
git commit -m "test(a11y): seed a second peer row so the distinctness guard can run

Nine blocks named themselves row-unique while rendering one row, which
cannot express a collision and passes against defective code. Each now
seeds a colliding twin. The kanban-swimlanes block is left alone: it
renders zero controls of this kind and is a visibility test."
```

---

### Task 10: Record the rule in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

The a11y hard-constraint bullet already says a unit test is the only possible detector, then leaves writing it to the reader. It should name the helper, exactly as it already mandates `src/test/toolbar-order.ts` for toolbar order — and for the identical reason: the hand-rolled form passes for the wrong reason.

- [ ] **Step 1: Add the mandate**

In the a11y bullet, after the sentence explaining axe cannot see duplicate names, add:

```
  ★★ ASSERT THIS WITH THE SHARED `src/test/row-unique-names.ts`, never a
  hand-rolled enumeration. `expectRowUniqueNames({minRows, scope, roles})`
  THROWS when the scope renders fewer than `minRows` controls, so the vacuous
  one-row fixture — which passes against defective code and is how this class
  shipped on four surfaces — is unreachable rather than something a reviewer has
  to remember. Name the row with `buildRowTokens`/`rowLabel` (`src/app/row-tokens.ts`):
  a name unique in the list is used BARE, colliding rows get a 1-based occurrence
  index, and ALL colliding rows are numbered including the first. NOT the id
  (uuids read as character-salad aloud); NOT a whole-list ordinal (shifts under
  sorting).
```

- [ ] **Step 2: Verify the symbol gate**

```bash
npm run docs:symbols:check > /tmp/rowunique-t10.log 2>&1; echo "EXIT=$?"
tail -3 /tmp/rowunique-t10.log
```

Expected: EXIT=0. The gate fails when a backticked mixed-case name in AGENTS.md exists nowhere in `src`/`scripts`/`e2e` — all four names above are real after Tasks 1–2.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: mandate the shared row-unique detector, like toolbar-order

The a11y bullet said a unit test is the only possible detector and left
writing it to the reader. It now names the helper and the token builder,
for the same reason toolbar-order is already mandated: the hand-rolled
form passes for the wrong reason."
```

---

### Task 11: Close the register entries and record what was deferred

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Mint the new number against origin/main**

```bash
git fetch origin main
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

★ A register number is reserved only once it is on `origin/main`. Two branches have already minted the same one. Use `max + 1`.

- [ ] **Step 2: Close §111, §126 and §243**

Append ` — CLOSED <version>` to each `##` heading and add a short closing paragraph to each saying what shipped. For §126, state explicitly that it was fixed on **two** surfaces and that the second (`dashboard-sections/insights-card.tsx`) was found by the triage and named in no entry.

- [ ] **Step 3: Open the deferred-sweep entry**

Write a new entry recording the bounded scope and why:

- The 29-file population came from grepping test NAMES and is provably incomplete — name the three off-name tests: `task-row.test.tsx`'s "two open rows get DIFFERENT Send inquiry accessible names", `budget-panel.test.tsx`'s "bucket-unique", `task-kanban-card.test.tsx`'s "card-unique".
- The property-based enumeration measures 127 candidate components, 103 un-interpolated `aria-label` sites inside `.map` bodies, and ~254 control tags inside a `.map` with no `aria-label` at all.
- It cannot be classified mechanically: the scan false-positives on `t(lang, key, row.value)` positional interpolation and on `qualify(...)` wrappers, and is blind to the text-named class — **which is the class §243's own two defective controls belonged to**.
- Include the reproduce commands, and cite SYMBOLS, never `path:LINE`.

- [ ] **Step 4: Verify the register's own gates**

```bash
npm run docs:claims:check > /tmp/rowunique-t11.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/rowunique-t11.log
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Expected: EXIT=0 and the max matching the number you minted. If the register carries a generated index between `INDEX:BEGIN`/`INDEX:END` markers, rebuild it with the recipe embedded there and confirm all three count spellings agree.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: close 111, 126 and 243; record the deferred property sweep"
```

---

### Task 12: Release

**Files:** `src/app/version.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`, `CHANGELOG.md`

User-visible accessible names change on four surfaces, so this is a **minor** bump, not refactor-only.

- [ ] **Step 1: Bump `src/app/version.ts`**

Raise `APP_VERSION` to the next minor, set `APP_BUILD_DATE`, and pick a new `APP_MILESTONE` codename.

- [ ] **Step 2: Bump the five ungated locations**

★★ No gate checks any of these, and they have silently drifted for eleven releases before. Bump them in the SAME commit:

```bash
grep -n '"version"' package.json
grep -n '"version"' package-lock.json | head -3   # TWO occurrences: root and packages[""]
grep -n 'shields' README.md | head -3             # version AND codename
grep -rn 'Generated:' docs/CODEMAPS/*.md          # five headers
```

- [ ] **Step 3: Add the CHANGELOG entry**

Say what a user gets: per-row controls on Documents, Insights (panel and dashboard card), History and Budget now announce distinctly, so screen-reader and speech-input users can tell rows apart. **No `[session link removed]...` URL in `CHANGELOG.md`.**

- [ ] **Step 4: Run the full gate chain, unpiped**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run lint; echo "LINT_EXIT=$?"
npm run test:run > /tmp/rowunique-suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/rowunique-suite.log
npm run test:shuffle > /tmp/rowunique-shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/rowunique-shuffle.log
npm run size:check; echo "SIZE_EXIT=$?"
npm run dup:check; echo "DUP_EXIT=$?"
npm run docs:symbols:check; echo "SYM_EXIT=$?"
npm run docs:claims:check; echo "CLAIMS_EXIT=$?"
```

★ `test:shuffle` is the ONLY local reproduction of the `unit-tests-shuffled` gate and this branch adds and reorders many tests — run it.

★ If a property suite fails on an anti-vacuity floor (`expected N to be greater than…`), that is the known unseeded-fast-check flake recorded as §244, not your branch. Re-run once before investigating.

- [ ] **Step 5: Run the a11y gate on a fresh server**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/rowunique-axe.log 2>&1; echo "EXIT=$?"
grep -E "passed|failed" /tmp/rowunique-axe.log | tail -2
PORT=3100 npm run stop
```

★ `--workers=1` is mandatory: CI runs axe serially and local runs at CPU count, and over-subscription produces `Test timeout` failures carrying no violation text — contention, not findings.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS CHANGELOG.md
git commit -m "chore(release): <version> \"<Codename>\""
```

---

## Verification this plan does not provide

- **Nothing here proves a qualified name is pleasant to hear.** jsdom has no speech and no screen reader; the detector proves distinctness, not usability.
- **History is Turso-gated and no e2e seed reaches it**, so an eye-verify against a real Turso project is owed before release and cannot be automated from this plan.
- **The property-based sweep is deferred**, and Task 11 records exactly what was left and why.
