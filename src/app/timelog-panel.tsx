"use client";
// src/app/timelog-panel.tsx
// User-facing Timelog integration view: people/project matching tables, KPI
// tiles, and the apply-to-budget flow. Consumes only pure engines + context —
// no direct API calls in render; all network happens inside event handlers.
import { useMemo, useState } from "react";
import { t, type Lang } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useSettings } from "./use-settings";
import { useToastContext } from "./toast-context";
import { logDiag } from "./diagnostics";
import { reportSilentFailure } from "./guard-feedback";
import { useTimelogSync } from "./use-timelog-sync";
import { autoMatchUsers, autoMatchProjects, type TimelogProjectRef } from "./timelog-match";
import { useRowSelection } from "./use-row-selection";
import { Modal } from "./modal";
import { planApply, applyActualsToBuckets } from "./timelog-apply";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { defaultTimelogConfig, type TimelogLinks } from "./timelog-types";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { useConfirm } from "./confirm-dialog";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { Tile } from "./report-table";
import { useResizable } from "./use-resizable";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";

// People-table column widths (px) — drag-resizable, persisted per device.
const PEOPLE_COL_WIDTHS = {
  select: 40,
  people: 240,
  resources: 180,
  status: 90,
  clear: 90,
  remove: 64,
} as const;
type PeopleCol = keyof typeof PEOPLE_COL_WIDTHS;

/** Wildcard customer-name match: `*` is a wildcard, everything else literal. */
function customerMatcher(query: string): (name: string) => boolean {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  const escaped = q.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  const re = new RegExp(escaped, "i");
  return (name: string) => re.test(name);
}

export function TimelogPanel({ lang, isPopout = false }: { lang: Lang; isPopout?: boolean }) {
  const ws = useWorkspace();
  const { settings, setSettings } = useSettings();
  const showToast = useToastContext();
  const confirm = useConfirm();
  const cfg = settings.timelog ?? defaultTimelogConfig;

  // Stable references hoisted out of useMemo deps to avoid obj.member lint errors
  const timelogLinks = ws.timelogLinks;
  const budgets = ws.budgets;
  const resources = ws.resources;
  const planGranularity = ws.plan?.granularity ?? "month";

  const links: TimelogLinks = useMemo(
    () => timelogLinks ?? { userLinks: [], projectLinks: [] },
    [timelogLinks],
  );
  const projectId = ws.project?.code ?? "default";
  const creds = useMemo(
    () => ({ host: cfg.host, tenant: cfg.tenant, token: cfg.apiToken }),
    [cfg.host, cfg.tenant, cfg.apiToken],
  );

  const sync = useTimelogSync({
    creds,
    links,
    resources,
    budgets,
    scopeMode: cfg.scopeMode,
    granularity: planGranularity,
    projectId,
    isPopout,
    onTokenInvalid: () => {
      const at = new Date().toISOString();
      setSettings((s) => ({
        ...s,
        timelog: { ...(s.timelog ?? defaultTimelogConfig), tokenInvalidAt: at },
      }));
    },
    onTokenValid: () => {
      if (cfg.tokenInvalidAt) {
        setSettings((s) => {
          const tl = s.timelog ?? defaultTimelogConfig;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { tokenInvalidAt, ...rest } = tl;
          return { ...s, timelog: rest };
        });
      }
    },
  });

  // People + project rows come from the sync hook (and its per-project cache, so
  // they survive a view remount). `sync.users` is the displayable directory;
  // `sync.projectRefs` are distinct projects seen in the latest fetch (lets
  // brand-new, never-linked Timelog projects appear and be matched), MERGED with
  // any already-linked projects not present in that fetch (so prior mappings
  // still render even when no current bookings reference them).
  const fetchedUsers = sync.users;

  // Per-device collapse of the People section: the directory can be the whole
  // org, so folding it lets the Projects section rise into view.
  const peopleCollapsed = settings.timelogPeopleCollapsed === true;

  // Multi-select for bulk-removing fetched people from the matching table.
  const sel = useRowSelection();

  // Resizable content pane + per-device People-table column widths (mirrors the
  // Resource Directory), with reset buttons in the header.
  const { ref: paneRef, reset: resetPaneSize } = useResizable("lop-app:timelog-size");
  const { colWidths, startColResize: startColResizeTyped, resetColWidths } = useColumnResize<PeopleCol>(
    "timelog-people",
    PEOPLE_COL_WIDTHS,
  );
  const startColResize = startColResizeTyped as (col: string, e: React.MouseEvent) => void;

  function removeUsers(ids: readonly number[]) {
    if (isPopout || ids.length === 0) return;
    sync.removeUsers(ids);
    sel.clear();
  }

  async function clearAllFetched() {
    if (isPopout) return;
    if (!(await confirm({ message: t(lang, "timelogClearAllConfirm") }))) return;
    sync.clearAll();
    sel.clear();
  }

  function setLinks(next: TimelogLinks) {
    ws.setTimelogLinks(sanitizeTimelogLinks(next) ?? { userLinks: [], projectLinks: [] });
  }

  function manualLinkUser(timelogUserId: number, resourceId: number | null) {
    if (isPopout) return;
    const rest = links.userLinks.filter((l) => l.timelogUserId !== timelogUserId);
    setLinks({
      ...links,
      userLinks:
        resourceId === null
          ? rest
          : [...rest, { timelogUserId, resourceId, manual: true }],
    });
  }

  function manualLinkProject(timelogProjectId: number, bucketId: number | null) {
    if (isPopout) return;
    const rest = links.projectLinks.filter((l) => l.timelogProjectId !== timelogProjectId);
    setLinks({
      ...links,
      // Mirror manualLinkUser: a null bucket (Clear) REMOVES the link rather than
      // persisting a null-bucketId tombstone.
      projectLinks: bucketId === null ? rest : [...rest, { timelogProjectId, bucketId, manual: true }],
    });
  }

  // Hoist obj.member values to scalar locals before any useMemo dep array.
  const projectLinks = links.projectLinks;
  const fetchedProjectRefs = sync.projectRefs;

  // Derive effective user matches (auto + manual, manual wins)
  const effectiveUserLinks = useMemo(
    () => autoMatchUsers(fetchedUsers, resources, links),
    [fetchedUsers, resources, links],
  );

  // Merge fetched project refs with any already-linked projects absent from the
  // latest fetch (synthetic placeholder name = the id) so prior maps still show.
  const knownProjectRefs = useMemo((): TimelogProjectRef[] => {
    const seen = new Set(fetchedProjectRefs.map((r) => r.id));
    const merged: TimelogProjectRef[] = [...fetchedProjectRefs];
    for (const l of projectLinks) {
      if (!seen.has(l.timelogProjectId)) {
        merged.push({ id: l.timelogProjectId, name: String(l.timelogProjectId), no: "" });
      }
    }
    return merged;
  }, [fetchedProjectRefs, projectLinks]);

  const effectiveProjectLinks = useMemo(
    () => autoMatchProjects(knownProjectRefs, budgets, links),
    [knownProjectRefs, budgets, links],
  );

  // KPI values
  const overlay = sync.aggregates?.byBucket;
  const syncAggregates = sync.aggregates;

  const byResource = useMemo(
    () => syncAggregates?.byResource ?? {},
    [syncAggregates],
  );
  const unattributed = useMemo(
    () => syncAggregates?.unattributed ?? { hours: 0, billableHours: 0 },
    [syncAggregates],
  );

  const bookedHours = useMemo(
    () => Object.values(byResource).reduce((s, c) => s + c.hours, 0),
    [byResource],
  );

  const billableHours = useMemo(
    () => Object.values(byResource).reduce((s, c) => s + c.billableHours, 0),
    [byResource],
  );

  const billablePct = bookedHours > 0 ? Math.round((billableHours / bookedHours) * 100) : 0;

  // Apply-to-budget diff
  // `pendingApply` is snapshotted at confirm-open time so the shown diff count
  // and the actually-applied overlay are always the same value (TOCTOU guard).
  const [confirming, setConfirming] = useState(false);
  const [pendingApply, setPendingApply] = useState<import("./timelog-actuals").ActualsByBucket | null>(null);

  const applyDiff = useMemo(
    () => (pendingApply ? planApply(budgets, pendingApply) : overlay ? planApply(budgets, overlay) : []),
    [pendingApply, overlay, budgets],
  );

  function openConfirm() {
    if (!overlay) return;
    setPendingApply(overlay);
    setConfirming(true);
  }

  function applyToBudget() {
    if (!pendingApply) return;
    ws.setBudgets((prev) => applyActualsToBuckets(prev, pendingApply));
    setConfirming(false);
    setPendingApply(null);
  }

  function cancelConfirm() {
    setConfirming(false);
    setPendingApply(null);
  }

  // new Date() lives in these callbacks (never in render). Two-step fetch:
  // (1) Load people = directory only (cheap); (2) Fetch bookings = timesheets,
  // org scope scoped to the TICKED people so the request count stays under the
  // rate limit. Errors surface via `sync.error` below.
  function fetchWindow(): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start =
      ws.project?.startDate ??
      new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { start, end };
  }

  async function handleLoadPeople() {
    if (isPopout || sync.busy) return;
    await sync.loadDirectory();
  }

  const [includeClosedProjects, setIncludeClosedProjects] = useState(false);
  const [projectCustomerId, setProjectCustomerId] = useState<number | "">("");
  const [customerFilter, setCustomerFilter] = useState("");
  // Wildcard-filtered customer options; keep the current selection present even
  // when filtered out so the <select> value still resolves.
  const customerOptions = useMemo(() => {
    const match = customerMatcher(customerFilter);
    const list = sync.customers.filter((c) => match(c.name));
    if (projectCustomerId !== "" && !list.some((c) => c.id === projectCustomerId)) {
      const sel = sync.customers.find((c) => c.id === projectCustomerId);
      if (sel) return [sel, ...list];
    }
    return list;
  }, [sync.customers, customerFilter, projectCustomerId]);
  async function handleLoadManagedProjects() {
    if (isPopout || sync.busy) return;
    await sync.loadManagedProjects(
      includeClosedProjects,
      projectCustomerId === "" ? undefined : projectCustomerId,
    );
  }

  async function handleFetchBookings() {
    if (isPopout || sync.busy) return;
    const { start, end } = fetchWindow();
    const result = await sync.fetchBookings(start, end, [...sel.selectedIds]);
    // Org/team scope fails soft per-employee (rate-limit friendly) — surface the
    // count here so a partial fetch isn't a silent short total. Direct
    // logDiag+showToast (not reportSilentFailure): the message interpolates
    // the count via `{0}`, which reportSilentFailure's fixed msgKey can't do.
    if (result && result.failedEmployees > 0) {
      logDiag("warn", "timelog.partialFetch", { failedEmployees: result.failedEmployees });
      showToast("error", t(lang, "guardTimelogPartialFetch", result.failedEmployees));
    }
  }

  // Client-side narrowing of the loaded directory (text box above the table).
  const [peopleFilter, setPeopleFilter] = useState("");
  const filteredUsers = useMemo(() => {
    const q = peopleFilter.trim().toLowerCase();
    if (!q) return fetchedUsers;
    return fetchedUsers.filter((u) =>
      `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q),
    );
  }, [fetchedUsers, peopleFilter]);
  const visibleFilteredIds = useMemo(() => filteredUsers.map((u) => u.userId), [filteredUsers]);

  const isMisconfigured = !cfg.enabled || !cfg.host || !cfg.apiToken;

  return (
    <div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {/* Header — the title was removed; the "enable Timelog" notice takes the
          left slot when misconfigured so the button row stays right-aligned. */}
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        {isMisconfigured ? (
          <p className="text-sm text-muted-foreground">{t(lang, "timelogEnable")}</p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={sync.busy || isPopout || !sync.fetchedAt || confirming}
            onClick={clearAllFetched}
            className={`rounded-md border border-AIPM-pink/50 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "clearAll")}
          </button>
          <button
            type="button"
            disabled={sync.busy || isPopout || isMisconfigured || confirming}
            onClick={() => void handleLoadPeople()}
            className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "timelogLoadPeople")}
          </button>
          <button
            type="button"
            disabled={sync.busy || isPopout || isMisconfigured || confirming}
            onClick={() => void handleFetchBookings()}
            className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
          >
            {sync.busy
              ? t(lang, "loadingTimelog")
              : `${t(lang, "timelogSync")}${sel.count > 0 ? ` (${sel.count})` : ""}`}
          </button>
          <PrintButton lang={lang} />
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetPaneSize} lang={lang} />
        </div>
      </div>

      {/* Token-invalid warning */}
      {cfg.tokenInvalidAt && (
        <p className="mb-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          {t(lang, "timelogTokenInvalid")}
        </p>
      )}

      {/* Fetch error from the sync hook. Auth failures (401/403) show the
          token-invalid message; any other truthy status shows a generic failure. */}
      {sync.error && (
        <p className="mb-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          {sync.error === 401 || sync.error === 403
            ? t(lang, "timelogTokenInvalid")
            : t(lang, "timelogTestFail", sync.error && sync.error > 0 ? String(sync.error) : "?")}
        </p>
      )}

      {/* Last synced + unattributed */}
      {sync.fetchedAt && (
        <p className="mb-3 text-xs text-muted-foreground">
          {t(lang, "timelogLastSynced", sync.fetchedAt)}{" "}
          {t(lang, "timelogUnattributed", String(Math.round(unattributed.hours)))}
        </p>
      )}

      {/* Scrollable body: the fixed-height pane is overflow-hidden, so KPIs +
          People + Projects + Apply share one inner scroller — otherwise a tall
          People list clips Projects/Apply below the fold with no way to reach
          them. Collapsing People (below) frees vertical space. */}
      <div className="min-h-0 flex-1 overflow-auto pr-2">
      {/* KPI tiles */}
      <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tile
          label={t(lang, "timelogKpiBooked")}
          value={`${Math.round(bookedHours)} h`}
        />
        <Tile
          label={t(lang, "timelogKpiBillable")}
          value={`${billablePct} %`}
        />
        <Tile
          label={t(lang, "timelogKpiWinLoss")}
          value={`${Math.round(unattributed.hours)} h`}
        />
      </div>

      {/* PM requirement note — "Load my projects" filters on the TimeLog Project
          Manager role; a non-PM user gets no managed projects. */}
      <p className="mb-6 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
        {t(lang, "timelogPmNote")}
      </p>

      {/* People matching table */}
      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, timelogPeopleCollapsed: !s.timelogPeopleCollapsed }))}
            aria-expanded={!peopleCollapsed}
            aria-controls="timelog-people-region"
            title={t(lang, peopleCollapsed ? "timelogPeopleExpand" : "timelogPeopleCollapse")}
            className={`flex items-center gap-1.5 rounded-md ${FOCUS_RING} ${TRANSITION}`}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className={`h-4 w-4 transition-transform ${peopleCollapsed ? "-rotate-90" : ""}`}>
              <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t(lang, "timelogMatchPeople")}
          </button>
        </h3>
        {/* Kept mounted + `hidden`-toggled (not unmounted) so the aria-controls
            target always exists AND the table still prints when collapsed
            (print:block overrides [hidden]). Mirrors action-reasons.tsx. */}
        <div id="timelog-people-region" hidden={peopleCollapsed} className="print:block">
        {/* Attribution hint — shown only while some fetched hours are unattributed
            (the user/project links explain why those hours aren't booked yet). */}
        {unattributed.hours > 0 && (
          <p className="mb-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            {t(lang, "timelogAttributionHint")}
          </p>
        )}
        {fetchedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "timelogMatchNone")}</p>
        ) : (
          <>
            {/* Narrow the loaded directory before ticking who to fetch bookings for. */}
            <input
              type="search"
              value={peopleFilter}
              onChange={(e) => setPeopleFilter(e.target.value)}
              placeholder={t(lang, "timelogPeopleFilter")}
              aria-label={t(lang, "timelogPeopleFilter")}
              className={`mb-2 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground print:hidden ${FOCUS_RING} ${TRANSITION}`}
            />
            {/* Bulk-remove bar — self-hides at zero selection */}
            {sel.count > 0 && !isPopout && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5 print:hidden">
                <span className="text-xs font-medium text-foreground">
                  {t(lang, "selectionCount", String(sel.count))}
                </span>
                <button
                  type="button"
                  onClick={() => removeUsers([...sel.selectedIds])}
                  className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-AIPM-pink-strong hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {t(lang, "remove")}
                </button>
                <button
                  type="button"
                  onClick={sel.clear}
                  className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
                >
                  {t(lang, "clearSelection")}
                </button>
              </div>
            )}
            {/* The outer body scroller handles vertical overflow; this wrapper
                only needs horizontal scroll for the wide table. Collapsing the
                whole People section (heading toggle) is how a big org directory
                is kept from burying Projects. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={TABLE_HEAD_CLASS}>
                  <tr>
                    <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.select, minWidth: colWidths.select }}>
                      <input
                        type="checkbox"
                        aria-label={t(lang, "selectAllVisibleRows")}
                        disabled={isPopout}
                        checked={sel.allSelected(visibleFilteredIds)}
                        onChange={() => sel.toggleAllVisible(visibleFilteredIds)}
                        className={`align-middle ${FOCUS_RING}`}
                      />
                      <ColumnResizeHandle col="select" onMouseDown={startColResize} />
                    </th>
                    <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.people, minWidth: colWidths.people }}>
                      {t(lang, "timelogMatchPeople")}
                      <ColumnResizeHandle col="people" onMouseDown={startColResize} />
                    </th>
                    <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.resources, minWidth: colWidths.resources }}>
                      {t(lang, "tabResources")}
                      <ColumnResizeHandle col="resources" onMouseDown={startColResize} />
                    </th>
                    <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.status, minWidth: colWidths.status }}>
                      {t(lang, "status")}
                      <ColumnResizeHandle col="status" onMouseDown={startColResize} />
                    </th>
                    <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.clear, minWidth: colWidths.clear }}>
                      {t(lang, "timelogMatchClear")}
                      <ColumnResizeHandle col="clear" onMouseDown={startColResize} />
                    </th>
                    <th scope="col" className="px-2 py-1 text-left" style={{ width: colWidths.remove, minWidth: colWidths.remove }}>
                      {t(lang, "remove")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const link = effectiveUserLinks.find((l) => l.timelogUserId === u.userId);
                    const displayId = u.email || String(u.userId);
                    const selectLabel = `${t(lang, "timelogMatchPeople")} – ${displayId}`;
                    const clearLabel = `${t(lang, "timelogMatchClear")} – ${displayId}`;
                    const rowSelectLabel = t(lang, "selectItem", displayId);
                    const removeLabel = `${t(lang, "remove")} – ${displayId}`;
                    return (
                      <tr key={u.userId} className="border-b border-line last:border-0">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            aria-label={rowSelectLabel}
                            disabled={isPopout}
                            checked={sel.isSelected(u.userId)}
                            onChange={() => sel.toggle(u.userId)}
                            className={`align-middle ${FOCUS_RING}`}
                          />
                        </td>
                        <td className="py-2 pr-3 text-foreground">
                          {u.firstName} {u.lastName}
                          {u.email && (
                            <span className="ml-1 text-xs text-muted-foreground">{u.email}</span>
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            aria-label={selectLabel}
                            value={link?.resourceId ?? ""}
                            disabled={isPopout}
                            onChange={(e) =>
                              manualLinkUser(
                                u.userId,
                                e.target.value === "" ? null : Number(e.target.value),
                              )
                            }
                            className={`rounded border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
                          >
                            <option value="">{t(lang, "timelogMatchNone")}</option>
                            {resources.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.firstName} {r.lastName}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          {link && (
                            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted-foreground">
                              {t(lang, link.manual ? "timelogMatchManual" : "timelogMatchAuto")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          {link && (
                            <button
                              type="button"
                              aria-label={clearLabel}
                              disabled={isPopout}
                              onClick={() => manualLinkUser(u.userId, null)}
                              className={`rounded border border-line px-2 py-0.5 text-xs text-muted-foreground ${INTERACTIVE}`}
                            >
                              {t(lang, "timelogMatchClear")}
                            </button>
                          )}
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            aria-label={removeLabel}
                            disabled={isPopout}
                            onClick={() => removeUsers([u.userId])}
                            className={`rounded border border-line px-2 py-0.5 text-xs text-AIPM-pink-strong ${INTERACTIVE}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        </div>
      </section>

      {/* Projects matching table */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "timelogMatchProjects")}
          </h3>
          {/* Bootstrap the projects the token owner MANAGES (REST PM filter) so a
              PM can link them to budgets without first pulling bookings. */}
          <div className="flex items-center gap-2 print:hidden">
            {/* Customer scope (lazy-loads on focus). A customer loads that client's
                projects (not PM-scoped); "All customers" → my managed projects.
                The text box wildcard-filters the (large) customer list — `*` is a
                wildcard, everything else literal substring. */}
            <input
              type="search"
              aria-label={t(lang, "timelogCustomerFilter")}
              placeholder={t(lang, "timelogCustomerFilter")}
              value={customerFilter}
              disabled={isPopout}
              onFocus={() =>
                void sync
                  .loadCustomers()
                  .catch((e) => reportSilentFailure(showToast, lang, "timelog.customersLoadFailed", e, "guardTimelogCustomersFailed"))
              }
              onChange={(e) => setCustomerFilter(e.target.value)}
              className={`w-32 rounded border border-line bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground ${FOCUS_RING} ${TRANSITION}`}
            />
            <select
              aria-label={t(lang, "timelogCustomerLabel")}
              value={projectCustomerId === "" ? "" : String(projectCustomerId)}
              disabled={isPopout}
              onFocus={() =>
                void sync
                  .loadCustomers()
                  .catch((e) => reportSilentFailure(showToast, lang, "timelog.customersLoadFailed", e, "guardTimelogCustomersFailed"))
              }
              onChange={(e) => setProjectCustomerId(e.target.value === "" ? "" : Number(e.target.value))}
              className={`max-w-[16rem] rounded border border-line bg-surface px-2 py-1 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
            >
              <option value="">{t(lang, "timelogCustomerAll")}</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeClosedProjects}
                disabled={isPopout}
                onChange={(e) => setIncludeClosedProjects(e.target.checked)}
                className={`align-middle ${FOCUS_RING}`}
              />
              {t(lang, "timelogIncludeClosed")}
            </label>
            <button
              type="button"
              disabled={sync.busy || isPopout || isMisconfigured || confirming}
              onClick={() => void handleLoadManagedProjects()}
              className={`rounded-md border border-line px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
            >
              {t(lang, "timelogLoadManagedProjects")}
            </button>
          </div>
        </div>
        {knownProjectRefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "timelogMatchNone")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th scope="col" className="px-2 py-1 text-left">{t(lang, "timelogMatchProjects")}</th>
                  <th scope="col" className="px-2 py-1 text-left">{t(lang, "tabBudget")}</th>
                  <th scope="col" className="px-2 py-1 text-left">{t(lang, "status")}</th>
                  <th scope="col" className="px-2 py-1 text-left">{t(lang, "timelogMatchClear")}</th>
                </tr>
              </thead>
              <tbody>
                {knownProjectRefs.map((p) => {
                  const pLink = effectiveProjectLinks.find((l) => l.timelogProjectId === p.id);
                  const displayId = p.name;
                  const selectLabel = `${t(lang, "timelogMatchProjects")} – ${displayId}`;
                  const clearLabel = `${t(lang, "timelogMatchClear")} – ${displayId}`;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 text-foreground">{displayId}</td>
                      <td className="py-2 pr-2">
                        <select
                          aria-label={selectLabel}
                          value={pLink?.bucketId ?? ""}
                          disabled={isPopout}
                          onChange={(e) =>
                            manualLinkProject(
                              p.id,
                              e.target.value === "" ? null : Number(e.target.value),
                            )
                          }
                          className={`rounded border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
                        >
                          <option value="">{t(lang, "timelogMatchNone")}</option>
                          {budgets.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        {pLink && (
                          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted-foreground">
                            {t(lang, pLink.manual ? "timelogMatchManual" : "timelogMatchAuto")}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          aria-label={clearLabel}
                          disabled={isPopout}
                          onClick={() => manualLinkProject(p.id, null)}
                          className={`rounded border border-line px-2 py-0.5 text-xs text-muted-foreground ${INTERACTIVE}`}
                        >
                          {t(lang, "timelogMatchClear")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Apply to budget */}
      {!confirming ? (
        <button
          type="button"
          disabled={applyDiff.length === 0 || isPopout}
          onClick={openConfirm}
          className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-40 print:hidden ${INTERACTIVE}`}
        >
          {t(lang, "timelogApply")}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface-muted px-3 py-2 print:hidden">
          <p className="text-sm text-foreground">
            {t(lang, "timelogApplyConfirm", String(applyDiff.length))}
          </p>
          <button
            type="button"
            onClick={applyToBudget}
            className={`rounded-md border border-line px-3 py-1 text-sm font-medium text-foreground ${INTERACTIVE}`}
          >
            {t(lang, "timelogApply")}
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            className={`rounded-md border border-line px-3 py-1 text-sm text-muted-foreground ${INTERACTIVE}`}
          >
            {t(lang, "cancel")}
          </button>
        </div>
      )}
      </div>

      {/* Blocking loading modal — a fetch can be slow (paging loop, org per-employee,
          429 backoff). Not dismissible: onClose is a no-op and no close control. */}
      {sync.busy && (
        <Modal open onClose={sync.cancel} ariaLabel={t(lang, "loadingTimelog")} align="center" zIndex={70}>
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 rounded-lg border border-line bg-surface px-8 py-6 text-foreground"
          >
            <span
              aria-hidden="true"
              className="h-7 w-7 animate-spin rounded-full border-2 border-AIPM-dark-blue border-t-transparent"
            />
            <span className="text-sm font-medium">{t(lang, "loadingTimelog")}</span>
            <button
              type="button"
              onClick={sync.cancel}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
