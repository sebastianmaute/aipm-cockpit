# Bespoke-modal help icons and the content behind them — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `docs/open-followups.md` §424 by extracting the help icon so a headerless dialog can render one, writing the three Help entries §453 records as missing, and triaging every remaining surface to a recorded outcome.

**Architecture:** The icon + popover currently lives inline in `ModalHeader` (~90 lines of a 265-line shared header). It moves to a standalone `HelpIconButton` that `ModalHeader` consumes — so `ModalHeader`'s DOM is byte-identical and its test file must pass unchanged — and that headerless `Modal` sites then render directly. Three new `HELP_ENTRIES` rows fill the content gaps; two modals deliberately unwired last slice get re-wired onto them.

**Tech Stack:** React 19 / Next 16, TypeScript, vitest + Testing Library, Playwright (axe gate only).

**Spec:** `docs/superpowers/specs/2026-09-10-modal-help-bespoke-and-content-design.md` (commit `7431856a`)
**Branch:** `feat/modal-help-bespoke`, cut off `origin/main` = `9adcafde`

---

## Read before Task 1

- `AGENTS.md` — the a11y hard-constraint bullet and the never-read-an-exit-code-through-a-pipe rule.
- `docs/AGENTS/ui-shell.md` — dismissal owns the Escape/Tab protocol.
- `src/app/popover-panel.tsx` docstring — `onClose` **must** be stable.
- §424 and §453 in `docs/open-followups.md`.

### Standing constraints — every task

- `src/app/**.ts(x)` and `src/test/**.ts` are **CRLF**: Edit tool only, **never** `sed -i`. `docs/**` is LF-only.
- **Never read a gate's exit code through a pipe.** Redirect, `echo "EXIT=$?"` unpiped, then grep the log.
- **Never run two vitest processes at once.**
- ★★★ **COLD VITE CACHE IN THIS WORKTREE LOOKS EXACTLY LIKE A BROKEN SUITE.** Measured 2026-09-10 during Task 1: the first two invocations returned `Test Files no tests` at **EXIT=1** with `[vitest-pool]: Failed to start forks worker` / `Timeout waiting for worker to respond`, at 81s and 60s, and `--maxWorkers=1` did **not** help. It was **not** contention — CPU 3%, 11.9 GB of 31.7 GB free, zero other vitest processes — and not a broken suite. Running one cheap file (`npx vitest run src/app/icons.test.ts --reporter=dot`) warmed the transform cache, after which the real file passed in 27.6s (import alone 12.5s) and every later run was fine. **Warm before concluding red.** This is a distinct cause from the contention case AGENTS.md records for the same error string; do not collapse the two.
- ★ **The three dirty files named in earlier briefs (`sample-workspace-huge.json`, `package-lock.json`, `not-in-use.env.local.bak`) are NOT in this worktree** — they belong to the main checkout at `C:/Projects/aipm-cockpit`, where the session's opening `gitStatus` snapshot was taken. `.worktrees/rebase` is clean. Do not read an empty `git status` here as a missing file. The never-stage rule still stands wherever they do appear.
- Never stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`. Never `git add -A` / `git add .` — name paths.
- `git checkout -- <file>` and `git restore` are deny-blocked. `git stash` must **never** be run in this worktree. Never `--amend`.
- Every commit ends with `Claude-Session: https://[session link removed]`.
- Budget file size with `node -e "console.log(require('fs').readFileSync('<f>','utf8').split('\n').length)"` — the ratchet counts `wc -l` **plus one**. LIMIT 1600. Today: `modal-header.tsx` 265, `popover-panel.tsx` 540, `help-content.ts` 307, `notes-window.tsx` 137, `help-body-text.tsx` 70.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/help-icon-button.tsx` | **NEW.** The whole help affordance: trigger button, open state, entry lookup, `PopoverPanel` with its load-bearing close button and `HelpBodyText`. |
| `src/app/help-icon-button.test.tsx` | **NEW.** Tests for the extracted unit, including the bespoke (non-`ModalHeader`) usage. |
| `src/app/modal-header.tsx` | Consumes `HelpIconButton`. Keeps `helpConceptId` / `helpTitle` props unchanged. Loses ~90 lines. |
| `src/app/modal-header.test.tsx` | **MUST NOT CHANGE.** Acceptance criterion for the extraction. |
| `src/app/help-content.ts` | `MODAL_HELP` gains rows; `HELP_ENTRIES_LITERAL` gains three entries. |
| `src/app/help-content.test.ts` | Wiring scan regex widened; row-count floor updated per row added. |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | Six new keys (three title + three body) each. |
| `src/app/calendar-event-modal.tsx`, `task-time-tracking-modal.tsx` | Re-wired; deliberate-absence comments deleted. |
| 3 bespoke modals (Task 7) | Render `<HelpIconButton>`. |
| 5 bespoke modals (Task 8) | Gain a refusal comment. |
| `docs/open-followups.md` | §424 + §453 Status; one new entry (§454) for the seven no-content refusals. |

---

## Task 1: Extract `HelpIconButton`

**Files:**
- Create: `src/app/help-icon-button.tsx`
- Modify: `src/app/modal-header.tsx`
- Must not change: `src/app/modal-header.test.tsx`

★★★ **THE ACCEPTANCE CRITERION IS THAT `modal-header.test.tsx` PASSES COMPLETELY UNCHANGED** — all 18 tests, including `"gives two stacked headers distinct help-icon names"`, `"gives the popover's own close button a name distinct from the header's"` and `"keeps Tab inside the dialog while the help popover is open"`. If that file needs an edit, the extraction changed behaviour: **stop and report**, never absorb it into the diff.

★★★ **THE POPOVER'S CLOSE BUTTON IS LOAD-BEARING FOR FOCUS CONTAINMENT.** `PopoverPanel` pushes `kind: "modal"`; `modal.tsx` stands its own Tab trap down for the topmost `"modal"` entry; and `PopoverPanel`'s own cycle returns **without** trapping when the panel holds no focusables. A text-only panel stands **both** traps down and Tab leaves the dialog (WCAG 2.4.3) — measured: `document.body` on press 4, an outside control on press 5. Move the button with the component; do not "simplify" it away.

★ Do **not** write a test pinning `kind`. `escapeOwner()` in `dismissal-stack.ts` is kind-**agnostic**; flipping the kind left the whole file green (15/15) last slice.

- [ ] **Step 1: Record the baseline, unpiped**

```bash
npx vitest run src/app/modal-header.test.tsx --reporter=dot > /tmp/mh-before.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/mh-before.log
```
Expected: `EXIT=0`, `Tests  18 passed (18)`. Record the number — it is the sum check for every mutant later.

- [ ] **Step 2: Create `src/app/help-icon-button.tsx`**

Move the block verbatim. `helpCloseName` currently derives from `t(lang, "alertModalClose")`; that stays.

```tsx
"use client";

import { useCallback, useId, useRef, useState } from "react";
import { QuestionMarkCircleIcon, XMarkIcon } from "./icons";
import { HELP_ENTRIES, type HelpEntryId } from "./help-content";
import { HelpBodyText } from "./help-body-text";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { PopoverPanel } from "./popover-panel";

/** The help affordance: a question-mark trigger and the popover it opens.
 *
 *  ★ EXTRACTED FROM `ModalHeader`, NOT A SECOND RENDERER. There must be exactly
 *  ONE place that renders a help popover — the headerless `Modal` sites cannot
 *  each grow their own (`no-handroll-use-primitives`). `ModalHeader` consumes
 *  this and its own test file passes unchanged, which is the proof the move was
 *  behaviour-preserving.
 *
 *  ★★★ THE CLOSE BUTTON BELOW IS LOAD-BEARING FOR FOCUS CONTAINMENT, not a
 *  convenience. `PopoverPanel` pushes `kind: "modal"`; `modal.tsx` stands its
 *  own Tab trap down for the topmost `"modal"` entry; and `PopoverPanel`'s own
 *  cycle returns WITHOUT trapping when the panel holds no focusable children.
 *  A text-only panel therefore stands BOTH traps down and Tab walks out of the
 *  dialog (WCAG 2.4.3) — measured, not reasoned: `document.body` on the 4th
 *  press and a control OUTSIDE the modal on the 5th.
 *
 *  ★ Renders NOTHING when `conceptId` resolves to no entry, so a caller cannot
 *  ship a dead trigger. */
export function HelpIconButton({
  lang,
  conceptId,
  dialogTitle,
}: {
  lang: Lang;
  conceptId: HelpEntryId;
  /** Qualifies the trigger's accessible name. Pass the dialog's own title.
   *  ★ Two stacked dialogs otherwise put two controls named "Help" in one
   *  document; speech input does not scope by `aria-modal`, and axe has no
   *  rule that flags a duplicate accessible name. */
  dialogTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  // `PopoverPanel` reads this through effect dependencies, so it MUST be
  // stable — its docstring says so explicitly.
  const close = useCallback(() => setOpen(false), []);
  const entry = HELP_ENTRIES.find((e) => e.id === conceptId);
  // ★ Early return sits AFTER every hook — moving it above one is the
  //   rules-of-hooks violation, and `--max-warnings=0` makes it fatal.
  if (!entry) return null;
  const name = t(lang, "modalHelpAbout", dialogTitle);
  const closeName = `${t(lang, "alertModalClose")} – ${t(lang, entry.titleKey)}`;
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        /* ★ Set only while OPEN. `aria-controls` must resolve to a node that
           EXISTS and the panel is unmounted while closed. */
        aria-controls={open ? panelId : undefined}
        aria-label={name}
        title={name}
        className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
      >
        <QuestionMarkCircleIcon aria-hidden="true" className="h-4 w-4" />
      </button>
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        id={panelId}
        role="dialog"
        ariaLabel={t(lang, entry.titleKey)}
        className="max-h-[60vh] w-80 max-w-[90vw] overflow-y-auto p-3 text-left"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, entry.titleKey)}
          </p>
          {/* ★ QUALIFIED BY THE ENTRY TITLE, never a bare "Close" — a host
              dialog's own ✕ is in the same document and uses the unqualified
              `alertModalClose` string. */}
          <button
            type="button"
            onClick={close}
            aria-label={closeName}
            title={closeName}
            className={`-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          <HelpBodyText body={t(lang, entry.bodyKey)} labelClass="font-medium text-foreground" />
        </p>
      </PopoverPanel>
    </>
  );
}
```

★ **Carry the long landmine comment block** that currently sits above `<PopoverPanel>` in `modal-header.tsx` (the `★★ WHAT THE PRIMITIVE'S kind: "modal" BUYS AND COSTS` block, ~40 lines) into this file rather than deleting it. It is the record of a measured defect.

- [ ] **Step 3: Replace the block in `modal-header.tsx`**

Delete the `useState`/`useRef`/`useId`/`closeHelp`/`helpEntry`/`helpName`/`helpCloseName` locals and the whole `{helpEntry && (<>…</>)}` fragment. Replace the fragment with:

```tsx
        {helpConceptId && (
          <HelpIconButton lang={lang} conceptId={helpConceptId} dialogTitle={helpTitle ?? title} />
        )}
```

Add `import { HelpIconButton } from "./help-icon-button";`. Remove now-unused imports: `QuestionMarkCircleIcon`, `XMarkIcon` **only if** no other use remains (check — `XMarkIcon` is the header's own ✕, so it stays), `HELP_ENTRIES`, `HelpBodyText`, `PopoverPanel`, and `useCallback`/`useId`/`useState` if unused. `HelpEntryId` stays (the prop type).

★ `--max-warnings=0` makes an unused import **fatal**, so this is not optional tidying.

- [ ] **Step 4: Prove the extraction — the test file must be untouched**

```bash
npx vitest run src/app/modal-header.test.tsx --reporter=dot > /tmp/mh-after.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/mh-after.log
git diff --stat src/app/modal-header.test.tsx
```
Expected: `EXIT=0`, `Tests  18 passed (18)`, and **`git diff --stat` on the test file prints nothing**. If it prints anything, stop.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/tsc.log
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```
Expected: `src/` error count **0** (read the count, not the exit code — a stale `.next/dev/types/validator.ts` makes `tsc` exit 2 with zero `src/` errors; remedy is `Remove-Item -Recurse -Force .next`), eslint `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/help-icon-button.tsx src/app/modal-header.tsx
git commit -F- <<'MSG'
refactor(help): extract HelpIconButton from ModalHeader

The icon and its popover were ~90 lines inline in a 265-line shared header,
reachable only through the ModalHeader prop. The headerless Modal sites need
the same affordance and must not each hand-roll one.

Behaviour-preserving: modal-header.test.tsx passes unchanged, all 18 tests,
which is the proof rather than an observation. The popover's close button
moved with the component — it is load-bearing for focus containment, not
decoration: PopoverPanel pushes kind:"modal", modal.tsx stands its own Tab
trap down for the topmost such entry, and PopoverPanel's cycle declines to
trap when the panel holds no focusables, so a text-only panel stands both
traps down.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 2: Widen the wiring scan before any bespoke site lands

**Files:**
- Modify: `src/app/help-content.test.ts`

★★★ **THIS TASK MUST COME BEFORE TASK 7 OR THE SUITE GOES RED FOR THE RIGHT REASON AT THE WRONG TIME.** The wiring test scans for `/helpConceptId=\{MODAL_HELP\.([A-Za-z0-9_]+)\}/g`. A bespoke site renders `<HelpIconButton conceptId={MODAL_HELP.x} …>` — attribute `conceptId`, **not** `helpConceptId` — so the scan would not see it, and the both-directions set equality would report the key as unwired.

- [ ] **Step 1: Widen the regex**

In `help-content.test.ts`, replace the `matchAll` pattern:

```ts
      for (const m of src.matchAll(/(?:helpConceptId|conceptId)=\{MODAL_HELP\.([A-Za-z0-9_]+)\}/g)) {
```

and add above the loop:

```ts
      // ★★ TWO ATTRIBUTE SPELLINGS, ONE MAP. `ModalHeader` takes
      // `helpConceptId`; a headerless dialog renders `<HelpIconButton
      // conceptId={...}>` directly. Matching only the first spelling would
      // report every bespoke site as an unwired key -- a red that names the
      // wrong 19 files. `ModalHeader`'s own internal `conceptId={helpConceptId}`
      // does not match, because the value is not a `MODAL_HELP.` member.
```

- [ ] **Step 2: Prove the widened regex still passes today**

```bash
npx vitest run src/app/help-content.test.ts --reporter=dot > /tmp/hc.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/hc.log
```
Expected: `EXIT=0`. Record the test count — it is the sum check for Task 2's mutant.

- [ ] **Step 3: Record that this change is NOT yet mutation-provable**

Do not attempt a mutant here. No `conceptId={MODAL_HELP.…}` call site exists until Task 7, so reverting the regex to its narrow form leaves the suite **green** — the two forms are indistinguishable against today's tree.

★★ A mutant that cannot fail is a question, not a pass. Report this step as *"widening is unprovable until Task 7"* rather than as a passing mutation. **Task 7 Step 5 is where it becomes live**, and that is the mutant of record for this change.

★ Do not fake it with a comment line containing `conceptId={MODAL_HELP.x}` — the scan reads raw file text, so a comment *would* match and the mutant would "pass" while proving nothing about JSX. That is the self-referential-grep trap this repo has hit repeatedly.

- [ ] **Step 4: Commit**

```bash
git add src/app/help-content.test.ts
git commit -F- <<'MSG'
test(help): teach the wiring scan the second attribute spelling

ModalHeader takes helpConceptId; a headerless dialog renders HelpIconButton
with conceptId directly. The scan matched only the first, so a bespoke site
would have been reported as an unwired MODAL_HELP key -- a red naming the
wrong files. Inert today (no bespoke site exists yet) and becomes live with
the first one.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 3: Rebuild the surface scan and record the triage

**Files:**
- Create: scratchpad only — **this script is not committed**

★★★ **THE REGISTER'S NUMBERS ARE WRONG AND MUST NOT BE COPIED.** §424 says 34 files / 36 sites / 20 headers / ~14 bespoke. Measured 2026-09-10: **33 / 33 / 20 / 13**.

- [ ] **Step 1: Rebuild the scan with its positive control**

Write to the scratchpad (not the repo):

```js
import fs from "node:fs";
import path from "node:path";
const ROOT = "src/app";
const files = [];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())walk(p); else if(/\.tsx$/.test(e.name)&&!/\.test\.tsx$/.test(e.name))files.push(p);}})(ROOT);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"").replace(/\{\/\*[\s\S]*?\*\/\}/g,"");
const RE = /<Modal(?=[\s/>])/g, REH = /<ModalHeader(?=[\s/>])/g;
// ★★★ POSITIVE CONTROL. Without it a strip that removes NOTHING is invisible.
for (const f of ["src/app/shift-edit-modal.tsx","src/app/jira-conflicts-modal.tsx"]) {
  const raw = fs.readFileSync(f,"utf8");
  const a = (raw.match(RE)||[]).length, b = (strip(raw).match(RE)||[]).length;
  console.log(`control ${path.basename(f)}: raw=${a} stripped=${b}`);
  if (a !== 2 || b !== 1) { console.error("CONTROL FAILED — do not read any number below"); process.exit(1); }
}
let M=[],H=[];
for (const f of files) { const s=strip(fs.readFileSync(f,"utf8"));
  const m=(s.match(RE)||[]).length, h=(s.match(REH)||[]).length;
  if(m)M.push([f,m,h]); if(h)H.push([f,h]); }
console.log("Modal files:",M.length,"sites:",M.reduce((a,[,n])=>a+n,0));
console.log("ModalHeader sites:",H.reduce((a,[,n])=>a+n,0));
console.log("HEADERLESS:"); for(const [f,n,h] of M) if(h===0) console.log(`  ${n}  ${f}`);
```

Run it. Expected: both controls `raw=2 stripped=1`; then `Modal files: 33 sites: 33`, `ModalHeader sites: 20`, and **13** headerless files.

★★ If the counts differ from 33/33/20/13, the tree moved since 2026-09-10 — re-derive the triage below rather than assuming the table still holds.

- [ ] **Step 2: Confirm the window set**

```bash
grep -rln "useDraggableWindow" src/app --include=*.tsx | grep -v "\.test\."
```
Expected three files: `asset-preview-modal.tsx` (already has a `ModalHeader` — in the shipped set), `help-menu.tsx` (**excluded**: it renders `HelpContentPane`, so it *is* Help), `notes-window.tsx` (the only genuine window candidate, Task 9).

- [ ] **Step 3: Record the triage verdicts**

No code. Produce this table in the task report; it drives Tasks 7 and 8.

| site | verdict |
|---|---|
| `actions-panel` (`actionAiAnalyzing`) | REFUSE-STRUCTURAL — transient progress |
| `step0-import-panel` (`wizardImportReadingFiles` / `wizardImportAnalyzing`) | REFUSE-STRUCTURAL — transient progress |
| `timelog-panel` (`loadingTimelog`) | REFUSE-STRUCTURAL — transient progress |
| `integration-disclaimer` (`disclaimerTitle`) | REFUSE-STRUCTURAL — the dialog *is* the explanation |
| `version-info` (`version`) | REFUSE-STRUCTURAL — already information |
| `raci-suggest-modal` | **WIRE** → `concept-raci` — ✅ survived re-review |
| `steering-committee-panel` | ~~WIRE → `feature-steering`~~ → **REFUSE-NO-CONTENT** (downgraded, see below) |
| `insights/recommendation-review-modal` | ~~WIRE → `automated-insights`~~ → **REFUSE-NO-CONTENT** (downgraded, see below) |
| `alloc-plan-modal` | REFUSE-NO-CONTENT |
| `calendar-pull-summary-modal` | REFUSE-NO-CONTENT |
| `comm-send-preview-modal` | REFUSE-NO-CONTENT |
| `pick-list-import-modal` | REFUSE-NO-CONTENT |
| `task-dedup-modal` | REFUSE-NO-CONTENT |

★★★ **THE THREE WIRE VERDICTS ARE CANDIDATES FROM A TERM PROBE, NOT DECISIONS.** A probe proves a subject is ABSENT from every body; it cannot prove a present term *describes* the dialog. The `HelpEntryId` union catches a MISTYPED id, never a well-spelled WRONG one — last slice a by-eye pass over 20 pairings changed three. **Open each candidate entry's title and body and read them against the dialog before wiring.** Downgrading a WIRE to REFUSE-NO-CONTENT here is a correct outcome, not a failure.

### DONE 2026-09-10 — measured, and two of the three candidates were downgraded

Scan reproduced with both positive controls passing (`shift-edit-modal` and `jira-conflicts-modal` each `raw=2 stripped=1`): **33 files / 33 sites / 20 `ModalHeader` / 13 headerless** — confirming §424's recorded 34 / 36 / 20 / ~14 is wrong on three of four cells. The 13 headerless files match the triage table one-for-one. Window set confirmed as exactly the predicted three.

The by-eye pass (66/66 bodies resolved, 3,972 i18n keys indexed) **changed two of three verdicts**, which is the same criterion that removed `calendarEvent → feature-resources` last slice:

- **`steering-committee-panel` → REFUSE-NO-CONTENT.** `feature-steering`'s subject is the committee *record* — name, members, meeting schedule (date/title/agenda/location), info-schedule lead-days, Action Center pack reminders, Outlook push. The dialog is a per-meeting **status report** editor: rich-text body, recipients, Send via M365, AI Generate, a version list with line diff and Restore. The entry names none of it. Its one adjacent noun — the "information pack" circulating N working days before a meeting — is the active hazard: it invites the reader to identify the report with the reminder rules, and the code does not connect them (`committeeInfoSchedules` is label + lead days; `MeetingReport` is a separate stored artifact). No better entry exists — `concept-steering`, `feature-version-history`, `feature-rich-text` and `feature-reports` were each checked and each fails for a concrete reason.
- **`insights/recommendation-review-modal` → REFUSE-NO-CONTENT.** `automated-insights` is about *detection and triage*: five watched patterns, the status lifecycle, where insights are listed. It never says "recommendation", "AI", "propose" or "apply" — and that is the only question the dialog poses ("what will Apply write?"). Its status sentence does describe a real consequence (`use-insight-recommendations.ts` sets `status: "acted"`), but a consequence is not the subject. The near-miss worth naming in the refusal comment is **`feature-inline-ai-edit`**, which describes the mechanic almost verbatim and which this modal's own comment says it shares an `EditPlan` shape with — it still fails, because its scoping clause is "without leaving the row", so wiring it would tell the reader they are in the inline row editor. Note also that `feature-ai-advanced` asserts of the AI helpers that "it never edits your data", so **no** existing entry can be pointed at a surface whose purpose is applying AI-proposed writes.

**Consequences for later tasks — apply these, do not follow the original numbers:**
- Task 7 wires **one** site, not three. `MODAL_HELP` floor becomes **22**, not 24.
- Task 7's collision test can no longer seed from `steeringReport`. Seed it with the **same** `conceptId` under two different `dialogTitle`s — a sharper test anyway, since it proves the accessible name derives from the dialog title rather than from the entry.
- Task 8 records **twelve** refusals (5 structural + **7** no-content), not ten.

- [x] **Step 4: No commit** — this task produced a report, not a diff. Confirmed clean.

---

## Task 4: Coordinate with the peer session before touching either dictionary

**Files:** none.

★★★ `src/app/i18n.ts` and `src/app/i18n.de.ts` are shared with a peer session. This is a **step**, not a note.

★★ **THE PEER NAMED IN THE FIRST DRAFT OF THIS PLAN (`aipm-wt-a-b7`) NO LONGER EXISTS.** A session name is not a durable handle — it is minted per session, and the worktree it refers to outlives it. Re-run `ListAgents` and address whoever holds `C:/Projects/aipm-wt-a` today; do not go looking for a name written into a plan hours earlier.

**DONE 2026-09-10 — cleared.** Peer `aipm-wt-a-56` answered:
- No uncommitted changes in either dictionary.
- No plans to add, move or reflow any `helpSec*` key; its work is under `scripts/` plus docs.
- We are in **different worktrees**, so neither session can see the other's uncommitted edits to these files at all. What IS shared is the stash stack and the refs — never run bare `git stash` / `git stash pop` here.

★★ **One committed change of the peer's is in this key family and is NOT on `origin/main` yet.** `f37bc539` ("fix(ai): drop the retired counting multiplier from the guide and Help") rewrites the VALUE of `helpSecUsageLimitsBody` in BOTH dictionaries. Verified independently rather than taken on trust — `git log --oneline origin/main..feat/ai-prompt-quality-harness -- src/app/i18n.ts src/app/i18n.de.ts` returns exactly that one commit, carrying 5 `helpSecUsageLimitsBody` hits across the two files. It should merge cleanly (we APPEND six new keys after `helpSecPrint*`; it edits one existing key's value), but it is the same family and possibly a nearby region: **after any rebase onto a main that already carries it, expect it in the neighbourhood and do NOT "tidy" it back.**

Verified independently before writing anything:
- All six new keys are absent from both dictionaries today (0/0 each).
- The DE anchor `helpSecPrintTitle: "Drucken und PDF",` occurs **exactly once** in `i18n.de.ts`, so Task 5's uniqueness assertion will hold.

★ Task 5's byte-check must also scan for **NUL bytes**, not only LF-only lines / ASCII substitutes / `\u00XX` escapes — the Edit tool has been observed turning a space into a NUL on this path. And check in node, never `grep -c`: a bracket class under a byte locale decomposes a multi-byte character and answers a different question.

- [ ] ~~Step 1 / Step 2~~ — **done, no action left.** Step 3: no commit (this record lands with the plan-correction commit).

---

## Task 5: Write the three Help entries

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/help-content.ts`, `src/app/help-content.test.ts`

★★★ **THIS PLAN DELIBERATELY DOES NOT SUPPLY THE BODY SENTENCES, AND THAT IS NOT A PLACEHOLDER.** Inventing Help prose about three subsystems the plan author has not read is exactly this repo's dominant defect class — twelve prose defects against zero code defects on the previous slice. What the plan supplies instead is binding: the key names, the row shape, the length target, and an **evidence table that must exist before any sentence is written**.

### The three entries

| # | id | titleKey / bodyKey | group | relatedViews |
|---|---|---|---|---|
| 1 | `feature-meeting-series` | `helpSecMeetingSeriesTitle` / `helpSecMeetingSeriesBody` | `features` | `["calendar"]` |
| 2 | `feature-document-assets` | `helpSecDocumentAssetsTitle` / `helpSecDocumentAssetsBody` | `features` | `["documents"]` |
| 3 | `feature-task-effort` | `helpSecTaskEffortTitle` / `helpSecTaskEffortBody` | `features` | `["open-points"]` |

★ `group: "features"` for all three, and **no `primerKey`** — `help-content.test.ts` pins primers to `concepts` in both directions, so a primer here turns the suite red.
★ Every `relatedViews` member must be a real `AppView`; a made-up one is caught by "every relatedViews entry is a valid AppView". Verify each against `nav-config.ts`.

- [ ] **Step 1: Build the evidence table for each entry, before writing prose**

For each entry, read the implementing code and produce a table of `claim → file:symbol`. Required sources:

- Entry 1 — `src/app/calendar-event-modal.tsx`, `src/app/calendar-event.ts`, `src/app/use-calendar-events.ts`.
- Entry 2 — `docs/AGENTS/documents.md` "Asset images (S3c-1)" **and** "Image bytes in every export format (S3c-2)", `src/app/document-asset*`, `src/app/document-export-assets.ts`.
- Entry 3 — `src/app/task-time-tracking-modal.tsx` and whatever writes the estimate/spent/remaining fields.

★★ **Do not write a sentence that has no row in the table.** A claim about a Turso-gated feature must say so; §424's own history includes a body that described a surface the dialog did not edit.

★★ Entry 2 must not repeat the `omitted` / `missing` mistake AGENTS.md records: `omitted` is **budget overflow alone**; a policy refusal lands in `missing`. If the prose touches export behaviour at all, read that bullet first.

- [ ] **Step 2: Write the EN strings into `src/app/i18n.ts`**

Insert after `helpSecPrintBody` (currently `i18n.ts:3758`; **re-locate it by symbol, not by that number** — an insertion above moves it). Target the median body length, **539 source characters**; the corpus runs 268–1401. Use the Edit tool (CRLF file).

- [ ] **Step 3: Write the DE strings into `src/app/i18n.de.ts` — NEVER with Edit or Write**

★★★ The Edit tool corrupts umlauts and curls double quotes in this file. Patch with a node utf8 write, anchoring on `\r\n` (a `\n` anchor silently no-ops on a CRLF file), using **real** umlauts — the `i18n-encoding` test bans ASCII substitutes (`fuer`, `druecken`) **and** `\u00XX` escapes.

Write the script to the scratchpad (not the repo) and run it. It asserts before it writes:

```js
import fs from "node:fs";
const f = "src/app/i18n.de.ts";
const s = fs.readFileSync(f, "utf8");

// ★ Anchor on the END of an existing entry, and assert UNIQUENESS in both
//   directions before touching anything. A non-unique anchor writes to the
//   wrong place silently.
const anchor = '  helpSecPrintTitle: "Drucken und PDF",\r\n';
if (s.indexOf(anchor) === -1) throw new Error("anchor not found — is the file CRLF?");
if (s.indexOf(anchor) !== s.lastIndexOf(anchor)) throw new Error("anchor not unique");

// ★ Real umlauts, never fuer/druecken and never \u00XX — i18n-encoding bans both.
const added =
  '  helpSecMeetingSeriesTitle: "…",\r\n' +
  '  helpSecMeetingSeriesBody: "…",\r\n' +
  '  helpSecDocumentAssetsTitle: "…",\r\n' +
  '  helpSecDocumentAssetsBody: "…",\r\n' +
  '  helpSecTaskEffortTitle: "…",\r\n' +
  '  helpSecTaskEffortBody: "…",\r\n';

const out = s.replace(anchor, anchor + added);
if (out === s) throw new Error("no substitution happened");
if (out.length <= s.length) throw new Error("file did not grow");
fs.writeFileSync(f, out, "utf8");
console.log("wrote", out.length - s.length, "bytes");
```

★★★ Replace each `…` with the real German string from the Step 1 evidence table. The `\r\n` line terminators are load-bearing — a `\n` anchor silently no-ops on this CRLF file and the script exits 0 having written nothing, which is why the `out === s` guard is there rather than optional.

- [ ] **Step 4: Verify the DE write did not corrupt anything**

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
console.log('LF-only lines:',(s.match(/(?<!\r)\n/g)||[]).length);
console.log('ascii subs:',(s.match(/fuer|druecken|oe |ue /g)||[]).length);
console.log('unicode escapes:',(s.match(/\\\\u00/g)||[]).length);"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/enc.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/enc.log
```
Expected: LF-only lines **0**, ascii subs 0, unicode escapes 0, `EXIT=0`.

- [ ] **Step 5: Add the three rows to `HELP_ENTRIES_LITERAL` in `help-content.ts`**

```ts
  { id: "feature-meeting-series", group: "features", titleKey: "helpSecMeetingSeriesTitle", bodyKey: "helpSecMeetingSeriesBody", relatedViews: ["calendar"] },
  { id: "feature-document-assets", group: "features", titleKey: "helpSecDocumentAssetsTitle", bodyKey: "helpSecDocumentAssetsBody", relatedViews: ["documents"] },
  { id: "feature-task-effort", group: "features", titleKey: "helpSecTaskEffortTitle", bodyKey: "helpSecTaskEffortBody", relatedViews: ["open-points"] },
```

- [ ] **Step 6: Update the entry-count expectations**

`help-content.test.ts` has `it("has the concept, workflow and automated entries")` asserting group membership, and the `MODAL_HELP` test asserts `expect(entries.length).toBe(19)`. The **HELP_ENTRIES** total moves 66 → **69**; `features` moves 45 → **48**. Grep the test file for any hardcoded 66 or 45 and update each, in this commit.

```bash
grep -n "66\|\b45\b" src/app/help-content.test.ts
```

- [ ] **Step 7: Run tsc (EN/DE parity) and the help suite**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/tsc.log
npx vitest run src/app/help-content.test.ts src/app/i18n-encoding.test.ts --reporter=dot > /tmp/h2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/h2.log
```
Expected: `src/` count 0 (tsc enforces EN/DE key parity — a missing DE key fails here), `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/help-content.ts src/app/help-content.test.ts
git commit -F- <<'MSG'
feat(help): add meeting-series, document-assets and task-effort entries

Fills gaps 1-3 of open-followups 453. Measured over all 66 existing bodies at
66/66 resolved: "series" appeared in 0, "image" and "asset" in 0 each (and in
0 titles and primers), and "estimate", "time spent" and "remaining" in 0 each.
Gap 2 was the only one shipping a live failure mode -- three asset modals
carry icons today pointing at entries with no content about what they do.

Every sentence is backed by an evidence row naming the file and symbol it
came from; nothing here was written from the dialog's name.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 5b: Add meetings to the Resources body — USER-APPROVED SCOPE ADDITION

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`

Task 5 surfaced this and the user approved fixing it in-slice rather than filing it.

`helpSecResourcesBody` still enumerates the Resources → Calendar sub-tab as **"tasks, absences, and holidays"** (DE: "Aufgaben, Abwesenheiten und Feiertagen"), omitting meetings. That omission is not incidental: it is the precise reason `MODAL_HELP`'s own note gives for why `calendarEvent` could not be pointed at `feature-resources` last slice. With `feature-meeting-series` now written, leaving it makes the new entry undiscoverable from the entry a Calendar user would actually open.

- [ ] **Step 1: Add meetings to the enumeration in BOTH dictionaries.** One clause; do not rewrite the surrounding sentence.
- [ ] **Step 2: `i18n.de.ts` is NEVER touched with Edit or Write** — node UTF-8 write, `\r\n` anchors, real umlauts, uniqueness asserted in both directions, `out === s` guard, growth guard.
- [ ] **Step 3: Byte-check in node, not `grep -c`.** ★★ Curly quotes are **44 in `i18n.de.ts` and 26 in `i18n.ts` at HEAD and must stay there** — the expectation is UNCHANGED-FROM-HEAD, not zero. Reading it as zero sends you hunting a corruption that does not exist. Also check LF-only lines 0, ASCII substitutes 0, `\u00XX` escapes 0, NUL 0.
- [ ] **Step 4:** `npx tsc --noEmit` (EN/DE parity) + `npx vitest run src/app/i18n-encoding.test.ts src/app/help-content-gate.test.ts` in ONE invocation. The gate file is what proves the DE clause is a translation rather than an English pass-through.
- [ ] **Step 5: Commit** on its own, naming both paths.

---

## Task 6: Re-wire the two deliberately-unwired modals

**Files:**
- Modify: `src/app/calendar-event-modal.tsx`, `src/app/task-time-tracking-modal.tsx`, `src/app/help-content.ts`, `src/app/help-content.test.ts`

★★★ **DELETE THE DELIBERATE-ABSENCE COMMENTS IN THIS COMMIT.** A comment asserting the opposite of the code is this slice's own dominant defect class.

- [ ] **Step 1: Add the two `MODAL_HELP` rows**

```ts
  calendarEvent: "feature-meeting-series",
  taskTimeTracking: "feature-task-effort",
```

- [ ] **Step 2: Update the row-count floor**

In `help-content.test.ts`, `expect(entries.length).toBe(19)` becomes `expect(entries.length).toBe(21)`.

★★ This is the anti-vacuity floor, not bookkeeping — its comment says an emptied map would satisfy the loop trivially. Keep the comment.

- [ ] **Step 3: Wire `calendar-event-modal.tsx` and delete its comment**

Delete this block (currently at `calendar-event-modal.tsx:176-182`; **anchor on the comment text, not the line numbers**):

```
      /* ★ NO `helpConceptId`, deliberately — the row was REMOVED from
         `MODAL_HELP` rather than repointed. This modal edits recurring MEETING
         SERIES; the nearest entry (`feature-resources`) enumerates the Calendar
         sub-tab as "tasks, absences, and holidays", none of which is what is
         being edited here, and "series" appears in 0 of the 66 help bodies.
         Same criterion that removed `taskTimeTracking`: a wrong entry is worse
         than no icon. Write a meeting-series entry before restoring a row. */
```

and add `helpConceptId={MODAL_HELP.calendarEvent}` to the same header, importing `MODAL_HELP`.

- [ ] **Step 4: Wire `task-time-tracking-modal.tsx` and delete its comment**

Delete the six-line `// ★ NO \`helpConceptId\` ON PURPOSE …` comment (currently `:154`, anchor on its text) and add `helpConceptId={MODAL_HELP.taskTimeTracking}`.

★ Leave the **second** comment in that file untouched — the WCAG 2.4.6 note about `closeLabel` is about the ✕, a different control, and is still true.

- [ ] **Step 5: Verify no stale prose survives anywhere**

```bash
grep -rn "series\" appears in 0\|no Help entry\|wrong entry is worse" src/app --include=*.tsx --include=*.ts | grep -v "\.test\."
```
Expected: only the five refusal comments added in Task 8 (none yet at this point — so **zero hits**).

- [ ] **Step 6: Run the suite and commit**

```bash
npx vitest run src/app/help-content.test.ts src/app/calendar-event-modal.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log
```

```bash
git add src/app/help-content.ts src/app/help-content.test.ts src/app/calendar-event-modal.tsx src/app/task-time-tracking-modal.tsx
git commit -F- <<'MSG'
feat(help): wire the meeting-series and task-effort icons

Both modals were deliberately unwired last slice rather than left pointing at
an entry about a different subject -- the calendar modal at one enumerating
"tasks, absences, and holidays" while it edits recurring meeting series, the
time-tracking modal at the external Timelog integration while it edits a
task's own estimate. Both now point at entries written for them.

The comments recording each absence as deliberate are deleted in this commit
rather than left contradicting the code.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 7: Wire the one bespoke site that survived re-review

**Files:**
- Modify: `src/app/raci-suggest-modal.tsx`, `src/app/help-content.ts`, `src/app/help-content.test.ts`
- Create: `src/app/help-icon-button.test.tsx`

★ Do this only for candidates that survived Task 3 Step 3's by-eye re-review. Wire fewer if fewer survived.

- [ ] **Step 1: Add the `MODAL_HELP` rows**

```ts
  raciSuggest: "concept-raci",
```

★★★ **ONE ROW, NOT THREE — the other two candidates were downgraded in Task 3's re-review.** Do not add `steeringReport` or `recommendationReview`; they are REFUSE-NO-CONTENT and are recorded in Task 8 instead.

Raise the floor to `expect(entries.length).toBe(22)` (**not** 24).

- [ ] **Step 2: Render the button in each dialog's own title row**

`raci-suggest-modal.tsx` hand-rolls its chrome, so there is no shared slot — place it beside the dialog's existing title, before its close control:

```tsx
<HelpIconButton lang={lang} conceptId={MODAL_HELP.raciSuggest} dialogTitle={title} />
```

★ The local `title` is already in scope: `const title = t(lang, "raciSuggestTitle");` → "Proposed RACI assignments". Pass that binding, not a new literal.

★ `dialogTitle` must be the dialog's own visible title. Passing a bare literal like `"Help"` would give two stacked dialogs the same accessible name — the WCAG 2.4.6 defect no gate can see. ★★ A *constant* is fine **here specifically**: `RaciSuggestModal` has exactly one call site (`use-raci-suggest.tsx`) and renders from a hook, so two instances of it can never stack, and its title is distinct from every other dialog's. Do not generalise that to a per-row control, where the value can repeat within one rendered list — that is the whole premise of this defect class.

★★ **USE THE PRIMITIVE, DO NOT HAND-ROLL.** `HelpIconButton` is the single renderer of a help popover; a headerless dialog must not grow its own. If it does not fit this dialog's title row, STOP and report rather than inlining a substitute.

- [ ] **Step 3: Write `help-icon-button.test.tsx` — with a real collision seed**

★★★ **ADD A THIRD TEST: THE TAB-CONTAINMENT PIN. A cold review of Task 1 found the behaviour moved but its pin did not.** The close button is load-bearing for focus containment, and that guarantee now lives in `help-icon-button.tsx` — but its ONLY test is `modal-header.test.tsx`'s "keeps Tab inside the dialog while the help popover is open", reachable solely through `ModalHeader`. This is the `path-scanning-test-does-not-follow-a-move` shape: a headerless consumer gets no local pin, and renaming or pruning the header suite silently unpins the claim without a single gate noticing.

Write a test that renders `HelpIconButton` inside a `Modal`, with **one focusable control outside the modal**, opens the popover, drives enough `userEvent.tab()` presses to cycle, and asserts focus never reaches the outside control or `document.body`. ★ The outside control is the anti-vacuity half — without it the assertion passes against a fixture where focus had nowhere to escape to in the first place.

★★ **Mutate it to prove it fires:** delete the popover's close button (its only focusable child) and confirm the test goes RED — that is the exact defect the button exists to prevent, measured last slice at `document.body` on press 4 and an outside control on press 5. Record `N failed / M passed`, and revert by an anchored inverse Edit with a uniqueness assertion in both directions, ending on an empty `git diff --stat`.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpIconButton } from "./help-icon-button";
import { MODAL_HELP } from "./help-content";

describe("HelpIconButton", () => {
  it("renders nothing when the id resolves to no entry", () => {
    // ★ ANTI-VACUITY: a positive observable in the SAME test. Without the
    // sibling, this passes against a component that failed to render at all.
    render(
      <div>
        <button type="button">sentinel</button>
        {/* @ts-expect-error deliberately not a HelpEntryId */}
        <HelpIconButton lang="en-US" conceptId="not-a-real-entry" dialogTitle="X" />
      </div>,
    );
    expect(screen.getByRole("button", { name: "sentinel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Help/ })).not.toBeInTheDocument();
  });

  it("gives two dialogs' icons distinct accessible names", async () => {
    // ★★ A REAL COLLISION SEED: two genuinely different titles. A single
    // instance satisfies a distinctness check trivially and is vacuous.
    render(
      <div>
        {/* ★★ SAME conceptId, DIFFERENT dialogTitle. That is the sharper seed:
            it proves the accessible name derives from the DIALOG TITLE and not
            from the entry, which two different conceptIds could never isolate. */}
        <HelpIconButton lang="en-US" conceptId={MODAL_HELP.raciSuggest} dialogTitle="Suggest RACI" />
        <HelpIconButton lang="en-US" conceptId={MODAL_HELP.raciSuggest} dialogTitle="Committee report" />
      </div>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Help – Suggest RACI");
  });
});
```

★ The EN DASH in `"Help – Suggest RACI"` is U+2013, matching `modalHelpAbout`. An ASCII hyphen fails.

- [ ] **Step 4: Run both suites (never two vitest processes at once)**

```bash
npx vitest run src/app/help-icon-button.test.tsx src/app/help-content.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
```

- [ ] **Step 5: Mutant A — the widened regex is now live**

Revert `help-content.test.ts`'s pattern to the narrow `/helpConceptId=\{MODAL_HELP\.…\}/g` via Edit. Re-run. Expected: **RED**, with the three new keys reported as unwired. Record `N failed / M passed` and check `N + M` equals the file's runtime test count. Revert by an anchored inverse Edit, assert the anchor is unique in both directions, and end on `git diff --stat` printing nothing for that file.

- [ ] **Step 6: Mutant B — the collision seed is live**

Change one `dialogTitle` in the collision test so both instances receive the **same** title. Expected: **RED** on `new Set(names).size`. Record the tally, revert the same way.

- [ ] **Step 7: Commit**

```bash
git add src/app/help-content.ts src/app/help-content.test.ts src/app/help-icon-button.test.tsx src/app/raci-suggest-modal.tsx
git commit -F- <<'MSG'
feat(help): wire the one headerless dialog that has an entry

Of the thirteen headerless Modal sites, five are structurally not help
candidates and seven have no entry on their subject. This one does, and the
pairing was re-read against the entry's real title and body rather than
accepted from a term probe -- the id union catches a mistyped id, never a
well-spelled wrong one.

Two candidates the term probe offered were downgraded on that re-read.
feature-steering describes the committee record -- members, meeting schedule,
information-pack lead days -- not the per-meeting status report editor the
dialog actually is. automated-insights describes detection and triage and
never mentions recommendations, previews or applying, which is the only
question its dialog poses. A wrong entry is worse than no icon.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 8: Record the twelve refusals

**Files:**
- Modify: 12 dialog files (5 structural + **7** no-content)
- Modify: `docs/open-followups.md`

★★★ **SEVEN NO-CONTENT SITES, NOT FIVE.** Task 3's re-review downgraded `steering-committee-panel` and `insights/recommendation-review-modal` from WIRE. Their refusal comments must carry the specific evidence below, not a generic reason — a refusal that does not say *what was checked and rejected* gets re-litigated by the next reader.

**`steering-committee-panel.tsx`** — the entry checked was `feature-steering`, whose subject is the committee record (name, members, meeting schedule, information-pack lead days, Outlook push), while this dialog is a per-meeting status-report editor (rich text, recipients, Send, AI Generate, versions + Restore). Probe over all 66 bodies at 66/66 resolved: `"status report"` matches **0 of 66**; the broader `"report"` matches **11 of 66** and every one is a different sense — the Reports nav entry, the Reports tab, task statistics, Planning's utilization pop-out, and several as a plain verb. `concept-steering`, `feature-version-history`, `feature-rich-text` and `feature-reports` were each considered and each fails. Name in the comment that the "information pack" is the lead-day reminder rule (`committeeInfoSchedules`), NOT the stored `MeetingReport` — that conflation is the trap.

**`insights/recommendation-review-modal.tsx`** — the entry checked was `automated-insights` (detection and triage: five watched patterns, the status lifecycle, where insights are listed). Probe over the same corpus: `"recommend"` matches **1 of 66** (`feature-template-suggest`, a project template), and `"apply|applied"` matches **4 of 66** (`feature-templates`, `feature-per-project-functions`, `feature-documents`, `feature-timelog`) — none the sense of applying an AI-proposed write. ★★ **State the alternation you probed.** The wider `apply|applied|applies` returns **6**, adding `feature-timezones` and `feature-ai` in the scope sense; quoting 4 against the wider pattern, or 6 against the narrower, is exactly the kind of unlabelled-convention defect Task 10 is correcting in §453. Name `feature-inline-ai-edit` as the near-miss — it describes the mechanic almost verbatim and shares an `EditPlan` shape, but its "without leaving the row" scoping makes it wrong here — and note that `feature-ai-advanced` asserts the AI helpers "never edit your data", so no existing entry can serve this surface.

- [ ] **Step 1: Add a refusal comment at each of the five REFUSE-NO-CONTENT sites**

Follow the shape the two Task 6 comments used to have. Example for `task-dedup-modal.tsx`:

```tsx
      {/* ★ NO help icon, deliberately. This dialog resolves duplicate TASKS;
          measured over all 66 help bodies at 66/66 resolved, "dedup|duplicat"
          matches 4 and every one is a different sense — duplicate
          accountability in RACI, duplicate stakeholders, duplicate committee
          members, duplicate document versions. A wrong entry is worse than no
          icon. See docs/open-followups.md for the entry collecting all five. */}
```

Do the same for `alloc-plan-modal` (`allocat` → 1 body, `concept-resource`), `calendar-pull-summary-modal` (`outlook` → 3, all steering/activity), `comm-send-preview-modal` (`communicat|email` → 3, all incidental), `pick-list-import-modal` (`import` → 2, both incidental).

- [ ] **Step 2: Add a one-line comment at each of the five REFUSE-STRUCTURAL sites**

```tsx
      {/* ★ NO help icon: a transient progress dialog, gone before a reader
          could open one. §424's rule — a dialog declaring nothing is the
          designed answer for progress, confirmations and gates. */}
```
Adjust the reason per site: progress (`actions-panel`, `step0-import-panel`, `timelog-panel`), acknowledgement gate (`integration-disclaimer`), already information (`version-info`).

- [ ] **Step 3: Record the `help-menu` exclusion**

Add to `help-menu.tsx`, near its header:

```tsx
      {/* ★ NO help icon here, and this is not an oversight: this window
          renders HelpContentPane — it IS Help. Do not "complete the pattern". */}
```

- [ ] **Step 4: File the new register entry**

Add a new `## <n>.` heading to `docs/open-followups.md` for the **seven** no-content subjects, where `<n>` is one past today's max. Derive it — never trust a quoted number:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

**Measured 2026-09-10: max is 453 on this branch AND on `origin/main`, so the new entry is §454** (`git show origin/main:docs/open-followups.md | grep -cE "^## 454\."` returns 0). Re-derive anyway — that check is cheap and the number moves.

★★★ The number is reserved only once on `origin/main`; two branches have minted the same one before. Re-check at merge time.

The entry needs a `**Status:**` line with today's ISO date that cites a command or says `never machine-verified` — `followups-status-check` is blocking. It also needs an index row between the `INDEX:BEGIN` / `INDEX:END` markers — `followups-index-check` is blocking.

★★★ **DO NOT add a second index row for an existing section.** The gate compares SETS and is structurally blind to a duplicate; it reports duplicates on a separate axis precisely because of that.

- [ ] **Step 5: Run the two register gates unpiped**

```bash
npm run followups:status:check > /tmp/fs.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/fs.log
npm run followups:index:check > /tmp/fi.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/fi.log
```
Expected `EXIT=0` both. ★★ **Exit 1 is DRIFT; exit 2 is the gate unable to scan** — a scan that reads nothing passes everything, so 2 demands the opposite response to 1.

- [ ] **Step 6: Commit** (name every path; never `git add -A`).

---

## Task 9: Measure `notes-window` — then wire or refuse

**Files:**
- Modify: `src/app/notes-window.tsx` (only if the measurement permits)

★★★ **MEASURE FIRST. DO NOT REASON.** Every surface wired so far renders inside `<Modal>`, so `PopoverPanel`'s `kind: "modal"` push lands above a `Modal` entry that knows to defer. `notes-window` hand-rolls its chrome via `useDraggableWindow` and pushes its own dismissal entry, so the stack shape differs and nothing has measured what Tab does there.

★★★ **MEASURED AHEAD OF THIS TASK, AND IT REFRAMES THE QUESTION.** `notes-window.tsx` registers `useDismissable({ open, kind: "layer", onDismiss: onClose, claims: claimsFocusWithin })`. Its kind is **`"layer"`, not `"modal"`** — and the window is `role="dialog"` **without** `aria-modal`. So the mechanism the plan assumed (a `Modal` Tab trap that `PopoverPanel`'s `"modal"` push stands down) is not present here at all: there may be **no Tab trap in `notes-window` to stand down**.

★★★ **THEREFORE THE PROBE NEEDS A BASELINE CONTROL, AND WITHOUT ONE ITS VERDICT IS UNATTRIBUTABLE.** If Tab already walks out of `notes-window` today — with no help icon anywhere near it — then observing that it walks out *with* one proves nothing about the icon, and refusing on that basis would be recording a pre-existing property as a regression this slice caused. A negative observation needs a falsifier attached.

- [ ] **Step 1: Measure the BASELINE first — `NotesWindow` with NO help icon**

Render `NotesWindow` open, plus **one button outside it**, and drive twelve `userEvent.tab()` presses. Record the landing element on each press. This is the control.

- [ ] **Step 2: Measure the TREATMENT — the same fixture plus a `HelpIconButton` inside, popover OPEN**

Identical fixture and identical twelve presses, changing only the icon's presence and the popover being open. This mirrors the probe that found the `Modal` case (`document.body` on press 4, an outside control on press 5).

- [ ] **Step 3: Read the DIFFERENCE, never the treatment alone**

- **Baseline already escapes, treatment escapes no earlier** → the icon changes nothing; containment was never a property of this window. **WIRE is permissible**, and the commit body must say plainly that `notes-window` does not contain Tab today and that this slice did not change that. Do NOT claim the icon is contained.
- **Baseline contains, treatment escapes** → the icon caused it. **REFUSE**, and record the exact press number and landing element in `notes-window.tsx` and in the §424 Status line.
- **Baseline contains, treatment contains** → **WIRE**, floor to 23 (not 25 — Task 7 wires one site, not three), keep both sets of numbers in the commit body.

★ Report both twelve-press sequences verbatim whatever the verdict. "Measured, refused, recorded" remains an acceptable outcome for this slice, not a failure — but so is "measured, wired, and here is why the escape was pre-existing".

- [ ] **Step 3: Commit** either the wiring or the recorded refusal.

---

## Task 10: Correct §453 and update §424

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Correct §453's positive controls**

§453 records `task=59 budget=20 milestone=19 risk=10` beside findings that are **body** counts. Label both conventions explicitly so the next reader rebuilding the probe calibrates against the right one.

**VERIFIED 2026-09-10 — both rows reproduce exactly** (66/66 bodies resolved, titles and primers excluded, case-insensitive):

| term | occurrences | bodies (of 66) |
|---|---|---|
| task | **59** | **28** |
| budget | **20** | **14** |
| milestone | **19** | **13** |
| risk | **10** | **8** |

★★★ **THE MATCHING CONVENTION IS BARE SUBSTRING, AND THE ENTRY IS ONLY SELF-CONSISTENT READ THAT WAY** — "tasks", "multitask" and "task's" all count toward `task`. Under whole-word (`\btask\b`) the figures move materially and §453's own controls **stop reproducing**: task 59→35 occurrences, milestone 19→8, risk 10→4, because plurals are the dominant form. So the correction must name the convention, not merely split occurrences from bodies.

★★ Say in the correction *why* mixing them misleads rather than merely being untidy: the gap is **not a fixed ratio**, so a reader cannot convert between conventions. `task` runs 2.1 occurrences per matching body, `budget` 1.4.

★★ No conclusion moves — `series`, `image` and `asset` each return **0 occurrences and 0 bodies, under substring AND whole-word**. Substring is the stricter test of a zero (it can only match more, never less), so the three zeroes are not a tokenisation artifact. Say that in the correction, so it does not read as a retraction of the gaps.

- [ ] **Step 2: Update §453's gap statuses** — gaps 1–3 filled by Task 5, both re-wirings by Task 6.

- [ ] **Step 3: Update §424's Status**

Record: the corrected surface counts (33 / 33 / 20 / 13, against the 34 / 36 / ~14 it carried), the extraction, the triage outcome, the `help-menu` exclusion, and the `notes-window` verdict. Strike gap 1 if every remaining surface is now WIRE or a recorded REFUSE.

★★ Keep §424's "unmeasured" list intact — no `EditModalShell` consumer, the flip-above branch, the viewport clamp under stress, the three >1000-char bodies, non-Chromium. This slice does not touch them.

- [ ] **Step 4: Commit.**

---

## Task 11: Green gate chain

★ Run these **one at a time**. Never two vitest processes at once.

- [ ] **Step 1**
```bash
npx tsc --noEmit > /tmp/g-tsc.log 2>&1; echo "EXIT=$?"; grep -c "^src/" /tmp/g-tsc.log
```
Expected `src/` count **0**. ★ A stale `.next/dev/types/validator.ts` makes tsc exit 2 with zero `src/` errors — remedy `Remove-Item -Recurse -Force .next`, never edit generated files.

- [ ] **Step 2**
```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```
★ Lint `src`, not `.`, or gitignored `.worktrees/` leftovers fail it. Without `--max-warnings=0` it is weaker than CI and exits 0 while printing warnings.

- [ ] **Step 3**
```bash
npm run test:run > /tmp/g-suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g-suite.log
```

- [ ] **Step 4**
```bash
npm run test:shuffle > /tmp/g-shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g-shuffle.log
```
★ The only local reproduction of the `unit-tests-shuffled` gate. Required because this slice adds test files.

- [ ] **Step 5: axe on the affected views**
```bash
PORT=3100 npm run dev &
curl -o /dev/null -s http://localhost:3100/
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/g-axe.log 2>&1; echo "EXIT=$?"
PORT=3100 npm run stop
```
★★★ `--workers=1` is mandatory: local runs default to CPU-count while CI runs serially, and over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and are **not** violations. Read the failure body, never the summary line.
★★ **A green axe run proves nothing about this feature.** `e2e/a11y.spec.ts` opens no `Modal` at all — its only three clicks are the Board toggle, the Notes badge and Documents' "Edit blocks". It means "nothing regressed". Do not report it as coverage.

- [ ] **Step 6: Doc and size gates**
```bash
npm run docs:symbols:check > /tmp/g-sym.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/g-sym.log
npm run docs:claims:check > /tmp/g-claims.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/g-claims.log
npm run size:check > /tmp/g-size.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/g-size.log
```

- [ ] **Step 7: Confirm a clean tree**
```bash
git status --porcelain=v1
```
Expected: no `M` on any file this slice did not intend, and **no** `sample-workspace-huge.json` or `not-in-use.env.local.bak` staged. Any leftover mutant is a failure — sweep before reporting.

---

## The slice ENDS here

**NO** version bump, **NO** `CHANGELOG.md` entry, **NO** push, **NO** MR. Release is a separate explicit instruction from the user.

### ★★★ RELEASE-TIME CONSTRAINT — the base is moving under us

Peer session `aipm-wt-a-56` has **MR !465 (0.300.0 "Mohanraj")** in flight, `feat/ai-prompt-quality-harness` → `main`, pipeline #6800, merging on green with auto-merge explicitly off. This branch was cut off `origin/main` = `9adcafde` (0.299.0).

- **DO NOT REBASE UNTIL !465 LANDS.** It carries ~60 commits and moves `main` to 0.300.0. Rebasing first means doing the work twice.
- **Nothing in it renames, moves or deletes an existing i18n key**, so the six appended `helpSec*` keys should apply cleanly.
- ★★ **If git surfaces `helpSecUsageLimitsBody`, KEEP BOTH SIDES.** `f37bc539` rewrites that one key's VALUE in both dictionaries (dropping a retired counting-multiplier claim); our change appends six new keys after `helpSecPrint*`. The two are independent — resolving either-or silently drops one.
- ★★ **Re-assert the DE anchor's uniqueness after rebasing.** ~60 commits will have moved it; the measured `i18n.de.ts:3546` is a fact about the pre-rebase tree only. Task 5b's script asserts presence and uniqueness in both directions before writing, which is exactly the case this covers — do not weaken it to a bare `indexOf`.
- ★ **`vitest.config.ts` in !465 widens the scripts glob to `scripts/**/*.{test,spec}.ts`** as well as `.mjs`. A stray probe file left under `scripts/` therefore becomes part of the CI unit run. Verified 2026-09-10 for this slice: every probe was written to the session scratchpad OUTSIDE the repo and `git status --untracked-files=all` shows no stray `.mjs` in the tree. Re-check before pushing.
- ★ !465 also moves the README feature table to `docs/features.md`. This slice touches no README prose, so it should not matter — but the region will look different.
