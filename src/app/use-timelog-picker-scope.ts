// Render-scope glue for the Time-bookings customer→project PICKER: which
// customer is scoped, which of that customer's projects are ticked, the two
// wildcard filters over each list, and the one-shot ladder that seeds all of it
// when the view mounts or the project changes underneath it.
//
// Extracted from `timelog-panel.tsx` (which sat at the 800-line ratchet) as a
// deps-object hook in the Phase-3 convention: it takes live render-scope values,
// is called UNCONDITIONALLY, and returns NON-memoized handlers that read live
// scope on every call. The pure decisions it makes live in `timelog-initial-scope`
// and `timelog-picker-store`, which are unit-tested on their own; what remains
// here is React state plumbing, exercised through `timelog-panel.test.tsx`.

import { useEffect, useMemo, useState } from "react";
import { type Lang } from "./i18n";
import { reportSilentFailure } from "./guard-feedback";
import { loadPickerScope, savePickerScope } from "./timelog-picker-store";
import { resolveInitialScope, type InitialScopeSource } from "./timelog-initial-scope";
import { wildcardMatcher } from "./wildcard-match";
import type { TimelogProjectRef } from "./timelog-match";

/** Precedence of each picker-seed source. Higher wins, and the hook only
 *  re-seeds on a STRICTLY higher rank — so a source that arrives late (workspace
 *  `timelogLinks` hydrating after the customer directory) can still override a
 *  weaker earlier seed, while the same source never fires twice. */
const SCOPE_SOURCE_RANK: Record<InitialScopeSource, number> = {
  none: 0,
  auto: 1,
  links: 2,
  picker: 3,
};

/** Wildcard customer-name match: `*` is a wildcard, everything else literal.
 *  Thin alias kept for its call sites; the logic lives in the shared matcher so
 *  the chip pickers and this filter cannot drift. */
export function customerMatcher(query: string): (name: string) => boolean {
  return wildcardMatcher(query);
}

export interface TimelogCustomerRef {
  id: number;
  name: string;
}

export interface TimelogPickerScopeDeps {
  lang: Lang;
  isPopout: boolean;
  /** Canonical per-device store key (`portfolioCurrentId ?? "default"`). */
  projectKey: string;
  /** `ws.project?.code` — the in-place project-switch signal, NOT the store key. */
  projectId: string;
  /** The project's free-text customer name, for the weakest seed source. */
  projectCustomerName: string | undefined;
  /** Workspace last-FETCHED scope. */
  links: { customerId?: number; projectIds?: number[] };
  /** Loaded TimeLog customer directory (empty until fetched). */
  customers: readonly TimelogCustomerRef[];
  /** The scoped customer's projects, as loaded by `loadCustomerProjects`. */
  customerProjects: readonly TimelogProjectRef[];
  loadCustomerProjects: (customerId: number) => Promise<unknown>;
  /** Derived rather than hand-written: `ShowToast` is not exported from
   *  toast-context, and its parameter ORDER is (kind, text). */
  showToast: Parameters<typeof reportSilentFailure>[0];
}

export interface TimelogPickerScope {
  projectCustomerId: number | "";
  selectedProjectIds: Set<number>;
  projectFilter: string;
  setProjectFilter: (v: string) => void;
  customerFilter: string;
  setCustomerFilter: (v: string) => void;
  /** `customerProjects` after the wildcard filter. */
  filteredProjects: readonly TimelogProjectRef[];
  /** Filtered customers, with the current selection force-included. */
  customerOptions: readonly TimelogCustomerRef[];
  toggleProject: (id: number) => void;
  toggleAllProjects: () => void;
  handleCustomerSelect: (next: number | "") => void;
  /** Display name of the scoped customer; falls back to the id. */
  scopedCustomerName: string;
}

export function useTimelogPickerScope(deps: TimelogPickerScopeDeps): TimelogPickerScope {
  const {
    lang,
    isPopout,
    projectKey,
    projectId,
    projectCustomerName,
    links,
    customers,
    customerProjects,
    loadCustomerProjects,
    showToast,
  } = deps;

  const [projectCustomerId, setProjectCustomerId] = useState<number | "">("");
  // Step 2 of the fetch flow: the customer's projects the user picked. Fetch is
  // gated on a customer + ≥1 project; the People table is then derived from who
  // booked on these projects (the directory auto-loads on Fetch to resolve names).
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  // Wildcard filter (`*`) over the customer's projects — matches name OR number.
  const [projectFilter, setProjectFilter] = useState("");
  const filteredProjects = useMemo(() => {
    const m = customerMatcher(projectFilter);
    return customerProjects.filter((p) => m(p.name) || (!!p.no && m(p.no)));
  }, [customerProjects, projectFilter]);

  // Persist the CURRENT picker selection per device. Distinct from the workspace
  // `timelogLinks` write in handleFetchBookings, which records the LAST-FETCHED
  // scope and must not move when the user merely changes the picker.
  const persistPicker = (customerId: number | "", projectIds: ReadonlySet<number>) => {
    if (isPopout) return;
    savePickerScope(projectKey, {
      customerId: customerId === "" ? undefined : customerId,
      projectIds: [...projectIds],
    });
  };
  // ★★ These two deliberately compute `next` in the handler body rather than in a
  // functional updater. `persistPicker` writes localStorage, React 19 StrictMode
  // double-invokes state updaters, and the react-hooks purity rule the lint
  // config enforces as fatal bans a side effect inside one.
  // ★ Reading live `selectedProjectIds` is safe here: these are single user
  // gestures, not the "N saves in one tick" bulk-edit pattern that makes
  // functional setters mandatory elsewhere in this codebase.
  //
  // ★★ Both set `userPicked`. Ticking a project IS an explicit pick, and without
  // this a source that arrives LATER at a higher rank overwrites it: name
  // auto-resolve seeds (rank 1) → the user ticks a project → `timelogLinks`
  // hydrates for a different customer (rank 2) → the ladder replaces both the
  // customer and the whole project selection, and their tick is gone. (The same
  // hole existed before the ladder was rank-based: the old links block gated on
  // `!linksSeeded && !userPicked` and neither toggle set the latter.)
  const toggleProject = (id: number) => {
    const next = new Set(selectedProjectIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setUserPicked(true);
    setSelectedProjectIds(next);
    persistPicker(projectCustomerId, next);
  };
  // Select-all toggles the CURRENTLY-VISIBLE (filtered) projects, preserving any
  // selection hidden by the active filter.
  const toggleAllProjects = () => {
    const allVisible =
      filteredProjects.length > 0 && filteredProjects.every((p) => selectedProjectIds.has(p.id));
    const next = new Set(selectedProjectIds);
    for (const p of filteredProjects) { if (allVisible) next.delete(p.id); else next.add(p.id); }
    setUserPicked(true);
    setSelectedProjectIds(next);
    persistPicker(projectCustomerId, next);
  };
  // A customer change invalidates the project selection (projects belong to a
  // customer), so clear it in the same beat and persist the cleared pair.
  const handleCustomerSelect = (next: number | "") => {
    setUserPicked(true);
    setProjectCustomerId(next);
    setSelectedProjectIds(new Set());
    setProjectFilter("");
    persistPicker(next, new Set());
  };
  // Load the chosen customer's projects into the picker when the customer changes
  // (pick OR persisted-scope seed). An await-then-setState data load, not a
  // synchronous state-sync — the set-state-in-effect ban targets the latter.
  useEffect(() => {
    if (isPopout || projectCustomerId === "") return;
    void Promise.resolve(loadCustomerProjects(Number(projectCustomerId))).catch((e) =>
      reportSilentFailure(showToast, lang, "timelog.customerProjectsFailed", e, "guardTimelogCustomerProjectsFailed"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync fns are re-created each render; key on the customer id only
  }, [projectCustomerId, isPopout]);

  const [customerFilter, setCustomerFilter] = useState("");
  // Wildcard-filtered customer options; keep the current selection present even
  // when filtered out OR when the customer list isn't loaded yet (persisted
  // scope) so the <select> value always resolves to a real option.
  const customerOptions = useMemo(() => {
    const match = customerMatcher(customerFilter);
    const list = customers.filter((c) => match(c.name));
    if (projectCustomerId !== "" && !list.some((c) => c.id === projectCustomerId)) {
      const selCust = customers.find((c) => c.id === projectCustomerId);
      return [selCust ?? { id: projectCustomerId, name: String(projectCustomerId) }, ...list];
    }
    return list;
  }, [customers, customerFilter, projectCustomerId]);

  // Seed the customer scope via a render-time reconcile (state-guarded — the
  // codebase's nonce/last-seen pattern, NOT a ref accessed in render, NOT
  // set-state-in-effect). `userPicked` distinguishes an explicit pick from an
  // auto value, so a seed can never override a manual pick.
  const [userPicked, setUserPicked] = useState(false);
  // Precedence of the source the picker was last seeded FROM (0 = unseeded).
  // ★★ A rank rather than a one-shot boolean, because the sources do not all
  // arrive at once: `links` comes from workspace data and can hydrate AFTER the
  // customer directory has already driven a name auto-resolve. A boolean would
  // latch on the auto-resolve and silently drop the higher-precedence links
  // scope. Monotonic — the same source never re-fires, so this cannot loop.
  const [seededRank, setSeededRank] = useState(0);
  // Last-seen projectId: reset the one-shots when the project changes IN PLACE
  // (no remount) so the picker re-seeds for the new project.
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  // Read the device picker ONCE per project rather than on every render: the
  // seeding ladder below can stay armed indefinitely (a project whose customer
  // name matches nothing never reaches a seedable source), and this read is a
  // localStorage hit plus a JSON parse plus a whole-map validation. Our own
  // persistPicker writes are already reflected in state, so re-reading buys
  // nothing.
  const pickerScope = useMemo(() => loadPickerScope(projectKey), [projectKey]);
  // On an in-place project switch, reset and DON'T seed this render: the reset
  // setStates are queued (not yet visible in this render's `seededRank`/
  // `projectCustomerId` locals), so seeding now would read the OLD project's
  // stale flags/links. The seed block below is gated on `!projectChanged` and
  // fires on the next render with fresh state.
  const projectChanged = seenProjectId !== projectId;
  if (projectChanged) {
    setSeenProjectId(projectId);
    setUserPicked(false);
    setSeededRank(0);
    setProjectCustomerId("");
    setCustomerFilter("");
    setSelectedProjectIds(new Set());
    setProjectFilter("");
  }
  // Seed in precedence order: the per-device picker scope (what was last
  // SELECTED) beats the workspace links scope (what was last FETCHED), which
  // beats resolving the project's free-text customer name. An explicit user pick
  // outranks all three via `userPicked`.
  //
  // Re-seeding is allowed only when a STRICTLY higher-precedence source appears
  // than the one already used, which is what lets late-hydrating links override
  // an earlier name auto-resolve without ever re-firing on the same source.
  if (!projectChanged && !userPicked) {
    const seed = resolveInitialScope({
      picker: pickerScope,
      links: { customerId: links.customerId, projectIds: links.projectIds },
      customers,
      customerName: projectCustomerName,
    });
    const rank = SCOPE_SOURCE_RANK[seed.source];
    if (rank > seededRank) {
      setSeededRank(rank);
      setProjectCustomerId(seed.customerId);
      if (seed.projectIds.length > 0) setSelectedProjectIds(new Set(seed.projectIds));
    }
  }
  // Display name of the active scope (for the header note); falls back to the id.
  const scopedCustomerName =
    projectCustomerId === ""
      ? ""
      : customers.find((c) => c.id === projectCustomerId)?.name ?? String(projectCustomerId);

  return {
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
  };
}
