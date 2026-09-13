# Log a signal as RAID + escalation record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user turn an insight or a next action into a RAID item through the existing RAID editor, floated over the current view. Record every Escalate on the RAID item itself, as a structured `escalations` field with a note-log echo and a `raid.escalated` activity entry. Let the AI assistant append an escalation too (append-only, no e-mail), with the same effects as the Escalate button.

**Architecture:**
- Pure builders move into `raid-draft.ts` (draft and seed) and `action-escalate.ts` (escalation entry and record).
- A new `raid-escalation.ts` owns validation and the JSON-in-cell codec for `RaidItem.escalations`. The field rides every RAID codec, because the Turso DDL and INSERT derive from `RAID_CSV_COLUMNS`.
- A `useRaidCreate` hook and a `RaidCreateHost` component (`raid-create-host.tsx`) own the create draft, mounted once in `task-manager.tsx`.
- Openers reach next actions through the existing `ActionHandlers` chain, and reach insights through the `InsightActions` bag.
- Saving calls `handleSaveRaidItem(item, true)`, which now returns the committed (possibly re-minted) id. The insight writer stores that id as `Insight.loggedRaidId`.
- A dedicated, token-guarded `escalate_raid_item` tool (Task 3b) appends ONE escalation through the same pure builders `handleEscalate` uses (`planEscalation` → `buildEscalationRecord`, `escalationActivityArgs`), as one functional `setRaid` with undo capture and a `raid.escalated` row (actor `ai`). Its note is authored "AI created". `RAID_FIELD_GUARDS.escalations` still refuses the raw field on create/update.

**Tech Stack:** Next.js (pinned), React 19, TypeScript, Vitest + Testing Library, fast-check, GitLab CI.

**Spec:** docs/superpowers/specs/2026-09-13-raid-signal-log-escalation-design.md

**Pre-condition:** this plan file is committed by the coordinator BEFORE Task 1 starts, so the tree is clean at every task boundary (Task 8 relies on it).

## Spec deviations

Each deviation below was found in the code while planning. The plan follows the code.

1. **`sanitize-records.ts` already sits AT the size LIMIT.**
   - Evidence: `node -e "console.log(require('fs').readFileSync('src/app/sanitize-records.ts','utf8').split('\n').length)"` prints `1600`, and `scripts/check-file-sizes.mjs` fails only when `n > LIMIT`, with `LIMIT = 1600`.
   - Change: the escalation sanitizer lives in a new `src/app/raid-escalation.ts`. Task 2 compacts three one-symbol multi-line imports in `sanitize-records.ts`, so the file ends at 1598 lines.
2. **`escalations` is an array, so its codec copies `noteLog`, not `inquiriesSent`.**
   - `inquiriesSent` is a scalar count. The cell codec therefore copies `encodeNoteLog`/`decodeNoteLog` (JSON-in-cell).
   - The `inquiriesSent` grep is still labelled site by site in Task 2.
3. **JSON and IndexedDB never call `sanitizeRaidItem`.**
   - Evidence: `grep -n "sanitizeRaidRichFields" src/app/workspace.ts src/app/browser-backend.ts` shows both map RAID rows through `sanitizeRaidRichFields` only.
   - `escalations` therefore passes through those two paths unvalidated, exactly like `inquiriesSent`. Every reader goes through `lastEscalation` / `Array.isArray` guards, which re-validate.
4. **`handleSaveRaidItem` must carry the STORED `escalations`, not only the stored `noteLog`.**
   - The RAID tabpanel is mounted unconditionally and never remounts (AGENTS.md "Remount-swallow" bullet).
   - Without the carry, this sequence silently wipes the record: open a RAID editor → switch to Next actions → Escalate that item → return → Save.
   - This is the same defect class as §48. The spec does not mention it.
   - **Severity must be carried too, conditionally.** The same stale draft carries the pre-escalation `severity`, so keeping only the record would still silently put an escalated High → Critical back to High.
   - Rule (Task 2): when the stored row has MORE escalations than the draft AND `draft.severity` equals the `fromSeverity` of the FIRST escalation the draft has not seen that carries one (`storedEsc.slice(draftEscCount).find(e => e.fromSeverity !== undefined)?.fromSeverity`), save `previous.severity`. A deliberate user change to any other severity still wins.
   - ★ Corrected in Task 2's fix round: the first draft compared against the LAST stored escalation. Two raises (Medium → High → Critical) or a raise followed by a notify-only entry then let a stale Medium/High draft silently undo the raise.
5. **`buildNewRaidDraft` and `applyStatus` need `today`.**
   - `openNew` reads `today` for `raisedDate`, and `applyStatus` reads it for `closedDate`.
   - The signatures are therefore `buildNewRaidDraft(raid, category, today)` and `applyStatus(draft, status, today)`.
6. **`buildEscalationRecord` needs a note author.**
   - `addNote` takes `{ self, authorName }`.
   - The signature is `buildEscalationRecord(item, plan, recipient, at, noteText, author)`. `useActionCenterHandlers` gains a `selfResourceId` dep, and `task-manager.tsx` passes `settings.selfResourceId`, as `useNotesWindow` already does.
7. **`raid.escalated` cannot carry a `changes` object.**
   - The deps logger is `logActivity(kind, ...args)`.
   - The entry is `logActivity("raid.escalated", id, fromSeverity, toSeverity)` with message `"RAID #{0} escalated: {1} → {2}"`. A notify-only escalation passes the current severity (or `—`) on both sides. No e-mail address is ever an argument.
   - The AI `escalate_raid_item` tool logs the same kind with the same two args through `escalationActivityArgs`, actor `ai` (Task 3b).
8. **`InsightsCard` only lists `active`/`acknowledged` insights.**
   - A freshly logged insight is `acted`, so it leaves the card, just as Act does.
   - "Logged as RAID #N" + Open still renders on BOTH surfaces. On the card it becomes visible when reconcile re-fires the insight back to `active` (the re-fire branch now carries `loggedRaidId`).
9. **Document exports would leak escalations.**
   - `export-sections.ts` builds the RAID export table from `RAID_CSV_COLUMNS`, so a new column would appear as raw JSON with recipient e-mail addresses in DOCX/PPTX/XLSX.
   - To honour "Out of scope: escalations in exports", Task 2 filters the column out through a new exported `RAID_EXPORT_COLUMNS`.
10. **The offered-surface sweep derives its Relation A axis from `RAID_CSV_COLUMNS`.**
    - Source: `src/test/offered-surface-axis.ts`, `PERSISTED_COLUMNS`. The new column therefore enters the model-write sweep.
    - `probeFor` never invents a value, so Task 2 seeds `escalations` in `seedGuardedRaid` and adds it to `AXIS_FIELDS.raid`.
    - `escalations` is deliberately NOT added to `TOKEN_EXCLUDED.raid`. `RAID_FIELD_GUARDS` is then its single model-write guard, which keeps that guard mutation-provable (a second guard would mask the mutant).
    - Consequence: a concurrent escalation invalidates a pending AI update token for that item, which also happens through `severity` whenever it raises.
11. **"Log as RAID" on the Insights view uses the same status gate as Act** (`active`/`acknowledged`), plus the spec's `raidAging` and `loggedRaidId` exclusions.
12. **The host closes itself on `onJumpToRaid`.** It closes with no side effects, then calls `requestOpen("raid", id)`; otherwise two RAID editors would be open at once.
13. **The host lands in two tasks.** Task 5 ships the action origin only. Task 6 adds the insight origin, because the insight writer needs `loggedRaidId`, which Task 6 introduces.
14. **The model-write sweep pins the RAID axis SIZE.**
    - `src/test/offered-surface-axis.ts` `AXIS_BASELINE.raid` is `{ declared: 16, undeclared: 6 }`, and `plan.offered-surface-sweep.test.ts` asserts it with `toEqual`.
    - The new column makes `undeclared` 7. Task 2 updates the constant.
    - Evidence: `git grep -n -E 'AXIS_BASELINE|undeclared: [0-9]+' -- src`. `AXIS_BASELINE` is the only count-pinned column axis; every other reader derives from it.
15. **`handleEscalate` plans ONCE, and has one known limit.**
    - The spec implies the record is planned against the live row. But the log arguments and the mail must be produced OUTSIDE the updater (updaters must be pure), and the hook has no live RAID ref. `task-manager.tsx`'s `raidRef` is synced in a `useEffect`, so it is no fresher than the `raid` dep.
    - Task 3 therefore computes `plan` and the entry once from the render-scope row, and applies THAT plan inside the functional updater. Record, log and mail always agree, and concurrent writes to other fields and rows survive.
    - Known limit (documented in the code comment): a same-tick concurrent SEVERITY write is overwritten by the planned step.
16. **Activity entries show raw severity enums.**
    - `activityMessage` passes `args` untouched to `t` (verify: `grep -n "return t(lang, key, ...args)" src/app/activity-message.ts`). `raid.statusChanged` already renders raw `RaidStatus` values the same way.
    - `raid.escalated` therefore shows `High → Critical` in German too. This is a known limit, not fixed here.
17. **USER DECISION 2026-09-13 — overrides the spec's "escalations is model-read-only".** The AI can record an escalation, APPEND-ONLY, through a dedicated `escalate_raid_item` tool (Task 3b), never through `update_raid_item`.
    - Effects = the human Escalate minus the mail: the entry, the note-log echo, a `raid.escalated` row (actor `ai`) and the severity step from the same `planEscalation`, as ONE functional write with undo capture.
    - Raw `escalations` writes through `create_raid_item` / `update_raid_item` stay blocked: `RAID_FIELD_GUARDS` is unchanged and stays the single raw-field guard (deviation 10 holds). The committed Task 2 names `dropUnacceptedRaidFields — escalations is model-read-only (§515)` and the `RaidEscalation` docstring predate this decision; the describe title is kept (M3 greps it) and means "through create/update", while Task 3b corrects the docstring.
    - Why a separate tool: a new input on the pass-through update tool would move `AXIS_BASELINE.raid`, the inline-preview coverage gate and the inline popover's offered surface; a separate tool moves none of them.
    - Review flow (user decision): ONE AI escalation applies immediately and is undoable; two or more in one turn stage on the existing review card (`shouldStage`'s existing entity-write count — the tool joins `ENTITY_WRITE_TOOLS` as non-destructive).
18. **The tool is token-guarded and the recipient links by e-mail.** `escalations` and `severity` are both token-covered, so the token is required, and it also refuses a second escalation made from the same read. No `toResourceId` input: `LINK_FIELDS` remaps id ARRAYS only, so a scalar id minted earlier in a staged turn would be stored dangling. New registry rows: `TOKEN_ROW_SOURCE`, `UPDATE_TARGET` (the recommend-tokens drift test pins the unstampable list exactly), `ENTITY_WRITE_TOOLS`, `TARGET_MINTED_BY`. `ALLOWED_REC_TOOLS` is deliberately unchanged.
19. **USER DECISION 2026-09-13 — an AI escalation note is authored "AI created".**
    - Stored as a literal `authorName` (EN "AI created", DE "Von KI erstellt", i18n key `raidNoteAuthorAi`) translated once at write time in `settings.language`, with NO `authorResourceId` — never `settings.selfResourceId`, which would credit the user with a line they did not write.
    - `addNote` today DROPS `authorName` unless `self != null`, so Task 3b widens it to keep an explicit `authorName` on its own. Behaviour-neutral for its only other caller: `use-notes-window.ts` derives `notesAuthorName` from the resource whose id is `notesSelf`, so it is undefined whenever `notesSelf` is null.
    - Consequence (existing rule, unchanged): `canEditNote` treats a note without `authorResourceId` as editable by anyone, and `editNote` claims it for the editor.
20. **CONTROLLER RULING 2026-09-13 — undoing an AI escalation keeps its note.**
    - Why: `noteLog` is a write-through field (`WRITE_THROUGH_FIELDS`, `src/app/undo/write-through-fields.ts`), so `capturePart`'s restore lets the LIVE log win over the before-image on every whole-row undo (open-followups §50). There is no per-capture override, and the shared undo engine is deliberately NOT changed.
    - Cost: undo reverts the escalation entry and the severity step, but an undone AI escalation leaves its "Escalated to …" note (authored "AI created") behind.
    - Pinned in both halves by the `escalateRaid` site in `use-chat-dispatcher.undo.test.tsx`, so a future opt-out is a visible test change; named at the writer and in `docs/AGENTS/ai-assistant.md`. That site's row 2 is seeded an Issue at High, so severity is Critical after the write and High after undo; a severity-less Risk would make the severity half vacuous (fix round 1).
    - Second known limit at the same writer (concurrent delete, as `handleEscalate`): if the row vanishes between the ref read and the updater, the updater writes nothing, yet the tool still returns success, logs `raid.escalated` and captures an undo entry.
21. **Task 3b implementation corrections (the plan text below is already corrected).**
    - `requireEscalationRecipient` lives in `raid-escalation.ts`, not `chat-tools-updates.ts`: `inline-ai-edit/tool-input-coverage.test.ts` scans EVERY `input.<name>` read in `chat-tools-updates.ts` against `update_task`'s schema, so `toEmail`/`toName` there failed it, and allowlisting them would be a false coverage claim. `chat-tools-updates.ts` is unchanged.
    - `settingsRef` joins the `useRegisterTools` `useMemo` deps: the escalation writer is the first body there to read it directly, and `react-hooks/exhaustive-deps` is fatal.
    - `chat-proposal-apply.test.tsx`'s generalised TOKEN_ROW_SOURCE loop passes `toEmail`: `escalate_raid_item` checks the recipient AFTER the token, so without it the loop reports a recipient error against a valid token.
    - Fix round 1 additions:
      - `chat-tools.test.ts` gains boundary POSITIVE controls: a 320-character email and a 200-character name are accepted, so a `>`→`>=` slip in `requireEscalationRecipient` goes red.
      - In `raid-escalation.ts` the function sits below ALL the constants (after `AT_MAX` / `SEVERITY_SET`), and the module header names it.
      - The undo test's SEED row 2 becomes `{ ...seedRaid(2, "R2"), category: "I", severity: "High" }`.

## Global Constraints

- **i18n**
  - New keys go in `src/app/i18n.ts` (EN) AND `src/app/i18n.de.ts` (DE, real umlauts). `npx tsc --noEmit` enforces key parity.
  - NEVER use the Edit or Write tool on `i18n.de.ts`. Patch it with the node script below, which matches `\r\n` anchors (the DE file is CRLF: `git ls-files --eol src/app/i18n.de.ts` → `i/lf w/crlf`), then re-verify.
  - The JSON input to the script uses `\u` escapes for every non-ASCII character, so no tool can corrupt it.
  - Create the script ONCE as `$S/patch-de.mjs` (Task 3 Step 1 creates it; later tasks reuse it):

    ```js
    // patch-de.mjs — insert lines after single-line anchor entries in src/app/i18n.de.ts (CRLF).
    import { readFileSync, writeFileSync } from "node:fs";
    const FILE = "src/app/i18n.de.ts";
    const inserts = JSON.parse(readFileSync(process.argv[2], "utf8"));
    let s = readFileSync(FILE, "utf8");
    for (const { after, lines } of inserts) {
      const needle = "\r\n" + after;
      const start = s.indexOf(needle);
      if (start < 0) throw new Error("anchor not found: " + after);
      if (s.indexOf(needle, start + 1) >= 0) throw new Error("anchor not unique: " + after);
      const eol = s.indexOf("\r\n", start + 2);
      if (eol < 0) throw new Error("anchor has no line end: " + after);
      for (const l of lines) {
        const key = l.trim().split(":")[0];
        if (s.includes("\r\n  " + key + ":")) throw new Error("key already present: " + key);
      }
      s = s.slice(0, eol + 2) + lines.map((l) => l + "\r\n").join("") + s.slice(eol + 2);
    }
    writeFileSync(FILE, s, "utf8");
    const lfOnly = (s.match(/(?<!\r)\n/g) || []).length;
    console.log("patched; LF-only line ends:", lfOnly);
    if (lfOnly !== 0) process.exit(1);
    ```

  - Run it as `node "$S/patch-de.mjs" "$S/de-taskN.json"`. It must print `LF-only line ends: 0`.
  - Placeholders are 0-based positional (`{0}`). `Lang` literals in tests are `"en-US"` (there is no `"en"`). A test asserting German output must `await loadI18n("de")` first.
- **Line endings and editing**
  - `src/app/*.ts(x)` and `src/test/*.ts` are CRLF in the working tree (`i/lf w/crlf`). Edit them with the Edit tool only.
  - Never Write-tool a whole EXISTING file, and never use `sed -i`.
  - NEW files may be created with the Write tool; git normalises them on add.
  - `docs/open-followups.md` is LF.
- **Exit codes:** never read a gate's exit code through a pipe. Always run `cmd > "$S/x.log" 2>&1; echo "EXIT=$?"`, then grep the log.
- **Vitest**
  - Run with `npx vitest run <files> --maxWorkers=1 --reporter=dot`, in the foreground.
  - Never run two vitest processes at once, and NEVER run the full suite.
  - After every run, assert that the `Test Files  N passed` count equals the number of files you passed. A mistyped path is dropped silently at exit 0.
- **Typecheck:** run `npx tsc --noEmit` after editing ANY test file.
- **Git**
  - `S=C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad` (define it in every shell).
  - Stage NEW files with `git add -- <paths>`, then commit with `git commit --only -F "$S/msg-taskN.txt" -- <every path of the task>`.
  - NEVER use `git add -A`/`.`, `--amend`, bare `git stash`, or `npm ci`.
  - `git checkout --`/`git restore` are blocked; revert with an inverse Edit.
  - Never touch untracked files the task did not create.
  - Use conventional commit types. Every message file ends with a blank line and then `Claude-Session: https://[session link removed]`.
  - Write message files with the Write tool.
- **UI**
  - Nothing hand-rolled: `Button` (`variant="secondary" size="xs"`, exactly as Act/Acknowledge use it), `SortResizeTh`, `RaidEditModal`, and `PopoverPanel` through `ActionOverflowMenu`'s existing `item()`.
  - Accessible names are row-unique with `` `${verb} – ${nameToken}` `` on insight rows and `rowLabel(verb, rowToken)` on action rows.
  - Palette tokens only. Icons only from `src/app/icons.ts` (no new icons are needed).
- **Lint**
  - `--max-warnings=0`: an unused var or import is fatal.
  - No `react-hooks/set-state-in-effect`.
  - No `Date.now()`/`new Date()` in a render body; event handlers are fine.
- **Tests**
  - Seed the id-mint collision explicitly.
  - Every absence assertion carries a positive control in the same render.
  - `vitest.config.ts` coverage excludes `src/app/**/*.tsx`. The new `.ts` modules (`raid-draft.ts`, `raid-escalation.ts`, `insights/log-as-raid.ts`) are coverage-gated and are fully tested here. No new `.ts` hook is created.
- **File sizes**
  - `size:check` LIMIT is 1600 lines (split-on-`\n`, so `wc -l` + 1). `task-manager.tsx` is at 3162, with a baseline entry of 6040, so it has room.
  - The other files touched and their measured sizes: `raid-panel.tsx` 607, `raid-edit-modal.tsx` 729, `use-action-center-handlers.ts` 307, `use-resource-planner.ts` 629, `workspace-section.tsx` 1020 (baseline 2000), `types.ts` 735, `sanitize-records.ts` 1600 (see deviation 1).
  - Re-measure before committing any task that touches `sanitize-records.ts`.
- **Doc citations:** no CHANGELOG edit in this branch, and no session URLs in docs. Never write a `path:LINE` citation in any doc; cite SYMBOLS.

---

## Task 1: Extract `raid-draft.ts` (draft builders + signal seed)

**Files:**
- Create: `src/app/raid-draft.ts`
- Create: `src/app/raid-draft.test.ts`
- Modify: `src/app/raid-panel.tsx` (the `openNew` body, the local `applyStatus`/`applyMatrix` functions, and the imports)
- Test (unchanged, must stay green): `src/app/raid-panel.test.tsx`

**Interfaces:**
- Consumes:
  - `nextRaidId(items)`, `defaultStatusForCategory(category)`, `riskSeverityFromMatrix(p, i)`, `isTerminalStatus(status, category)` from `./raid`
  - `sanitizeRichText(raw, max, sink)` from `./rich-text-plain`
  - `RICH_SINK` from `./html-start`
  - `plainToHtml(text)` from `./sanitize-html`
  - `TASK_NAME_MAX`, `TEXTAREA_MAX` from `./sanitize`
- Produces:
  - `buildNewRaidDraft(raid: readonly RaidItem[], category: RaidCategory, today: string): RaidItem`
  - `applyStatus(draft: RaidItem, status: RaidStatus, today: string): RaidItem`
  - `applyMatrix(draft: RaidItem, probability: RiskScale, impact: RiskScale): RaidItem`
  - `buildRaidSeedFromSignal(input: { title: string; note: string }): { title: string; description: string }`

- [ ] **Step 1: Write the failing test** — create `src/app/raid-draft.test.ts`:

```ts
// Characterization for the RAID draft builders moved out of raid-panel.tsx.
// The expected shapes are the ones `openNew` / `applyStatus` / `applyMatrix`
// produced inside the panel before the move, written out field by field.
import { beforeEach, describe, expect, it } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { defaultStatusForCategory, isTerminalStatus, riskSeverityFromMatrix } from "./raid";
import { applyMatrix, applyStatus, buildNewRaidDraft, buildRaidSeedFromSignal } from "./raid-draft";
import { RISK_STATUSES, type RaidItem } from "./types";

const TODAY = "2026-06-20";

describe("buildNewRaidDraft", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });

  it("builds the Risk default the panel's openNew built", () => {
    const d = buildNewRaidDraft([], "R", TODAY);
    expect(d).toEqual({
      id: 1,
      category: "R",
      title: "",
      severity: riskSeverityFromMatrix(3, 3),
      probability: 3,
      impact: 3,
      status: defaultStatusForCategory("R"),
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      knowledgeLinks: [],
      raisedDate: TODAY,
    });
  });

  it("builds a non-Risk default with Medium severity and no matrix axes", () => {
    const d = buildNewRaidDraft([], "I", TODAY);
    expect(d.severity).toBe("Medium");
    expect(d.probability).toBeUndefined();
    expect(d.impact).toBeUndefined();
    expect(d.status).toBe(defaultStatusForCategory("I"));
  });

  it("mints an id above the existing register", () => {
    const existing: RaidItem = {
      id: 5, category: "R", title: "x", status: "Open", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: TODAY,
    };
    expect(buildNewRaidDraft([existing], "R", TODAY).id).toBeGreaterThan(5);
  });
});

describe("applyStatus", () => {
  const terminal = RISK_STATUSES.find((s) => isTerminalStatus(s, "R"))!;
  const base = (over: Partial<RaidItem> = {}): RaidItem => ({
    id: 1, category: "R", title: "x", status: "Open", linkedTaskIds: [],
    causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", ...over,
  });

  it("stamps closedDate with today when entering a terminal status", () => {
    expect(terminal).toBeDefined();
    expect(applyStatus(base(), terminal, TODAY)).toMatchObject({ status: terminal, closedDate: TODAY });
  });
  it("keeps an existing closedDate", () => {
    expect(applyStatus(base({ closedDate: "2026-02-02" }), terminal, TODAY).closedDate).toBe("2026-02-02");
  });
  it("clears closedDate for a non-terminal status", () => {
    const out = applyStatus(base({ closedDate: "2026-02-02" }), "Open", TODAY);
    expect(out.status).toBe("Open");
    expect(out.closedDate).toBeUndefined();
  });
});

describe("applyMatrix", () => {
  it("sets both axes and derives severity from the matrix", () => {
    const d: RaidItem = {
      id: 1, category: "R", title: "x", status: "Open", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
    };
    expect(applyMatrix(d, 5, 4)).toMatchObject({ probability: 5, impact: 4, severity: riskSeverityFromMatrix(5, 4) });
  });
});

describe("buildRaidSeedFromSignal", () => {
  it("trims the title and wraps the provenance note as sanitized rich HTML", () => {
    const seed = buildRaidSeedFromSignal({ title: "  Milestone slipping  ", note: "From: Insights — <b>5 days</b> overdue" });
    expect(seed.title).toBe("Milestone slipping");
    expect(seed.description.startsWith("<p>")).toBe(true);
    expect(seed.description).toContain("From: Insights");
    expect(seed.description).not.toContain("<b>");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
S=C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad
npx vitest run src/app/raid-draft.test.ts --maxWorkers=1 --reporter=dot > "$S/t1a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |raid-draft" "$S/t1a.log" | head
```

Expected: `EXIT=1`, and the log names `./raid-draft` as unresolvable ("Failed to resolve import").

- [ ] **Step 3: Implement** — create `src/app/raid-draft.ts`:

```ts
// src/app/raid-draft.ts
//
// Pure, i18n-free builders for a RAID editor draft. `buildNewRaidDraft`,
// `applyStatus` and `applyMatrix` are moved verbatim from raid-panel.tsx
// (`openNew` and its two local helpers) so the RAID panel and the "Log as RAID"
// host (§515) build byte-identical drafts. `buildRaidSeedFromSignal` is the RAID
// counterpart of `buildTaskSeedFromAction`: the caller passes ALREADY-translated
// strings, so nothing here imports i18n.
import { defaultStatusForCategory, isTerminalStatus, nextRaidId, riskSeverityFromMatrix } from "./raid";
import type { RaidCategory, RaidItem, RaidStatus, RiskScale } from "./types";
import { sanitizeRichText } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";
import { plainToHtml } from "./sanitize-html";
import { TASK_NAME_MAX, TEXTAREA_MAX } from "./sanitize";

const DEFAULT_RISK_SCALE: RiskScale = 3;

/** A blank draft for `category`, with a freshly minted id. */
export function buildNewRaidDraft(raid: readonly RaidItem[], category: RaidCategory, today: string): RaidItem {
  const probability: RiskScale = DEFAULT_RISK_SCALE;
  const impact: RiskScale = DEFAULT_RISK_SCALE;
  return {
    id: nextRaidId(raid),
    category,
    title: "",
    severity: category === "R" ? riskSeverityFromMatrix(probability, impact) : "Medium",
    probability: category === "R" ? probability : undefined,
    impact: category === "R" ? impact : undefined,
    status: defaultStatusForCategory(category),
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    knowledgeLinks: [],
    raisedDate: today,
  };
}

/** When the user moves a draft into a terminal status, auto-fill `closedDate`
 *  with today (what the user almost always wants); leaving one clears it. */
export function applyStatus(d: RaidItem, status: RaidStatus, today: string): RaidItem {
  const terminal = isTerminalStatus(status, d.category);
  return {
    ...d,
    status,
    closedDate: terminal ? d.closedDate ?? today : undefined,
  };
}

export function applyMatrix(d: RaidItem, probability: RiskScale, impact: RiskScale): RaidItem {
  return {
    ...d,
    probability,
    impact,
    severity: riskSeverityFromMatrix(probability, impact),
  };
}

/** Title + "From: <source> — <why>" description for a RAID item raised from a
 *  signal. `note` is the caller's translated `actionCreatedFromNote` string. */
export function buildRaidSeedFromSignal(input: { title: string; note: string }): { title: string; description: string } {
  return {
    title: input.title.trim().slice(0, TASK_NAME_MAX),
    description: sanitizeRichText(plainToHtml(input.note), TEXTAREA_MAX, RICH_SINK),
  };
}
```

Then edit `src/app/raid-panel.tsx` with the Edit tool, in four edits:

1. Replace the `./raid` import block:

```ts
import {
  buildRaidCausesIndex,
  compareRaid,
  defaultStatusForCategory,
  isTerminalStatus,
  nextRaidId,
  riskSeverityFromMatrix,
  type RaidSortKey,
} from "./raid";
```

   with:

```ts
import {
  buildRaidCausesIndex,
  compareRaid,
  isTerminalStatus,
  type RaidSortKey,
} from "./raid";
import { applyMatrix, applyStatus, buildNewRaidDraft } from "./raid-draft";
```

2. In the `./types` import block, delete the two lines `  type RaidStatus,` and `  type RiskScale,`. Verify before deleting: `grep -c "\bRaidStatus\b" src/app/raid-panel.tsx` → 2 and `grep -c "\bRiskScale\b" src/app/raid-panel.tsx` → 5, all inside the code this task removes.
3. Replace the whole `openNew` function:

```ts
  function openNew(category: RaidCategory = "R") {
    const probability: RiskScale = 3;
    const impact: RiskScale = 3;
    setDraft({
      id: nextRaidId(raid),
      category,
      title: "",
      severity:
        category === "R"
          ? riskSeverityFromMatrix(probability, impact)
          : "Medium",
      probability: category === "R" ? probability : undefined,
      impact: category === "R" ? impact : undefined,
      status: defaultStatusForCategory(category),
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      knowledgeLinks: [],
      raisedDate: today,
    });
    setIsNew(true);
  }
```

   with:

```ts
  function openNew(category: RaidCategory = "R") {
    setDraft(buildNewRaidDraft(raid, category, today));
    setIsNew(true);
  }
```

4. Delete the two local functions: the block starting `  /** When the user transitions a draft into a terminal status, auto-fill` through the closing `  }` of `applyMatrix`. In the modal props, change the two call sites to:

```tsx
            onApplyStatus={(s) => setDraft((d) => (d ? applyStatus(d, s, today) : d))}
            onApplyMatrix={(p, i) => setDraft((d) => (d ? applyMatrix(d, p, i) : d))}
```

- [ ] **Step 4: Run the new test AND the unchanged panel test — both pass**

```bash
npx vitest run src/app/raid-draft.test.ts src/app/raid-panel.test.tsx --maxWorkers=1 --reporter=dot > "$S/t1b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$S/t1b.log"
npx tsc --noEmit > "$S/tsc1.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc1.log"
npx eslint --max-warnings=0 src/app/raid-draft.ts src/app/raid-draft.test.ts src/app/raid-panel.tsx > "$S/lint1.log" 2>&1; echo "EXIT=$?"
```

Expected:
- vitest: `EXIT=0` and `Test Files  2 passed (2)`
- tsc: `EXIT=0` with `0` errors
- eslint: `EXIT=0`

If `raid-panel.test.tsx` goes red, the move was not verbatim. Diff it against the removed code; do not edit the test.

- [ ] **Step 5: Commit** — write `$S/msg-task1.txt`:

```
refactor: extract the RAID draft builders into raid-draft.ts

openNew's default draft, applyStatus and applyMatrix move out of
raid-panel.tsx unchanged, plus buildRaidSeedFromSignal, so the RAID panel
and the upcoming Log-as-RAID host build the same draft (§515).

Claude-Session: https://[session link removed]
```

```bash
git add -- src/app/raid-draft.ts src/app/raid-draft.test.ts
git commit --only -F "$S/msg-task1.txt" -- src/app/raid-draft.ts src/app/raid-draft.test.ts src/app/raid-panel.tsx
git show --stat HEAD | tail -5
```

Expected: exactly those 3 files in the commit.

---

## Task 2: `RaidEscalation` type + `RaidItem.escalations` persisted on all six write paths

**Files:**
- Create: `src/app/raid-escalation.ts`, `src/app/raid-escalation.test.ts`
- Modify:
  - `src/app/types.ts` (`RaidEscalation`, `RaidItem.escalations`)
  - `src/app/csv-codecs-core.ts` (`RAID_CSV_COLUMNS`, `raidFieldToString`, `buildRaidItemFromObj`)
  - `src/app/markdown-columns.ts` (`RAID_MD_COLUMNS`)
  - `src/app/markdown-codecs-decode.ts` (`RAID_ALIASES`)
  - `src/app/sanitize-records.ts` (three import compactions, `sanitizeRaidItem`, `RAID_FIELD_GUARDS`)
  - `src/app/export-sections.ts` (`RAID_EXPORT_COLUMNS`, `raidSection`)
  - `src/app/template-apply.ts` (`remapSeed` raid map)
  - `src/app/use-resource-planner.ts` (`handleSaveRaidItem` `withStamp` carry)
  - `src/test/inline-sweep-fixtures.ts` (`seedGuardedRaid`, `AXIS_FIELDS.raid`)
  - `src/test/offered-surface-axis.ts` (`AXIS_BASELINE.raid.undeclared` 6 → 7, deviation 14)
  - `sample-workspace-small.json` (one escalated Issue)
  - `sample-workspace-big.json`, `sample-workspace-huge.json` (regenerated)
  - `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md` (regenerated)
- Test:
  - `src/app/entity-persistence-registry.test.ts` (new describe)
  - `src/app/sanitize-records.test.ts` (new describes)
  - `src/app/template-apply.test.ts` (new describe)
  - `src/app/export-sections.test.ts` (MIGRATE one assertion)
  - `src/app/use-resource-planner.test.tsx` (new describe)

**Interfaces:**
- Consumes: `RAID_SEVERITIES`, `RaidSeverity`, `RaidItem` (`./types`).
- Produces:
  - `type RaidEscalation = { at: string; toName?: string; toEmail: string; toResourceId?: number; fromSeverity?: RaidSeverity; toSeverity?: RaidSeverity }`
  - `RaidItem.escalations?: RaidEscalation[]`
  - `RAID_ESCALATIONS_MAX: number`
  - `sanitizeRaidEscalations(raw: unknown): RaidEscalation[]`
  - `encodeRaidEscalations(list: readonly RaidEscalation[] | undefined): string`
  - `decodeRaidEscalations(cell: string | null | undefined): RaidEscalation[]`
  - `lastEscalation(item: Pick<RaidItem, "escalations">): RaidEscalation | undefined`
  - `RAID_EXPORT_COLUMNS` (exported from `export-sections.ts`)

### `inquiriesSent` grep, labelled

Reproduce: `git grep -n 'inquiriesSent' -- src scripts e2e ':!*.json'` plus `git grep -c 'inquiriesSent' -- '*.json' '*.csv' '*.md'`. `scripts/` and `e2e/` have no hits.

| Hit | Label | Reason |
|---|---|---|
| `types.ts` — `RaidItem.inquiriesSent` | COPY | → `RaidItem.escalations` (the `Task.inquiriesSent` hit is task-only, N/A) |
| `csv-codecs-core.ts` — `RAID_CSV_COLUMNS` entry and `buildRaidItemFromObj` | COPY | Array → noteLog-style cell codec (deviation 2). The `CSV_COLUMNS` (task) entry is N/A |
| `markdown-columns.ts` — second `{ key: "inquiriesSent" … }` (RAID_MD_COLUMNS) | COPY | The first (task table) is N/A |
| `markdown-codecs-decode.ts` — `RAID_ALIASES` `inquiries:` alias | COPY | The task column map and task decoder hits are N/A |
| `csv-codecs-decode.ts` — `buildTaskFromObj` | N/A | Task decoder |
| `sanitize-records.ts` — `sanitizeRaidItem` sparse keep | COPY | Via `sanitizeRaidEscalations` (deviation 1) |
| `sanitize-records.test.ts` — `sanitizeRaidItem — inquiriesSent` | COPY | New `sanitizeRaidItem — escalations` describe |
| `entity-persistence-registry.test.ts` — column + CSV/MD round-trips | COPY | Plus a JSON round-trip |
| `heavy-fields-persistence.test.ts` | N/A | Would duplicate the registry round-trips word for word |
| `ai-entity-token.ts` — `TOKEN_EXCLUDED.raid` | N/A, deliberate | Deviation 10: single guard in `RAID_FIELD_GUARDS` |
| `src/test/inline-sweep-fixtures.ts` — `seedGuardedRaid` `inquiriesSent: 2` and `AXIS_FIELDS.raid` | COPY | Relation A cannot probe an unseeded column. The `task` seed hit is N/A |
| `inline-ai-edit/plan.create-path-guards.test.ts` (`EXCLUDED_PROBES`) | N/A | Derived from `TOKEN_EXCLUDED`, which is not changed |
| `inline-ai-edit/plan.offered-surface-sweep.test.ts` (docstring) | N/A | Comment on the create-strip mutant |
| `use-resource-planner.ts` — `handleSendRaidInquiry` functional bump | COPY in Task 3 | The functional-setter pattern for `handleEscalate`. The planner's task-create hit is N/A |
| `template-apply.ts` — task-seed comment | N/A | Task seed. The raid strip is a NEW site, per the spec |
| `ai-project-proposal.ts` / `.test.ts` | N/A | `SEED_OFFERED_KEYS` already drops every un-offered key before `sanitizeRaidItem` |
| `chat-task-patch*`, `chat-proposal*`, `chat-tools*`, `use-chat-dispatcher*`, `use-task-row-handlers*`, `use-task-submit.ts`, `use-bulk-operations*`, `use-jira-sync.ts`, `jira-api.ts`, `reports-*`, `resource-workload*`, `task-manager.tsx` (task create), `codec-roundtrip.property.test.ts`, every other `*.test.*` task fixture | N/A | Task-only |
| `__fixtures__/golden-workspace.csv`/`.md` | REGENERATE | The RAID header gains a column |
| `sample-workspace-small.json` | COPY | One escalated Issue. `-big`/`-huge` are REGENERATED |
| `docs/AGENTS/ai-assistant.md` (`TOKEN_EXCLUDED` list), `docs/AGENTS/platform.md` (Jira), dated plans/specs, `docs/open-followups.md` | N/A | Unchanged claims or dated records |

### The six write paths and what pins each

| Path | Mechanism | Pinned by |
|---|---|---|
| JSON | `jsonToWorkspace` maps raid through `sanitizeRaidRichFields`; the field passes through | New registry test "survives the JSON round-trip" |
| CSV | `RAID_CSV_COLUMNS` + `raidFieldToString` / `buildRaidItemFromObj` | Registry CSV round-trip + golden CSV |
| Markdown | `RAID_MD_COLUMNS` + `RAID_ALIASES` + `raidFieldToString` | Registry MD round-trip + golden MD |
| Turso single | `ENTITY_SPECS` raid spec `columns: RAID_CSV_COLUMNS` (DDL/INSERT derive); `turso-migrate.ts` adds the column to old DBs | Column-registry assertion only. `turso-schema.execute.test.ts` executes the generated statements. **Value round-trip against a live DB: NOT pinned** |
| Turso tenant | Same derivation (`tenantSchemaDdl`) | Column-registry assertion only. **Value round-trip: NOT pinned** |
| IndexedDB | `browser-backend.ts` whole-object read + `sanitizeRaidRichFields` | **NOT pinned.** Pass-through by construction only |

- [ ] **Step 1: Write the failing tests**

(a) Create `src/app/raid-escalation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decodeRaidEscalations,
  encodeRaidEscalations,
  lastEscalation,
  RAID_ESCALATIONS_MAX,
  sanitizeRaidEscalations,
} from "./raid-escalation";
import type { RaidEscalation } from "./types";

const RAISED: RaidEscalation = {
  at: "2026-05-20T09:30:00.000Z", toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com",
  toResourceId: 2, fromSeverity: "Medium", toSeverity: "High",
};
const NOTIFY: RaidEscalation = { at: "2026-05-22T14:00:00.000Z", toEmail: "ops@example.com" };

describe("sanitizeRaidEscalations", () => {
  it("keeps well-formed entries in order", () => {
    expect(sanitizeRaidEscalations([RAISED, NOTIFY])).toEqual([RAISED, NOTIFY]);
  });
  it("returns [] for anything that is not an array", () => {
    for (const v of [undefined, null, "x", 3, {}]) expect(sanitizeRaidEscalations(v)).toEqual([]);
  });
  it("drops an entry with no parseable timestamp or no e-mail address", () => {
    expect(sanitizeRaidEscalations([{ ...RAISED, at: "yesterday" }, { ...RAISED, toEmail: "nobody" }, NOTIFY])).toEqual([NOTIFY]);
  });
  it("drops an unknown severity together with its other half", () => {
    expect(sanitizeRaidEscalations([{ ...RAISED, toSeverity: "Apocalyptic" }])).toEqual([
      { at: RAISED.at, toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com", toResourceId: 2 },
    ]);
  });
  it("drops a non-positive or fractional resource id", () => {
    expect(sanitizeRaidEscalations([{ ...NOTIFY, toResourceId: 0 }, { ...NOTIFY, toResourceId: 1.5 }])).toEqual([NOTIFY, NOTIFY]);
  });
  it("keeps only the newest RAID_ESCALATIONS_MAX entries", () => {
    const many = Array.from({ length: RAID_ESCALATIONS_MAX + 5 }, (_, i) => ({ ...NOTIFY, toEmail: `p${i}@example.com` }));
    const out = sanitizeRaidEscalations(many);
    expect(out).toHaveLength(RAID_ESCALATIONS_MAX);
    expect(out[0].toEmail).toBe("p5@example.com");
  });
});

describe("escalations cell codec", () => {
  it("encodes empty or absent to an empty cell so legacy rows stay byte-identical", () => {
    expect(encodeRaidEscalations(undefined)).toBe("");
    expect(encodeRaidEscalations([])).toBe("");
  });
  it("round-trips", () => {
    expect(decodeRaidEscalations(encodeRaidEscalations([RAISED, NOTIFY]))).toEqual([RAISED, NOTIFY]);
  });
  it("tolerates an empty or malformed cell", () => {
    expect(decodeRaidEscalations("")).toEqual([]);
    expect(decodeRaidEscalations("{not json")).toEqual([]);
  });
});

describe("lastEscalation", () => {
  it("returns the newest (last) entry", () => {
    expect(lastEscalation({ escalations: [RAISED, NOTIFY] })).toEqual(NOTIFY);
  });
  it("returns undefined for none, a non-array, or a malformed last entry", () => {
    expect(lastEscalation({})).toBeUndefined();
    expect(lastEscalation({ escalations: [] })).toBeUndefined();
    expect(lastEscalation({ escalations: "oops" as unknown as RaidEscalation[] })).toBeUndefined();
    expect(lastEscalation({ escalations: [{ at: 7 } as unknown as RaidEscalation] })).toBeUndefined();
  });
});
```

(b) Append to `src/app/entity-persistence-registry.test.ts`. First add `import type { RaidEscalation } from "./types";` directly below the existing `import type { Workspace } from "./workspace";` line. Then append at the end of the file:

```ts
// §515 — RaidItem.escalations is a JSON-in-cell array like noteLog. CSV column
// presence covers Turso single + tenant (their DDL/INSERT derive from
// RAID_CSV_COLUMNS); the round-trips cover CSV, Markdown and JSON. IndexedDB is
// a whole-object pass-through and is NOT asserted here.
describe("entity persistence registry — RaidItem.escalations", () => {
  const ESC: RaidEscalation[] = [
    { at: "2026-05-20T09:30:00.000Z", toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical" },
    { at: "2026-05-21T10:00:00.000Z", toEmail: "ops@example.com" },
  ];
  const seed = (): Workspace => ({
    ...emptyWorkspace(),
    raid: [{
      id: 1, category: "I", title: "Vendor down", status: "Open", severity: "Critical", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", escalations: ESC,
    }],
  });

  it("is in the RAID CSV column registry (drives CSV + Turso single/tenant)", () => {
    expect(RAID_CSV_COLUMNS as readonly string[]).toContain("escalations");
  });
  it("survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(seed())).raid[0]?.escalations).toEqual(ESC);
  });
  it("survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(seed())).raid[0]?.escalations).toEqual(ESC);
  });
  it("survives the JSON round-trip", () => {
    expect(jsonToWorkspace(workspaceToJson(seed())).raid[0]?.escalations).toEqual(ESC);
  });
});
```

(c) Append to `src/app/sanitize-records.test.ts`. First add `  dropUnacceptedRaidFields,` to the existing `from "./sanitize"` import list, directly below `  sanitizeRaidItem,`. Then append:

```ts
describe("sanitizeRaidItem — escalations", () => {
  const ESC = { at: "2026-05-20T09:30:00.000Z", toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com", fromSeverity: "Medium", toSeverity: "High" };
  it("keeps a valid escalation record", () => {
    expect(sanitizeRaidItem({ ...baseRaid, escalations: [ESC] })?.escalations).toEqual([ESC]);
  });
  it("is sparse: absent, empty or wholly invalid -> undefined", () => {
    expect(sanitizeRaidItem({ ...baseRaid })?.escalations).toBeUndefined();
    expect(sanitizeRaidItem({ ...baseRaid, escalations: [] })?.escalations).toBeUndefined();
    expect(sanitizeRaidItem({ ...baseRaid, escalations: [{ at: "nope" }] })?.escalations).toBeUndefined();
  });
});

describe("dropUnacceptedRaidFields — escalations is model-read-only (§515)", () => {
  const ESC = { at: "2026-05-20T09:30:00.000Z", toEmail: "forged@example.com", toSeverity: "Critical" };
  it("drops a model-supplied escalations key and keeps the rest of the patch", () => {
    expect(dropUnacceptedRaidFields({ title: "Renamed", escalations: [ESC] }, { category: "I" })).toEqual({ title: "Renamed" });
  });
  it("positive control: a patch without escalations is returned untouched", () => {
    const patch = { title: "Renamed" };
    expect(dropUnacceptedRaidFields(patch, { category: "I" })).toBe(patch);
  });
});
```

(d) Append to `src/app/template-apply.test.ts`:

```ts
describe("applyTemplate — RAID escalations (§515)", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });

  it("never carries a captured escalation record into the applied workspace", () => {
    const captured: RaidItem = {
      id: 1, category: "I", title: "Vendor down", status: "Open", severity: "High", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      escalations: [{ at: "2026-01-05T08:00:00.000Z", toEmail: "jane@example.com", fromSeverity: "Medium", toSeverity: "High" }],
    };
    const ws = applyTemplate(emptyWorkspace(), tpl({ raid: [captured] }), { includeSeed: true });
    expect(ws.raid).toHaveLength(1);
    expect(ws.raid[0].title).toBe("Vendor down");
    expect(ws.raid[0].escalations).toBeUndefined();
  });
});
```

(e) MIGRATE `src/app/export-sections.test.ts`, test `"raid section columns and row values match RAID_CSV_COLUMNS projection"`:
- Add `  RAID_EXPORT_COLUMNS,` to the `from "./export-sections"` import list, directly below `  RAID_RICH_COLUMNS,`.
- Replace

```ts
    expect(raidSec.columns).toEqual(RAID_CSV_COLUMNS);
    raidItems.forEach((r, idx) => {
      const expectedRow = RAID_CSV_COLUMNS.map((c) => raidFieldToString(r, c));
```

  with

```ts
    // §515: escalations (recipient e-mail addresses) are out of scope for document exports.
    expect(raidSec.columns).toEqual(RAID_EXPORT_COLUMNS);
    expect(raidSec.columns).not.toContain("escalations");
    expect(RAID_EXPORT_COLUMNS).toHaveLength(RAID_CSV_COLUMNS.length - 1);
    raidItems.forEach((r, idx) => {
      const expectedRow = RAID_EXPORT_COLUMNS.map((c) => raidFieldToString(r, c));
```

(f) Append to `src/app/use-resource-planner.test.tsx`:

```ts
describe("handleSaveRaidItem — stored escalations (§515)", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });

  it("keeps the STORED escalation record over a stale editor snapshot", () => {
    const { result } = renderPlanner();
    const esc = { at: "2026-06-19T10:00:00.000Z", toEmail: "jane@example.com", fromSeverity: "High" as const, toSeverity: "Critical" as const };
    const snapshot: RaidItem = {
      id: 1, category: "I", title: "Vendor down", status: "Open", severity: "High", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01",
    };
    // The editor snapshotted `snapshot`; Escalate then wrote its record to the STORED row.
    act(() => { result.current.workspace.setRaid([{ ...snapshot, severity: "Critical", escalations: [esc] }]); });
    act(() => { result.current.planner.handleSaveRaidItem({ ...snapshot, title: "Vendor down (edited)" }, false); });
    const saved = result.current.workspace.raid[0] as RaidItem;
    expect(saved.title).toBe("Vendor down (edited)");
    expect(saved.escalations).toEqual([esc]);
    // The draft still says High (= the escalation's fromSeverity): the raise must survive.
    expect(saved.severity).toBe("Critical");
  });

  it("keeps a DELIBERATE severity change made in the stale editor", () => {
    const { result } = renderPlanner();
    const esc = { at: "2026-06-19T10:00:00.000Z", toEmail: "jane@example.com", fromSeverity: "High" as const, toSeverity: "Critical" as const };
    const snapshot: RaidItem = {
      id: 1, category: "I", title: "Vendor down", status: "Open", severity: "High", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01",
    };
    act(() => { result.current.workspace.setRaid([{ ...snapshot, severity: "Critical", escalations: [esc] }]); });
    act(() => { result.current.planner.handleSaveRaidItem({ ...snapshot, severity: "Low" }, false); });
    const saved = result.current.workspace.raid[0] as RaidItem;
    expect(saved.severity).toBe("Low");
    expect(saved.escalations).toEqual([esc]);
  });

  it("regression pin: with no newer stored escalation, the draft's severity wins as before", () => {
    const { result } = renderPlanner();
    const snapshot: RaidItem = {
      id: 1, category: "I", title: "Vendor down", status: "Open", severity: "High", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01",
    };
    act(() => { result.current.workspace.setRaid([{ ...snapshot, severity: "Critical" }]); });
    act(() => { result.current.planner.handleSaveRaidItem({ ...snapshot }, false); });
    expect((result.current.workspace.raid[0] as RaidItem).severity).toBe("High");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
S=C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad
npx vitest run src/app/raid-escalation.test.ts src/app/entity-persistence-registry.test.ts src/app/sanitize-records.test.ts src/app/template-apply.test.ts src/app/export-sections.test.ts src/app/use-resource-planner.test.tsx --maxWorkers=1 --reporter=dot > "$S/t2a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t2a.log" | head -20
```

Expected: `EXIT=1`.
- `raid-escalation.test.ts` fails to resolve `./raid-escalation`.
- `export-sections.test.ts` fails because `RAID_EXPORT_COLUMNS` is undefined.
- The registry, sanitize, template and planner cases fail on `escalations` being `undefined` (or, for the drop case, still present).

- [ ] **Step 3: Implement the type and the pure module**

`src/app/types.ts`: insert directly ABOVE the line `export type RaidItem = {`:

```ts
/** One escalation of a RAID item (§515): who was mailed, when, and the
 *  severity step it applied. `toSeverity` ABSENT = notify-only (a Risk, whose
 *  severity the matrix owns, or an item already Critical / with no severity).
 *  App-written by the Next-actions Escalate CTA; model-read-only. */
export type RaidEscalation = {
  /** ISO timestamp. */
  at: string;
  toName?: string;
  toEmail: string;
  toResourceId?: number;
  fromSeverity?: RaidSeverity;
  toSeverity?: RaidSeverity;
};

```

In the same file, replace the RAID `noteLog` member plus the end of the type. The anchor is unique because of the following milestone comment:

```ts
  noteLog?: NoteLogEntry[];
};

/** A zero-duration key date, distinct from a task.
```

with:

```ts
  noteLog?: NoteLogEntry[];
  /** Escalation record (§515), oldest first. Optional + sparse; absent on
   *  legacy data. Persisted as a JSON-in-cell array like `noteLog`. */
  escalations?: RaidEscalation[];
};

/** A zero-duration key date, distinct from a task.
```

Create `src/app/raid-escalation.ts`:

```ts
// src/app/raid-escalation.ts
//
// Pure, DOM-free validation + cell codec for `RaidItem.escalations` (§515).
// Lives outside sanitize-records.ts because that file sits AT the size-ratchet
// LIMIT. The cell codec mirrors `encodeNoteLog` / `decodeNoteLog`: JSON in one
// cell, and "" when empty so legacy rows stay byte-identical.
// ★ JSON and IndexedDB load RAID rows WITHOUT `sanitizeRaidItem`, so readers
//   must not trust the stored value — go through `lastEscalation` or
//   `sanitizeRaidEscalations`.
import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";

/** Newest entries win when a hand-edited file carries more than this. */
export const RAID_ESCALATIONS_MAX = 100;
const NAME_MAX = 200;
const EMAIL_MAX = 320;
const AT_MAX = 40;
const SEVERITY_SET: ReadonlySet<string> = new Set(RAID_SEVERITIES);

function severityOrUndefined(v: unknown): RaidSeverity | undefined {
  return typeof v === "string" && SEVERITY_SET.has(v) ? (v as RaidSeverity) : undefined;
}

function sanitizeEntry(raw: unknown): RaidEscalation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at.slice(0, AT_MAX) : "";
  const toEmail = typeof o.toEmail === "string" ? o.toEmail.trim().slice(0, EMAIL_MAX) : "";
  if (!at || !toEmail.includes("@")) return null;
  const toName = typeof o.toName === "string" ? o.toName.trim().slice(0, NAME_MAX) : "";
  const toResourceId =
    typeof o.toResourceId === "number" && Number.isInteger(o.toResourceId) && o.toResourceId > 0
      ? o.toResourceId
      : undefined;
  const fromSeverity = severityOrUndefined(o.fromSeverity);
  const toSeverity = severityOrUndefined(o.toSeverity);
  return {
    at,
    ...(toName ? { toName } : {}),
    toEmail,
    ...(toResourceId !== undefined ? { toResourceId } : {}),
    // A severity STEP needs both ends; a lone half is dropped rather than
    // rendered as a raise from or to nothing.
    ...(fromSeverity && toSeverity ? { fromSeverity, toSeverity } : {}),
  };
}

export function sanitizeRaidEscalations(raw: unknown): RaidEscalation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeEntry)
    .filter((e): e is RaidEscalation => e !== null)
    .slice(-RAID_ESCALATIONS_MAX);
}

export function encodeRaidEscalations(list: readonly RaidEscalation[] | undefined): string {
  return list && list.length ? JSON.stringify(list) : "";
}

export function decodeRaidEscalations(cell: string | null | undefined): RaidEscalation[] {
  if (!cell) return [];
  try {
    return sanitizeRaidEscalations(JSON.parse(cell));
  } catch {
    return [];
  }
}

/** The newest escalation, re-validated, or undefined. */
export function lastEscalation(item: Pick<RaidItem, "escalations">): RaidEscalation | undefined {
  const list: unknown = item.escalations;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return sanitizeRaidEscalations([list[list.length - 1]])[0];
}
```

- [ ] **Step 4: Wire the codecs**

`src/app/csv-codecs-core.ts`, in three edits:
1. Directly below `import { encodeNoteLog, decodeNoteLog } from "./note-log";` add:

```ts
import { decodeRaidEscalations, encodeRaidEscalations } from "./raid-escalation";
```

2. Replace `  "noteLog",\n] as const satisfies readonly (keyof RaidItem)[];` with:

```ts
  "noteLog",
  "escalations",
] as const satisfies readonly (keyof RaidItem)[];
```

3. In `raidFieldToString`, replace `  if (c === "noteLog") return encodeNoteLog(r.noteLog);` with:

```ts
  if (c === "noteLog") return encodeNoteLog(r.noteLog);
  if (c === "escalations") return encodeRaidEscalations(r.escalations);
```

   Then at the end of `buildRaidItemFromObj`'s returned object, replace

```ts
    noteLog: (() => {
      const nl = decodeNoteLog(obj.noteLog);
      return nl.length ? nl : undefined;
    })(),
  };
```

   with

```ts
    noteLog: (() => {
      const nl = decodeNoteLog(obj.noteLog);
      return nl.length ? nl : undefined;
    })(),
    escalations: (() => {
      const es = decodeRaidEscalations(obj.escalations);
      return es.length ? es : undefined;
    })(),
  };
```

`src/app/markdown-columns.ts`: replace `  { key: "noteLog", label: "NoteLog" },\n];\n\nexport const ABSENCES_MD_COLUMNS` with:

```ts
  { key: "noteLog", label: "NoteLog" },
  { key: "escalations", label: "Escalations" },
];

export const ABSENCES_MD_COLUMNS
```

`src/app/markdown-codecs-decode.ts`: replace `  notelog: "noteLog",\n};\n\nfunction markdownToRaid` with:

```ts
  notelog: "noteLog",
  escalations: "escalations",
};

function markdownToRaid
```

`src/app/sanitize-records.ts` — every edit here is line-budgeted (deviation 1):
1. Replace the three-line `import {\n  NACE_SECTION_SET,\n} from "./nace-sections";` with `import { NACE_SECTION_SET } from "./nace-sections";`.
2. Replace the three-line `import {\n  sanitizeKnowledgeLinks,\n} from "./document-link";` with `import { sanitizeKnowledgeLinks } from "./document-link";`.
3. Replace the three-line `import {\n  isValidTimeZone,\n} from "./timezone";` with the two lines:

```ts
import { isValidTimeZone } from "./timezone";
import { sanitizeRaidEscalations } from "./raid-escalation";
```

4. In `sanitizeRaidItem`, replace `  if (Number.isFinite(inq) && inq > 0) item.inquiriesSent = Math.floor(inq);\n\n  return item;` with:

```ts
  if (Number.isFinite(inq) && inq > 0) item.inquiriesSent = Math.floor(inq);
  const esc = sanitizeRaidEscalations(o.escalations); if (esc.length) item.escalations = esc; // sparse (§515)

  return item;
```

5. In `RAID_FIELD_GUARDS`, replace `  ownerResourceId: () => false,\n  category: acceptsRaidCategory,` with:

```ts
  ownerResourceId: () => false,
  // ★★ NOT MODEL-WRITABLE (§515): app-written by Escalate. The ONLY model-write guard — deliberately absent from TOKEN_EXCLUDED.raid.
  escalations: () => false,
  category: acceptsRaidCategory,
```

Verify the budget:

```bash
node -e "console.log(require('fs').readFileSync('src/app/sanitize-records.ts','utf8').split('\n').length)"
```

Expected: `1598`. Anything above `1600` fails `size:check`; stop and re-count.

`src/app/export-sections.ts`: replace

```ts
function raidSection(raid: readonly RaidItem[], lang: Lang): ExportSection {
  const columns = RAID_CSV_COLUMNS as unknown as string[];
  const rows = raid.map((r) =>
    RAID_CSV_COLUMNS.map((c) =>
```

with

```ts
/** RAID columns in document exports — every persisted column except
 *  `escalations`, whose recipient e-mail addresses are out of scope for
 *  exports (§515). */
export const RAID_EXPORT_COLUMNS = RAID_CSV_COLUMNS.filter((c) => c !== "escalations");

function raidSection(raid: readonly RaidItem[], lang: Lang): ExportSection {
  const columns = RAID_EXPORT_COLUMNS as unknown as string[];
  const rows = raid.map((r) =>
    RAID_EXPORT_COLUMNS.map((c) =>
```

`src/app/template-apply.ts`, in `remapSeed`: replace

```ts
    out.raid = seed.raid.map((r) => ({
      ...r,
      id: raidMap.get(r.id)!,
```

with

```ts
    out.raid = seed.raid.map((r) => ({
      ...r,
      // §515: a captured escalation names past recipients — never cloned into a new project.
      escalations: undefined,
      id: raidMap.get(r.id)!,
```

`src/app/use-resource-planner.ts`, in `handleSaveRaidItem`, replace

```ts
      // ★★★ `noteLog` from the STORED row, never the payload — it is write-through
      // and the editor's snapshot goes stale. Read open-followups §48 before editing.
      const withStamp: RaidItem = { ...item, id, localModifiedAt: stamp, ...(create ? {} : { noteLog: previous?.noteLog }) };
```

with

```ts
      // ★★★ `noteLog` AND `escalations` from the STORED row, never the payload — both
      // are write-through (notes window; Escalate CTA, §515) while the always-mounted
      // RAID editor's snapshot goes stale. Read open-followups §48 before editing.
      // ★★ Severity too, but ONLY when the stale draft still holds the value an escalation
      //   raised FROM — a deliberate change to any other severity in the editor wins.
      //   The comparison is against the FIRST escalation the draft has not seen that carries
      //   a `fromSeverity` — i.e. the severity the draft snapshotted — never the LAST one: a
      //   second raise (from the already-raised value) or a later notify-only entry would
      //   otherwise let the stale draft undo the raise. Both reads tolerate a non-array
      //   (JSON and IndexedDB load RAID rows unvalidated).
      const storedEscRaw: unknown = previous?.escalations;
      const storedEsc: readonly Partial<RaidEscalation>[] = Array.isArray(storedEscRaw) ? storedEscRaw : [];
      const draftEscRaw: unknown = item.escalations;
      const draftEscCount = Array.isArray(draftEscRaw) ? draftEscRaw.length : 0;
      const firstUnseenFrom = storedEsc.slice(draftEscCount).find((e) => e?.fromSeverity !== undefined)?.fromSeverity;
      const keepEscalatedSeverity =
        !create && previous !== undefined && storedEsc.length > draftEscCount &&
        firstUnseenFrom !== undefined && item.severity === firstUnseenFrom;
      const withStamp: RaidItem = {
        ...item, id, localModifiedAt: stamp,
        ...(create ? {} : { noteLog: previous?.noteLog, escalations: previous?.escalations }),
        ...(keepEscalatedSeverity ? { severity: previous?.severity } : {}),
      };
```

`use-resource-planner.ts` is 629 lines; this adds 19 (plus a `RaidEscalation` type import), well under the LIMIT.

★ Task 2's fix round added four planner tests to the `handleSaveRaidItem — stored escalations (§515)` describe:
- "keeps the raise across TWO unseen raises" and "keeps the raise when a notify-only escalation followed it". Both were RED against the LAST-escalation rule.
- "an editor opened AFTER the escalation keeps a deliberate return to its fromSeverity".
- "only UNSEEN escalations count: a seen raise plus an unseen notify-only keeps a deliberate lowering".

★★ The `storedEsc.length > draftEscCount` conjunct is an EQUIVALENT mutant, measured, not reasoned. `slice(draftEscCount)` is already empty whenever the conjunct is false, so deleting the conjunct alone leaves every test green, and no input can separate the two. The "opened AFTER" test fails only when the conjunct AND the offset are both removed. The offset alone (`slice(0)`) is pinned by the "only UNSEEN" test. The conjunct is kept, per the controller ruling, as an explicit statement of the precondition.

`src/test/inline-sweep-fixtures.ts`, in two edits:
1. In `seedGuardedRaid`, replace `    inquiriesSent: 2,\n    localModifiedAt: "2026-06-12T08:15:00.000Z",` with:

```ts
    inquiriesSent: 2,
    escalations: [
      { at: "2026-06-11T07:45:00.000Z", toName: "M. Jordan", toEmail: "m.Jordan@example.com", toResourceId: 2, fromSeverity: "Medium", toSeverity: "High" },
      { at: "2026-06-12T07:00:00.000Z", toEmail: "ops@example.com" },
    ],
    localModifiedAt: "2026-06-12T08:15:00.000Z",
```

   ★ Corrected during Task 2: the first draft seeded ONE entry, and the sweep's array probe (drop one element) then left `[]`, which `sanitizeRaidItem` stores as undefined, so Relation A's raid update arm reported `raid.escalations:unmeasured`. Two entries keep the probe non-empty, the same rule the task seed's `noteLog` docstring states.

   In its docstring, replace ` *  `sanitizeRaidItem` keeps each as seeded (`inquiriesSent` only when > 0).` with:

```ts
 *  `sanitizeRaidItem` keeps each as seeded (`inquiriesSent` only when > 0).
 *  ★ `escalations` (§515) is seeded for Relation A too, but it is NOT
 *   `TOKEN_EXCLUDED.raid`: `RAID_FIELD_GUARDS` refuses it on both arms.
 *   TWO entries, in `sanitizeRaidEscalations`' own key order: the array probe
 *   drops one element, and one seeded entry would leave `[]`, which the
 *   sanitizer stores as undefined, so the update arm would read `unmeasured`.
```

2. In `AXIS_FIELDS`, replace `  raid: ["category", "causedByRaidIds", "closedDate", "impact",` with `  raid: ["category", "causedByRaidIds", "closedDate", "escalations", "impact",`.

`src/test/offered-surface-axis.ts` (deviation 14): in `AXIS_BASELINE`, replace `  raid: { declared: 16, undeclared: 6 },` with:

```ts
  // §515 — `escalations` joined RAID_CSV_COLUMNS undeclared by any tool schema (6 → 7).
  raid: { declared: 16, undeclared: 7 },
```

Re-check that no other count pins a RAID column axis: `git grep -n -E 'AXIS_BASELINE|undeclared: [0-9]+|declared: [0-9]+' -- src`. Every hit must be the constant itself or a reader of `AXIS_BASELINE[entity]`. Treat any other literal RAID count the same way — update it with a §515 comment and add its file to this task's commit — then report it.

- [ ] **Step 5: Add one escalated item to the sample master**

Locate the Issue with `Grep` pattern `Rate-limit counter not resetting correctly` in `sample-workspace-small.json`, then `Read` that object. It is RAID `id: 9`, category `I`, severity `High`. Using the Edit tool, append this member as its LAST key (add a comma to the line of the previous last key, and match the file's existing indentation):

```json
"escalations": [
  {
    "at": "2026-05-20T09:30:00.000Z",
    "toName": "Sam Placeholder",
    "toEmail": "Fictional.Jordan@example.com",
    "toResourceId": 2,
    "fromSeverity": "Medium",
    "toSeverity": "High"
  }
]
```

Verify it:

```bash
node -e "const w=JSON.parse(require('fs').readFileSync('sample-workspace-small.json','utf8'));const r=w.raid.filter(x=>x.escalations);console.log(r.length, r[0].id, r[0].severity, r[0].escalations[0].toSeverity)"
```

Expected: `1 9 High High`.

- [ ] **Step 6: Run the Step-1 tests (goldens still stale)**

```bash
npx vitest run src/app/raid-escalation.test.ts src/app/entity-persistence-registry.test.ts src/app/sanitize-records.test.ts src/app/template-apply.test.ts src/app/export-sections.test.ts src/app/use-resource-planner.test.tsx --maxWorkers=1 --reporter=dot > "$S/t2b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$S/t2b.log"
```

Expected: `EXIT=0`, `Test Files  6 passed (6)`.

- [ ] **Step 7: Regenerate the golden fixtures, then delete the generator**

The input (`sample-workspace-small.json`) legitimately changed and the RAID header gains a column, so this is a real format change. Create `src/app/regen-golden.test.ts` (temporary; it runs under jsdom, which `jsonToWorkspace` needs):

```ts
// TEMPORARY — regenerates the golden fixtures, then is deleted in the same step.
import { test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } from "./storage";

test("regenerate golden fixtures", () => {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const ws = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8"));
  if (ws.tasks.length === 0 || ws.raid.length === 0) throw new Error("empty workspace — refusing to write");
  const fixtures = join(import.meta.dirname, "__fixtures__");
  writeFileSync(join(fixtures, "golden-workspace.csv"), workspaceToCsv(ws), "utf8");
  writeFileSync(join(fixtures, "golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
});
```

```bash
npx vitest run src/app/regen-golden.test.ts --maxWorkers=1 --reporter=dot > "$S/regen.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files" "$S/regen.log"
rm src/app/regen-golden.test.ts
git status --short src/app/regen-golden.test.ts
git diff --stat -- src/app/__fixtures__/
git diff -U0 -- src/app/__fixtures__/golden-workspace.md | grep -E "^[+-]" | grep -v -E "^(\+\+\+|---)" | cut -c1-120
```

Expected:
- vitest: `EXIT=0`, `Test Files  1 passed (1)`.
- The `git status` line prints nothing (the temporary file is gone).
- Both fixtures change. In the Markdown diff, ONLY the RAID table moves: its header gains `| Escalations |`, its separator gains a `---`, and every RAID row gains one cell (empty except RAID 9, which shows the JSON). **If any other section changed, stop and report — that is a format regression, not this column.**

The CSV `-text` fixture must stay pure CRLF; the golden test's own line-ending case checks it.

- [ ] **Step 8: Regenerate `-big` / `-huge`**

```bash
npx vite-node scripts/generate-sample-workspace.ts > "$S/gen.log" 2>&1; echo "EXIT=$?"
git diff --stat -- sample-workspace-big.json sample-workspace-huge.json
node -e "for (const n of ['big','huge']) { const w=JSON.parse(require('fs').readFileSync('sample-workspace-'+n+'.json','utf8')); console.log(n, w.raid.filter(x=>x.escalations).length) }"
```

Expected: `EXIT=0`, then `big 3` and `huge 10`. If the `--stat` shows far more churn than the added escalation blocks, the generator had drifted before this task: stop and report rather than committing unrelated regeneration.

- [ ] **Step 9: Run every test the new column can reach, plus gates**

```bash
npx vitest run src/app/raid-escalation.test.ts src/app/entity-persistence-registry.test.ts src/app/heavy-fields-persistence.test.ts src/app/golden-workspace.test.ts src/app/sanitize-records.test.ts src/app/template-apply.test.ts src/app/template-apply.allowlist.test.ts src/app/export-sections.test.ts src/app/storage-exports.test.ts src/app/storage-raid-stakeholders.test.ts src/app/resource-fk-backfill.test.ts src/app/ai-entity-token.test.ts src/app/codec-roundtrip.property.test.ts src/app/turso-schema.execute.test.ts src/app/turso-tenant-schema.test.ts src/app/workspace.test.ts src/app/use-resource-planner.test.tsx src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.model-writable-surface.test.ts src/app/inline-ai-edit/plan.write-path-sweep.test.ts src/test/sweep-probes.test.ts --maxWorkers=1 --reporter=dot > "$S/t2c.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t2c.log" | head -20
npx tsc --noEmit > "$S/tsc2.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc2.log"
npx eslint --max-warnings=0 src/app/raid-escalation.ts src/app/raid-escalation.test.ts src/app/types.ts src/app/csv-codecs-core.ts src/app/markdown-columns.ts src/app/markdown-codecs-decode.ts src/app/sanitize-records.ts src/app/export-sections.ts src/app/template-apply.ts src/app/use-resource-planner.ts src/test/inline-sweep-fixtures.ts > "$S/lint2.log" 2>&1; echo "EXIT=$?"
npm run size:check > "$S/size2.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` for all four, with `Test Files  22 passed (22)` and `0` tsc errors.

If a sweep file fails, what to do depends on the finding:
- **A Relation A finding naming `raid.escalations`** means a write path lets the model's value land. Fix the guard; NEVER ledger it (`LEDGERABLE_KINDS` forbids a live defect).
- **An axis/recorded-list mismatch naming `escalations`** means an enumerating list was missed. Add the field to that list only, then report which list it was.

- [ ] **Step 10: Commit** — write `$S/msg-task2.txt`:

```
feat: persist a RAID escalation record on all six write paths

RaidItem.escalations is a JSON-in-cell array like noteLog: validated in
raid-escalation.ts, carried by the CSV/Markdown/Turso column registry and
passed through JSON and IndexedDB. The model cannot write it
(RAID_FIELD_GUARDS), templates never clone it, document exports leave it
out, and handleSaveRaidItem keeps the stored record over a stale editor
draft. The sample master gains one escalated Issue; goldens and the
scaled samples are regenerated (§515).

Claude-Session: https://[session link removed]
```

```bash
git add -- src/app/raid-escalation.ts src/app/raid-escalation.test.ts
git commit --only -F "$S/msg-task2.txt" -- src/app/raid-escalation.ts src/app/raid-escalation.test.ts src/app/types.ts src/app/csv-codecs-core.ts src/app/markdown-columns.ts src/app/markdown-codecs-decode.ts src/app/sanitize-records.ts src/app/export-sections.ts src/app/template-apply.ts src/app/use-resource-planner.ts src/test/inline-sweep-fixtures.ts src/test/offered-surface-axis.ts sample-workspace-small.json sample-workspace-big.json sample-workspace-huge.json src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md src/app/entity-persistence-registry.test.ts src/app/sanitize-records.test.ts src/app/template-apply.test.ts src/app/export-sections.test.ts src/app/use-resource-planner.test.tsx
git show --stat HEAD | tail -25
```

---

## Task 3: `buildEscalationRecord` + `handleEscalate` as ONE functional write + `raid.escalated`

**Files:**
- Modify:
  - `src/app/action-escalate.ts` (new `EscalationRecipient`, `EscalationNoteAuthor`, `buildEscalationEntry`, `describeEscalation`, `buildEscalationRecord`)
  - `src/app/use-action-center-handlers.ts` (`ActionCenterHandlerDeps.selfResourceId`, `handleEscalate`)
  - `src/app/activity-log.ts` (`ActivityKind`, `ACTIVITY_KIND_TO_KEY`)
  - `src/app/task-manager.tsx` (pass `selfResourceId`)
  - `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test:
  - `src/app/action-escalate.test.ts`
  - `src/app/use-action-center-handlers.test.ts`
  - `src/app/activity-log.test.ts` (COPY: add the kind to `NEW_KINDS`)

**Interfaces:**
- Consumes:
  - `planEscalation(item)`, `EscalationPlan`
  - `addNote(log, { html, text, timestamp, self, authorName })` (`./note-log`)
  - `plainToHtml` (`./sanitize-html`)
  - `severityLabel(s, lang)` (`./raid-labels`)
  - `resourceDisplayName` (`./resource-foundation`)
  - `RaidEscalation` (Task 2)
- Produces:
  - `type EscalationRecipient = { name: string; email: string; resourceId: number | null }`
  - `type EscalationNoteAuthor = { self: number | null | undefined; authorName?: string }`
  - `buildEscalationEntry(plan: EscalationPlan, recipient: EscalationRecipient, at: string): RaidEscalation`
  - `describeEscalation(lang: Lang, e: RaidEscalation): string`
  - `buildEscalationRecord(item: RaidItem, plan: EscalationPlan, recipient: EscalationRecipient, at: string, noteText: string, author: EscalationNoteAuthor): RaidItem`
  - `escalationActivityArgs(item: Pick<RaidItem, "severity">, plan: EscalationPlan): [string, string]` (shared with Task 3b's AI writer)
  - `ActivityKind` gains `"raid.escalated"`
  - `ActionCenterHandlerDeps.selfResourceId: number | null | undefined`

`setRaid` in `ActionCenterHandlerDeps` is typed `Dispatch<SetStateAction<readonly RaidItem[]>>`, so it accepts a functional updater (verify: `grep -n "setRaid:" src/app/use-action-center-handlers.ts`).

- [ ] **Step 1: i18n keys (EN via the Edit tool, DE via the node script)**

`src/app/i18n.ts`, in two edits:
1. Replace `  escalateMailClosing: "Please advise on next steps.",` with:

```ts
  escalateMailClosing: "Please advise on next steps.",
  raidEscalationNoteRaised: "Escalated to {0}: severity {1} → {2}",
  raidEscalationNoteNotifyOnly: "Escalated to {0} (notify only)",
```

2. Replace `  activityRaidAutoIssue: "Risk #{0} realized — auto-created Issue #{1}",` with:

```ts
  activityRaidAutoIssue: "Risk #{0} realized — auto-created Issue #{1}",
  activityRaidEscalated: "RAID #{0} escalated: {1} → {2}",
```

Create `$S/patch-de.mjs` with the exact script from Global Constraints, and write `$S/de-task3.json` with the Write tool:

```json
[
  { "after": "  escalateMailClosing: ", "lines": [
    "  raidEscalationNoteRaised: \"Eskaliert an {0}: Schweregrad {1} \u2192 {2}\",",
    "  raidEscalationNoteNotifyOnly: \"Eskaliert an {0} (nur Benachrichtigung)\","
  ] },
  { "after": "  activityRaidAutoIssue: ", "lines": [
    "  activityRaidEscalated: \"RAID #{0} eskaliert: {1} \u2192 {2}\","
  ] }
]
```

```bash
node "$S/patch-de.mjs" "$S/de-task3.json"; echo "EXIT=$?"
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');for (const k of ['raidEscalationNoteRaised','raidEscalationNoteNotifyOnly','activityRaidEscalated']) { const m=s.match(new RegExp('\\\\n  '+k+': \"([^\"]*)\"')); console.log(k, m ? m[1] : 'MISSING') }"
```

Expected:
- `patched; LF-only line ends: 0`, then `EXIT=0`.
- Three lines, each with the German text and a real `→`, none `MISSING`.

- [ ] **Step 2: Write the failing tests**

(a) Append to `src/app/action-escalate.test.ts`. Change its first-party import to `import { nextSeverity, planEscalation, applyEscalation, buildEscalationMail, buildEscalationEntry, buildEscalationRecord, describeEscalation, escalationActivityArgs } from "./action-escalate";`, add `import { t } from "./i18n";` beside the existing `loadI18n` import (merge into that line: `import { loadI18n, t } from "./i18n";`) and `import { severityLabel } from "./raid-labels";`, then append:

```ts
const JANE = { name: "Jane Doe", email: "jane@example.com", resourceId: 4 };
const AT = "2026-09-13T08:00:00.000Z";
const AUTHOR = { self: 7, authorName: "Pat Lee" };

describe("buildEscalationEntry", () => {
  it("records recipient and the severity step when the plan raises", () => {
    expect(buildEscalationEntry({ raisesSeverity: true, from: "High", to: "Critical" }, JANE, AT)).toEqual({
      at: AT, toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical",
    });
  });
  it("is notify-only for a Risk and drops a blank name and a null resource", () => {
    expect(buildEscalationEntry({ raisesSeverity: false, reason: "risk" }, { name: "  ", email: "ops@example.com", resourceId: null }, AT))
      .toEqual({ at: AT, toEmail: "ops@example.com" });
  });
});

describe("describeEscalation", () => {
  it("names the recipient and the translated severity step", () => {
    expect(describeEscalation("en-US", { at: AT, toName: "Jane Doe", toEmail: "jane@example.com", fromSeverity: "High", toSeverity: "Critical" }))
      .toBe(t("en-US", "raidEscalationNoteRaised", "Jane Doe <jane@example.com>", severityLabel("High", "en-US"), severityLabel("Critical", "en-US")));
  });
  it("falls back to the bare address and says notify only", () => {
    expect(describeEscalation("en-US", { at: AT, toEmail: "ops@example.com" })).toBe("Escalated to ops@example.com (notify only)");
  });
  it("renders in German", async () => {
    await loadI18n("de");
    expect(describeEscalation("de", { at: AT, toEmail: "ops@example.com" })).toBe("Eskaliert an ops@example.com (nur Benachrichtigung)");
  });
});

describe("buildEscalationRecord", () => {
  it("raises severity, appends the record and a note, and stamps localModifiedAt", () => {
    const item = raid({ id: 3, category: "I", severity: "High" });
    const plan = planEscalation(item);
    const text = describeEscalation("en-US", buildEscalationEntry(plan, JANE, AT));
    const next = buildEscalationRecord(item, plan, JANE, AT, text, AUTHOR);
    expect(next.severity).toBe("Critical");
    expect(next.escalations).toEqual([buildEscalationEntry(plan, JANE, AT)]);
    expect(next.noteLog).toHaveLength(1);
    expect(next.noteLog?.[0]).toMatchObject({ timestamp: AT, text, authorResourceId: 7, authorName: "Pat Lee" });
    expect(next.localModifiedAt).toBe(AT);
    expect(item.escalations).toBeUndefined(); // input not mutated
  });
  it("leaves severity alone for a notify-only escalation", () => {
    const item = raid({ category: "R", severity: "High" });
    const plan = planEscalation(item);
    const next = buildEscalationRecord(item, plan, JANE, AT, "x", AUTHOR);
    expect(next.severity).toBe("High");
    expect(next.escalations?.[0]?.toSeverity).toBeUndefined();
  });
  it("appends to an existing record and PRESERVES the existing note log", () => {
    const earlier = { at: "2026-09-01T00:00:00.000Z", toEmail: "ops@example.com" };
    const older = { id: 1, timestamp: "2026-08-01T00:00:00.000Z", html: "<p>older</p>", text: "older" };
    const item = raid({ category: "I", severity: "Medium", escalations: [earlier], noteLog: [older] });
    const next = buildEscalationRecord(item, planEscalation(item), JANE, AT, "escalated", AUTHOR);
    expect(next.escalations).toEqual([earlier, expect.objectContaining({ fromSeverity: "Medium", toSeverity: "High" })]);
    expect(next.noteLog?.map((n) => n.text)).toEqual(["older", "escalated"]);
    expect(next.noteLog?.[1]?.id).toBe(2);
  });
});

describe("escalationActivityArgs", () => {
  it("is the severity step when the plan raises", () => {
    expect(escalationActivityArgs({ severity: "High" }, { raisesSeverity: true, from: "High", to: "Critical" }))
      .toEqual(["High", "Critical"]);
  });
  it("repeats the current severity, or an em dash, when notify-only", () => {
    expect(escalationActivityArgs({ severity: "Critical" }, { raisesSeverity: false, reason: "max" }))
      .toEqual(["Critical", "Critical"]);
    expect(escalationActivityArgs({}, { raisesSeverity: false, reason: "risk" })).toEqual(["—", "—"]);
  });
});
```

(b) Edit `src/app/use-action-center-handlers.test.ts`:
- In `makeDeps`, replace `    logActivity: vi.fn(),\n    ...overrides,` with `    logActivity: vi.fn(),\n    selfResourceId: null,\n    ...overrides,`.
- `act` and `renderHook` are ALREADY imported from `@testing-library/react`; do not add a second import. Add `afterEach, beforeEach` to the existing `vitest` import, so it reads `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";`.
- Change `import type { Task } from "./types";` to `import type { RaidItem, Task } from "./types";`.
- Append:

```ts
describe("useActionCenterHandlers — Escalate records on the item (§515)", () => {
  const item: RaidItem = {
    id: 5, category: "I", title: "Vendor down", status: "Open", severity: "High",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-08-01",
  };
  const escalateAction: SuggestedAction = {
    id: "raid:5:severity",
    source: "raid",
    title: { key: "actionRaidTitle", params: [5, "Vendor down"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 30,
    tier: "now",
    cta: { kind: "open", view: "raid", id: 5 },
  };
  const recipient = { name: "Jane Doe", email: "jane@example.com", resourceId: 4 };

  let hrefValue = "";
  let originalLocation: Location;
  beforeEach(() => {
    hrefValue = "";
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, set href(v: string) { hrefValue = v; }, get href() { return hrefValue; } },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("writes through ONE functional updater that composes with a same-tick concurrent write", () => {
    const setRaid = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, recipient); });
    expect(setRaid).toHaveBeenCalledTimes(1);
    const updater = setRaid.mock.calls[0][0] as unknown;
    expect(typeof updater).toBe("function");
    // A concurrent writer renamed the item and added a row after this render.
    const concurrent: RaidItem[] = [{ ...item, title: "Vendor down (renamed)" }, { ...item, id: 6, title: "Other" }];
    const next = (updater as (prev: readonly RaidItem[]) => readonly RaidItem[])(concurrent);
    expect(next).toHaveLength(2);
    expect(next[0].title).toBe("Vendor down (renamed)");
    expect(next[0].severity).toBe("Critical");
    expect(next[0].escalations).toEqual([
      { at: expect.any(String), toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical" },
    ]);
    expect(next[0].noteLog).toHaveLength(1);
    expect(next[1]).toBe(concurrent[1]);
    // buildMailtoUrl percent-encodes the address (mailto.ts) — controller
    // ruling P1: assert the encoded form, not the raw address.
    expect(hrefValue.startsWith(`mailto:${encodeURIComponent("jane@example.com")}?`)).toBe(true);
  });

  it("logs raid.escalated with the severity step only — never the address — and the log agrees with the record", () => {
    const logActivity = vi.fn();
    const setRaid = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], logActivity, setRaid })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, recipient); });
    expect(logActivity).toHaveBeenCalledWith("raid.escalated", 5, "High", "Critical");
    expect(JSON.stringify(logActivity.mock.calls)).not.toContain("jane@example.com");
    // ONE plan feeds record, log and mail — even when the updater sees a concurrent
    // severity write (deviation 15: that write is overwritten, but nothing disagrees).
    const updater = setRaid.mock.calls[0][0] as (prev: readonly RaidItem[]) => readonly RaidItem[];
    const [recorded] = updater([{ ...item, severity: "Medium" }]);
    const entry = recorded.escalations?.[0];
    expect([entry?.fromSeverity, entry?.toSeverity]).toEqual([logActivity.mock.calls[0][2], logActivity.mock.calls[0][3]]);
    expect(recorded.severity).toBe(entry?.toSeverity);
  });

  // REGRESSION PIN — passes before this task's change too (the address guard predates §515);
  // kept so the rewrite cannot move the write ahead of the check.
  it("writes nothing for an invalid address (positive control: the toast fires)", () => {
    const setRaid = vi.fn();
    const showToast = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid, showToast, logActivity })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, { ...recipient, email: "nope" }); });
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(setRaid).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
```

(c) `src/app/activity-log.test.ts`: in `NEW_KINDS`, replace `    "bulk.delete",\n  ];` with `    "bulk.delete",\n    "raid.escalated",\n  ];`.

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run src/app/action-escalate.test.ts src/app/use-action-center-handlers.test.ts src/app/activity-log.test.ts --maxWorkers=1 --reporter=dot > "$S/t3a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t3a.log" | head
```

Expected: `EXIT=1`.
- `buildEscalationEntry` is not a function.
- The handler test sees `setRaid` called with an array (typeof `object`).
- `ACTIVITY_KIND_TO_KEY["raid.escalated"]` is undefined.

- [ ] **Step 4: Implement**

`src/app/action-escalate.ts`: replace the header imports

```ts
import { RAID_SEVERITIES, type RaidItem, type RaidSeverity } from "./types";
import { t, type Lang } from "./i18n";
```

with

```ts
import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";
import { t, type Lang } from "./i18n";
import { addNote } from "./note-log";
import { plainToHtml } from "./sanitize-html";
import { severityLabel } from "./raid-labels";
```

and append at the end of the file:

```ts
/** The person an escalation mails — the Escalate popover's ResourcePicker value. */
export type EscalationRecipient = { name: string; email: string; resourceId: number | null };

/** Who the note-log echo is attributed to (see `addNote`). */
export type EscalationNoteAuthor = { self: number | null | undefined; authorName?: string };

/** Pure: the structured record of one escalation. The severity step is kept
 *  only when the plan actually raises it; absent = notify-only. */
export function buildEscalationEntry(
  plan: EscalationPlan,
  recipient: EscalationRecipient,
  at: string,
): RaidEscalation {
  const name = recipient.name.trim();
  return {
    at,
    ...(name ? { toName: name } : {}),
    toEmail: recipient.email,
    ...(recipient.resourceId != null ? { toResourceId: recipient.resourceId } : {}),
    ...(plan.raisesSeverity && plan.from && plan.to ? { fromSeverity: plan.from, toSeverity: plan.to } : {}),
  };
}

/** Pure (uses `t`): one-line human text for an escalation — the note-log echo
 *  and the edit modal's Escalations list use the same sentence. */
export function describeEscalation(lang: Lang, e: RaidEscalation): string {
  const who = e.toName ? `${e.toName} <${e.toEmail}>` : e.toEmail;
  return e.fromSeverity && e.toSeverity
    ? t(lang, "raidEscalationNoteRaised", who, severityLabel(e.fromSeverity, lang), severityLabel(e.toSeverity, lang))
    : t(lang, "raidEscalationNoteNotifyOnly", who);
}

/** Immutable: the next RAID item after an escalation — severity raised when the
 *  plan says so, the record appended, a note appended to the running log, and
 *  `localModifiedAt` stamped. `noteText` is translated ONCE by the caller. */
export function buildEscalationRecord(
  item: RaidItem,
  plan: EscalationPlan,
  recipient: EscalationRecipient,
  at: string,
  noteText: string,
  author: EscalationNoteAuthor,
): RaidItem {
  const prior = Array.isArray(item.escalations) ? item.escalations : [];
  return {
    ...item,
    ...(plan.raisesSeverity && plan.to ? { severity: plan.to } : {}),
    escalations: [...prior, buildEscalationEntry(plan, recipient, at)],
    noteLog: addNote(item.noteLog ?? [], {
      html: plainToHtml(noteText),
      text: noteText,
      timestamp: at,
      self: author.self,
      authorName: author.authorName,
    }),
    localModifiedAt: at,
  };
}

/** The `raid.escalated` activity arguments after the id: the severity step, or
 *  the current severity (or "—") on BOTH sides for a notify-only escalation.
 *  Shared by the Escalate CTA and the AI `escalate_raid_item` tool so the two
 *  log identically (§515). Never carries the recipient. */
export function escalationActivityArgs(
  item: Pick<RaidItem, "severity">,
  plan: EscalationPlan,
): [string, string] {
  return [plan.from ?? item.severity ?? "—", plan.to ?? item.severity ?? "—"];
}
```

`src/app/use-action-center-handlers.ts`, in five edits:
1. Replace `import { planEscalation, applyEscalation, buildEscalationMail } from "./action-escalate";` with:

```ts
import {
  planEscalation,
  buildEscalationMail,
  buildEscalationEntry,
  buildEscalationRecord,
  describeEscalation,
  escalationActivityArgs,
} from "./action-escalate";
import { resourceDisplayName } from "./resource-foundation";
```

2. In `ActionCenterHandlerDeps`, replace `  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;\n}` with:

```ts
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** The user's own resource id — authors the Escalate note-log echo (§515),
   *  the same attribution the notes window uses. */
  selfResourceId: number | null | undefined;
}
```

3. In the destructure, replace `    logActivity,\n  } = deps;` with `    logActivity,\n    selfResourceId,\n  } = deps;`.
4. Replace the whole `handleEscalate` `useCallback` with:

```ts
  const handleEscalate = useCallback(
    (
      action: SuggestedAction,
      recipient: { name: string; email: string; resourceId: number | null },
    ) => {
      if (action.cta.kind !== "open") return;
      const id = Number(action.cta.id);
      const item = raid.find((r) => r.id === id);
      if (!item) return; // deleted-source safe
      if (!isValidEmail(recipient.email)) { showToast("error", t(lang, "errorInvalidEmail")); return; }
      const plan = planEscalation(item);
      const at = new Date().toISOString();
      const selfResource = resources.find((r) => r.id === selfResourceId);
      const author = { self: selfResourceId ?? null, authorName: selfResource ? resourceDisplayName(selfResource) : undefined };
      const noteText = describeEscalation(lang, buildEscalationEntry(plan, recipient, at));
      // ★★ ONE plan feeds the record, the log AND the mail, and ONE functional write
      //   applies it to the row the updater is handed, so a same-tick concurrent write
      //   to other fields or rows survives (the old closure write lost it) (§515).
      // ★ KNOWN LIMIT: the plan is read from the render-scope row. This hook has no
      //   live RAID ref (task-manager's `raidRef` syncs in an effect, so it is no
      //   fresher), so a same-tick concurrent SEVERITY write is overwritten by the
      //   planned step. Record, log and mail still agree with each other.
      setRaid((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          return buildEscalationRecord(r, plan, recipient, at, noteText, author);
        }),
      );
      // Severity step only — the recipient's address never enters the log.
      logActivity("raid.escalated", id, ...escalationActivityArgs(item, plan));
      const { subject, body } = buildEscalationMail(lang, item, plan, project?.name ?? "");
      window.location.href = buildMailtoUrl(recipient.email, subject, body);
      void recordLearning(action, "acted");
    },
    [raid, setRaid, lang, project, recordLearning, showToast, logActivity, resources, selfResourceId],
  );
```

5. Update the header comment: replace `// `deps` object; the inline `useCallback`/`useMemo` below preserve the exact\n// memoization the handlers had inline. Move-only — the bodies are verbatim.` with:

```ts
// `deps` object; the inline `useCallback`/`useMemo` below preserve the exact
// memoization the handlers had inline. Move-only at extraction; `handleEscalate`
// has since changed to record the escalation on the item (§515).
```

`applyEscalation` stays exported (its own tests use it); it simply has no production caller any more.

`src/app/activity-log.ts`, in two edits:
1. Replace `  | "raid.autoIssue"\n  | "bulk.edit"` with `  | "raid.autoIssue"\n  | "raid.escalated"\n  | "bulk.edit"`.
2. Replace `  "raid.autoIssue": "activityRaidAutoIssue",` with:

```ts
  "raid.autoIssue": "activityRaidAutoIssue",
  "raid.escalated": "activityRaidEscalated",
```

`src/app/task-manager.tsx`, in the `useActionCenterHandlers({ … })` call: replace `    showToast,\n    // ★★★ logActivityUser, NEVER the raw logActivity` with:

```ts
    showToast,
    selfResourceId: settings.selfResourceId,
    // ★★★ logActivityUser, NEVER the raw logActivity
```

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/app/action-escalate.test.ts src/app/use-action-center-handlers.test.ts src/app/activity-log.test.ts src/app/i18n-encoding.test.ts src/app/i18n.test.ts --maxWorkers=1 --reporter=dot > "$S/t3b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$S/t3b.log"
npx tsc --noEmit > "$S/tsc3.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc3.log"
npx eslint --max-warnings=0 src/app/action-escalate.ts src/app/action-escalate.test.ts src/app/use-action-center-handlers.ts src/app/use-action-center-handlers.test.ts src/app/activity-log.ts src/app/task-manager.tsx src/app/i18n.ts > "$S/lint3.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` for all three; `Test Files  5 passed (5)`; `0` tsc errors.

- [ ] **Step 6: Commit** — write `$S/msg-task3.txt`:

```
feat: record an escalation on the RAID item it escalates

handleEscalate now applies ONE functional setRaid that raises severity
when the plan says so, appends a RaidEscalation, echoes it into the note
log and stamps localModifiedAt, then logs raid.escalated with the severity
step only. The closure read of raid that lost a same-tick concurrent write
is gone (§515).

Claude-Session: https://[session link removed]
```

```bash
git commit --only -F "$S/msg-task3.txt" -- src/app/action-escalate.ts src/app/action-escalate.test.ts src/app/use-action-center-handlers.ts src/app/use-action-center-handlers.test.ts src/app/activity-log.ts src/app/activity-log.test.ts src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts
git show --stat HEAD | tail -12
```

---

## Task 3b: AI can append an escalation

User decisions 2026-09-13 (deviations 17–19): the AI records an escalation APPEND-ONLY through a dedicated `escalate_raid_item { id, expectedToken, toEmail, toName? }` tool; effects = the human Escalate minus the mail (entry + note echo + `raid.escalated` actor `ai` + the same severity plan, one functional write); the note is authored "AI created"; one call applies immediately and is undoable, two or more in a turn stage on the review card. Raw `escalations` through create/update stays refused by `RAID_FIELD_GUARDS` (unchanged).

Depends on Task 2 (committed) and Task 3 (`buildEscalationEntry`, `describeEscalation`, `buildEscalationRecord`, `escalationActivityArgs`, `raid.escalated`, the note/activity i18n keys). Touches no file Tasks 4–6 touch.

**Files:**
- Modify:
  - `src/app/action-escalate.ts` (`aiEscalationNoteAuthor`, `resolveEscalationRecipient`)
  - `src/app/note-log.ts` (`addNote` keeps an explicit `authorName` without `self`)
  - `src/app/i18n.ts`, `src/app/i18n.de.ts` (`raidNoteAuthorAi`)
  - `src/app/types.ts` (`RaidEscalation` docstring)
  - `src/app/raid-escalation.ts` (export the two caps; `requireEscalationRecipient` — deviation 21)
  - `src/app/chat-tool-defs.ts` (`escalate_raid_item`)
  - `src/app/chat-tools.ts` (`EscalateRaidResult`, `ToolDispatcher.escalateRaid`, `runTool` case)
  - `src/app/use-register-tools.ts` (`escalateRaid`, `RegisterToolsDeps.resourcesRef`)
  - `src/app/use-chat-dispatcher.ts` (pass `resourcesRef`)
  - `src/app/chat-proposal.ts` (`ENTITY_WRITE_TOOLS`, `TARGET_MINTED_BY`)
  - `src/app/chat-proposal-apply.ts` (`TOKEN_ROW_SOURCE`)
  - `src/app/insights/recommend-tokens.ts` (`UPDATE_TARGET`)
  - `lib/app-feature-guide.md`, `src/app/operating-guide-builtin.generated.ts` (regenerated)
  - `docs/AGENTS/ai-assistant.md`
- Test:
  - `src/app/action-escalate.test.ts`
  - `src/app/note-log.test.ts`
  - `src/app/chat-tools.test.ts`
  - `src/app/ai-entity-token.test.ts`
  - `src/app/chat-proposal.test.ts`
  - `src/app/chat-proposal-describe.test.ts`
  - `src/app/chat-proposal-apply.test.tsx`
  - `src/app/use-chat-dispatcher.undo.test.tsx`
  - `src/app/use-chat-dispatcher.escalate.test.tsx` (NEW)

**Registry ledger** (`git grep -n -E 'update_raid_item|create_raid_item|send_inquiry|sendInquiry' -- src e2e scripts` plus every `TOOL_DEFS` importer; `e2e/` has zero hits). ADD: `TOOL_DEFS`, `ToolDispatcher` + `runTool`, `requireEscalationRecipient`, the raid-escalation caps, `RegisterToolDispatcher` + writer + `resourcesRef`, the `useRegisterTools` call, `ENTITY_WRITE_TOOLS` ("every live tool is classified exactly once"), `TARGET_MINTED_BY` (the derived "addresses a row by id" test), `TOKEN_ROW_SOURCE` ("covers every token-guarded tool"), `UPDATE_TARGET` (`recommend-tokens.test.ts` pins the unstampable list exactly), the feature guide (`operating-guide-builtin.test.ts` pins the generated file), `ai-assistant.md`. NO-CHANGE, each deliberate: `LINK_FIELDS` / `DESTRUCTIVE_TOOLS` / `CREATE_MINT_KIND` / `sendsInvitations` (no id list, removes nothing, not a create, sends nothing); `ALLOWED_REC_TOOLS` (a persisted recommendation must not pick whom to escalate to; `recommend.test.ts` pins enum == set); `TOOL_ENTITY` / `chat-proposal-block.tsx` (no descriptor → the `send_inquiry`-style empty plan; the row title is the tool name); `inline-ai-edit` descriptors (`describeEntityCalls` matches only a descriptor's update/create/delete names); `chat-api.ts` `toolsFor` (derived); `voice.ts`; `buildUndoLabel` (`raid.escalated` → "Edited RAID item …"); scheduled jobs (no tool dispatch); `AXIS_BASELINE.raid` stays `{ declared: 16, undeclared: 7 }`.

**Interfaces:**
- Consumes:
  - Task 3: `EscalationRecipient`, `EscalationNoteAuthor`, `buildEscalationEntry`, `describeEscalation`, `buildEscalationRecord`, `escalationActivityArgs`, `ActivityKind` `"raid.escalated"`
  - `planEscalation`, `EscalationPlan` (`./action-escalate`)
  - `requireToken`, `ConcurrencyTokenError` (`./chat-tools-updates`); `entityToken` (`./ai-entity-token`)
  - `isValidEmail` (`./sanitize`); `resourceDisplayName` (`./resource-foundation`)
  - `addNote`, `canEditNote`, `sanitizeNoteLog` (`./note-log`); `authorLabel` (`./note-log-panel`)
  - `capturePart`, `undoRef.current.captureComposite` (`./undo/use-undo-stack`)
  - `shouldStage` (`./chat-proposal`), unchanged: an entity write counts once, and more than one stages
  - `RAID_FIELD_GUARDS.escalations` (unchanged; still the only raw-field guard)
- Produces:
  - `aiEscalationNoteAuthor(lang: Lang): EscalationNoteAuthor` → `{ self: null, authorName: t(lang, "raidNoteAuthorAi") }`
  - i18n key `raidNoteAuthorAi` (EN `"AI created"`, DE `"Von KI erstellt"`)
  - `addNote` keeps `authorName` when `self` is null (signature unchanged)
  - `resolveEscalationRecipient(email: string, name: string, resources: readonly Pick<Resource, "id" | "firstName" | "lastName" | "email" | "emails">[]): EscalationRecipient`
  - `const RAID_ESCALATION_NAME_MAX = 200`, `const RAID_ESCALATION_EMAIL_MAX = 320`
  - `requireEscalationRecipient(input: Record<string, unknown>): { email: string; name: string }`
  - `type EscalateRaidResult = { id: number; severity?: string; severityRaised: boolean; escalation: RaidEscalation; emailSent: false }`
  - `ToolDispatcher.escalateRaid(id: number, recipient: { email: string; name: string }): EscalateRaidResult | null`
  - `RegisterToolsDeps.resourcesRef: RefObject<readonly Resource[]>`
  - tool `escalate_raid_item` (`required: ["id", "expectedToken", "toEmail"]`)

**Note author — why a stored literal:** the label is stored as a literal `authorName` translated once at write time in `settings.language`, because that is exactly how the note log already stores authorship (a name snapshot beside an optional `authorResourceId`, shown first by `authorLabel` and by the export's `entry.authorName || noteLogNoAuthor`) and how the escalation note text itself is stored; a render-time marker would need a new persisted `NoteLogEntry` field through `note-log-policy.ts`, the panel and the export. It carries NO `authorResourceId`, so it is never attributed to `settings.selfResourceId`.

Line endings: every `src/app/*.ts(x)` file here is CRLF in the working tree → Edit tool only; `i18n.de.ts` via the node patch script only. `lib/app-feature-guide.md`, `docs/AGENTS/ai-assistant.md` and `src/app/operating-guide-builtin.generated.ts` are LF. The new test file is created with Write.

- [ ] **Step 0: Preconditions (read-only guard)**

```bash
S=C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad
git grep -n -E "export function (buildEscalationRecord|buildEscalationEntry|describeEscalation|escalationActivityArgs)" -- src/app/action-escalate.ts
git grep -n '"raid.escalated"' -- src/app/activity-log.ts
git grep -n -E "raidEscalationNoteRaised|raidEscalationNoteNotifyOnly" -- src/app/i18n.ts src/app/i18n.de.ts
git grep -n "self != null && authorName" -- src/app/note-log.ts
git grep -n 'from "./types"' -- src/app/use-register-tools.ts
git grep -n -E "emails\?: string\[\]|  email\?: string;" -- src/app/types.ts
for f in src/app/chat-tools.ts src/app/use-register-tools.ts src/app/chat-tool-defs.ts src/app/chat-proposal.ts src/app/action-escalate.ts src/app/note-log.ts; do node -e "console.log(require('fs').readFileSync('$f','utf8').split('\n').length, '$f')"; done
```

Expected:
- All four builder exports are present (Task 3 now produces `escalationActivityArgs` itself). If any is missing, STOP and report NEEDS_CONTEXT — Task 3 owns them; do not add them here.
- `raid.escalated` is present; both note keys are present in BOTH i18n files (the DE anchor in Step 1 needs `raidEscalationNoteNotifyOnly`).
- The `addNote` line `self != null && authorName` is present exactly once.
- `use-register-tools.ts` has NO `./types` import (so Step 4 adds one).
- `Resource` has `email?: string;` and `emails?: string[]`.
- Every size is far below 1600 (measured before Task 3: chat-tools 928, use-register-tools 932, chat-tool-defs 910, chat-proposal 724).

- [ ] **Step 1: i18n key (EN via the Edit tool, DE via the node script)**

`src/app/i18n.ts`: replace `  raidEscalationNoteNotifyOnly: "Escalated to {0} (notify only)",` with:

```ts
  raidEscalationNoteNotifyOnly: "Escalated to {0} (notify only)",
  raidNoteAuthorAi: "AI created",
```

Write `$S/de-task3b.json` with the Write tool (reusing `$S/patch-de.mjs` from Task 3):

```json
[
  { "after": "  raidEscalationNoteNotifyOnly: ", "lines": [
    "  raidNoteAuthorAi: \"Von KI erstellt\","
  ] }
]
```

```bash
node "$S/patch-de.mjs" "$S/de-task3b.json"; echo "EXIT=$?"
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');const m=s.match(/\r\n  raidNoteAuthorAi: \"([^\"]*)\"/);console.log(m ? m[1] : 'MISSING')"
```

Expected: `patched; LF-only line ends: 0`, `EXIT=0`, then `Von KI erstellt`.

- [ ] **Step 2: Write the failing tests**

(a) `src/app/action-escalate.test.ts`: add `resolveEscalationRecipient, aiEscalationNoteAuthor` to the `./action-escalate` import, then append (it reuses Task 3's `raid`, `JANE`, `AT`, `AUTHOR` and the `loadI18n` import):

```ts
describe("resolveEscalationRecipient (§515 AI path)", () => {
  const ADA = { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", emails: ["a.l@example.com"] };
  const GRACE = { id: 8, firstName: "Grace", lastName: "Hopper", email: "grace@example.com" };

  it("links the one resource whose primary address matches, case-insensitively, and borrows its name", () => {
    expect(resolveEscalationRecipient(" ADA@example.com ", "", [ADA, GRACE]))
      .toEqual({ name: "Ada Lovelace", email: "ADA@example.com", resourceId: 7 });
  });
  it("matches an additional address too, and a model-chosen name wins", () => {
    expect(resolveEscalationRecipient("a.l@example.com", " The Countess ", [ADA, GRACE]))
      .toEqual({ name: "The Countess", email: "a.l@example.com", resourceId: 7 });
  });
  it("links nobody when no resource, or more than one, matches", () => {
    expect(resolveEscalationRecipient("ops@example.com", "", [ADA, GRACE]))
      .toEqual({ name: "", email: "ops@example.com", resourceId: null });
    expect(resolveEscalationRecipient("grace@example.com", "", [GRACE, { ...GRACE, id: 9 }]))
      .toEqual({ name: "", email: "grace@example.com", resourceId: null });
  });
});

describe("aiEscalationNoteAuthor (§515, user decision: \"AI created\")", () => {
  it("labels the note \"AI created\" and attributes it to no resource (positive control: a self id DOES attribute)", () => {
    const item = raid({ id: 3, category: "I", severity: "High" });
    const plan = planEscalation(item);
    const ai = buildEscalationRecord(item, plan, JANE, AT, "x", aiEscalationNoteAuthor("en-US"));
    const human = buildEscalationRecord(item, plan, JANE, AT, "x", AUTHOR);
    expect(ai.noteLog?.[0]?.authorName).toBe("AI created");
    expect(ai.noteLog?.[0]?.authorResourceId).toBeUndefined();
    expect(human.noteLog?.[0]?.authorResourceId).toBe(7);
  });
  it("is translated in German", async () => {
    await loadI18n("de");
    expect(aiEscalationNoteAuthor("de")).toEqual({ self: null, authorName: "Von KI erstellt" });
  });
});
```

(b) `src/app/note-log.test.ts`: replace

```ts
    const out = addNote([], { html: "<p>x</p>", text: "x", timestamp: "2026-02-02T00:00:00.000Z", self: null });
    expect(out[0].authorResourceId).toBeUndefined();
  });
```

with

```ts
    const out = addNote([], { html: "<p>x</p>", text: "x", timestamp: "2026-02-02T00:00:00.000Z", self: null });
    expect(out[0].authorResourceId).toBeUndefined();
  });
  it("keeps an explicit authorName without a self id — the AI escalation label (§515)", () => {
    const out = addNote([], { html: "<p>x</p>", text: "x", timestamp: "2026-02-02T00:00:00.000Z", self: null, authorName: "AI created" });
    expect(out[0].authorName).toBe("AI created");
    expect(out[0].authorResourceId).toBeUndefined();
    // The label survives the load-boundary validator every codec decodes through.
    expect(sanitizeNoteLog(out)[0]?.authorName).toBe("AI created");
    // Existing rule, unchanged: no authorResourceId → anyone may edit it.
    expect(canEditNote(out[0], 8)).toBe(true);
  });
```

(c) `src/app/chat-tools.test.ts`, in three edits:
1. In `makeDispatcher`, replace `    deleteRaid: vi.fn((id: number) => id === 10),` with:

```ts
    deleteRaid: vi.fn((id: number) => id === 10),
    escalateRaid: vi.fn((id: number, recipient: { email: string; name: string }) =>
      id === 10
        ? {
            id: 10, severity: "High", severityRaised: false, emailSent: false as const,
            escalation: { at: "2026-06-02T00:00:00.000Z", toEmail: recipient.email },
          }
        : null,
    ),
```

2. In `expectedRequired`, replace `    update_raid_item: ["id", "expectedToken"],` with:

```ts
    update_raid_item: ["id", "expectedToken"],
    escalate_raid_item: ["id", "expectedToken", "toEmail"],
```

3. Replace `describe("runTool — send_inquiry", () => {` with the block below followed by that same line:

```ts
describe("runTool — escalate_raid_item (§515, append-only)", () => {
  it("forwards ONLY the validated recipient — no raw escalations, severity, note log or resource id rides along", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "escalate_raid_item", {
      id: 10, expectedToken: FRESH_RAID_TOKEN, toEmail: "  jane@example.com ", toName: " Jane Doe ",
      escalations: [], severity: "Low", noteLog: [], toResourceId: 99,
    });
    expect(d.escalateRaid).toHaveBeenCalledTimes(1);
    expect(d.escalateRaid).toHaveBeenCalledWith(10, { email: "jane@example.com", name: "Jane Doe" });
    expect(d.updateRaid).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 10, emailSent: false });
  });

  it("refuses an escalation that supplies no token", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "escalate_raid_item", { id: 10, toEmail: "jane@example.com" }))
      .rejects.toThrow(/expectedToken is required/);
    expect(d.escalateRaid).not.toHaveBeenCalled();
  });

  it("refuses a stale token", async () => {
    const d = makeDispatcher();
    const stale = entityToken("raid", makeRaidItem({ severity: "Low" }));
    await expect(runTool(d, "escalate_raid_item", { id: 10, expectedToken: stale, toEmail: "jane@example.com" }))
      .rejects.toThrow(/changed since you read it/);
    expect(d.escalateRaid).not.toHaveBeenCalled();
  });

  it.each([
    [{ toEmail: "not-an-address" }, /toEmail must be a valid email/],
    [{}, /toEmail must be a valid email/],
    [{ toEmail: 42 }, /toEmail must be a valid email/],
    [{ toEmail: `${"a".repeat(315)}@x.com` }, /toEmail must be a valid email/],
    [{ toEmail: "jane@example.com", toName: 7 }, /toName must be a string/],
    [{ toEmail: "jane@example.com", toName: "n".repeat(201) }, /toName must be at most 200/],
  ])("rejects the invalid recipient %o with a model-facing error and writes nothing", async (recipient, message) => {
    const d = makeDispatcher();
    await expect(runTool(d, "escalate_raid_item", { id: 10, expectedToken: FRESH_RAID_TOKEN, ...recipient }))
      .rejects.toThrow(message);
    expect(d.escalateRaid).not.toHaveBeenCalled();
  });

  it("reports a missing item as not found, before the token", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "escalate_raid_item", { id: 99, toEmail: "jane@example.com" }))
      .rejects.toThrow("RAID item #99 not found");
    expect(d.escalateRaid).not.toHaveBeenCalled();
  });
});
```

(d) `src/app/ai-entity-token.test.ts`: replace `  const GUARDED_NON_UPDATE = ["set_task_dependencies"];` with `  const GUARDED_NON_UPDATE = ["set_task_dependencies", "escalate_raid_item"];`.

(e) `src/app/chat-proposal.test.ts` — this pins the REVIEW FLOW (user decision 4) at the rule that decides it. Two edits:
1. Replace `  "create_raid_item", "update_raid_item",` (the `NON_DESTRUCTIVE_WRITE_NAMES` line) with `  "create_raid_item", "update_raid_item", "escalate_raid_item",`.
2. In the `shouldStage` table, replace `    ["two send_inquiry",               [call("send_inquiry", { id: 1 }), call("send_inquiry", { id: 2 })], true],` with:

```ts
    ["two send_inquiry",               [call("send_inquiry", { id: 1 }), call("send_inquiry", { id: 2 })], true],
    // §515 review flow: ONE AI escalation applies immediately (undoable, pinned by
    // the `escalateRaid` undo site); two or more in a turn go to the review card.
    ["one escalate_raid_item",         [call("escalate_raid_item", { id: 1 })],              false],
    ["two escalate_raid_item",         [call("escalate_raid_item", { id: 1 }), call("escalate_raid_item", { id: 2 })], true],
    ["escalate + update_raid_item",    [call("update_raid_item", { id: 1 }), call("escalate_raid_item", { id: 1 })], true],
```

(f) `src/app/chat-proposal-describe.test.ts`: replace

```ts
      "delete_all_tasks", "send_inquiry", "set_task_dependencies",
    ];
```

with

```ts
      "delete_all_tasks", "send_inquiry", "set_task_dependencies",
      "escalate_raid_item",
    ];
```

and insert, directly after the closing `  });` of `test("omits exactly the stageable write tools the descriptor engine cannot diff", …)` (same `describe`, so `ws` and `call` are in scope):

```ts
  test("stamps escalate_raid_item with the live RAID row's token and describes no diff (§515)", () => {
    const raid7 = {
      id: 7, category: "I", title: "Vendor down", status: "Open", severity: "High",
      linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-05-01",
    };
    const withRaid = { ...ws, raid: [raid7] } as unknown as Workspace;
    const [described] = describeProposal([call("escalate_raid_item", { id: 7, toEmail: "jane@example.com" })], withRaid);
    expect(described.stamped.input.expectedToken).toBe(entityToken("raid", raid7));
    expect(described.plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [], links: [] });
  });
```

(g) `src/app/chat-proposal-apply.test.tsx`, two edits:
1. Replace `    expect(TOKEN_REQUIRED_TOOLS.size).toBe(9);` with `    expect(TOKEN_REQUIRED_TOOLS.size).toBe(10);`, and `    expect(advertised).toHaveLength(9);` with `    expect(advertised).toHaveLength(10);`.
2. Replace `  test("it names the eight update tools and set_task_dependencies", () => {` with `  test("it names the eight update tools, set_task_dependencies and escalate_raid_item", () => {`, and in that test's literal replace `    expect([...TOKEN_REQUIRED_TOOLS].sort()).toEqual([\n      "set_task_dependencies",` with `    expect([...TOKEN_REQUIRED_TOOLS].sort()).toEqual([\n      "escalate_raid_item",\n      "set_task_dependencies",`. ★ Keep BOTH lines in the anchor: the first line alone also matches the `toEqual([...advertised].sort())` assertion just above, so a one-line anchor is not unique. `"escalate_raid_item"` sorts before `"set_task_dependencies"`, so the literal stays sorted.
3. (deviation 21) In `its \`kind\` stamps a token that tool's own requireToken accepts`, after the loop input's `            dependencies: [],` add:

```ts
            // `escalate_raid_item` refuses a missing recipient AFTER the token
            // check (§515); the others ignore the key. Without it the token
            // would pass and the recipient error would read as a token failure.
            toEmail: "row@example.com",
```

(h) `src/app/use-chat-dispatcher.undo.test.tsx` — pins "applies immediately and is undoable". Replace

```ts
    kind: "raid.updated", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "deleteRaid",
```

with

```ts
    kind: "raid.updated", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "escalateRaid",
    act: (d) => { d.escalateRaid(2, { email: "jane@example.com", name: "Jane" }); },
    verify: (d) => {
      expect(d.getRaidRow(2)?.escalations).toHaveLength(1);
      expect(d.getRaidRow(2)?.severity).toBe("Critical");
    },
    // ★ Row 2 is seeded an Issue at High, with no `escalations` and no `noteLog`.
    // ★★ KNOWN LIMIT, PINNED IN BOTH HALVES (plan deviation 20): undo reverts the
    //   escalation entry and the severity, but the "AI created" note STAYS —
    //   `noteLog` is a WRITE_THROUGH field, so the live log wins over the
    //   before-image on every whole-row undo (open-followups §50). A future
    //   per-capture opt-out must change this assertion visibly.
    restored: (d) => {
      expect(d.getRaidRow(2)?.escalations).toBeUndefined();
      expect(d.getRaidRow(2)?.severity).toBe("High");
      expect(d.getRaidRow(2)?.noteLog).toHaveLength(1);
      expect(d.getRaidRow(2)?.noteLog?.[0]?.authorName).toBe("AI created");
      expect(ids(d.listRaid())).toEqual([1, 2, 3]);
    },
    kind: "raid.escalated", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "deleteRaid",
```

(i) NEW `src/app/use-chat-dispatcher.escalate.test.tsx` (Write tool):

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { describeEscalation } from "./action-escalate";
import { entityToken } from "./ai-entity-token";
import { runTool } from "./chat-tools";
import { loadI18n } from "./i18n";
import { authorLabel } from "./note-log-panel";
import { defaultSettings } from "./settings-types";
import type { RaidItem, Resource } from "./types";
import { useChatDispatcher, type ChatDispatcherArgs } from "./use-chat-dispatcher";
import { useWorkspace } from "./workspace-context";

// §515 — the AI appends ONE escalation through the real dispatcher. Every
// assertion reads the STORED row (the tool returns a summary), and every
// refusal carries a positive control in the same test.

function issue(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 5, category: "I", title: "Vendor down", status: "Open", severity: "High",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-05-01",
    ...over,
  };
}
const EARLIER = { at: "2026-05-01T09:00:00.000Z", toEmail: "ops@example.com" };
const JANE = {
  id: 4, firstName: "Jane", lastName: "Doe", email: "jane@example.com",
  roleId: null, utilizationMode: "percent", utilization: {},
} as unknown as Resource;
// The user IS Jane: a note wrongly attributed to `selfResourceId` would carry id 4.
const EN_AS_JANE = { ...defaultSettings, language: "en-US" as const, selfResourceId: 4 };

function probe(raid: RaidItem[], over: Partial<ChatDispatcherArgs> = {}) {
  const logActivityAs = vi.fn();
  const hook = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs({ logActivityAs, ...over })), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith({ raid, resources: [JANE] }) },
  );
  return { ...hook, logActivityAs };
}
const stored = (ws: { raid: readonly RaidItem[] }, id = 5) => ws.raid.find((r) => r.id === id)!;
const tokenOf = (row: RaidItem | null) => entityToken("raid", row!);

describe("escalate_raid_item — the AI appends one escalation (§515)", () => {
  it("appends the entry, an \"AI created\" note, the severity step and one raid.escalated row", async () => {
    const { result, logActivityAs } = probe([issue({ escalations: [EARLIER] })], { settings: EN_AS_JANE });
    let out: unknown;
    await act(async () => {
      out = await runTool(result.current.d, "escalate_raid_item", {
        id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), toEmail: "jane@example.com",
      });
    });
    const row = stored(result.current.ws);
    expect(row.severity).toBe("Critical");
    expect(row.escalations).toEqual([
      EARLIER,
      { at: expect.any(String), toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical" },
    ]);
    expect(row.noteLog).toHaveLength(1);
    expect(row.noteLog?.[0]?.text).toBe(describeEscalation("en-US", row.escalations![1]));
    // Author: the literal label, NOT the user's own resource (selfResourceId 4 is set above).
    expect(row.noteLog?.[0]?.authorName).toBe("AI created");
    expect(row.noteLog?.[0]?.authorResourceId).toBeUndefined();
    expect(authorLabel(row.noteLog![0], [JANE])).toBe("AI created");
    expect(logActivityAs).toHaveBeenCalledTimes(1);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "raid.escalated", 5, "High", "Critical");
    // Positive control above (the row was logged); the address never is.
    expect(JSON.stringify(logActivityAs.mock.calls)).not.toContain("jane@example.com");
    expect(out).toMatchObject({ id: 5, severity: "Critical", severityRaised: true, emailSent: false });
  });

  it.each([
    ["an Issue already at Critical", issue({ severity: "Critical" }), "Critical"],
    ["a Risk, whose severity the matrix owns", issue({ category: "R", severity: "High" }), "High"],
  ])("records %s as notify-only and leaves severity alone", async (_label, seed, severity) => {
    const { result, logActivityAs } = probe([seed]);
    await act(async () => {
      await runTool(result.current.d, "escalate_raid_item", {
        id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), toEmail: "ops@example.com",
      });
    });
    const row = stored(result.current.ws);
    expect(row.severity).toBe(severity);
    expect(row.escalations).toEqual([{ at: expect.any(String), toEmail: "ops@example.com" }]);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "raid.escalated", 5, severity, severity);
  });

  it.each([
    ["clear", []],
    ["rewrite", [{ ...EARLIER, toEmail: "evil@example.com" }]],
  ])("update_raid_item cannot %s the history (positive control: the title DOES change)", async (_verb, escalations) => {
    const { result } = probe([issue({ escalations: [EARLIER] })]);
    await act(async () => {
      await runTool(result.current.d, "update_raid_item", {
        id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), title: "Vendor down (renamed)", escalations,
      });
    });
    const row = stored(result.current.ws);
    expect(row.title).toBe("Vendor down (renamed)");
    expect(row.escalations).toEqual([EARLIER]);
  });

  it("refuses a second escalation made from the same read, so a retried call cannot double-record", async () => {
    const { result } = probe([issue()]);
    const token = tokenOf(result.current.d.getRaidRow(5));
    await act(async () => {
      await runTool(result.current.d, "escalate_raid_item", { id: 5, expectedToken: token, toEmail: "jane@example.com" });
    });
    await act(async () => {
      await expect(
        runTool(result.current.d, "escalate_raid_item", { id: 5, expectedToken: token, toEmail: "jane@example.com" }),
      ).rejects.toThrow(/changed since you read it/);
    });
    expect(stored(result.current.ws).escalations).toHaveLength(1); // the first one DID land
  });

  it("composes with a same-tick human edit to another field (ONE functional write)", () => {
    const { result } = probe([issue()]);
    act(() => {
      result.current.ws.setRaid((prev) => prev.map((r) => (r.id === 5 ? { ...r, title: "Renamed by a human" } : r)));
      result.current.d.escalateRaid(5, { email: "jane@example.com", name: "" });
    });
    const row = stored(result.current.ws);
    expect(row.title).toBe("Renamed by a human");
    expect(row.escalations).toHaveLength(1);
    expect(row.severity).toBe("Critical");
  });

  it("refuses in a read-only popout and records nothing (positive control: the refusal fires)", () => {
    const { result, logActivityAs } = probe([issue()], { isReadOnly: true });
    expect(() => result.current.d.escalateRaid(5, { email: "jane@example.com", name: "" })).toThrow(/pop-?out/i);
    expect(stored(result.current.ws).escalations).toBeUndefined();
    expect(logActivityAs).not.toHaveBeenCalled();
  });

  describe("in German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });
    it("writes the note AND its author label in the project language", async () => {
      const { result } = probe([issue()], { settings: { ...EN_AS_JANE, language: "de" } });
      await act(async () => {
        await runTool(result.current.d, "escalate_raid_item", {
          id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), toEmail: "ops@example.com",
        });
      });
      const row = stored(result.current.ws);
      expect(row.noteLog?.[0]?.text).toBe(describeEscalation("de", row.escalations![0]));
      expect(row.noteLog?.[0]?.text.startsWith("Eskaliert an ops@example.com")).toBe(true);
      expect(row.noteLog?.[0]?.authorName).toBe("Von KI erstellt");
      expect(row.noteLog?.[0]?.authorResourceId).toBeUndefined();
    });
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run src/app/action-escalate.test.ts src/app/note-log.test.ts src/app/chat-tools.test.ts src/app/ai-entity-token.test.ts src/app/chat-proposal.test.ts src/app/chat-proposal-describe.test.ts src/app/chat-proposal-apply.test.tsx src/app/use-chat-dispatcher.undo.test.tsx src/app/use-chat-dispatcher.escalate.test.tsx --maxWorkers=1 --reporter=dot > "$S/t3b-red.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t3b-red.log" | head -30
```

Expected: `EXIT=1`, with all 9 files failing or close to it. The expected reasons:
- `resolveEscalationRecipient` / `aiEscalationNoteAuthor` is not a function.
- `addNote … keeps an explicit authorName without a self id` sees `authorName` undefined (the `self != null` gate).
- `runTool` throws its unknown-tool error for `escalate_raid_item`, and the `expectedRequired` lookup is undefined.
- The advertising and classification sets lack the tool (`ai-entity-token`; `chat-proposal` "classified exactly once" — the LITERAL now has a name the live defs lack; the `one escalate_raid_item` row is `false` either way, but the `two` row reads `false` while the tool is unclassified).
- `TOKEN_REQUIRED_TOOLS.size` is 9.
- `d.escalateRaid is not a function` in both dispatcher files.

- [ ] **Step 4: Implement**

`src/app/note-log.ts`, two edits:
1. Replace

```ts
/** Append a new stamped entry, minting its id and attributing it to `self`
 *  when present (an authorless entry when the user has no linked resource). */
```

with

```ts
/** Append a new stamped entry, minting its id and attributing it to `self`
 *  when present (an authorless entry when the user has no linked resource).
 *  An explicit `authorName` is kept even without `self` — the AI escalation
 *  note's "AI created" label (§515). The notes window derives its name from
 *  the `self` resource, so it never passes one without a self id. */
```

2. Replace `    ...(self != null && authorName ? { authorName } : {}),` with `    ...(authorName ? { authorName } : {}),`.

`src/app/types.ts`: replace ` *  App-written by the Next-actions Escalate CTA; model-read-only. */` with:

```ts
 *  App-written by the Next-actions Escalate CTA and, APPEND-ONLY, by the AI
 *  `escalate_raid_item` tool; never model-writable through create/update. */
```

`src/app/raid-escalation.ts`: replace

```ts
const NAME_MAX = 200;
const EMAIL_MAX = 320;
```

with

```ts
/** Caps shared with the AI `escalate_raid_item` boundary check (§515), so a
 *  recipient the tool accepts is one this sanitizer keeps verbatim. */
export const RAID_ESCALATION_NAME_MAX = 200;
export const RAID_ESCALATION_EMAIL_MAX = 320;
const NAME_MAX = RAID_ESCALATION_NAME_MAX;
const EMAIL_MAX = RAID_ESCALATION_EMAIL_MAX;
```

`src/app/action-escalate.ts`, two edits:
1. Replace `import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";` with `import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity, type Resource } from "./types";`, and replace `import { severityLabel } from "./raid-labels";` with:

```ts
import { severityLabel } from "./raid-labels";
import { resourceDisplayName } from "./resource-foundation";
```

2. Append at the end of the file:

```ts
/** The note author for an escalation the AI assistant records (§515, user
 *  decision 2026-09-13): the literal label "AI created", translated ONCE at
 *  write time like the note text itself, and NO `self` — attributing it to
 *  `settings.selfResourceId` would credit the user with a line they did not
 *  write. `authorLabel` shows `authorName` first, so no render-time marker is
 *  needed; the activity row's `ai` actor records who acted. */
export function aiEscalationNoteAuthor(lang: Lang): EscalationNoteAuthor {
  return { self: null, authorName: t(lang, "raidNoteAuthorAi") };
}

/** The recipient of an AI escalation chosen by e-mail. Links the ONE directory
 *  resource whose primary or additional address matches (case-insensitive);
 *  zero or several matches link nobody. A model-chosen name wins, else the
 *  linked resource's display name fills it.
 *  ★★ E-mail, never a resource id: a staged plan can remap id ARRAYS only
 *  (`LINK_FIELDS`), so a scalar id minted earlier in the same turn would be
 *  stored dangling — or against a live stranger with the same number. */
export function resolveEscalationRecipient(
  email: string,
  name: string,
  resources: readonly Pick<Resource, "id" | "firstName" | "lastName" | "email" | "emails">[],
): EscalationRecipient {
  const wanted = email.trim().toLowerCase();
  const matches = resources.filter((r) =>
    [r.email, ...(r.emails ?? [])].some((e) => typeof e === "string" && e.trim().toLowerCase() === wanted),
  );
  const linked = matches.length === 1 ? matches[0] : undefined;
  const chosen = name.trim();
  return {
    name: chosen || (linked ? resourceDisplayName(linked) : ""),
    email: email.trim(),
    resourceId: linked ? linked.id : null,
  };
}
```

`src/app/raid-escalation.ts`, two more edits (deviation 21 — NOT `chat-tools-updates.ts`, whose every `input.<name>` read `tool-input-coverage.test.ts` checks against `update_task`):
1. Replace `import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";` with:

```ts
import { isValidEmail } from "./sanitize-core";
import { RAID_SEVERITIES, type RaidEscalation, type RaidItem, type RaidSeverity } from "./types";
```

(`sanitize-core.ts` imports only `./types`, so no cycle through the `sanitize.ts` barrel.)

2. Insert directly after `const SEVERITY_SET: ReadonlySet<string> = new Set(RAID_SEVERITIES);` (below all the constants), and add to the module header: `Also holds requireEscalationRecipient, the AI escalate_raid_item tool's boundary check, because it must share this sanitizer's recipient caps.`:

```ts

/** The recipient of an `escalate_raid_item` call, validated at the TOOL
 *  BOUNDARY (§515). Throws a model-facing message for any value the escalation
 *  record could not store verbatim. It returns ONLY these two fields, which is
 *  what keeps the tool append-only: no other model key (a raw `escalations`,
 *  a `severity`, a `toResourceId`) can reach the writer.
 *  ★ Unlocalized on purpose, like every other `throw` in `runTool`.
 *  ★★ Deliberately NOT in `chat-tools-updates.ts`: `tool-input-coverage.test.ts`
 *   scans that file's every `input.<name>` read against `update_task`'s schema,
 *   so `toEmail`/`toName` there would be misreported as update_task inputs. */
export function requireEscalationRecipient(input: Record<string, unknown>): { email: string; name: string } {
  const email = typeof input.toEmail === "string" ? input.toEmail.trim() : "";
  if (!email || !isValidEmail(email) || email.length > EMAIL_MAX) {
    throw new Error(`toEmail must be a valid email address of at most ${EMAIL_MAX} characters`);
  }
  const rawName = input.toName;
  if (rawName !== undefined && rawName !== null && typeof rawName !== "string") {
    throw new Error("toName must be a string when given");
  }
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length > NAME_MAX) {
    throw new Error(`toName must be at most ${NAME_MAX} characters`);
  }
  return { email, name };
}
```

`src/app/chat-tool-defs.ts`: replace

```ts
    description: "Update fields on an existing RAID item. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...expectedTokenField, ...raidFields },
      required: ["id", "expectedToken"],
    },
  },
```

with

```ts
    description: "Update fields on an existing RAID item. Only the fields you pass change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, ...expectedTokenField, ...raidFields },
      required: ["id", "expectedToken"],
    },
  },
  {
    name: "escalate_raid_item",
    // ★★ APPEND-ONLY, AND A SEPARATE TOOL ON PURPOSE (§515). `update_raid_item`
    //  refuses `escalations` outright (`RAID_FIELD_GUARDS`); this tool can only
    //  ADD one entry, planned by the same `planEscalation` the Escalate CTA uses.
    //  Token-guarded because `escalations` and `severity` are both token-covered,
    //  which is also what refuses a second escalation made from the same read.
    description:
      "Record that a RAID item was escalated to a person. Appends ONE entry to the item's escalation history, adds a dated note labelled 'AI created', and — for an Issue, Assumption or Dependency below Critical — raises its severity one step (a Risk, or an item already Critical or without a severity, is recorded as notify-only). It sends NO email and contacts no one: tell the user to reach the recipient themselves. Existing history entries can never be edited or removed. Pass the expectedToken from list_raid; escalating the same item again needs a fresh read.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        ...expectedTokenField,
        toEmail: {
          type: "string",
          description: "Recipient's email address. A directory resource with this address is linked automatically.",
        },
        toName: { type: "string", description: "Recipient's display name. Omit to use the linked resource's name." },
      },
      required: ["id", "expectedToken", "toEmail"],
    },
  },
```

`src/app/chat-tools.ts`, five edits:
1. Replace `  requireTaskWriteToken,\n  requireToken,\n} from "./chat-tools-updates";` with `  requireTaskWriteToken,\n  requireToken,\n} from "./chat-tools-updates";\nimport { requireEscalationRecipient } from "./raid-escalation";` (deviation 21).
2. Replace `  type Priority,\n  type RaidItem,` with `  type Priority,\n  type RaidEscalation,\n  type RaidItem,`.
3. Replace `export type RaidSummary = {` with the block below followed by `export type RaidSummary = {`:

```ts
/** What `escalate_raid_item` reports back (§515). `emailSent` is always false —
 *  it is there so the model cannot read the result as a sent message. */
export type EscalateRaidResult = {
  id: number;
  severity?: string;
  severityRaised: boolean;
  escalation: RaidEscalation;
  emailSent: false;
};

```

4. Replace `  deleteRaid(id: number): boolean;` with:

```ts
  deleteRaid(id: number): boolean;
  /** Append ONE escalation to RAID item `id` (§515): the record, its "AI
   *  created" note echo, the planned severity step and a `raid.escalated` row,
   *  as one write. Null when the item does not exist. Never sends mail. */
  escalateRaid(id: number, recipient: { email: string; name: string }): EscalateRaidResult | null;
```

5. Replace `    case "delete_raid_item": {` with:

```ts
    case "escalate_raid_item": {
      const id = requireId(input);
      // The `update_raid_item` order — not-found, then the token — and only
      // then the recipient, so a stale read reports "changed" before "bad input".
      const current = d.getRaidRow(id);
      if (!current) throw new Error(`RAID item #${id} not found`);
      requireToken("raid", current, input, `RAID item #${id}`);
      const recipient = requireEscalationRecipient(input);
      const result = d.escalateRaid(id, recipient);
      if (!result) throw new Error(`RAID item #${id} not found`);
      return result;
    }

    case "delete_raid_item": {
```

`src/app/use-register-tools.ts`, seven edits:
1. Replace `import { AI_RICH_FIELDS, withAiRichFields } from "./ai-rich-text";` with:

```ts
import {
  aiEscalationNoteAuthor,
  buildEscalationEntry,
  buildEscalationRecord,
  describeEscalation,
  escalationActivityArgs,
  planEscalation,
  resolveEscalationRecipient,
} from "./action-escalate";
import { AI_RICH_FIELDS, withAiRichFields } from "./ai-rich-text";
```

2. Replace `import type { ProjectClock } from "./timezone";` with:

```ts
import type { ProjectClock } from "./timezone";
import type { RaidItem, Resource } from "./types";
```

3. Replace `  | "deleteRaid"\n  | "listChanges"` with `  | "deleteRaid"\n  | "escalateRaid"\n  | "listChanges"`.
4. Replace `  undoRef: RefObject<Pick<UndoStackApi, "captureComposite"> | undefined>;\n}` with:

```ts
  undoRef: RefObject<Pick<UndoStackApi, "captureComposite"> | undefined>;
  /** Owned by use-chat-dispatcher, which also owns the resource WRITERS, so an
   *  escalation in the same turn as a `create_resource` sees the new row. Read
   *  only to link an escalation recipient by e-mail (§515). */
  resourcesRef: RefObject<readonly Resource[]>;
}
```

5. Replace `  const { isReadOnly, logActivityAs, clockRef, settingsRef, allowDestructiveSave, undoRef } = deps;` with `  const { isReadOnly, logActivityAs, clockRef, settingsRef, allowDestructiveSave, undoRef, resourcesRef } = deps;`.
6. Replace `      // ★★ These four registers count toward the save-time data-loss guards,` with:

```ts
      // ★★★ APPEND-ONLY (§515) — the one AI path that writes `escalations`. It
      //  ADDS one entry through the SAME pure builders the Escalate CTA uses, so
      //  the human and AI records cannot drift; `update_raid_item` still refuses
      //  the raw field (`RAID_FIELD_GUARDS`).
      //  ★★ ONE FUNCTIONAL `setRaid`, unlike the writers around it: the plan is
      //  read ONCE from the ref row (which `runTool` just token-checked) and
      //  APPLIED to the row the updater is handed, so a same-tick human edit to
      //  another field survives. The ref advances too, so a later call in the
      //  same turn reads this write — and finds its token moved.
      //  ★★ The note is authored "AI created" (`aiEscalationNoteAuthor`), never
      //  `settings.selfResourceId` — the user did not write it.
      //  ★ KNOWN LIMIT (Task 3's, deviation 15): a same-tick SEVERITY write is
      //  overwritten by the planned step. No mail; no address in the activity row.
      escalateRaid: (id, { email, name }) => {
        if (isReadOnly) throw readOnlyError();
        const existing = raidRef.current.find((r) => r.id === id);
        if (!existing) return null;
        const at = new Date().toISOString();
        const lang = settingsRef.current.language;
        const recipient = resolveEscalationRecipient(email, name, resourcesRef.current);
        const plan = planEscalation(existing);
        const entry = buildEscalationEntry(plan, recipient, at);
        const noteText = describeEscalation(lang, entry);
        const author = aiEscalationNoteAuthor(lang);
        const apply = (r: RaidItem): RaidItem =>
          r.id === id ? buildEscalationRecord(r, plan, recipient, at, noteText, author) : r;
        // STORED row + PRE-op array, exactly as `updateRaid` captures.
        undoRef.current?.captureComposite({
          kind: "raid.escalated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setRaid,
            edited: [existing],
            fromArray: raidRef.current,
            isPrimary: true,
          })],
          name: existing.title,
          entityKey: "raid",
        });
        raidRef.current = raidRef.current.map(apply);
        setRaid((prev) => prev.map(apply));
        logActivityAs?.("ai", "raid.escalated", id, ...escalationActivityArgs(existing, plan));
        return {
          id,
          severity: plan.raisesSeverity && plan.to ? plan.to : existing.severity,
          severityRaised: plan.raisesSeverity,
          escalation: entry,
          emailSent: false,
        };
      },
      // ★★ These four registers count toward the save-time data-loss guards,
```

7. In the `useMemo` dep array, replace `      undoRef,\n      setRaid,` with:

```ts
      undoRef,
      // ★ Refs from `deps`, listed for the same reason as `clockRef`/`undoRef`.
      //  `settingsRef` was already read (by `readOnlyError`, itself a dep); the
      //  escalation writer is the first body in this memo to read it directly.
      settingsRef,
      resourcesRef,
      setRaid,
```

(deviation 21: without `settingsRef`, `react-hooks/exhaustive-deps` fails lint.)

`src/app/use-chat-dispatcher.ts`: in the `useRegisterTools({ … })` call, replace `    undoRef,\n  });` with `    undoRef,\n    resourcesRef,\n  });`. (`resourcesRef` already exists there; the resource writers assign `resourcesRef.current = next` synchronously.)

`src/app/chat-proposal.ts`, three edits:
1. Replace `  "create_raid_item", "update_raid_item",` with `  "create_raid_item", "update_raid_item", "escalate_raid_item",`.
2. Replace ` *   this name-level membership, not a reason to leave the name out of it. */` with:

```ts
 *   this name-level membership, not a reason to leave the name out of it.
 *
 *  ★★ `escalate_raid_item` (§515) is an ordinary single-row RAID write: it sends
 *   no mail (unlike `send_inquiry`, whose handler opens a mail client) and it is
 *   undo-captured, so one call applies and two stage (user decision 2026-09-13). */
```

3. Replace `  delete_raid_item: "create_raid_item",` with `  delete_raid_item: "create_raid_item",\n  escalate_raid_item: "create_raid_item",`.

`src/app/chat-proposal-apply.ts`: replace `  update_raid_item: { kind: "raid", getRow: (d, id) => d.getRaidRow(id) },` with `  update_raid_item: { kind: "raid", getRow: (d, id) => d.getRaidRow(id) },\n  escalate_raid_item: { kind: "raid", getRow: (d, id) => d.getRaidRow(id) },`.

`src/app/insights/recommend-tokens.ts`: replace `  update_raid_item: { kind: "raid", key: "raid" },` with:

```ts
  update_raid_item: { kind: "raid", key: "raid" },
  // Not an `update_*` tool either (§515): it writes `escalations` and `severity`,
  // both raid-token-covered. Not in `ALLOWED_REC_TOOLS`, so this row serves
  // `chat-proposal-describe.ts`'s staged-row stamping only.
  escalate_raid_item: { kind: "raid", key: "raid" },
```

- [ ] **Step 5: Model-facing guide + agent docs**

`lib/app-feature-guide.md` (LF), three edits:
1. Replace `You cannot write a note on anything, and you cannot read notes on RAID items or change items at all` with `You cannot write a note on anything (recording a RAID escalation adds its own dated note, labelled "AI created"), and you cannot read notes on RAID items or change items at all`.
2. Replace `send an inquiry about a task, and read everything else.` with `send an inquiry about a task, record a RAID escalation (no email is sent), and read everything else.`
3. ★ The sentence `It CANNOT read or write the note log — there is no tool for notes.` occurs TWICE (the RAID bullet and the change-control bullet), so anchor on the RAID bullet's unique preceding clause: replace `a field it does not mention is left untouched rather than blanked. It CANNOT read or write the note log — there is no tool for notes.` (RAID; the change bullet reads `blanked).`) with `a field it does not mention is left untouched rather than blanked. It CANNOT read or write the note log directly — there is no tool for notes. It CAN record an escalation (escalate_raid_item): one new history entry, a dated note labelled "AI created", and the same one-step severity raise as the Escalate button (a Risk or an already-Critical item is notify-only). It sends no email — tell the user to contact the recipient — and it can never edit or remove earlier escalations. One escalation applies at once and can be undone; two or more in a turn go to the review card.`

```bash
node scripts/gen-operating-guide.mjs > "$S/gen3b.log" 2>&1; echo "EXIT=$?"
git diff --stat -- src/app/operating-guide-builtin.generated.ts lib/app-feature-guide.md
git ls-files --eol src/app/operating-guide-builtin.generated.ts lib/app-feature-guide.md
```

Expected: `EXIT=0`; both files are changed; both still `i/lf w/lf`.

`docs/AGENTS/ai-assistant.md` (LF), two edits:
1. Replace

```
- **Optimistic concurrency on SEVEN write tools:** the six entity updates — `update_task` ·
  `update_raid_item` · `update_change` · `update_milestone` · `update_stakeholder` · `update_resource` —
  plus `set_task_dependencies`, each REQUIRING an `expectedToken` input beside `id`.
```

with

```
- **Optimistic concurrency on the token-guarded write tools:** every entity `update_*` tool except
  `update_settings` and `update_document`, plus `set_task_dependencies` and `escalate_raid_item`, each REQUIRING an
  `expectedToken` input beside `id`. Enumerate them rather than trusting a count — `TOKEN_REQUIRED_TOOLS`
  (`chat-proposal-apply.ts`) is derived from the schemas.
  ★★ `escalate_raid_item` (§515) is the APPEND-ONLY escalation write. `update_raid_item` refuses `escalations`
  (`RAID_FIELD_GUARDS`); this tool adds exactly one entry through the SAME `planEscalation` → `buildEscalationRecord`
  pair the Next-actions Escalate CTA uses, as one functional `setRaid` with undo capture and a `raid.escalated` row
  (`escalateRaid`, `use-register-tools.ts`). Its note is authored "AI created" (`aiEscalationNoteAuthor`, a stored
  `authorName` with no `authorResourceId`). It sends no mail and takes no resource id (the recipient links by
  e-mail, `resolveEscalationRecipient`). Its token is what refuses a second escalation from the same read.
```

2. Replace `See the seven-tool note above.` with `See the guarded-tools note above.`

- [ ] **Step 6: Run the tests and the gates**

```bash
npx vitest run src/app/action-escalate.test.ts src/app/note-log.test.ts src/app/note-log-panel.test.tsx src/app/use-notes-window.test.tsx src/app/chat-tools.test.ts src/app/ai-entity-token.test.ts src/app/chat-proposal.test.ts src/app/chat-proposal-describe.test.ts src/app/chat-proposal-apply.test.tsx src/app/use-chat-dispatcher.undo.test.tsx src/app/use-chat-dispatcher.escalate.test.tsx src/app/use-chat-dispatcher.test.tsx src/app/insights/recommend-tokens.test.ts src/app/insights/recommend.test.ts src/app/raid-escalation.test.ts src/app/operating-guide-builtin.test.ts src/app/chat-api.system-prompt.test.ts src/app/inline-ai-edit/tool-input-coverage.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/destructive-save-arming.test.ts src/app/i18n-encoding.test.ts src/app/i18n.test.ts --maxWorkers=1 --reporter=dot > "$S/t3b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$S/t3b.log"
npx tsc --noEmit > "$S/tsc3b.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc3b.log"
npx eslint --max-warnings=0 src/app/action-escalate.ts src/app/action-escalate.test.ts src/app/note-log.ts src/app/note-log.test.ts src/app/types.ts src/app/i18n.ts src/app/raid-escalation.ts src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/chat-tools.test.ts src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.escalate.test.tsx src/app/use-chat-dispatcher.undo.test.tsx src/app/chat-proposal.ts src/app/chat-proposal.test.ts src/app/chat-proposal-describe.test.ts src/app/chat-proposal-apply.ts src/app/chat-proposal-apply.test.tsx src/app/ai-entity-token.test.ts src/app/insights/recommend-tokens.ts > "$S/lint3b.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$S/sym3b.log" 2>&1; echo "EXIT=$?"
for f in src/app/chat-tools.ts src/app/use-register-tools.ts src/app/chat-tool-defs.ts src/app/chat-proposal.ts src/app/action-escalate.ts src/app/raid-escalation.ts src/app/note-log.ts; do node -e "console.log(require('fs').readFileSync('$f','utf8').split('\n').length, '$f')"; done
```

Expected:
- `EXIT=0` for all four commands, with `Test Files  22 passed (22)` — a lower count means a path was dropped.
- `0` tsc errors.
- Every measured size is under 1600.
- `note-log-panel.test.tsx` and `use-notes-window.test.tsx` stay green: the `addNote` widening is behaviour-neutral for the notes window.
- `plan.offered-surface-sweep.test.ts` stays green with `AXIS_BASELINE.raid` unchanged — the proof that the update tool's offered surface did not move.

Known limits (already in the code comments above; no action):
- Deviation 15 applies to the AI writer too: a same-tick concurrent SEVERITY write is overwritten by the planned step. If the row is deleted between the ref read and the updater, the updater writes nothing while the log row and undo entry are still emitted — the same exposure as `handleEscalate`.
- A staged `escalate_raid_item` row shows the tool name as its title and no diff (`proposalRowTitle` falls back to `call.name`), as `send_inquiry` does.
- Deviation 20: undo reverts the escalation entry and the severity, but the note echo stays (`noteLog` is write-through across undo, §50). Pinned in both halves by the undo site.
- An "AI created" note has no `authorResourceId`, so `canEditNote` lets anyone edit it and `editNote` claims it for the editor, replacing the label with the editor's name when they have a directory resource. An editor with a `selfResourceId` whose resource was deleted claims it but keeps the "AI created" label.

- [ ] **Step 7: Commit** — stage the new file with `git add -- src/app/use-chat-dispatcher.escalate.test.tsx`, then write `$S/msg-task3b.txt`:

```
feat: let the AI assistant append a RAID escalation

New escalate_raid_item tool (id, expectedToken, toEmail, toName?) appends
exactly one RaidEscalation through the same planEscalation and
buildEscalationRecord the Escalate CTA uses: a note echo authored "AI
created" (never the user's own resource), a one-step severity raise, a
raid.escalated row (actor ai, no address), one functional setRaid with
undo capture. No email is sent. One call applies; two or more in a turn
stage. update_raid_item still refuses the raw escalations field; the
required token refuses a second escalation from the same read (§515).

Claude-Session: https://[session link removed]
```

```bash
git commit --only -F "$S/msg-task3b.txt" -- src/app/action-escalate.ts src/app/action-escalate.test.ts src/app/note-log.ts src/app/note-log.test.ts src/app/i18n.ts src/app/i18n.de.ts src/app/types.ts src/app/raid-escalation.ts src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/chat-tools.test.ts src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.escalate.test.tsx src/app/use-chat-dispatcher.undo.test.tsx src/app/chat-proposal.ts src/app/chat-proposal.test.ts src/app/chat-proposal-describe.test.ts src/app/chat-proposal-apply.ts src/app/chat-proposal-apply.test.tsx src/app/ai-entity-token.test.ts src/app/insights/recommend-tokens.ts lib/app-feature-guide.md src/app/operating-guide-builtin.generated.ts docs/AGENTS/ai-assistant.md docs/superpowers/plans/2026-09-13-raid-signal-log-escalation.md
git show --stat HEAD | tail -30
```

---

## Task 4: Display — "Last escalated" column + read-only Escalations list

**Files:**
- Modify:
  - `src/app/raid-panel-columns.ts` (`RAID_COL_WIDTHS`, `RAID_CONFIG_COLS`)
  - `src/app/raid.ts` (`RaidSortKey`, `raidSortValue`, `compareRaid`)
  - `src/app/raid-panel-rows.tsx` (header + cell)
  - `src/app/raid-panel.tsx` (`RAID_FILTER_DEFAULTS.hiddenCols`)
  - `src/app/raid-edit-modal.tsx` (Escalations list)
  - `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test:
  - `src/app/raid.test.ts` (new describe)
  - `src/app/raid-panel.test.tsx` (new describe + MIGRATE the `minControls: 34` count)
  - `src/app/raid-edit-modal.test.tsx` (new describe)

**Interfaces:**
- Consumes: `lastEscalation` (Task 2), `describeEscalation` (Task 3), `SortResizeTh` / `useSortHeaderProps<RaidSortKey>` (already in `raid-panel-rows.tsx`).
- Produces:
  - `RaidSortKey` gains `"lastEscalated"`
  - `RAID_COL_WIDTHS.lastEscalated = 170`
  - `RAID_CONFIG_COLS` gains `{ key: "lastEscalated", labelKey: "raidColLastEscalated" }`
  - The column is hidden by default through `RAID_FILTER_DEFAULTS.hiddenCols: ["lastEscalated"]`. Panel filter state is `useState(defaults)` in `panel-filters-context.tsx` and is not persisted per device.

- [ ] **Step 1: i18n keys**

`src/app/i18n.ts`: replace `  raidNewItem: "New RAID item",` with:

```ts
  raidNewItem: "New RAID item",
  raidColLastEscalated: "Last escalated",
  raidEscalationsTitle: "Escalations",
```

`$S/de-task4.json` (Write tool):

```json
[
  { "after": "  raidNewItem: ", "lines": [
    "  raidColLastEscalated: \"Zuletzt eskaliert\",",
    "  raidEscalationsTitle: \"Eskalationen\","
  ] }
]
```

```bash
node "$S/patch-de.mjs" "$S/de-task4.json"; echo "EXIT=$?"
```

Expected: `patched; LF-only line ends: 0`, then `EXIT=0`.

- [ ] **Step 2: Write the failing tests**

(a) Append to `src/app/raid.test.ts`:

```ts
describe("compareRaid — lastEscalated (§515)", () => {
  const mk = (id: number, ...ats: string[]): import("./types").RaidItem => ({
    id, category: "I", title: `I${id}`, status: "Open", linkedTaskIds: [], causedByRaidIds: [],
    stakeholderIds: [], raisedDate: "2026-01-01",
    ...(ats.length ? { escalations: ats.map((at) => ({ at, toEmail: "x@example.com" })) } : {}),
  });

  it("sorts by the LATEST escalation and puts never-escalated items last in both directions", () => {
    const items = [mk(1), mk(2, "2026-03-01T00:00:00.000Z"), mk(3, "2026-01-01T00:00:00.000Z")];
    const ids = (dir: "asc" | "desc") => [...items].sort((a, b) => compareRaid(a, b, "lastEscalated", dir)).map((r) => r.id);
    expect(ids("asc")).toEqual([3, 2, 1]);
    expect(ids("desc")).toEqual([2, 3, 1]);
  });

  it("reads the newest entry, not the first", () => {
    const early = mk(1, "2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z");
    const mid = mk(2, "2026-03-01T00:00:00.000Z");
    expect(compareRaid(early, mid, "lastEscalated", "asc")).toBeGreaterThan(0);
  });
});
```

If `compareRaid` is not already imported in `raid.test.ts` (`grep -n "compareRaid" src/app/raid.test.ts | head -2`), add it to the existing `from "./raid"` import list.

(b) `src/app/raid-panel.test.tsx`:
- MIGRATE the column-config scan: replace

```ts
      // 12 checkboxes. The 10 extra checkboxes are RAID_CONFIG_COLS' toggles.
```

  with

```ts
      // 13 checkboxes. The 11 extra checkboxes are RAID_CONFIG_COLS' toggles
      // (11 since §515 added "Last escalated").
```

  and replace `      minControls: 34,` with `      minControls: 35,`.
- Append:

```ts
describe("RaidPanel — Last escalated column (§515)", () => {
  const escalated = makeRaidItem({
    id: 9, title: "Rate limit", severity: "High",
    escalations: [{ at: "2026-05-20T09:30:00.000Z", toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com", fromSeverity: "Medium", toSeverity: "High" }],
  });

  it("is hidden by default and can be switched on from the column config", () => {
    renderPanel(makeProps({ raid: [escalated] }));
    // Positive control: the table header row is rendered.
    expect(screen.getByRole("button", { name: /^Severity( [▲▼])?$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Last escalated( [▲▼])?$/ })).toBeNull();
    expect(screen.queryByText("2026-05-20 · Sam Placeholder")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
    const toggle = screen.getByRole("checkbox", {
      name: t("en-US", "colConfigToggleColumn", t("en-US", "raidColLastEscalated")),
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: /^Last escalated( [▲▼])?$/ })).toBeTruthy();
    expect(screen.getByText("2026-05-20 · Sam Placeholder")).toBeTruthy();
  });
});
```

(c) Append to `src/app/raid-edit-modal.test.tsx`:

```ts
describe("RaidEditModal — Escalations list (§515)", () => {
  it("lists each escalation, oldest first, when the item has any", () => {
    render(
      modalEl({
        category: "I",
        escalations: [
          { at: "2026-05-20T09:30:00.000Z", toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com", fromSeverity: "Medium", toSeverity: "High" },
          { at: "2026-05-22T14:00:00.000Z", toEmail: "ops@example.com" },
        ],
      }),
      { wrapper },
    );
    expect(screen.getByText(t("en-US", "raidEscalationsTitle"))).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const mine = items.filter((s) => s.startsWith("2026-05-2"));
    expect(mine).toEqual([
      `2026-05-20 · ${t("en-US", "raidEscalationNoteRaised", "Sam Placeholder <Fictional.Jordan@example.com>", "Medium", "High")}`,
      "2026-05-22 · Escalated to ops@example.com (notify only)",
    ]);
  });

  it("renders no Escalations section for an item never escalated", () => {
    render(modalEl({}), { wrapper });
    // Positive control: the modal body rendered (the Notes log button is always there).
    expect(screen.getByRole("button", { name: /^Notes log/ })).toBeTruthy();
    expect(screen.queryByText(t("en-US", "raidEscalationsTitle"))).toBeNull();
  });
});
```

The first expectation passes the raw `"Medium"`/`"High"` because `severityLabel` returns the same text in en-US. If that assertion fails only on those two words, replace them with `severityLabel("Medium", "en-US")` / `severityLabel("High", "en-US")` imported from `./raid-labels`; do not change the implementation.

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run src/app/raid.test.ts src/app/raid-panel.test.tsx src/app/raid-edit-modal.test.tsx --maxWorkers=1 --reporter=dot > "$S/t4a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t4a.log" | head
```

Expected: `EXIT=1`.
- tsc-level `"lastEscalated"` is not a `RaidSortKey` (vitest does not typecheck, so the sort test fails by order instead).
- No `raidColLastEscalated` checkbox is found.
- The `minControls` scan still counts 34.
- No Escalations text is found.

- [ ] **Step 4: Implement**

`src/app/raid-panel-columns.ts`, in two edits:
1. Replace `  notesLog: 80,\n} as const;` with `  notesLog: 80,\n  lastEscalated: 170,\n} as const;`.
2. Replace `  { key: "notesLog", labelKey: "noteLogTitle" },\n];` with:

```ts
  { key: "notesLog", labelKey: "noteLogTitle" },
  // §515 — hidden by default (RAID_FILTER_DEFAULTS in raid-panel.tsx).
  { key: "lastEscalated", labelKey: "raidColLastEscalated" },
];
```

`src/app/raid.ts`, in three edits:
1. Replace `  | "owner"\n  | "targetDate";` with `  | "owner"\n  | "targetDate"\n  | "lastEscalated";`.
2. In `raidSortValue`, replace `    case "targetDate":\n      return item.targetDate ?? "";\n  }` with:

```ts
    case "targetDate":
      return item.targetDate ?? "";
    case "lastEscalated":
      return lastEscalation(item)?.at ?? "";
  }
```

3. In `compareRaid`, replace

```ts
  if (key === "targetDate") {
    const av = a.targetDate ?? "";
    const bv = b.targetDate ?? "";
```

   with

```ts
  if (key === "targetDate" || key === "lastEscalated") {
    const av = String(raidSortValue(a, key, resourcesById));
    const bv = String(raidSortValue(b, key, resourcesById));
```

   Then extend the doc comment line `Missing `targetDate` always sorts LAST,` to read `Missing `targetDate` / never-escalated items always sort LAST,`, and add `import { lastEscalation } from "./raid-escalation";` below `raid.ts`'s last existing import line. Check for a cycle first: `grep -n "from \"./raid\"" src/app/raid-escalation.ts` must print nothing.

`src/app/raid-panel-rows.tsx`, in three edits:
1. Add `import { lastEscalation } from "./raid-escalation";` directly below `import { RAID_CONFIG_COLS, RAID_COL_WIDTHS } from "./raid-panel-columns";`.
2. Header: replace

```tsx
            <ColumnResizeHandle col="notesLog" onMouseDown={startResize} />
          </th>
          )}
        </tr>
```

   with

```tsx
            <ColumnResizeHandle col="notesLog" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("lastEscalated") && (
            <SortResizeTh {...th} label={t(lang, "raidColLastEscalated")} sortCol="lastEscalated" width={colWidths.lastEscalated} />
          )}
        </tr>
```

3. Cell: replace

```tsx
                  onClick={() => onOpenNotes(item.id)}
                />
              </td>
              )}
            </tr>
```

   with

```tsx
                  onClick={() => onOpenNotes(item.id)}
                />
              </td>
              )}
              {!hiddenSet.has("lastEscalated") && (
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {(() => {
                  const last = lastEscalation(item);
                  return last ? `${last.at.slice(0, 10)} · ${last.toName ?? last.toEmail}` : "";
                })()}
              </td>
              )}
            </tr>
```

`src/app/raid-panel.tsx`: in `RAID_FILTER_DEFAULTS`, replace `  hiddenCols: [],\n};` with `  hiddenCols: ["lastEscalated"],\n};`.

`src/app/raid-edit-modal.tsx`, in two edits:
1. Add `import { describeEscalation } from "./action-escalate";` directly below `import { isRaidActiveForReview } from "./raid-review";`, and `import { sanitizeRaidEscalations } from "./raid-escalation";` directly below that.
2. Replace the Notes-button block's end

```tsx
              {t(lang, "noteLogTitle")} ({draft.noteLog?.length ?? 0})
            </Button>
          </div>
```

   with

```tsx
              {t(lang, "noteLogTitle")} ({draft.noteLog?.length ?? 0})
            </Button>
          </div>

          {/* §515 — read-only escalation record, written by the Next-actions
              Escalate CTA. Re-validated: JSON/IndexedDB rows skip the sanitizer. */}
          {sanitizeRaidEscalations(draft.escalations).length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-foreground">{t(lang, "raidEscalationsTitle")}</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {sanitizeRaidEscalations(draft.escalations).map((e, i) => (
                  <li key={`${e.at}-${i}`}>{`${e.at.slice(0, 10)} · ${describeEscalation(lang, e)}`}</li>
                ))}
              </ul>
            </div>
          )}
```

- [ ] **Step 5: Run tests and gates**

```bash
npx vitest run src/app/raid.test.ts src/app/raid.property.test.ts src/app/raid-panel.test.tsx src/app/raid-edit-modal.test.tsx src/app/i18n-encoding.test.ts --maxWorkers=1 --reporter=dot > "$S/t4b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$S/t4b.log"
npx tsc --noEmit > "$S/tsc4.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc4.log"
npx eslint --max-warnings=0 src/app/raid-panel-columns.ts src/app/raid.ts src/app/raid-panel-rows.tsx src/app/raid-panel.tsx src/app/raid-edit-modal.tsx src/app/raid.test.ts src/app/raid-panel.test.tsx src/app/raid-edit-modal.test.tsx src/app/i18n.ts > "$S/lint4.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` for all three; `Test Files  5 passed (5)`; `0` tsc errors.

If `raid-panel.test.tsx` fails anywhere OTHER than the new describe or the migrated count, stop and report it — a hidden-by-default column must not move any existing assertion.

- [ ] **Step 6: Commit** — write `$S/msg-task4.txt`:

```
feat: show RAID escalations in the table and the edit modal

A sortable "Last escalated" column (hidden by default; never-escalated
items sort last) and a read-only Escalations list in the RAID editor,
rendered only when the item carries a record (§515).

Claude-Session: https://[session link removed]
```

```bash
git commit --only -F "$S/msg-task4.txt" -- src/app/raid-panel-columns.ts src/app/raid.ts src/app/raid-panel-rows.tsx src/app/raid-panel.tsx src/app/raid-edit-modal.tsx src/app/raid.test.ts src/app/raid-panel.test.tsx src/app/raid-edit-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git show --stat HEAD | tail -12
```

---

## Task 5: `handleSaveRaidItem` returns the committed id + the Log-as-RAID host + next-actions entry

**Files:**
- Create: `src/app/raid-create-host.tsx`, `src/app/raid-create-host.test.tsx`, `src/app/raid-create-host.jump.test.tsx`
- Modify:
  - `src/app/use-resource-planner.ts` (`handleSaveRaidItem` return value)
  - `src/app/workspace-section-types.ts` (`handleSaveRaidItem` return type, new `onLogAsRaid`)
  - `src/app/next-actions/action-cta.ts` (`ActionCaps.logAsRaid`, `SecondaryCtaKind`, `canLogAsRaid`, `overflowCtas`)
  - `src/app/action-cta-controls.tsx` (`ActionHandlers.onLogAsRaid`, `useActionCaps`, `ActionOverflowMenu` item)
  - `src/app/actions-panel.tsx` (prop + `rowProps`)
  - `src/app/workspace-section.tsx` (destructure + `ActionsPanel` prop)
  - `src/app/task-manager.tsx` (import, `useRaidCreate` call, `workspaceProps.onLogAsRaid`, `<RaidCreateHost>` mount)
  - `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test:
  - `src/app/use-resource-planner.test.tsx` (new describe)
  - `src/app/next-actions/action-cta.test.ts` (MIGRATE `ALL`/`NONE` and two exact overflow arrays; new describe)
  - `src/app/action-row.test.tsx` (new describe)
  - `src/app/action-hero-card.test.tsx` (new case)
  - `src/app/task-manager.characterization.test.tsx` (COPY: add `"onLogAsRaid"` to the action-center key list)

`ActionRow` and `ActionHeroCard` need no edit: `interface ActionRowProps extends ActionHandlers` and `interface ActionHeroCardProps extends ActionHandlers`, and both pass `handlers={props}` to `ActionOverflowMenu`.

**Interfaces:**
- Consumes:
  - `buildNewRaidDraft`, `applyStatus`, `applyMatrix`, `buildRaidSeedFromSignal` (Task 1)
  - `RaidEditModal` / `RaidEditModalProps`
  - `ACTION_SOURCE_LABEL` (`./action-source-label`)
  - `OutcomeType` (`./action-learning`)
  - `requestOpen(view, id)` from `useWorkspaceTab()` (already destructured in `task-manager.tsx`)
- Produces:
  - `handleSaveRaidItem(item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }): number | undefined`
  - `canLogAsRaid(a: SuggestedAction, c: ActionCaps): boolean` = `c.logAsRaid && a.source !== "raid"`
  - `ActionHandlers.onLogAsRaid?: (action: SuggestedAction) => void`
  - `type RaidCreateOrigin = { kind: "action"; action: SuggestedAction }` (Task 6 widens this to a union)
  - `interface RaidCreateRequest { draft: RaidItem; origin: RaidCreateOrigin }`
  - `interface RaidCreateDeps { isPopout; lang; today; raid; handleSaveRaidItem; recordLearning }`
  - `interface RaidCreateController { request; openFromAction; setDraft; applyDraftStatus; applyDraftMatrix; commit; cancel }`
  - `useRaidCreate(deps: RaidCreateDeps): RaidCreateController`
  - `RaidCreateHost(props: RaidCreateHostProps)`

- [ ] **Step 1: i18n key**

`src/app/i18n.ts`: replace `  actionCreateTask: "Create task",` with:

```ts
  actionCreateTask: "Create task",
  actionLogAsRaid: "Log as RAID",
```

`$S/de-task5.json`:

```json
[
  { "after": "  actionCreateTask: ", "lines": [
    "  actionLogAsRaid: \"Als RAID erfassen\","
  ] }
]
```

```bash
node "$S/patch-de.mjs" "$S/de-task5.json"; echo "EXIT=$?"
```

Expected: `patched; LF-only line ends: 0`, then `EXIT=0`.

- [ ] **Step 2: Write the failing tests**

(a) Append to `src/app/use-resource-planner.test.tsx`:

```ts
describe("handleSaveRaidItem — returns the committed id (§515)", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });
  const draft = (over: Partial<RaidItem> = {}): RaidItem => ({
    id: 1, category: "R", title: "New risk", status: "Open", linkedTaskIds: [],
    causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-20", ...over,
  });

  it("returns the id of a plain create", () => {
    const { result } = renderPlanner();
    let id: number | undefined;
    act(() => { id = result.current.planner.handleSaveRaidItem(draft(), true); });
    expect(id).toBe((result.current.workspace.raid[0] as RaidItem).id);
  });

  it("returns the RE-MINTED id when the open-time id was taken before Save", () => {
    const { result } = renderPlanner();
    // The draft was opened with id 1 against an empty register; a concurrent
    // writer then committed its own row under that same id before Save.
    act(() => { result.current.workspace.setRaid([draft({ title: "Concurrent" })]); });
    let id: number | undefined;
    act(() => { id = result.current.planner.handleSaveRaidItem(draft(), true); });
    const rows = result.current.workspace.raid as RaidItem[];
    expect(rows.map((r) => r.title)).toEqual(["Concurrent", "New risk"]);
    expect(id).not.toBe(1);
    expect(id).toBe(rows.find((r) => r.title === "New risk")?.id);
  });

  // REGRESSION PIN — passes before this task too (a bare `return;` is already undefined).
  // The red-before-fix tests are the two above: a create returns nothing today.
  it("returns undefined when an edited row vanished (positive control: the write is refused)", () => {
    const { result, showToast } = renderPlanner();
    let id: number | undefined = -1;
    act(() => { id = result.current.planner.handleSaveRaidItem(draft({ id: 99 }), false); });
    expect(id).toBeUndefined();
    expect(result.current.workspace.raid).toHaveLength(0);
    expect(showToast).toHaveBeenCalled();
  });
});
```

(b) `src/app/next-actions/action-cta.test.ts`:
- Import: change `import { pickPrimaryCta, overflowCtas, type ActionCaps } from "./action-cta";` to `import { canLogAsRaid, pickPrimaryCta, overflowCtas, type ActionCaps } from "./action-cta";`.
- MIGRATE the fixtures:
  - In `ALL`, replace `snooze: true, createTask: true,` with `snooze: true, createTask: true, logAsRaid: true,`.
  - In `NONE`, replace `snooze: false, createTask: false,` with `snooze: false, createTask: false, logAsRaid: false,`.
- MIGRATE exact overflow arrays (both inputs now qualify for `logAsRaid` under `ALL`):
  - `expect(o).toEqual(["markDone", "draft", "snooze"]);` becomes `expect(o).toEqual(["markDone", "draft", "logAsRaid", "snooze"]);`.
  - `expect(overflowCtas(tasksFor, ALL)).toEqual(["createTask", "snooze"]);` becomes `expect(overflowCtas(tasksFor, ALL)).toEqual(["createTask", "logAsRaid", "snooze"]);`.
  - Rename that test's title `"offers only createTask + snooze - the task verbs need a task id"` to `"offers only createTask + logAsRaid + snooze - the task verbs need a task id"`.
- Append:

```ts
describe("canLogAsRaid (§515)", () => {
  it("is offered for a non-RAID signal when the handler is wired", () => {
    expect(canLogAsRaid(a("task-due", "actionTaskWhyOverdue"), { ...NONE, logAsRaid: true })).toBe(true);
  });
  it("is never offered for a RAID-sourced action — it already is one", () => {
    expect(canLogAsRaid(a("raid", "actionRaidWhySeverity", "raid"), ALL)).toBe(false);
  });
  it("needs the capability (popout: handler absent)", () => {
    expect(canLogAsRaid(a("task-due", "actionTaskWhyOverdue"), NONE)).toBe(false);
  });
  it("sits in the overflow after createTask and before snooze", () => {
    expect(overflowCtas(a("milestone", "actionMilestoneWhyAtRisk", "milestones"), { ...NONE, createTask: true, logAsRaid: true, snooze: true }))
      .toEqual(["createTask", "logAsRaid", "snooze"]);
  });
});
```

(c) Append to `src/app/action-row.test.tsx`:

```ts
describe("ActionRow — Log as RAID (§515)", () => {
  const taskAction: SuggestedAction = {
    id: "task-attention:3:unassigned", source: "task-attention",
    title: { key: "actionRaidTitle", params: [3, "Unowned work"] },
    why: { key: "actionTaskWhyUnassigned" },
    score: 20, tier: "soon", cta: { kind: "open", view: "open-points", id: 3 },
  };

  it("offers Log as RAID in the overflow and fires the handler with the action", () => {
    const onLogAsRaid = vi.fn();
    const { getByRole } = render(<ActionRow rowToken="Row" lang="en-US" action={taskAction} onOpen={() => {}} onLogAsRaid={onLogAsRaid} />);
    fireEvent.click(getByRole("button", { name: /^More actions – Row$/ }));
    fireEvent.click(getByRole("button", { name: "Log as RAID" }));
    expect(onLogAsRaid).toHaveBeenCalledWith(taskAction);
  });

  it("does not offer it for a RAID-sourced action (positive control: snooze is in the same menu)", () => {
    const { getByRole, queryByRole } = render(
      <ActionRow rowToken="Row" lang="en-US" action={action} onOpen={() => {}} onSnooze={() => {}} onLogAsRaid={vi.fn()} />,
    );
    fireEvent.click(getByRole("button", { name: /^More actions – Row$/ }));
    expect(getByRole("button", { name: "1 hour" })).toBeTruthy();
    expect(queryByRole("button", { name: "Log as RAID" })).toBeNull();
  });

  it("does not offer it when no handler is wired, as in a popout (positive control: snooze)", () => {
    const { getByRole, queryByRole } = render(
      <ActionRow rowToken="Row" lang="en-US" action={taskAction} onOpen={() => {}} onSnooze={() => {}} />,
    );
    fireEvent.click(getByRole("button", { name: /^More actions – Row$/ }));
    expect(getByRole("button", { name: "1 hour" })).toBeTruthy();
    expect(queryByRole("button", { name: "Log as RAID" })).toBeNull();
  });
});
```

(d) In `src/app/action-hero-card.test.tsx`, add inside the existing `describe("ActionHeroCard", …)` block, directly after its first `it(…)` (the "renders the eyebrow" case):

```ts
  it("offers Log as RAID in the hero's overflow for a non-RAID signal (§515)", () => {
    const slip = {
      ...noOwner, id: "milestone:4:atrisk", source: "milestone",
      why: { key: "actionMilestoneWhyAtRisk" }, cta: { kind: "open", view: "milestones", id: 4 },
    } as never as SuggestedAction;
    const onLogAsRaid = vi.fn();
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(slip)} onOpen={() => {}} onLogAsRaid={onLogAsRaid} />);
    fireEvent.click(screen.getByRole("button", { name: /^More actions – Row$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log as RAID" }));
    expect(onLogAsRaid).toHaveBeenCalledWith(slip);
  });
```

(e) `src/app/task-manager.characterization.test.tsx`: in the `"threads the action-center handler bundles …"` key list, replace `      "onDraftMessage",\n    ]) {` with `      "onDraftMessage",\n      "onLogAsRaid",\n    ]) {`.

(f) Create `src/app/raid-create-host.test.tsx`:

```tsx
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RaidCreateHost, useRaidCreate, type RaidCreateDeps } from "./raid-create-host";
import { t } from "./i18n";
import type { SuggestedAction } from "./next-actions";
import type { RaidItem } from "./types";

const slip: SuggestedAction = {
  id: "milestone:4:atrisk", source: "milestone",
  title: { key: "actionRaidTitle", params: [4, "Go-live"] },
  why: { key: "actionMilestoneWhyAtRisk" },
  score: 50, tier: "now", cta: { kind: "open", view: "milestones", id: 4 },
} as never;

function deps(over: Partial<RaidCreateDeps> = {}): RaidCreateDeps {
  return {
    isPopout: false,
    lang: "en-US",
    today: "2026-06-20",
    raid: [],
    handleSaveRaidItem: vi.fn(() => 1),
    recordLearning: vi.fn(async () => {}),
    ...over,
  };
}

describe("useRaidCreate — action origin (§515)", () => {
  it("opens a Risk draft seeded from the action", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    const d = result.current.request!.draft;
    expect(d.category).toBe("R");
    expect(d.raisedDate).toBe("2026-06-20");
    expect(d.title).toBe(t("en-US", "actionRaidTitle", 4, "Go-live"));
    expect(d.description).toContain("From:");
  });

  it("saves with isNew=true, records learning, then closes", () => {
    const handleSaveRaidItem = vi.fn(() => 12);
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, recordLearning })));
    act(() => result.current.openFromAction!(slip));
    const item: RaidItem = { ...result.current.request!.draft, title: "Go-live slipping" };
    act(() => result.current.commit(item));
    expect(handleSaveRaidItem).toHaveBeenCalledWith(item, true);
    expect(recordLearning).toHaveBeenCalledWith(slip, "acted");
    expect(result.current.request).toBeNull();
  });

  it("Cancel changes nothing", () => {
    const handleSaveRaidItem = vi.fn(() => 12);
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, recordLearning })));
    act(() => result.current.openFromAction!(slip));
    expect(result.current.request).not.toBeNull(); // positive control
    act(() => result.current.cancel());
    expect(result.current.request).toBeNull();
    expect(handleSaveRaidItem).not.toHaveBeenCalled();
    expect(recordLearning).not.toHaveBeenCalled();
  });

  it("ignores an empty title and keeps the draft open when the save is refused", () => {
    const handleSaveRaidItem = vi.fn(() => undefined);
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, recordLearning })));
    act(() => result.current.openFromAction!(slip));
    act(() => result.current.commit({ ...result.current.request!.draft, title: "   " }));
    expect(handleSaveRaidItem).not.toHaveBeenCalled();
    act(() => result.current.commit({ ...result.current.request!.draft, title: "Real" }));
    expect(handleSaveRaidItem).toHaveBeenCalledTimes(1);
    expect(recordLearning).not.toHaveBeenCalled();
    expect(result.current.request).not.toBeNull();
  });

  it("applies status and matrix edits to the draft", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    act(() => result.current.applyDraftMatrix(5, 5));
    expect(result.current.request!.draft).toMatchObject({ probability: 5, impact: 5 });
  });

  it("exposes no opener in a popout", () => {
    const { result } = renderHook(() => useRaidCreate(deps({ isPopout: true })));
    expect(result.current.openFromAction).toBeUndefined();
  });
});

describe("RaidCreateHost", () => {
  it("renders nothing without a request", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    const { container } = render(
      <RaidCreateHost
        create={result.current} lang="en-US" tasks={[]} raid={[]} stakeholdersEnabled stakeholders={[]}
        resources={[]} contacts={[]} onCreateResource={() => 1} onJumpToRaid={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("floats RaidEditModal as a NEW item seeded from the request", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromAction!(slip));
    render(
      <RaidCreateHost
        create={result.current} lang="en-US" tasks={[]} raid={[]} stakeholdersEnabled stakeholders={[]}
        resources={[]} contacts={[]} onCreateResource={() => 1} onJumpToRaid={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText(t("en-US", "raidNewItem"))).toBeTruthy();
    expect(screen.getByDisplayValue(t("en-US", "actionRaidTitle", 4, "Go-live"))).toBeTruthy();
  });
});
```

For that last case, extend the imports of `raid-create-host.test.tsx`:
- `import { act, render, renderHook, screen } from "@testing-library/react";`
- `import { beforeAll, describe, expect, it, vi } from "vitest";`
- `import type { ReactNode } from "react";`
- `import { FiltersProvider } from "./filters-context";`
- `import { WorkspaceProvider } from "./workspace-context";`

Then add, above the first `describe`, the same jsdom stubs and wrapper `raid-edit-modal.test.tsx` uses:

```tsx
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}
```

If the modal throws for a missing provider or hook, copy the exact providers and `vi.mock`s `raid-edit-modal.test.tsx` renders with. Do not change the host.

(g) Create `src/app/raid-create-host.jump.test.tsx`. It is a separate file because it replaces `RaidEditModal` with a prop-capturing stub, which the real-modal case above cannot share:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidEditModalProps } from "./raid-edit-modal";
import type { RaidItem } from "./types";

const captured: { props: RaidEditModalProps | null } = { props: null };
vi.mock("./raid-edit-modal", () => ({
  RaidEditModal: (props: RaidEditModalProps) => {
    captured.props = props;
    return null;
  },
}));

import { RaidCreateHost, type RaidCreateController } from "./raid-create-host";

const draft: RaidItem = {
  id: 1, category: "R", title: "", status: "Open", linkedTaskIds: [], causedByRaidIds: [],
  stakeholderIds: [], raisedDate: "2026-06-20",
};

describe("RaidCreateHost — jump to an existing RAID item", () => {
  it("closes the host FIRST, then forwards the id to onJumpToRaid", () => {
    const cancel = vi.fn();
    const onJumpToRaid = vi.fn();
    const create = {
      request: { draft, origin: { kind: "action", action: {} as never } },
      setDraft: vi.fn(), applyDraftStatus: vi.fn(), applyDraftMatrix: vi.fn(), commit: vi.fn(), cancel,
    } as unknown as RaidCreateController;
    render(
      <RaidCreateHost
        create={create} lang="en-US" tasks={[]} raid={[]} stakeholdersEnabled stakeholders={[]}
        resources={[]} contacts={[]} onCreateResource={() => 1} onJumpToRaid={onJumpToRaid}
      />,
    );
    expect(captured.props?.isNew).toBe(true); // positive control: the stub received the host's props
    captured.props!.onJumpToRaid(5);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onJumpToRaid).toHaveBeenCalledWith(5);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(onJumpToRaid.mock.invocationCallOrder[0]);
  });
});
```

`task-manager.tsx` binds `onJumpToRaid={(id) => requestOpen("raid", id)}`. No unit harness mounts that JSX; it is covered by tsc plus the Task 8 eye-verify, and the host test pins everything below that binding.

The id-mint race is pinned at the planner (a) and, in Task 6, through the insight link. The host itself is only responsible for forwarding the RETURNED id, never `draft.id`; the `12` vs draft-id `1` assertion in Task 6 pins that.

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run src/app/use-resource-planner.test.tsx src/app/next-actions/action-cta.test.ts src/app/action-row.test.tsx src/app/action-hero-card.test.tsx src/app/raid-create-host.test.tsx --maxWorkers=1 --reporter=dot > "$S/t5a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t5a.log" | head -12
```

Expected: `EXIT=1`.
- `handleSaveRaidItem` returns `undefined` for creates.
- `canLogAsRaid` is not a function.
- "Log as RAID" is not found.
- `./raid-create-host` is unresolvable.

The characterization test is run in Step 5, after the wiring.

- [ ] **Step 4: Implement**

`src/app/use-resource-planner.ts` (`handleSaveRaidItem`), in three edits:
1. Replace `    (item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => {` with `    (item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }): number | undefined => {`. Verify it is unique first: `grep -c "opts?: { suppressFieldUndo?: boolean }) => {" src/app/use-resource-planner.ts` → count the hits and edit only the one inside `handleSaveRaidItem`.
2. Replace

```ts
        reportSilentFailure(showToastRef.current, langRef.current, "raid.editVanished", "concurrent delete during edit", "guardEditVanished");
        return;
```

   with

```ts
        reportSilentFailure(showToastRef.current, langRef.current, "raid.editVanished", "concurrent delete during edit", "guardEditVanished");
        return undefined;
```

3. Replace

```ts
      if (autoIssueId !== null) {
        logActivityRef.current("raid.autoIssue", id, autoIssueId);
      }
    },
    [raid, setRaid, today, logUpdate],
```

   with

```ts
      if (autoIssueId !== null) {
        logActivityRef.current("raid.autoIssue", id, autoIssueId);
      }
      // The COMMITTED id — re-minted by `resolveEntitySave` when the open-time id
      // was taken. "Log as RAID" links the insight to THIS, never to draft.id (§515).
      return id;
    },
    [raid, setRaid, today, logUpdate],
```

`src/app/workspace-section-types.ts`, in two edits:
1. Replace `  handleSaveRaidItem: (item: RaidItem, isNew?: boolean) => void;` with:

```ts
  /** Returns the committed id (re-minted on an id collision), or undefined when refused. */
  handleSaveRaidItem: (item: RaidItem, isNew?: boolean) => number | undefined;
```

2. Replace the FIRST (pane-contract) occurrence of `  onClearBlocker?: (action: SuggestedAction) => void;` (the file has exactly one — verify with `grep -c` → 1) with:

```ts
  onClearBlocker?: (action: SuggestedAction) => void;
  /** "Log as RAID" (§515): opens the floating RAID editor seeded from the action. Undefined in popouts. */
  onLogAsRaid?: (action: SuggestedAction) => void;
```

`src/app/next-actions/action-cta.ts`, in four edits:
1. Replace `export type SecondaryCtaKind = "markDone" | "draft" | "createTask" | "snooze";` with `export type SecondaryCtaKind = "markDone" | "draft" | "createTask" | "logAsRaid" | "snooze";`.
2. Replace `  createTask: boolean;    // onCreateTask present\n}` with:

```ts
  createTask: boolean;    // onCreateTask present
  logAsRaid: boolean;     // onLogAsRaid present (§515)
}
```

3. Replace `export function canCreateTask(a: SuggestedAction, c: ActionCaps): boolean {\n  return c.createTask && a.source !== "task-due";\n}` with:

```ts
export function canCreateTask(a: SuggestedAction, c: ActionCaps): boolean {
  return c.createTask && a.source !== "task-due";
}
/** §515 — any signal EXCEPT a RAID-sourced one, which already is a RAID item. */
export function canLogAsRaid(a: SuggestedAction, c: ActionCaps): boolean {
  return c.logAsRaid && a.source !== "raid";
}
```

4. Replace `  if (canCreateTask(a, c)) out.push("createTask");` with:

```ts
  if (canCreateTask(a, c)) out.push("createTask");
  if (canLogAsRaid(a, c)) out.push("logAsRaid");
```

`src/app/action-cta-controls.tsx`, in three edits:
1. Replace `  onCreateTask?: (action: SuggestedAction) => void;\n  assignOwner?: AssignOwnerBundle;` with:

```ts
  onCreateTask?: (action: SuggestedAction) => void;
  /** "Log as RAID" (§515) — overflow item; absent in popouts. */
  onLogAsRaid?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
```

2. Replace `    createTask: h.onCreateTask != null,\n  };` with `    createTask: h.onCreateTask != null,\n    logAsRaid: h.onLogAsRaid != null,\n  };`.
3. Replace

```tsx
            if (k === "createTask" && handlers.onCreateTask) return item(t(lang, "actionCreateTask"), () => handlers.onCreateTask!(action));
```

   with

```tsx
            if (k === "createTask" && handlers.onCreateTask) return item(t(lang, "actionCreateTask"), () => handlers.onCreateTask!(action));
            if (k === "logAsRaid" && handlers.onLogAsRaid) return item(t(lang, "actionLogAsRaid"), () => handlers.onLogAsRaid!(action));
```

`src/app/actions-panel.tsx`, in three edits:
1. Replace `  onClearBlocker?: (action: SuggestedAction) => void;\n  learningEnabled?: boolean;` with:

```ts
  onClearBlocker?: (action: SuggestedAction) => void;
  onLogAsRaid?: (action: SuggestedAction) => void;
  learningEnabled?: boolean;
```

2. In the `ActionsPanel` parameter destructure, replace `onMarkDone, onClearBlocker, learningEnabled,` with `onMarkDone, onClearBlocker, onLogAsRaid, learningEnabled,`.
3. In `rowProps`, replace `    onDraftMessage, escalate, rebaseline, reschedule, onMarkDone, onClearBlocker,\n  };` with `    onDraftMessage, escalate, rebaseline, reschedule, onMarkDone, onClearBlocker, onLogAsRaid,\n  };`.

`src/app/workspace-section.tsx`, in two edits:
1. Replace `  onClearBlocker,\n  learningEnabled,` (the component destructure) with `  onClearBlocker,\n  onLogAsRaid,\n  learningEnabled,`.
2. In the `ActionsPanel` JSX, replace `onClearBlocker={onClearBlocker} learningEnabled={learningEnabled}` with `onClearBlocker={onClearBlocker} onLogAsRaid={onLogAsRaid} learningEnabled={learningEnabled}`.

Create `src/app/raid-create-host.tsx`:

```tsx
"use client";

// "Log as RAID" host (§515). ONE floating RaidEditModal over whatever view is
// active, fed by next actions (and, from the insights slice, by insights).
// ★ The draft lives HERE, not in the RAID panel: that panel is mounted
//   unconditionally and never remounts, so a create request routed through it
//   would need an explicit consume/clear. Owning the draft beside the modal
//   removes the request channel entirely.
// ★★ Save passes the create INTENT (`isNew = true`) so a row a concurrent writer
//   committed under the open-time id is never replaced, and every on-saved
//   effect uses the id the save RETURNS — re-minted in exactly that case.

import { useCallback, useState } from "react";
import { type Lang, t } from "./i18n";
import { RaidEditModal } from "./raid-edit-modal";
import { applyMatrix, applyStatus, buildNewRaidDraft, buildRaidSeedFromSignal } from "./raid-draft";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import type { SuggestedAction } from "./next-actions";
import type { OutcomeType } from "./action-learning";
import type { RaidItem, RaidStatus, Resource, RiskScale, Stakeholder, Task } from "./types";
import type { Contact } from "./contacts";

export type RaidCreateOrigin = { kind: "action"; action: SuggestedAction };

export interface RaidCreateRequest {
  draft: RaidItem;
  origin: RaidCreateOrigin;
}

export interface RaidCreateDeps {
  isPopout: boolean;
  lang: Lang;
  today: string;
  raid: readonly RaidItem[];
  handleSaveRaidItem: (item: RaidItem, isNew?: boolean) => number | undefined;
  recordLearning: (action: SuggestedAction, type: OutcomeType) => Promise<void>;
}

export interface RaidCreateController {
  request: RaidCreateRequest | null;
  /** Undefined in popouts — every action CTA is. */
  openFromAction: ((action: SuggestedAction) => void) | undefined;
  setDraft: (next: RaidItem) => void;
  applyDraftStatus: (status: RaidStatus) => void;
  applyDraftMatrix: (probability: RiskScale, impact: RiskScale) => void;
  commit: (item: RaidItem) => void;
  cancel: () => void;
}

export function useRaidCreate(deps: RaidCreateDeps): RaidCreateController {
  const { isPopout, lang, today, raid, handleSaveRaidItem, recordLearning } = deps;
  const [request, setRequest] = useState<RaidCreateRequest | null>(null);

  const open = useCallback(
    (seed: { title: string; description: string }, origin: RaidCreateOrigin) => {
      const base = buildNewRaidDraft(raid, "R", today);
      setRequest({ draft: { ...base, title: seed.title, description: seed.description }, origin });
    },
    [raid, today],
  );

  const openFromAction = useCallback(
    (action: SuggestedAction) => {
      open(
        buildRaidSeedFromSignal({
          title: t(lang, action.title.key, ...(action.title.params ?? [])),
          note: t(
            lang,
            "actionCreatedFromNote",
            t(lang, ACTION_SOURCE_LABEL[action.source]),
            t(lang, action.why.key, ...(action.why.params ?? [])),
          ),
        }),
        { kind: "action", action },
      );
    },
    [open, lang],
  );

  const setDraft = useCallback((next: RaidItem) => {
    setRequest((r) => (r ? { ...r, draft: next } : r));
  }, []);
  const applyDraftStatus = useCallback(
    (status: RaidStatus) => setRequest((r) => (r ? { ...r, draft: applyStatus(r.draft, status, today) } : r)),
    [today],
  );
  const applyDraftMatrix = useCallback(
    (probability: RiskScale, impact: RiskScale) =>
      setRequest((r) => (r ? { ...r, draft: applyMatrix(r.draft, probability, impact) } : r)),
    [],
  );
  const cancel = useCallback(() => setRequest(null), []);

  const commit = useCallback(
    (item: RaidItem) => {
      if (!request || !item.title.trim()) return;
      const id = handleSaveRaidItem(item, true);
      // Defensive only: the host receives the UNGUARDED `handleSaveRaidItem`, and a create
      // never returns undefined (the editVanished refusal needs !create). Read-only
      // protection is structural — popouts never mount the host and get no openers.
      if (id === undefined) return;
      void recordLearning(request.origin.action, "acted");
      setRequest(null);
    },
    [request, handleSaveRaidItem, recordLearning],
  );

  return {
    request,
    openFromAction: isPopout ? undefined : openFromAction,
    setDraft,
    applyDraftStatus,
    applyDraftMatrix,
    commit,
    cancel,
  };
}

const NOOP = (): void => undefined;

export interface RaidCreateHostProps {
  create: RaidCreateController;
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  stakeholdersEnabled: boolean;
  stakeholders: readonly Stakeholder[];
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
  /** Deep-link to an existing RAID item; the host closes first (no side effects). */
  onJumpToRaid: (id: number) => void;
}

export function RaidCreateHost({
  create,
  lang,
  tasks,
  raid,
  stakeholdersEnabled,
  stakeholders,
  resources,
  contacts,
  onCreateResource,
  onJumpToRaid,
}: RaidCreateHostProps) {
  const { request } = create;
  if (!request) return null;
  return (
    <RaidEditModal
      lang={lang}
      tasks={tasks}
      raid={raid}
      stakeholdersEnabled={stakeholdersEnabled}
      stakeholders={stakeholders}
      resources={resources}
      contacts={contacts}
      onCreateResource={onCreateResource}
      draft={request.draft}
      isNew
      onChange={create.setDraft}
      onApplyStatus={create.applyDraftStatus}
      onApplyMatrix={create.applyDraftMatrix}
      onSave={create.commit}
      onCancel={create.cancel}
      // A new draft has nothing to delete and no saved id to spawn a task from;
      // the modal disables both controls while `isNew`.
      onDelete={NOOP}
      onCreateMitigationTask={NOOP}
      onJumpToRaid={(id) => {
        create.cancel();
        onJumpToRaid(id);
      }}
    />
  );
}
```

`src/app/task-manager.tsx`, in four edits:
1. Directly below `import { makeEditGuard } from "./read-only-guard";` add:

```ts
import { RaidCreateHost, useRaidCreate } from "./raid-create-host";
```

2. Replace (unique with the following comment line)

```ts
    logActivity: logActivityUser,
  });

  // Keep the forwarding ref current after every commit (it's only ever read
```

   with

```ts
    logActivity: logActivityUser,
  });

  // "Log as RAID" (§515): one floating RAID editor over the current view. Called
  // after useResourcePlanner (handleSaveRaidItem) and the learning hook
  // (recordLearning); openers are undefined in popouts.
  const raidCreate = useRaidCreate({ isPopout, lang, today, raid, handleSaveRaidItem, recordLearning });

  // Keep the forwarding ref current after every commit (it's only ever read
```

   Check first: `grep -c "    logActivity: logActivityUser," src/app/task-manager.tsx` prints 6, so match the three-line anchor above, which must be unique (`grep -c "// Keep the forwarding ref current after every commit"` → 1).
3. Replace `    onClearBlocker: isPopout ? undefined : handleClearBlockerFromAction,` with:

```ts
    onClearBlocker: isPopout ? undefined : handleClearBlockerFromAction,
    onLogAsRaid: raidCreate.openFromAction,
```

4. Replace `      {!isPopout && <NotesWindow {...notesWindowProps} />}` with:

```tsx
      {!isPopout && <NotesWindow {...notesWindowProps} />}
      {!isPopout && (
        <RaidCreateHost
          create={raidCreate}
          lang={lang}
          tasks={tasks}
          raid={raid}
          stakeholdersEnabled={stakeholdersEnabled}
          stakeholders={stakeholders}
          resources={resources}
          contacts={contactsList}
          onCreateResource={handleCreateResource}
          onJumpToRaid={(id) => requestOpen("raid", id)}
        />
      )}
```

- [ ] **Step 5: Run tests and gates**

```bash
npx vitest run src/app/use-resource-planner.test.tsx src/app/next-actions/action-cta.test.ts src/app/action-row.test.tsx src/app/action-hero-card.test.tsx src/app/raid-create-host.test.tsx src/app/raid-create-host.jump.test.tsx src/app/actions-panel.test.tsx src/app/workspace-section.test.tsx src/app/task-manager.characterization.test.tsx src/app/i18n-encoding.test.ts --maxWorkers=1 --reporter=dot > "$S/t5b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t5b.log" | head
npx tsc --noEmit > "$S/tsc5.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc5.log"
npx eslint --max-warnings=0 src/app/use-resource-planner.ts src/app/workspace-section-types.ts src/app/next-actions/action-cta.ts src/app/action-cta-controls.tsx src/app/actions-panel.tsx src/app/workspace-section.tsx src/app/task-manager.tsx src/app/raid-create-host.tsx src/app/raid-create-host.test.tsx src/app/raid-create-host.jump.test.tsx src/app/use-resource-planner.test.tsx src/app/next-actions/action-cta.test.ts src/app/action-row.test.tsx src/app/action-hero-card.test.tsx src/app/task-manager.characterization.test.tsx src/app/i18n.ts > "$S/lint5.log" 2>&1; echo "EXIT=$?"
npm run size:check > "$S/size5.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` for all four; `Test Files  10 passed (10)`; `0` tsc errors.

tsc flags any OTHER caller that constructs an `ActionCaps` literal (only `action-cta.test.ts` does today: `git grep -n "createTask: \(true\|false\)" -- src`). Add `logAsRaid` there, nowhere else.

- [ ] **Step 6: Commit** — write `$S/msg-task5.txt`:

```
feat: log a next action as a RAID item from its overflow menu

handleSaveRaidItem now returns the committed id (re-minted on an id
collision, undefined when refused). A new RaidCreateHost floats the RAID
editor over the current view with a draft seeded from the action; Save
creates with isNew=true and records learning, Cancel changes nothing.
"Log as RAID" sits in the row and hero overflow for every non-RAID
signal and is absent in popouts (§515).

Claude-Session: https://[session link removed]
```

```bash
git add -- src/app/raid-create-host.tsx src/app/raid-create-host.test.tsx src/app/raid-create-host.jump.test.tsx
git commit --only -F "$S/msg-task5.txt" -- src/app/raid-create-host.tsx src/app/raid-create-host.test.tsx src/app/raid-create-host.jump.test.tsx src/app/use-resource-planner.ts src/app/workspace-section-types.ts src/app/next-actions/action-cta.ts src/app/action-cta-controls.tsx src/app/actions-panel.tsx src/app/workspace-section.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/use-resource-planner.test.tsx src/app/next-actions/action-cta.test.ts src/app/action-row.test.tsx src/app/action-hero-card.test.tsx src/app/task-manager.characterization.test.tsx
git show --stat HEAD | tail -20
```

---

## Task 6: Log an insight as RAID — `Insight.loggedRaidId`, both surfaces, the on-saved writer

**Files:**
- Create: `src/app/insights/log-as-raid.ts`, `src/app/insights/log-as-raid.test.ts`
- Modify:
  - `src/app/insights/insight.ts` (`Insight.loggedRaidId`, `InsightActions.onLogAsRaid`)
  - `src/app/insights/sanitize-insights.ts`
  - `src/app/insights/reconcile.ts` (re-fire carry in `upsert`, `insightsMateriallyEqual`)
  - `src/app/dashboard-sections/insights-card.tsx`
  - `src/app/insights-panel.tsx`
  - `src/app/use-insight-recommendations.ts` (deps + `insightActions` bag)
  - `src/app/raid-create-host.tsx` (insight origin)
  - `src/app/task-manager.tsx` (writer + wiring)
  - `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test:
  - `src/app/insights/sanitize-insights.test.ts`
  - `src/app/insights/reconcile.test.ts`
  - `src/app/dashboard-sections/insights-card.test.tsx`
  - `src/app/insights-panel.test.tsx`
  - `src/app/raid-create-host.test.tsx`

`InsightsCard` and `InsightsPanel` do NOT share a row component. Each renders its own `<li>` with inline `Button`s (the `insights-card.tsx` docstring says so), so both get the same edit. Both reuse `Button variant="secondary" size="xs"` and the `` `${verb} – ${nameToken}` `` naming from `insightRowTitles`, exactly as Act does.

**Interfaces:**
- Consumes:
  - `metricAtActionPatch(insight)` (`./insights/outcome`)
  - `insightTitle`, `insightDetail` (`./insights/insight-text`)
  - `useRaidCreate` / `RaidCreateController` (Task 5)
  - `onOpen(ref: InsightEntityRef)` — already a prop of both surfaces
- Produces:
  - `Insight.loggedRaidId?: number`
  - `InsightActions.onLogAsRaid?: (insight: Insight) => void`
  - `markInsightLoggedAsRaid(insight: Insight, raidId: number, today: string): Insight`
  - `RaidCreateOrigin` widens to `{ kind: "insight"; insightId: number } | { kind: "action"; action: SuggestedAction }`
  - `RaidCreateDeps.onInsightLogged: (insightId: number, raidId: number) => void`
  - `RaidCreateController.openFromInsight: ((insight: Insight) => void) | undefined`

- [ ] **Step 1: i18n keys**

`src/app/i18n.ts`: replace `  insightOpen: "Open",` with:

```ts
  insightOpen: "Open",
  insightLogAsRaid: "Log as RAID",
  insightLogAsRaidHint: "Open a new RAID item prefilled from this insight; saving it marks the insight as acted",
  insightLoggedAsRaid: "Logged as RAID #{0}",
  insightOpenLoggedRaid: "Open RAID #{0}",
```

`$S/de-task6.json` (every non-ASCII character is escaped):

```json
[
  { "after": "  insightOpen: ", "lines": [
    "  insightLogAsRaid: \"Als RAID erfassen\",",
    "  insightLogAsRaidHint: \"Einen neuen RAID-Eintrag aus dieser Erkenntnis vorbef\u00fcllt \u00f6ffnen; beim Speichern wird die Erkenntnis als bearbeitet markiert\",",
    "  insightLoggedAsRaid: \"Als RAID #{0} erfasst\",",
    "  insightOpenLoggedRaid: \"RAID #{0} \u00f6ffnen\","
  ] }
]
```

```bash
node "$S/patch-de.mjs" "$S/de-task6.json"; echo "EXIT=$?"
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log(/\n  insightOpenLoggedRaid: \"RAID #\{0\} \u00f6ffnen\",\r\n/.test(s), /vorbef\u00fcllt/.test(s))"
```

Expected: `patched; LF-only line ends: 0`, `EXIT=0`, then `true true`.

- [ ] **Step 2: Write the failing tests**

(a) Create `src/app/insights/log-as-raid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markInsightLoggedAsRaid } from "./log-as-raid";
import { metricAtActionPatch } from "./outcome";
import type { Insight } from "./insight";

const base: Insight = {
  id: 7, key: "milestoneSlip:42", type: "milestoneSlip", severity: "high",
  entityRef: { view: "milestones", id: 42 }, data: { name: "Kickoff", date: "2026-06-01", daysOverdue: 5 },
  status: "active", firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-10", occurrences: 1,
};

describe("markInsightLoggedAsRaid", () => {
  it("marks acted, stamps actedAt, links the RAID id and captures the baseline like Act", () => {
    const out = markInsightLoggedAsRaid(base, 12, "2026-06-20");
    expect(out).toMatchObject({ status: "acted", actedAt: "2026-06-20", loggedRaidId: 12 });
    expect(out.metricAtAction).toBeDefined();
    expect(out.metricAtAction).toEqual(metricAtActionPatch(base).metricAtAction);
    expect(base.status).toBe("active"); // input not mutated
  });
  it("keeps an existing baseline — the first act wins", () => {
    const acted: Insight = { ...base, status: "acknowledged", metricAtAction: { daysOverdue: 2 } };
    expect(markInsightLoggedAsRaid(acted, 12, "2026-06-20").metricAtAction).toEqual({ daysOverdue: 2 });
  });
});
```

(b) Append to `src/app/insights/sanitize-insights.test.ts`:

```ts
describe("sanitizeInsights — loggedRaidId (§515)", () => {
  const rec = (loggedRaidId: unknown) => ({
    id: 1, key: "k", type: "overdueTrend", severity: "low", status: "acted", data: {},
    firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-01", occurrences: 1, loggedRaidId,
  });
  test("keeps a positive integer", () => {
    expect(sanitizeInsights([rec(9)])[0]?.loggedRaidId).toBe(9);
  });
  test("drops anything else", () => {
    for (const v of [0, -1, 2.5, "9", null, undefined]) {
      const [one] = sanitizeInsights([rec(v)]);
      expect(one).toBeDefined(); // the record itself survives
      expect(one?.loggedRaidId).toBeUndefined();
    }
  });
});
```

(c) Append to `src/app/insights/reconcile.test.ts`:

```ts
describe("loggedRaidId (§515)", () => {
  it("survives a RESOLVED → detected re-fire", () => {
    const existing = stored("a", { status: "resolved", resolvedAt: "2026-01-25", actedAt: "2026-01-10", loggedRaidId: 9 });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01", ALL_EVALUATED);
    const rec = out.find((i) => i.key === "a")!;
    expect(rec.status).toBe("active"); // positive control: this really took the re-fire branch
    expect(rec.resolvedAt).toBeUndefined();
    expect(rec.loggedRaidId).toBe(9);
  });
  // REGRESSION PIN — passes before this task too: the non-re-fire branch already spreads
  // `prev`. The red-before-fix cases are the re-fire test above and the equality test below.
  it("survives an upsert of a still-detected acted record", () => {
    const existing = stored("a", { status: "acted", actedAt: "2026-01-10", loggedRaidId: 9 });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01", ALL_EVALUATED);
    expect(out.find((i) => i.key === "a")?.loggedRaidId).toBe(9);
  });
  it("counts a changed link as a material change", () => {
    const a = stored("a", { loggedRaidId: 9 });
    expect(insightsMateriallyEqual([a], [{ ...a }])).toBe(true);
    expect(insightsMateriallyEqual([a], [{ ...a, loggedRaidId: 10 }])).toBe(false);
    expect(insightsMateriallyEqual([a], [{ ...a, loggedRaidId: undefined }])).toBe(false);
  });
});
```

(d) Append to `src/app/dashboard-sections/insights-card.test.tsx`:

```tsx
describe("InsightsCard — Log as RAID (§515)", () => {
  const actionsWith = (onLogAsRaid = vi.fn()) => ({
    onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
    onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
    onLogAsRaid,
  });

  it("offers Log as RAID beside Act and hands the insight to the handler", async () => {
    const user = userEvent.setup();
    const onLogAsRaid = vi.fn();
    const insight = makeInsight({ id: 7 });
    const title = insightTitle(insight, "en-US");
    render(<InsightsCard insights={[insight]} lang="en-US" dc={dc} actions={actionsWith(onLogAsRaid)} />);
    await user.click(screen.getByRole("button", { name: `Log as RAID – ${title}` }));
    expect(onLogAsRaid).toHaveBeenCalledWith(insight);
  });

  it("hides it for raidAging (positive control: Act is on the same row)", () => {
    const insight = makeInsight({ id: 8, type: "raidAging", entityRef: { view: "raid", id: 55 }, data: { name: "R-1", daysSinceUpdate: 20, targetDate: "2026-05-01" } });
    const title = insightTitle(insight, "en-US");
    render(<InsightsCard insights={[insight]} lang="en-US" dc={dc} actions={actionsWith()} />);
    expect(screen.getByRole("button", { name: `Act – ${title}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Log as RAID – ${title}` })).toBeNull();
  });

  it("shows the link instead once logged, and Open deep-links to that RAID item", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const insight = makeInsight({ id: 9, loggedRaidId: 31 });
    const title = insightTitle(insight, "en-US");
    render(<InsightsCard insights={[insight]} lang="en-US" dc={dc} onOpen={onOpen} actions={actionsWith()} />);
    expect(screen.getByText("Logged as RAID #31")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Act – ${title}` })).toBeTruthy(); // positive control
    expect(screen.queryByRole("button", { name: `Log as RAID – ${title}` })).toBeNull();
    await user.click(screen.getByRole("button", { name: `Open RAID #31 – ${title}` }));
    expect(onOpen).toHaveBeenCalledWith({ view: "raid", id: 31 });
  });

  it("gives two same-type rows distinct Log as RAID names", () => {
    render(
      <InsightsCard
        insights={[makeInsight({ id: 1, key: "k1" }), makeInsight({ id: 2, key: "k2" })]}
        lang="en-US" dc={dc} actions={actionsWith()}
      />,
    );
    const names = screen.getAllByRole("button", { name: /^Log as RAID – / }).map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("offers nothing when the handler is absent (popout bag) — positive control: Act", () => {
    const insight = makeInsight({ id: 7 });
    const title = insightTitle(insight, "en-US");
    const { onLogAsRaid: _unused, ...rest } = actionsWith();
    void _unused;
    render(<InsightsCard insights={[insight]} lang="en-US" dc={dc} actions={rest} />);
    expect(screen.getByRole("button", { name: `Act – ${title}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Log as RAID – ${title}` })).toBeNull();
  });
});
```

(e) Append to `src/app/insights-panel.test.tsx`:

```tsx
describe("InsightsPanel — Log as RAID (§515)", () => {
  const actionsWith = (onLogAsRaid = vi.fn()) => ({
    onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
    onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
    onLogAsRaid,
  });

  it("offers Log as RAID on an active row and hands the insight over", async () => {
    const user = userEvent.setup();
    const onLogAsRaid = vi.fn();
    const insight = makeInsight({ id: 7, type: "milestoneSlip", status: "active" });
    render(<InsightsPanel insights={[insight]} lang="en-US" today={TODAY} actions={actionsWith(onLogAsRaid)} />);
    await user.click(screen.getByRole("button", { name: `Log as RAID – ${titleOf("milestoneSlip")}` }));
    expect(onLogAsRaid).toHaveBeenCalledWith(insight);
  });

  it("hides it for raidAging (positive control: Act)", () => {
    const insight = makeInsight({ id: 5, type: "raidAging", status: "active", entityRef: { view: "raid", id: 55 }, data: { name: "R-1", daysSinceUpdate: 20, targetDate: "2026-05-01" } });
    render(<InsightsPanel insights={[insight]} lang="en-US" today={TODAY} actions={actionsWith()} />);
    expect(screen.getByRole("button", { name: `Act – ${titleOf("raidAging")}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Log as RAID – ${titleOf("raidAging")}` })).toBeNull();
  });

  it("shows 'Logged as RAID #N' with Open on an acted, logged row", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const insight = makeInsight({ id: 3, type: "stalledWork", status: "acted", entityRef: undefined, data: { count: 3 }, loggedRaidId: 31 });
    render(<InsightsPanel insights={[insight]} lang="en-US" today={TODAY} onOpen={onOpen} actions={actionsWith()} />);
    expect(screen.getByText("Logged as RAID #31")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Log as RAID – / })).toBeNull();
    await user.click(screen.getByRole("button", { name: `Open RAID #31 – ${titleOf("stalledWork")}` }));
    expect(onOpen).toHaveBeenCalledWith({ view: "raid", id: 31 });
  });
});
```

(f) Append to `src/app/raid-create-host.test.tsx`. Add `import type { Insight } from "./insights/insight";` and `import { insightTitle } from "./insights/insight-text";` to the imports, and in `deps()` add `onInsightLogged: vi.fn(),` directly above `...over,`. Then append:

```tsx
const insight: Insight = {
  id: 7, key: "milestoneSlip:42", type: "milestoneSlip", severity: "high",
  entityRef: { view: "milestones", id: 42 }, data: { name: "Kickoff", date: "2026-06-01", daysOverdue: 5 },
  status: "active", firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-10", occurrences: 1,
};

describe("useRaidCreate — insight origin (§515)", () => {
  it("opens a Risk draft seeded from the insight", () => {
    const { result } = renderHook(() => useRaidCreate(deps()));
    act(() => result.current.openFromInsight!(insight));
    const d = result.current.request!.draft;
    expect(d.title).toBe(insightTitle(insight, "en-US"));
    expect(d.description).toContain(`From: ${t("en-US", "insightsCardTitle")}`);
  });

  it("links the insight to the RE-MINTED id the save returns, never to draft.id", () => {
    // The draft opened with id 1; a concurrent writer took it, so the save re-minted 12.
    const handleSaveRaidItem = vi.fn(() => 12);
    const onInsightLogged = vi.fn();
    const recordLearning = vi.fn(async () => {});
    const { result } = renderHook(() => useRaidCreate(deps({ handleSaveRaidItem, onInsightLogged, recordLearning })));
    act(() => result.current.openFromInsight!(insight));
    expect(result.current.request!.draft.id).not.toBe(12);
    act(() => result.current.commit({ ...result.current.request!.draft, title: "Kickoff slip" }));
    expect(handleSaveRaidItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Kickoff slip" }), true);
    expect(onInsightLogged).toHaveBeenCalledWith(7, 12);
    expect(recordLearning).not.toHaveBeenCalled();
    expect(result.current.request).toBeNull();
  });

  it("never touches the insight on Cancel", () => {
    const onInsightLogged = vi.fn();
    const { result } = renderHook(() => useRaidCreate(deps({ onInsightLogged })));
    act(() => result.current.openFromInsight!(insight));
    act(() => result.current.cancel());
    expect(onInsightLogged).not.toHaveBeenCalled();
  });

  it("never touches the insight when the save is refused", () => {
    const onInsightLogged = vi.fn();
    const { result } = renderHook(() => useRaidCreate(deps({ onInsightLogged, handleSaveRaidItem: vi.fn(() => undefined) })));
    act(() => result.current.openFromInsight!(insight));
    act(() => result.current.commit({ ...result.current.request!.draft, title: "x" }));
    expect(onInsightLogged).not.toHaveBeenCalled();
    expect(result.current.request).not.toBeNull();
  });

  it("exposes no insight opener in a popout", () => {
    const { result } = renderHook(() => useRaidCreate(deps({ isPopout: true })));
    expect(result.current.openFromInsight).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run src/app/insights/log-as-raid.test.ts src/app/insights/sanitize-insights.test.ts src/app/insights/reconcile.test.ts src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx src/app/raid-create-host.test.tsx --maxWorkers=1 --reporter=dot > "$S/t6a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t6a.log" | head -12
```

Expected: `EXIT=1`.
- `./log-as-raid` is unresolvable.
- `loggedRaidId` is dropped by the sanitizer and by the re-fire.
- The equality check reports `true` for a changed link.
- No "Log as RAID" button is found.
- `openFromInsight` is undefined.

- [ ] **Step 4: Implement the model**

`src/app/insights/insight.ts`, in two edits:
1. Replace `  readonly outcome?: InsightOutcome;\n}` with:

```ts
  readonly outcome?: InsightOutcome;
  /** RAID item created from this insight through "Log as RAID" (§515). Carried
   *  by reconcile on every branch; positive integer or absent. */
  readonly loggedRaidId?: number;
}
```

2. Replace `  readonly onRejectRecommendation: (id: number) => void;\n}` with:

```ts
  readonly onRejectRecommendation: (id: number) => void;
  /** Opens the floating RAID editor seeded from the insight (§515). Absent in popouts. */
  readonly onLogAsRaid?: (insight: Insight) => void;
}
```

`src/app/insights/sanitize-insights.ts`, in two edits:
1. Replace `    const actAt = str(o.actedAt, 40);` with:

```ts
    const actAt = str(o.actedAt, 40);
    const loggedRaidId =
      typeof o.loggedRaidId === "number" && Number.isInteger(o.loggedRaidId) && o.loggedRaidId > 0
        ? o.loggedRaidId
        : undefined;
```

2. Replace `      ...(actAt ? { actedAt: actAt } : {}),` with:

```ts
      ...(actAt ? { actedAt: actAt } : {}),
      ...(loggedRaidId !== undefined ? { loggedRaidId } : {}),
```

`src/app/insights/reconcile.ts`, in two edits:
1. In `upsert`'s re-fire rebuild, replace `    ...(next.actedAt !== undefined ? { actedAt: next.actedAt } : {}),` with:

```ts
    ...(next.actedAt !== undefined ? { actedAt: next.actedAt } : {}),
    // §515 — the link to the RAID item logged from this insight outlives a re-fire,
    // like `actedAt`: the item still exists whether or not the condition recurred.
    ...(next.loggedRaidId !== undefined ? { loggedRaidId: next.loggedRaidId } : {}),
```

2. In `insightsMateriallyEqual`, replace `      x.actedAt !== y.actedAt ||` with `      x.actedAt !== y.actedAt ||\n      x.loggedRaidId !== y.loggedRaidId ||`.

Create `src/app/insights/log-as-raid.ts`:

```ts
// src/app/insights/log-as-raid.ts
//
// Pure, i18n-free: the insight side of "Log as RAID" (§515). Saving the RAID
// item IS acting on the insight, so this is the Act transition (`onActInsight`
// in task-manager.tsx) plus the link — the SAME `metricAtActionPatch` spread,
// so the first transition to `acted` captures the outcome baseline and a later
// one never overwrites it.
import type { Insight } from "./insight";
import { metricAtActionPatch } from "./outcome";

export function markInsightLoggedAsRaid(insight: Insight, raidId: number, today: string): Insight {
  return {
    ...insight,
    status: "acted",
    actedAt: today,
    loggedRaidId: raidId,
    ...metricAtActionPatch(insight),
  };
}
```

- [ ] **Step 5: Implement the surfaces**

`src/app/dashboard-sections/insights-card.tsx`, in two edits:
1. Replace

```tsx
                    {t(lang, "insightOpen")}
                  </Button>
                ) : null}
                {!isPopout && actions ? (
```

   with

```tsx
                    {t(lang, "insightOpen")}
                  </Button>
                ) : null}
                {insight.loggedRaidId !== undefined ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {t(lang, "insightLoggedAsRaid", insight.loggedRaidId)}
                    </span>
                    {onOpen ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        aria-label={`${t(lang, "insightOpenLoggedRaid", insight.loggedRaidId)} – ${nameToken}`}
                        onClick={() => onOpen({ view: "raid", id: insight.loggedRaidId! })}
                      >
                        {t(lang, "insightOpenLoggedRaid", insight.loggedRaidId)}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {!isPopout && actions ? (
```

2. Replace

```tsx
                      {t(lang, "insightAct")}
                    </Button>
                    <Button
```

   with

```tsx
                      {t(lang, "insightAct")}
                    </Button>
                    {/* §515 — not for raidAging (already about a RAID item), not once logged. */}
                    {actions.onLogAsRaid && insight.type !== "raidAging" && insight.loggedRaidId === undefined ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        aria-label={`${t(lang, "insightLogAsRaid")} – ${nameToken}`}
                        title={t(lang, "insightLogAsRaidHint")}
                        onClick={() => actions.onLogAsRaid!(insight)}
                      >
                        {t(lang, "insightLogAsRaid")}
                      </Button>
                    ) : null}
                    <Button
```

`src/app/insights-panel.tsx`, in three edits:
1. Replace `              const showDismiss = !TERMINAL.has(insight.status);` with:

```tsx
              const showDismiss = !TERMINAL.has(insight.status);
              // §515 — gated like Act, plus: not for raidAging, not once logged.
              const showLogAsRaid =
                showAct && insight.type !== "raidAging" && insight.loggedRaidId === undefined && !!actions?.onLogAsRaid;
```

2. Replace

```tsx
                          {t(lang, "insightOpen")}
                        </Button>
                      ) : null}
                      {canWrite ? (
```

   with

```tsx
                          {t(lang, "insightOpen")}
                        </Button>
                      ) : null}
                      {insight.loggedRaidId !== undefined ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {t(lang, "insightLoggedAsRaid", insight.loggedRaidId)}
                          </span>
                          {onOpen ? (
                            <Button
                              variant="secondary"
                              size="xs"
                              aria-label={`${t(lang, "insightOpenLoggedRaid", insight.loggedRaidId)} – ${nameToken}`}
                              onClick={() => onOpen({ view: "raid", id: insight.loggedRaidId! })}
                            >
                              {t(lang, "insightOpenLoggedRaid", insight.loggedRaidId)}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {canWrite ? (
```

3. Replace

```tsx
                              {t(lang, "insightAct")}
                            </Button>
                          ) : null}
```

   with

```tsx
                              {t(lang, "insightAct")}
                            </Button>
                          ) : null}
                          {showLogAsRaid ? (
                            <Button
                              variant="secondary"
                              size="xs"
                              aria-label={`${t(lang, "insightLogAsRaid")} – ${nameToken}`}
                              title={t(lang, "insightLogAsRaidHint")}
                              onClick={() => actions!.onLogAsRaid!(insight)}
                            >
                              {t(lang, "insightLogAsRaid")}
                            </Button>
                          ) : null}
```

`src/app/use-insight-recommendations.ts`, in three edits:
1. Replace `  onDismissInsight: (id: number) => void;\n}` with:

```ts
  onDismissInsight: (id: number) => void;
  /** "Log as RAID" opener (§515); undefined in popouts. */
  onLogAsRaid?: (insight: Insight) => void;
}
```

2. Replace `    onDismissInsight,\n  } = deps;` with `    onDismissInsight,\n    onLogAsRaid,\n  } = deps;`.
3. Replace

```ts
      onRejectRecommendation: onRejectRecommendationInsight,
    }),
    [onAcknowledgeInsight, onActInsight, onDismissInsight, onGenerateRecommendationInsight,
      onApplyRecommendationInsight, onRejectRecommendationInsight],
```

   with

```ts
      onRejectRecommendation: onRejectRecommendationInsight,
      ...(onLogAsRaid ? { onLogAsRaid } : {}),
    }),
    [onAcknowledgeInsight, onActInsight, onDismissInsight, onGenerateRecommendationInsight,
      onApplyRecommendationInsight, onRejectRecommendationInsight, onLogAsRaid],
```

`src/app/raid-create-host.tsx` (insight origin), in six edits:
1. Imports: replace `import type { SuggestedAction } from "./next-actions";` with:

```ts
import type { SuggestedAction } from "./next-actions";
import type { Insight } from "./insights/insight";
import { insightDetail, insightTitle } from "./insights/insight-text";
```

2. Replace `export type RaidCreateOrigin = { kind: "action"; action: SuggestedAction };` with:

```ts
export type RaidCreateOrigin =
  | { kind: "insight"; insightId: number }
  | { kind: "action"; action: SuggestedAction };
```

3. In `RaidCreateDeps`, replace `  recordLearning: (action: SuggestedAction, type: OutcomeType) => Promise<void>;\n}` with:

```ts
  recordLearning: (action: SuggestedAction, type: OutcomeType) => Promise<void>;
  /** Insight on-saved writer: acted + actedAt + loggedRaidId (task-manager). */
  onInsightLogged: (insightId: number, raidId: number) => void;
}
```

4. In `RaidCreateController`, replace `  openFromAction: ((action: SuggestedAction) => void) | undefined;` with:

```ts
  openFromAction: ((action: SuggestedAction) => void) | undefined;
  openFromInsight: ((insight: Insight) => void) | undefined;
```

5. In `useRaidCreate`, replace `  const { isPopout, lang, today, raid, handleSaveRaidItem, recordLearning } = deps;` with `  const { isPopout, lang, today, raid, handleSaveRaidItem, recordLearning, onInsightLogged } = deps;`. Then replace `  const setDraft = useCallback((next: RaidItem) => {` with:

```ts
  const openFromInsight = useCallback(
    (insight: Insight) => {
      open(
        buildRaidSeedFromSignal({
          title: insightTitle(insight, lang),
          note: t(lang, "actionCreatedFromNote", t(lang, "insightsCardTitle"), insightDetail(insight, lang)),
        }),
        { kind: "insight", insightId: insight.id },
      );
    },
    [open, lang],
  );

  const setDraft = useCallback((next: RaidItem) => {
```

6. Replace the commit body and the return object:

```ts
      // Defensive only: the host receives the UNGUARDED `handleSaveRaidItem`, and a create
      // never returns undefined (the editVanished refusal needs !create). Read-only
      // protection is structural — popouts never mount the host and get no openers.
      if (id === undefined) return;
      void recordLearning(request.origin.action, "acted");
      setRequest(null);
    },
    [request, handleSaveRaidItem, recordLearning],
  );

  return {
    request,
    openFromAction: isPopout ? undefined : openFromAction,
```

   with

```ts
      // Defensive only: the host receives the UNGUARDED `handleSaveRaidItem`, and a create
      // never returns undefined (the editVanished refusal needs !create). Read-only
      // protection is structural — popouts never mount the host and get no openers.
      if (id === undefined) return;
      // ★★ `id` is the COMMITTED id — never `request.draft.id`, which is stale
      //   whenever the save re-minted (the id-mint race).
      if (request.origin.kind === "insight") onInsightLogged(request.origin.insightId, id);
      else void recordLearning(request.origin.action, "acted");
      setRequest(null);
    },
    [request, handleSaveRaidItem, recordLearning, onInsightLogged],
  );

  return {
    request,
    openFromAction: isPopout ? undefined : openFromAction,
    openFromInsight: isPopout ? undefined : openFromInsight,
```

`src/app/task-manager.tsx`, in four edits:
1. Replace `import { metricAtActionPatch } from "./insights/outcome";` with:

```ts
import { metricAtActionPatch } from "./insights/outcome";
import { markInsightLoggedAsRaid } from "./insights/log-as-raid";
```

2. Directly after `onActInsight`'s closing, replace `    [isPopout, insights, setInsights, today, requestOpen],\n  );` with:

```ts
    [isPopout, insights, setInsights, today, requestOpen],
  );
  // "Log as RAID" on-saved writer (§515): the Act transition plus the link to the
  // RAID item. Read `i` from the functional setter's `prev` (first act wins).
  const onInsightLoggedAsRaid = useCallback(
    (insightId: number, raidId: number) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) => (i.id === insightId ? markInsightLoggedAsRaid(i, raidId, today) : i)),
      );
    },
    [isPopout, setInsights, today],
  );
```

3. Replace `  const raidCreate = useRaidCreate({ isPopout, lang, today, raid, handleSaveRaidItem, recordLearning });` with:

```ts
  const raidCreate = useRaidCreate({
    isPopout, lang, today, raid, handleSaveRaidItem, recordLearning,
    onInsightLogged: onInsightLoggedAsRaid,
  });
```

4. Replace `    onAcknowledgeInsight, onActInsight, onDismissInsight,\n  });` with:

```ts
    onAcknowledgeInsight, onActInsight, onDismissInsight,
    onLogAsRaid: raidCreate.openFromInsight,
  });
```

- [ ] **Step 6: Run tests and gates**

```bash
npx vitest run src/app/insights/log-as-raid.test.ts src/app/insights/sanitize-insights.test.ts src/app/insights/reconcile.test.ts src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx src/app/raid-create-host.test.tsx src/app/task-manager.characterization.test.tsx src/app/i18n-encoding.test.ts --maxWorkers=1 --reporter=dot > "$S/t6b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$S/t6b.log" | head
npx tsc --noEmit > "$S/tsc6.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/tsc6.log"
npx eslint --max-warnings=0 src/app/insights/insight.ts src/app/insights/sanitize-insights.ts src/app/insights/reconcile.ts src/app/insights/log-as-raid.ts src/app/insights/log-as-raid.test.ts src/app/dashboard-sections/insights-card.tsx src/app/insights-panel.tsx src/app/use-insight-recommendations.ts src/app/raid-create-host.tsx src/app/raid-create-host.test.tsx src/app/task-manager.tsx src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx src/app/insights/reconcile.test.ts src/app/insights/sanitize-insights.test.ts src/app/i18n.ts > "$S/lint6.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` for all three; `Test Files  8 passed (8)`; `0` tsc errors.

- [ ] **Step 7: Commit** — write `$S/msg-task6.txt`:

```
feat: log an insight as a RAID item and link the two

A "Log as RAID" button beside Act on the dashboard Insights card and the
Insights view (not for raidAging, not once logged) opens the floating RAID
editor seeded from the insight. Saving marks the insight acted — with the
same first-act-wins baseline as Act — and stores loggedRaidId, the id the
save committed; Cancel changes nothing. The link is sanitized, carried
through a reconcile re-fire and counted as a material change, and the row
then shows "Logged as RAID #N" with Open (§515).

Claude-Session: https://[session link removed]
```

```bash
git add -- src/app/insights/log-as-raid.ts src/app/insights/log-as-raid.test.ts
git commit --only -F "$S/msg-task6.txt" -- src/app/insights/log-as-raid.ts src/app/insights/log-as-raid.test.ts src/app/insights/insight.ts src/app/insights/sanitize-insights.ts src/app/insights/reconcile.ts src/app/dashboard-sections/insights-card.tsx src/app/insights-panel.tsx src/app/use-insight-recommendations.ts src/app/raid-create-host.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/insights/sanitize-insights.test.ts src/app/insights/reconcile.test.ts src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx src/app/raid-create-host.test.tsx
git show --stat HEAD | tail -20
```

---

## Task 7: Docs + close §515 in the register

**Files:**
- Modify:
  - `docs/AGENTS/insights.md` (the SP3 "CAPTURE is at EVERY acted transition" sentence)
  - `docs/AGENTS/rich-text.md` (RAID note-log paragraph)
  - `AGENTS.md` ("Action-row layout (slice 2)" overflow list)
  - `docs/open-followups.md` (§515 heading, index row, Status, Work item line)

Line-ending and search facts for this task:
- `docs/open-followups.md` is LF (`i/lf w/lf attr/text eol=lf`), so the Edit tool is safe.
- Grep that justifies the doc scope: `git grep -n -E 'RAID_FIELD_GUARDS|overflowCtas|ActionOverflowMenu|onActInsight|confirmInsightRecommendation|handleSaveRaidItem|handleEscalate|insightActions' -- docs/AGENTS AGENTS.md` hits only `AGENTS.md` (the next-actions bullets) and `docs/AGENTS/insights.md`. `rich-text.md` is included because Escalate is a new RAID `noteLog` writer.

- [ ] **Step 1: `docs/AGENTS/insights.md`**

Replace

```
  NEGATIVE when worsened — the UI must render `Math.abs(delta)`. ★★ CAPTURE is at EVERY acted transition
  (manual `onActInsight` AND `confirmInsightRecommendation`), both spreading the SAME `metricAtActionPatch(i)`
```

with

```
  NEGATIVE when worsened — the UI must render `Math.abs(delta)`. ★★ CAPTURE is at EVERY acted transition
  (manual `onActInsight`, `confirmInsightRecommendation`, AND "Log as RAID" through `markInsightLoggedAsRaid`,
  which also stores `loggedRaidId` — the id `handleSaveRaidItem` RETURNS, never the draft's), all spreading the SAME `metricAtActionPatch(i)`
```

- [ ] **Step 2: `docs/AGENTS/rich-text.md`**

Replace

```
  instead builds `withStamp` with `noteLog` taken from the STORED row (`previous`), never the payload.
```

with

```
  instead builds `withStamp` with `noteLog` taken from the STORED row (`previous`), never the payload.
  ★★ `escalations` rides the SAME carry (§515): the Next-actions Escalate CTA (`handleEscalate`) and the AI
  `escalate_raid_item` tool (`escalateRaid`) are write-through RAID writers — each one functional `setRaid`
  appending a `RaidEscalation` AND a note via `buildEscalationRecord` — and the always-mounted RAID editor's
  draft would otherwise erase both on Save. The AI's note carries the literal `authorName` "AI created" and no
  `authorResourceId` (`aiEscalationNoteAuthor`), the one note `addNote` writes with a name but no self id.
```

- [ ] **Step 3: `AGENTS.md`**

In the "Action-row layout (slice 2)" bullet, replace `A single `⋮` overflow\n  popover (Draft / Create-task / Snooze)` — the exact text spans a line break; locate it with `grep -n "overflow popover (Draft / Create-task / Snooze)\|(Draft / Create-task / Snooze)" AGENTS.md` — so that `(Draft / Create-task / Snooze)` reads `(Draft / Create-task / Log-as-RAID / Snooze)`. Change nothing else on the line.

- [ ] **Step 4: Close §515 in `docs/open-followups.md`**

Derive the new anchor with GitHub's slug rules rather than typing it: lowercase, drop everything except letters, digits, spaces and hyphens, then turn each space into a hyphen. The ` — ` becomes `--`.

```bash
node -e "const h='515. A risk signal cannot be turned into a RAID item directly, and an escalation leaves no record on the item — CLOSED 2026-09-13';console.log(h.toLowerCase().replace(/[^a-z0-9 -]/g,'').replace(/ /g,'-'))"
```

Expected: `515-a-risk-signal-cannot-be-turned-into-a-raid-item-directly-and-an-escalation-leaves-no-record-on-the-item--closed-2026-09-13`

Four edits:
1. Heading: replace `## 515. A risk signal cannot be turned into a RAID item directly, and an escalation leaves no record on the item — OPEN` with `## 515. A risk signal cannot be turned into a RAID item directly, and an escalation leaves no record on the item — CLOSED 2026-09-13`.
2. Status: replace `**Status:** OPEN 2026-09-13 — never machine-verified beyond the issue's 2026-09-11 code check.` with:

```
**Status:** CLOSED 2026-09-13 on `feat/raid-signal-log-escalation`. An insight (dashboard card and Insights view) or a next action can be logged as a RAID item through the floating RAID editor; saving marks the insight acted and links `loggedRaidId`. Escalate now records a `RaidItem.escalations` entry, a note-log echo and a `raid.escalated` activity entry. The AI assistant can append one through `escalate_raid_item` (no e-mail; history is append-only; the note is authored "AI created"). GitLab #55 closes at merge. Guardrail gaps §360 and §362 stay open.
```

3. Work item: replace `**Source:** GitLab #55 (R-1, source::demo-2026-09-11)\n\n**Work item:** #55\n\n## 516.` with `**Source:** GitLab #55 (R-1, source::demo-2026-09-11)\n\n## 516.`.
4. Index row: replace

```
| [§515](#515-a-risk-signal-cannot-be-turned-into-a-raid-item-directly-and-an-escalation-leaves-no-record-on-the-item--open) | A risk signal cannot be turned into a RAID item directly, and an escalation leaves no record on the item — OPEN | AI PM Cockpit demo 2026-09-11 (R-1), GitLab #55; mirrored into the register 2026-09-13 | M — a one-click log-as-risk/issue from a signal, plus escalation state on the item | open |
```

   with

```
| [§515](#515-a-risk-signal-cannot-be-turned-into-a-raid-item-directly-and-an-escalation-leaves-no-record-on-the-item--closed-2026-09-13) | A risk signal cannot be turned into a RAID item directly, and an escalation leaves no record on the item — CLOSED 2026-09-13 | AI PM Cockpit demo 2026-09-11 (R-1), GitLab #55; mirrored into the register 2026-09-13 | M — a one-click log-as-risk/issue from a signal, plus escalation state on the item | **CLOSED** 2026-09-13 |
```

- [ ] **Step 5: Run the register and doc gates**

```bash
npm run followups:index:check > "$S/fidx.log" 2>&1; echo "EXIT=$?"; tail -3 "$S/fidx.log"
npm run followups:workitems:check > "$S/fwi.log" 2>&1; echo "EXIT=$?"; tail -3 "$S/fwi.log"
npm run followups:status:check > "$S/fst.log" 2>&1; echo "EXIT=$?"; tail -3 "$S/fst.log"
npm run docs:symbols:check > "$S/sym7.log" 2>&1; echo "EXIT=$?"; tail -3 "$S/sym7.log"
npm run docs:claims:check > "$S/claims7.log" 2>&1; echo "EXIT=$?"; tail -3 "$S/claims7.log"
git ls-files --eol docs/open-followups.md
```

Expected: `EXIT=0` for all five, and `i/lf w/lf`.
- Each followups gate: exit 1 = drift (fix the entry); exit 2 = could not scan (a marker problem — stop and report).
- `docs:symbols:check` proves every backticked mixed-case name above exists. `markInsightLoggedAsRaid`, `buildEscalationRecord`, `RaidEscalation`, `loggedRaidId` and `handleEscalate` all land in Tasks 3 and 6.
- `docs:claims:check` must not gain a citation, because this plan and the doc edits cite symbols only.

- [ ] **Step 6: Commit** — write `$S/msg-task7.txt`:

```
docs: record Log as RAID and the escalation record; close §515

insights.md names the third acted transition and the loggedRaidId
link, rich-text.md adds Escalate as a write-through RAID writer that the
save handler's stored-row carry covers, AGENTS.md lists the new overflow
item, and §515 closes (heading, anchor, index row, Status; Work item line
removed — #55 closes at merge).

Claude-Session: https://[session link removed]
```

```bash
git commit --only -F "$S/msg-task7.txt" -- docs/AGENTS/insights.md docs/AGENTS/rich-text.md AGENTS.md docs/open-followups.md
git show --stat HEAD | tail -6
```

---

## Task 8: End-of-branch gates + mutation proof (no full suite)

**Files:** none are committed. Every mutant below is applied with an Edit and reverted with the exact inverse Edit in the same step.

- [ ] **Step 1: Whole-tree static gates**

```bash
S=C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad
git status --short
npx tsc --noEmit > "$S/g-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$S/g-tsc.log"
npx eslint --max-warnings=0 src > "$S/g-lint.log" 2>&1; echo "EXIT=$?"; tail -5 "$S/g-lint.log"
npm run docs:symbols:check > "$S/g-sym.log" 2>&1; echo "EXIT=$?"
npm run size:check > "$S/g-size.log" 2>&1; echo "EXIT=$?"; tail -3 "$S/g-size.log"
npm run dup:check > "$S/g-dup.log" 2>&1; echo "EXIT=$?"; grep -E "duplicat|threshold" "$S/g-dup.log" | tail -3
```

Expected:
- `git status --short` is empty (a clean tree; the whole-repo gates need a still tree).
- Every gate prints `EXIT=0`, with `0` tsc errors.
- If `dup:check` fails, the likely duplicate is the "Logged as RAID #N" block that Task 6 writes into both insight surfaces. Extract it into one small shared component in `src/app/insights/` and re-run; do not raise the threshold.

- [ ] **Step 2: Every touched test file, in one serial run**

```bash
npx vitest run src/app/raid-draft.test.ts src/app/raid-panel.test.tsx src/app/raid-escalation.test.ts src/app/entity-persistence-registry.test.ts src/app/heavy-fields-persistence.test.ts src/app/golden-workspace.test.ts src/app/codec-roundtrip.property.test.ts src/app/sanitize-records.test.ts src/app/template-apply.test.ts src/app/export-sections.test.ts src/app/use-resource-planner.test.tsx src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.write-path-sweep.test.ts src/app/action-escalate.test.ts src/app/use-action-center-handlers.test.ts src/app/activity-log.test.ts src/app/raid.test.ts src/app/raid-edit-modal.test.tsx src/app/next-actions/action-cta.test.ts src/app/action-row.test.tsx src/app/action-hero-card.test.tsx src/app/raid-create-host.test.tsx src/app/raid-create-host.jump.test.tsx src/app/task-manager.characterization.test.tsx src/app/insights/log-as-raid.test.ts src/app/insights/sanitize-insights.test.ts src/app/insights/reconcile.test.ts src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx src/app/i18n-encoding.test.ts src/app/note-log.test.ts src/app/chat-tools.test.ts src/app/ai-entity-token.test.ts src/app/chat-proposal.test.ts src/app/chat-proposal-describe.test.ts src/app/chat-proposal-apply.test.tsx src/app/use-chat-dispatcher.undo.test.tsx src/app/use-chat-dispatcher.escalate.test.tsx src/app/insights/recommend-tokens.test.ts src/app/operating-guide-builtin.test.ts src/app/chat-api.system-prompt.test.ts --maxWorkers=1 --reporter=dot > "$S/g-tests.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$S/g-tests.log"
```

Expected: `EXIT=0` and `Test Files  41 passed (41)`. A lower file count means a path was dropped silently: find and fix it before trusting the result.

- [ ] **Step 3: Mutation proof — nine guards, each named, run alone, then reverted**

For each mutant:
1. Apply the Edit.
2. Confirm it landed with the `grep`.
3. Run ONLY the named file.
4. Expect `EXIT=1` and the named case red.
5. Apply the inverse Edit.
6. Confirm with `git diff --stat` that the tree is clean again.

Run one mutant at a time; never two.

**M1 — reconcile carry.**
- Mutant: in `src/app/insights/reconcile.ts`, replace `    ...(next.loggedRaidId !== undefined ? { loggedRaidId: next.loggedRaidId } : {}),` with `    // MUTANT M1`.

```bash
grep -c "MUTANT M1" src/app/insights/reconcile.ts
npx vitest run src/app/insights/reconcile.test.ts --maxWorkers=1 --reporter=dot > "$S/m1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |survives a RESOLVED" "$S/m1.log"
```

- Expected: `1`, then `EXIT=1` with `loggedRaidId (§515) > survives a RESOLVED → detected re-fire` failing.
- Revert: replace `    // MUTANT M1` with `    ...(next.loggedRaidId !== undefined ? { loggedRaidId: next.loggedRaidId } : {}),`.

**M2 — functional setter.**
- Mutant: in `src/app/use-action-center-handlers.ts`, replace `      setRaid((prev) =>\n        prev.map((r) => {` with `      setRaid(\n        raid.map((r) => { // MUTANT M2`.

```bash
grep -c "MUTANT M2" src/app/use-action-center-handlers.ts
npx vitest run src/app/use-action-center-handlers.test.ts --maxWorkers=1 --reporter=dot > "$S/m2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |ONE functional updater" "$S/m2.log"
```

- Expected: `1`, then `EXIT=1` with `writes through ONE functional updater that composes with a same-tick concurrent write` failing (`typeof updater` is `object`).
- Revert: replace `      setRaid(\n        raid.map((r) => { // MUTANT M2` with `      setRaid((prev) =>\n        prev.map((r) => {`.

**M3 — AI guard drop.**
- Mutant: in `src/app/sanitize-records.ts`, replace `  escalations: () => false,` with `  // MUTANT M3`.

```bash
grep -c "MUTANT M3" src/app/sanitize-records.ts
npx vitest run src/app/sanitize-records.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/use-chat-dispatcher.escalate.test.tsx --maxWorkers=1 --reporter=dot > "$S/m3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |drops a model-supplied escalations|cannot clear the history|cannot rewrite the history|raid" "$S/m3.log" | head -20
```

- Expected: `1`, then `EXIT=1`. `dropUnacceptedRaidFields — escalations is model-read-only (§515) > drops a model-supplied escalations key…` fails in `sanitize-records.test.ts`. In `use-chat-dispatcher.escalate.test.tsx`, `update_raid_item cannot clear the history …` and `… cannot rewrite the history …` fail (`escalations` becomes `[]` or the rewritten entry), while their title positive control lands.
- Record separately whether the offered-surface sweep ALSO went red on a `raid.escalations` Relation A finding. Report both tallies (failed / passed per file); a sweep that stays green is a finding to report, not to hide.
- Revert: replace `  // MUTANT M3` with `  escalations: () => false,`.

**M4 — raidAging hide.**
- Mutant: in `src/app/dashboard-sections/insights-card.tsx`, replace `{actions.onLogAsRaid && insight.type !== "raidAging" && insight.loggedRaidId === undefined ? (` with `{actions.onLogAsRaid && insight.loggedRaidId === undefined ? ( /* MUTANT M4 */`.

```bash
grep -c "MUTANT M4" src/app/dashboard-sections/insights-card.tsx
npx vitest run src/app/dashboard-sections/insights-card.test.tsx --maxWorkers=1 --reporter=dot > "$S/m4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |hides it for raidAging" "$S/m4.log"
```

- Expected: `1`, then `EXIT=1` with `InsightsCard — Log as RAID (§515) > hides it for raidAging` failing.
- Revert: replace `{actions.onLogAsRaid && insight.loggedRaidId === undefined ? ( /* MUTANT M4 */` with `{actions.onLogAsRaid && insight.type !== "raidAging" && insight.loggedRaidId === undefined ? (`.

**M5 — stale-editor severity carry (deviation 4).**
- Mutant: in `src/app/use-resource-planner.ts`, replace `        ...(keepEscalatedSeverity ? { severity: previous?.severity } : {}),` with `        // MUTANT M5`.

```bash
grep -c "MUTANT M5" src/app/use-resource-planner.ts
npx vitest run src/app/use-resource-planner.test.tsx --maxWorkers=1 --reporter=dot > "$S/m5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |keeps the STORED escalation record" "$S/m5.log"
```

- Expected: `1`, then `EXIT=1` with `handleSaveRaidItem — stored escalations (§515) > keeps the STORED escalation record over a stale editor snapshot` failing on `severity` (`High`, expected `Critical`). The two fix-round tests `keeps the raise across TWO unseen raises` and `keeps the raise when a notify-only escalation followed it` fail the same way. `keeps a DELIBERATE severity change` and `an editor opened AFTER the escalation keeps a deliberate return to its fromSeverity` stay green under this mutant, which is expected: they pin the other side of the rule (the carry applies only to the FIRST unseen escalation's `fromSeverity`, and only when the draft has not seen it).
- Revert: replace `        // MUTANT M5` with `        ...(keepEscalatedSeverity ? { severity: previous?.severity } : {}),`.

**M6 — append-only record.**
- Mutant: in `src/app/action-escalate.ts`, replace `    escalations: [...prior, buildEscalationEntry(plan, recipient, at)],` with `    escalations: [buildEscalationEntry(plan, recipient, at)], // MUTANT M6`.

```bash
grep -c "MUTANT M6" src/app/action-escalate.ts
npx vitest run src/app/action-escalate.test.ts src/app/use-chat-dispatcher.escalate.test.tsx --maxWorkers=1 --reporter=dot > "$S/m6.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |PRESERVES the existing note log|one raid.escalated row" "$S/m6.log"
```

- Expected: `1`, then `EXIT=1`. `buildEscalationRecord > appends to an existing record and PRESERVES the existing note log` fails, and so does `escalate_raid_item … > appends the entry, an "AI created" note, the severity step and one raid.escalated row` (the `EARLIER` entry is gone).
- Revert: replace `    escalations: [buildEscalationEntry(plan, recipient, at)], // MUTANT M6` with `    escalations: [...prior, buildEscalationEntry(plan, recipient, at)],`.

**M7 — shared severity plan (AI path).**
- Mutant: in `src/app/use-register-tools.ts`, replace `        const plan = planEscalation(existing);` with `        const plan = { raisesSeverity: false as const, reason: "max" as const }; // MUTANT M7`.

```bash
grep -c "MUTANT M7" src/app/use-register-tools.ts
npx vitest run src/app/use-chat-dispatcher.escalate.test.tsx --maxWorkers=1 --reporter=dot > "$S/m7.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |one raid.escalated row|ONE functional write" "$S/m7.log"
```

- Expected: `1`, then `EXIT=1`. `appends the entry, an "AI created" note, the severity step and one raid.escalated row` fails (severity `High`, expected `Critical`). `composes with a same-tick human edit …` fails the same way.
- Both notify-only cases stay green, which is expected: they pin the other branch of the plan.
- Revert: replace `        const plan = { raisesSeverity: false as const, reason: "max" as const }; // MUTANT M7` with `        const plan = planEscalation(existing);`.

**M8 — escalation token.**
- Mutant: in `src/app/chat-tools.ts`, replace

```
      requireToken("raid", current, input, `RAID item #${id}`);
      const recipient = requireEscalationRecipient(input);
```

  with

```
      // MUTANT M8
      const recipient = requireEscalationRecipient(input);
```

```bash
grep -c "MUTANT M8" src/app/chat-tools.ts
npx vitest run src/app/chat-tools.test.ts src/app/use-chat-dispatcher.escalate.test.tsx --maxWorkers=1 --reporter=dot > "$S/m8.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |supplies no token|stale token|same read" "$S/m8.log"
```

- Expected: `1`, then `EXIT=1`. `runTool — escalate_raid_item (§515, append-only) > refuses an escalation that supplies no token` and `> refuses a stale token` fail in `chat-tools.test.ts`, and `refuses a second escalation made from the same read …` fails in the escalate file.
- Revert: the exact inverse replacement (the two-line `// MUTANT M8` block back to the two lines above). The anchor `requireToken("raid", current, input, \`RAID item #${id}\`);` also appears in the `update_raid_item` case, so anchor the revert on `      // MUTANT M8\n      const recipient = requireEscalationRecipient(input);`, which is unique.

**M9 — AI functional write.**
- Mutant: in `src/app/use-register-tools.ts`, replace `        setRaid((prev) => prev.map(apply));` with `        setRaid(raidRef.current); // MUTANT M9`.

```bash
grep -c "MUTANT M9" src/app/use-register-tools.ts
npx vitest run src/app/use-chat-dispatcher.escalate.test.tsx --maxWorkers=1 --reporter=dot > "$S/m9.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |ONE functional write" "$S/m9.log"
```

- Expected: `1`, then `EXIT=1` with `composes with a same-tick human edit to another field (ONE functional write)` failing (title `Vendor down`).
- Revert: replace `        setRaid(raidRef.current); // MUTANT M9` with `        setRaid((prev) => prev.map(apply));`.

After all nine:

```bash
git diff --stat
grep -rn "MUTANT M" src || echo "no mutants left"
```

Expected: `git diff --stat` prints nothing, then `no mutants left`. Report the mutation count as `9/9 killed` only if every mutant above went red. Otherwise name the survivor and the file tally.

- [ ] **Step 4: User-gated checks (NOT executed by the implementer)**

List these in the hand-off report; run them only on the user's say:
- **Axe:** `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights|Dashboard|RAID" --workers=1`. It covers the new insight buttons, the overflow item and the hidden-by-default column. The floating host modal is not opened by that spec.
- **Eye-verify in a dev server** (`PORT=3100 npm run dev`):
  - Log a next action as RAID.
  - Log an insight, then confirm "Logged as RAID #N" and Open in the Insights view.
  - Escalate an Issue, then check the Escalations list, the note, the activity entry, and the "Last escalated" column.
  - With a RAID editor open on the same item before escalating, confirm Save keeps the record.
  - Ask the assistant to escalate an Issue to a directory person. Confirm that no mail client opens, the change applies without a review card, the Escalations list shows the entry linked to the resource, the note's author reads "AI created" (and "Von KI erstellt" in German), the activity row reads `RAID #N escalated: High → Critical` with the AI actor, and Undo reverts all three. Then ask for two escalations in one message and confirm they go to the review card.
- **Full unit suite** (`npm run test:run`, `npm run test:shuffle`) and `npm run test:coverage`.

