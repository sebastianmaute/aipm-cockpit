# Eye-verify checklist, batch 20: §414 control defects

§414 (#274) owes a look at six control fixes that no test can fully judge. Batch 20 automated
everything a browser run can measure; what is left below is what only a person can judge: native
tooltips, taste calls on layout, and one item that needs a real Turso project. The entry closes on
your sign-off. Tick what you saw, and note anything that looks wrong beside its line.

**Screenshots:** run the spec once. It writes five PNGs to `eye-verify-output/batch-20/414/`
(git-ignored) and all six tests should pass.

```bash
npx playwright test e2e/control-defects-eye-verify.spec.ts --project=chromium --workers=1
```

**§219 is not repeated here.** Its image checks are still waiting in `docs/eye-verify-batch-19.md`.

## What the run already measured (no action needed)

- Item 1: over each disabled Turso button (Projects panel), the pointer lands on the wrapper that
  carries the hint, not on the button. Measured in Chromium and, on 2026-10-08, in Firefox (3 of 3).
- Item 2: the Ask-Claude glyph sits inside its own cell.
- Item 3: no badge in the ID cell breaks inside itself, at the default width or the narrowest.
- Item 4: re-clicking the open document's name collapses and expands its body.
- Item 5: the Knowledge "Attach to" picker works by keyboard alone. Typing opens the list, the arrow
  keys move through it, Enter picks, and Escape closes only the list: the add panel stays open and
  focus stays in the field.

## What needs your eyes

- [ ] **Item 1, the tooltip itself.** In the app, open **Projects** and hover **Load from Turso** and
  **Move to Turso** (both disabled without Turso set up). A tooltip explaining why should appear, in
  your usual browser, and in Firefox if you have it. The run proves the pointer reaches the hint,
  but no test can see a native tooltip appear.
- [ ] **Item 2.** `item2-row-with-ask-claude.png`: the sparkles icon sits in its own narrow cell
  and does not overlap the checkbox.
- [ ] **Item 3, a finding to rule on.** `item3b-id-cell-default.png`: with a Jira key and a document
  link on the same task, the badges do NOT sit on one line. They stack under the ID, one per line.
  `item3b-id-cell-narrowest.png`: after dragging the ID column as narrow as it goes, the column
  clips its content, so the ID and the Jira key are cut off. Say whether the stacking is fine, and
  whether the narrowest width should be wider (a fix would raise the ID column's minimum width).
- [ ] **Item 4.** `item4-documents-expanded.png` and `item4-documents-collapsed.png`: the panel
  reflows sensibly when the body collapses, and the underlined chevron next to the name reads well.
- [ ] **Item 6, needs a real Turso project.** In a Turso-backed project, open **Documents** and look
  at an image asset: its name should read as clickable (it opens a preview). In a file-based project
  the same name should read as plain text. Skip this line if you have no Turso project to hand, and
  say so.
