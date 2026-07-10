// src/app/use-timelog-sync.ts
// On-demand fetch of Timelog bookings. Resolves scope (auto/self/org),
// aggregates via timelog-actuals, and caches the result per-project.
// Never logs token or response body — errors carry only status digits.
import { useEffect, useRef, useState } from "react";
import {
  listUsers,
  getPrivileges,
  getMe,
  listManagedProjects,
  listProjectsForCustomer,
  listCustomers,
  type TimelogCustomer,
  listTimeItemsSelf,
  listEmployeeTimeItems,
  listProjectTimeRegistrations,
  TimelogError,
  type TimelogCreds,
} from "./timelog-api";
import { aggregateActuals, type ActualsAggregate } from "./timelog-actuals";
import { saveActualsCache, loadActualsCache, clearActualsCache } from "./timelog-actuals-store";
import { autoMatchUsers, autoMatchProjects, displayableUsers, type TimelogProjectRef } from "./timelog-match";
import type { TimelogLinks, TimelogScopeMode, TimelogTimeItem, TimelogUser } from "./timelog-types";
import type { PlanGranularity, Resource, BudgetBucket } from "./types";

type Args = {
  creds: TimelogCreds;
  links: TimelogLinks;
  // Resources + budget buckets so aggregation attributes hours via the SAME
  // effective (auto + manual) links the matching UI shows as "Auto"/"Manual" —
  // NOT the raw persisted links (which hold only explicit manual pins). Without
  // this an auto-matched person/project shows as linked in the table yet every
  // booking still falls into `unattributed` and never reaches the budget.
  resources: readonly Resource[];
  budgets: readonly BudgetBucket[];
  scopeMode: TimelogScopeMode;
  granularity: PlanGranularity;
  projectId: string;
  isPopout: boolean;
  onTokenInvalid: () => void;
  onTokenValid: () => void;
};

export function useTimelogSync(args: Args) {
  const projectId = args.projectId;
  const isPopout = args.isPopout;
  const scopeMode = args.scopeMode;
  const granularity = args.granularity;
  const creds = args.creds;
  const links = args.links;
  const resources = args.resources;
  const budgets = args.budgets;
  const onTokenInvalid = args.onTokenInvalid;
  const onTokenValid = args.onTokenValid;

  const [aggregates, setAggregates] = useState<ActualsAggregate | undefined>(() => loadActualsCache(projectId)?.aggregates);
  const [fetchedAt, setFetchedAt] = useState<string | undefined>(() => loadActualsCache(projectId)?.fetchedAt);
  // Displayable directory users + distinct projects seen in the latest fetch.
  // Seeded from the per-project cache so the matching tables survive a view
  // remount (the KPIs already restore from `aggregates` — keep them in sync).
  const [users, setUsers] = useState<TimelogUser[]>(() => loadActualsCache(projectId)?.users ?? []);
  const [projectRefs, setProjectRefs] = useState<TimelogProjectRef[]>(() => loadActualsCache(projectId)?.projectRefs ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<number | null>(null);
  // Customer directory for the project-scope picker. Lazy + lightweight (no busy
  // modal): the dropdown stays "All only" if it fails.
  const [customers, setCustomers] = useState<TimelogCustomer[]>([]);
  // The selected customer's projects — the option list for the project picker
  // (distinct from `projectRefs`, which holds projects SEEN in the latest fetch).
  const [customerProjects, setCustomerProjects] = useState<TimelogProjectRef[]>([]);
  // Aborts the in-flight fetch chain (Cancel button on the loading modal). One
  // controller per sync run; the signal threads down to every proxied request.
  const abortRef = useRef<AbortController | null>(null);
  // The FULL org directory, cached across fetches for EmployeeInitials→userId
  // resolution. Kept SEPARATE from `users` — which now holds only the bookers
  // subset — so a later fetch resolves against everyone, not the last bookers.
  // Reset when the connection changes so a tenant switch never resolves against
  // the previous org's directory.
  const fullDirectoryRef = useRef<TimelogUser[] | null>(null);
  useEffect(() => { fullDirectoryRef.current = null; }, [creds.host, creds.tenant, creds.token]);
  // Monotonic request id so an out-of-order loadCustomerProjects response can't
  // clobber a newer customer's project list (the picker/scope would otherwise
  // show customer A's projects while B is selected).
  const customerProjectsReqRef = useRef(0);

  // Shared abort/busy/error wrapper. Plain functions (not memoized): they read
  // live render-scope state every call (users/aggregates/…), like the storage
  // handlers — memoizing would stale-capture them.
  // Generic over `work`'s resolved value so a caller (e.g. fetchBookings) can
  // surface a per-call result (like a partial-failure count) without a stale
  // render-closure read; callers that don't need a result just ignore it.
  async function runGuarded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (isPopout) return undefined; // read-only in popout
    abortRef.current?.abort(); // supersede any prior in-flight run
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError(null);
    try {
      const result = await work(signal);
      onTokenValid();
      return result;
    } catch (e) {
      // User cancellation: leave prior data + state intact, surface no error.
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return undefined;
      const status = e instanceof TimelogError ? e.status : 0;
      setError(status > 0 ? status : -1); // -1 = unknown/non-HTTP error
      if (status === 401 || status === 403) onTokenInvalid();
      return undefined;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  // NOTE: `loadDirectory` and `fetchBookings` (the self/org per-user path below)
  // are NOT wired into the panel anymore — the customer→project flow
  // (`fetchBookingsForProjects`) superseded them. They remain exported (still
  // exercised by tests) and could back a future non-customer mode. ★ Do NOT
  // reuse `fetchBookings`'s org branch as-is: it reads the `users` state as the
  // directory, which now holds only the bookers subset (see `fullDirectoryRef`).
  //
  // STEP 1 — load the org directory only (cheap: paged /v1/user). Populates the
  // People table for selection/filtering WITHOUT pulling any bookings, so the
  // user can narrow + tick before the costly per-employee timesheet fetch.
  async function loadDirectory(): Promise<void> {
    await runGuarded(async (signal) => {
      const shown = displayableUsers(await listUsers(creds, signal));
      fullDirectoryRef.current = shown;
      setUsers(shown);
      // Persist alongside EXISTING bookings only. A directory-only load (no prior
      // fetchedAt) stays in-memory — caching it would fabricate a `fetchedAt` that
      // seeds a misleading "Last synced" line on the next remount.
      if (fetchedAt) {
        saveActualsCache(projectId, { fetchedAt, aggregates, users: shown, projectRefs });
      }
    });
  }

  // Bootstrap the Projects matching table from the projects the token owner
  // MANAGES (REST /v1/project/get-all filtered by ProjectManagerID) — lets a PM
  // link their projects to budgets WITHOUT first pulling any bookings.
  // Populate the customer picker on demand (first focus). Not via runGuarded —
  // a cheap reference fetch shouldn't raise the blocking loading modal; on
  // failure the dropdown just stays at "All customers" (no state change here),
  // but the rejection now PROPAGATES to the caller so it isn't silently
  // swallowed — the panel's call site surfaces it via a toast.
  async function loadCustomers(): Promise<void> {
    if (isPopout || customers.length > 0) return;
    setCustomers(await listCustomers(creds));
  }

  // Load a customer's projects into the picker option list (includes closed —
  // historical bookings live on closed projects). Lightweight like loadCustomers
  // (no blocking modal); the rejection PROPAGATES so the panel can toast it.
  // A falsy/non-positive customer clears the list.
  async function loadCustomerProjects(customerId: number): Promise<void> {
    if (isPopout) return;
    const req = (customerProjectsReqRef.current += 1);
    if (!customerId || customerId <= 0) { setCustomerProjects([]); return; }
    const list = await listProjectsForCustomer(creds, customerId, undefined, true);
    // Discard a response superseded by a newer customer pick (out-of-order guard).
    if (req === customerProjectsReqRef.current) setCustomerProjects(list);
  }

  // A customer (>0) loads ALL that customer's projects (server-side filter, not
  // PM-scoped — lets a non-PM link a client's projects); else the token owner's
  // managed (PM) projects.
  async function loadManagedProjects(includeClosed = false, customerId?: number): Promise<void> {
    await runGuarded(async (signal) => {
      const refs =
        customerId && customerId > 0
          ? await listProjectsForCustomer(creds, customerId, signal, includeClosed)
          : await listManagedProjects(creds, (await getMe(creds, signal)).userId, signal, includeClosed);
      setProjectRefs(refs);
      if (fetchedAt) {
        saveActualsCache(projectId, { fetchedAt, aggregates, users, projectRefs: refs });
      }
    });
  }

  // Shared aggregation tail for BOTH fetch paths (per-user and per-customer):
  // derive distinct project refs, resolve effective (auto + manual) links, run
  // aggregateActuals, and persist the per-project cache. Plain function reading
  // live render-scope (users/resources/budgets/links/granularity) — same
  // non-memoized pattern as the other handlers.
  function finish(items: readonly TimelogTimeItem[], usersOverride?: readonly TimelogUser[]): void {
    const u = usersOverride ?? users;
    // Distinct projects seen — lets the matching UI bootstrap never-linked ones.
    // Skip ProjectID 0 (absence / non-project time): it has an empty name, can't
    // map to a budget bucket, and already aggregates into `unattributed` — so it
    // would only render a blank, useless row in the Projects matching table.
    // MUST run BEFORE aggregation: auto-matching a project to a bucket needs the
    // refs (project names) derived from these very items.
    const refMap = new Map<number, TimelogProjectRef>();
    for (const it of items) {
      if (it.projectId <= 0) continue;
      if (!refMap.has(it.projectId)) {
        refMap.set(it.projectId, { id: it.projectId, name: it.projectName, no: it.projectNo });
      }
    }
    const refs = [...refMap.values()];

    // Aggregate on the EFFECTIVE links (auto + manual, manual wins) — the same
    // resolution the matching UI shows — so an auto-matched person/project
    // actually attributes hours to a resource/bucket. Manual pins ride through
    // even when their project isn't in this fetch's refs (autoMatch* keeps them).
    const effectiveLinks: TimelogLinks = {
      userLinks: autoMatchUsers(u, resources, links),
      projectLinks: autoMatchProjects(refs, budgets, links),
    };
    const agg = aggregateActuals(items, effectiveLinks, granularity);
    const at = new Date().toISOString();
    setAggregates(agg);
    setProjectRefs(refs);
    setFetchedAt(at);
    saveActualsCache(projectId, { fetchedAt: at, aggregates: agg, users: [...u], projectRefs: refs });
  }

  // STEP 2 — fetch bookings + aggregate. Org scope iterates ONLY `userIds` when
  // provided (the ticked people) — this is what keeps the request count under
  // the rate limit; empty/omitted falls back to all loaded directory users.
  async function fetchBookings(
    startDate: string,
    endDate: string,
    userIds?: readonly number[],
  ): Promise<{ failedEmployees: number } | undefined> {
    return runGuarded(async (signal) => {
      let resolvedScope = scopeMode;
      if (resolvedScope === "auto") {
        const priv = await getPrivileges(creds, signal);
        resolvedScope = priv.registrationAllTasks ? "org" : "self";
      }

      let items: TimelogTimeItem[] = [];
      // Count of employees whose timesheet fetch failed (org/team scope only) —
      // surfaced to the caller so a partial fetch isn't silently short; the
      // per-employee loop below still swallows-and-continues (fail-soft).
      let failedEmployees = 0;
      if (resolvedScope === "self") {
        items = await listTimeItemsSelf(creds, startDate, endDate, signal);
      } else {
        // Org mode: iterate the ticked users (or all loaded, if none ticked)
        // serially, fail-soft per employee. Serial (not Promise.all) to avoid
        // hammering the API and tripping the rate limit.
        const ids = userIds && userIds.length > 0 ? userIds : users.map((u) => u.userId);
        for (const id of ids) {
          if (signal.aborted) break; // stop the loop promptly on cancel
          try {
            const empItems = await listEmployeeTimeItems(creds, id, startDate, endDate, signal);
            items = items.concat(empItems);
          } catch (e) {
            if (signal.aborted) throw e; // propagate the cancel out of the fail-soft loop
            // Swallow per-employee errors; continue with remaining employees
            failedEmployees++;
          }
        }
      }

      finish(items);
      return { failedEmployees };
    });
  }

  // STEP 2 (customer→project scoped) — fetch bookings for the SPECIFIC projects
  // the user picked (a subset of the chosen customer's projects), via the v2
  // per-project endpoint. Serial + fail-soft per project. The People table is
  // then DERIVED from the fetched rows (only the employees who actually booked
  // on these projects), not the whole org directory. The directory is loaded
  // ONCE here (silently, if not already) purely to resolve v2 `EmployeeInitials`
  // → `timelogUserId` (for names + resource linking); unmatched → userId 0
  // (aggregated as unattributed, never dropped).
  async function fetchBookingsForProjects(
    projectIds: readonly number[],
    startDate: string,
    endDate: string,
  ): Promise<{ failedProjects: number; projectCount: number } | undefined> {
    return runGuarded(async (signal) => {
      const ids = [...new Set(projectIds.filter((id) => Number.isInteger(id) && id > 0))];
      // No projects picked: do NOT run finish() — clobbering prior good aggregates
      // with an empty result would be silent data loss. Panel notifies via count 0.
      if (ids.length === 0) return { failedProjects: 0, projectCount: 0 };
      // Resolve EmployeeInitials→userId against the FULL org directory (cached in
      // a ref, loaded once). Must NOT reuse `users` — that now holds only the
      // prior fetch's bookers subset, which would leave most rows unresolved.
      if (!fullDirectoryRef.current) {
        fullDirectoryRef.current = displayableUsers(await listUsers(creds, signal));
      }
      const directory = fullDirectoryRef.current;
      const initialsToUserId = new Map(
        directory.filter((u) => u.initials).map((u) => [u.initials.trim().toLowerCase(), u.userId] as const),
      );
      let items: TimelogTimeItem[] = [];
      let failedProjects = 0;
      for (const id of ids) {
        if (signal.aborted) break;
        try {
          items = items.concat(await listProjectTimeRegistrations(creds, id, startDate, endDate, signal, initialsToUserId));
        } catch (e) {
          if (signal.aborted) throw e; // propagate the cancel out of the fail-soft loop
          failedProjects++;
        }
      }
      // The v2 endpoint returns the project's WHOLE history and ignores the date
      // params — clamp to the requested window (ISO YYYY-MM-DD lexical = true date
      // compare; also drops the summary-only empty-date row an empty project emits).
      const inWindow = items.filter((it) => it.date >= startDate && it.date <= endDate);
      // People = only the employees who booked on the selected projects (the
      // directory subset whose userId appears in the fetched rows).
      const bookerIds = new Set(inWindow.map((it) => it.userId).filter((id) => id > 0));
      const bookers = directory.filter((u) => bookerIds.has(u.userId));
      setUsers(bookers);
      finish(inWindow, bookers);
      return { failedProjects, projectCount: ids.length };
    });
  }

  /** Abort the in-flight fetch chain (Cancel on the loading modal). */
  function cancel() {
    abortRef.current?.abort();
  }

  // Remove fetched directory people from the People matching table (display-only
  // cleanup) and persist the trimmed list. Booked hours are unaffected — they're
  // already aggregated from items, not re-derived from this list. Plain functions
  // (not memoized): they read live state every call, like the storage handlers.
  function removeUsers(ids: readonly number[]) {
    if (isPopout || ids.length === 0) return;
    const drop = new Set(ids);
    const next = users.filter((u) => !drop.has(u.userId));
    setUsers(next);
    if (fetchedAt && aggregates) {
      saveActualsCache(projectId, { fetchedAt, aggregates, users: next, projectRefs });
    }
  }

  function clearAll() {
    if (isPopout) return;
    setAggregates(undefined);
    setFetchedAt(undefined);
    setUsers([]);
    setProjectRefs([]);
    fullDirectoryRef.current = null; // force a fresh directory on the next fetch
    clearActualsCache(projectId);
  }

  return { aggregates, fetchedAt, users, projectRefs, customers, customerProjects, busy, error, loadDirectory, loadManagedProjects, loadCustomers, loadCustomerProjects, fetchBookings, fetchBookingsForProjects, cancel, removeUsers, clearAll };
}
