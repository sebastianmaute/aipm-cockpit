# Help reading level + surface cleanup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Add a device-global Guided/Standard/Expert reading level driving concept primers and Help group order, and delete the dead `HELP_SECTIONS` export plus the two stale prose claims that made slice 2's premise wrong.

**Spec:** `docs/superpowers/specs/2026-08-05-help-reading-level-design.md`

**Architecture:** A pure `HelpReadingLevel` union + `helpGroupOrder(level)` in `help-content.ts`; an optional `readingLevel` prop on the presentational `HelpContentPane`; both Help surfaces read the value with a local `useSettings()`. Primers are optional `primerKey`s on the 12 concept entries, rendered and searched only at Guided.

**Tech stack:** TypeScript, React 19, Next 16, vitest, Testing Library, Playwright/axe.

**Standing constraints:** no push/MR/merge/version bump. `i18n.de.ts` never via the Edit tool. Gates serially, exit codes never through a pipe.

---

### Task 1: Level type, group order, and the dead-export cleanup

**Files:** Modify `src/app/help-content.ts`, `src/app/help-content.test.ts`

- [ ] **Step 1: Write failing tests** in `help-content.test.ts` — `helpGroupOrder` returns today's order for `guided` and `standard`, and `["features","automated","workflows","concepts"]` for `expert`; the returned array covers every `HelpGroup` exactly once at every level.
- [ ] **Step 2:** `npx vitest run src/app/help-content.test.ts` → FAIL, "helpGroupOrder is not a function".
- [ ] **Step 3: Implement** in `help-content.ts`:

```ts
export type HelpReadingLevel = "guided" | "standard" | "expert";

/** Group render order per reading level. Guided/Standard share today's order —
 *  they differ only in primers; Expert differs only in order (reference first).
 *  ★ Returns HELP_GROUP_ORDER BY REFERENCE for the first two — callers wanting
 *  a mutable array spread it. */
export function helpGroupOrder(level: HelpReadingLevel): readonly HelpGroup[] {
  return level === "expert" ? EXPERT_GROUP_ORDER : HELP_GROUP_ORDER;
}
```

- [ ] **Step 4:** delete `export const HELP_SECTIONS = …`, delete the `"HELP_SECTIONS is exactly the features group"` case, drop the name from the test's import, and correct the file header comment (the floating panel is not features-only).
- [ ] **Step 5:** `npx vitest run src/app/help-content.test.ts` → PASS. Then `npx tsc --noEmit` → 0 (proves nothing else imported the deleted export).
- [ ] **Step 6: Commit.**

### Task 2: Settings field + Appearance control

**Files:** Modify `src/app/settings-types.ts`, `src/app/settings-sections/appearance-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; test `src/app/settings-sections/appearance-section.test.tsx`

- [ ] **Step 1:** add to `Settings` with the comment recording that device-only is deliberate, and `helpReadingLevel: "standard"` to `defaultSettings`.
- [ ] **Step 2:** 5 i18n keys (label, hint, three options) in EN; DE via node UTF-8 write, then codepoint-verify.
- [ ] **Step 3:** failing test — the Appearance section renders three options and `onChange` receives the picked level.
- [ ] **Step 4:** add the `SegmentedControl<HelpReadingLevel>` next to `showViewHints`, with `ariaLabel`.
- [ ] **Step 5:** test PASS; `npx tsc --noEmit` → 0 (EN/DE key parity).
- [ ] **Step 6: Commit.**

### Task 3: Pane honours the level

**Files:** Modify `src/app/help-content-pane.tsx`, `src/app/help-menu.tsx`, `src/app/help-view.tsx`; test `src/app/help-content-pane.test.tsx`

- [ ] **Step 1: Failing test** — group headings render in Expert's order. ★ Assert the **rendered sequence**, not mere presence; a presence assertion passes against the unchanged order and is vacuous.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `readingLevel?: HelpReadingLevel = "standard"` on the pane; `helpGroupOrder(readingLevel)` replaces the direct `HELP_GROUP_ORDER` map. Both surfaces call `useSettings()` and pass it. Do NOT touch `ActionMenus`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit.**

### Task 4: Primers

**Files:** Modify `src/app/help-content.ts`, `src/app/help-content-pane.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; tests `help-content.test.ts`, `help-content-pane.test.tsx`

- [ ] **Step 1: Failing tests** — every `concepts` entry has a `primerKey`; a primer renders at Guided, is absent at Standard and Expert; a query matching primer-only text finds the entry at Guided and not at Standard.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `primerKey?: TranslationKey` on `HelpEntry`; 12 EN + 12 DE primers written **against the code each concept describes**; render above the body at Guided only, inside `rounded border border-line bg-surface-muted p-2`, through `parseHelpBody`; append the stripped primer to the search body only at Guided.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit.**

### Task 5: Gate reads primers

**Files:** Modify `src/app/help-content-gate.test.ts`

- [ ] **Step 1:** extend the marker loop to walk `e.primerKey` when present, in all three langs.
- [ ] **Step 2: Mutation-prove BOTH languages separately.** Inject an unresolvable marker into an EN primer → `en-US` + `en-GB` fail, `de` passes. Restore. Inject into the DE primer → `de` alone fails. Restore. ★ Restore by re-editing, never `git checkout <file>`.
- [ ] **Step 3: Commit.**

### Task 6: Docs

**Files:** Modify `docs/AGENTS/ui-shell.md`

- [ ] **Step 1:** replace the "stays features-only via the derived `HELP_SECTIONS`" sentence with what the code does, and record the reading level + primers. Removing the last backticked `HELP_SECTIONS` is required — `docs:symbols:check` fails on it once the export is gone, and the fix is removal, never an allowlist entry.
- [ ] **Step 2:** `npm run docs:symbols:check` → 0.
- [ ] **Step 3: Commit.**

### Task 7: Verify

- [ ] **Step 1:** serially — `npx tsc --noEmit`; `npx eslint --max-warnings=0 src/app`; `npm run test:run`; `npm run test:coverage`; `npm run dup:check`; `npm run size:check`; `npm run docs:symbols:check`; `npm run build`. Redirect to a file, echo `EXIT=$?` unpiped, then read the file.
- [ ] **Step 2:** axe on Settings against a fresh isolated server: `PORT=3100 npm run dev`, `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`, then `PORT=3100 npm run stop`.
- [ ] **Step 3:** eye-verify all three levels in the browser — Help is not axe-scanned, so this is the only coverage the rendered surface gets.
