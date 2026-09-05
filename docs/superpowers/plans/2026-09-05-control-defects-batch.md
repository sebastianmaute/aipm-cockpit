# Control-Defects Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six independent, user-visible control defects — hidden Turso buttons, a clipping icon, wrapping row badges, an inert asset name, an unsearchable attach-to select, and a document body that cannot be collapsed.

**Architecture:** Six unrelated surfaces, each changed in isolation. Nothing new is persisted and no backend write path is touched. One new presentational component (`single-entity-picker.tsx`) reuses the existing pure filter engine rather than the multi-select picker it sits beside. Work is ordered so every string-free item lands first, then a single i18n commit, then the three items that depend on it.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, vitest + React Testing Library, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-09-05-control-defects-batch-design.md`

**Branch:** `feat/control-defects-batch`, based at `497cea6e` = `origin/main` (`2eeb68f8`, 0.285.0 "Barnhill") + the spec commit.

**NO release and NO version bump in this plan.** The slice ships separately, on explicit say.

---

## Before you start — read this section in full

### Line endings

Every file under `src/app/` is **CRLF in the working tree and LF in the index** (`git ls-files --eol src/app/i18n.ts` prints `i/lf  w/crlf`). Consequences:

- Use the **Edit tool** for `src/**` changes. It preserves line endings.
- **Never** use the Write tool on an existing `src/**` file — it re-lines the whole file to LF. `core.autocrlf=true` cleans that back to the same blob, so `git diff` shows nothing wrong while every later `\n`-anchored edit silently no-ops.
- **Never** use `sed -i` on `src/**`, same reason.
- A brand-new file may be written with the Write tool; git normalises it on commit.
- `docs/**` is LF. The Write tool is correct there.

### `src/app/i18n.de.ts` is special

Do **not** touch it with the Edit tool — it corrupts umlauts and curls double quotes. Patch it with an anchored Node UTF-8 write whose anchors match `\r\n`, using real umlauts. Task 6 gives the exact script.

### Gates — never read an exit code through a pipe

`npm run test:run | tail -8` exits **0 while tests fail**, because that is `tail`'s status. Redirect, check the code unpiped, then grep the file. Set a scratch variable once per session:

```bash
SCRATCH="$CLAUDE_SCRATCHPAD"   # the session scratchpad directory; NEVER /tmp — it is shared across sessions
mkdir -p "$SCRATCH"
```

Standard gate block, used verbatim throughout this plan:

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"          # 0 = clean. It exits 2 on diagnostics, not 1.
npx eslint --max-warnings=0 <files>; echo "LINT_EXIT=$?"
npx vitest run <files> > "$SCRATCH/<unique>.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/<unique>.log"
```

Give every log a **unique** basename. Never run two vitest processes at once.

### Mutation-proving a guard

Several tasks below say "mutation-prove". That means:

1. Apply the named one-token mutation with the Edit tool.
2. Re-run the test file, redirected, and read **which cases fail** — record `N failed / M passed`. The sum must equal that file's runtime test count (given per file below). A sum that does not match means the mutant did not land or the run aborted early.
3. Revert by an **inverse anchored Edit**, asserting the anchor is unique in both directions.
4. End on `git diff --stat` showing nothing.

`git checkout -- <file>` is **deny-blocked** here. Do not plan around it.

Runtime test counts as of `2eeb68f8` (measured; `it.each` blocks expanded):

| file | wc -l | runtime tests |
|---|---|---|
| `src/app/projects-panel.test.tsx` | 421 | 22 |
| `src/app/task-row.test.tsx` | 1636 | 61 |
| `src/app/task-raid-badge.test.tsx` | 90 | 3 |
| `src/app/asset-library.test.tsx` | 532 | 32 |
| `src/app/knowledge-panel.test.tsx` | 398 | 24 |
| `src/app/documents-panel.test.tsx` | 2522 | 103 |
| `src/app/documents-list.test.tsx` | 75 | 4 |

### Committing

```bash
git commit --only <paths> -F - <<'MSGEOF'
<subject>

<body>

Claude-Session: https://[session link removed]
MSGEOF
```

- A **new untracked file** needs `git add <path>` first, then `git commit --only <path>`.
- **Never** `git add -A` or `git add .`.
- **Never** stage `sample-workspace-huge.json` (a foreign concurrent writer modifies it) or `not-in-use.env.local.bak` (untracked, not gitignored, holds live Turso credentials).
- After committing, verify the message survived: `git log -1 --format='%s'` must start with the type and carry no leading `@`; `git log -1 --format='%b' | tail -3` must end on the trailer.

### A peer session shares this worktree

Another session is writing `src/app/inline-ai-edit/*`, `entity-descriptor.ts`, `link-titles.ts`, `use-inline-entity-edit.ts`, `chat-proposal-block.tsx`, `chat-proposal-describe.ts`, `insights/recommendation-review-modal.tsx`, `inline-ai-edit-popover.tsx`, and **`i18n.ts` / `i18n.de.ts`**.

- End **every** task on `git diff HEAD` showing only your intended change. A green test run is not evidence of a clean tree.
- Task 6 (i18n) is **blocked** until the peer's branch is clear. Confirm before starting it.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/task-row.tsx` | Task table row. Owns the leading icon cell's padding and the inline changes badge. | 1, 2 |
| `src/app/task-raid-badge.tsx` | The RAID reference badge. Owns its own WCAG 2.5.3 name chain. | 2, 7 |
| `src/app/document-badge.tsx` | The linked-documents badge. | 2 |
| `src/app/task-jira-badge.tsx` | The Jira key badge. | 2 |
| `src/app/documents-panel.tsx` | Documents orchestrator. Owns selection and the new collapse state. | 3 |
| `src/app/documents-list.tsx` | Documents table. Owns the title button and its `aria-expanded`. | 3 |
| `src/app/asset-library.tsx` | Asset table. Owns the row name and the preview trigger. | 4 |
| `src/app/single-entity-picker.tsx` | **NEW.** Presentational single-select combobox. i18n-free; caller owns query state and filtering. | 5 |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | EN/DE dictionaries. Three new key pairs. | 6 |
| `src/app/projects-panel.tsx` | Projects tab. Owns the Turso button gating. | 8 |
| `src/app/knowledge-panel.tsx` | Knowledge panel. Owns `targetKey` and the filtering that feeds the new picker. | 9 |
| `docs/open-followups.md` | The follow-up register. | 10 |

`single-entity-picker.tsx` is deliberately a `.tsx`. `vitest.config.ts` excludes `"src/app/**/*.tsx"` from coverage as a **blanket glob**, so a new `.tsx` needs no config entry; a pure `.ts` would be coverage-gated and would move the floors.

**Ordering rationale:** Tasks 1-5 need no new strings and are unblocked. Task 6 is the single i18n commit and is blocked on the peer. Tasks 7-9 depend on Task 6. This keeps a blocked i18n file from stalling five sixths of the slice, and it puts each of the three load-bearing traps in its own commit.

---

## Task 1: Leading icon cell padding

The "Ask Claude" sparkles icon clips and is pushed left into the checkbox. `Td` is private to `task-row.tsx` and resolves `padding="normal"` (the default) to `px-4` and `padding="tight"` to `px-1`. The leading cell is `w-7` — 28px — carrying 32px of horizontal padding.

**Files:**
- Modify: `src/app/task-row.tsx` (the `<Td className="w-7">` opening the row body)
- Test: `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/task-row.test.tsx`, inside the existing top-level `describe`:

```tsx
test("gives the leading Ask-Claude cell tight padding so the icon cannot clip", () => {
  // The cell is `w-7` (28px). At the default `padding="normal"` it carries
  // `px-4` — 32px — which is wider than the cell itself, so the icon clips and
  // is pushed left over the checkbox cell. jsdom has no layout, so the class is
  // the only observable; the visual result is covered by the eye-verify.
  const { container } = render(
    <table><tbody>
      <TaskRow {...rowProps({ task: makeTask({ id: 1, taskName: "Alpha" }) })} />
    </tbody></table>,
  );
  const leading = container.querySelector("td")!;
  expect(leading.className).toContain("w-7");
  expect(leading.className).toContain("px-1");
  expect(leading.className).not.toContain("px-4");
});
```

`rowProps` is this file's existing prop-builder helper. Open `src/app/task-row.test.tsx` and reuse whatever the neighbouring `TaskRow` tests use to build props — do not invent a new helper, and do not assume the name: **grep it first** (`grep -n "TaskRow {\.\.\." src/app/task-row.test.tsx | head -3`) and copy the surrounding call shape verbatim.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/task-row.test.tsx -t "tight padding" > "$SCRATCH/t1-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |AssertionError" "$SCRATCH/t1-red.log"
```

Expected: `VITEST_EXIT=1`, and the failure names `px-1` as expected but not received.

- [ ] **Step 3: Make it pass**

In `src/app/task-row.tsx`, change the leading cell's opening tag:

```tsx
      <Td className="w-7" padding="tight">
```

Nothing else in that cell changes.

- [ ] **Step 4: Run the whole file**

```bash
npx vitest run src/app/task-row.test.tsx > "$SCRATCH/t1-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t1-green.log"
```

Expected: `VITEST_EXIT=0` and `Tests  62 passed` (61 existing + 1 new).

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/task-row.tsx src/app/task-row.test.tsx; echo "LINT_EXIT=$?"
```

Expected: `TSC_EXIT=0`, `LINT_EXIT=0`.

- [ ] **Step 6: Confirm the tree holds only your change**

```bash
git diff HEAD --stat
```

Expected: exactly `src/app/task-row.tsx` and `src/app/task-row.test.tsx`. If anything else appears, it is the peer's — do not stage it.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/task-row.tsx src/app/task-row.test.tsx -F - <<'MSGEOF'
fix(a11y): stop the Ask Claude icon clipping out of its 28px cell

The leading cell is `w-7` (28px) and carried the default `padding="normal"`,
which is `px-4` — 32px, wider than the cell. The sparkles glyph clipped and
was pushed left over the checkbox beside it.

jsdom has no layout, so the new test asserts the class rather than the
geometry; the visual result is owed to the eye-verify.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 2: No badge may wrap in the ID column

All four badges render inside the narrow, user-resizable ID column. None carries `whitespace-nowrap`, so the RAID glyph string breaks across four lines and the changes badge across two, inflating row height. This task changes **only** wrapping — the RAID badge's text changes in Task 7.

**Files:**
- Modify: `src/app/task-raid-badge.tsx`, `src/app/document-badge.tsx`, `src/app/task-jira-badge.tsx`, `src/app/task-row.tsx`
- Test: `src/app/task-raid-badge.test.tsx`, `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/app/task-raid-badge.test.tsx`, add inside the `describe("RaidBadge", ...)`:

```tsx
  // The badge lives in the task table's narrow, user-resizable ID column. Without
  // this the glyph string breaks across four lines and inflates every row.
  it("never wraps", () => {
    render(<RaidBadge taskId={7} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("whitespace-nowrap");
  });
```

In `src/app/task-row.test.tsx`, add:

```tsx
test("keeps every ID-column badge on one line", () => {
  // Four badges share the narrow ID column: Jira, RAID, Document and the inline
  // changes span. Any one of them wrapping inflates the whole row's height.
  const { container } = render(
    <table><tbody>
      <TaskRow {...rowProps({
        task: makeTask({ id: 1, taskName: "Alpha", jiraKey: "AB-1" }),
        raidRefs: [{ id: 1, category: "R", title: "R1" }],
        changeRefs: [makeChange({ id: 1 })],
      })} />
    </tbody></table>,
  );
  const idCell = container.querySelectorAll("td")[2];
  const badges = idCell.querySelectorAll("a,button,span");
  const wrapping = [...badges].filter(
    (el) => /rounded/.test(el.className) && !/whitespace-nowrap/.test(el.className),
  );
  expect(wrapping.map((el) => el.className)).toEqual([]);
});
```

★ The `querySelectorAll("td")[2]` index and the `rowProps` keys above are **written from the file's structure, not from a run**. Before trusting them, print what the fixture actually renders and correct the index and the prop names to match: add a temporary `screen.debug(container)` (or `console.log([...container.querySelectorAll("td")].map((c) => c.className))`), read the output, fix the test, then remove the debug line. Do not leave a probe in the committed test.

- [ ] **Step 2: Run both and confirm they fail**

```bash
npx vitest run src/app/task-raid-badge.test.tsx src/app/task-row.test.tsx > "$SCRATCH/t2-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |AssertionError" "$SCRATCH/t2-red.log"
```

Expected: `VITEST_EXIT=1`, with both new cases failing.

- [ ] **Step 3: Add `whitespace-nowrap` in four places**

`src/app/task-raid-badge.tsx` — the button's className:

```tsx
      className={`ml-1 inline-flex items-center whitespace-nowrap rounded bg-ui-purple px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-ui-purple/90 ${INTERACTIVE}`}
```

`src/app/document-badge.tsx` — the button's className:

```tsx
      className={`ml-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground ${INTERACTIVE}`}
```

`src/app/task-jira-badge.tsx` — the module-level constant, which both the `<a>` and `<span>` branches consume:

```tsx
const BADGE_CLASS =
  "inline-block whitespace-nowrap rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:text-ui-blue";
```

`src/app/task-row.tsx` — the inline changes span:

```tsx
            className="ml-1 inline-flex items-center whitespace-nowrap rounded bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-blue/20 dark:text-ui-light-grey"
```

- [ ] **Step 4: Run green**

```bash
npx vitest run src/app/task-raid-badge.test.tsx src/app/task-row.test.tsx > "$SCRATCH/t2-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2-green.log"
```

Expected: `VITEST_EXIT=0`, `Tests  67 passed` (3+1 badge, 62+1 row).

- [ ] **Step 5: RaidBadge and DocumentBadge also render on the Kanban card — confirm nothing broke there**

```bash
npx vitest run src/app/task-kanban-card.test.tsx > "$SCRATCH/t2-kanban.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2-kanban.log"
```

Expected: `VITEST_EXIT=0`. These two badges are shared with the board, where `whitespace-nowrap` is harmless — but the board is a real second consumer and must be seen to be green, not assumed.

- [ ] **Step 6: Gates and tree check**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/task-raid-badge.tsx src/app/document-badge.tsx src/app/task-jira-badge.tsx src/app/task-row.tsx src/app/task-raid-badge.test.tsx src/app/task-row.test.tsx; echo "LINT_EXIT=$?"
git diff HEAD --stat
```

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/task-raid-badge.tsx src/app/document-badge.tsx src/app/task-jira-badge.tsx src/app/task-row.tsx src/app/task-raid-badge.test.tsx src/app/task-row.test.tsx -F - <<'MSGEOF'
fix(tasks): stop the four ID-column badges wrapping

Jira, RAID, Document and the inline changes badge all render inside the task
table's narrow, user-resizable ID column, and none carried whitespace-nowrap.
The RAID glyph string broke across four lines and the changes badge across
two, inflating every affected row.

RaidBadge and DocumentBadge also render on the Kanban card; that suite is
green.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 3: Re-clicking an open document's name collapses the body

**Files:**
- Modify: `src/app/documents-panel.tsx`, `src/app/documents-list.tsx`
- Test: `src/app/documents-panel.test.tsx`, `src/app/documents-list.test.tsx`

**★★★ The trap.** `documents-panel.tsx` computes:

```tsx
const selected = selectionPool.find((d) => d.id === selectedId) ?? selectionPool[0] ?? null;
```

So on first load `selectedId` is `null` while `selectionPool[0]` **is rendered as open**. A toggle written against `selectedId` therefore makes the first document's name un-collapsible — the single most likely click in the panel does nothing. Compare against `selected?.id`.

Note that `DocumentsList` already receives `selectedId={selected?.id ?? null}` — the resolved value, not the raw state. The trap lives in the panel's own handler, not in the list.

- [ ] **Step 1: Write the failing tests**

In `src/app/documents-list.test.tsx`:

```tsx
it("marks the open document's title button expanded, and only that one", () => {
  renderList({
    documents: [doc(1, "Alpha"), doc(2, "Beta")],
    selectedId: 1,
    collapsed: false,
  });
  expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "true");
  // A row that is not open is not a disclosure at all — it must carry no
  // aria-expanded, rather than aria-expanded="false", which would announce
  // every closed row as a collapsed section.
  expect(screen.getByRole("button", { name: "Beta" })).not.toHaveAttribute("aria-expanded");
});

it("marks the open document's title button collapsed when the body is collapsed", () => {
  renderList({ documents: [doc(1, "Alpha")], selectedId: 1, collapsed: true });
  expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "false");
});
```

In `src/app/documents-panel.test.tsx`, add these three. Use whatever render helper the neighbouring tests in that file use — **grep for it and copy the call shape verbatim** (`grep -n "function renderLive\|renderLive(" src/app/documents-panel.test.tsx | head -5`); it wires `ConfirmProvider`, `ToastProvider`, `WorkspaceProvider` and friends, and a hand-rolled `render` will throw.

```tsx
it("collapses the body when the open document's name is clicked again", async () => {
  const user = userEvent.setup();
  renderLive([{ id: 1, title: "Alpha", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "true");
});

// ★★★ THE REGRESSION THIS DESIGN EXISTS TO PREVENT. `selected` falls back to
// selectionPool[0], so the FIRST document renders as open while `selectedId` is
// still null. A toggle comparing the clicked id against `selectedId` therefore
// does nothing here — and a fixture that clicks only AFTER an explicit
// selection passes either way, which is why this case is separate.
it("collapses the FIRST document even though selectedId is still null", async () => {
  const user = userEvent.setup();
  renderLive([{ id: 1, title: "Alpha", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  // No prior click: nothing has set selectedId, yet Alpha is the open document.
  expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "false");
});

it("selecting a different document expands it rather than inheriting the collapse", async () => {
  const user = userEvent.setup();
  renderLive([
    { id: 1, title: "Alpha", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, title: "Beta", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ]);
  await user.click(screen.getByRole("button", { name: "Alpha" }));   // collapse Alpha
  await user.click(screen.getByRole("button", { name: "Beta" }));    // switch
  expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-expanded", "true");
});
```

★ The document fixture literal above must match this repo's `ProjectDocument` shape. `documents-list.test.tsx` builds one with a local `doc(id, title)` helper — reuse that shape. If `renderLive` in the panel suite takes a different argument, adapt the call, not the assertions.

- [ ] **Step 2: Run and confirm they fail**

```bash
npx vitest run src/app/documents-list.test.tsx src/app/documents-panel.test.tsx > "$SCRATCH/t3-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |AssertionError" "$SCRATCH/t3-red.log"
```

Expected: `VITEST_EXIT=1`, five new failures.

- [ ] **Step 3: Add the collapse state and the guarded toggle**

In `src/app/documents-panel.tsx`, beside the existing `selectedId` state:

```tsx
  // Transient: collapsing is a momentary "give me room" gesture, not a
  // preference. Nothing persists it.
  const [bodyCollapsed, setBodyCollapsed] = useState(false);
```

Replace `handleSelect`:

```tsx
  function handleSelect(id: number) {
    clearRestoreRejected();
    // ★★★ COMPARE AGAINST `selected?.id`, NEVER `selectedId`. `selected` falls
    // back to `selectionPool[0]`, so on first load a document IS open while
    // `selectedId` is still null — a `selectedId` comparison would leave that
    // first document's name permanently un-collapsible, which is the single
    // most likely click on this panel.
    if (id === selected?.id) {
      setBodyCollapsed((v) => !v);
      return;
    }
    setSelectedId(id);
    setBodyCollapsed(false);
  }
```

Make the body conditional. `DocumentLinksSection` and `DocumentsAssetSection` stay mounted:

```tsx
        {!bodyCollapsed && (
          <DocumentEditModeBody lang={lang} doc={selected} ws={ws} editing={editing} narrow={narrowPane} isReadOnly={isReadOnly} onCommitBlock={commitBlock} structural={structural}
            assetsTursoConfig={assetPane?.tursoConfig ?? null} assetsProjectId={assetPane?.projectId} />
        )}
```

Thread the flag to the list — add `collapsed={bodyCollapsed}` to the existing `<DocumentsList ... />` call site.

In `src/app/documents-list.tsx`, add to `DocumentsListProps`:

```tsx
  /** Whether the OPEN document's body is collapsed. Drives `aria-expanded` on
   *  that one row's title button; every other row is not a disclosure and
   *  carries no `aria-expanded` at all. */
  collapsed?: boolean;
```

Destructure `collapsed = false` alongside the other props, and change the title button:

```tsx
                <button
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  aria-current={doc.id === selectedId ? "true" : undefined}
                  aria-expanded={doc.id === selectedId ? !collapsed : undefined}
                  aria-label={token}
                  className={`text-left underline-offset-2 hover:underline ${INTERACTIVE}`}
                >
```

★ Copy the existing `aria-label` and `className` from the file rather than from this plan — if they differ, the file wins.

- [ ] **Step 4: Rewrite the comment that now contradicts the code**

`documents-list.tsx` carries a comment above that button stating the design intent is "current item in a set, **not a toggle**". That intent is deliberately reversed. Replace it:

```tsx
                {/* `aria-current` marks the current item in the set; `aria-expanded`
                    marks the same row as a disclosure, because clicking an
                    already-open document's name now collapses its body. Both are
                    correct together and neither replaces the other — a row that is
                    not open carries `aria-expanded` NOT AT ALL rather than "false",
                    which would announce every closed row as a collapsed section.
                    Superseded the earlier "not a toggle" note, which described the
                    behaviour before the collapse landed. */}
```

- [ ] **Step 5: Run green**

```bash
npx vitest run src/app/documents-list.test.tsx src/app/documents-panel.test.tsx > "$SCRATCH/t3-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3-green.log"
```

Expected: `VITEST_EXIT=0`, `Tests  112 passed` (4+2 list, 103+3 panel).

- [ ] **Step 6: Mutation-prove the `selected?.id` guard — this is the point of the task**

Change `if (id === selected?.id) {` to `if (id === selectedId) {` and re-run:

```bash
npx vitest run src/app/documents-panel.test.tsx > "$SCRATCH/t3-mutant.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3-mutant.log"
```

Expected: `VITEST_EXIT=1`, and **"collapses the FIRST document even though selectedId is still null" must be among the failures.** Record the exact `N failed / M passed`; the sum must be 106. If that case still passes, the mutant did not land or the fixture is clicking after a selection — fix the test, not the count.

Revert with an inverse anchored Edit (`if (id === selectedId) {` back to `if (id === selected?.id) {`), then:

```bash
npx vitest run src/app/documents-panel.test.tsx > "$SCRATCH/t3-restored.log" 2>&1; echo "VITEST_EXIT=$?"
git diff HEAD --stat
```

Expected: `VITEST_EXIT=0`, and the diff shows only the four intended files.

- [ ] **Step 7: Gates**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/documents-panel.tsx src/app/documents-list.tsx src/app/documents-panel.test.tsx src/app/documents-list.test.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

The last command is the size ratchet's own measure (`split("\n").length`, i.e. `wc -l` + 1). `documents-panel.tsx` was 767; the limit is 1600. Confirm it is nowhere near.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/documents-panel.tsx src/app/documents-list.tsx src/app/documents-panel.test.tsx src/app/documents-list.test.tsx -F - <<'MSGEOF'
feat(documents): collapse the body by re-clicking the open document's name

Clicking an already-open document's title now collapses the rendered body,
reclaiming the height. Links and assets stay mounted, so the metadata
controls remain usable. The state is transient by design — collapsing is a
momentary gesture, not a preference.

The toggle compares against `selected?.id`, never `selectedId`: `selected`
falls back to selectionPool[0], so on first load a document is open while
`selectedId` is still null, and a `selectedId` comparison would leave that
first document permanently un-collapsible. Mutation-proved — the dedicated
first-document test is red against that comparison, and a fixture clicking
after an explicit selection passes either way.

The title button gains `aria-expanded` for the open row only; the comment
claiming the row is "not a toggle" described the old behaviour and is
rewritten rather than left contradicting the code.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 4: The asset name opens the preview

**Files:**
- Modify: `src/app/asset-library.tsx`
- Test: `src/app/asset-library.test.tsx`

The name is a bare `<span>`. Preview is a separate `Button` calling `setPreviewIndex(index)`, rendered only when `loadImage` is available.

Two constraints: the name must be interactive **only** when `loadImage` exists (without it there is no preview to open, and a dead control is worse than plain text), and its accessible name must be row-unique — the fixture in this suite deliberately gives both rows the name `image.png`.

The row already has a token: `const token = rowTokens.get(asset.id) ?? asset.name;`, built from `buildRowTokens(sorted)`. Use `aria-label={token}` — it contains the visible text (2.5.3) and is row-unique (2.4.6), and it mirrors what `documents-list.tsx` does with its title button. Do **not** use `rowLabel(t(lang, "documentsPreview"), token)`: that is byte-identical to the Preview button's own name and would be a real 2.4.6 collision.

- [ ] **Step 1: Write the failing tests**

In `src/app/asset-library.test.tsx`:

```tsx
it("opens the preview when the asset name is clicked", async () => {
  const user = userEvent.setup();
  render(<AssetLibrary {...base} loadImage={vi.fn().mockResolvedValue(new Blob())} />);
  // Both fixture rows are named "image.png"; the tokens disambiguate them.
  await user.click(screen.getByRole("button", { name: "image.png (1)" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("leaves the asset name inert when no image loader is available", () => {
  render(<AssetLibrary {...base} />);
  expect(screen.queryByRole("button", { name: "image.png (1)" })).not.toBeInTheDocument();
  expect(screen.getAllByText("image.png").length).toBeGreaterThan(0);
});

it("keeps the name control distinct from the Preview control", () => {
  const { container } = render(<AssetLibrary {...base} loadImage={vi.fn().mockResolvedValue(new Blob())} onInsert={vi.fn()} />);
  // Both rows share a display name, so this fixture can actually express the
  // collision the assertion is about.
  expectRowUniqueNames({ minControls: 8, scope: container, requireCollisionSeed: true });
});
```

★ `base` is this file's existing fixture object; it already seeds two assets both named `image.png`. Check whether `base` includes a `loadImage` key and what the prop is really called (`grep -n "loadImage" src/app/asset-library.tsx | head -3`) — pass it the way the component expects. The `minControls: 8` floor is a **guess until measured**: set it to `999`, run once, read the length of the printed `Rendered: [...]` list in the thrown message, and set the floor to that exact number. A loose floor lets a silently narrowed scope back in.

★ The dialog assertion assumes `AssetPreviewModal` renders `role="dialog"`. Verify (`grep -n "role=\"dialog\"\|<Modal" src/app/asset-preview-modal.tsx`) and assert on whatever it actually renders.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/asset-library.test.tsx > "$SCRATCH/t4-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |AssertionError|expectRowUniqueNames" "$SCRATCH/t4-red.log"
```

- [ ] **Step 3: Make the name a conditional control**

In `src/app/asset-library.tsx`, replace the non-editing branch of the name ternary:

```tsx
                      ) : loadImage ? (
                        // ★ Interactive ONLY when a loader exists — without one
                        // there is no preview to open and a control that does
                        // nothing is worse than plain text.
                        // ★★ Named by the row TOKEN, not by "Preview – <token>":
                        // that spelling is byte-identical to the Preview button's
                        // own name one cell over, which is a real WCAG 2.4.6
                        // collision. The token contains the visible name, so 2.5.3
                        // containment holds too.
                        <button
                          type="button"
                          onClick={() => setPreviewIndex(index)}
                          aria-label={token}
                          className={`text-left underline-offset-2 hover:underline ${INTERACTIVE}`}
                        >
                          {asset.name}
                        </button>
                      ) : (
                        <span>{asset.name}</span>
                      )}
```

If `INTERACTIVE` is not already imported in this file, add it: `import { INTERACTIVE } from "./interaction-styles";`

- [ ] **Step 4: Run green**

```bash
npx vitest run src/app/asset-library.test.tsx > "$SCRATCH/t4-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t4-green.log"
```

Expected: `VITEST_EXIT=0`, `Tests  35 passed` (32 + 3).

- [ ] **Step 5: Mutation-prove the uniqueness assertion**

Change `aria-label={token}` to `aria-label={asset.name}` and re-run. Expected: `VITEST_EXIT=1` with "keeps the name control distinct from the Preview control" among the failures — both rows now claim `image.png`. Record `N failed / M passed`; the sum must be 35. Revert with an inverse anchored Edit and confirm `git diff HEAD --stat` shows only the two files.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/asset-library.tsx src/app/asset-library.test.tsx; echo "LINT_EXIT=$?"
git diff HEAD --stat
git commit --only src/app/asset-library.tsx src/app/asset-library.test.tsx -F - <<'MSGEOF'
feat(documents): open the preview by clicking an asset's name

The name was a bare span while Preview sat behind a separate button. It is
now a control in its own right — but only when an image loader is available,
since without one there is nothing to open and a dead control is worse than
plain text.

Named by the row token rather than "Preview – <token>": that spelling is
byte-identical to the Preview button one cell over and would be a real WCAG
2.4.6 collision. The token contains the visible name, so 2.5.3 containment
holds as well. Mutation-proved against a bare `asset.name`, using the
suite's existing two-rows-share-a-name fixture.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 5: `SingleEntityPicker` — the searchable single-select

**Files:**
- Create: `src/app/single-entity-picker.tsx`
- Create: `src/app/single-entity-picker.test.tsx`

`EntityLinkPicker` is multi-select only: `selected` is a readonly array with `onAdd`/`onRemove` chips, no single-value concept, no empty option. It is consumed by `TaskLinkPicker` and `RaidCausedByField`. **Do not modify it.**

This component is its single-select sibling. Like `EntityLinkPicker` it is **i18n-free** — every user-facing string arrives already translated as a prop, so it takes no `lang` and calls no `t()`. That is what makes this task buildable before the i18n commit.

Mirror `EntityLinkPicker`'s ARIA and keyboard behaviour exactly: `useId()` for the listbox id, options at `${listId}-opt-${i}`, `aria-activedescendant`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and a render-time reconcile keyed on the query rather than a `useEffect` (`react-hooks/set-state-in-effect` is fatal here).

- [ ] **Step 1: Write the failing test file**

Create `src/app/single-entity-picker.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SingleEntityPicker, type SingleEntityOption } from "./single-entity-picker";

const OPTIONS: SingleEntityOption[] = [
  { value: "task:1", code: "Task", label: "Ship the release" },
  { value: "raid:2", code: "RAID", label: "Vendor delay" },
];

function renderPicker(overrides: Partial<Parameters<typeof SingleEntityPicker>[0]> = {}) {
  const props = {
    value: "",
    options: OPTIONS,
    query: "",
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    searchLabel: "Attach to",
    placeholder: "Search…",
    clearLabel: "Clear – Attach to",
    emptyLabel: "—",
    ...overrides,
  };
  return { props, ...render(<SingleEntityPicker {...props} />) };
}

describe("SingleEntityPicker", () => {
  it("names its search box and exposes the combobox role", () => {
    renderPicker();
    // A placeholder is NOT an accessible name — it fails the axe gate.
    expect(screen.getByRole("combobox", { name: "Attach to" })).toBeInTheDocument();
  });

  it("keeps the listbox closed while the query is blank", () => {
    renderPicker();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the listbox once a query has options", () => {
    renderPicker({ query: "ship" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("selects with a click", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "ship" });
    await user.click(screen.getByRole("option", { name: /Ship the release/ }));
    expect(props.onSelect).toHaveBeenCalledWith("task:1");
  });

  it("arrows to an option and commits it with Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    box.focus();
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    await user.keyboard("{Enter}");
    expect(props.onSelect).toHaveBeenCalledWith("task:1");
  });

  // ★ Enter must NOT be swallowed unless an option is actually armed. This
  // control sits inside forms where a bare Enter submits; claiming Enter merely
  // because a dropdown is open would silently break submitting from this field.
  it("leaves Enter alone when no option is armed", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("closes on Escape without clearing the query", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    screen.getByRole("combobox").focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onQueryChange).not.toHaveBeenCalled();
  });

  it("renders the current selection's label when one is set", () => {
    renderPicker({ value: "raid:2", selectedLabel: "RAID: Vendor delay" });
    expect(screen.getByText("RAID: Vendor delay")).toBeInTheDocument();
  });

  it("shows the empty label when nothing is selected", () => {
    renderPicker({ value: "" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm it cannot even import**

```bash
npx vitest run src/app/single-entity-picker.test.tsx > "$SCRATCH/t5-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |Cannot find|Failed to load" "$SCRATCH/t5-red.log"
```

Expected: `VITEST_EXIT=1`, failing to resolve `./single-entity-picker`.

- [ ] **Step 3: Write the component**

Create `src/app/single-entity-picker.tsx`:

```tsx
"use client";

// SingleEntityPicker — the single-select sibling of EntityLinkPicker: one
// current value shown above a search box whose dropdown replaces it.
//
// Why not EntityLinkPicker itself: that component is multi-select by
// construction — `selected` is an ARRAY with add/remove asymmetry and there is
// no empty state, because an unlinked entity is simply absent from the list. A
// single-value control needs the opposite: exactly one value, an explicit
// "none", and replace-rather-than-append semantics. Bolting a mode onto the
// shared component would put TaskLinkPicker and RaidCausedByField at risk for a
// third caller's benefit.
//
// What IS shared is the pure engine: callers filter with `filterPickerOptions`
// (picker-filter.ts), which already layers `wildcardMatcher` over an `#id`
// exact match. Nothing is reimplemented here.
//
// Presentational and entity-agnostic. Every user-facing string arrives already
// translated, so this file takes no `lang` and calls no `t()` — same contract as
// EntityLinkPicker.
import { useId, useRef, useState } from "react";
import { Input } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";
import { INTERACTIVE } from "./interaction-styles";

/** One selectable entity, flattened to what the picker renders. */
export interface SingleEntityOption {
  /** Opaque value handed back to the caller on selection. Unique in the list. */
  value: string;
  /** Short qualifier rendered monospace, e.g. "Task" or "RAID". */
  code: string;
  /** Human-readable name; truncates rather than wrapping. */
  label: string;
}

interface SingleEntityPickerProps {
  /** The current value, or "" for none. */
  value: string;
  /** Already-translated label for the current value. Omit for none. */
  selectedLabel?: string;
  /** Candidates — ALREADY filtered by the caller. Rendered only while the
   *  query is non-blank, mirroring EntityLinkPicker. */
  options: readonly SingleEntityOption[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
  /** Accessible name for the search box. A placeholder is NOT an accessible
   *  name (it fails the axe gate), so this is required. */
  searchLabel: string;
  placeholder: string;
  /** Already-translated accessible name for the query box's clear button. */
  clearLabel: string;
  /** Shown in place of a selection when `value` is "". */
  emptyLabel: string;
  inputSize?: "xs" | "md";
}

export function SingleEntityPicker({
  value,
  selectedLabel,
  options,
  query,
  onQueryChange,
  onSelect,
  searchLabel,
  placeholder,
  clearLabel,
  emptyLabel,
  inputSize = "xs",
}: SingleEntityPickerProps) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [highlight, setHighlight] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [prevQuery, setPrevQuery] = useState(query);

  // Render-time reconcile, NOT an effect — `react-hooks/set-state-in-effect` is
  // fatal here. Keyed on the QUERY, not on the `options` identity: callers
  // re-filter and hand a fresh array every render, so reconciling on identity
  // would reset the highlight on every keystroke-free re-render.
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHighlight(-1);
    setDismissed(false);
  }

  const hasQuery = query.trim() !== "";
  const open = hasQuery && options.length > 0 && !dismissed;
  // Clamped on READ: the caller's filtering can shrink `options` under a stored
  // index. This drops an index now out of RANGE; the reconcile above covers an
  // index still in range but naming a different entity.
  const active = highlight >= 0 && highlight < options.length ? highlight : -1;

  function move(delta: 1 | -1) {
    // ★ `next` is computed OUTSIDE the updater: a setState updater must be PURE,
    // and StrictMode double-invokes it, which would schedule the rAF twice.
    const cur = active;
    const next =
      delta === 1
        ? cur + 1 >= options.length
          ? 0
          : cur + 1
        : cur <= 0
          ? options.length - 1
          : cur - 1;
    setHighlight(next);
    // ★ The keyboard path is aria-activedescendant, which browsers do NOT
    // auto-scroll — focus never moves, so nothing brings the row into view.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`#${CSS.escape(`${listId}-opt-${next}`)}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || options.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setDismissed(false);
      move(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      // ★ Only an ARMED option claims Enter. This control sits inside forms
      // where a bare Enter submits, so swallowing it merely because a dropdown
      // happens to be open would silently break submitting from this field.
      if (!open || active < 0) return;
      e.preventDefault();
      onSelect(options[active].value);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      // ★★ preventDefault is what actually contains this: the shared Modal's
      // document-level Escape handler bails on `e.defaultPrevented`, which is
      // the ONLY mechanism available. stopPropagation cannot do it — React 19
      // delegates on `document`, the same node Modal listens on, and
      // stopPropagation does not suppress a listener co-registered on the SAME
      // node. It reads as though it works only because RTL renders into a div
      // under body, a topology the real app never has.
      e.preventDefault();
      // ★ Defence-in-depth for a host listening on an ANCESTOR or on `window`.
      e.stopPropagation();
      setDismissed(true);
      setHighlight(-1);
    }
  }

  return (
    <div>
      <div className="mb-1 text-xs text-foreground">
        {value && selectedLabel ? (
          <span className="max-w-full truncate">{selectedLabel}</span>
        ) : (
          <span className="italic text-muted-foreground">{emptyLabel}</span>
        )}
      </div>
      <div className="relative">
        <ClearableSearchInput value={query} onClear={() => onQueryChange("")} clearLabel={clearLabel}>
          <Input
            type="text"
            role="combobox"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            // ★ onCLICK, not onFocus. Escape must STICK: with an onFocus reopen,
            // tabbing away and back reopens the list over the rest of the form.
            onClick={() => setDismissed(false)}
            onKeyDown={onKeyDown}
            aria-label={searchLabel}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={placeholder}
            size={inputSize}
            className={`w-full${query ? " pr-8" : ""}`}
          />
        </ClearableSearchInput>
        {open && (
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface"
          >
            {options.map((entry, i) => (
              // ★ The row itself is the option — NOT a <button> inside one. An
              // interactive child of role="option" is an axe nested-interactive
              // violation, and the keyboard path is aria-activedescendant.
              <li
                key={entry.value}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                // Keeps focus in the input so commit-on-blur hosts don't close
                // the editor out from under the selection.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(entry.value)}
                // ★★ The active row keeps `text-foreground` and rings on
                // `--foreground`, never an accent: any brand accent is tuned for
                // one mode and drops under 3:1 (WCAG 1.4.11) in the other.
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground ${
                  i === active
                    ? "bg-surface-muted font-medium ring-1 ring-inset ring-foreground"
                    : "hover:bg-surface-muted"
                }`}
              >
                <span className="font-mono text-xs text-muted-foreground">{entry.code}</span>
                <span className="truncate">{entry.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

★ `INTERACTIVE` is imported above but is only needed if you add a focusable element beyond the `Input` (which carries its own focus ring via `fieldClass`). If eslint flags it as unused — and `--max-warnings=0` makes that **fatal** — remove the import rather than suppressing it.

★ Confirm `ClearableSearchInput`'s real prop names before relying on them (`grep -n "interface\|export function ClearableSearchInput" -A 12 src/app/clearable-search-input.tsx`). If they differ from `value`/`onClear`/`clearLabel`, the file wins.

- [ ] **Step 4: Run green**

```bash
npx vitest run src/app/single-entity-picker.test.tsx > "$SCRATCH/t5-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5-green.log"
```

Expected: `VITEST_EXIT=0`, `Tests  9 passed`.

- [ ] **Step 5: Mutation-prove the Enter guard**

Delete `if (!open || active < 0) return;` from the Enter branch and re-run. Expected: `VITEST_EXIT=1` with "leaves Enter alone when no option is armed" failing. Record `N failed / M passed`; the sum must be 9. Revert by an inverse anchored Edit and confirm the file matches.

- [ ] **Step 6: Gates**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/single-entity-picker.tsx src/app/single-entity-picker.test.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/single-entity-picker.tsx','utf8').split('\n').length)"
git diff HEAD --stat
git status --porcelain --untracked-files=all
```

The two new files show as untracked. `sample-workspace-huge.json` and `not-in-use.env.local.bak` will also appear — **do not stage them.**

- [ ] **Step 7: Commit**

```bash
git add src/app/single-entity-picker.tsx src/app/single-entity-picker.test.tsx
git commit --only src/app/single-entity-picker.tsx src/app/single-entity-picker.test.tsx -F - <<'MSGEOF'
feat(ui): add SingleEntityPicker, the single-select searchable combobox

EntityLinkPicker is multi-select by construction — an array of chips with
add/remove asymmetry and no empty state — and is consumed by TaskLinkPicker
and RaidCausedByField, so adding a single-value mode there would risk two
working surfaces for a third caller. This is its sibling instead.

The pure engine IS shared: callers filter with filterPickerOptions, which
already layers wildcardMatcher over an #id exact match. The ARIA combobox,
the query-keyed render-time reconcile, the armed-option-only Enter and the
preventDefault-based Escape all mirror EntityLinkPicker deliberately, so
this control behaves like every other picker in the app.

i18n-free: every string arrives translated as a prop.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 6: The three new i18n key pairs

**★ BLOCKED.** `i18n.ts` and `i18n.de.ts` are being written concurrently by a peer session. Confirm their branch has landed before starting. Then:

```bash
git status --porcelain src/app/i18n.ts src/app/i18n.de.ts
```

Expected: empty. If either file is dirty, stop and wait.

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

Three pairs. EN/DE key parity is enforced by tsc, so both files change together or neither compiles.

- [ ] **Step 1: Add the EN keys with the Edit tool**

`src/app/i18n.ts`, immediately after `raidReferencedByMix`:

```ts
  raidReferencedByCount: "{0} RAID",
```

Immediately after the `projectLoadFromTursoHint` block:

```ts
  projectTursoNotConfigured: "Configure a Turso database in Settings → Integrations first.",
```

Near the other knowledge keys (put it beside `documentsTarget`):

```ts
  knowledgeTargetSearchPlaceholder: "Search a task, RAID item, change, milestone or stakeholder, or * for all…",
```

- [ ] **Step 2: Add the DE keys with an anchored Node write — NOT the Edit tool**

The Edit tool corrupts umlauts and curls double quotes in this file. The file is CRLF, so every anchor must carry `\r\n`. Write this script to the scratchpad and run it:

```bash
cat > "$SCRATCH/de-keys.mjs" <<'SCRIPTEOF'
import { readFileSync, writeFileSync } from "node:fs";
const P = "src/app/i18n.de.ts";
let s = readFileSync(P, "utf8");

const edits = [
  {
    anchor: '  raidReferencedByMix: "{0}R · {1}A · {2}I · {3}D",\r\n',
    add: '  raidReferencedByCount: "{0} RAID",\r\n',
  },
  {
    anchor: '  projectMigrateNoProject: "Kein aktuelles Projekt zum Verschieben.",\r\n',
    add: '  projectTursoNotConfigured: "Zuerst eine Turso-Datenbank unter Einstellungen → Integrationen konfigurieren.",\r\n',
  },
];

for (const { anchor, add } of edits) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor occurs ${n} times, expected 1: ${JSON.stringify(anchor.slice(0, 40))}`);
  if (s.includes(add)) throw new Error(`already present: ${JSON.stringify(add.slice(0, 40))}`);
  s = s.replace(anchor, anchor + add);
}

// The third key goes beside documentsTarget; find it rather than hardcoding a
// neighbour, because that neighbourhood was not measured.
const t = '  documentsTarget:';
const i = s.indexOf(t);
if (i === -1) throw new Error("documentsTarget not found");
const eol = s.indexOf("\r\n", i) + 2;
const third = '  knowledgeTargetSearchPlaceholder: "Aufgabe, RAID-Eintrag, Änderung, Meilenstein oder Stakeholder suchen, oder * für alle…",\r\n';
if (s.includes(third)) throw new Error("third key already present");
s = s.slice(0, eol) + third + s.slice(eol);

writeFileSync(P, s, "utf8");
console.log("OK");
SCRIPTEOF
node "$SCRATCH/de-keys.mjs"; echo "SCRIPT_EXIT=$?"
```

Expected: `OK` and `SCRIPT_EXIT=0`. Any thrown error means an anchor did not match exactly once — read the message, fix the anchor against the real file, and re-run. Do not weaken an assertion to get past it.

Each edit asserts its anchor occurs **exactly once** and that the key is not already present, so a re-run fails loud rather than double-inserting.

- [ ] **Step 3: Verify the DE bytes are real umlauts, not escapes or mojibake**

Never judge encoding from printed output — the console codepage renders a correct `ü` as `?`. Read codepoints:

```bash
node -e "
const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
for (const k of ['raidReferencedByCount','projectTursoNotConfigured','knowledgeTargetSearchPlaceholder']) {
  const m = s.match(new RegExp(k + ': \"([^\"]*)\"'));
  console.log(k, m ? [...m[1]].filter(c=>c.charCodeAt(0)>127).map(c=>c+'=U+'+c.charCodeAt(0).toString(16)).join(' ') : 'MISSING');
}"
```

Expected: `projectTursoNotConfigured` shows `→=U+2192`; `knowledgeTargetSearchPlaceholder` shows `Ä=U+c4`, `ü=U+fc`, `…=U+2026`. Any `U+fffd`, or a `\u00` sequence in the source, means the write went wrong — revert and redo.

- [ ] **Step 4: Confirm line endings did not change**

```bash
git ls-files --eol src/app/i18n.ts src/app/i18n.de.ts
```

Expected: `i/lf  w/crlf` for **both**. A `w/lf` means something re-lined the file — revert and redo with the anchored write.

- [ ] **Step 5: Run the encoding and parity gates**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > "$SCRATCH/t6-i18n.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t6-i18n.log"
```

Expected: `TSC_EXIT=0` (key parity is a type error if a key is missing on one side) and `VITEST_EXIT=0`, `Tests  4 passed`. That suite bans `[ÃÂ]` mojibake, bans `\u00(e4|f6|fc|c4|d6|dc|df)` escapes, requires eight German terms to appear somewhere in the dictionary, and bans `\bfuer\b|\bmuessen\b|\bgeloescht\b|\bSchliessen\b`.

- [ ] **Step 6: Commit**

```bash
git diff HEAD --stat
git commit --only src/app/i18n.ts src/app/i18n.de.ts -F - <<'MSGEOF'
i18n: add the RAID count, Turso-not-configured and attach-to search strings

Three EN/DE pairs for the control-defects batch: the RAID badge's short
visible count, the hint explaining a disabled Move-to-Turso button, and the
Knowledge attach-to search placeholder.

DE was patched by an anchored UTF-8 write with CRLF anchors and real
umlauts; the Edit tool corrupts umlauts and curls quotes in that file.
Codepoints verified rather than read off the console, whose codepage renders
a correct umlaut as a question mark.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 7: The RAID badge shows a count

**Depends on Task 6.**

**Files:**
- Modify: `src/app/task-raid-badge.tsx`
- Test: `src/app/task-raid-badge.test.tsx`, `src/app/task-kanban-card.test.tsx`, `src/app/task-row.test.tsx`

Visible text becomes the short count; the glyph breakdown moves to `title`; the accessible name is rebuilt to **lead with the new visible text**, keeping the spelled-out count in the middle and the row token last.

**★★★ No gate can see a regression here.** axe ships `label-content-name-mismatch` and it carries `wcag21a`, but it is also tagged `experimental`, which axe's default `tagExclude` drops — so the tag-only `runOnly` in `e2e/a11y.spec.ts` never runs it. And axe has no rule at all that flags two controls sharing an accessible name, in any view at any seed size. `task-raid-badge.test.tsx` is the only detector that can exist for either property.

- [ ] **Step 1: Rewrite the three existing tests to the new strings**

In `src/app/task-raid-badge.test.tsx`, the fixture stays (`MIXED_REFS` is 2 R + 1 A, so the count is 3 and the mix is `2R · 1A · 0I · 0D` — two different strings, which is the point). Change the expectations:

- The 2.5.3 test's `expect(visible).toBe("2R · 1A · 0I · 0D")` becomes `expect(visible).toBe("3 RAID")`.
- The exact-name pin becomes `"3 RAID – Referenced by 3 RAID item(s) – Alpha"`, and the `title` assertion becomes `"2R · 1A · 0I · 0D"`.
- The 2.4.6 test's `textContent` pin becomes `["3 RAID", "3 RAID"]`, and its two names become `"3 RAID – Referenced by 3 RAID item(s) – Alpha"` / `"… – Beta"`.

Also update the comment block above the 2.5.3 test: it currently explains that the visible content is the glyph string and the name was the total count. That is now backwards. Replace with:

```tsx
  // ★★★ WCAG 2.5.3 (label in name). The badge's VISIBLE content is the short
  // count ("3 RAID"); the accessible name LEADS with that same string, then
  // adds the spelled-out count and the row token. Leading with the visible text
  // makes containment hold by construction rather than by coincidence — a
  // translation that reorders the sentence cannot break it.
  //
  // ★★ CONTAINMENT, NOT PREFIX. 2.5.3 asks that the name CONTAIN the visible
  // text, case-INSENSITIVELY and position-INDEPENDENTLY (axe's own
  // implementation ends in `includes`). Front position here is the Understanding
  // note's best practice, not the criterion. Do not enforce prefixing elsewhere
  // on the strength of this test.
```

- [ ] **Step 2: Run and confirm they fail**

```bash
npx vitest run src/app/task-raid-badge.test.tsx > "$SCRATCH/t7-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |AssertionError" "$SCRATCH/t7-red.log"
```

Expected: `VITEST_EXIT=1`, all four cases failing (3 original + the nowrap case from Task 2).

- [ ] **Step 3: Change the component**

In `src/app/task-raid-badge.tsx`, inside `RaidBadgeImpl`:

```tsx
  const counts = countByCategory(refs);
  // The badge's VISIBLE content — the short total. It is also the HEAD of the
  // accessible name below, so the two cannot drift.
  const countText = t(lang, "raidReferencedByCount", refs.length);
  // The per-category breakdown. Sighted shorthand, so it rides `title` rather
  // than the name: read aloud it is "2R 1A 0I 0D", which is worse than the
  // sentence the name carries.
  const mix = t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D);
```

`title` becomes the breakdown:

```tsx
      title={mix}
```

`aria-label` leads with the visible text:

```tsx
      aria-label={rowLabel(rowLabel(countText, t(lang, "raidReferencedBy", refs.length)), rowToken)}
```

and the button's body becomes `{countText}`.

- [ ] **Step 4: Rewrite the four stale comments in that file — same commit**

The file's existing comments describe the previous arrangement: the `rowToken` docstring says the name "used to be the bare count"; the `title` comment says it "stays the bare count"; the "ACCEPTED COST" paragraph reasons about a tooltip that was byte-identical to the name; and the 2.5.3 block says the visible text is the glyph string. All four are now wrong. Rewrite them so each describes what the code does today. In particular the `title` comment becomes:

```tsx
      // ★ `title` carries the per-category BREAKDOWN: `aria-label` wins the
      // NAME, so this is the accessible DESCRIPTION plus the hover tooltip —
      // the only place a sighted mouse user can still get the R/A/I/D split now
      // that the visible text is a total. Do not put the row identity here; it
      // would only lengthen a tooltip shown on the row already under the pointer.
```

A comment describing previous behaviour reads as current to the next contributor. This is not optional tidying.

- [ ] **Step 5: Fix the two other suites that pin the old name**

`src/app/task-kanban-card.test.tsx` builds the expected name as `rowLabel(rowLabel(t("en-US","raidReferencedByMix",1,0,1,0), t("en-US","raidReferencedBy",2)), "Alpha")`. Change the first argument to `t("en-US","raidReferencedByCount",2)`.

`src/app/task-row.test.tsx` has two comments referring to the old name construction. Update them to describe the new one.

- [ ] **Step 6: Run green**

```bash
npx vitest run src/app/task-raid-badge.test.tsx src/app/task-kanban-card.test.tsx src/app/task-row.test.tsx > "$SCRATCH/t7-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t7-green.log"
```

Expected: `VITEST_EXIT=0`.

- [ ] **Step 7: Mutation-prove the name chain — the only detector**

Two mutants, run and reverted one at a time.

**M1, containment:** change `aria-label={rowLabel(rowLabel(countText, ...` to `aria-label={rowLabel(rowLabel(mix, ...` — the pre-correction spelling. Expected: `VITEST_EXIT=1` with the 2.5.3 containment test failing (the name no longer contains `"3 RAID"`). Record `N failed / M passed`; the sum must be 4.

**M2, row-uniqueness:** drop `rowToken` — `aria-label={rowLabel(countText, t(lang, "raidReferencedBy", refs.length))}`. Expected: `VITEST_EXIT=1` with the 2.4.6 test failing. Sum must be 4.

Revert each by an inverse anchored Edit, asserting the anchor is unique in both directions, and finish on:

```bash
git diff HEAD --stat
```

showing only the four intended files.

- [ ] **Step 8: Gates and commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/task-raid-badge.tsx src/app/task-raid-badge.test.tsx src/app/task-kanban-card.test.tsx src/app/task-row.test.tsx; echo "LINT_EXIT=$?"
git commit --only src/app/task-raid-badge.tsx src/app/task-raid-badge.test.tsx src/app/task-kanban-card.test.tsx src/app/task-row.test.tsx -F - <<'MSGEOF'
fix(a11y): show a RAID count on the badge and move the breakdown to the tooltip

The badge's visible text was the four-part glyph string, which in the narrow
ID column read as four stacked lines. It is now the short total; the
per-category breakdown moves to `title`, where a sighted mouse user can
still reach it. Nothing is lost — the two trade places.

The accessible name is rebuilt to LEAD with the new visible text, so WCAG
2.5.3 containment holds by construction and cannot be broken by a
translation that reorders the sentence. The spelled-out count stays in the
middle rather than the glyph string: a screen reader should hear a sentence,
not "2R 1A 0I 0D". The row token still closes 2.4.6.

No gate can see a regression here — axe's label-content-name-mismatch is
experimental and dropped by the default tagExclude, and no axe rule flags two
controls sharing a name in any view. Both properties are mutation-proved
against task-raid-badge.test.tsx, the only detector that can exist.

Four comments in the badge describing the previous arrangement are rewritten
in this commit rather than left reading as current.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 8: Turso buttons visible but disabled

**Depends on Task 6.**

**Files:**
- Modify: `src/app/projects-panel.tsx`
- Test: `src/app/projects-panel.test.tsx`

**★★ The trap.** A `disabled` button dispatches **no mouse events**, so a `title` placed on it never surfaces — the hint explaining why the button is disabled would be unreachable exactly when it matters. The hint goes on a wrapping `<span>`. Do **not** substitute `aria-disabled`: that still fires `onClick`, which here would start a migration the user was just told was unavailable.

`currentProject` stays a **render** gate on Move-to-Turso — with no project there is nothing to move.

- [ ] **Step 1: Write the failing tests**

In `src/app/projects-panel.test.tsx`:

```tsx
it("shows the Turso buttons disabled when Turso is not configured", () => {
  render(<ProjectsPanel {...propsWithoutTurso()} />);
  expect(screen.getByRole("button", { name: "Load from Turso" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move to Turso" })).toBeDisabled();
});

// ★★ A disabled button dispatches NO mouse events, so a `title` on the button
// itself never surfaces — the explanation would be unreachable on the very
// control it explains. It lives on a wrapper instead.
it("puts the not-configured hint on the wrapper, not on the disabled button", () => {
  render(<ProjectsPanel {...propsWithoutTurso()} />);
  const btn = screen.getByRole("button", { name: "Load from Turso" });
  expect(btn).not.toHaveAttribute("title");
  expect(btn.closest("[title]")).toHaveAttribute(
    "title",
    "Configure a Turso database in Settings → Integrations first.",
  );
});

it("enables the Turso buttons once Turso is configured", () => {
  render(<ProjectsPanel {...propsWithTurso()} />);
  expect(screen.getByRole("button", { name: "Load from Turso" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Move to Turso" })).toBeEnabled();
});
```

★ `propsWithoutTurso()` / `propsWithTurso()` are **not existing helpers** — build them from this file's existing fixture consts (`STAKEHOLDERS`, `ADDRESS_BOOK`, `PROJECTS`, `CURRENT_META`) plus whatever settings shape drives `tursoConfigured`. Read how `tursoConfigured` is computed (`grep -n "tursoConfigured\|getTursoConfig" src/app/projects-panel.tsx`) and seed both states accordingly. If the panel reads Turso config from `settings` rather than a prop, seed `defaultSettings` with and without it.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/projects-panel.test.tsx > "$SCRATCH/t8-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |Unable to find" "$SCRATCH/t8-red.log"
```

Expected: `VITEST_EXIT=1`. The first two fail because the buttons are not rendered at all today.

- [ ] **Step 3: Change the gates**

In `src/app/projects-panel.tsx`, replace the Load-from-Turso block:

```tsx
          {!isTurso && (
            // ★★ The hint rides this WRAPPER, not the Button. A `disabled`
            // button dispatches no mouse events, so a `title` on it never
            // surfaces — the explanation of why it is disabled would be
            // unreachable on the control it explains. Rendering disabled rather
            // than hiding is deliberate: a hidden button never teaches the user
            // the capability exists.
            <span
              className="inline-flex"
              title={
                tursoConfigured
                  ? t(lang, "projectLoadFromTursoHint")
                  : t(lang, "projectTursoNotConfigured")
              }
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={!tursoConfigured}
                onClick={() => setTursoPickerOpen(true)}
              >
                {t(lang, "projectLoadFromTurso")}
              </Button>
            </span>
          )}
```

and the Move-to-Turso block, keeping `currentProject` as a render gate:

```tsx
          {!isTurso && currentProject && (
            <span
              className="inline-flex"
              title={
                tursoConfigured
                  ? t(lang, "projectMigrateToTursoHint")
                  : t(lang, "projectTursoNotConfigured")
              }
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={!tursoConfigured}
                onClick={onMigrateToTurso}
              >
                {t(lang, "projectMigrateToTurso")}
              </Button>
            </span>
          )}
```

`Button` already forwards `disabled` and styles it — its base class carries `disabled:cursor-not-allowed disabled:opacity-50`. No primitive change.

- [ ] **Step 4: Run green**

```bash
npx vitest run src/app/projects-panel.test.tsx > "$SCRATCH/t8-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t8-green.log"
```

Expected: `VITEST_EXIT=0`, `Tests  25 passed` (22 + 3).

- [ ] **Step 5: Mutation-prove both guards**

**M1:** remove `disabled={!tursoConfigured}` from the Load button. Expected: `VITEST_EXIT=1`, "shows the Turso buttons disabled…" failing. Sum must be 25.

**M2:** move the `title` from the wrapper onto the `Button`. Expected: `VITEST_EXIT=1`, "puts the not-configured hint on the wrapper…" failing. Sum must be 25. This is the mutant that matters — it is the shape a well-meaning simplification would produce.

Revert each by inverse anchored Edit; finish on an empty `git diff HEAD --stat` beyond the two intended files.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/projects-panel.tsx src/app/projects-panel.test.tsx; echo "LINT_EXIT=$?"
git commit --only src/app/projects-panel.tsx src/app/projects-panel.test.tsx -F - <<'MSGEOF'
feat(projects): show the Turso buttons disabled rather than hiding them

Load-from-Turso and Move-to-Turso were absent entirely when Turso was
unconfigured, so the capability was undiscoverable from this screen. They now
render disabled, with a hint naming where to configure it.

The hint rides a wrapper span, not the button: a disabled button dispatches
no mouse events, so a title on it never surfaces — the explanation would be
unreachable on the control it explains. Mutation-proved, because moving the
title onto the button is exactly what a later simplification would do.
aria-disabled is deliberately NOT used; it still fires onClick, which here
would start a migration the user was just told was unavailable.

currentProject stays a render gate on Move-to-Turso — with no project there
is nothing to move, and a permanently disabled control there is noise.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 9: Wire the picker into the Knowledge panel

**Depends on Tasks 5 and 6.**

**Files:**
- Modify: `src/app/knowledge-panel.tsx`
- Test: `src/app/knowledge-panel.test.tsx`

`targetKey` is a composite `"<kind>:<id>"` string or the sentinel `STANDALONE_KEY` (`"__standalone__"`). It is read at three places — the `isStandalone` check, the `targets.find(...)` lookup, and the `Select`'s `value` — and reset to `STANDALONE_KEY` on cancel. The picker must produce exactly the same values so nothing downstream changes.

- [ ] **Step 1: Write the failing tests**

In `src/app/knowledge-panel.test.tsx`:

```tsx
it("filters attach-to candidates by a typed query", async () => {
  const user = userEvent.setup();
  renderKnowledge({ tasks: [taskFix(1, "Ship the release"), taskFix(2, "Draft the plan")] });
  await user.click(screen.getByRole("button", { name: /add/i }));
  await user.type(screen.getByRole("combobox", { name: "Attach to" }), "ship");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option", { name: /Ship the release/ })).toBeInTheDocument();
});

// The wildcard comes free from filterPickerOptions/wildcardMatcher; this pins
// that the panel actually routes through them rather than doing its own match.
it("treats * as a wildcard in the attach-to search", async () => {
  const user = userEvent.setup();
  renderKnowledge({ tasks: [taskFix(1, "Ship the release"), taskFix(2, "Draft the plan")] });
  await user.click(screen.getByRole("button", { name: /add/i }));
  await user.type(screen.getByRole("combobox", { name: "Attach to" }), "*");
  expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(2);
});

it("selecting an option sets the composite kind:id target", async () => {
  const user = userEvent.setup();
  renderKnowledge({ tasks: [taskFix(7, "Ship the release")] });
  await user.click(screen.getByRole("button", { name: /add/i }));
  await user.type(screen.getByRole("combobox", { name: "Attach to" }), "ship");
  await user.click(screen.getByRole("option", { name: /Ship the release/ }));
  // The panel shows the chosen target rather than the empty label.
  expect(screen.getByText(/Ship the release/)).toBeInTheDocument();
});
```

★ `renderKnowledge` and `taskFix` are **not existing helpers**. This suite wraps with `FiltersProvider` / `WorkspaceProvider` / `WorkspaceTabProvider` and seeds settings through `localStorage` (it has an `enableSharePoint()` helper and an `afterEach` clearing storage). Read the file, copy the existing render shape verbatim, and build the two helpers from it. Also confirm the label really renders as `"Attach to"` — it comes from `documentsTarget`, so read the EN value rather than trusting this plan.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/knowledge-panel.test.tsx > "$SCRATCH/t9-red.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |Unable to find" "$SCRATCH/t9-red.log"
```

Expected: `VITEST_EXIT=1` — there is no combobox, only a native select.

- [ ] **Step 3: Add query state and filtering**

In `src/app/knowledge-panel.tsx`, beside the existing `targetKey` state:

```tsx
  const [targetQuery, setTargetQuery] = useState("");
```

Add the imports:

```tsx
import { SingleEntityPicker, type SingleEntityOption } from "./single-entity-picker";
import { filterPickerOptions } from "./picker-filter";
```

Build the option list and filter it with the shared engine:

```tsx
  // Standalone is a fixed entry, not a workspace entity, so it is prepended
  // rather than filtered — it must stay reachable whatever the query.
  const targetOptions: SingleEntityOption[] = useMemo(
    () =>
      targets.map((s) => ({
        value: `${s.kind}:${s.id}`,
        code: t(lang, SOURCE_LABEL[s.kind]),
        label: s.name,
      })),
    [targets, lang],
  );

  // `filterPickerOptions` already layers `wildcardMatcher` (the `*` wildcard)
  // over an `#id` exact match and a 20-item cap. Nothing is reimplemented.
  const visibleTargets = useMemo(
    () =>
      filterPickerOptions(targetOptions, {
        query: targetQuery,
        excludeIds: new Set<string>(),
        getId: (o) => o.value,
        getText: (o) => `${o.code} ${o.label}`,
      }),
    [targetOptions, targetQuery],
  );
```

★ `filterPickerOptions`' `getId` is used for the `#id` exact match; here the ids are composite strings, so `#task:1` is the only thing that would match exactly. That is harmless. Confirm the generic accepts a `string` id (read `picker-filter.ts`) — if it is constrained to `number`, drop `excludeIds`/`getId` to whatever the real signature permits rather than casting.

- [ ] **Step 4: Replace the Select**

Swap the `<label>`-wrapped `<Select>` for the picker. The label must stay a real accessible name — the picker takes `searchLabel`, so pass it there and drop the wrapping `<label>` rather than leaving a label bound to nothing:

```tsx
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-56">
              <SingleEntityPicker
                value={targetKey}
                selectedLabel={
                  isStandalone
                    ? t(lang, "knowledgeStandaloneOption")
                    : target
                      ? `${t(lang, SOURCE_LABEL[target.kind])}: ${target.name}`
                      : undefined
                }
                options={visibleTargets}
                query={targetQuery}
                onQueryChange={setTargetQuery}
                onSelect={(v) => {
                  setTargetKey(v);
                  setTargetQuery("");
                }}
                searchLabel={t(lang, "documentsTarget")}
                placeholder={t(lang, "knowledgeTargetSearchPlaceholder")}
                clearLabel={`${t(lang, "clear")} – ${t(lang, "documentsTarget")}`}
                emptyLabel={t(lang, "knowledgeStandaloneOption")}
              />
            </div>
```

★ The empty `""` option the native select carried has no equivalent here — `STANDALONE_KEY` is the real default (`useState(STANDALONE_KEY)`), and `""` was only ever a placeholder row. Confirm by reading whether any code path depends on `targetKey === ""`; if one does, add a fixed Standalone/none entry to `targetOptions` instead of relying on `emptyLabel`.

★ This suite already imports `expectNoLabelBoundToButton` from `../test/label-binding`. If the surrounding markup still has a `<label>`, make sure it is not left binding to the picker's input in a way that duplicates the accessible name — run that helper if the file's existing tests do.

- [ ] **Step 5: Run green**

```bash
npx vitest run src/app/knowledge-panel.test.tsx > "$SCRATCH/t9-green.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t9-green.log"
```

Expected: `VITEST_EXIT=0`, `Tests  27 passed` (24 + 3). If an existing test drove the old `<select>` with `fireEvent.change`, it will fail — rewrite it to drive the combobox, do not delete it.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/knowledge-panel.tsx src/app/knowledge-panel.test.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/knowledge-panel.tsx','utf8').split('\n').length)"
git diff HEAD --stat
git commit --only src/app/knowledge-panel.tsx src/app/knowledge-panel.test.tsx -F - <<'MSGEOF'
feat(knowledge): make Attach to a searchable single-select

The attach-to control was a native select over every task, RAID item,
change, milestone and stakeholder plus the project — a list that scales with
workspace size. It is now a searchable combobox.

Filtering routes through the shared filterPickerOptions engine, so the *
wildcard and #id matching come free rather than being reimplemented. The
value format is unchanged — the same composite "<kind>:<id>" string or the
STANDALONE_KEY sentinel — so nothing downstream of targetKey changes.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 10: File the two deferred follow-ups

**Files:**
- Modify: `docs/open-followups.md` (LF file — the Edit tool or a Write are both fine)

Two defects found while scoping and deliberately left out of this slice.

- [ ] **Step 1: Mint the numbers against `origin/main`, not against this branch**

A follow-up number is reserved only once it is on `origin/main`. A peer session holds an unlanded block starting at 390, so take numbers **above** it.

```bash
git fetch origin
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

Expected today: `389`. Ask the peer session what their highest minted number is, or read it off `origin/main` if their branch has landed, and take the next two above the higher of the two. If the peer's block is still unlanded and unknown, take **396** and **397**, leaving their 390-395 clear.

- [ ] **Step 2: Read the register's own entry format before writing**

```bash
grep -n -A 14 "^## 389\." docs/open-followups.md
```

Every open entry needs a `**Status:**` line carrying an ISO date that either cites a command or says `never machine-verified` — `followups-status-check` is a **blocking** CI gate. `never machine-verified` is a conforming and honest answer; do not invent a verification to satisfy it.

- [ ] **Step 3: Write both entries**

Match the surrounding format exactly. Content:

**First entry — the plural defect.**
`taskRowChangesBadge` is `"{0} changes"`, so a single linked change renders **"1 changes"** in the task row's ID column and on the Kanban card (`task-row.tsx` and `task-kanban-card.tsx` both render it). A plural-aware form needs a rule per language — DE pluralisation is not a suffix — so this is more than a string edit. Note that the badge was touched by the control-defects batch for `whitespace-nowrap` and the wording deliberately left alone. Status: `never machine-verified` — it is a wording defect visible by inspection, with no gate that can see it.

**Second entry — no Turso connection test exists.**
There is no test-connection capability for Turso anywhere in the repo; Jira and Timelog both have one. Consequently `canMoveToTurso` in `settings-sections/integrations-section.tsx`, and the newly disabled buttons in `projects-panel.tsx`, can only gate on configuration being **present**, never on it being **confirmed working** — which is what was originally asked for. Record the reproduce command that establishes the absence, and note that a persisted "confirmed" flag would be a new settings field and therefore the six-write-paths case, whereas a transient in-session result would not.

- [ ] **Step 4: Run the register gate**

```bash
npm run followups:status:check > "$SCRATCH/t10-followups.log" 2>&1; echo "EXIT=$?"
tail -5 "$SCRATCH/t10-followups.log"
```

Expected: `EXIT=0`. **Exit 1 is drift** (a missing or malformed Status line — write it). **Exit 2 means the gate could not scan at all** (an unreadable register, or zero entries parsed) — that is a different problem and must not be "fixed" by editing your entries.

- [ ] **Step 5: Commit**

```bash
git diff HEAD --stat
git commit --only docs/open-followups.md -F - <<'MSGEOF'
docs(followups): file the changes-badge plural and the missing Turso connection test

Two defects found while scoping the control-defects batch and deliberately
left out of it.

The changes badge renders "1 changes" for a single change; a plural-aware
form needs a per-language rule, so it is more than a string edit. And no
Turso connection test exists anywhere in the repo — Jira and Timelog both
have one — so Move-to-Turso can only be gated on configuration being
present, never on it being confirmed working.

Numbers minted above the peer session's unlanded block.

Claude-Session: https://[session link removed]
MSGEOF
git log -1 --format='%s'
```

---

## Task 11: Full gates

Run once, after every preceding task has landed. Nothing here is optional.

- [ ] **Step 1: Confirm the tree is yours alone**

```bash
git status --porcelain --untracked-files=all
git log --oneline origin/main..HEAD
```

Expected: only `sample-workspace-huge.json` (modified, never staged) and `not-in-use.env.local.bak` (untracked, never staged), plus your ten commits. Anything else is the peer's.

- [ ] **Step 2: Typecheck and lint the whole repo**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src; echo "LINT_EXIT=$?"
```

Expected: both `0`. `npx tsc --noEmit` exits **2** on diagnostics, not 1. `npm run lint` is avoided here because it exits 1 from gitignored leftovers in `.worktrees/` and `.demo-tmp/`.

- [ ] **Step 3: Full unit suite**

```bash
npm run test:run > "$SCRATCH/final-suite.log" 2>&1; echo "SUITE_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/final-suite.log"
```

Expected: `SUITE_EXIT=0`. This takes over ten minutes — do **not** background it and read a trailing pipe's status.

- [ ] **Step 4: Shuffled suite — this slice adds tests, so it is required**

```bash
npm run test:shuffle > "$SCRATCH/final-shuffle.log" 2>&1; echo "SHUFFLE_EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/final-shuffle.log"
```

Expected: `SHUFFLE_EXIT=0`. This is the only local reproduction of CI's `unit-tests-shuffled` job, and it shuffles both file order and test order within a file. Never run it concurrently with Step 3.

- [ ] **Step 5: Size ratchet**

```bash
npm run size:check; echo "SIZE_EXIT=$?"
```

Expected: `0`. The limit is 1600 and the script counts `split("\n").length`, i.e. `wc -l` + 1 — so a file at `wc -l` 1599 is already at the limit with zero headroom.

- [ ] **Step 6: Duplication and doc gates**

```bash
npm run dup:check; echo "DUP_EXIT=$?"
npm run docs:symbols:check; echo "SYMBOLS_EXIT=$?"
npm run docs:claims:check; echo "CLAIMS_EXIT=$?"
npm run followups:status:check; echo "FOLLOWUPS_EXIT=$?"
```

Expected: all `0`. `dup:check` compares the total duplicated-**line** percentage across all formats against the threshold in `package.json` — the new picker deliberately mirrors `entity-link-picker.tsx`, so if this goes red, read the report before assuming it is unrelated.

- [ ] **Step 7: Targeted axe run**

Two touched surfaces are in `A11Y_VIEWS`. Warm the route first, and pass `--workers=1` — `playwright.config.ts` runs at CPU count locally but `workers: 1` in CI, and over-subscription produces `Test timeout` failures that print no violation text and read like real defects.

```bash
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3000/
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Documents|Settings" > "$SCRATCH/final-axe.log" 2>&1; echo "AXE_EXIT=$?"
grep -E "passed|failed" "$SCRATCH/final-axe.log"
```

Expected: `AXE_EXIT=0`. If a failure names no rule id and no impact, it is contention, not a violation — re-run at one worker against a warm server before believing it.

---

## Task 12: Eye-verify — a gate, not a nicety

jsdom has no layout. **Nothing in the unit suite can see any of the six defects this slice is actually about.** Every assertion above pins a class, an attribute or a call; none pins a pixel. This step is where the slice is actually verified.

- [ ] **Step 1: Start a clean dev server**

Use an isolated port so a stale Tailwind build cannot produce phantom results:

```bash
PORT=3100 npm run dev
```

If `/icon-gallery` 404s or classes look stale, stop the server, `Remove-Item -Recurse -Force .next` (PowerShell — `rm -rf` is gate-blocked), and restart. **Do not disturb the dev server on port 3000** — it is the user's live-data tab.

- [ ] **Step 2: Check each item and record what you saw**

- [ ] **Open Points → a task row.** The Ask Claude sparkles icon sits fully inside its cell and does not touch the checkbox. Hover a row to reveal it.
- [ ] **Open Points → drag the ID column to its narrowest.** No badge wraps. The RAID badge reads as a single count (e.g. "3 RAID"), row height stays one line, and hovering the badge shows the R/A/I/D breakdown as a tooltip.
- [ ] **Projects tab with Turso unconfigured.** Both Turso buttons are visible and greyed. Hovering either shows the "Configure a Turso database…" hint — **this is the assertion the unit test cannot make**, because a disabled button dispatches no mouse events and only a real browser can tell you whether the wrapper's tooltip actually appears.
- [ ] **Documents → asset library.** The asset name reads as clickable and opens the preview. Confirm it is *discoverable* as a control, not just functional.
- [ ] **Knowledge → Add.** The Attach to combobox opens, filters as you type, `*` lists everything, and the whole flow is operable by keyboard alone: Tab in, ArrowDown, Enter, no mouse.
- [ ] **Documents → click an open document's name.** The body collapses, the panel reflows to its row content rather than leaving a gap, and clicking again restores it. Do this on the **first** document without selecting anything first — that is the case the guard exists for.

- [ ] **Step 3: Report**

Write down what you observed for each, including anything that looked wrong. An eye-verify that reports "looks fine" without naming what was checked is not evidence.

---

## Definition of done

- All twelve tasks complete, each committed separately.
- Every gate in Task 11 green, with exit codes read unpiped.
- Every mutation named in Tasks 3, 4, 5, 7 and 8 proved by reading which cases failed, with `N failed / M passed` recorded and the sum matching the file's runtime test count.
- Task 12's eye-verify performed in a real browser with observations written down.
- `git status --porcelain --untracked-files=all` shows only `sample-workspace-huge.json` and `not-in-use.env.local.bak`, neither ever staged.
- **No release, no version bump.** The slice ships separately on explicit say.
