# Calendar write-back SP4 — Resource absences → Outlook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Push current+future non-sick resource absences to the PM's Outlook calendar as multi-day all-day events, reusing the generic write-back engine — the final entity of the roadmap.

**Architecture:** `Absence.outlookEventId?` persists across 6 write paths (mirror `RaidItem.outlookEventId`, commit `79f8d74e`). New `absenceToGraphEvent` emits a multi-day span. Thin-pane rule: all calendar logic in `task-manager.tsx` (mirror the SP3 Change block at ~line 1841); 4 props threaded to the resources panel toolbar. Settings row + i18n. Release v0.159.0.

**Tech Stack:** Next.js (forked) / React 19 / TypeScript, vitest, Microsoft Graph, Tailwind v4 AIPM tokens.

**Reference template:** `git show 79f8d74e` (RAID column) and the Change SP3 block (`task-manager.tsx:1841-1875`, `change-panel.tsx:389-413`, `integrations-section.tsx:384-390`). NOTE: RAID sanitizer lives in `sanitize-records.ts`; the ABSENCE sanitizer lives in `sanitize-entities.ts` and is tested in `sanitize.test.ts`.

**Execution order / parallelism:** Tasks 1, 2, 3 are file-disjoint and dependency-free → may run in parallel. Task 4 depends on 1 (type), 2 (`absenceToGraphEvent`), 3 (i18n key). Task 5 (release) is last and also edits i18n — never run it concurrently with Task 3.

---

### Task 1: Persist `Absence.outlookEventId` across all backends + fixtures

**Files:**
- Modify: `src/app/types.ts` (Absence type)
- Modify: `src/app/csv-codecs-core.ts` (`ABSENCES_CSV_COLUMNS`)
- Modify: `src/app/markdown-codecs-core.ts` (`ABSENCES_MD_COLUMNS`)
- Modify: `src/app/markdown-codecs-decode.ts` (`markdownToAbsences` colMap)
- Modify: `src/app/sanitize-entities.ts` (`sanitizeAbsence`)
- Test: `src/app/sanitize.test.ts` (absence outlookEventId)
- Test: `src/app/storage-absence-roundtrip.test.ts` (CREATE — mirror `storage-change-roundtrip.test.ts`)
- Modify: `sample-workspace-small.md` (Absences table), `sample-workspace-small.csv` (`# ABSENCES` section)
- Regenerate: `sample-workspace-{small,big,huge}.sqlite3`, `src/app/__fixtures__/golden-workspace.{csv,md}`

- [ ] **Step 1: Write the failing sanitize test**

In `src/app/sanitize.test.ts`, find the absence describe block (search `sanitizeAbsence`) and add:

```ts
  it("preserves outlookEventId and caps it at 1024 chars", () => {
    const base = { id: 1, assignee: "Jane", startDate: "2026-01-01", endDate: "2026-01-05", type: "vacation" };
    expect(sanitizeAbsence({ ...base, outlookEventId: "evt-123" })?.outlookEventId).toBe("evt-123");
    const long = "x".repeat(2000);
    expect(sanitizeAbsence({ ...base, outlookEventId: long })?.outlookEventId).toHaveLength(1024);
    expect(sanitizeAbsence(base)?.outlookEventId).toBeUndefined();
  });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:run -- sanitize.test.ts -t "outlookEventId"`
Expected: FAIL (`outlookEventId` is `undefined`, property not on returned object).

- [ ] **Step 3: Add the field to the `Absence` type**

`src/app/types.ts`, in the `Absence` type after `resourceId?: number;` (line ~384):

```ts
  /** Outlook calendar event id for the pushed absence event (SP4 write-back). */
  outlookEventId?: string;
```

- [ ] **Step 4: Add the CSV column**

`src/app/csv-codecs-core.ts`, append to `ABSENCES_CSV_COLUMNS` (after `"resourceId",` ~line 119):

```ts
  "outlookEventId",
```

(The generic `absenceFieldToString` = `String(a[c] ?? "")` already handles it; Turso single+tenant DDL/insert derive from this list.)

- [ ] **Step 5: Add the Markdown column + decode arm**

`src/app/markdown-codecs-core.ts`, append to `ABSENCES_MD_COLUMNS` (after the `localModifiedAt`/`resourceId` entry ~line 80-90):

```ts
  { key: "outlookEventId", label: "OutlookEventId" },
```

`src/app/markdown-codecs-decode.ts`, in `markdownToAbsences` colMap builder, after the `localModifiedAt` arm (~line 168):

```ts
    else if (norm === "outlookeventid") colMap[idx] = "outlookEventId";
```

- [ ] **Step 6: Sanitize the field**

`src/app/sanitize-entities.ts`, in `sanitizeAbsence`'s returned object (after `resourceId: fkIdOrUndefined(raw.resourceId),` ~line 101):

```ts
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
```

(`sanitizeText` is already imported in this file.)

- [ ] **Step 7: Run the sanitize test — expect PASS**

Run: `npm run test:run -- sanitize.test.ts -t "outlookEventId"`
Expected: PASS.

- [ ] **Step 8: Write the storage round-trip test**

CREATE `src/app/storage-absence-roundtrip.test.ts` (mirror `storage-change-roundtrip.test.ts` structure — open it first for the exact imports/helpers). Assert an absence carrying `outlookEventId` survives CSV and Markdown round-trips, and that `ABSENCES_CSV_COLUMNS` ends with `outlookEventId`:

```ts
import { describe, expect, it } from "vitest";
import { csvToWorkspace, workspaceToCsv, markdownToWorkspace, workspaceToMarkdown } from "./storage";
import { ABSENCES_CSV_COLUMNS } from "./csv-codecs-core";
import type { Workspace } from "./types";
import { emptyWorkspace } from "./storage"; // adjust to the helper used by storage-change-roundtrip.test.ts

function wsWithAbsence(): Workspace {
  return {
    ...emptyWorkspace(),
    absences: [{ id: 1, assignee: "Jane Doe", startDate: "2026-01-05", endDate: "2026-01-09", type: "vacation", outlookEventId: "evt-abc" }],
  };
}

describe("Absence.outlookEventId storage round-trip", () => {
  it("ABSENCES_CSV_COLUMNS ends with outlookEventId", () => {
    expect(ABSENCES_CSV_COLUMNS[ABSENCES_CSV_COLUMNS.length - 1]).toBe("outlookEventId");
  });
  it("survives CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(wsWithAbsence()));
    expect(back.absences[0].outlookEventId).toBe("evt-abc");
  });
  it("survives Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(wsWithAbsence()));
    expect(back.absences[0].outlookEventId).toBe("evt-abc");
  });
});
```

Run: `npm run test:run -- storage-absence-roundtrip.test.ts`
Expected: PASS (if `emptyWorkspace` import differs, copy the exact fixture-builder from `storage-change-roundtrip.test.ts`).

- [ ] **Step 9: Append the column to the curated samples**

Study `git show 79f8d74e -- sample-workspace-small.md sample-workspace-small.csv` for the exact mechanical shape.
- `sample-workspace-small.md`: in the Absences table, append ` OutlookEventId |` to the header row, ` --- |` to the separator row, and ` |` (empty cell) to each absence data row.
- `sample-workspace-small.csv`: in the `# ABSENCES` section, append `,outlookEventId` to that section's header row and a trailing `,` to each absence **record** (NOT each physical line — if any `note` cell is a multi-line quoted field, the comma goes after the record's closing quote). Read the section first to confirm whether notes span lines.

- [ ] **Step 10: Regenerate sqlite + JSON sample artifacts**

Run: `npx vite-node scripts/generate-sample-workspace.ts`
This parses the edited `.md` and re-emits `sample-workspace-small.json` + `.sqlite3` + `-big`/`-huge`. Expected: files updated, no errors.

- [ ] **Step 11: Regenerate golden fixtures**

CREATE a throwaway regen script at the scratchpad path, e.g. `src/app/__fixtures__/_regen.ts` (delete after):

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } from "../storage";
const root = join(import.meta.dirname, "..", "..", "..");
const ws = jsonToWorkspace(readFileSync(join(root, "sample-workspace-small.json"), "utf8"));
writeFileSync(join(import.meta.dirname, "golden-workspace.csv"), workspaceToCsv(ws));
writeFileSync(join(import.meta.dirname, "golden-workspace.md"), workspaceToMarkdown(ws));
console.log("regenerated golden fixtures");
```

Run: `npx vite-node src/app/__fixtures__/_regen.ts` then delete it (`rm src/app/__fixtures__/_regen.ts`).
Verify the diff on `golden-workspace.{csv,md}` is ONLY the new trailing `outlookEventId`/`OutlookEventId` column on the Absences section (`git diff --stat`).

- [ ] **Step 12: Run the full byte-stability + sample suites**

Run: `npm run test:run -- golden-workspace.test.ts sample-workspace-budget.test.ts sample-workspace-stakeholders.test.ts storage-absence-roundtrip.test.ts sanitize.test.ts`
Expected: all PASS.

- [ ] **Step 13: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/types.ts src/app/csv-codecs-core.ts src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/sanitize-entities.ts src/app/sanitize.test.ts src/app/storage-absence-roundtrip.test.ts sample-workspace-small.md sample-workspace-small.csv sample-workspace-small.json sample-workspace-small.sqlite3 sample-workspace-big.sqlite3 sample-workspace-huge.sqlite3 src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md
git commit -m "feat(calendar): persist Absence.outlookEventId across all backends (SP4)"
```

---

### Task 2: `absenceToGraphEvent` engine function

**Files:**
- Modify: `src/app/outlook-calendar-write.ts` (add export after `changeToGraphEvent` ~line 126)
- Test: `src/app/outlook-calendar-write.test.ts` (add absence cases; open it for the existing describe structure)

- [ ] **Step 1: Write the failing test**

In `src/app/outlook-calendar-write.test.ts`, add (mirror the `changeToGraphEvent` tests):

```ts
import { absenceToGraphEvent } from "./outlook-calendar-write";
import type { Absence } from "./types";

describe("absenceToGraphEvent", () => {
  const abs: Absence = { id: 1, assignee: "Jane Doe", startDate: "2026-01-05", endDate: "2026-01-09", type: "vacation", note: "Skiing" };
  it("emits a multi-day all-day event ending the day AFTER endDate (exclusive)", () => {
    const ev = absenceToGraphEvent(abs, "proj-1");
    expect(ev.isAllDay).toBe(true);
    expect(ev.start).toEqual({ dateTime: "2026-01-05T00:00:00", timeZone: "UTC" });
    expect(ev.end).toEqual({ dateTime: "2026-01-10T00:00:00", timeZone: "UTC" });
  });
  it("tags a type-scoped absence category", () => {
    expect(absenceToGraphEvent(abs, "proj-1").categories).toEqual(["AIPM:proj-1:absence"]);
  });
  it("puts assignee and type in the subject", () => {
    expect(absenceToGraphEvent(abs, "proj-1").subject).toBe("Jane Doe – vacation");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:run -- outlook-calendar-write.test.ts -t absenceToGraphEvent`
Expected: FAIL (`absenceToGraphEvent` not exported).

- [ ] **Step 3: Implement**

`src/app/outlook-calendar-write.ts`, after `changeToGraphEvent` (~line 126). Add `Absence` to the `./types` import if not present:

```ts
export function absenceToGraphEvent(absence: Absence, projectId: string): GraphEvent {
  return {
    subject: `${absence.assignee} – ${absence.type}`,
    isAllDay: true,
    start: { dateTime: `${absence.startDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(absence.endDate)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "absence")],
    body: {
      contentType: "Text",
      content: [
        `Type: ${absence.type}`,
        `Assignee: ${absence.assignee}`,
        absence.note ? absence.note : "",
        "Managed by the AIPM PM Tracker.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm run test:run -- outlook-calendar-write.test.ts -t absenceToGraphEvent`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/outlook-calendar-write.ts src/app/outlook-calendar-write.test.ts
git commit -m "feat(calendar): absenceToGraphEvent for multi-day absence write-back (SP4)"
```

---

### Task 3: Settings row + i18n `calendarSyncEntityAbsence`

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx` (4th `CalendarSyncEntityRow`)
- Modify: `src/app/i18n.ts` (EN key)
- Modify: `src/app/i18n.de.ts` (DE key — node utf8 write, NOT the Edit tool)

- [ ] **Step 1: Add the EN i18n key**

`src/app/i18n.ts`, near `calendarSyncEntityChange`:

```ts
  calendarSyncEntityAbsence: "Resource absences (vacation/training dates)",
```

- [ ] **Step 2: Add the DE i18n key (node utf8 write)**

The Edit tool corrupts umlauts + curls quotes in `i18n.de.ts` (CRLF file). Add via node. First find the line with `calendarSyncEntityChange` in `i18n.de.ts`, then insert after it. Run:

```bash
node -e '
const fs=require("fs");
const p="src/app/i18n.de.ts";
let s=fs.readFileSync(p,"utf8");
const anchor=s.match(/[ \t]*calendarSyncEntityChange:.*\r?\n/);
if(!anchor){throw new Error("anchor calendarSyncEntityChange not found");}
const ins="  calendarSyncEntityAbsence: \"Ressourcenabwesenheiten (Urlaubs-/Schulungstermine)\",\r\n";
s=s.replace(anchor[0], anchor[0]+ins);
fs.writeFileSync(p,s,"utf8");
console.log("inserted");
'
```

- [ ] **Step 3: Verify DE umlaut bytes are real (not ASCII subs / mojibake)**

Run: `node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");const m=s.match(/calendarSyncEntityAbsence:.*/);console.log(m[0]);console.log([...m[0]].filter(c=>c.charCodeAt(0)>127).map(c=>c+"="+c.charCodeAt(0)))'`
Expected: prints the line and shows no mojibake; the string uses `ss` (no umlaut needed here) — confirm it matches exactly `Ressourcenabwesenheiten (Urlaubs-/Schulungstermine)`.

- [ ] **Step 4: Add the settings row**

`src/app/settings-sections/integrations-section.tsx`, after the `calendarSyncEntityChange` row (~line 384-390):

```tsx
            <CalendarSyncEntityRow
              entityType="absence"
              settings={settings}
              onChange={onChangeSettings}
              labelKey="calendarSyncEntityAbsence"
            />
```

(Copy the exact prop names from the adjacent change row — match them verbatim.)

- [ ] **Step 5: Typecheck (i18n EN/DE parity is tsc-enforced)**

Run: `npx tsc --noEmit`
Expected: PASS (parity holds — both dicts got the key).

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/settings-sections/integrations-section.tsx
git commit -m "feat(calendar): absence Settings sync row + i18n (SP4)"
```

---

### Task 4: Wire absence calendar push through task-manager → resources panel

**Files:**
- Modify: `src/app/task-manager.tsx` (calendar block + `workspaceProps` + import)
- Modify: `src/app/workspace-section-types.ts` (4 props)
- Modify: `src/app/workspace-section.tsx` (pass to resources panel)
- Modify: `src/app/resources-panel.tsx` (props + `headerActions` controls)
- Test: `src/app/resources-panel.test.tsx` (calendar toggle suite)

- [ ] **Step 1: Add the calendar block in task-manager**

`src/app/task-manager.tsx`, immediately after the `onToggleCalendarChange` block (~line 1875), add (mirror the Change block; `today` is the effective-today ISO string at line 345, `setAbsences` is destructured at line 240):

```tsx
  // --- Absence calendar write-back (SP4) — mirrors the Change block ---
  const absenceSync = calendarSyncFor(settings, "absence");
  const calendarAbsenceEnabled = absenceSync.enabled && m365Enabled && !isPopout;
  const absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout;
  const pushableAbsences = useMemo(
    () => absences.filter((a) => a.type !== "sick" && !!a.startDate && !!a.endDate && a.endDate >= today),
    [absences, today],
  );
  // EXCLUDES outlookEventId — an OUTPUT the push writes back.
  const absenceAutoSyncKey = useMemo(
    () => pushableAbsences.map((a) => `${a.id}|${a.startDate}|${a.endDate}|${a.type}|${a.assignee}`).join(";"),
    [pushableAbsences],
  );
  const setAbsenceForCalendar = useCallback(
    (updater: (prev: Absence[]) => Absence[]) => setAbsences((prev) => updater([...prev])),
    [setAbsences],
  );
  const { pushToOutlook: pushAbsenceToOutlook, busy: calendarAbsencePushBusy } = useEntityCalendarPush<Absence>({
    items: pushableAbsences, entityType: "absence", projectId: calendarProjectId,
    toGraphEvent: absenceToGraphEvent, setItems: setAbsenceForCalendar,
    isPopout, lang, enabled: calendarAbsenceEnabled,
  });
  const { pushToOutlook: autoPushAbsence } = useEntityCalendarPush<Absence>({
    items: pushableAbsences, entityType: "absence", projectId: calendarProjectId,
    toGraphEvent: absenceToGraphEvent, setItems: setAbsenceForCalendar,
    isPopout, lang, enabled: absenceAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: absenceAutoSyncActive, contentKey: absenceAutoSyncKey, push: autoPushAbsence });
  const onToggleCalendarAbsence = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        absence: { enabled, auto: enabled ? (s.outlookCalendar?.absence?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
```

- [ ] **Step 2: Import `absenceToGraphEvent` and ensure `Absence` type is imported**

`src/app/task-manager.tsx` line ~72:

```ts
import { taskToGraphEvent, raidToGraphEvent, changeToGraphEvent, absenceToGraphEvent } from "./outlook-calendar-write";
```

Confirm `Absence` and `useMemo`/`useCallback` are already imported (they are — grep to be sure).

- [ ] **Step 3: Thread the 4 props into `workspaceProps`**

`src/app/task-manager.tsx`, in the `workspaceProps` object after `calendarChangePushBusy,` (~line 1905):

```tsx
    calendarAbsenceEnabled,
    onToggleCalendarAbsence,
    pushAbsenceToOutlook,
    calendarAbsencePushBusy,
```

- [ ] **Step 4: Add the props to the contract**

`src/app/workspace-section-types.ts`, near the change calendar props:

```ts
  calendarAbsenceEnabled?: boolean;
  onToggleCalendarAbsence?: (enabled: boolean) => void;
  pushAbsenceToOutlook?: () => void;
  calendarAbsencePushBusy?: boolean;
```

- [ ] **Step 5: Destructure + pass through workspace-section**

`src/app/workspace-section.tsx`: destructure the 4 new props from props, then on the resources `ResourcesPanel` mount (the `activeTab === "resources"` block ~line 546-560) pass, renamed at the boundary:

```tsx
              m365Configured={m365Configured}
              calendarEnabled={calendarAbsenceEnabled}
              onToggleCalendar={onToggleCalendarAbsence}
              onPushCalendar={pushAbsenceToOutlook}
              calendarPushBusy={calendarAbsencePushBusy}
```

(`m365Configured` is already threaded for RAID/Change — reuse the same destructured var.)

- [ ] **Step 6: Add props to resources-panel + render controls in `headerActions`**

`src/app/resources-panel.tsx`:

(a) In `ResourcePlannerProps` (the props interface ~line 72-95), add:

```ts
  m365Configured?: boolean;
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
```

(b) Destructure them in the component signature (near `onAddAbsence,` ~line 133).

(c) In the `headerActions` JSX (~line 292-311), before `<ResetSizeButton …/>`, insert (mirror `change-panel.tsx:389-413`; `isPopout` is available in this panel — confirm, else thread it):

```tsx
      {m365Configured && !isPopout && onToggleCalendar && (
        <>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={!!calendarEnabled}
              onChange={(e) => onToggleCalendar(e.target.checked)}
              aria-label={`${t(lang, "calendarSyncEnable")} – ${t(lang, "calendarSyncEntityAbsence")}`}
              className="h-4 w-4 accent-AIPM-green"
            />
            {t(lang, "calendarSyncEnable")}
          </label>
          {calendarEnabled && onPushCalendar && (
            <button
              type="button"
              onClick={onPushCalendar}
              disabled={calendarPushBusy}
              className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-50 ${INTERACTIVE}`}
            >
              {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPush")}
            </button>
          )}
        </>
      )}
```

Match the exact class strings and label markup to `change-panel.tsx` for consistency (copy from there).

- [ ] **Step 7: Write the resources-panel calendar toggle test**

`src/app/resources-panel.test.tsx`, add (mirror `change-panel.test.tsx:108-167`; use the panel's existing render helper/`base` props):

```tsx
describe("ResourcesPanel — Outlook calendar toggle (SP4)", () => {
  const calLabel = `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityAbsence")}`;
  it("renders the toggle when m365Configured and a handler is given", () => {
    const { getByLabelText } = renderPanel({ m365Configured: true, onToggleCalendar: vi.fn() });
    expect(getByLabelText(calLabel)).toBeTruthy();
  });
  it("does NOT render the toggle without m365Configured", () => {
    const { queryByLabelText } = renderPanel({ m365Configured: false, onToggleCalendar: vi.fn() });
    expect(queryByLabelText(calLabel)).toBeNull();
  });
  it("hides the toggle in popout", () => {
    const { queryByLabelText } = renderPanel({ m365Configured: true, isPopout: true, onToggleCalendar: vi.fn() });
    expect(queryByLabelText(calLabel)).toBeNull();
  });
  it("calls onToggleCalendar(true) when ticked", () => {
    const onToggleCalendar = vi.fn();
    const { getByLabelText } = renderPanel({ m365Configured: true, onToggleCalendar });
    fireEvent.click(getByLabelText(calLabel));
    expect(onToggleCalendar).toHaveBeenCalledWith(true);
  });
  it("shows Push only when calendarEnabled and calls onPushCalendar", () => {
    const onPushCalendar = vi.fn();
    const { queryByRole, getByRole } = renderPanel({ m365Configured: true, onToggleCalendar: vi.fn(), calendarEnabled: true, onPushCalendar });
    fireEvent.click(getByRole("button", { name: t("en-US", "calendarPush") }));
    expect(onPushCalendar).toHaveBeenCalledTimes(1);
  });
});
```

Adapt `renderPanel`/`base` to the file's existing test harness (open `resources-panel.test.tsx` first; reuse its render helper and default props object).

- [ ] **Step 8: Run tests**

Run: `npm run test:run -- resources-panel.test.tsx task-manager` (and any workspace-section test that renders the panel)
Expected: PASS.

- [ ] **Step 9: Typecheck + lint + Resources axe gate**

```bash
npx tsc --noEmit
npm run lint
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"
```
Expected: all PASS (Resources IS axe-scanned; the new checkbox + button are labeled).

- [ ] **Step 10: Commit**

```bash
git add src/app/task-manager.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "feat(calendar): wire absence Outlook write-back through resources panel (SP4)"
```

---

### Task 5: Release v0.159.0

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (`versionHighlightCalendarAbsence`)
- Modify: `AGENTS.md` (SP4 done + roadmap COMPLETE)
- Modify: memory `calendar-writeback-roadmap.md` + `MEMORY.md`

- [ ] **Step 1: Pick an unused milestone codename**

Run: `git log --all --oneline | grep -ioE '"[A-Z][a-z]+"' | sort -u` and pick a sci-fi/fantasy author surname NOT already used (verify the chosen name returns no hits: `grep -rn "MILESTONE.*<Name>" src/app/version.ts CHANGELOG.md`). Suggested candidates to check: "Herbert" (used — reject), "Bear", "Gibson", "Zelazny", "Vance". Confirm zero prior use before choosing.

- [ ] **Step 2: Bump version.ts**

`src/app/version.ts`: set `APP_VERSION = "0.159.0"`, update `APP_BUILD_DATE` comment + `APP_MILESTONE`, and append to `APP_HIGHLIGHT_KEYS` (after `"versionHighlightCalendarChange",`):

```ts
  "versionHighlightCalendarAbsence",
```

- [ ] **Step 3: Bump package.json**

Set `"version": "0.159.0"`.

- [ ] **Step 4: Add the highlight i18n keys**

`src/app/i18n.ts`:

```ts
  versionHighlightCalendarAbsence: "Resource absences sync to Outlook as multi-day calendar events",
```

`src/app/i18n.de.ts` via node (umlaut-safe), anchored on `versionHighlightCalendarChange`:

```bash
node -e '
const fs=require("fs");const p="src/app/i18n.de.ts";let s=fs.readFileSync(p,"utf8");
const a=s.match(/[ \t]*versionHighlightCalendarChange:.*\r?\n/);
if(!a)throw new Error("anchor not found");
const ins="  versionHighlightCalendarAbsence: \"Ressourcenabwesenheiten werden als mehrtaegige Outlook-Termine synchronisiert\",\r\n".replace("mehrtaegige","mehrtägige");
s=s.replace(a[0], a[0]+ins);fs.writeFileSync(p,s,"utf8");console.log("ok");'
```

Verify: `node -e 'console.log(require("fs").readFileSync("src/app/i18n.de.ts","utf8").match(/versionHighlightCalendarAbsence:.*/)[0])'` — confirm real `ä` (U+00E4) in `mehrtägige`, no mojibake.

- [ ] **Step 5: CHANGELOG entry**

`CHANGELOG.md`, new top entry:

```markdown
## [0.159.0] - 2026-07-01 "<Codename>"

### Added
- **Resource absence calendar write-back (SP4).** Current and upcoming resource absences (excluding sick leave) push to the authenticated user's Outlook calendar as multi-day all-day events on their date range. Manual push + optional auto-sync toggle in the Resources view and Settings → Integrations. Completes the generic Outlook calendar write-back roadmap (tasks · RAID · changes · absences).
```

- [ ] **Step 6: Update AGENTS.md**

In the "Calendar write-back engine" section, mark SP4 done (absence `outlookEventId` column, `absenceToGraphEvent` multi-day span, thin-pane wiring, sick-excluded/current+future predicate) and note the roadmap is COMPLETE.

- [ ] **Step 7: Update memory**

`~/.claude/projects/C--Projects-lop-app/memory/calendar-writeback-roadmap.md`: mark SP4 done + roadmap COMPLETE; update `MEMORY.md` pointer line.

- [ ] **Step 8: Verify + commit**

```bash
npx tsc --noEmit
npm run test:run
git add src/app/version.ts package.json CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts AGENTS.md
git commit -m "chore(release): 0.159.0 \"<Codename>\" — resource absence calendar write-back (SP4)"
```

- [ ] **Step 9: Full release chain** (only on the "release" trigger)

push → open MR → arm auto-merge → poll pipeline → merge on green → sync local main. Token via `git credential fill`, never echoed, scrubbed after.

---

## Self-review notes
- **Spec coverage:** event span (T2), pushable predicate incl. sick-exclusion (T4 step 1), 6 persistence paths + fixtures (T1), engine (T2), task-manager wiring (T4), prop plumbing (T4), settings row (T3), i18n (T3+T5), release (T5). All covered.
- **Type consistency:** `absenceToGraphEvent(absence, projectId)`, `pushableAbsences`, `absenceAutoSyncKey`, `setAbsenceForCalendar`, `pushAbsenceToOutlook`, `calendarAbsencePushBusy`, `onToggleCalendarAbsence`, `calendarAbsenceEnabled` — consistent across T2/T4/T5. Pane-boundary rename to `calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy`/`m365Configured` matches change-panel exactly.
- **Placeholders:** none — `<Codename>` is a deliberate release-time choice with a verification step.
