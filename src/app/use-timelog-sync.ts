// src/app/use-timelog-sync.ts
// On-demand fetch of Timelog bookings. Resolves scope (auto/self/org),
// aggregates via timelog-actuals, and caches the result per-project.
// Never logs token or response body — errors carry only status digits.
import { useCallback, useState } from "react";
import {
  listUsers,
  getPrivileges,
  listTimeItemsSelf,
  listEmployeeTimeItems,
  TimelogError,
  type TimelogCreds,
} from "./timelog-api";
import { aggregateActuals, type ActualsAggregate } from "./timelog-actuals";
import { saveActualsCache, loadActualsCache } from "./timelog-actuals-store";
import type { TimelogProjectRef } from "./timelog-match";
import type { TimelogLinks, TimelogScopeMode, TimelogTimeItem } from "./timelog-types";

type Args = {
  creds: TimelogCreds;
  links: TimelogLinks;
  scopeMode: TimelogScopeMode;
  projectId: string;
  isPopout: boolean;
  onTokenInvalid: () => void;
  onTokenValid: () => void;
};

export function useTimelogSync(args: Args) {
  const projectId = args.projectId;
  const isPopout = args.isPopout;
  const scopeMode = args.scopeMode;
  const creds = args.creds;
  const links = args.links;
  const onTokenInvalid = args.onTokenInvalid;
  const onTokenValid = args.onTokenValid;

  const [aggregates, setAggregates] = useState<ActualsAggregate | undefined>(() => loadActualsCache(projectId)?.aggregates);
  const [fetchedAt, setFetchedAt] = useState<string | undefined>(() => loadActualsCache(projectId)?.fetchedAt);
  // Distinct Timelog projects seen in the most recent fetch. In-memory only —
  // empty until a Fetch runs (the intended bootstrap path for project matching).
  const [projectRefs, setProjectRefs] = useState<TimelogProjectRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<number | null>(null);

  const sync = useCallback(
    async (startDate: string, endDate: string): Promise<void> => {
      if (isPopout) return; // read-only in popout
      setBusy(true);
      setError(null);
      try {
        // Resolve effective scope
        let resolvedScope = scopeMode;
        if (resolvedScope === "auto") {
          const priv = await getPrivileges(creds);
          resolvedScope = priv.registrationAllTasks ? "org" : "self";
        }

        let items: TimelogTimeItem[] = [];
        if (resolvedScope === "self") {
          items = await listTimeItemsSelf(creds, startDate, endDate);
        } else {
          // Org mode: iterate users serially, fail-soft per employee
          const users = await listUsers(creds);
          for (const u of users) {
            try {
              const empItems = await listEmployeeTimeItems(creds, u.userId, startDate, endDate);
              items = items.concat(empItems);
            } catch {
              // Swallow per-employee errors; continue with remaining employees
            }
          }
        }

        const agg = aggregateActuals(items, links);
        // Collect the distinct projects seen so the matching UI can bootstrap
        // brand-new (never-linked) Timelog projects from real bookings.
        const refMap = new Map<number, TimelogProjectRef>();
        for (const it of items) {
          if (!refMap.has(it.projectId)) {
            refMap.set(it.projectId, { id: it.projectId, name: it.projectName, no: it.projectNo });
          }
        }
        const at = new Date().toISOString(); // inside callback — purity-rule-safe
        setAggregates(agg);
        setProjectRefs([...refMap.values()]);
        setFetchedAt(at);
        saveActualsCache(projectId, { fetchedAt: at, aggregates: agg });
        onTokenValid();
      } catch (e) {
        const status = e instanceof TimelogError ? e.status : 0;
        setError(status > 0 ? status : -1); // -1 = unknown/non-HTTP error
        if (status === 401 || status === 403) onTokenInvalid();
      } finally {
        setBusy(false);
      }
    },
    [isPopout, scopeMode, creds, links, projectId, onTokenInvalid, onTokenValid],
  );

  return { aggregates, fetchedAt, projectRefs, busy, error, sync };
}
