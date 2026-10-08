# Eye-verify checklist, batch 16

Checks that need a person looking at the app. Each is owed by an open register entry
(`docs/open-followups.md`), and no test in this repo can make it: jsdom has no layout, and the
axe gate cannot judge whether something *reads* right.

**How to use it.** Run the kit, then go down the list. Tick a line when it looks right; when it
does not, note what you saw beside it. An entry closes on your sign-off, so a ticked section is
what lets it close.

```bash
PORT=3150 EYE_VERIFY=1 npx playwright test e2e/eye-verify-batch-16.spec.ts --project=chromium --workers=1
```

The kit saves one screenshot per surface to `eye-verify-output/batch-16/` (git-ignored). It skips
in CI and in any run without `EYE_VERIFY=1`. A line marked **by hand** has no screenshot: the
surface needs something the seeded browser cannot provide, such as a model turn, Word, or dark mode.

## §677: Reports, "By priority" (#595)

- [ ] `01-reports-by-priority.png`: the tiles in the "By priority" block are not cut off at the
  bottom. The batch 14 probe measured a 5px crop at the default height. Check this after the
  peer's fix has merged; before it, the crop is expected.

## §102: buttons moved onto the shared primitives

- [ ] `02-resources-calendar-stepper.png`: the previous and next buttons show chevrons, sit level
  with the Today button, and match its height.
- [ ] `04-settings-diagnostics.png`: Refresh, Copy bundle, Download bundle and Clear look like the
  other secondary buttons in Settings.
- [ ] `05-help-menu-open.png`: the Help button matches the header icons beside it, and its menu
  still opens below it.
- [ ] **By hand:** the view hint's ✕ (any view's blue hint bar) and a swimlane's remove ✕
  (Open Points → Board, swimlanes on) are visible at rest and tint on hover.

## §512: branded Word files (#52)

- [ ] **By hand:** set a PNG logo in Settings → Appearance. Export the project as Word
  (Export → Word) and download a project document as Word. Open both in Word.
  - [ ] The logo and the project name sit in the header on every page, and the logo is not
    stretched.
  - [ ] The footer reads "Page 1 of N" and counts correctly. Word fills the numbers when the file
    opens; if it shows "1 of 1" everywhere, press F9.
  - [ ] The landscape export's header does not crowd its first table. Expected: with a logo, the
    body starts a little lower on landscape pages than without one. The header band starts at
    0.25in and the logo is up to 0.3in high, more than the 0.5in top margin, so Word moves the body
    down to make room. That is valid Word behaviour, not a defect; flag it only if it looks wrong.
  - [ ] The tables from part (a) (content-sized columns) look right; that half was never opened
    in Word either.
- [ ] **By hand, optional:** the same two files in LibreOffice.

## §59: Settings → Integrations (#114)

- [ ] `03-settings-integrations.png`: each calendar row's two stacked toggles ("Add to Outlook",
  "Keep in sync automatically") read as two controls, not one control with a stray second row.
- [ ] Same shot: the disabled "Keep in sync" toggle reads as disabled, not merely faint.
- [ ] **By hand:** the same, in a dark scheme. The 60% opacity floor was reasoned from the light
  scheme only.

## §21: editors and note logs (#94)

- [ ] `06-change-editor.png` and `07-milestone-editor.png`: both editors lay out like the RAID
  editor, with nothing clipped.
- [ ] **By hand:** a task whose note log is long. The inline log stops at its scroll height and
  scrolls inside it.
  ★ 2026-10-08: superseded by §679. This check found the item broken, and the fix removed the
  inline box's height cap, so the editor form now scrolls the whole log and this expectation no
  longer applies. Later the same day the inline log was removed altogether: the task editor's
  "Notes log (n)" button opens the floating notes window.
- [ ] **By hand:** the inline note log and the floating notes window open at the same time on one
  task. A screen reader names their controls apart.
  ★ 2026-10-08: the inline log was removed later that day, so this item no longer applies.
- [ ] **By hand:** the note log's disclosure summary is readable in every built-in scheme, light
  and dark.
  ★ 2026-10-08: the inline log was removed later that day, so this item no longer applies.

## §41: 0.211.0 surfaces (#104)

- [ ] `08-task-editor.png`: "Create RAID" and "New linked task" sit on one row. **By hand:** open
  the RAID mini-form and check the linked-task button wraps below it cleanly.
- [ ] **By hand:** AI Assistant, where the attach and dictate buttons are the same size with
  centred glyphs.
- [ ] `09-stakeholders.png`, then **by hand in dark mode**: the quadrant labels read as distinct
  from the chips beneath them.

## §375: a real model turn through the staged review card (#263)

- [ ] **By hand, needs an Anthropic key:** against `PORT=3100 npm run dev`, ask for a change that
  writes several rows or deletes one. The review card appears. Reject one row, and its dependents
  deselect. Apply, then check that ONE undo restores the updates and the deletes.

## Not in this kit

- §414 items 5 and 6 need a Turso-backed project; the kit seeds file mode.
- §205 and §426 closed in batch 15 on your sign-off.
