# Eye-verify checklist, batch 17

Adds to [`eye-verify-batch-16.md`](eye-verify-batch-16.md): the items that list marked **by hand**
but a seeded browser can in fact reach (dark-scheme shots, the RAID mini-form open, the AI
Assistant composer), a branded Word file, and the §219 Office samples. Work through both lists; an
entry closes on your sign-off.

```bash
PORT=3150 EYE_VERIFY=1 npx playwright test e2e/eye-verify-batch-17.spec.ts --project=chromium --workers=1
npx jiti scripts/sample-link-exports.ts eye-verify-output/batch-17/office
```

The kit writes to `eye-verify-output/batch-17/` (git-ignored) and skips in CI and without
`EYE_VERIFY=1`. The second command writes the four §219 samples and refuses any that fails its
byte-level link checks.

★ **Batch 16's `09-stakeholders.png` is the wrong surface for §41.** It shows the Stakeholders
register; the quadrant labels are in Reports → Stakeholder Report. Use the two `02-` shots below
instead.

## §41: 0.211.0 surfaces (#104)

- [ ] `02-stakeholder-quadrants-light.png` and `02-stakeholder-quadrants-dark.png`: the quadrant
  labels ("Keep Satisfied", "Manage Closely" and the other two) read as distinct from the name
  chips beneath them, in both schemes. The dark shot uses Harbor, a dark-capable built-in.
- [ ] `03-task-editor-raid-open.png`: with the create-RAID mini-form open, "+ New linked task"
  sits beside or wraps cleanly below it, and nothing overlaps.
- [ ] `04-ai-assistant-composer.png`: the attach and dictate buttons are the same size, with
  centred glyphs.

## §59: Settings → Integrations, dark scheme (#114)

- [ ] `01-settings-integrations-dark.png`: the two stacked toggles read as two controls, and the
  disabled "Keep in sync" toggle reads as disabled on the dark surface, not merely faint.

## §512: branded Word file (#52)

- [ ] Open `05-branded-export.docx` in Word. It is the real Export → Word download with the app's
  own icon set as the sidebar logo, so the checks in batch 16's §512 section apply to it: the logo
  and the project name in the header on every page, the logo not stretched, "Page X of N" in the
  footer (press F9 if it reads "1 of 1"), the header not crowding the first table, and the
  content-sized columns looking right.

## §219: Office fidelity (#194)

Four files in `office/`, each carrying the same links in prose, a table and a data section.

- [ ] `document-renderer.docx` and `workspace-exporter.docx` in Word: every link is clickable
  and goes where its text says, bold survives inside a link, and the image in the document
  renderer's file is sized and placed sensibly.
- [ ] `document-renderer.pptx` and `workspace-exporter.pptx` in PowerPoint: the same links work
  from the slides, and the workspace file's summary slides are followed by one detail slide per
  linked row.
- [ ] **Optional:** the same four in LibreOffice.

## §102: 11 more buttons on the shared primitives (#137)

- [ ] **By hand:** Settings → Next actions: "Suggest with AI", "Accept all", "Reset to defaults" and
  "View learning insights" look like the other secondary buttons in Settings.
- [ ] **By hand:** Open Points, select two rows: "Delete selected" reads as destructive (pink) and
  "Clear selection" as secondary, at the same height.
- [ ] **By hand:** the task editor of a Jira-linked task: the Jira sync button in the footer
  matches "Send inquiry" beside it. It lost its dark-blue text and is slightly narrower.
- [ ] **By hand, if reachable:** Time bookings → Clear all, and Settings → Templates → Save.

## Still by hand

- §21: a long note log's scroll stop, both note surfaces open at once with a screen reader, and
  the disclosure summary across every scheme.
- §375: a real model turn through the staged review card (needs an Anthropic key).
- §414 items 5 and 6: need a Turso-backed project.
