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
import { aggregateActuals, buildDailyRoll, type ActualsAggregate } from "./timelog-actuals";
import { saveActualsCache, loadActualsCache, clearActualsCache, type TimelogRollWindow } from "./timelog-actuals-store";
import { autoMatchUsers, autoMatchProjects, displayableUsers, type TimelogProjectRef } from "./timelog-match";
import { isAbortError } from "./abort-error";
import type { TimelogDailyRoll, TimelogLinks, TimelogScopeMode, TimelogTimeItem, TimelogUser } from "./timelog-types";
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

/** The guardrail roll and the window it was fetched over, as ONE spreadable
 *  pair — the shape every `saveActualsCache` call spreads.
 *  ★★★ THIS EXISTS SO THE TWO CANNOT BE HALF-WRITTEN. An entry is rewritten
 *  whole, so a saver that carries `daily` but omits `dailyWindow` persists a
 *  roll whose coverage reads as UNKNOWN — the exact state the window was added
 *  to rule out, and a silent one: no error anywhere, just a guardrail insight
 *  that can no longer be told apart from a stale one. `daily` alone already
 *  cost this slice a save site (a "remove person" action wiping the roll), and
 *  a second independently-droppable field doubles that surface. With one
 *  spread there is no per-saver spelling left to get wrong: dropping a member
 *  means editing this function, which is a deliberate act rather than an
 *  omission. Do NOT inline it back into the four call sites.
 *  ★ Named `fetchWindow`, never `window` — this is browser code, and shadowing
 *  the DOM global inside a hook file is how a later edit reaching for
 *  `window.localStorage` here silently resolves to a date range instead.
 *  ★★★ IT CARRIES THREE MEMBERS, NOT TWO, AND THE THIRD IS WHY THE NAME LIES
 *  SLIGHTLY. `dailyUsers` is the SCOPE half of the coverage claim, and shipping
 *  the window without it was a Critical: a narrowed re-fetch wrote an intact
 *  window over a roll covering only the ticked people, and every unfetched
 *  person's insight resolved as a fabricated "improved". Kept as one spread for
 *  exactly the reason above — three independently-droppable fields is three
 *  times the surface, and the whole point is that omission is not expressible. */
function rollPair(
  roll: TimelogDailyRoll | undefined,
  fetchWindow: TimelogRollWindow | undefined,
  coveredUsers: readonly number[] | undefined,
): {
  daily: TimelogDailyRoll | undefined;
  dailyWindow: TimelogRollWindow | undefined;
  dailyUsers: readonly number[] | undefined;
} {
  return { daily: roll, dailyWindow: fetchWindow, dailyUsers: coveredUsers };
}

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
  // ★★★ The cached aggregate is SHORT — at least one project (or employee) was
  // lost to an error on the fetch that produced it. Every apply path must
  // refuse it: apply writes the lines it did not route to `0`, so applying a
  // short aggregate ERASES the missing project's hours. `=== true` because a
  // hand-edited cache may carry anything; absent means complete (§172).
  const [partial, setPartial] = useState<boolean>(() => loadActualsCache(projectId)?.partial === true);
  // Displayable directory users + distinct projects seen in the latest fetch.
  // Seeded from the per-project cache so the matching tables survive a view
  // remount (the KPIs already restore from `aggregates` — keep them in sync).
  const [users, setUsers] = useState<TimelogUser[]>(() => loadActualsCache(projectId)?.users ?? []);
  const [projectRefs, setProjectRefs] = useState<TimelogProjectRef[]>(() => loadActualsCache(projectId)?.projectRefs ?? []);
  // Per-(user, date) roll for the guardrail rules. `aggregateActuals` collapses
  // the date to a period key and sums per-entry hours away, so nothing else
  // persisted can answer a per-day or per-entry question. Only `finish` can
  // BUILD it (it alone holds `items`); the other three savers carry this state
  // through — see the ★★ note beside each of them.
  const [daily, setDaily] = useState<TimelogDailyRoll | undefined>(() => loadActualsCache(projectId)?.daily);
  // The window `daily` was fetched over. Held as state beside the roll — never
  // derived from it — because the roll cannot answer this: a day nobody booked
  // leaves no cell, so the roll's own min/max key understates its coverage and
  // a clean stretch would read as never fetched.
  const [dailyWindow, setDailyWindow] = useState<TimelogRollWindow | undefined>(() => loadActualsCache(projectId)?.dailyWindow);
  // The PEOPLE `daily` was fetched for, held as state for the same reason the
  // window is and never derived from the roll: a person fetched who booked
  // nothing leaves no cell, so the roll's own key set understates its scope and
  // a genuinely clean person would read as never fetched — which is the half
  // that must stay distinguishable, because "fetched and clean" is clearable
  // and "not fetched" must freeze.
  const [dailyUsers, setDailyUsers] = useState<readonly number[] | undefined>(() => loadActualsCache(projectId)?.dailyUsers);
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
      if (signal.aborted || isAbortError(e)) return undefined;
      const status = e instanceof TimelogError ? e.status : 0;
      setError(status > 0 ? status : -1); // -1 = unknown/non-HTTP error
      if (status === 401 || status === 403) onTokenInvalid();
      return undefined;
    } finally {
      // ★★ BOTH statements are guarded on the SAME identity test, and that is
      //    the point: a SUPERSEDED run must not clear a flag its successor has
      //    already raised. The identity test IS the generation check — the only
      //    writers of `abortRef.current` are this function's own assignment and
      //    this guarded null, and `cancel()` aborts WITHOUT nulling the ref, so
      //    a user-cancelled (not superseded) run still matches here and clears
      //    busy. A superseded run that skips the clear is always followed by a
      //    successor whose own `finally` clears it.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
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
      // ★★ `partial` rides along on EVERY save, not just `finish`'s. Omitting it
      // here would silently CLEAR the flag and re-open §172 through a directory
      // reload — an entry is rewritten whole, so a dropped field is a cleared one.
      // ★★ `daily` is that same hazard one field over, and worse to lose: a
      // cleared roll takes every guardrail rule out of evaluation with no error
      // anywhere. This path has no `items`, so it carries the state through —
      // via `rollPair`, which carries the roll's WINDOW with it (see its note).
      if (fetchedAt) {
        saveActualsCache(projectId, { fetchedAt, aggregates, users: shown, projectRefs, partial, ...rollPair(daily, dailyWindow, dailyUsers) });
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
      // ★★ `partial` and the roll pair carried through for the same reason as
      // the directory reload above — this save has no `items` either.
      if (fetchedAt) {
        saveActualsCache(projectId, { fetchedAt, aggregates, users, projectRefs: refs, partial, ...rollPair(daily, dailyWindow, dailyUsers) });
      }
    });
  }

  // Shared aggregation tail for BOTH fetch paths (per-user and per-customer):
  // derive distinct project refs, resolve effective (auto + manual) links, run
  // aggregateActuals, and persist the per-project cache. Plain function reading
  // live render-scope (users/resources/budgets/links/granularity) — same
  // non-memoized pattern as the other handlers.
  // ★★ RETURNS the aggregate it just computed, and callers that need the fresh
  // value MUST take it from here rather than reading the `aggregates` STATE
  // after awaiting: that state has not updated inside the caller's closure, so
  // a post-await read yields the PREVIOUS fetch's attribution. That matters
  // because attribution is baked HERE — `autoMatchUsers`/`autoMatchProjects`
  // resolve people and projects at this moment, and every miss folds into a
  // dimensionless `unattributed` scalar. A caller acting on the stale value
  // re-applies exactly the attribution the re-fetch existed to replace.
  // ★★ `isPartial` is the caller's, not something derivable here — a short
  //    fetch produces a perfectly well-formed aggregate, so nothing about
  //    `items` can reveal that a project was lost. Only the loop that swallowed
  //    it knows, which is why it must be passed in.
  // ★★★ REQUIRED, with no default, and that is deliberate: a default would let
  //    a future third caller silently persist `partial: false` and CLEAR the
  //    flag — the same wholesale-rewrite hazard the savers carry a note about,
  //    one layer up. Required makes that a typecheck error instead.
  // ★★★ `fetchWindow` is REQUIRED and has no default, for the same reason
  //    `isPartial` is. `finish` cannot derive it: it holds `items`, and items
  //    only reveal the days somebody BOOKED, not the days that were FETCHED — a
  //    window inferred from them would silently shrink to the first and last
  //    booking and report every clean day at the edges as never covered. Only
  //    the caller that issued the request knows what it asked for.
  //    ★ Not spelled `window`: shadowing the DOM global in browser code is how
  //    a later `window.*` read here silently resolves to a date range.
  function finish(
    items: readonly TimelogTimeItem[],
    usersOverride: readonly TimelogUser[] | undefined,
    isPartial: boolean,
    fetchWindow: TimelogRollWindow,
    coveredUsers: readonly number[],
  ): ActualsAggregate {
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
    // The ONLY place the roll can be built — the other three savers never see
    // `items`. Deliberately links-independent: the guardrail rules ask about a
    // PERSON's day, so an unlinked booker must still be measurable.
    const roll = buildDailyRoll(items);
    const at = new Date().toISOString();
    setAggregates(agg);
    setProjectRefs(refs);
    setFetchedAt(at);
    setPartial(isPartial);
    setDaily(roll);
    setDailyWindow(fetchWindow);
    setDailyUsers(coveredUsers);
    saveActualsCache(projectId, { fetchedAt: at, aggregates: agg, users: [...u], projectRefs: refs, partial: isPartial, ...rollPair(roll, fetchWindow, coveredUsers) });
    return agg;
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
      // ★★★ THE PEOPLE THIS FETCH COVERS — the scope half of the roll's coverage
      // claim, and the two branches below can answer it with different levels of
      // honesty. Org scope KNOWS its scope (`ids`, the very list it iterates).
      // Self scope does not: `listTimeItemsSelf` names nobody, and asking the
      // API who the token belongs to would be an extra request on every fetch.
      // ★★ So self scope derives it from the items, which UNDERSTATES: a token
      // owner who booked nothing in the range yields an empty list. That is the
      // safe direction and the one this whole slice is built on — an
      // understated scope freezes insights it could have cleared, while an
      // overstated one certifies a clean for somebody who was never fetched.
      // Never "fix" this by defaulting to all loaded directory users.
      let covered: readonly number[] = [];
      if (resolvedScope === "self") {
        items = await listTimeItemsSelf(creds, startDate, endDate, signal);
        covered = [...new Set(items.map((it) => it.userId).filter((id) => Number.isInteger(id) && id > 0))];
      } else {
        // Org mode: iterate the ticked users (or all loaded, if none ticked)
        // serially, fail-soft per employee. Serial (not Promise.all) to avoid
        // hammering the API and tripping the rate limit.
        const ids = userIds && userIds.length > 0 ? userIds : users.map((u) => u.userId);
        // Exactly the people iterated below — a narrowed fetch covers only these,
        // and everyone else's stored insight must FREEZE rather than resolve.
        covered = ids;
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

      // ★★ `signal.aborted` is part of the predicate, not decoration. The loop
      //    above `break`s on a cancel and falls through to here, so a run
      //    cancelled BETWEEN employees reaches `finish` with `failedEmployees`
      //    still 0 — a truncated aggregate that would persist as complete.
      // The REQUESTED range is the roll's coverage, not the range the returned
      // items span: both endpoints are queried with exactly these dates, so a
      // day inside it with no cell was fetched and genuinely had no bookings.
      // ★ An employee whose own fetch FAILED is still in `covered`, and that is
      // safe only because `failedEmployees > 0` sets `isPartial`, which freezes
      // every guardrail insight regardless of scope. Drop that term and this
      // list starts overstating coverage.
      finish(items, undefined, failedEmployees > 0 || signal.aborted, { from: startDate, to: endDate }, covered);
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
    // `aggregates` is ABSENT when no projects were picked — that branch
    // deliberately does not call `finish()` (clobbering good aggregates with an
    // empty result is silent data loss), so there is no fresh value to hand
    // back and a caller must not invent one.
  ): Promise<{ failedProjects: number; projectCount: number; aggregates?: ActualsAggregate } | undefined> {
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
      // `signal.aborted` for the same reason as the per-user path above: the
      // loop `break`s on a cancel and still reaches this line.
      // Same window the rows were just clamped to (`inWindow`), so the roll and
      // its declared coverage are derived from one pair of dates and cannot
      // disagree — the v2 endpoint ignores the date params, and claiming
      // coverage of the project's whole history would be a fabricated clean.
      // ★★★ PROJECT SCOPE COVERS NOBODY FULLY, so it certifies nothing — the
      // empty list is deliberate and is NOT the same bug as omitting the field.
      // Every other scope fetches a PERSON's whole day; this one fetches only
      // the selected PROJECTS, so a person's remaining hours can sit on a
      // project nobody ticked. Their day total, their worst entry and their
      // holiday bookings are all knowable only in part, which means "no
      // violation found" here is never evidence of a clean — it is evidence
      // about a subset. Handing `bookerIds` over instead would certify exactly
      // the people this fetch measured LEAST completely, since a booker on one
      // project is precisely somebody whose other projects are missing.
      // ★★ CONSEQUENCE, and it is a real cost, not a free win: a user working
      // only in project scope never auto-resolves a guardrail insight — they
      // freeze until an org- or self-scope fetch covers the person. That is the
      // recoverable direction; a fabricated "improved" in exported data is not.
      const agg = finish(inWindow, bookers, failedProjects > 0 || signal.aborted, { from: startDate, to: endDate }, []);
      return { failedProjects, projectCount: ids.length, aggregates: agg };
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
      // ★★ Fourth saver. The roll pair is carried through here too — a
      // display-only people cleanup must not take the guardrail roll, or its
      // declared coverage, with it.
      saveActualsCache(projectId, { fetchedAt, aggregates, users: next, projectRefs, partial, ...rollPair(daily, dailyWindow, dailyUsers) });
    }
  }

  function clearAll() {
    if (isPopout) return;
    setAggregates(undefined);
    setFetchedAt(undefined);
    setPartial(false);
    // ★ Reset with the rest: `daily` is RETURNED from the hook, so leaving it
    // set would keep the guardrail rules evaluating a roll whose cache entry
    // was just cleared — the same staleness the other resets exist to avoid.
    setDaily(undefined);
    // ★ Reset WITH the roll, never after it: a window outliving its roll would
    // claim coverage for days nothing can be read from — worse than no window.
    setDailyWindow(undefined);
    // Same rule for the scope half: a covered-people list outliving its roll
    // certifies people whose cells are gone.
    setDailyUsers(undefined);
    setUsers([]);
    setProjectRefs([]);
    fullDirectoryRef.current = null; // force a fresh directory on the next fetch
    clearActualsCache(projectId);
  }

  return { aggregates, fetchedAt, partial, daily, dailyWindow, dailyUsers, users, projectRefs, customers, customerProjects, busy, error, loadDirectory, loadManagedProjects, loadCustomers, loadCustomerProjects, fetchBookings, fetchBookingsForProjects, cancel, removeUsers, clearAll };
}
