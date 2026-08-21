# Calendar write-back SP3 (Change decisions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push decided change-control items to Outlook as all-day events on their `decisionDate`, reusing the generic calendar write-back engine.

**Architecture:** Mirror the SP2 RAID slice for the Change entity. New `ChangeItem.outlookEventId?` across 6 persistence paths; `changeToGraphEvent`; a task-manager change calendar block (thin pane) threading 4 new props; a Settings row; one i18n key; release 0.158.0 "Egan".

**Tech Stack:** Next.js (forked) / React 19 / TypeScript / Tailwind v4. Tests: vitest. Spec: `docs/superpowers/specs/2026-07-01-calendar-writeback-sp3-change-design.md`.

**Verification (run after each task):** `npx tsc --noEmit` (type + i18n parity), `npm run test:run`. Final: `npm run lint`, `npm run build`.

---

### Task 1: Persistence — `ChangeItem.outlookEventId`

**Files:**
- Modify: `src/app/types.ts` (ChangeItem)
- Modify: `src/app/csv-codecs-core.ts` (`CHANGES_CSV_COLUMNS`)
- Modify: `src/app/markdown-codecs-core.ts` (`CHANGES_MD_COLUMNS` + change decode arm)
- Modify: `src/app/sanitize-records.ts` (`sanitizeChangeItem`)
- Test: `src/app/sanitize-change.test.ts`
- Regenerate: `__fixtures__/golden-workspace.{csv,md}`, `sample-workspace-small.{csv,md}` + sqlite

- [ ] **Step 1: Failing test** — append to `src/app/sanitize-change.test.ts`:

```ts
it("preserves outlookEventId, capped at 1024", () => {
  const ok = sanitizeChangeItem({ id: 1, title: "t", status: "Approved", decisionDate: "2026-06-09", outlookEventId: "evt-123", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
  expect(ok?.outlookEventId).toBe("evt-123");
  const long = sanitizeChangeItem({ id: 2, title: "t", status: "Approved", outlookEventId: "x".repeat(2000), linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
  expect(long?.outlookEventId?.length).toBe(1024);
  const none = sanitizeChangeItem({ id: 3, title: "t", status: "Proposed", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
  expect(none?.outlookEventId).toBeUndefined();
});
```

- [ ] **Step 2: Run — expect FAIL** (`outlookEventId` not preserved): `npm run test:run -- sanitize-change`

- [ ] **Step 3: types.ts** — in `ChangeItem`, after the `documentLinks?` field:

```ts
  /** Outlook calendar event id for this change's decision-date write-back
   *  (SP3). Set by the push; absent until first synced. */
  outlookEventId?: string;
```

- [ ] **Step 4: csv-codecs-core.ts** — append `"outlookEventId"` to `CHANGES_CSV_COLUMNS` (after `"documentLinks"`). The generic `changeFieldToString` default arm already encodes it.

- [ ] **Step 5: markdown-codecs-core.ts** — append to `CHANGES_MD_COLUMNS`:

```ts
  { key: "outlookEventId", label: "OutlookEventId" },
```

and in the change table decoder's colMap chain (beside `else if (norm === "documentlinks") …`) add:

```ts
      else if (norm === "outlookeventid") mapped["outlookEventId"] = val;
```

- [ ] **Step 6: sanitize-records.ts** — in `sanitizeChangeItem`, beside the other optional-text fields (e.g. after `localModifiedAt`):

```ts
  const oeid = sanitizeText(o.outlookEventId, 1024); if (oeid) item.outlookEventId = oeid;
```

- [ ] **Step 7: Run — expect PASS**: `npm run test:run -- sanitize-change`

- [ ] **Step 8: Regenerate fixtures** — `npx vite-node scripts/generate-sample-workspace.ts` then regenerate golden serializer fixtures (the golden-workspace test's regenerate path). Verify only a new trailing empty `OutlookEventId`/`outlookEventId` column appears; run `npm run test:run -- golden-workspace storage-change-roundtrip`.

- [ ] **Step 9: `npx tsc --noEmit`** — expect clean.

- [ ] **Step 10: Commit** — `feat(calendar): persist ChangeItem.outlookEventId across 6 write paths (SP3)`

---

### Task 2: Event builder — `changeToGraphEvent`

**Files:**
- Modify: `src/app/outlook-calendar-write.ts`
- Test: `src/app/outlook-calendar-write.test.ts`

- [ ] **Step 1: Failing test** — add to `outlook-calendar-write.test.ts`:

```ts
it("changeToGraphEvent: all-day on decisionDate, type-scoped category, body lines", () => {
  const ev = changeToGraphEvent(
    { id: 5, title: "Widen scope", description: "", type: "Scope", status: "Approved", impact: "High", decisionBy: "Elena", decisionDate: "2026-06-09", raisedDate: "2026-05-21", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
    "proj-1",
  );
  expect(ev.isAllDay).toBe(true);
  expect(ev.subject).toBe("Widen scope");
  expect(ev.start.dateTime).toBe("2026-06-09T00:00:00");
  expect(ev.end.dateTime).toBe("2026-06-10T00:00:00");
  expect(ev.categories).toEqual(["AIPM:proj-1:change"]);
  expect(ev.body.content).toContain("Type: Scope");
  expect(ev.body.content).toContain("Impact: High");
  expect(ev.body.content).toContain("Status: Approved");
  expect(ev.body.content).toContain("Decision by: Elena");
});
```

Ensure `changeToGraphEvent` + `ChangeItem` are imported in the test.

- [ ] **Step 2: Run — expect FAIL** (`changeToGraphEvent` undefined): `npm run test:run -- outlook-calendar-write`

- [ ] **Step 3: Implement** — in `outlook-calendar-write.ts`, after `raidToGraphEvent` (import `ChangeItem` in the type imports):

```ts
/**
 * A CHANGE-control item as an all-day Graph event on its DECISION date, tagged
 * with the TYPE-SCOPED "change" category so its list-based reconcile can't touch
 * task/raid/milestone/committee events. Callers filter to changes WITH a
 * decisionDate before calling (decided items only).
 */
export function changeToGraphEvent(change: ChangeItem, projectId: string): GraphEvent {
  return {
    subject: change.title,
    isAllDay: true,
    start: { dateTime: `${change.decisionDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(change.decisionDate!)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "change")],
    body: {
      contentType: "Text",
      content: [
        change.type ? `Type: ${change.type}` : "",
        change.impact ? `Impact: ${change.impact}` : "",
        change.status ? `Status: ${change.status}` : "",
        change.decisionBy ? `Decision by: ${change.decisionBy}` : "",
        "Managed by the AIPM PM Tracker.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };
}
```

- [ ] **Step 4: Run — expect PASS**: `npm run test:run -- outlook-calendar-write`

- [ ] **Step 5: `npx tsc --noEmit`** — expect clean.

- [ ] **Step 6: Commit** — `feat(calendar): changeToGraphEvent for decision-date write-back (SP3)`

---

### Task 3: Settings row + i18n key

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (node utf8 write — NOT Edit)

- [ ] **Step 1: i18n EN** — in `i18n.ts`, beside `calendarSyncEntityRaid`:

```ts
  calendarSyncEntityChange: "Change decisions (decision dates)",
```

- [ ] **Step 2: i18n DE** — add `calendarSyncEntityChange: "Änderungsentscheidungen (Entscheidungstermine)"` to `i18n.de.ts` via a node utf8 script (match the CRLF `\r\n` anchor line of `calendarSyncEntityRaid`; use `\uXXXX` escapes for umlauts). Do NOT use the Edit tool.

- [ ] **Step 3: Settings row** — in `integrations-section.tsx`, after the `entityType="raid"` `<CalendarSyncEntityRow>`:

```tsx
            <CalendarSyncEntityRow
              lang={lang}
              settings={settings}
              onChange={onChange}
              entityType="change"
              labelKey="calendarSyncEntityChange"
            />
```

- [ ] **Step 4: `npx tsc --noEmit`** — expect clean (EN/DE parity enforced).

- [ ] **Step 5: Run** — `npm run test:run -- i18n-encoding` (DE umlaut ban) — expect PASS.

- [ ] **Step 6: Commit** — `feat(calendar): Settings row + i18n for Change calendar sync (SP3)`

---

### Task 4: Wiring — task-manager block + prop chain + change-panel

**Files:**
- Modify: `src/app/task-manager.tsx` (change calendar block + workspaceProps)
- Modify: `src/app/workspace-section-types.ts` (4 new props)
- Modify: `src/app/workspace-section.tsx` (ChangePanel wiring)
- Modify: `src/app/change-panel.tsx` (props + toolbar)
- Test: `src/app/change-panel.test.tsx`

- [ ] **Step 1: Failing test** — add to `change-panel.test.tsx` a describe covering the calendar controls (mirror `raid-panel.test.tsx` cases). Render `ChangePanel` with `m365Configured`, `calendarEnabled`, `onToggleCalendar`, `onPushCalendar`, `calendarPushBusy`:

```tsx
it("renders the calendar Enable checkbox when m365Configured", () => {
  render(<ChangePanel {...base} m365Configured calendarEnabled={false} onToggleCalendar={vi.fn()} />);
  expect(screen.getByLabelText(/change decisions/i)).toBeInTheDocument();
});
it("hides the calendar controls without m365Configured", () => {
  render(<ChangePanel {...base} onToggleCalendar={vi.fn()} />);
  expect(screen.queryByLabelText(/change decisions/i)).toBeNull();
});
it("hides the calendar controls in a popout", () => {
  render(<ChangePanel {...base} isPopout m365Configured calendarEnabled onToggleCalendar={vi.fn()} />);
  expect(screen.queryByLabelText(/change decisions/i)).toBeNull();
});
it("fires onToggleCalendar(true) when ticked", async () => {
  const onToggle = vi.fn();
  render(<ChangePanel {...base} m365Configured calendarEnabled={false} onToggleCalendar={onToggle} />);
  await userEvent.click(screen.getByLabelText(/change decisions/i));
  expect(onToggle).toHaveBeenCalledWith(true);
});
it("shows Push when enabled and fires onPushCalendar", async () => {
  const onPush = vi.fn();
  render(<ChangePanel {...base} m365Configured calendarEnabled onToggleCalendar={vi.fn()} onPushCalendar={onPush} />);
  await userEvent.click(screen.getByRole("button", { name: /push to outlook|calendarPush/i }));
  expect(onPush).toHaveBeenCalled();
});
```

(Use the file's existing `base`/render harness + `ChangePanel` import. Match the real
`calendarPush` label string; check the RAID test for the exact matcher.)

- [ ] **Step 2: Run — expect FAIL**: `npm run test:run -- change-panel`

- [ ] **Step 3: change-panel props** — add to `ChangePanelProps` (mirror RAID):

```ts
  /** M365 configured — gates the calendar toggle/button (hidden otherwise). */
  m365Configured?: boolean;
  /** Change decision-date Outlook write-back (SP3). Absent in popouts. */
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
```

Destructure them in `ChangePanelBody`; ensure `FOCUS_RING`/`TRANSITION`/`INTERACTIVE`
already imported (they are).

- [ ] **Step 4: change-panel toolbar** — after `<PanelViewsControl lang={lang} view="changes" />`, insert the RAID-mirrored block:

```tsx
      {m365Configured && !isPopout && onToggleCalendar && (
        <>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={!!calendarEnabled}
              onChange={(e) => onToggleCalendar(e.target.checked)}
              aria-label={`${t(lang, "calendarSyncEnable")} – ${t(lang, "calendarSyncEntityChange")}`}
              className={`h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
            />
            {t(lang, "calendarSyncEnable")}
          </label>
          {calendarEnabled && onPushCalendar && (
            <button
              type="button"
              onClick={onPushCalendar}
              disabled={calendarPushBusy}
              aria-label={t(lang, "calendarPush")}
              title={t(lang, "calendarPush")}
              className={`rounded-md border border-AIPM-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
            >
              {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPush")}
            </button>
          )}
        </>
      )}
```

Ensure the `ChangePanel` wrapper forwards the new props (it spreads `{...props}` into `ChangePanelBody`).

- [ ] **Step 5: Run — expect PASS**: `npm run test:run -- change-panel`

- [ ] **Step 6: workspace-section-types.ts** — after the RAID calendar props, add:

```ts
  /** Change decision-date Outlook write-back (SP3). Absent in popouts. */
  calendarChangeEnabled?: boolean;
  onToggleCalendarChange?: (enabled: boolean) => void;
  pushChangeToOutlook?: () => void;
  calendarChangePushBusy?: boolean;
```

- [ ] **Step 7: workspace-section.tsx** — destructure the 4 new props; pass to `<ChangePanel>`:

```tsx
              m365Configured={m365Configured}
              calendarEnabled={calendarChangeEnabled}
              onToggleCalendar={onToggleCalendarChange}
              onPushCalendar={pushChangeToOutlook}
              calendarPushBusy={calendarChangePushBusy}
```

- [ ] **Step 8: task-manager.tsx** — after the RAID calendar block (~line 1839), add the change block (mirror exactly; `changeToGraphEvent` imported alongside `raidToGraphEvent`):

```ts
  // --- Change decision-date calendar write-back (SP3) — mirrors the RAID block ---
  const changeSync = calendarSyncFor(settings, "change");
  const calendarChangeEnabled = changeSync.enabled && m365Enabled && !isPopout;
  const changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout;
  const pushableChanges = useMemo(() => changes.filter((c) => !!c.decisionDate), [changes]);
  // EXCLUDES outlookEventId — an OUTPUT the push writes back.
  const changeAutoSyncKey = useMemo(
    () => pushableChanges.map((c) => `${c.id}|${c.decisionDate}|${c.title}|${c.status}`).join(";"),
    [pushableChanges],
  );
  const setChangeForCalendar = useCallback(
    (updater: (prev: ChangeItem[]) => ChangeItem[]) => setChanges((prev) => updater([...prev])),
    [setChanges],
  );
  const { pushToOutlook: pushChangeToOutlook, busy: calendarChangePushBusy } = useEntityCalendarPush<ChangeItem>({
    items: pushableChanges, entityType: "change", projectId: calendarProjectId,
    toGraphEvent: changeToGraphEvent, setItems: setChangeForCalendar,
    isPopout, lang, enabled: calendarChangeEnabled,
  });
  const { pushToOutlook: autoPushChange } = useEntityCalendarPush<ChangeItem>({
    items: pushableChanges, entityType: "change", projectId: calendarProjectId,
    toGraphEvent: changeToGraphEvent, setItems: setChangeForCalendar,
    isPopout, lang, enabled: changeAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: changeAutoSyncActive, contentKey: changeAutoSyncKey, push: autoPushChange });
  const onToggleCalendarChange = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        change: { enabled, auto: enabled ? (s.outlookCalendar?.change?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
```

Then in `workspaceProps`, beside the RAID calendar props:

```ts
    calendarChangeEnabled,
    onToggleCalendarChange,
    pushChangeToOutlook,
    calendarChangePushBusy,
```

Import: add `changeToGraphEvent` to the `outlook-calendar-write` import; ensure
`ChangeItem` is imported in task-manager's `types` import.

- [ ] **Step 9: `npx tsc --noEmit`** — expect clean.

- [ ] **Step 10: Run** — `npm run test:run -- change-panel task-manager` — expect PASS.

- [ ] **Step 11: Commit** — `feat(calendar): wire Change decision-date Outlook write-back (SP3)`

---

### Task 5: Release 0.158.0 "Egan"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (`versionHighlightCalendarChange`)
- Modify: `AGENTS.md`

- [ ] **Step 1: version.ts** — `APP_VERSION = "0.158.0"`, `APP_MILESTONE = "Egan"`, update the milestone comment (Greg Egan), refresh `APP_BUILD_DATE` comment; append `"versionHighlightCalendarChange"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: package.json** — `"version": "0.158.0"`.

- [ ] **Step 3: i18n highlight** — `versionHighlightCalendarChange` EN "Change decisions sync to Outlook on their decision dates" in `i18n.ts`; DE equivalent in `i18n.de.ts` (node utf8 write).

- [ ] **Step 4: CHANGELOG.md** — new `## [0.158.0] - 2026-07-01 "Egan"` entry: Change decision-date Outlook write-back (all-day events on decisionDate; manual + auto per-entity toggle in Changes pane + Settings; `ChangeItem.outlookEventId` persisted).

- [ ] **Step 5: AGENTS.md** — in the calendar write-back section, update the SP list: mark **Change (SP3, v0.158+)** done (decision-date anchor; `ChangeItem.outlookEventId` + `CHANGES_CSV_COLUMNS`/`CHANGES_MD_COLUMNS`; thin pane → logic in task-manager); SP4 (Resource absences) remains.

- [ ] **Step 6: Full gates** — `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run build`. All green.

- [ ] **Step 7: Commit** — `chore(release): 0.158.0 "Egan" — Change decision-date calendar write-back`

---

## Self-review

- Spec coverage: persistence (T1), event builder (T2), settings+i18n (T3), wiring (T4), release (T5) — all spec sections mapped.
- Types: `outlookEventId?: string`, `changeToGraphEvent(change, projectId): GraphEvent`, props `calendarChangeEnabled`/`onToggleCalendarChange`/`pushChangeToOutlook`/`calendarChangePushBusy` (types) → `calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy` (pane boundary) — consistent with SP2 naming.
- Landmines flagged: DE via node utf8 write (T3/T5); auto-key excludes `outlookEventId` (T4); toggle forces `auto:false` on disable (T4); functional `setChanges` bridge (T4); regenerate golden fixtures (T1); no Tailwind-wildcard in any tracked file (concrete `AIPM:proj-1:change` category strings only).
