# Calendar Write-back SP2 — RAID Review Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push active RAID items as all-day Outlook events on their `targetDate`, reusing the SP1 calendar engine. Adds `RaidItem.outlookEventId` end-to-end, a `raidToGraphEvent` builder, a Settings row + RAID-pane enable-toggle/push-button, and a silent auto-sync runner.

**Architecture:** Pure reuse of the SP1 engine (`planEntityReconcile`, `useEntityCalendarPush`, `use-calendar-auto-sync`, type-scoped `AIPM:<pid>:raid` category — `CalendarEntityType` already includes `"raid"`). `RaidPanel` is a thin callback-prop pane, so ALL calendar logic lives in `task-manager.tsx`; the pane receives 5 computed props (`m365Configured`, `calendarRaidEnabled`, `onToggleCalendarRaid`, `pushRaidToOutlook`, `calendarRaidPushBusy`), threaded through `workspace-section-types.ts` → `workspace-section.tsx`.

**Tech Stack:** forked Next.js/React/TS, vitest, Tailwind v4 AIPM tokens. CI: eslint `--max-warnings=0`, `tsc --noEmit` (EN/DE i18n parity), golden byte-stability, axe gate (RAID is scanned).

**Reference (SP1 siblings to mirror — read before mirroring):**
- `Task.outlookEventId` (types.ts:216-area for Milestone; Task equivalent) — the persistence pattern.
- `taskToGraphEvent` (`outlook-calendar-write.ts:53-71`).
- tasks-section calendar toggle+button (`tasks-section.tsx:213-542`).
- integrations calendar section task row (`integrations-section.tsx:313-360`).
- task-manager task auto-sync block (`task-manager.tsx:1768-1799`).

---

## Task 1: Persist `RaidItem.outlookEventId` (6 paths + column + fixtures)

**Files:**
- Modify: `src/app/types.ts` (RaidItem)
- Modify: `src/app/csv-codecs-core.ts:83` (RAID_CSV_COLUMNS), `:314-335` (buildRaidItemFromObj return)
- Modify: `src/app/markdown-codecs-core.ts:55` (RAID_MD_COLUMNS)
- Modify: `src/app/markdown-codecs-decode.ts:406` (markdownToRaid colMap)
- Modify: `src/app/sanitize-records.ts:220-222` (sanitizeRaidItem)
- Regenerate: `src/app/__fixtures__/golden-*`
- Modify: `src/app/sample-workspace-small.csv`, `src/app/sample-workspace-small.md` (RAID rows: append empty column)
- Test: `src/app/sanitize.test.ts` (or `sanitize-records.test.ts`), a storage round-trip test

- [ ] **Step 1: Add the field to `RaidItem`**

In `src/app/types.ts`, inside `export type RaidItem = { … }`, after `documentLinks?: DocumentLink[];` (line ~202), add:
```ts
  /** Outlook calendar event id for this item's review date (calendar write-back
   *  link, keyed on targetDate). App-managed; users never enter it. */
  outlookEventId?: string;
```

- [ ] **Step 2: CSV column + decoder**

`csv-codecs-core.ts` — append to `RAID_CSV_COLUMNS` (after `"documentLinks",` line 103):
```ts
  "outlookEventId",
```
`raidFieldToString` (line 252) default arm `String(r[c] ?? "")` already encodes it — no change.
In `buildRaidItemFromObj` return object (line 334, after `documentLinks: decodeDocumentLinks(obj.documentLinks),`), add:
```ts
    outlookEventId: obj.outlookEventId || undefined,
```
This return path serves BOTH CSV and MD decode (markdownToRaid calls buildRaidItemFromObj).

- [ ] **Step 3: Markdown column + header map**

`markdown-codecs-core.ts` — append to `RAID_MD_COLUMNS` (after `{ key: "documentLinks", label: "DocumentLinks" },` line 75):
```ts
  { key: "outlookEventId", label: "OutlookEventId" },
```
`markdown-codecs-decode.ts` `markdownToRaid` colMap — after the `documentlinks` arm (line 406), add:
```ts
    else if (norm === "outlookeventid") colMap[idx] = "outlookEventId";
```

- [ ] **Step 4: Sanitizer**

`sanitize-records.ts` `sanitizeRaidItem` — before `return item;` (line 223), after the documentLinks block, add (mirrors the milestone sanitizer at lines 95-96):
```ts
  const outlookEventId = typeof o.outlookEventId === "string" ? o.outlookEventId.slice(0, 1024) : "";
  if (outlookEventId) item.outlookEventId = outlookEventId;
```

- [ ] **Step 5: Verify Turso + IDB/JSON need no code**

Turso single+tenant derive DDL/insert from `RAID_CSV_COLUMNS` (now includes the column); `turso-migrate.ts` PRAGMA-diff ALTER-adds it to existing DBs — no edit. IDB (`browser-backend.ts`) + JSON persist the whole `RaidItem` object — grep `browser-backend.ts` for any RAID field allowlist; there is none (whole-object put), so no edit. Confirm by reading, do not change.

- [ ] **Step 6: Write the failing round-trip test**

Add to the storage round-trip suite (find the existing RAID round-trip test: `grep -rn "outlookEventId" src/app/*round-trip* src/app/golden-workspace.test.ts src/app/csv-codecs.test.ts src/app/sanitize*.test.ts` and mirror the Milestone/Task case). Minimal new test in `sanitize` suite:
```ts
it("sanitizeRaidItem preserves outlookEventId (capped 1024)", () => {
  const out = sanitizeRaidItem({ id: 1, title: "R", category: "R", status: "Open", raisedDate: "2026-01-01", outlookEventId: "EVT1" });
  expect(out?.outlookEventId).toBe("EVT1");
  const long = sanitizeRaidItem({ id: 1, title: "R", category: "R", status: "Open", raisedDate: "2026-01-01", outlookEventId: "x".repeat(2000) });
  expect(long?.outlookEventId?.length).toBe(1024);
  const none = sanitizeRaidItem({ id: 1, title: "R", category: "R", status: "Open", raisedDate: "2026-01-01" });
  expect(none?.outlookEventId).toBeUndefined();
});
```
Use the correct default status literal for category "R" (check `statusSetForCategory("R")` first element via `raid.ts`; adjust `"Open"` if needed).

- [ ] **Step 7: Run the test — expect PASS** (field already wired in steps 1-4)

Run: `npx vitest run src/app/sanitize` — expect PASS. If the round-trip golden test now FAILS on byte diff, that is EXPECTED (new column) → proceed to Step 8.

- [ ] **Step 8: Regenerate golden fixtures + sample RAID rows**

The curated master is `sample-workspace-small.md`; the generator emits `.json`/`.sqlite3`/`-big`/`-huge`. The RAID rows in `sample-workspace-small.md` + `.csv` need the new empty column appended (RAID table only). Then:
```bash
npx vite-node scripts/generate-sample-workspace.ts
```
Then regenerate `__fixtures__/golden-*` via the serializers (find the regen command/script: `grep -rn "golden" scripts/ package.json`; there is a fixture-regen path used by prior column adds — mirror it). The ONLY byte delta must be the new empty `outlookEventId`/`OutlookEventId` column on RAID rows. Inspect `git diff --stat` — if any NON-RAID fixture line changed, STOP and investigate (do not mask a format regression).
- Edit `.md`/`.csv` RAID rows by EXACT full-line replacement (MD cells with internal `|` are `\|`-escaped; CSV may have multi-line quoted fields — for `.csv` prefer the app codec round-trip if a naive append is unsafe).

- [ ] **Step 9: Run full byte-stability + sanitize suites**

Run: `npx vitest run src/app/golden-workspace.test.ts src/app/sanitize src/app/csv-codecs src/app/markdown-codecs` — expect PASS.
Run: `npx tsc --noEmit` — expect exit 0.

- [ ] **Step 10: Commit**
```bash
git add -A && git commit -m "feat(calendar): persist RaidItem.outlookEventId across all backends"
```

---

## Task 2: `raidToGraphEvent` builder + active-for-review predicate

**Files:**
- Modify: `src/app/outlook-calendar-write.ts` (after `taskToGraphEvent`, ~line 71)
- Modify: `src/app/raid-review.ts` (export `isRaidActiveForReview`)
- Test: `src/app/outlook-calendar-write.test.ts`, `src/app/raid-review.test.ts`

- [ ] **Step 1: Write the failing `raidToGraphEvent` test**

In `src/app/outlook-calendar-write.test.ts`, add (mirror the `taskToGraphEvent` test):
```ts
import { raidToGraphEvent, categoryFor } from "./outlook-calendar-write";
import type { RaidItem } from "./types";

it("raidToGraphEvent builds an all-day event on targetDate with the raid category", () => {
  const raid = { id: 3, category: "R", title: "Vendor risk", status: "Open",
    raisedDate: "2026-01-01", targetDate: "2026-07-10", owner: "Ana", severity: "High",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [] } as unknown as RaidItem;
  const ev = raidToGraphEvent(raid, "p1");
  expect(ev.isAllDay).toBe(true);
  expect(ev.start.dateTime).toBe("2026-07-10T00:00:00");
  expect(ev.end.dateTime).toBe("2026-07-11T00:00:00");
  expect(ev.subject).toBe("Vendor risk");
  expect(ev.categories).toEqual([categoryFor("p1", "raid")]);
  expect(ev.body.content).toContain("Owner: Ana");
  expect(ev.body.content).toContain("Severity: High");
});
```

- [ ] **Step 2: Run — expect FAIL** (`raidToGraphEvent` not exported)

Run: `npx vitest run src/app/outlook-calendar-write.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `raidToGraphEvent`**

In `src/app/outlook-calendar-write.ts`, after `taskToGraphEvent` (line 71), add (import `RaidItem` in the type import at top of file):
```ts
/**
 * A RAID item as an all-day Graph event on its review date (`targetDate`),
 * tagged with the TYPE-SCOPED "raid" category so its list-based reconcile
 * can't touch task/milestone/committee events. Callers filter to active
 * items WITH a targetDate before calling.
 */
export function raidToGraphEvent(raid: RaidItem, projectId: string): GraphEvent {
  return {
    subject: raid.title,
    isAllDay: true,
    start: { dateTime: `${raid.targetDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(raid.targetDate!)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "raid")],
    body: {
      contentType: "Text",
      content: [
        raid.owner ? `Owner: ${raid.owner}` : "",
        raid.severity ? `Severity: ${raid.severity}` : "",
        raid.status ? `Status: ${raid.status}` : "",
        "Managed by the AIPM PM Tracker.",
      ].filter(Boolean).join("\n"),
    },
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/outlook-calendar-write.test.ts` — expect PASS.

- [ ] **Step 5: Extract `isRaidActiveForReview` (keep review engine green)**

In `src/app/raid-review.ts`, change the private `isActive` (lines 21-23) to an EXPORTED named function and keep all internal call sites using it:
```ts
/** Active for review = not closed and not in a terminal status. Shared by the
 *  review-reminder engine AND the calendar-writeback pane filter so both agree
 *  on which items are pushable. */
export function isRaidActiveForReview(item: RaidItem): boolean {
  return !item.closedDate && !TERMINAL.has(item.status);
}
```
Replace the body's `if (!isActive(item)) continue;` (line 44) with `if (!isRaidActiveForReview(item)) continue;`. No behaviour change.

- [ ] **Step 6: Run review tests — expect PASS (parity)**

Run: `npx vitest run src/app/raid-review.test.ts` — expect PASS (behaviour identical). Add one assertion:
```ts
it("isRaidActiveForReview is false for closed or terminal items", () => {
  expect(isRaidActiveForReview({ closedDate: "2026-01-01", status: "Open" } as RaidItem)).toBe(false);
  expect(isRaidActiveForReview({ status: "Closed" } as RaidItem)).toBe(false);
  expect(isRaidActiveForReview({ status: "Open" } as RaidItem)).toBe(true);
});
```

- [ ] **Step 7: `tsc` + commit**

Run: `npx tsc --noEmit` — expect exit 0.
```bash
git add -A && git commit -m "feat(calendar): raidToGraphEvent + exported isRaidActiveForReview predicate"
```

---

## Task 3: Central Settings row (DRY helper) + i18n

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx:313-360` (extract row helper; render task + raid)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (new: `calendarSyncEntityRaid`)
- Test: `src/app/settings-sections/integrations-section.test.tsx` (if present); i18n parity via tsc

- [ ] **Step 1: Add i18n key `calendarSyncEntityRaid`**

`i18n.ts` — beside `calendarSyncEntityTask`, add `calendarSyncEntityRaid: "RAID items",`.
`i18n.de.ts` — beside the DE `calendarSyncEntityTask`, add `calendarSyncEntityRaid: "RAID-Eintraege",` **via node utf8 write** (Edit corrupts umlauts/CRLF). Use real umlauts → `RAID-Einträge`. Command:
```bash
node -e "const fs=require('fs');let s=fs.readFileSync('src/app/i18n.de.ts','utf8');s=s.replace('calendarSyncEntityTask: \"Aufgaben\",','calendarSyncEntityTask: \"Aufgaben\",\r\n  calendarSyncEntityRaid: \"RAID-Einträge\",');fs.writeFileSync('src/app/i18n.de.ts',s);"
```
(Adjust the EN/DE anchor strings to the actual current values — grep `calendarSyncEntityTask` in both files first; match the DE line's `\r\n` exactly.)

- [ ] **Step 2: Extract a DRY `CalendarSyncRow` helper**

In `integrations-section.tsx`, replace the inline task-row IIFE (lines 315-361) with a reusable local component rendered once per entity. Define ABOVE the section component (or as a module-local function component):
```tsx
function CalendarSyncEntityRow({
  lang, settings, setSettings, entityType, labelKey,
}: {
  lang: Lang; settings: Settings; setSettings: (u: (s: Settings) => Settings) => void;
  entityType: CalendarEntityType; labelKey: string;
}) {
  const sync = calendarSyncFor(settings, entityType);
  const label = t(lang, labelKey);
  const write = (enabled: boolean, auto: boolean) =>
    setSettings((s) => ({
      ...s,
      outlookCalendar: { ...s.outlookCalendar, [entityType]: { enabled, auto } },
    }));
  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 flex flex-col gap-1 pl-1">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox"
            aria-label={`${t(lang, "calendarSyncEnable")} – ${label}`}
            checked={sync.enabled}
            onChange={(e) => write(e.target.checked, e.target.checked ? sync.auto : false)}
            className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green" />
          <span>{t(lang, "calendarSyncEnable")}</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox"
            aria-label={`${t(lang, "calendarSyncAuto")} – ${label}`}
            disabled={!sync.enabled}
            checked={sync.auto}
            onChange={(e) => write(sync.enabled, e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green disabled:opacity-50" />
          <span>{t(lang, "calendarSyncAuto")}</span>
        </label>
      </div>
    </div>
  );
}
```
Match the exact class strings / `setSettings` signature to the current file (copy from the existing task row — the file may use `onChangeSettings` rather than `setSettings`; use whatever prop the section already receives). Then in the section body (where the task IIFE was):
```tsx
<CalendarSyncEntityRow lang={lang} settings={settings} setSettings={setSettings} entityType="task" labelKey="calendarSyncEntityTask" />
<CalendarSyncEntityRow lang={lang} settings={settings} setSettings={setSettings} entityType="raid" labelKey="calendarSyncEntityRaid" />
```
Import `CalendarEntityType` from `../settings-types` and `Settings`/`Lang` as the file already does.

- [ ] **Step 3: Verify tests + tsc**

Run: `npx vitest run src/app/settings-sections/integrations-section` (if a test exists) — expect PASS (task row still renders; raid row added).
Run: `npx tsc --noEmit` — expect exit 0 (EN/DE parity enforced — the new key must exist in BOTH).

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(calendar): Settings calendar-sync raid row via reusable entity-row helper"
```

---

## Task 4: RAID pane toggle + push button + task-manager wiring + auto-sync

**Files:**
- Modify: `src/app/task-manager.tsx` (raid push hooks + auto runner + toggle handler + thread props; mirror lines 1768-1799)
- Modify: `src/app/workspace-section-types.ts` (WorkspaceSectionProps: 5 new optional raid-calendar props)
- Modify: `src/app/workspace-section.tsx` (thread to `<RaidPanel …>`)
- Modify: `src/app/raid-panel.tsx` (RaidPanelProps + toolbar render)
- Test: `src/app/raid-panel.test.tsx`, a task-manager auto-sync raid test (mirror the SP1 task auto test), axe RAID

- [ ] **Step 1: task-manager — raid push hooks + auto runner + toggle**

In `task-manager.tsx`, immediately AFTER the task auto-sync block (after line 1799), add the RAID equivalents. `raid` + `setRaid` are in scope (line 237). Reuse the same `calendarProjectId`, `m365Enabled`, `isPopout`, `lang`, `settings`, `setSettings` the task block uses.
```ts
  // --- RAID review-date calendar write-back (SP2) — mirrors the task block ---
  const raidSync = calendarSyncFor(settings, "raid");
  const calendarRaidEnabled = raidSync.enabled && m365Enabled && !isPopout;
  const raidAutoSyncActive = raidSync.auto && m365Enabled && !isPopout;
  const pushableRaid = useMemo(
    () => raid.filter((r) => isRaidActiveForReview(r) && !!r.targetDate),
    [raid],
  );
  // EXCLUDES outlookEventId — it's an OUTPUT the push writes back (see task block).
  const raidAutoSyncKey = useMemo(
    () => pushableRaid.map((r) => `${r.id}|${r.targetDate}|${r.title}|${r.status}`).join(";"),
    [pushableRaid],
  );
  const setRaidForCalendar = useCallback(
    (updater: (prev: RaidItem[]) => RaidItem[]) => setRaid((prev) => updater([...prev])),
    [setRaid],
  );
  const { pushToOutlook: pushRaidToOutlook, busy: calendarRaidPushBusy } = useEntityCalendarPush<RaidItem>({
    items: pushableRaid, entityType: "raid", projectId: calendarProjectId,
    toGraphEvent: raidToGraphEvent, setItems: setRaidForCalendar,
    isPopout, lang, enabled: calendarRaidEnabled,
  });
  const { pushToOutlook: autoPushRaid } = useEntityCalendarPush<RaidItem>({
    items: pushableRaid, entityType: "raid", projectId: calendarProjectId,
    toGraphEvent: raidToGraphEvent, setItems: setRaidForCalendar,
    isPopout, lang, enabled: raidAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: raidAutoSyncActive, contentKey: raidAutoSyncKey, push: autoPushRaid });
  const onToggleCalendarRaid = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        raid: { enabled, auto: enabled ? (s.outlookCalendar?.raid?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
```
Add imports at top of task-manager: `raidToGraphEvent` from `./outlook-calendar-write`, `isRaidActiveForReview` from `./raid-review`, and `RaidItem` if not already imported. Confirm `calendarProjectId`, `m365Enabled`, `setSettings` names match the task block (grep them; reuse exactly).

- [ ] **Step 2: Thread 5 props into `workspaceProps`**

In the `workspaceProps` object (starts ~line 1805), add:
```ts
    m365Configured: m365Enabled,
    calendarRaidEnabled,
    onToggleCalendarRaid,
    pushRaidToOutlook,
    calendarRaidPushBusy,
```
(If `m365Configured` is already threaded for another panel, reuse the existing name — grep `m365Configured` in workspace-section-types first.)

- [ ] **Step 3: `WorkspaceSectionProps` — declare the props**

In `workspace-section-types.ts`, add to the props type (all OPTIONAL for back-compat + popout):
```ts
  /** M365 configured — gates the RAID calendar toggle/button visibility. */
  m365Configured?: boolean;
  /** RAID calendar write-back enable state + toggle (SP2). */
  calendarRaidEnabled?: boolean;
  onToggleCalendarRaid?: (enabled: boolean) => void;
  pushRaidToOutlook?: () => void;
  calendarRaidPushBusy?: boolean;
```

- [ ] **Step 4: `workspace-section.tsx` — pass to `<RaidPanel>`**

Find the `<RaidPanel … />` render and add:
```tsx
  m365Configured={props.m365Configured}
  calendarEnabled={props.calendarRaidEnabled}
  onToggleCalendar={props.onToggleCalendarRaid}
  onPushCalendar={props.pushRaidToOutlook}
  calendarPushBusy={props.calendarRaidPushBusy}
```

- [ ] **Step 5: `RaidPanelProps` + destructure**

In `raid-panel.tsx` `RaidPanelProps` (line 95), add:
```ts
  /** M365 configured — gates the calendar toggle/button (hidden otherwise). */
  m365Configured?: boolean;
  /** RAID review-date Outlook write-back (SP2). Absent in popouts. */
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
```
Destructure them in `RaidPanelBody({ … })` (line 156-174).

- [ ] **Step 6: Render toggle + button in the RAID toolbar**

In the RAID toolbar (near the `ResetSizeButton`/`PrintButton` cluster, ~line 508 — mirror `tasks-section.tsx:511-541`). Gate on `m365Configured && !isPopout`:
```tsx
{m365Configured && !isPopout && onToggleCalendar && (
  <>
    <label className="flex items-center gap-1.5 text-xs text-foreground">
      <input type="checkbox" checked={!!calendarEnabled}
        onChange={(e) => onToggleCalendar(e.target.checked)}
        aria-label={`${t(lang, "calendarSyncEnable")} – ${t(lang, "calendarSyncEntityRaid")}`}
        className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green" />
      {t(lang, "calendarSyncEnable")}
    </label>
    {calendarEnabled && onPushCalendar && (
      <button type="button" onClick={onPushCalendar} disabled={calendarPushBusy}
        aria-label={t(lang, "calendarPush")} title={t(lang, "calendarPush")}
        className={`rounded-md border border-AIPM-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}>
        {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPush")}
      </button>
    )}
  </>
)}
```
The RAID toolbar aria-label uses `– RAID items` suffix → row-unique vs any other control (RAID is axe-scanned). `INTERACTIVE` is already imported (line 51).

- [ ] **Step 7: Tests — pane + auto runner**

`raid-panel.test.tsx` — add: renders the toggle when `m365Configured` + `onToggleCalendar`; hidden without `m365Configured`; hidden in popout; clicking toggle calls `onToggleCalendar(true)`; Push button appears only when `calendarEnabled`, calls `onPushCalendar`. Mirror the SP1 tasks-section calendar tests.
task-manager auto-sync raid test — mirror the SP1 task auto-sync test (if one exists at task-manager level; else rely on `use-calendar-auto-sync.test` + `use-entity-calendar-push.test` which are already generic). Add a raid case to `use-entity-calendar-push.test.tsx` only if the generic task cases don't already cover the code path (they do — same hook; a raid smoke case is OPTIONAL).

- [ ] **Step 8: Run tests + tsc + axe**

Run: `npx vitest run src/app/raid-panel src/app/use-entity-calendar-push src/app/use-calendar-auto-sync` — expect PASS.
Run: `npx tsc --noEmit` — expect exit 0.
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` — expect PASS (row-unique labels, palette tokens).

- [ ] **Step 9: Commit**
```bash
git add -A && git commit -m "feat(calendar): RAID pane calendar toggle + push button + auto-sync runner"
```

---

## Task 5: Docs, version bump, changelog

**Files:**
- Modify: `AGENTS.md` (extend the "Calendar write-back engine" section with the SP2 RAID entry; also this working tree already carries prior doc edits — keep them)
- Modify: `src/app/version.ts` (APP_VERSION + milestone)
- Modify: `CHANGELOG.md`
- Modify (if a new highlight key is added): `APP_HIGHLIGHT_KEYS` + i18n `versionHighlight*` EN/DE

- [ ] **Step 1: AGENTS.md**

In the "### Calendar write-back engine" section, update the SP-status line: SP2 (RAID review dates) DONE — RAID pushes on `targetDate`; `RaidItem.outlookEventId` (6 paths + column); `raidToGraphEvent`; `isRaidActiveForReview` extracted from `raid-review.ts` (shared pane-filter/engine predicate); `RaidPanel` is a THIN pane so calendar logic lives in `task-manager` + threads 5 props (`m365Configured`/`calendarRaidEnabled`/`onToggleCalendarRaid`/`pushRaidToOutlook`/`calendarRaidPushBusy`) via `workspace-section-types`; Settings row via reusable `CalendarSyncEntityRow`. SP3/SP4 remain.

- [ ] **Step 2: version bump + changelog**

Bump `src/app/version.ts` `APP_VERSION` (next patch/minor — check current) + milestone name (the sci-fi-author sequence). Add a `CHANGELOG.md` entry. If you add a `versionHighlight*` key, append it to `APP_HIGHLIGHT_KEYS` + EN/DE strings (DE via node utf8 write).

- [ ] **Step 3: Full suite + build**

Run: `npx tsc --noEmit && npm run test:run` — expect PASS.
Run: `npm run lint -- --max-warnings=0` — expect PASS (unused import/var is FATAL — re-check after every extract).

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "docs+release(calendar): SP2 RAID review-date write-back; vX.Y.Z"
```

---

## Self-review notes

- **Spec coverage:** targetDate source ✓ (T2/T4 filter), field 6-paths ✓ (T1), engine reuse ✓ (T2/T4), Settings row ✓ (T3), pane toggle+button ✓ (T4), auto runner ✓ (T4), tests+axe ✓ (each task), i18n EN/DE ✓ (T3/T5).
- **Type consistency:** `isRaidActiveForReview` (T2) used in T4 filter; `raidToGraphEvent` (T2) used in T4 hooks; `calendarRaidEnabled`/`onToggleCalendarRaid`/`pushRaidToOutlook`/`calendarRaidPushBusy`/`m365Configured` prop names consistent across task-manager (T1-step2) → WorkspaceSectionProps (T3) → workspace-section (T4) → RaidPanel props `calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy` (T5 destructure). NOTE the rename at the workspace-section→RaidPanel boundary is intentional (pane uses shorter local names); keep it consistent.
- **Landmines carried from SP1:** un-enabling forces `auto:false` (T1-step... T4 toggle); auto-sync key excludes `outlookEventId`; DE i18n via node utf8 write; RAID is axe-scanned (row-unique labels); golden byte diff must be RAID-column-only.
