// src/app/use-timelog-sync.ts
// On-demand fetch of Timelog bookings. Resolves scope (auto/self/org),
// aggregates via timelog-actuals, and caches the result per-project.
// Never logs token or response body — errors carry only status digits.
import { useRef, useState } from "react";
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
  TimelogError,
  type TimelogCreds,
} from "./timelog-api";
import { aggregateActuals, type ActualsAggregate } from "./timelog-actuals";
import { saveActualsCache, loadActualsCache, clearActualsCache } from "./timelog-actuals-store";
import { displayableUsers, type TimelogProjectRef } from "./timelog-match";
import type { TimelogLinks, TimelogScopeMode, TimelogTimeItem, TimelogUser } from "./timelog-types";
import type { PlanGranularity } from "./types";

type Args = {
  creds: TimelogCreds;
  links: TimelogLinks;
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
  // Aborts the in-flight fetch chain (Cancel button on the loading modal). One
  // controller per sync run; the signal threads down to every proxied request.
  const abortRef = useRef<AbortController | null>(null);

  // Shared abort/busy/error wrapper. Plain functions (not memoized): they read
  // live render-scope state every call (users/aggregates/…), like the storage
  // handlers — memoizing would stale-capture them.
  async function runGuarded(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (isPopout) return; // read-only in popout
    abortRef.current?.abort(); // supersede any prior in-flight run
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError(null);
    try {
      await work(signal);
      onTokenValid();
    } catch (e) {
      // User cancellation: leave prior data + state intact, surface no error.
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      const status = e instanceof TimelogError ? e.status : 0;
      setError(status > 0 ? status : -1); // -1 = unknown/non-HTTP error
      if (status === 401 || status === 403) onTokenInvalid();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  // STEP 1 — load the org directory only (cheap: paged /v1/user). Populates the
  // People table for selection/filtering WITHOUT pulling any bookings, so the
  // user can narrow + tick before the costly per-employee timesheet fetch.
  async function loadDirectory(): Promise<void> {
    await runGuarded(async (signal) => {
      const shown = displayableUsers(await listUsers(creds, signal));
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
  // a cheap reference fetch shouldn't raise the blocking loading modal; failure
  // just leaves the dropdown at "All customers".
  async function loadCustomers(): Promise<void> {
    if (isPopout || customers.length > 0) return;
    try {
      setCustomers(await listCustomers(creds));
    } catch {
      // non-fatal — picker stays "All only"
    }
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

  // STEP 2 — fetch bookings + aggregate. Org scope iterates ONLY `userIds` when
  // provided (the ticked people) — this is what keeps the request count under
  // the rate limit; empty/omitted falls back to all loaded directory users.
  async function fetchBookings(startDate: string, endDate: string, userIds?: readonly number[]): Promise<void> {
    await runGuarded(async (signal) => {
      let resolvedScope = scopeMode;
      if (resolvedScope === "auto") {
        const priv = await getPrivileges(creds, signal);
        resolvedScope = priv.registrationAllTasks ? "org" : "self";
      }

      let items: TimelogTimeItem[] = [];
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
          }
        }
      }

      const agg = aggregateActuals(items, links, granularity);
      // Distinct projects seen — lets the matching UI bootstrap never-linked ones.
      // Skip ProjectID 0 (absence / non-project time): it has an empty name, can't
      // map to a budget bucket, and already aggregates into `unattributed` — so it
      // would only render a blank, useless row in the Projects matching table.
      const refMap = new Map<number, TimelogProjectRef>();
      for (const it of items) {
        if (it.projectId <= 0) continue;
        if (!refMap.has(it.projectId)) {
          refMap.set(it.projectId, { id: it.projectId, name: it.projectName, no: it.projectNo });
        }
      }
      const refs = [...refMap.values()];
      const at = new Date().toISOString();
      setAggregates(agg);
      setProjectRefs(refs);
      setFetchedAt(at);
      saveActualsCache(projectId, { fetchedAt: at, aggregates: agg, users, projectRefs: refs });
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
    clearActualsCache(projectId);
  }

  return { aggregates, fetchedAt, users, projectRefs, customers, busy, error, loadDirectory, loadManagedProjects, loadCustomers, fetchBookings, cancel, removeUsers, clearAll };
}
