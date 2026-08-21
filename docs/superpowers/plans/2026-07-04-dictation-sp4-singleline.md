# Push-to-Talk Dictation SP4 (Single-line Inputs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the shared `useDictationMic` on the free-text single-line title/name inputs (task title · RAID/change title · milestone name · stakeholder name/org/title), migrating the task-title's legacy Web-Speech-only `InlineMicButton` onto the shared engine-aware hook.

**Architecture:** Each field adds a second `useDictationMic(...)` call (mirroring the textarea one already in the file), appends space-aware + `describeTextCap`, and registers on the input's focus/blur so the global hotkey reaches it. Parent-owned drafts (RAID/change/stakeholder) reuse the file's existing `draftRef`; task/milestone use functional setters.

**Tech Stack:** TypeScript, React 19, vitest. No new engine/hook/secret. `useDictationMic`/`appendDictation`/`dictation-target` all exist (SP1–3).

**Verify:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` · lint `npm run lint` (--max-warnings=0: a newly-unused import is FATAL) · size `npm run size:check`.

**Landmine (SP3):** Web Speech fires `onFinal` multiple times per hold → parent-owned fields MUST read the LATEST draft via the existing `draftRef.current` (present in raid/change/stakeholder); functional-setter fields read `prev`/`p`. Cap with `describeTextCap(appendDictation(cur ?? "", txt), MAX).value` — NO `.trim()` mid-append (the field's `onBlur` still trims).

---

## Task 1: task title — migrate InlineMicButton → useDictationMic

**Files:** Modify `src/app/task-form-fields.tsx` + `src/app/task-form-fields.dictation.test.tsx`

Context: the file already has `useDictationMic` for notes (`notesMic`/`notesDictationReg`, ~line 104) and a legacy `<InlineMicButton>` on the `taskName` input (~line 197) using `sanitizeVoiceTranscript`. Replace the legacy button with a shared mic.

- [ ] **Step 1:** Add a title mic hook next to the existing notes one (after the `notesMic` `useDictationMic(...)` block, ~line 111):
```tsx
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "taskName"),
    onAppendFinal: (txt) =>
      setForm((prev) => ({ ...prev, taskName: describeTextCap(appendDictation(prev.taskName ?? "", txt), TASK_NAME_MAX).value })),
  });
```

- [ ] **Step 2:** On the `taskName` `<input>` (~line 184), add focus registration and compose the existing `onBlur`:
```tsx
              onFocus={titleDictationReg.onFocus}
              onBlur={(e) => {
                setForm({ ...form, taskName: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() });
                markTouched("taskName");
                titleDictationReg.onBlur();
              }}
```

- [ ] **Step 3:** Replace the legacy `<InlineMicButton …/>` block (~lines 197–208) with the shared mic + status:
```tsx
            {titleMic}
```
and render `{titleDictationStatus}` just below the input's wrapper (next to where the char counter renders). Keep the input's `pr-10` class (the mic still sits at the input's right edge — if the shared `{titleMic}` is not absolutely positioned, drop `pr-10` and place `{titleMic}` inline after the input in a `flex items-center gap-1` wrapper).

- [ ] **Step 4:** Remove now-dead code so lint (--max-warnings=0) passes:
  - the `InlineMicButton` dynamic import (~lines 45–47),
  - `sanitizeVoiceTranscript` from the import list (~line 32) — **only if** no longer used in this file (grep the file; it was used solely by the removed button),
  - any now-unused `onShowToast`/`onError`-for-mic wiring that was exclusive to the legacy button (keep `onShowToast` if used elsewhere in the file).

- [ ] **Step 5: Test** — extend `src/app/task-form-fields.dictation.test.tsx`: mock `./use-push-to-talk` to force `supported:true` (as the existing dictation test does), render `TaskFormFields`, assert a mic button with the `dictationHold` accessible name appears near the task-name input (in addition to the notes one → expect 2). Add a unit: calling the title `onAppendFinal` twice appends both segments and never exceeds `TASK_NAME_MAX` (drive via the mocked hook capturing `onAppendFinal`, or a focused test of the append expression).

- [ ] **Step 6:** `npx tsc --noEmit` → 0; `npm run lint` → 0 (no unused `InlineMicButton`/`sanitizeVoiceTranscript`); `npm run test:run -- task-form` → PASS; `npm run size:check` → ok.

- [ ] **Step 7: Commit**
```bash
git add src/app/task-form-fields.tsx src/app/task-form-fields.dictation.test.tsx
git commit -F - <<'EOF'
feat(dictation): task title uses the shared engine-aware mic (drop legacy InlineMicButton)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://[session link removed]
EOF
```

---

## Task 2: RAID title + change title

**Files:** Modify `src/app/raid-edit-modal.tsx`, `src/app/change-edit-modal.tsx`

Both files already have a `draftRef` (`const draftRef = useRef(draft); useEffect(() => { draftRef.current = draft; })`) and a description `useDictationMic`. Add a title mic to each.

- [ ] **Step 1 (raid):** After the `descriptionMic` `useDictationMic` block (~line 101), add:
```tsx
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "raidTitle"),
    onAppendFinal: (txt) =>
      onChange({ ...draftRef.current, title: describeTextCap(appendDictation(draftRef.current.title ?? "", txt), TASK_NAME_MAX).value }),
  });
```
(RAID `title` is a required string — NO `|| undefined`. Use the file's actual i18n key for the title label; grep for the label rendered above the title `<input>` at ~line 366 and reuse it. `settings` is already in scope via `useSettings()` — grep to confirm; if not, add `const { settings } = useSettings();`.)

- [ ] **Step 2 (raid):** On the title `<input>` (~line 368), add `onFocus={titleDictationReg.onFocus}` and compose the existing `onBlur` (which caps title):
```tsx
              onFocus={titleDictationReg.onFocus}
              onBlur={(e) => { onChange({ ...draft, title: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() }); titleDictationReg.onBlur(); }}
```
Render `{titleMic}` beside the input (inline, e.g. a `flex items-center gap-1` wrapper around input+mic) and `{titleDictationStatus}` below (near the `CharCounter` at ~line 375).

- [ ] **Step 3 (change):** After the `descriptionMic` block (~line 118) add the same, using `update` and `BUDGET_NAME_MAX`:
```tsx
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "changeTitle"),
    onAppendFinal: (txt) =>
      update("title", describeTextCap(appendDictation(draftRef.current.title ?? "", txt), BUDGET_NAME_MAX).value),
  });
```
(Use the file's actual title i18n key; grep the label above the title `<input>` at ~line 260.)

- [ ] **Step 4 (change):** On the title `<input>` (~line 260) add `onFocus={titleDictationReg.onFocus}` + compose the existing `onBlur` (`update("title", describeTextCap(…).value.trim())`) with `titleDictationReg.onBlur()`. Render `{titleMic}` beside the input and `{titleDictationStatus}` below (near the title `CharCounter` at ~line 268).

- [ ] **Step 5:** `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:run -- raid-edit change-edit` → PASS; `npm run size:check` → ok (fold if a file trips; no --update).

- [ ] **Step 6: Commit**
```bash
git add src/app/raid-edit-modal.tsx src/app/change-edit-modal.tsx
git commit -F - <<'EOF'
feat(dictation): mic on RAID + change title inputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: milestone name + stakeholder name/org/title

**Files:** Modify `src/app/milestone-edit-modal.tsx`, `src/app/stakeholder-edit-modal.tsx`

Milestone owns local `draft` via `setDraft` (functional — no `draftRef` needed). Stakeholder has a `draftRef` + `update`.

- [ ] **Step 1 (milestone):** After the `descriptionMic` block (~line 51) add a name mic using the functional `setDraft` (milestone name has NO blur-cap; `sanitizeMilestone` caps on save — append raw, mirroring the field):
```tsx
  const { mic: nameMic, status: nameDictationStatus, registration: nameDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "milestoneName"),
    onAppendFinal: (txt) =>
      setDraft((p) => (p ? { ...p, name: appendDictation(p.name ?? "", txt) } : p)),
  });
```
(Use the file's actual name i18n key; grep the label above the name `<input>` at ~line 155.)

- [ ] **Step 2 (milestone):** On the name `<input>` (~line 155) add `onFocus={nameDictationReg.onFocus}` + `onBlur={nameDictationReg.onBlur}` (the field has no existing `onBlur` beyond `update`; if it has one, compose). Render `{nameMic}` beside the input + `{nameDictationStatus}` below.

- [ ] **Step 3 (stakeholder):** After the `notesMic` block (~line 102) add three mics — name, organization, title — each via `update` + `BUDGET_NAME_MAX`, reading the latest via `draftRef.current`:
```tsx
  const { mic: nameMic, status: nameDictationStatus, registration: nameDictationReg } = useDictationMic({
    lang, dictation: settings.dictation, enabled: true, label: t(lang, "stakeholderName"),
    onAppendFinal: (txt) => update("name", describeTextCap(appendDictation(draftRef.current.name ?? "", txt), BUDGET_NAME_MAX).value),
  });
  const { mic: orgMic, status: orgDictationStatus, registration: orgDictationReg } = useDictationMic({
    lang, dictation: settings.dictation, enabled: true, label: t(lang, "stakeholderOrganization"),
    onAppendFinal: (txt) => update("organization", describeTextCap(appendDictation(draftRef.current.organization ?? "", txt), BUDGET_NAME_MAX).value),
  });
  const { mic: titleMic, status: titleDictationStatus, registration: titleDictationReg } = useDictationMic({
    lang, dictation: settings.dictation, enabled: true, label: t(lang, "stakeholderTitle"),
    onAppendFinal: (txt) => update("title", describeTextCap(appendDictation(draftRef.current.title ?? "", txt), BUDGET_NAME_MAX).value),
  });
```
(Use the file's ACTUAL i18n keys for the three labels; grep the labels rendered above the name `<input>` (~198), organization (~221), title (~240). If a key doesn't exist, reuse the field's existing label key — do NOT invent i18n keys in this task.)

- [ ] **Step 4 (stakeholder):** On each of the three `<input>`s (~198/221/240) add `onFocus={xDictationReg.onFocus}` + compose the existing `onBlur` (`update(field, describeTextCap(…).value.trim())`) with `xDictationReg.onBlur()`. Render each `{xMic}` beside its input + `{xDictationStatus}` below.

- [ ] **Step 5:** `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:run -- milestone-edit stakeholder-edit` → PASS; `npm run size:check` → ok (fold if a file trips).

- [ ] **Step 6: Commit**
```bash
git add src/app/milestone-edit-modal.tsx src/app/stakeholder-edit-modal.tsx
git commit -F - <<'EOF'
feat(dictation): mic on milestone name + stakeholder name/org/title inputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://[session link removed]
EOF
```

---

## Final verification
- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] Grep: `InlineMicButton` no longer imported/used in `task-form-fields.tsx`; `voice-button.tsx`'s `InlineMicButton` may now be dead — if NO other importer remains, note it (removal is optional cleanup, not required this slice).
- [ ] Manual smoke: focus task title → hold mic → speak → appends within cap; hold F4 in a stakeholder org field → dictates there; each field's blur-cap + dictation coexist.

Then follow **superpowers:finishing-a-development-branch**.
