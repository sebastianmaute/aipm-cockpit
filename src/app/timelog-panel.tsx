"use client";
// src/app/timelog-panel.tsx
// User-facing Timelog integration view: people/project matching tables, KPI
// tiles, and the apply-to-budget flow. Consumes only pure engines + context —
// no direct API calls in render; all network happens inside event handlers.
import { useEffect, useMemo, useState } from "react";
import { t, type Lang } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useSettings } from "./use-settings";
import { useToastContext } from "./toast-context";
import { logDiag } from "./diagnostics";
import { reportSilentFailure } from "./guard-feedback";
import { useTimelogSync } from "./use-timelog-sync";
import { autoMatchUsers, autoMatchProjects, resolveCustomerByName, type TimelogProjectRef } from "./timelog-match";
import { TimelogCustomerScope } from "./timelog-customer-scope";
import { TimelogProjectScope } from "./timelog-project-scope";
import { useRowSelection } from "./use-row-selection";
import { Modal } from "./modal";
import { planApply, applyActualsToBuckets, bucketsMissingAllocations } from "./timelog-apply";
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

  // Buckets that have booked hours but no role/discipline line to hold them —
  // apply skips these, so surface WHY (else the Apply button just sits disabled
  // with no explanation for a linked-but-empty bucket).
  const skippedApplyBuckets = useMemo(
    () => (overlay ? bucketsMissingAllocations(budgets, overlay) : []),
    [overlay, budgets],
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

  const [includeClosedProjects, setIncludeClosedProjects] = useState(false);
  const [projectCustomerId, setProjectCustomerId] = useState<number | "">("");
  // Step 2 of the fetch flow: the customer's projects the user picked. Fetch is
  // gated on a customer + ≥1 project; the People table is then derived from who
  // booked on these projects (the directory auto-loads on Fetch to resolve names).
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const toggleProject = (id: number) =>
    setSelectedProjectIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleAllProjects = () =>
    setSelectedProjectIds((prev) => {
      const all = sync.customerProjects.length > 0 && sync.customerProjects.every((p) => prev.has(p.id));
      return all ? new Set() : new Set(sync.customerProjects.map((p) => p.id));
    });
  // Load the chosen customer's projects into the picker when the customer changes
  // (pick OR persisted-scope seed). An await-then-setState data load, not a
  // synchronous state-sync — the set-state-in-effect ban targets the latter.
  useEffect(() => {
    if (isPopout || projectCustomerId === "") return;
    void sync
      .loadCustomerProjects(Number(projectCustomerId))
      .catch((e) => reportSilentFailure(showToast, lang, "timelog.customerProjectsFailed", e, "guardTimelogCustomerProjectsFailed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync fns are re-created each render; key on the customer id only
  }, [projectCustomerId, isPopout]);
  const [customerFilter, setCustomerFilter] = useState("");
  // Wildcard-filtered customer options; keep the current selection present even
  // when filtered out OR when the customer list isn't loaded yet (persisted
  // scope) so the <select> value always resolves to a real option.
  const customerOptions = useMemo(() => {
    const match = customerMatcher(customerFilter);
    const list = sync.customers.filter((c) => match(c.name));
    if (projectCustomerId !== "" && !list.some((c) => c.id === projectCustomerId)) {
      const selCust = sync.customers.find((c) => c.id === projectCustomerId);
      return [selCust ?? { id: projectCustomerId, name: String(projectCustomerId) }, ...list];
    }
    return list;
  }, [sync.customers, customerFilter, projectCustomerId]);

  // Seed + auto-resolve the customer scope via one-shot render-time reconciles
  // (state-guarded — the codebase's nonce/last-seen pattern, NOT a ref accessed
  // in render, NOT set-state-in-effect). `userPicked` distinguishes an explicit
  // pick from an auto value so persisted scope can override a name auto-resolve
  // (even if links hydrate late) yet never override a manual pick.
  const [userPicked, setUserPicked] = useState(false);
  const [linksSeeded, setLinksSeeded] = useState(false);
  const [autoResolved, setAutoResolved] = useState(false);
  // Last-seen projectId: reset the one-shots when the project changes IN PLACE
  // (no remount) so the picker re-seeds for the new project.
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  const projectCustomerName = ws.project?.customer;
  const syncCustomers = sync.customers;
  // On an in-place project switch, reset and DON'T seed this render: the reset
  // setStates are queued (not yet visible in this render's `linksSeeded`/
  // `projectCustomerId` locals), so seeding now would read the OLD project's
  // stale flags/links. The seed blocks below are gated on `!projectChanged` and
  // fire on the next render with fresh state.
  const projectChanged = seenProjectId !== projectId;
  if (projectChanged) {
    setSeenProjectId(projectId);
    setUserPicked(false);
    setLinksSeeded(false);
    setAutoResolved(false);
    setProjectCustomerId("");
    setCustomerFilter("");
    setSelectedProjectIds(new Set());
  }
  // (1) Persisted per-project scope wins over name auto-resolve (even if links
  // hydrate after the customer directory), but never over an explicit pick.
  if (!projectChanged && !linksSeeded && !userPicked && links.customerId !== undefined) {
    setLinksSeeded(true);
    setProjectCustomerId(links.customerId);
    if (links.projectIds && links.projectIds.length > 0) {
      setSelectedProjectIds(new Set(links.projectIds));
    }
  }
  // (2) Else auto-resolve the project's free-text customer name once the
  // directory loads, only while untouched and no scope is persisted.
  if (
    !projectChanged &&
    !autoResolved &&
    !userPicked &&
    !linksSeeded &&
    projectCustomerId === "" &&
    links.customerId === undefined &&
    syncCustomers.length > 0
  ) {
    setAutoResolved(true);
    const hit = resolveCustomerByName(syncCustomers, projectCustomerName);
    if (hit) setProjectCustomerId(hit.id);
  }
  // Display name of the active scope (for the header note); falls back to the id.
  const scopedCustomerName =
    projectCustomerId === ""
      ? ""
      : syncCustomers.find((c) => c.id === projectCustomerId)?.name ?? String(projectCustomerId);
  async function handleLoadManagedProjects() {
    if (isPopout || sync.busy) return;
    await sync.loadManagedProjects(
      includeClosedProjects,
      projectCustomerId === "" ? undefined : projectCustomerId,
    );
  }

  // Fetch is gated on a customer + ≥1 picked project (button disabled otherwise).
  // Loads ONLY the selected projects' registrations; the People table is then
  // derived from who booked on them. Persists customer + project scope so the
  // selection survives a reload.
  async function handleFetchBookings() {
    if (isPopout || sync.busy || projectCustomerId === "" || selectedProjectIds.size === 0) return;
    const { start, end } = fetchWindow();
    const cid = Number(projectCustomerId);
    const ids = [...selectedProjectIds];
    const result = await sync.fetchBookingsForProjects(ids, start, end);
    if (result) {
      // Functional updater — the per-project fetch is a long serial await and the
      // link <select>s stay editable meanwhile; spreading the pre-await `links`
      // snapshot would revert an edit made during the fetch.
      ws.setTimelogLinks((prev) => {
        const base = prev ?? { userLinks: [], projectLinks: [] };
        return sanitizeTimelogLinks({ ...base, customerId: cid, projectIds: ids }) ?? base;
      });
      if (result.failedProjects > 0) {
        logDiag("warn", "timelog.partialProjectFetch", { failedProjects: result.failedProjects });
        showToast("error", t(lang, "guardTimelogPartialProjectFetch", result.failedProjects));
      }
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Customer scope (lazy-loads on focus). When a customer is selected,
              "Fetch bookings" loads ONLY that customer's projects' registrations
              (per-project v2); "All customers" keeps the per-user fetch.
              Auto-resolves from the project's customer name (see reconcile above). */}
          <TimelogCustomerScope
            lang={lang}
            value={projectCustomerId}
            options={customerOptions}
            filter={customerFilter}
            disabled={isPopout}
            onFilterChange={setCustomerFilter}
            onSelectChange={(v) => { setUserPicked(true); setProjectCustomerId(v); setSelectedProjectIds(new Set()); }}
            onFocusLoad={() =>
              void sync
                .loadCustomers()
                .catch((e) => reportSilentFailure(showToast, lang, "timelog.customersLoadFailed", e, "guardTimelogCustomersFailed"))
            }
          />
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
            disabled={sync.busy || isPopout || isMisconfigured || confirming || projectCustomerId === "" || selectedProjectIds.size === 0}
            onClick={() => void handleFetchBookings()}
            title={projectCustomerId === "" || selectedProjectIds.size === 0 ? t(lang, "timelogFetchNeedsSelection") : undefined}
            className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
          >
            {sync.busy
              ? t(lang, "loadingTimelog")
              : `${t(lang, "timelogSync")}${selectedProjectIds.size > 0 ? ` (${selectedProjectIds.size})` : ""}`}
          </button>
          <PrintButton lang={lang} />
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetPaneSize} lang={lang} />
        </div>
      </div>

      {/* Customer-scope note — makes the reduced fetch explicit. */}
      {projectCustomerId !== "" && (
        <p className="mb-2 text-xs text-muted-foreground print:hidden">
          {t(lang, "timelogFetchScopedNote", scopedCustomerName)}
        </p>
      )}

      {/* Step 2 — pick the customer's projects to fetch (required before Fetch).
          Always shown so the "pick a customer first" hint guides the two-step. */}
      {!isPopout && !isMisconfigured && (
        <div className="mb-3 print:hidden">
          <TimelogProjectScope
            lang={lang}
            projects={sync.customerProjects}
            selectedIds={selectedProjectIds}
            hasCustomer={projectCustomerId !== ""}
            onToggle={toggleProject}
            onToggleAll={toggleAllProjects}
            disabled={isPopout || sync.busy}
          />
        </div>
      )}

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
            {/* The customer scope picker now lives in the header (it governs the
                booking fetch too); this row keeps the project-discovery controls.
                "Load my projects" still reads the same header customer selection —
                a customer loads that client's projects, else my managed (PM) ones. */}
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
      {skippedApplyBuckets.length > 0 && (
        <p className="mb-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-muted-foreground print:hidden">
          {t(lang, "timelogApplyNoAllocation", String(skippedApplyBuckets.length))}
        </p>
      )}
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
