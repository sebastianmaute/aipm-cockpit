"use client";
// src/app/timelog-panel.tsx
// User-facing Timelog integration view: people/project matching tables, KPI
// tiles, and the apply-to-budget flow. Consumes only pure engines + context —
// no direct API calls in render; all network happens inside event handlers.
import { useMemo, useState } from "react";
import { ChevronDownIcon } from "./icons";
import { t, type Lang } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useSettings } from "./use-settings";
import { useToastContext } from "./toast-context";
import { logDiag } from "./diagnostics";
import { reportSilentFailure } from "./guard-feedback";
import { useTimelogSync } from "./use-timelog-sync";
import { autoMatchUsers, autoMatchProjects, type TimelogProjectRef } from "./timelog-match";
import { scopeMismatch } from "./timelog-initial-scope";
import { useTimelogPickerScope } from "./use-timelog-picker-scope";
import { TimelogProjectScope } from "./timelog-project-scope";
import { useRowSelection } from "./use-row-selection";
import { Modal } from "./modal";
import { buildApplyPlan, applyActualsToBuckets, bucketsMissingAllocations, describeApplyRows } from "./timelog-apply";
import { pickMatchableResources } from "./timelog-matchable";
import { TimelogApplyConfirm } from "./timelog-apply-confirm";
import { TimelogPeopleTable } from "./timelog-people-table";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { defaultTimelogConfig, type TimelogLinks } from "./timelog-types";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { Spinner } from "./spinner";
import { Card } from "./card";
import { useConfirm } from "./confirm-dialog";
import { Tile } from "./report-table";
import { useResizable } from "./use-resizable";
import { useColumnResize } from "./use-column-resize";
import { Input } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";
import { TimelogToolbar } from "./timelog-panel-toolbar";
import { TimelogProjectsTable } from "./timelog-projects-table";
import { TimelogNotConfigured } from "./timelog-not-configured";
import { canApplyToBudget, canClearAllFetched, canFetchBookings, canLoadManagedProjects, canRefreshAndReapply, canRefreshBookings } from "./timelog-guards";
import { TimelogApplyNotices } from "./timelog-apply-notices";
import { decideReapply } from "./timelog-reapply";

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

export function TimelogPanel({
  lang,
  isPopout = false,
  projectKey = "default",
  onConfigureTimelog,
}: {
  lang: Lang;
  isPopout?: boolean;
  onConfigureTimelog?: () => void; // Settings → Integrations deep-link, mirroring ChatPanel's `onConfigureAi`. See TimelogNotConfigured.
  /** Canonical per-device store key (`portfolioCurrentId ?? "default"`). Keys
   *  BOTH per-device Timelog stores (picker scope and actuals cache). */
  projectKey?: string;
}) {
  const ws = useWorkspace();
  const { settings, setSettings, hydrated } = useSettings();
  const showToast = useToastContext();
  const confirm = useConfirm();
  const cfg = settings.timelog ?? defaultTimelogConfig;

  // Declared once, directly below `cfg` and above every reader — the action
  // handlers and the `disabled` expressions evaluate this same const rather
  // than recomputing the condition (open-followups §74).
  const isMisconfigured = !cfg.enabled || !cfg.host || !cfg.apiToken;

  // Stable references hoisted out of useMemo deps to avoid obj.member lint errors
  const timelogLinks = ws.timelogLinks;
  const budgets = ws.budgets;
  const resources = ws.resources;
  // Needed to attribute booked hours to the right role/discipline line.
  const roles = ws.roles;
  const disciplines = ws.disciplines;
  const grades = ws.grades;
  const planGranularity = ws.plan?.granularity ?? "month";

  // Externals are excluded from the auto-match pool, the aggregation engine, the
  // picker below AND the apply plan — the reasoning lives in `timelog-matchable`
  // beside the filter, which the Budget-side notice shares.
  const matchableResources = useMemo(() => pickMatchableResources(resources), [resources]);

  const links: TimelogLinks = useMemo(
    () => timelogLinks ?? { userLinks: [], projectLinks: [] },
    [timelogLinks],
  );
  // `ws.project?.code`. NOT a store key — the actuals cache is keyed on the
  // canonical `projectKey` alone (open-followups §14). This is only the
  // in-place project-switch SIGNAL consumed by useTimelogPickerScope.
  const projectCode = ws.project?.code ?? "default";
  const creds = useMemo(
    () => ({ host: cfg.host, tenant: cfg.tenant, token: cfg.apiToken }),
    [cfg.host, cfg.tenant, cfg.apiToken],
  );

  const sync = useTimelogSync({
    creds,
    links,
    resources: matchableResources,
    budgets,
    scopeMode: cfg.scopeMode,
    granularity: planGranularity,
    projectId: projectKey,
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
  const { ref: paneRef, reset: resetPaneSize } = useResizable("aipm-cockpit:timelog-size");
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
    // ★★ SAME predicate the Clear-all button's `disabled` evaluates. This guard
    //    previously mirrored exactly ONE arm of that expression (`confirming`)
    //    and omitted `syncBusy` and `!fetchedAt` (open-followups §74).
    //    `isMisconfigured` is deliberately absent here — see timelog-guards.ts.
    if (!canClearAllFetched({ isPopout, syncBusy: sync.busy, confirming, hasFetched: !!sync.fetchedAt })) return;
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
    () => autoMatchUsers(fetchedUsers, matchableResources, links),
    [fetchedUsers, matchableResources, links],
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
  // `pendingApply` is snapshotted at confirm-open so the ROWS the user reviews
  // are the rows written — the dialog itemizes every line it overwrites, so a
  // late re-fetch must not swap them (TOCTOU). Fetch/Clear-all disabled too.
  const [confirming, setConfirming] = useState(false);
  const [pendingApply, setPendingApply] = useState<import("./timelog-actuals").ActualsByBucket | null>(null);
  /** Budget baseline frozen at confirm-open — see the applyPlan memo. */
  const [pendingBudgets, setPendingBudgets] = useState<typeof budgets | null>(null);

  // ONE pass yields both the diff rows and the unmatched set — two entry points
  // routed every bucket twice per render. An empty overlay yields neither, so
  // the null cases collapse into the call. While confirming this reads the
  // pendingApply SNAPSHOT, so the notice describes the same hours the diff does
  // (Fetch is disabled mid-confirm, so they cannot diverge anyway).
  // matchableResources, NOT resources: an external is capacity-only and excluded
  // from ALL cost figures, but autoMatchUsers passes MANUAL links through
  // unconditionally, so a hand-linked external does reach byResource. Handing
  // apply the full directory would resolve their roleId and let budget-report
  // cost their hours at that role's internal rate. Absent from this list they
  // route to nothing → withheld and surfaced, which is the documented rule.
  // pendingBudgets freezes the BASELINE the preview was computed against, the
  // same way pendingApply freezes the overlay. Without it the dialog's
  // "current →" values are read from live `budgets` while the write happens
  // later, so a background load (broadcast sync / project reload) between
  // confirm-open and Apply would overwrite figures the user never saw.
  const applyPlan = useMemo(
    () => buildApplyPlan(pendingBudgets ?? budgets, pendingApply ?? overlay ?? {}, matchableResources, roles),
    [pendingApply, pendingBudgets, overlay, budgets, matchableResources, roles],
  );
  const applyDiff = applyPlan.rows;
  // Named rows for the confirm dialog — a bare count hid that apply can zero a
  // hand-entered actualHours cell on a line TimeLog never routed to.
  const applyDiffLabels = useMemo(
    () => describeApplyRows(applyDiff, budgets, roles, disciplines, grades),
    [applyDiff, budgets, roles, disciplines, grades],
  );

  // Buckets that have booked hours but no role/discipline line to hold them —
  // apply skips these, so surface WHY (else the Apply button just sits disabled
  // with no explanation for a linked-but-empty bucket).
  const skippedApplyBuckets = useMemo(
    () => (overlay ? bucketsMissingAllocations(budgets, overlay) : []),
    [overlay, budgets],
  );

  // Buckets WITH role lines where some hours match none of them (unlinked
  // person, no directory role, or a role with no line here). Those hours are
  // withheld rather than costed at another role's rate, so say so.
  const unmatchedApplyBuckets = applyPlan.unmatchedBuckets;

  // ONE predicate for the handler AND the button — see timelog-guards.ts. The
  // `isPartial` arm is the §172 data-loss guard: a fetch that lost a project
  // still yields a well-formed aggregate, and applying it ERASES that project's
  // hours, because apply writes every line it did not route to `0`.
  const applyState = { isPopout, rowCount: applyDiff.length, isPartial: sync.partial };

  function openConfirm() {
    if (!overlay || !canApplyToBudget(applyState)) return;
    setPendingApply(overlay);
    setPendingBudgets(budgets);
    setConfirming(true);
  }

  function applyToBudget() {
    if (!pendingApply) return;
    // The write stays a FUNCTIONAL updater against live `prev` — applying the
    // frozen snapshot instead would silently discard any concurrent change.
    // But then a drifted baseline means the itemised diff the user approved is
    // no longer the diff that would be written, and these are hand-editable
    // money figures — so refuse and make them re-review rather than write it.
    if (pendingBudgets && ws.budgets !== pendingBudgets) {
      showToast("error", t(lang, "timelogApplyStale"));
      cancelConfirm();
      return;
    }
    // matchableResources for the same reason as the plan memo above — the
    // preview and the write must resolve people identically.
    ws.setBudgets((prev) => applyActualsToBuckets(prev, pendingApply, matchableResources, roles));
    setConfirming(false);
    setPendingApply(null);
    setPendingBudgets(null);
  }

  function cancelConfirm() {
    setConfirming(false);
    setPendingApply(null);
    setPendingBudgets(null);
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
  // The whole customer→project picker (selection, both wildcard filters, the
  // per-device persistence and the precedence ladder that seeds it) lives in one
  // deps-object hook; the panel only consumes the resulting values + handlers.
  const syncCustomers = sync.customers;
  const {
    projectCustomerId,
    selectedProjectIds,
    projectFilter,
    setProjectFilter,
    customerFilter,
    setCustomerFilter,
    filteredProjects,
    customerOptions,
    toggleProject,
    toggleAllProjects,
    handleCustomerSelect,
    scopedCustomerName,
  } = useTimelogPickerScope({
    lang,
    isPopout,
    projectKey,
    projectId: projectCode,
    projectCustomerName: ws.project?.customer,
    links,
    customers: syncCustomers,
    customerProjects: sync.customerProjects,
    loadCustomerProjects: sync.loadCustomerProjects,
    showToast,
  });
  async function handleLoadManagedProjects() {
    // ★★ SAME predicate the Load-managed-projects button's `disabled`
    //    evaluates. This guard omitted BOTH `isMisconfigured` and `confirming`
    //    while the button carried all four (open-followups §74).
    if (!canLoadManagedProjects({ isPopout, syncBusy: sync.busy, confirming, isMisconfigured })) return;
    await sync.loadManagedProjects(
      includeClosedProjects,
      projectCustomerId === "" ? undefined : projectCustomerId,
    );
  }

  // Refresh re-fetches the LAST-FETCHED (persisted) scope from
  // `links.customerId`/`links.projectIds`, independent of the live picker — so
  // it truly reloads what the user already fetched even if they've since changed
  // the customer/project selection without re-fetching. Distinct from Fetch,
  // which pulls the CURRENT picker selection. Scope is unchanged so nothing is
  // re-persisted.
  const refreshCustomerId = links.customerId;
  const refreshProjectIds = links.projectIds ?? [];
  const canRefresh =
    refreshCustomerId !== undefined && refreshProjectIds.length > 0;

  // ★★ RETURNS the sync result rather than void so a caller can act on the
  //    FRESH aggregate. Reading `sync.aggregates` after awaiting this would
  //    read the PREVIOUS fetch's value — that state has not updated inside the
  //    calling closure — which is precisely the attribution a re-fetch exists
  //    to replace. See `handleRefreshAndReapply` below.
  async function handleRefreshBookings() {
    // ★★ SAME predicate the Refresh button's `disabled` evaluates — see
    //    timelog-guards.ts. This guard previously omitted `isMisconfigured`
    //    while the button included it (open-followups §74).
    if (!canRefreshBookings({ isPopout, syncBusy: sync.busy, confirming, isMisconfigured, canRefresh })) return undefined;
    const { start, end } = fetchWindow();
    const result = await sync.fetchBookingsForProjects([...refreshProjectIds], start, end);
    // Surface a partial per-project failure the same way Fetch does — else a
    // refresh that silently dropped some projects looks like a complete result.
    if (result && result.failedProjects > 0) {
      logDiag("warn", "timelog.partialProjectFetch", { failedProjects: result.failedProjects });
      showToast("error", t(lang, "guardTimelogPartialProjectFetch", result.failedProjects));
    }
    return result;
  }

  // Refresh, then open the SAME confirm dialog the manual Apply uses. Nothing
  // about the write path is new: `pendingApply` freezes the overlay,
  // `pendingBudgets` freezes the baseline, and `applyToBudget` still refuses on
  // a drifted baseline with `timelogApplyStale`. Money figures never gain a
  // second write path.
  //
  // ★★ EVERY branch of the decision lives in pure `timelog-reapply.ts` — incl.
  //    the partial-fetch abort that stops a half-fetched aggregate from erasing
  //    real hours, and WHY this button has to exist at all (which two link maps
  //    a re-fetch re-resolves, and what it does NOT freeze).
  // ★★ The fresh aggregate comes back from the CALL, not from `sync.aggregates`
  //    — that state has not updated in this closure, so reading it here would
  //    re-apply the stale attribution and silently reintroduce the very bug.
  async function handleRefreshAndReapply() {
    if (!canRefreshAndReapply({ isPopout, syncBusy: sync.busy, confirming, isMisconfigured, canRefresh })) return;
    const outcome = decideReapply(await handleRefreshBookings(), budgets, matchableResources, roles);
    if (outcome.kind === "abort") return;
    if (outcome.kind === "nothing") {
      showToast("info", t(lang, "timelogNothingToApply"));
      return;
    }
    setPendingApply(outcome.overlay);
    setPendingBudgets(budgets);
    setConfirming(true);
  }

  // Fetch is gated on a customer + ≥1 picked project (button disabled otherwise).
  // Loads ONLY the selected projects' registrations; the People table is then
  // derived from who booked on them. Persists customer + project scope so the
  // selection survives a reload.
  async function handleFetchBookings() {
    // ★★ SAME predicate the Fetch button's `disabled` evaluates.
    if (
      !canFetchBookings({
        isPopout,
        syncBusy: sync.busy,
        confirming,
        isMisconfigured,
        projectCustomerId,
        selectedCount: selectedProjectIds.size,
      })
    )
      return;
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

  // Integration switched OFF → the whole page goes, network actions included. ★ On
  //   `cfg.enabled` ALONE, never `isMisconfigured`: an ENABLED-but-broken Timelog keeps the
  //   full page, the §74 guards AND Clear-all (why that last one is not optional: the header
  //   of timelog-not-configured.tsx). ★★ And on `hydrated` — settings load in an EFFECT, so a
  //   bare gate flashes "switched off", Clear-all included, at every CONFIGURED user.
  if (hydrated && !cfg.enabled) return <TimelogNotConfigured lang={lang} paneRef={paneRef} onConfigure={onConfigureTimelog} hasFetched={!!sync.fetchedAt} canClearAll={canClearAllFetched({ isPopout, syncBusy: sync.busy, confirming, hasFetched: !!sync.fetchedAt })} onClearAll={() => void clearAllFetched()} />;

  return (
    <div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <TimelogToolbar
        lang={lang}
        isPopout={isPopout}
        projectCustomerId={projectCustomerId}
        customerOptions={customerOptions}
        customerFilter={customerFilter}
        onCustomerFilterChange={setCustomerFilter}
        onCustomerSelectChange={handleCustomerSelect}
        onCustomerFocusLoad={() =>
          void sync
            .loadCustomers()
            .catch((e) => reportSilentFailure(showToast, lang, "timelog.customersLoadFailed", e, "guardTimelogCustomersFailed"))
        }
        syncBusy={sync.busy}
        fetchedAt={sync.fetchedAt}
        confirming={confirming}
        isMisconfigured={isMisconfigured}
        selectedCount={selectedProjectIds.size}
        onClearAll={clearAllFetched}
        onFetch={() => void handleFetchBookings()}
        onRefresh={() => void handleRefreshBookings()}
        onRefreshAndReapply={() => void handleRefreshAndReapply()}
        canRefresh={canRefresh}
        onResetColWidths={resetColWidths}
        onResetPaneSize={resetPaneSize}
      />
      {isMisconfigured && <p className="mb-3 text-sm text-muted-foreground print:hidden">{t(lang, "timelogEnable")}</p>}

      {/* Customer-scope note — makes the reduced fetch explicit. */}
      {projectCustomerId !== "" && (
        <p className="mb-2 text-xs text-muted-foreground print:hidden">
          {t(lang, "timelogFetchScopedNote", scopedCustomerName)}
        </p>
      )}

      {/* The picker can legitimately show a different customer than the loaded
          bookings came from (the device picker outranks the last-fetched scope
          when seeding), so say so rather than letting the picker misrepresent
          what is on screen. */}
      {!isPopout && scopeMismatch(projectCustomerId, links.customerId) && (
        <p className="mb-2 text-xs text-muted-foreground print:hidden">
          {/* ★ 0-based positional placeholders: {0} is the customer the loaded
              bookings came from, {1} is the one currently picked. */}
          {t(
            lang,
            "timelogScopeMismatchNote",
            syncCustomers.find((c) => c.id === links.customerId)?.name ?? String(links.customerId),
            scopedCustomerName,
          )}
        </p>
      )}

      {/* Step 2 — pick the customer's projects to fetch (required before Fetch).
          Always shown so the "pick a customer first" hint guides the two-step. */}
      {!isPopout && !isMisconfigured && (
        <div className="mb-3 print:hidden">
          <TimelogProjectScope
            lang={lang}
            projects={filteredProjects}
            selectedIds={selectedProjectIds}
            hasCustomer={projectCustomerId !== ""}
            filter={projectFilter}
            onFilterChange={setProjectFilter}
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
        <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, timelogPeopleCollapsed: !s.timelogPeopleCollapsed }))}
            aria-expanded={!peopleCollapsed}
            aria-controls="timelog-people-region"
            title={t(lang, peopleCollapsed ? "timelogPeopleExpand" : "timelogPeopleCollapse")}
            className={`flex items-center gap-1.5 rounded-md ${FOCUS_RING} ${TRANSITION}`}
          >
            <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 transition-transform ${peopleCollapsed ? "-rotate-90" : ""}`} />
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
            {/* Narrow the loaded directory before ticking who to fetch bookings for.
                The wrapper is the element in the flow now, so the layout +
                print classes ride it, not the field. */}
            <ClearableSearchInput
              value={peopleFilter}
              onClear={() => setPeopleFilter("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "timelogPeopleFilter")}`}
              className="mb-2 print:hidden"
            >
              <Input
                type="search"
                size="xs"
                value={peopleFilter}
                onChange={(e) => setPeopleFilter(e.target.value)}
                placeholder={t(lang, "timelogPeopleFilter")}
                aria-label={t(lang, "timelogPeopleFilter")}
                className={`w-full [&::-webkit-search-cancel-button]:appearance-none${peopleFilter ? " pr-8" : ""}`}
              />
            </ClearableSearchInput>
            {/* Bulk-remove bar — self-hides at zero selection */}
            {sel.count > 0 && !isPopout && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5 print:hidden">
                <span className="text-xs font-medium text-foreground">
                  {t(lang, "selectionCount", String(sel.count))}
                </span>
                <button
                  type="button"
                  onClick={() => removeUsers([...sel.selectedIds])}
                  className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ui-pink-strong hover:bg-surface-muted ${INTERACTIVE}`}
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
            <TimelogPeopleTable
              lang={lang}
              isPopout={isPopout}
              colWidths={colWidths}
              startColResize={startColResize}
              sel={sel}
              visibleFilteredIds={visibleFilteredIds}
              filteredUsers={filteredUsers}
              effectiveUserLinks={effectiveUserLinks}
              matchableResources={matchableResources}
              manualLinkUser={manualLinkUser}
              removeUsers={removeUsers}
            />
          </>
        )}
        </div>
      </section>

      {/* Projects matching table */}
      <TimelogProjectsTable
        lang={lang}
        isPopout={isPopout}
        knownProjectRefs={knownProjectRefs}
        effectiveProjectLinks={effectiveProjectLinks}
        budgets={budgets}
        onManualLinkProject={manualLinkProject}
        includeClosedProjects={includeClosedProjects}
        onIncludeClosedChange={setIncludeClosedProjects}
        syncBusy={sync.busy}
        isMisconfigured={isMisconfigured}
        confirming={confirming}
        onLoadManagedProjects={() => void handleLoadManagedProjects()}
      />

      {/* Apply to budget */}
      <TimelogApplyNotices
        lang={lang}
        partial={sync.partial}
        skippedCount={skippedApplyBuckets.length}
        unmatchedCount={unmatchedApplyBuckets.length}
        unmatchedHours={applyPlan.unmatchedHours}
      />
      {!confirming ? (
        <button
          type="button"
          disabled={!canApplyToBudget(applyState)}
          onClick={openConfirm}
          className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-40 print:hidden ${INTERACTIVE}`}
        >
          {t(lang, "timelogApply")}
        </button>
      ) : (
        <TimelogApplyConfirm
          lang={lang}
          rows={applyDiffLabels}
          onApply={applyToBudget}
          onCancel={cancelConfirm}
        />
      )}
      </div>

      {/* Blocking loading modal — a fetch can be slow (paging loop, org per-employee,
          429 backoff). Not dismissible: onClose is a no-op and no close control. */}
      {sync.busy && (
        <Modal open onClose={sync.cancel} ariaLabel={t(lang, "loadingTimelog")} align="center" zIndex={70}>
          <Card
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 px-8 py-6 text-foreground"
          >
            <Spinner />
            <span className="text-sm font-medium">{t(lang, "loadingTimelog")}</span>
            <button
              type="button"
              onClick={sync.cancel}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
            >
              {t(lang, "cancel")}
            </button>
          </Card>
        </Modal>
      )}
    </div>
  );
}
