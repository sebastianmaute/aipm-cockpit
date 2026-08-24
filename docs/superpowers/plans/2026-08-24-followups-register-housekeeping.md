# Follow-ups Register Housekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two runtime defects a nine-agent audit of `docs/open-followups.md` uncovered, then correct the ~55 entries carrying false supporting claims and fix the register's four structural defects.

**Architecture:** Code first (Tasks 1–3) so a red gate is attributable before ~55 documentation edits land on top. Then register content (Tasks 4–9), then structure (Tasks 10–13), then the cross-doc sweep and release metadata (Tasks 14–15). The index table is regenerated LAST because it derives from the final heading set.

**Tech Stack:** Next.js 16.2.11 (exact-pinned), React, TypeScript, vitest 4.1.8, Playwright + axe-core 4.12.1, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-24-followups-register-housekeeping-design.md` (`5e7cef2a`)
**Base:** `main` @ `ec60348d` (0.258.1 "Mandelo") · **Branch:** `feat/followups-register-housekeeping`

---

## READ THIS BEFORE TASK 1 — four constraints that will silently ruin the work

**★★★ 1. `docs/open-followups.md` is ONE file and Tasks 4–13 all edit it. They are STRICTLY SERIAL.**
Never dispatch two of them concurrently. Two agents editing 15,516 lines of the same file produce a
merge neither reviewed. Run them one at a time, committing between each.

**★★★ 2. Line endings differ by file and getting it wrong is invisible in `git diff`.**
`docs/open-followups.md` and `AGENTS.md` are **LF-only**. Every `src/app/*.ts(x)` is **CRLF**.
`sed -i` under Git Bash re-lines a whole CRLF file to LF, and `core.autocrlf=true` hides it from the
diff. Do NOT use `sed -i` on any `src/` file. For `src/` edits use the Edit tool or a node utf8 write
whose anchor matches `\r\n`. Check any file you touched:
```bash
git ls-files --eol docs/open-followups.md src/app/task-manager.tsx
```
Healthy: `i/lf w/lf` for the doc, `i/lf w/crlf` for the source.

**★★★ 3. Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while
tests fail — that is `tail`'s status. Redirect, check unpiped, then read:
```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```
Use the session scratchpad, not `/tmp` — `/tmp` is shared across sessions and a peer's log has
overwritten one of ours before.

**★★★ 4. Never run two vitest processes at once.** A vitest red carrying `Failed to start forks
worker` is machine contention, not evidence. Re-run alone before believing any failure.

**★★ 5. `npx tsc --noEmit` exits 2 on diagnostics, not 1.** Test `-ne 0`, never `-eq 1`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/app/task-manager.tsx` | `getVersionPayload` key set — the Part 1a fix | 2 |
| `src/app/task-manager.restore-backfill.test.tsx` | round-trip pin for the six slices | 1, 2 |
| `e2e/a11y.spec.ts` | `COMBOS` — the Part 1b fix | 3 |
| `AGENTS.md` | axe scan arithmetic; §102 `aria-sort`; §91 popout claim | 3, 14 |
| `src/app/task-manager.popout-guard.test.tsx` | stale §91 comment | 14 |
| `docs/open-followups.md` | all entry + structural work | 4–13 |
| `docs/work-inventory.md` | S3c-2 "open" ×4 | 14 |
| `docs/AGENTS/documents.md` | S3c-2 "largest unbuilt piece" | 14 |
| `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | release metadata, nine ungated sites | 15 |

---

## Task 1: Round-trip test for the version-restore payload (RED)

**Files:**
- Modify: `src/app/task-manager.restore-backfill.test.tsx`

**★★★ WHY THIS TASK IS NOT OPTIONAL AND WHY THE OBVIOUS TEST IS VACUOUS.** That file already holds
a test named *"carries documentVersions through the restore funnel"* (`:125`). It calls
`applyRestored!(restored())` — handing the APPLY half a workspace that already contains
`documentVersions`. It never goes through `getVersionPayload`, which is the half that drops them. It
is green today while the defect is live. Writing another apply-only test reproduces that false green.
The pin must be a ROUND TRIP: `getVersionPayload()` → `jsonToWorkspace()` → `applyRestoredWorkspace()`.

- [ ] **Step 1: Extend the `use-version-history` mock to capture the payload getter**

The existing mock captures only `args.applyWorkspace`. `task-manager.tsx:1113-1114` passes both
`getPayload` and `applyWorkspace`. Add a second module-scoped capture beside `applyRestored`:

```tsx
let applyRestored: ((w: Workspace) => void) | null = null;
let getPayload: (() => string) | null = null;
```

and inside the `useVersionHistory` mock factory, alongside the existing `applyRestored` assignment:

```tsx
  useVersionHistory: (args: { applyWorkspace: (w: Workspace) => void; getPayload: () => string }) => {
    applyRestored = args.applyWorkspace;
    getPayload = args.getPayload;
```

- [ ] **Step 2: Add testids for the six slices to the `workspace-section` probe**

The probe already renders `ws-fks`, `ws-doc-versions` and `ws-activity-log`. Add one line inside the
same returned `<div>`, reporting all six slices at once so a single assertion covers the set:

```tsx
          <div data-testid="ws-six">
            {[
              `k:${ws.knowledgeItems.length}`,
              `i:${ws.insights.length}`,
              `d:${ws.documents.length}`,
              `dv:${ws.documentVersions.length}`,
              `so:${Object.keys(ws.settingsOverrides ?? {}).length}`,
              `ce:${ws.calendarEvents.length}`,
            ].join(",")}
          </div>
```

- [ ] **Step 3: Write the failing round-trip test**

Append inside the existing `describe("task-manager → applyRestoredWorkspace", …)`:

```tsx
  it("round-trips all six optional slices through getVersionPayload, not just applyWorkspace", async () => {
    // ★★★ The sibling documentVersions test above feeds applyRestored a workspace
    // that ALREADY carries the slice, so it passes while getVersionPayload drops it.
    // This one captures the payload the app would actually store, parses it back,
    // and only then restores — the shape a real version capture takes.
    render(<TaskManager />);
    await screen.findByTestId("ws-six", undefined, { timeout: 40000 });
    await waitFor(() => expect(getPayload).not.toBeNull(), { timeout: 40000 });
    await waitFor(() => expect(applyRestored).not.toBeNull(), { timeout: 40000 });

    // Seed all six non-empty through the restore funnel (which is NOT under test
    // here — the sibling tests pin it — it is just the cheapest way to populate).
    act(() => applyRestored!(sixSlicesWorkspace()));
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent("k:1,i:1,d:1,dv:1,so:1,ce:1"),
      { timeout: 40000 },
    );

    // Capture as the version-history hook would, then restore from that capture.
    const captured = getPayload!();
    act(() => applyRestored!(jsonToWorkspace(captured)));

    // Every slice must survive the capture. Before the fix this reads
    // "k:0,i:0,d:0,dv:0,so:0,ce:0" — the payload never carried them.
    await waitFor(
      () => expect(screen.getByTestId("ws-six")).toHaveTextContent("k:1,i:1,d:1,dv:1,so:1,ce:1"),
      { timeout: 40000 },
    );
  }, 45000);
```

- [ ] **Step 4: Add the fixture and the import**

Beside the existing `restored()` helper:

```tsx
const sixSlicesWorkspace = (): Workspace => ({
  ...restored(),
  knowledgeItems: [{ id: 1, title: "K", url: "https://x.test", source: "manual" }],
  insights: [{ id: "i1", kind: "risk", severity: "low", title: "I", detail: "d", createdAt: "2026-01-01T00:00:00.000Z" }],
  documents: [{ id: "d1", title: "D", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  documentVersions: [{ id: "11", docId: "d1", source: "ai", op: "restored", at: "2026-01-01T00:00:00.000Z", blocks: [] }],
  settingsOverrides: { defaultCurrency: "EUR" },
  calendarEvents: [{ id: 1, title: "E", start: "2026-01-01", end: "2026-01-01", kind: "meeting" }],
});
```

Add to the imports at the top of the file:

```tsx
import { jsonToWorkspace } from "./workspace";
```

★★ The literal shapes above must match today's `types.ts` / `workspace.ts` definitions. If `tsc`
rejects a field, fix the FIXTURE to match the real type — never widen the type to fit the fixture.

- [ ] **Step 5: Run the test and confirm it FAILS for the right reason**

```bash
npx vitest run src/app/task-manager.restore-backfill.test.tsx --reporter=dot > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Tests |ws-six|k:0" "$SCRATCH/t1.log"
```

Expected: FAIL, with the received text containing `k:0,i:0,d:0,dv:0,so:0,ce:0`. If it fails with a
type error or a missing testid instead, the test is broken — fix that before proceeding. If it
PASSES, stop: either the fixture is empty (making the assertion vacuous) or the defect is not what
the spec says.

- [ ] **Step 6: Typecheck — vitest never typechecks**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`. (Non-zero is 2, not 1, on diagnostics.)

- [ ] **Step 7: Commit the red test**

```bash
git add src/app/task-manager.restore-backfill.test.tsx
git commit -F - <<'EOF'
test(restore): pin the six optional slices through a real payload round trip

The sibling documentVersions test feeds applyRestored a workspace that already
carries the slice, so it is green while getVersionPayload drops it. This one
captures through getVersionPayload and parses back, which is the shape a real
version capture takes.
EOF
```

---

## Task 2: Fix `getVersionPayload` (GREEN)

**Files:**
- Modify: `src/app/task-manager.tsx` (the `getVersionPayload` `useCallback`, ~`:1034`)

- [ ] **Step 1: Add the six slices to the serialized object AND the dep array**

The current call serializes 18 slices. Add the six to both the object literal and the dependency
array — `react-hooks/exhaustive-deps` is severity 1 (a warning, not fatal), and CI runs bare
`npm run lint` with no `--max-warnings`, so a missed dep SHIPS GREEN. Add them by hand.

```tsx
  const getVersionPayload = useCallback(
    () => workspaceToJson({
      tasks, raid, absences, shifts, resources, roles, disciplines, grades,
      plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
      steeringCommittee, timelogLinks,
      knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents,
    }),
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades,
     plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
     steeringCommittee, timelogLinks,
     knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents],
  );
```

★★ `activityLog` stays OUT, and that is deliberate, not an oversight. It is storage-only on every
path — an entry's `changes` carries old/new values that must never reach a client-facing document —
and `applyRestoredWorkspace` has no `setActivityLog` binding by design. The existing test
"preserves the activity log across a version restore" pins that. Do not "complete the pattern".

- [ ] **Step 2: Update the comment above the callback**

It currently reads "Same field set the export handler and save effect use." Verify that is still true
after the change:

```bash
grep -n "workspaceToJson(" src/app/task-manager.tsx
```

If the export handler and save effect serialize a DIFFERENT set, the comment is now false — replace
it with what is actually true rather than leaving a claim nobody checked.

- [ ] **Step 3: Run the test — expect GREEN**

```bash
npx vitest run src/app/task-manager.restore-backfill.test.tsx --reporter=dot > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"; grep -E "Tests " "$SCRATCH/t2.log"
```
Expected: `EXIT=0`, all tests in the file passing (the four pre-existing plus the new one).

- [ ] **Step 4: Mutation-check the fix is load-bearing**

Remove ONE slice (`knowledgeItems`) from the object literal only, re-run, confirm RED, then restore
it. A guard that survives its own minimal mutant is pinning nothing.

★ `git checkout -- <file>` is DENY-BLOCKED in this session. Revert by an inverse anchored edit, then
prove the tree is clean:
```bash
git diff --stat   # must be empty for task-manager.tsx after reverting the mutant
```

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/task-manager.tsx; echo "LINT=$?"
```
Both `0`. ★ Use `npx eslint src` not `npm run lint` — the latter exits 1 from gitignored
`.worktrees/` and `.demo-tmp/` leftovers.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx
git commit -F - <<'EOF'
fix(restore): carry six optional slices in the version payload

getVersionPayload serialized 18 slices while applyRestoredWorkspace fans out
24, so knowledgeItems, insights, documents, documentVersions, settingsOverrides
and calendarEvents were each SET from a payload that never carried them —
blanked on every version restore.

activityLog stays out deliberately: storage-only on every path, and the restore
funnel has no setActivityLog binding by design.
EOF
```

---

## Task 3: Add umber-dark to the axe combo matrix

**Files:**
- Modify: `e2e/a11y.spec.ts` (`COMBOS`, ~`:48`)
- Modify: `AGENTS.md` (the axe scan arithmetic in the a11y hard-constraint bullet)

**Context:** `UMBER_DARK` is already imported (`:6`) and already wired into `SCHEME_SEED`
(`umber: { light: UMBER_LIGHT, dark: UMBER_DARK }`), and `BUILTIN_SCHEMES` marks umber
`supportsDark: true`. Only the `COMBOS` row is missing, so everything around it reads as covered.

- [ ] **Step 1: Add the row**

```ts
const COMBOS = [
  { scheme: "harbor",   dark: false },
  { scheme: "harbor",   dark: true  },
  { scheme: "meridian", dark: false },
  { scheme: "meridian", dark: true  },
  { scheme: "umber",    dark: false },
  { scheme: "umber",    dark: true  },
  { scheme: "beacon",   dark: false },
] as const;
```

- [ ] **Step 2: Re-derive the scan arithmetic — do NOT compute it by hand**

```bash
npx playwright test e2e/a11y.spec.ts --list > "$SCRATCH/axe-list.txt" 2>&1; echo "EXIT=$?"
tail -3 "$SCRATCH/axe-list.txt"
grep -c "a11y:" "$SCRATCH/axe-list.txt"
```

This needs no browsers and starts no server. Record both numbers: the total (tests) and the
`a11y:` count (scans).

- [ ] **Step 3: Update the AGENTS.md arithmetic with the measured numbers**

The bullet currently states "6 scheme COMBOS (harbor/meridian/umber/beacon, Beacon light-only) × 17
+ 6 Kanban-board variants (one per combo) + 1 notes-window … + 1 Documents block-editor … = **110**
axe scans … **111** tests total". Every one of those numbers moves. Replace them with what Step 2
measured, and correct the parenthetical — it is now
`harbor/meridian/umber L+D, Beacon light-only`. Keep the ★ telling readers to measure rather than
derive; it is the reason this was fixable at all.

- [ ] **Step 4: Run the umber-dark scans**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "umber" --workers=1 > "$SCRATCH/axe-umber.log" 2>&1; echo "EXIT=$?"
grep -E "passed|failed" "$SCRATCH/axe-umber.log" | tail -3
```

**★★★ `--workers=1` is mandatory whenever more than one view is matched.** `playwright.config.ts`
sets `workers: CI ? 1 : undefined`, so local runs go at CPU count — a contention mode CI never
exhibits. Over-subscribed, tests die on `Test timeout of 60000ms exceeded` inside `page.evaluate`,
printing as a FAILURE with a screenshot and zero violation text. A real violation names a rule id and
an impact; a contention failure names neither.

★ Warm the route first so the one-time Turbopack compile does not eat the 60s budget:
```bash
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3000/
```

- [ ] **Step 5: Decide on the result — do NOT drop the combo to get green**

If umber-dark PASSES: proceed.

If it FAILS with a real rule id and impact: **that is the finding, not a regression.** Keep the
combo. Record the failure as a new register entry in Task 9 and bring it to the user. Dropping the
row to get a green pipeline restores the exact blind spot this task exists to close.

- [ ] **Step 6: Commit**

```bash
git add e2e/a11y.spec.ts AGENTS.md
git commit -F - <<'EOF'
fix(a11y): scan umber-dark — the combo the matrix silently omitted

UMBER_DARK was imported and wired into SCHEME_SEED, and BUILTIN_SCHEMES marks
umber supportsDark, but COMBOS had no row for it — so umber-dark was scanned in
no view, ever, while everything around it read as covered.

Scan arithmetic in AGENTS.md re-derived from `--list`, not computed by hand.
EOF
```

---

## Tasks 4–13 — `docs/open-followups.md`

**★★★ STRICTLY SERIAL. One at a time. Commit between each.**

**★★★ Two conventions that govern every edit below:**

1. **Dated snapshots are APPENDED to, never rewritten.** §28's "Correction 2026-08-11", §32's
   "Measured 2026-08-10", §116's and §138's dated tables, §109's inventory figures are signed
   observations. The repo's convention — the banner on `docs/security/findings-2026-07.md`, which §13
   cites approvingly — is that rewriting a dated record to match today's tree destroys the only thing
   it is good for. Add a NEW dated line; leave the old measurement intact.
2. **A wrong number is a SYMPTOM. Go re-verify the CLAIM, never just renumber it.** Two entries in
   this register have now had the same four line numbers rot twice (§62), inside an entry whose own
   ★★ explains why they should have become symbols. Convert to symbol + grep; do not renumber.

**★★ `docs:claims:check` is a BLOCKING ratchet on `path:LINE` citations.** This work REMOVES
citations, which moves the count down — that is allowed. Re-baseline only after removal:
`node scripts/check-doc-claims.mjs --update`. Re-baselining to ADMIT a new citation defeats the only
thing the gate checks.

---

## Task 4: Close the four dead entries

**Files:** Modify `docs/open-followups.md`

- [ ] **Step 1: §9 — close, preserving the known loss**

Append `— CLOSED 2026-08-24 by \`92b3309c\`` to the §9 heading. Add a resolution paragraph:

> **Resolution 2026-08-24.** All four tables adopted the shared `SortResizeTh`, which supplies
> `aria-sort` itself. The table above reads 7/7/5/0; the tree reads 0/0/0/1, and the zeros are
> because the state now rides the shared component rather than a hand-rolled `<th>`. Verify:
> `for f in change-panel raid-panel-rows stakeholders-panel activity-log-panel; do grep -c "aria-sort" src/app/$f.tsx; done`
>
> ★★ The KNOWN LOSS survives the closure and is the reason this paragraph is not just a strikethrough:
> VoiceOver/Safari does not announce `aria-sort`, so a VO user went from hearing "Title ↑" to "Title".
> Standard-correct, and a real regression for that one AT. Do not re-litigate it as a pure win.

- [ ] **Step 2: §142 — close, preserving the mutation result**

Append `— CLOSED 2026-08-24` to the heading. Add:

> **Resolution 2026-08-24.** The remedy this entry listed under "options, none taken" was taken:
> `labelSuffix` is REQUIRED (`note-log-panel.tsx`, both the props type and the docstring), `null` is
> the explicit no-suffix sentinel, and `note-log-panel.test.tsx` holds a `@ts-expect-error` pinning
> omission as a compile error. The source cites §142 as the reason it is required.

Keep the entry's mutation-result paragraph — it is not recorded anywhere else.

- [ ] **Step 3: §212 — fix the heading, do NOT touch the body**

★★★ This is the ONLY heading/status mismatch in 223 entries. The body already says
`**Status:** CLOSED`; the heading has no marker, so the entry is invisible to every heading scan and
will be re-audited as open forever. Append `— CLOSED 2026-08-24` to the HEADING only.

- [ ] **Step 4: §87 — do NOT delete; split out its settled residual**

§87 is already closed and DELIBERATELY kept: *"Do not re-open this as a gap; if the tool is ever
removed, that is a new entry, not a revival of this one."* Leave it. Its open ★ ("that guard pairing
may itself be stale — not re-verified") is now settled and the answer is HALF — record that in the
entry, and open the residual as a new entry in Task 9:

> **Settled 2026-08-24.** `VIEW_AI_SCOPE.activity` WAS updated (`toolHints: ["search_history"]`,
> `readingRequiresTool`). `ASK_CLAUDE_PROMPTS.activity` was not: it is still asserted
> `toBeUndefined()` under the title "has no chips for the views whose read tools are deferred", and
> activity's read tool is no longer deferred. Split out as §<N>.

- [ ] **Step 5: Verify heading integrity is unchanged**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md          # expect 223
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | uniq -d   # expect empty
```

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): close three dead entries, fix the one heading/status mismatch

§9 and §142 describe defects whose fix shipped — §142's source cites the entry
as the reason the guard exists. §212's body said CLOSED while its heading did
not, the only such mismatch in 223 entries, so it was invisible to every
heading scan. §87 stays open-by-design; its settled residual splits out.
EOF
```

---

## Task 5: Correct the seven entries whose fix instructions are wrong

**Files:** Modify `docs/open-followups.md`

These send a reader to do wrong or duplicate work. Highest value in the slice.

- [ ] **Step 1: §113 — the title is false**

S3c-2 (OOXML media parts) shipped in 0.256.0. Rewrite the heading and the roadmap table row.
Replace the reproduced-in-full design text with a link — `docs/superpowers/` became tracked in
0.253.0, so `docs/superpowers/specs/2026-08-08-documents-roadmap-s3-s4-design.md` now resolves for
everyone. Delete the "the design document lives in the gitignored tree" apparatus.

**★★★ THE ONE ITEM THAT WAS STILL OPEN IS NOW MEASURED — RECORD THE RESULT, DO NOT SALVAGE IT AS
OPEN.** The entry's *"ONE MEASUREMENT CAN INVALIDATE THAT CAP AND IT HAS NOT BEEN TAKEN"* has been
discharged: Turso request size was measured successfully **up to 30 MB** (reported by the user
2026-08-24, out of band — see the provenance note below).

★★ Write it as a LOWER BOUND, never as the limit. "Succeeded at 30 MB" establishes capacity ≥30 MB;
it does not establish that 30 MB is the ceiling, and recording `= 30 MB` would be a claim nobody
measured. The entry's own instruction — "do not guess it" — applies to the upper end too.

★★ Record the headroom with the fact that makes it decisive: **every asset path carries exactly ONE
image per pipeline request**, in both directions. Verify:
```bash
grep -n "assetDataSelect\|assetDataUpsert\|assetDataIdsSelect" src/app/document-assets-store.ts
```
`assetDataUpsert(row)` takes a single row, `assetDataSelect(id, projectId)` a single id, and
`assetDataIdsSelect` returns ids only with no bytes. So the worst case is one 5 MB stored image
≈ 6.7 MB of base64 against ≥30 MB — roughly 4.5× headroom. The per-image cap does NOT drop and
uploads do NOT need chunking.

★★★ **§95 stays true and the entry must keep saying so.** This was a MANUAL measurement against a
real database. CI still cannot take it, so the figure has no gate behind it and will not be
re-checked when Turso changes its limits. That is the residual — a much smaller one than the entry
currently carries, but it is not nothing.

★ PROVENANCE: record who measured it, when, and against what (plan/region), or the number becomes
exactly the class of bare unreproducible claim this whole slice exists to remove. If the method is
not available, say "method not recorded" explicitly rather than implying one.

- [ ] **Step 2: §146 — widen the prescribed union from three members to four**

It enumerates three `onClose` callers and prescribes `("escape" | "outside" | "resize")`. There is a
FOURTH: the ancestor-scroll listener (`popover-panel.tsx`, the capture-phase `onScroll` registered
beside the resize one). Scroll-dismiss must NOT restore focus, so a fixer implementing the
three-member union has nowhere to put it. Change the prescription to four members and name the
scroll caller. Cite by symbol, not line.

- [ ] **Step 3: §190 — five call sites across three files, not four in one**

Correct "all four call sites in `document-block-editors.tsx`" to the real set:
`document-block-editors.tsx` (×3), `bullets-block-editor.tsx`, `document-table-editor.tsx`. Verify:
```bash
grep -rn "<BlockRefusalNotice" src/app --include=*.tsx
```
★ Also flag its derive-loop as vacuous ON ITS OWN SUBJECT: it excludes `document-block-notices.tsx`,
the file the entry is about, because that file holds a bare `role="status"` alongside an unrelated
`aria-live`. Add a ★★ saying so — a reproduce command that exits 0 and prints a plausible list is the
hardest kind to distrust.

- [ ] **Step 4: §189 — kill the false premise at its source**

`document-block-editors.tsx` is **659** lines, not 800. Verify with the gate's own arithmetic
(`wc -l` + 1):
```bash
node -e "console.log(require('fs').readFileSync('src/app/document-block-editors.tsx','utf8').split('\n').length)"
```
Re-run the entry's own "pressure is real, measured 2026-08-19" snippet in place and APPEND the new
dated reading beside the old one (do not overwrite — it is a dated measurement). Delete the sentence
claiming §188 "records a fix it cannot make room for": that clause is the root of a four-entry false
premise.

- [ ] **Step 5: §188 and §191 — remove the headroom blockers**

Both defer on "`document-block-editors.tsx` sits at exactly 800 of the 800-line cap". Delete that
clause from each. §191's Add-item control has also moved out to `bullets-block-editor.tsx`, so
nothing in its steps 1–2 is blocked at all — say so.

- [ ] **Step 6: §134 — six of seven flag, not five**

"`use-budget-buckets.ts` and `use-task-submit.ts` flag nothing" is false: `use-budget-buckets.ts` now
passes `isPrimary: true` WITH a comment giving this entry's own reasoning, and `use-undo-stack.ts`
records the fix. Only `use-task-submit.ts` remains.

- [ ] **Step 7: §135 — rewrite to the residual or close as superseded**

Its premise was killed by a redesign that recorded the OPPOSITE decision in source
(`dependencies-editor.tsx`, the `uniqueLinks` collapse and its comment block). The picker can no
longer mint a duplicate pair. What remains: a mixed-type pair arriving from the AI `update_task`
tool, an import, or a hand-edit is invisible and not individually removable. Rewrite to that, and
quote the source's own accepted-cost sentence.

- [ ] **Step 8: §204 — upgrade from probe to confirmed defect**

The entry poses a question; the audit settled it. `hardDeleteProjectStatements` loops `TABLE_NAMES`
only, and neither `chat_threads` nor `committee_report_versions` is an `ENTITY_SPECS` row, so
deleting a project leaves both tables' rows behind. Every `DELETE` in their schema modules is a
per-id delete or a retention pruner; no project-scoped sweep exists. Verify:
```bash
grep -rn "chat_threads\|committee_report_versions" src/app --include=*.ts | grep -v '\.test\.'
```
Rewrite from question to confirmed leak, naming `deleteAllAssetDataForProject` as the shape the fix
should take. **★★ Do NOT build the fix — it is an explicit non-goal of this slice.**

- [ ] **Step 9: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): correct seven entries whose fix instructions were wrong

§113's title says S3c-2 is open; it shipped in 0.256.0, and the live item
inside it — an untaken Turso request-size measurement — was buried under text
a reader would now distrust. §146 prescribed a three-member union with four
callers. §190 named four call sites in one file; there are five across three.
§189's 800-line measurement is 659 and was deferring §188 and §191. §134 and
§135 sent readers to fix what the code already decided differently. §204's
probe is settled: two tables leak on project delete.
EOF
```

---

## Task 6: Fix the seven reproduce commands that no longer answer their sentence

**Files:** Modify `docs/open-followups.md`

★★★ This is the class the repo's own "attach a command and RUN it" rule does not cover: each of these
EXITS 0 and prints something plausible. Run every replacement against the sentence it supports.

- [ ] **Step 1: §95 — its own recommended fix shipped**

`grep -rn ":memory:" src/app/*.test.ts  # no hits` now returns THREE hits;
`turso-schema.execute.test.ts` runs the real statement builders against `node:sqlite`. So "no test in
the repo opens a database, real or in-memory" is false. Rewrite down to the residual — *no test hits
a real Turso endpoint; SQL validity is now covered by `turso-schema.execute.test.ts`* — or close.
Also re-measure its "16 tests" figure or drop it.

- [ ] **Step 2: §98 — both positive controls return 0**

Its `sed` points at `workspace.ts`; the two counters live in `workspace-metrics.ts` (workspace.ts
only re-exports them). Repoint all four commands. ★★ Say in the entry what happened: the controls
existed specifically to stop "a zero from a broken pattern masquerading as a finding", and they
failed silently — that is the entry's own lesson, now demonstrated on itself.

- [ ] **Step 3: §28 — dead confirm command, stale sink census**

`grep -n 'TEXTAREA_MAX, "' src/app/sanitize-records.ts` returns nothing; the sink argument is now the
`RICH_SINK` constant. Repoint. The census says six sinks; `grep -rn "dangerouslySetInnerHTML" src/app
--include=*.tsx | grep -v "\.test\."` returns 17 lines / 8 real JSX sinks. ★ This entry is
security-adjacent — a reader auditing "five workspace sinks" is auditing a stale set. Its
"Correction 2026-08-11" is dated: APPEND a 2026-08-24 line, do not rewrite it.

- [ ] **Step 4: §214 — the enumerate command is wrong by two orders of magnitude**

`grep -rn -- "--max-warnings" AGENTS.md CONTRIBUTING.md docs/` returns **497** because `docs/` now
sweeps the tracked `docs/superpowers/`. The sentence says "roughly six". Scope it
(`| grep -v docs/superpowers/`) → 23, of which 16 are inside the entry itself. State both numbers.
★ Also: its pointer to "§45's eslint-10 bullet" lands on a heading reading
`~~brace-expansion advisory~~ — CLOSED in 0.211.1`; the material is genuinely in there, so say so or
the reader stops at the strikethrough.

- [ ] **Step 5: §209 — stale by two, and the repro returns one line**

The three byte-identical `IMG_TAG_RE` copies were consolidated into one shared declaration in
`document-export-assets.ts` by `e7b327a0`, AFTER this entry was written. Today it is THREE spellings
(shared `IMG_TAG_RE`, `ASSET_ID_RE`, `ASSET_IMG_RE`), not five. Its own grep returns one line because
the surviving declaration wraps. Fix the count, fix the grep, and re-scope the remaining ask to
`ASSET_ID_RE` ⟷ `ASSET_IMG_RE` — noting that is also §231's subject.

- [ ] **Step 6: §104 — the command lacks `-E`**

As written it is a literal search, matches nothing, exits 1, while the entry prints results beneath
it. With `-E` it returns two files the entry says do not exist (both comments). Add `-E` and reword
the claim to "no production *caller*".

- [ ] **Step 7: §173 — the anchor never existed**

`sed -n '/const adopt/,/^      }/p' src/app/use-chat-threads.ts` returns zero lines; there is no
`const adopt` at any indentation. The branch is real but lives in the load effect's `.catch`.
Replace with an anchored grep on `threadIdRef.current !== startedOn`.

- [ ] **Step 8: Run every replacement command and confirm it answers its sentence**

Not merely that it exits 0 — that a reader following it reaches the stated conclusion.

- [ ] **Step 9: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): repair seven reproduce commands that stopped answering

Each exited 0 and printed something plausible, which is the hardest kind to
distrust. §95's grep now returns the opposite of what the entry claims — its
own recommended fix shipped. §98's two positive controls both return 0, the
exact failure they were built to prevent. §28, §209 and §214 point at moved
symbols or unscoped trees; §104 lacks -E; §173's anchor never existed.
EOF
```

---

## Task 7: Correct the mechanism sentences overtaken by refactors

**Files:** Modify `docs/open-followups.md`

Fourteen entries whose substance is true but whose stated MECHANISM is false. A reader who checks the
reason and finds it wrong may discard the finding with it.

- [ ] **Step 1: Work through the list**

| § | false claim | truth |
|---|---|---|
| §6 | "retention is the last ~10 ops (`UNDO_CAP`)" | `UNDO_CAP = 25` — falsified by the SAME commit (`8a6d5093`) the entry cites for "(b) redo shipped". Re-cite the redo runners by symbol. |
| §7 | "both files still declare `function Field`" | `task-form-fields.tsx` now IMPORTS it; the two survivors have DIVERGED (`hint` vs `tooltip`, one takes `lang`), so the prescribed extract is a MERGE, not a lift. |
| §16 | "the same helper now serves all six rich register fields" | four call sites; the sibling mics append plain text to `title`/`name`, and the note log goes through the editor handle. |
| §37 | "the other two are the chat tools" | three other callers — the two chat tools plus `ai-project-proposal.ts`. Its own closing lesson is "trace the call sites". |
| §38 | "`NOTE_ALLOWED_ATTR` (`sanitize-html.ts:25`)" | no longer exists (removed per §137). The conclusion holds; the stated reason does not. |
| §39 | "the button carries a fifth `disabled` condition the handler does not" | the guard now includes `isMisconfigured`, with a comment saying it previously did not. §74 is CLOSED. Rewrite in past tense and close. |
| §51 | "retries against the 5000 ms `asyncUtilTimeout`" (twice) | it is **15000**. ★★★ Its headline rule "match on duration, not message" now points at a signature IDENTICAL to §39's, so it will actively cause a misdiagnosis on the next flake. Also `disabled` and `busy` are now split across two props. |
| §88 | "swap the remaining `<span>` to `<h3>`" | three of four mount surfaces supply no `<h2>`, so an `<h3>` trips axe heading-order. The sibling took `role="group"` + `aria-labelledby` for exactly that reason. |
| §91 | "a popout undo persists a line that survives the window closing" | the localStorage writer is GONE; `use-storage-backend.ts` names §91 as fixed and guards on `isPopout`. Severity drops from data-corruption to popout-local. |
| §102 | "all seven set `aria-sort` … `grep -c` → 7" | returns **0** — RAID adopted `SortResizeTh`, which supplies it. The double-announcement premise is dead too. |
| §124 | its correction paragraph's `useEffect` line set and dep array | both changed; the argument's evidence no longer matches the source it cites. |
| §131 | "`check-file-sizes.mjs` and `check-agents-symbols.mjs` still have none" | `agents-symbols-lib.test.mjs` exists. Only `check-file-sizes.mjs` is untested. |
| §132 | "`CaptureCompositeOpts` does not carry `entityKey`" | it does — and the call site's own comment says so. The conclusion survives. |
| §151 | "the eight assertions sit in AGENTS.md — the always-loaded file" | **ZERO** in AGENTS.md; they moved to `docs/AGENTS/rich-text.md` in the split, which INVERTS the urgency argument. Re-tally the sweep (25 paths, not 22). |
| §158 | quotes a test title that no longer exists | the real title is the one its OWN repro two paragraphs earlier uses — pre-correction wording surviving inside the correction. |
| §174 | "the `available` work never mentioned this one" | the source now rules on it explicitly, so the entry is a counter-argument to a documented decision, not a report of an oversight. Rewrite the premise; the finding stands. |
| §180 | "THREE routes re-store such a row split" | §226 closed 2026-08-24. TWO. |
| §211 | "only ever emits `ALTER TABLE … ADD COLUMN`" | it also emits `RENAME COLUMN`. Conclusion unaffected — a rename cannot change a type either — but "only" is what a reader checks. |

- [ ] **Step 2: For each, verify the replacement against the tree before writing it**

★★★ A correction is a NEW claim and inherits none of the verification of the thing it corrects. This
repo has measured a correction round introducing six new errors while fixing eight. Run a command
against the REPLACEMENT text, not only against the error you found.

- [ ] **Step 3: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): correct mechanism sentences overtaken by refactors

Eighteen entries state a reason that is no longer true while their finding
still is — a reader who checks the reason may discard the finding with it.
§51 is the sharpest: asyncUtilTimeout is 15000, not the 5000 it states twice,
so its "match on duration, not message" rule now points at a signature
identical to §39's and would cause a misdiagnosis. §151's whole urgency
argument rests on assertions that are no longer in the always-loaded file.
EOF
```

---

## Task 8: Mechanical count and cite drift

**Files:** Modify `docs/open-followups.md`

- [ ] **Step 1: Convert `path:LINE` citations to symbol + grep wherever the symbol is stable**

★★★ §62 has now had the SAME four line numbers rot TWICE, inside an entry whose own ★★ explains why
they had to become symbols. Drop them, do not renumber. Same for §1, §8, §10, §41, §46, §68, §93,
§101, §109, §110, §122, §125, §126, §128, §153, §201, §229.

- [ ] **Step 2: Fix the three counts that change what someone would DO**

- **§44** — ★★★ both reserved codenames are SPENT. `grep -n "Bodard" CHANGELOG.md` → `0.246.0
  "Bodard"`. The entry says it is free. Discovered at release time otherwise. S6 needs a new name.
- **§40** — section B claims 18 sites; `grep -rho "hover:text-ui-dark-blue" src --include=*.tsx
  --include=*.ts | wc -l` returns **28**, with TEN files unnamed. ★★ This is the THIRD recurrence of
  the exact failure the entry's own ★★★ records ("listed three sites and implied that was the
  remainder"). Say so in the entry — the pattern is the finding.
- **§109** — its Gantt bullet is DONE (all eight `ToggleButton`s carry hints; strike it), and its
  "still 17 untitled controls" now names a different row of its own re-measured inventory. The real
  open surface is 11.

- [ ] **Step 3: Refresh the remaining figures, APPENDING where the reading is dated**

§13 (the entry says "the app is 0.203.0" — it is 0.258.1, so the audit gap it describes is 55
releases wider) · §52 · §56 (it says "5 of the 6 combos"; it is 6 of 7, and Task 3 has now made it
7 of 7 — record both) · §60 (its one actionable residual is already resolved; delete that bullet) ·
§61 · §94 (★★ every citation points at `doc-render-pptx.ts`; the constant and the reasoning live in
`doc-render-pptx-slides.ts` — post-extraction drift, re-cite by symbol) · §116 (its deferral target,
"decide during S3b planning", expired four slices ago — re-hang it on a live trigger or close) ·
§128 · §133 (repro says 4 lines, returns 3) · §138 (its dated table's deltas more than double P4's
sizing; its owed `src/` sweep is now a NO-OP — discharge it) · §153 (`CHANGES_CSV_COLUMNS` is 21, and
the re-derive recipe names `*_CSV_COLUMNS` where the real symbols are `CSV_COLUMNS`,
`MILESTONES_CSV_COLUMNS`, `CHANGES_CSV_COLUMNS`) · §201 (drop the literal byte offset; let the
command output stand) · §205 (it quotes `content: "⚠"`; the source holds `"\26A0\FE0E "` — VS-15 text
presentation, which is precisely what its owed eye-verify must judge) · §229.

- [ ] **Step 4: §139 — add the trap it does not warn about**

Four entity editors already render a field group named `DocumentLinksGroup`, LABELLED
`t(lang,"documents")`, behind the `documentLinks` visibility key. It is NOT this door — it wraps
`KnowledgeLinksFieldGated` and binds `draft.knowledgeLinks`, not `ProjectDocument.linkedEntities`.
Anyone grepping for "document links in an entity editor" finds it and concludes the door exists, and
whoever builds the real one must put a SECOND "Documents" section in the same modal. Say so.

- [ ] **Step 5: Run the claims gate**

```bash
npm run docs:claims:check > "$SCRATCH/claims.log" 2>&1; echo "EXIT=$?"; tail -5 "$SCRATCH/claims.log"
```
The citation count must go DOWN or hold. If it went UP, a conversion added a citation instead of
removing one — find it rather than re-baselining.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): convert rotted cites to symbols, correct the counts that matter

§44 says a release codename is free; CHANGELOG spent it in 0.246.0, which
would otherwise be found at release time. §40's section B claims 18 sites
against 28, with ten files unnamed — the third recurrence of the failure that
entry's own three-star note records. §62's four line numbers have now rotted
twice inside an entry explaining why they should be symbols; they are symbols.
EOF
```

---

## Task 9: Open the nine missing entries

**Files:** Modify `docs/open-followups.md`

**★★ Numbers are provisional.** A register number is reserved only once it is on `origin/main`, and
`feat/timelog-booking-review-tl1` is unmerged with a colliding §225. Re-check the max immediately
before the MR:
```bash
git fetch origin --quiet && git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

- [ ] **Step 1: Write the two entries this slice CLOSES**

§232 — the version-restore blanking (Task 2). §233 — umber-dark unscanned (Task 3). Both open AND
closed here, with the fix commit named. ★ Record in §232 that the pre-existing sibling test was
green while the defect was live, and why: it fed the apply half a workspace that already carried the
slice. That is the reusable lesson.

- [ ] **Step 2: Write the seven genuinely-open entries**

| § | subject |
|---|---|
| §234 | Four critical flows with ZERO E2E coverage — Jira sync, storage-backend switching, voice commands, OOXML export (`CONTRIBUTING.md:444`). The register carries e2e gaps elsewhere (§99, §171, §215), so a reader concludes coverage is mapped. |
| §235 | The inline task-status dropdown writes no activity-log entry. `use-task-row-handlers.ts` has exactly one `logActivityRef.current(` call and it is `"task.deleted"`. The fastest path to completing a task leaves no audit record while the form save and the AI tool both log; §163 reconstructs completion trends from that log. |
| §236 | Five ungated version-carrying files — `package.json`, `package-lock.json` (×2), the README shields badge (version AND codename), the header on all five `docs/CODEMAPS/*.md`. Already drifted six and eleven releases. |
| §237 | Two more "the AI cannot read X" gaps — `Stakeholder.raci` absent from `StakeholderSummary` and `MilestoneSummary`; `get_dashboard_snapshot` is active-project-only. Joins the §86/§87/§89 family. |
| §238 | The HTML/PDF inline sink charges the 25 MB budget for an asset it then draws as a placeholder. `sanitizeDocumentAsset` does not enforce the mime allowlist on load. §223 is CLOSED and argues the load path is not the bug, leaving this consequence homeless. |
| §239 | `sample-workspace-{big,huge}.json` carry a regeneration duty nothing enforces — regenerate when a SANITIZER changes what a field serializes to, not only when the master changes. |
| §240 | A user custom scheme can pin `--ui-green-strong` (it is in `ADVANCED_TOKENS`) and skip AA derivation. Accepted escape hatch; the register carries every other one of its class. |

Plus the §87 residual from Task 4 Step 4 (the mislabelled `ASK_CLAUDE_PROMPTS.activity` chip test).

- [ ] **Step 3: Give every entry a reproduce command, and RUN it**

An entry without one is the class this whole audit found rotting. Each command must answer the
sentence it is attached to — not merely exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): register nine gaps recorded everywhere but here

A cold hunt across AGENTS.md, docs/AGENTS/*, CONTRIBUTING.md, the tech-debt
register and test skips found nine pieces of open work with no entry. The
sharpest was a Turso version restore blanking six workspace slices, recorded
only in a load-on-demand subsystem file whose code comment pointed at AGENTS.md
with no section number to follow.
EOF
```

---

## Task 10: Move the three closing sections to EOF

**Files:** Modify `docs/open-followups.md`

★★★ `## Decided — do not re-litigate`, `## Provenance` and `## Standing notes` sit at 36–40% of the
file, and **§99, §100, §101 and §102 are stranded INSIDE `Decided`** — four live entries, including
§100 (a measured WCAG 2.1.1 keyboard trap), filed under a heading telling readers not to reconsider
them. Global numbering is already strictly ascending, so this is a pure block move.

- [ ] **Step 1: Record the invariants BEFORE the move**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | uniq -d
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" > "$SCRATCH/order-before.txt"
wc -l docs/open-followups.md
```

- [ ] **Step 2: Move the three sections to EOF, leaving §99–§102 in the numeric run**

Cut each `## ` section from its heading to the line before the next `## ` heading, and append all
three at the end of the file in their original relative order. §99–§102 stay where their numbers put
them.

- [ ] **Step 3: Prove the move changed nothing but placement**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md                                  # same as before
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" > "$SCRATCH/order-after.txt"
diff "$SCRATCH/order-before.txt" "$SCRATCH/order-after.txt"; echo "ORDER_DIFF=$?"
sort -n "$SCRATCH/order-after.txt" | diff - "$SCRATCH/order-after.txt"; echo "ASCENDING=$?"
wc -l docs/open-followups.md                                                     # same as before
```
`ORDER_DIFF=0` and `ASCENDING=0`. A changed line count means content was lost in the cut.

- [ ] **Step 4: Verify line endings survived**

```bash
git ls-files --eol docs/open-followups.md    # must read i/lf w/lf
```

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): move the closing sections to the end, where they belong

Decided / Provenance / Standing notes sat at 36-40% of the file with 129 of
the 150 open entries below them, so a reader hitting "Decided — do not
re-litigate" reasonably concluded the register ended there. Worse, §99-§102
were stranded INSIDE Decided — four live entries, one a measured WCAG 2.1.1
keyboard trap, filed under a heading telling readers not to reconsider them.

Pure block move: heading count, order and total lines all unchanged.
EOF
```

---

## Task 11: Fix the header's false claims

**Files:** Modify `docs/open-followups.md` (the 231-line header; §1 starts at L232)

- [ ] **Step 1: The `docs/baselines/` census**

It names TWO files. `ls docs/baselines/` returns FIVE: `doc-line-cites.json`, `file-sizes.json`,
`followup-claims.json`, `jscpd-2026-07.json`, `ooxml-parts.json`. ★★ One of the three unlisted is
`followup-claims.json` — **this register's own gate baseline**, which the header does not know
exists. Two more are live gate inputs, so the surrounding "★ Only the FIRST is a live gate input" is
false three ways. ★ Replace the census with the command that DERIVES it — a hand-maintained list
re-rots on the next baseline added.

- [ ] **Step 2: The `AGENTS.md at §22 and §28` attribution**

AGENTS.md cites NEITHER. §22 moved to `docs/AGENTS/rich-text.md`, §28 to `docs/CODEMAPS/data.md` —
the same 2026-08-04-split rot as §151. The claim was true when written. Either re-point it or, better,
replace it with the grep that derives it.

- [ ] **Step 3: The gitignore-sweep command**

```bash
grep -cniE "superpowers.{0,80}(gitignor|local-only|one machine|not in the repo)" docs/open-followups.md
```
★★★ It returns 0 for BOTH entries its own sentence names as "the sharpest cases" (§44, §113) — they
say "gitignored" without `superpowers` within 80 chars. True surface is 7 entries across 16 lines;
the command under-reports ~4×. Widen it, re-run it, and state the real number. ★ Note it matches the
header's own text — account for that in the figure you quote.

- [ ] **Step 4: The superpowers corpus counts**

"218 specs and 238 plans" → derive today's:
```bash
ls docs/superpowers/specs | wc -l; ls docs/superpowers/plans | wc -l
```

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): correct four false claims in the register's own header

The baselines census named two files where five exist — one of them this
register's own gate baseline, which the header did not know about. The
"AGENTS.md at §22 and §28" attribution points at a file that cites neither
since the 2026-08-04 split. And the gitignore-sweep command returns zero for
both entries the sentence beside it names as the sharpest cases.

Censuses replaced with the commands that derive them.
EOF
```

---

## Task 12: Unify the status convention

**Files:** Modify `docs/open-followups.md`

★★★ Status is recorded two incompatible ways: **59 of 60 closed entries mark it in the HEADING**
(`— CLOSED <date>`, usually struck through) and carry no `**Status:**` line; newer entries use a
bolded `**Status:**` line. Consequence: **"N open" is not reproducible** — a hand count and a heading
regex disagree by twelve, and §212 went stale invisibly because its status lived in a form nothing
scans.

- [ ] **Step 1: Adopt the HEADING form as canonical**

It is what 59 of 60 closed entries already use and what every scan reads. Every closed entry's
heading carries `— CLOSED <date>`; a `**Status:**` line may remain as detail but is never the only
marker.

- [ ] **Step 2: Sweep every entry carrying a `**Status:**` line**

```bash
grep -nE "^\*\*Status:\*\*" docs/open-followups.md
```
For each, if it says CLOSED, ensure the heading says so too.

- [ ] **Step 3: Fix the in-file contradiction**

One line says "that is §115, **still open**" while §115's heading reads `CLOSED 2026-08-13 by §140`.
```bash
grep -n "§115" docs/open-followups.md
```

- [ ] **Step 4: Prove the open count is now reproducible**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md                                    # total
grep -E "^## [0-9]+\." docs/open-followups.md | grep -cvE "CLOSED|~~"             # open
npm run followups:check > "$SCRATCH/fu.log" 2>&1; echo "EXIT=$?"; grep "open entries" "$SCRATCH/fu.log"
```
The heading-regex open count and `followups:check`'s own figure must now AGREE. If they do not, the
convention is not yet uniform — find the outlier rather than picking a number.

- [ ] **Step 5: Document the convention in the header**

One short paragraph: closure lives in the heading; `**Status:**` is detail, never the sole marker.
Without this the next entry re-introduces the split.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): one status convention, so "N open" becomes reproducible

Status lived in the heading for 59 of 60 closed entries and in a bolded Status
line for the newer ones, so a hand count and a heading regex disagreed by
twelve and no "N open" figure for this register could be trusted. §212 went
stale invisibly for exactly this reason. Heading is now canonical, and the
header says so.
EOF
```

---

## Task 13: Regenerate the index table

**Files:** Modify `docs/open-followups.md`

**★★ Do this LAST.** It derives from the final heading set, which Tasks 4–12 change.

Today it covers **124 of 223 entries (56%)** — the newest 79 have no row — contradicts the headings
in five cases (§22, §50, §54, §112, §115 say open in the row and `CLOSED <date>` in the heading), and
calls a range "CONTIGUOUS" that skips §102.

- [ ] **Step 1: Generate a complete row set from the headings**

```bash
grep -nE "^## [0-9]+\." docs/open-followups.md \
  | sed -E 's/^([0-9]+):## ([0-9]+)\. (.*)$/| §\2 | \3 |/'
```
Every entry gets a row; state derives from the heading, so it cannot contradict it.

- [ ] **Step 2: Decide the HALF-CLOSED rows — this needs judgment, not a script**

§64, §65 and §117 are partially closed, where "row says open" is defensible. Pick one rendering and
apply it consistently.

- [ ] **Step 3: Make it double as the TOC**

The file has **zero anchor links** and no table of contents, so finding §142 today means scrolling to
~L9,300. Add GitHub-style anchors (`[§142](#142-…)`) so the table is navigable.

- [ ] **Step 4: Delete the "CONTIGUOUS run" paragraph**

It is self-falsifying (§102 has no row inside the range it calls contiguous), silent on §153–§231,
and its three-instances-of-drift warning is under-scoped by 79 entries. A generated table makes it
unnecessary.

- [ ] **Step 5: Verify the table matches the headings exactly**

```bash
grep -oE "^\| §[0-9]+" docs/open-followups.md | grep -oE "[0-9]+" | sort -n > "$SCRATCH/rows.txt"
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n > "$SCRATCH/heads.txt"
diff "$SCRATCH/rows.txt" "$SCRATCH/heads.txt"; echo "TABLE_MATCHES=$?"
```
`TABLE_MATCHES=0`.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): generate the index table from the headings, and make it a TOC

It covered 124 of 223 entries, contradicted five headings outright, and called
a range contiguous that skips §102 — a half-table that disagrees with the
entries is worse than none, and it was the only finder in a file 15,000 lines
deep with no anchors. Rows now derive from headings and carry anchors.
EOF
```

---

## Task 14: Sweep the other docs this slice falsifies

**Files:** `docs/work-inventory.md` · `docs/AGENTS/documents.md` · `AGENTS.md` ·
`src/app/task-manager.popout-guard.test.tsx`

★★★ A behaviour change falsifies prose in files nobody assigned. Four known targets:

- [ ] **Step 1: S3c-2 is not unbuilt**

```bash
grep -n "S3c-2\|largest unbuilt" docs/work-inventory.md docs/AGENTS/documents.md
```
`work-inventory.md` says "no OOXML media-part code exists anywhere in the renderers", "S3c-2 …
remains open", and lists it as next; `docs/AGENTS/documents.md` calls it "the largest unbuilt piece".
It shipped in 0.256.0.

- [ ] **Step 2: AGENTS.md's `aria-sort` line (the §102 change)**

It says `raid-panel-rows.tsx` keeps "▲/▼ inside the button's name". RAID adopted `SortResizeTh`,
which removed the glyph from the accessible name.
```bash
grep -n "raid-panel-rows" AGENTS.md
```

- [ ] **Step 3: The stale §91 claim in a TEST COMMENT**

`task-manager.popout-guard.test.tsx` carries "PERSISTS a line that outlives the window". The
localStorage writer is gone. ★★ This file is CRLF — use the Edit tool or a node utf8 write matching
`\r\n`, never `sed -i`.

- [ ] **Step 4: Verify no other doc restates what this slice changed**

```bash
git grep -n "getVersionPayload\|UMBER_DARK" -- '*.md'
```

- [ ] **Step 5: Run the symbols gate**

```bash
npm run docs:symbols:check > "$SCRATCH/sym.log" 2>&1; echo "EXIT=$?"; tail -3 "$SCRATCH/sym.log"
```
★★ It scans `AGENTS.md` + `docs/AGENTS/*.md` only — 13 files. It does NOT scan
`docs/open-followups.md`, so it cannot catch a bad symbol name introduced in Tasks 4–13. Grep those
by hand.

- [ ] **Step 6: Commit**

```bash
git add docs/work-inventory.md docs/AGENTS/documents.md AGENTS.md src/app/task-manager.popout-guard.test.tsx
git commit -F - <<'EOF'
docs: sweep prose this slice falsified

S3c-2 shipped in 0.256.0 and four places still called it unbuilt. AGENTS.md
still described raid-panel-rows keeping a sort glyph in the accessible name,
which SortResizeTh removed. A popout-guard test comment still described a
localStorage writer that no longer exists.
EOF
```

---

## Task 15: Release metadata and final gates

**Files:** `src/app/version.ts` · `CHANGELOG.md` · `package.json` · `package-lock.json` ·
`README.md` · `docs/CODEMAPS/*.md`

- [ ] **Step 1: Bump to 0.259.0 across all nine sites**

This ships runtime code, so it is a real bump. ★★ FIVE sites beyond `version.ts` carry the version
and **no gate checks any of them**: `package.json` `version`, `package-lock.json` (root `version`
AND `packages[""]`), the README shields badge (version **and** codename), and the
`<!-- Generated: … | App <version> "<codename>" … -->` header on all five `docs/CODEMAPS/*.md`.
Bump them in the SAME commit or the drift restarts — this has already run six and eleven releases.

★ Pick a codename that is NOT already spent: `grep -n '"<name>"' CHANGELOG.md` must return nothing.
§44's two reserved names are both gone (Task 8).

- [ ] **Step 2: CHANGELOG entry**

★★ NEVER a `[session link removed]...` URL in `CHANGELOG.md` or an MR description.

- [ ] **Step 3: Run the full local gate chain, each unpiped**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint src; echo "LINT=$?"
npm run size:check > "$SCRATCH/size.log" 2>&1; echo "SIZE=$?"
npm run dup:check > "$SCRATCH/dup.log" 2>&1; echo "DUP=$?"
npm run docs:symbols:check > "$SCRATCH/sym.log" 2>&1; echo "SYM=$?"
npm run docs:claims:check > "$SCRATCH/claims.log" 2>&1; echo "CLAIMS=$?"
npm run followups:check > "$SCRATCH/fu.log" 2>&1; echo "FU=$?"
npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "SUITE=$?"; grep -E "Test Files|Tests " "$SCRATCH/suite.log"
```
★ `tsc` returns 2 on diagnostics. ★★ Run the suite ALONE — no other vitest process.

- [ ] **Step 4: Run the shuffled suite — the only local reproduction of that CI gate**

```bash
npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " "$SCRATCH/shuffle.log"
```

- [ ] **Step 5: Re-check the follow-up numbering against origin/main before the MR**

```bash
git fetch origin --quiet
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```
If main has advanced past 231, renumber this slice's new entries **DESCENDING** to avoid collisions
mid-edit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F - <<'EOF'
chore(release): 0.259.0

Version bumped across all nine sites, including the five no gate checks.
EOF
```

- [ ] **Step 7: STOP. Do not push, open an MR, or merge.**

★★★ Standing instruction: no push, MR, or merge without the user's explicit say-so. "Release" means
push → MR → poll → merge-on-green, and it must be asked for. Never `--auto-merge`.

---

## Self-Review

**Spec coverage.** Part 1a → Tasks 1–2. Part 1b → Task 3. Part 2a → Task 4. Part 2b → Task 5.
Part 2c → Task 6. Part 2d → Task 7. Part 2e → Task 8. Part 3 → Task 9. Part 4a → Task 10.
Part 4b → Task 11. Part 4c → Task 13. Part 4d → Task 12. Verification section → Tasks 14–15.
No gaps.

**Placeholder scan.** No TBD/TODO. Every code step carries real code; every entry correction names
the false text and the true replacement. Task 13 Step 2 and Task 3 Step 5 are flagged as
judgment calls with the decision criteria stated, not deferred.

**Type consistency.** `getPayload` is captured in Task 1 Step 1 and used in Step 3 under the same
name. `sixSlicesWorkspace()` is defined in Step 4 and called in Step 3 — note the ordering, and that
its literal shapes must be checked against today's types rather than trusted. `ws-six` is created in
Step 2 and asserted in Step 3. `jsonToWorkspace` is imported in Step 4.

**One known risk, stated rather than hidden.** Task 3 Step 5 can go red, and that red is the fix
working. Dropping the combo to get green restores the blind spot. It goes to the user.
