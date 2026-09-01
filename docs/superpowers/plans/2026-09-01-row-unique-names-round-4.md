# Row-unique names, round 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §309, §315, §305 and §324 — four surfaces where several controls compute the same accessible name, or two rows render the same visible text.

**Architecture:** Each defect is fixed by routing the control's name through the existing `buildRowTokens` / `rowLabel` pair in `src/app/row-tokens.ts`, except where the qualifying value provably cannot repeat, in which case a plain qualifier is correct and a token would be noise. Every fix is preceded by a reproduction probe, because three of the four entries are `never machine-verified`.

**Tech Stack:** React 19 + Next 16, TypeScript, vitest + @testing-library/react, the shared assertion helper `src/test/row-unique-names.ts`.

**Spec:** `docs/superpowers/specs/2026-09-01-row-unique-names-round-4-design.md`
**Branch:** `fix/row-unique-names-round-4`, at `63881809`, off `main` at `fb66aeec` (0.273.0 "Goonan").

---

## Read before Task 1

★★★ **`requireCollisionSeed` is NOT a universal upgrade, and turning it on everywhere fails this plan.** It strips the occurrence suffix with an END-ANCHORED regex, `/ \(\d+\)$/` (`src/test/row-unique-names.ts`). It therefore certifies a seed only when the fix disambiguates via `buildRowTokens`. On a surface disambiguated any OTHER way — a plain qualifier, an id suffix — the stripped names still differ and the guard THROWS **against correct code**. Each task below states explicitly whether its assertion carries the flag and why.

★★★ **The token goes LAST in every name**, for the same reason: token-first puts `(1)` mid-string, nothing strips, and the guard throws. `rowLabel(verb, token)` already does this.

★★ **`src/app/*.ts(x)` are CRLF** (`i/lf w/crlf`). The **Edit tool preserves CRLF; the Write tool RE-LINES the file to LF**, and `sed -i` re-lines it invisibly to `git diff`. Use Edit for every source change in this plan. Verify any file you touched with `git ls-files --eol <file>` — `i/lf w/crlf` is healthy, `i/lf w/lf` means you re-lined it.

★★ **Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect to a file in the session scratchpad, echo `$?` unpiped, then grep the file.

★ **Logs go in the session scratchpad**, never `/tmp` — that is shared across sessions and a peer's log has overwritten one here before.

★ **No new i18n keys anywhere in this plan.** If you find yourself editing `src/app/i18n.ts` or `src/app/i18n.de.ts`, stop — you have left the plan.

---

## File Structure

| File | Change |
|---|---|
| `src/app/projects-panel.tsx` | Modify — add an active-project token map, thread it into 3 controls |
| `src/app/projects-panel.test.tsx` | Modify — add the §309 collision test |
| `src/app/resource-workload.tsx` | Modify — name the weekly-hours button in BOTH tables |
| `src/app/resource-workload.test.tsx` | Modify — add 2 tests, drop the §276 fixture's distinct shifts |
| `src/app/version-diff-view.tsx` | Modify — render the token instead of the bare `recordLabel`, 2 sites |
| `src/app/version-diff-view.test.tsx` | Modify — add the §305 visible-text test |
| `src/app/actions-panel.tsx` | Modify — mint one token map over hero + rows, thread `rowToken` down |
| `src/app/action-row.tsx` | Modify — accept `rowToken`, set an explicit `InfoTooltip` label |
| `src/app/action-hero-card.tsx` | Modify — accept `rowToken`, set an explicit `InfoTooltip` label |
| `src/app/actions-panel.test.tsx` | Modify — add the §324 collision test |
| `docs/open-followups.md` | Modify — close 4 entries, four places each |

---

### Task 0: Establish the baseline

**Files:** none — measurement only.

- [ ] **Step 1: Confirm the branch and the tree**

```bash
cd C:/Projects/aipm-cockpit
git rev-parse --abbrev-ref HEAD    # expect: fix/row-unique-names-round-4
git status --porcelain             # expect: no output
git log --oneline -1               # expect: 63881809 docs: correct three spec claims...
```

If `git status` prints anything, STOP and report it. A dirty tree here means a peer or an earlier agent left work behind, and every measurement below would be taken against the wrong tree.

- [ ] **Step 2: Record the pre-change suite counts**

```bash
mkdir -p "$SCRATCH"
npm run test:run > "$SCRATCH/baseline.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/baseline.log"
```

Where `$SCRATCH` is this session's scratchpad directory. Expected: `EXIT=0`. Record the two counts — every later task asserts its own delta against them, and a task that changes the total by more than the tests it added has broken something silently.

★ Do NOT run two vitest processes at once anywhere in this plan. A red run carrying `Failed to start forks worker` is machine contention, not a real failure.

---

### Task 1: §309 — `projects-panel.tsx` active list

**Files:**
- Modify: `src/app/projects-panel.tsx`
- Test: `src/app/projects-panel.test.tsx`

The ARCHIVED list already routes through `buildRowTokens`; the ACTIVE list raw-interpolates `p.name` at three controls. This is a CONDITIONAL collision — it needs two active projects sharing a display name — and both lists are fed from the same registry, so the condition is reachable.

- [ ] **Step 1: Probe — prove the collision is real**

Add this test to `src/app/projects-panel.test.tsx`. It is expected to FAIL, and that failure is the reproduction §309 has never had.

```tsx
test("gives every ACTIVE row control a row-unique accessible name when two projects share a name (§309)", () => {
  const shared = [
    { id: "p1", name: "Migration", kind: "turso" as const },
    { id: "p2", name: "Migration", kind: "turso" as const },
  ];
  render(
    <ProjectsPanel
      {...baseProps}
      mode="turso"
      projects={shared}
      currentProjectId={null}
    />,
  );
  expectRowUniqueNames({ minControls: 4, requireCollisionSeed: true });
});
```

★ `currentProjectId={null}` is load-bearing: the destructive controls render on NON-current rows only, so a fixture whose row is current renders one button and the assertion covers nothing. `minControls: 4` is two rows × (Switch + Archive).

★ If `baseProps` / the `ProjectRegistryEntry` shape in this file differ from the above, adapt the fixture to the file's existing helpers rather than inventing a new one — but keep the two shared names and `currentProjectId={null}`.

Add the import if absent:

```tsx
import { expectRowUniqueNames } from "../test/row-unique-names";
```

- [ ] **Step 2: Run the probe and confirm it fails for the RIGHT reason**

```bash
npx vitest run src/app/projects-panel.test.tsx -t "§309" > "$SCRATCH/t1-probe.log" 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|requireCollisionSeed|Tests " "$SCRATCH/t1-probe.log"
```

Expected: `EXIT=1`, with a `WCAG 2.4.6: ... "Switch – Migration" x2` message.

★★★ **If it fails with `requireCollisionSeed is on, but no two of the ... rendered name(s) match`, the fixture did not seed a collision** — the two rows are not both rendering, or the names are not actually identical. Fix the FIXTURE, never the flag. If it PASSES, §309 does not reproduce: stop, and report that the entry should be closed as not-a-defect rather than fixed.

- [ ] **Step 3: Add the active-project token map**

In `src/app/projects-panel.tsx`, immediately after the existing `archivedTokens` memo, insert:

```tsx
  // ★ The ACTIVE list needs its own map (§309). Two active projects can share a
  // display name exactly as two archived ones can — both lists are fed from the
  // same registry — so the raw `p.name` qualifier these three controls used was
  // a conditional collision. `ProjectRegistryEntry.id` is a string, so
  // `useRowTokens` (constrained to `{ id: number }`) does not fit; call
  // `buildRowTokens` directly, exactly as the archived half does.
  const activeTokens = useMemo(
    () => buildRowTokens(projects.map((p) => ({ id: p.id, name: p.name }))),
    [projects],
  );
```

- [ ] **Step 4: Thread it into the three controls**

Still in `src/app/projects-panel.tsx`, replace each of the three raw interpolations. Use Edit, one at a time — they are three distinct strings, so each `old_string` is unique.

```tsx
aria-label={`${t(lang, "projectsSwitch")} – ${p.name}`}
```
becomes
```tsx
aria-label={rowLabel(t(lang, "projectsSwitch"), activeTokens.get(p.id) ?? p.name)}
```

```tsx
aria-label={`${t(lang, "projectsArchive")} – ${p.name}`}
```
becomes
```tsx
aria-label={rowLabel(t(lang, "projectsArchive"), activeTokens.get(p.id) ?? p.name)}
```

```tsx
aria-label={`${t(lang, "projectsDelete")} – ${p.name}`}
```
becomes
```tsx
aria-label={rowLabel(t(lang, "projectsDelete"), activeTokens.get(p.id) ?? p.name)}
```

★ `rowLabel` and `buildRowTokens` are already imported in this file. `useMemo` is already imported.

- [ ] **Step 5: Run the test — it must now pass**

```bash
npx vitest run src/app/projects-panel.test.tsx > "$SCRATCH/t1-green.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t1-green.log"
```

Expected: `EXIT=0`, and the file's test count is exactly one higher than before.

- [ ] **Step 6: Mutation-prove the test**

Revert ONE token — the smallest change that restores the defect. Edit the FIRST control back to `` aria-label={`${t(lang, "projectsSwitch")} – ${p.name}`} ``, then:

```bash
npx vitest run src/app/projects-panel.test.tsx > "$SCRATCH/t1-mutant.log" 2>&1; echo "MUTANT_EXIT=$?"
grep -E "WCAG 2.4.6|Tests " "$SCRATCH/t1-mutant.log"
```

Expected: `MUTANT_EXIT=1`. Record the result as `N failed / M passed`; the sum must equal the file's RUNTIME test count.

★★★ **Now revert the mutant with an inverse anchored Edit and PROVE the tree is clean.** `git checkout -- <file>` is deny-blocked in this repo. A shorter revert anchor has previously matched a different site, reported success, and left a live mutant with the suite green.

```bash
git diff --stat        # expect: only the intended files, with the intended shape
git diff src/app/projects-panel.tsx | grep -c "projectsSwitch"   # expect: 1 (the fixed line only)
```

- [ ] **Step 7: Typecheck and lint, unpiped**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/projects-panel.tsx src/app/projects-panel.test.tsx; echo "LINT_EXIT=$?"
git ls-files --eol src/app/projects-panel.tsx    # expect: i/lf w/crlf
```

Expected: `TSC_EXIT=0`, `LINT_EXIT=0`. ★ `tsc` exits **2** on diagnostics, not 1.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/projects-panel.tsx src/app/projects-panel.test.tsx -m "fix: give projects-panel's ACTIVE rows row-unique control names (309)

The archived list was converted to buildRowTokens; the active list still
interpolated the raw project name into three control labels, so two active
projects sharing a display name gave Switch/Archive/Delete identical
accessible names. Both lists are fed from the same registry, so the condition
is reachable rather than theoretical.

The file now carries ONE naming convention, which is the durable win.

Pinned by a test seeding two active projects with the same name, with
requireCollisionSeed on so a fixture that seeds no collision fails loudly
instead of reading as coverage. Mutation-proved against the one-token revert
of the Switch label."
```

---

### Task 2: §315 — the weekly-hours button, BOTH tables

**Files:**
- Modify: `src/app/resource-workload.tsx`
- Test: `src/app/resource-workload.test.tsx`

The row's `weeklyHours` value is the CONTENT of its own `<button>` at two sites. Its `title` is the accessible DESCRIPTION and does not name it.

★★★ **THE TWO TABLES TAKE DIFFERENT FIXES, and applying one to both is wrong in each direction.** Managed rows are keyed by numeric resource id and their `display` CAN repeat — so the managed half needs the TOKEN. Unlinked rows are keyed on `display.toLowerCase()`, so an unlinked `display` CANNOT repeat — the unlinked half needs a PLAIN QUALIFIER, and the file already states this reasoning twice in its own comments for the §276 fix. Using a token where the value cannot repeat adds an occurrence index that can never fire; using a qualifier where it can repeat leaves the collision live.

- [ ] **Step 1: Probe both tables**

Add to `src/app/resource-workload.test.tsx`:

```tsx
test("gives the MANAGED weekly-hours buttons row-unique names when two people share a name and hours (§315)", () => {
  render(<ResourceWorkload {...baseProps} resources={[
    { ...resourceFixture, id: 1, name: "Alex Kim" },
    { ...resourceFixture, id: 2, name: "Alex Kim" },
  ]} />);
  expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
});

test("gives the UNLINKED weekly-hours buttons distinct names when two people work equal hours (§315)", () => {
  render(<ResourceWorkload {...baseProps} /* seed two unlinked rows, equal hours, distinct names */ />);
  expectRowUniqueNames({ minControls: 2 });
});
```

★★★ **The unlinked test deliberately omits `requireCollisionSeed`, and that is not laziness.** Two unlinked rows cannot share a `display` — the list is keyed on it — so after the fix their names are `40 – Alex` and `40 – Sam`, nothing collides once the suffix is stripped, and the flag would THROW against correct code. Its anti-vacuity guarantee comes from Step 5's mutation proof instead. Write that reason into the test as a comment; without it the next reader "completes the pattern" and turns the suite red.

★ Build both fixtures from the file's EXISTING helpers and seeding conventions. Read how the §276 tests in this file construct managed and unlinked rows and follow that exactly — the shapes above name the required properties, not a new fixture format.

- [ ] **Step 2: Run the probes**

```bash
npx vitest run src/app/resource-workload.test.tsx -t "§315" > "$SCRATCH/t2-probe.log" 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|requireCollisionSeed|Tests " "$SCRATCH/t2-probe.log"
```

Expected: `EXIT=1`, both tests failing with `WCAG 2.4.6: ... "40" x2`.

- [ ] **Step 3: Fix the MANAGED button (token)**

In `src/app/resource-workload.tsx`, the managed table's button already sits in a scope where `const rowToken = rowTokens.get(row.resource.id) ?? row.display;` is defined. Add to that `<button>`:

```tsx
                  aria-label={rowLabel(String(row.weeklyHours), rowToken)}
```

- [ ] **Step 4: Fix the UNLINKED button (plain qualifier)**

On the unlinked table's `<button>`, add:

```tsx
                      // A plain `row.display` qualifier, NOT a token: unlinked
                      // rows are keyed on `display.toLowerCase()`, so the value
                      // cannot repeat here. Same reasoning as the
                      // `resourcesAddAsResource` control above (§276).
                      aria-label={rowLabel(String(row.weeklyHours), row.display)}
```

★ The hours value LEADS in both, so the button's visible text is contained in its accessible name and WCAG 2.5.3 holds with front-position for free. The `title` keeps carrying the verb.

- [ ] **Step 5: Run, then mutation-prove BOTH**

```bash
npx vitest run src/app/resource-workload.test.tsx > "$SCRATCH/t2-green.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t2-green.log"
```

Expected `EXIT=0`. Then mutate the MANAGED `aria-label` away (delete the whole attribute), re-run, expect `EXIT=1`; restore by anchored Edit. Then do the same for the UNLINKED one — this second mutant is the ONLY anti-vacuity evidence that test has, so it is not optional. Record both as `N failed / M passed`.

- [ ] **Step 6: Drop the §276 fixture's distinct shifts**

`resource-workload.test.tsx`'s §276 test gives its two unlinked people distinct part-time shifts (32h / 24h) purely so the hours buttons differ, with a ★★★ comment saying to drop them once §315 closes. Set both to the same weekly hours and delete that ★★★ comment.

```bash
npx vitest run src/app/resource-workload.test.tsx > "$SCRATCH/t2-knockon.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0`. ★★ If the §276 test now fails, the §315 fix is incomplete — do NOT restore the distinct shifts to get green. That would leave the fixture quietly weakened, which is what the ★★★ comment exists to prevent.

- [ ] **Step 7: Typecheck, lint, line endings**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/resource-workload.tsx src/app/resource-workload.test.tsx; echo "LINT_EXIT=$?"
git ls-files --eol src/app/resource-workload.tsx    # expect: i/lf w/crlf
```

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/resource-workload.tsx src/app/resource-workload.test.tsx -m "fix: name the weekly-hours buttons in both workload tables (315)

The button's accessible name was its own content, the contracted hours number,
so a team on a standard 40-hour week gave N buttons all named 40. Both tables
render it; the managed one is the main planning grid and was the worse of the
two.

The two halves take different fixes on purpose. Managed rows can share a
display name, so that half rides the existing row token. Unlinked rows are
keyed on display.toLowerCase() and cannot, so that half takes a plain
qualifier - the same split the 276 fix already reasoned through in this file.

The hours value leads in both, so the visible text is contained in the
accessible name and 2.5.3 holds with front-position for free.

The 276 fixture's distinct 32h/24h shifts are dropped, as the comment at that
fixture instructed once this closed; equal hours are now safe because the
buttons carry row identity."
```

---

### Task 3: §305 — version-diff rows render identical visible text

**Files:**
- Modify: `src/app/version-diff-view.tsx`
- Test: `src/app/version-diff-view.test.tsx`

- [ ] **Step 1: Probe — a VISIBLE-text assertion, not a name assertion**

★★★ **Do NOT write an `expectRowUniqueNames` test here.** This file's `aria-label`s already route through `rowLabel` with the token, so accessible names are unique BEFORE the fix. A name-uniqueness assertion passes against the unfixed code — false coverage, which reads as protection and stops the next audit.

Add to `src/app/version-diff-view.test.tsx`:

```tsx
test("renders two visually distinct rows when two records share a recordLabel (§305)", () => {
  const { container } = render(
    <VersionDiffView {...baseProps} diff={diffWithTwoChangesSharing("Design review")} />,
  );
  const shown = [...container.querySelectorAll("span.text-foreground")]
    .map((el) => el.textContent?.trim())
    .filter((s): s is string => s === "Design review" || /^Design review \(\d+\)$/.test(s));
  expect(shown.length).toBeGreaterThanOrEqual(2);
  expect(new Set(shown).size).toBe(shown.length);
});
```

★ `diffWithTwoChangesSharing` is a fixture you write from this file's existing diff builders — two changes whose `recordLabel` is the same string. Follow the file's existing fixture conventions.

- [ ] **Step 2: Run the probe**

```bash
npx vitest run src/app/version-diff-view.test.tsx -t "§305" > "$SCRATCH/t3-probe.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=1` — two spans both reading `Design review`, so the Set is smaller than the array.

- [ ] **Step 3: Render the token in both layouts**

`src/app/version-diff-view.tsx` renders `<span className="text-foreground">{c.recordLabel}</span>` in TWO places, one per layout. Both become:

```tsx
<span className="text-foreground">{tokens.get(k) ?? c.recordLabel}</span>
```

★★ **Both sites, and they are byte-identical strings** — an Edit without `replace_all` will refuse as ambiguous, which is the tool protecting you. Use `replace_all: true`, then confirm the count:

```bash
grep -c "tokens.get(k) ?? c.recordLabel}</span>" src/app/version-diff-view.tsx   # expect: 2
```

★ `tokens` and `k` are already in scope at both sites — the surrounding `aria-label`s use exactly `tokens.get(k) ?? c.recordLabel` already.

- [ ] **Step 4: Run, then mutation-prove**

```bash
npx vitest run src/app/version-diff-view.test.tsx > "$SCRATCH/t3-green.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0`. Mutate ONE of the two spans back to `{c.recordLabel}`, re-run, expect `EXIT=1`, restore by anchored Edit, prove `git diff --stat` shows only the intended shape.

★★ Mutating only ONE span is the point: it proves the test covers the layout you mutated. Repeat for the other span, so both layouts are proved rather than one covering for the other.

- [ ] **Step 5: Adjudicate any OTHER test this turns red**

This changes VISIBLE text, so tests asserting on a bare `recordLabel` may fail.

```bash
npx vitest run src/app/version-diff-view.test.tsx src/app/version-diff.test.ts > "$SCRATCH/t3-all.log" 2>&1; echo "EXIT=$?"
```

★★★ **Read each failure and decide. Do NOT blanket-update assertions to green.** A test asserting `getByText("Design review")` on a fixture with NO collision is still correct and must still pass — the token is the bare name when it does not collide. A failure there means the fix is wrong, not the test.

- [ ] **Step 6: Typecheck, lint, line endings, commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/version-diff-view.tsx src/app/version-diff-view.test.tsx; echo "LINT_EXIT=$?"
git ls-files --eol src/app/version-diff-view.tsx    # expect: i/lf w/crlf
git commit --only src/app/version-diff-view.tsx src/app/version-diff-view.test.tsx -m "fix: disambiguate version-diff rows visually, not only for AT (305)

Both layouts rendered the bare recordLabel while the occurrence-numbered token
reached only the aria-label, so two records sharing a nameField value rendered
two visually identical rows: a screen-reader user heard (1) and (2), a sighted
user got nothing. Naming a slice by a real field is what made rows collidable
at all - the id fallback had been unique by construction.

Rendering the token makes the visible text and the accessible name identical.
Unique rows are untouched, because buildRowTokens uses the bare name when it
does not collide.

The test asserts on RENDERED TEXT rather than on accessible names. The names
were already unique here, so a name-uniqueness assertion would have passed
against the unfixed code and read as coverage."
```

---

### Task 4: §324 — `actionScoreTooltip` on both Next-actions surfaces

**Files:**
- Modify: `src/app/actions-panel.tsx`, `src/app/action-row.tsx`, `src/app/action-hero-card.tsx`
- Test: `src/app/actions-panel.test.tsx`

Both surfaces mount `<InfoTooltip text={t(lang, "actionScoreTooltip", action.score)} />` with no `label`, and `InfoTooltip` falls back to `aria-label={label ?? text}`. Interpolating the score proves the names differ when scores differ and proves nothing when they repeat.

★★ **The hero and the rows are ONE naming population.** The hero is the first group, de-duped from its tier list. Mint ONE map in the panel. ★★★ The reason is NOT "two maps would each number from 1" — that is FALSE and was measured false by mutant: `buildRowTokens` numbers only a name that repeats INSIDE the map it was handed, so two single-member maps both emit a **BARE** token, never `(1)`. The real reason is CROSS-TIER: per-tier maps give a `now` row and a `soon` row sharing a title two bare names. See the long-form argument at `src/app/actions-panel.tsx`'s `actionTokens` memo.

- [ ] **Step 1: Probe**

Add to `src/app/actions-panel.test.tsx` a fixture with two actions sharing a TITLE and tied on SCORE, with `expertMode` on (the tooltip is `expertMode`-gated, so a fixture without it renders no tooltip at all and the test covers nothing):

```tsx
test("gives the score tooltips row-unique names when two actions share a title and score (§324)", () => {
  render(<ActionsPanel {...baseProps} expertMode actions={twoActionsSharingTitleAndScore()} />);
  expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: true });
});
```

★ `InfoTooltip`'s trigger is a `<span role="button">`, so it is picked up by the default `["button"]` roles list.

- [ ] **Step 2: Run the probe**

```bash
npx vitest run src/app/actions-panel.test.tsx -t "§324" > "$SCRATCH/t4-probe.log" 2>&1; echo "EXIT=$?"
grep -E "WCAG 2.4.6|requireCollisionSeed|Tests " "$SCRATCH/t4-probe.log"
```

Expected `EXIT=1` with `"Score: 7" x2` or similar.

- [ ] **Step 3: Mint the token map in `actions-panel.tsx`**

Build it over the SAME set the panel renders — the hero group plus every group in the rendered tier lists — keyed by `g.key`, named by the translated title:

```tsx
  // ★★ ONE map over hero + rows, because they are one naming population: the
  // hero is groups[0] de-duped from its tier list, so two maps would number
  // each from 1 and reintroduce the hero-vs-row collision (§324).
  // ★ An action title is FREE TEXT built from title.key + params, so it can
  // repeat; the rule is that free text always needs a token, and a plain
  // qualifier is only enough for a value that cannot repeat.
  const actionTokens = useMemo(
    () => buildRowTokens(renderedGroups.map((g) => ({
      id: g.key,
      name: t(lang, g.primary.title.key, ...(g.primary.title.params ?? [])),
    }))),
    [renderedGroups, lang],
  );
```

★ `renderedGroups` is the concatenation of the hero group (when shown) and the groups each tier list renders, in render order. Derive it from the values already computed in this component; do not recompute the grouping.

Add the import: `import { buildRowTokens, rowLabel } from "./row-tokens";`

- [ ] **Step 4: Thread the token into both components**

`src/app/actions-panel.tsx`, at the two render sites:

```tsx
<ActionRow key={g.key} action={g.primary} extraReasons={g.extra} {...rowProps} rowToken={actionTokens.get(g.key) ?? ""} />
```
```tsx
{hero && <ActionHeroCard group={hero} {...rowProps} rowToken={actionTokens.get(hero.key) ?? ""} />}
```

★ `rowToken` is passed per-instance, NOT folded into the shared `rowProps` spread — `rowProps` is by definition the props that are identical for every row, and this one is not.
★★ **Write the spread FIRST and `rowToken` LAST.** An earlier revision of this plan showed the opposite order, which JSX resolves the same way today but which lets a future fold of `rowToken` into `rowProps` silently override every per-instance token with one shared value — reintroducing the exact collision, with the suite green.

`src/app/action-row.tsx`:

```tsx
interface ActionRowProps extends ActionHandlers {
  lang: Lang;
  action: SuggestedAction;
  extraReasons?: readonly SuggestedAction[];
  expertMode?: boolean;
  /** Occurrence-qualified row name from the panel. A per-item component cannot
   *  disambiguate itself — it has no sibling visibility — so the map is built
   *  by whoever renders the list and threaded down (§324). */
  rowToken: string;
}
```

Destructure `rowToken` alongside the rest, and change the tooltip to:

```tsx
<InfoTooltip
  text={t(lang, "actionScoreTooltip", action.score)}
  label={rowLabel(t(lang, "actionScoreTooltip", action.score), rowToken)}
/>
```

`src/app/action-hero-card.tsx`: add the identical `rowToken: string` prop with the same docstring, destructure it, and apply the identical `label`.

★★★ **The token goes LAST.** `rowLabel` puts it there. A token-first label would put `(1)` mid-string, and `requireCollisionSeed`'s end-anchored regex would then throw against your CORRECT code in Step 5.

Add `import { rowLabel } from "./row-tokens";` to both components.

- [ ] **Step 5: Run, then mutation-prove**

```bash
npx vitest run src/app/actions-panel.test.tsx > "$SCRATCH/t4-green.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0`. Mutate `action-row.tsx`'s `label` prop away entirely (back to a bare `<InfoTooltip text={...} />`), re-run, expect `EXIT=1`. Restore by anchored Edit. Then do the same for `action-hero-card.tsx` — if the hero's mutant does NOT turn the suite red, the fixture is not rendering a hero and the hero-vs-row half of §324 is unpinned; fix the fixture.

- [ ] **Step 6: Typecheck, lint, line endings, commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/actions-panel.tsx src/app/action-row.tsx src/app/action-hero-card.tsx src/app/actions-panel.test.tsx; echo "LINT_EXIT=$?"
for f in actions-panel action-row action-hero-card; do git ls-files --eol src/app/$f.tsx; done   # expect: i/lf w/crlf
git commit --only src/app/actions-panel.tsx src/app/action-row.tsx src/app/action-hero-card.tsx src/app/actions-panel.test.tsx -m "fix: give the Next-actions score tooltips row-unique names (324)

Both surfaces mounted the score InfoTooltip bare, and InfoTooltip falls back to
its text for the trigger's accessible name. Interpolating the score proves the
names differ when the scores differ and proves nothing when they repeat, which
is the entire premise of this defect class - two actions tying on score is
ordinary.

The panel now mints one token map over the rendered population and threads it
into both components. One map, not two — but NOT because "per-component maps
would number each from 1", which is false: a single-member map emits a BARE
token. The reason is cross-tier, and it is argued in full at `actions-panel.tsx`'s
`actionTokens` memo. A per-item component cannot disambiguate itself, so the map
is built by the list owner.

A raw title qualifier was rejected. A title is free text and can repeat, so it
would have left two actions sharing a title and a score still colliding, and
with no occurrence suffix to strip the fix could not have been pinned by the
only harness that can see this class."
```

---

### Task 5: Close the four register entries

**Files:** Modify `docs/open-followups.md`

★★★ **FOUR PLACES IS A FLOOR, NOT THE COUNT.** The four that are always needed: the heading marker · the summary-table STATUS cell · the summary-table ANCHOR (derived from the heading, so it changes when the heading does) · the `**Status:**` witness line. `isClosed` reads the TITLE only. ★★★ Measured on this branch: §305 took SIX places and §324 FIVE — the extras are cross-reference ANCHORS inside OTHER entries' bodies, plus body claims elsewhere in the register that the fix has now falsified. **Grep the number across the whole register and read every hit**, including other entries' prose. No doc gate sees any of this: all of them pass over a body describing pre-fix code in the present tense.

★ A body line MAY contain the word CLOSED — an earlier revision of this plan forbade it, which was invented. `isClosed(title)` reads the title alone, and 113 of the 150 closed entries put CLOSED in a body line. All four Status lines this branch writes begin `**Status:** CLOSED …`.

★★ `docs/open-followups.md` is **LF**. Do not let any tool re-line it.

- [ ] **Step 1: Close each of §309, §315, §305, §324**

For each: append ` — CLOSED 2026-09-01` to the heading, update the anchor and STATUS cell in the summary table to match the new heading, and rewrite the `**Status:**` line to state what was done and name the test that pins it.

★★★ **State per-site what is pinned, and by what.** §315's two halves are pinned by DIFFERENT test shapes — the managed half by a `requireCollisionSeed` assertion, the unlinked half by a mutation proof alone, because the flag would throw there. A Status line saying "pinned by a collision test" would be false for the unlinked half, and a false coverage claim reads as protection and stops the next audit.

- [ ] **Step 2: Verify the register is structurally intact**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');let b=0;for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c<9||(c>10&&c<32)||c===127)b++;}console.log('control:',b,'CR:',(s.match(/\r/g)||[]).length);"
```

★ Two U+0008 control bytes are PRE-EXISTING and owned (recorded in the roadmap). Expect `control: 2`, `CR: 0`. If control rises above 2 you introduced one — repair by code point, do not retype the line.

★★★ **Do NOT run the register's own index-rebuild recipe.** It claims idempotence and is not: it derives the State cell from the heading alone and silently destroys hand-written parentheticals. It wiped four rows once and the diff looked clean. This is §319.

- [ ] **Step 3: Run the doc gates, unpiped**

```bash
npm run followups:status:check > "$SCRATCH/t5-status.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SCRATCH/t5-claims.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$SCRATCH/t5-symbols.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0` for all three. ★★ `followups:status:check` and `version:check` each have TWO failure codes: **1 is DRIFT** (fix the content), **2 is the gate unable to scan at all** — opposite responses.

- [ ] **Step 4: Commit**

```bash
git commit --only docs/open-followups.md -m "docs: close 309, 315, 305 and 324

Four-place closure each: heading, summary-table status cell, summary-table
anchor, and the Status witness.

315's Status records the two halves separately, because they are pinned by
different test shapes - the managed half by a collision-seeded assertion, the
unlinked half by a mutation proof alone, since requireCollisionSeed throws
against correct code on a surface disambiguated by a plain qualifier. One
sentence covering both would be false for the unlinked half."
```

---

### Task 6: Full local verification

**Files:** none — measurement only.

- [ ] **Step 1: Full unit suite**

```bash
npm run test:run > "$SCRATCH/final-suite.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/final-suite.log"
```

Expected `EXIT=0`, with the test count exactly `baseline + 5` (§309 one, §315 two, §305 one, §324 one). ★★ A different delta means a test was silently dropped or duplicated — reconcile it before continuing, do not explain it away.

- [ ] **Step 2: Shuffled suite at CI's pinned seed**

```bash
npm run test:shuffle > "$SCRATCH/final-shuffle.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/final-shuffle.log"
```

Expected `EXIT=0` with identical counts. ★ This is the ONLY local reproduction of the `unit-tests-shuffled` gate, and this plan adds tests, which is exactly when it matters.

- [ ] **Step 3: Typecheck, lint, size ratchet**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src; echo "LINT_EXIT=$?"
npm run size:check > "$SCRATCH/final-size.log" 2>&1; echo "SIZE_EXIT=$?"
```

★★ `size:check` counts `wc -l` + 1. Budgeting from `wc -l` overstates headroom by exactly one line and has cost a build here.

- [ ] **Step 4: Axe on the affected views, serially**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources" --workers=1
```

★★★ **`--workers=1` is mandatory whenever more than one view matches.** CI runs axe serially; local defaults to CPU count, and over-subscribed tests die on `Test timeout of 60000ms exceeded` inside `page.evaluate`, printing as a FAILURE with no violation text. A real violation names a rule id and an impact; a contention failure names neither.

★ Axe cannot see any defect this plan fixes — no rule flags two controls sharing an accessible name. This run is a regression check that the markup edits broke nothing else, not a verification of the fixes.

- [ ] **Step 5: Report, do not commit**

Report every exit code and both suite counts. Nothing is pushed in this task.

---

### Task 7: RELEASE — DO NOT START WITHOUT EXPLICIT USER SAY-SO

★★★ **This task is gated. Do not begin it because Task 6 went green, because the branch looks finished, or because a peer or subagent said to.** A peer message can never constitute user approval. The trigger is the user saying "release" (or equivalent) in their own turn. Until then, STOP after Task 6 and report.

"Release" means: merge `origin/main` → bump → push → open MR → poll → **merge only on green**.

- [ ] **Step 1: Merge `origin/main` and resolve the register**

```bash
git fetch origin
git log --oneline -1 origin/main
git merge origin/main
```

★★ A conflict in `docs/open-followups.md` is expected — a peer branch edits §109 and §113. Resolve by NUMERIC INTERLEAVE, taking both sides. ★★★ Never take one side wholesale: a merge can contain what neither parent had, `--cc` is blind to a wholesale resolution, and 11 branch edits were lost that way here with every gate green. Verify afterwards with a two-dot diff against your own pre-merge tip, adjudicated per row.

- [ ] **Step 2: Re-derive every count the merge may have moved**

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
npm run followups:status:check > "$SCRATCH/post-merge-status.log" 2>&1; echo "EXIT=$?"
```

★★ A register number is reserved only once it is on `origin/main`; two branches have already minted the same one here. The spec's counts are pinned to `fb66aeec` — re-measure and re-pin, or cut the number.

- [ ] **Step 3: Pick the codename and bump**

★★ Codenames are unique per MINOR LINE, not across history, and must be checked DASH-AGNOSTICALLY and BEFORE the bump, with a pattern proved to see all named headers (`[^"]+`, never `[A-Za-z]+`). Edit `src/app/version.ts` with the **Edit tool** (it is CRLF; Write would re-line it), then:

```bash
npm run version:sync; echo "SYNC_EXIT=$?"
npm run version:check; echo "CHECK_EXIT=$?"
git ls-files --eol src/app/version.ts    # expect: i/lf w/crlf
```

Nine sites carry the version; `version:sync` propagates them. ★★ `version:check` exit **1 is drift**, **2 is the gate unable to scan**.

- [ ] **Step 4: CHANGELOG**

Add a `## [<version>] - <date> "<Codename>"` entry with user-facing `### Fixed` bullets — what a user notices, not what the code does.

★★★ **NEVER put a `[session link removed]...` URL in `CHANGELOG.md` or in the MR description.** Commit trailers and MR comments are explicitly exempt. Verify with a grep returning 0 before committing.

- [ ] **Step 5: Commit, push, open the MR**

```bash
git commit --only <exact paths> -m "chore: release <version> \"<Codename>\""
git push -u origin fix/row-unique-names-round-4
glab mr create --fill --yes
```

★★ Never a blind `git commit -a` or `--amend` — this worktree is shared, and `--amend` has swallowed a stranger's commit twice here. The `--stat` file count is the only tell.

- [ ] **Step 6: Poll the pipeline, then merge ONLY on green**

```bash
glab ci get --pipeline-id <id>
```

★★★ **`glab mr merge` DEFAULTS `--auto-merge=true`, so omitting the flag is NOT opting out.** Pass it explicitly, and only after the pipeline is green:

```bash
glab mr merge <n> --auto-merge=false --yes
git fetch origin && git merge-base --is-ancestor HEAD origin/main; echo "ANCESTOR_EXIT=$?"
```

Expected `ANCESTOR_EXIT=0`. If the pipeline is RED, report the failing jobs and do NOT merge.

---

## Self-review

**Spec coverage.** §309 → Task 1. §315 (both tables + the fixture knock-on) → Task 2. §305 → Task 3. §324 → Task 4. Register closures → Task 5. Gate suite → Task 6. Release, separately gated → Task 7. The spec's "reproduction probes come first" is Step 1 of Tasks 1–4, each with an explicit not-a-defect exit. The spec's zero-new-i18n-keys constraint is stated in the preamble and holds — no task edits either dictionary.

**Placeholder scan.** No TBD/TODO. Three fixtures (`baseProps` extensions, `diffWithTwoChangesSharing`, `twoActionsSharingTitleAndScore`) are specified by their required PROPERTIES and pointed at the file's existing conventions rather than invented, because inventing a fixture format that conflicts with the file's own helpers would be worse than naming the constraint. `renderedGroups` in Task 4 Step 3 is likewise specified by what it must contain.

**Type consistency.** `rowToken: string` is the prop name in Task 4 Steps 4 for both components and in both render sites. `activeTokens` (Task 1), `rowTokens` (existing, Task 2), `tokens` (existing, Task 3) and `actionTokens` (Task 4) are distinct names in distinct files. `rowLabel(verb, token)` is used with the token LAST at every call site in every task.
