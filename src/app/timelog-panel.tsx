"use client";
// src/app/timelog-panel.tsx
// User-facing Timelog integration view: people/project matching tables, KPI
// tiles, and the apply-to-budget flow. Consumes only pure engines + context —
// no direct API calls in render; all network happens inside event handlers.
import { useMemo, useState } from "react";
import { t, type Lang } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useSettings } from "./use-settings";
import { useTimelogSync } from "./use-timelog-sync";
import { autoMatchUsers, autoMatchProjects, type TimelogProjectRef } from "./timelog-match";
import { planApply, applyActualsToBuckets } from "./timelog-apply";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { defaultTimelogConfig, type TimelogLinks, type TimelogUser } from "./timelog-types";
import { listUsers } from "./timelog-api";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { Tile } from "./report-table";

export function TimelogPanel({ lang, isPopout = false }: { lang: Lang; isPopout?: boolean }) {
  const ws = useWorkspace();
  const { settings, setSettings } = useSettings();
  const cfg = settings.timelog ?? defaultTimelogConfig;

  // Stable references hoisted out of useMemo deps to avoid obj.member lint errors
  const timelogLinks = ws.timelogLinks;
  const budgets = ws.budgets;
  const resources = ws.resources;

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
    scopeMode: cfg.scopeMode,
    projectId,
    isPopout,
    onTokenInvalid: () =>
      setSettings((s) => ({
        ...s,
        timelog: { ...(s.timelog ?? defaultTimelogConfig), tokenInvalidAt: new Date().toISOString() },
      })),
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

  // Fetched users are populated by the Fetch handler. Project rows come from
  // `sync.projectRefs` (distinct projects seen in the latest fetch — this lets
  // brand-new, never-linked Timelog projects appear and be matched) MERGED with
  // any already-linked projects not present in that fetch (so prior mappings
  // still render even when no current bookings reference them).
  const [fetchedUsers, setFetchedUsers] = useState<TimelogUser[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  function setLinks(next: TimelogLinks) {
    ws.setTimelogLinks(sanitizeTimelogLinks(next) ?? { userLinks: [], projectLinks: [] });
  }

  function manualLinkUser(timelogUserId: number, resourceId: number | null) {
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
    const rest = links.projectLinks.filter((l) => l.timelogProjectId !== timelogProjectId);
    setLinks({
      ...links,
      projectLinks: [...rest, { timelogProjectId, bucketId, manual: true }],
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
  const applyDiff = useMemo(
    () => (overlay ? planApply(budgets, overlay) : []),
    [overlay, budgets],
  );

  const [confirming, setConfirming] = useState(false);

  function applyToBudget() {
    if (!sync.aggregates) return;
    const ov = sync.aggregates.byBucket;
    ws.setBudgets((prev) => applyActualsToBuckets(prev, ov));
    setConfirming(false);
  }

  // Fetch handler — new Date() lives here (inside callback), never in render
  async function handleFetch() {
    if (isPopout || sync.busy) return;
    setFetchError(null);
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    // Use project span if available, else rolling 90-day window
    const start =
      ws.project?.startDate ??
      new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Fetch users in parallel with the time-items sync
    try {
      const [users] = await Promise.allSettled([
        listUsers(creds),
        sync.sync(start, end),
      ]);
      if (users.status === "fulfilled") {
        setFetchedUsers(users.value);
      }
    } catch {
      setFetchError("fetch-failed");
    }
  }

  const isMisconfigured = !cfg.enabled || !cfg.host || !cfg.apiToken;

  return (
    <div className={VIEW_PANE_FILL_CLASS}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t(lang, "timelogTitle")}</h2>
        <button
          type="button"
          disabled={sync.busy || isPopout || isMisconfigured}
          onClick={handleFetch}
          className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
        >
          {sync.busy ? t(lang, "loadingTimelog") : t(lang, "timelogSync")}
        </button>
      </div>

      {/* Token-invalid warning */}
      {cfg.tokenInvalidAt && (
        <p className="mb-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          {t(lang, "timelogTokenInvalid")}
        </p>
      )}

      {/* Fetch error */}
      {fetchError && (
        <p className="mb-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          {t(lang, "timelogTestFail")}
        </p>
      )}

      {/* Misconfigured notice */}
      {isMisconfigured && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t(lang, "timelogEnable")}
        </p>
      )}

      {/* Last synced + unattributed */}
      {sync.fetchedAt && (
        <p className="mb-3 text-xs text-muted-foreground">
          {t(lang, "timelogLastSynced", sync.fetchedAt)}{" "}
          {t(lang, "timelogUnattributed", String(Math.round(unattributed.hours)))}
        </p>
      )}

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

      {/* People matching table */}
      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "timelogMatchPeople")}
        </h3>
        {fetchedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "timelogMatchNone")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {fetchedUsers.map((u) => {
                  const link = effectiveUserLinks.find((l) => l.timelogUserId === u.userId);
                  const displayId = u.email || String(u.userId);
                  const selectLabel = `${t(lang, "timelogMatchPeople")} – ${displayId}`;
                  const clearLabel = `${t(lang, "timelogMatchClear")} – ${displayId}`;
                  return (
                    <tr key={u.userId} className="border-b border-line last:border-0">
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
                      <td className="py-2">
                        {link && (
                          <button
                            type="button"
                            aria-label={clearLabel}
                            onClick={() => manualLinkUser(u.userId, null)}
                            className={`rounded border border-line px-2 py-0.5 text-xs text-muted-foreground ${INTERACTIVE}`}
                          >
                            {t(lang, "timelogMatchClear")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Projects matching table */}
      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "timelogMatchProjects")}
        </h3>
        {knownProjectRefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "timelogMatchNone")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {knownProjectRefs.map((p) => {
                  const pLink = effectiveProjectLinks.find((l) => l.timelogProjectId === p.id);
                  const displayId = p.name !== String(p.id) ? p.name : String(p.id);
                  const selectLabel = `${t(lang, "timelogMatchProjects")} – ${displayId}`;
                  const clearLabel = `${t(lang, "timelogMatchClear")} – ${displayId}`;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 text-foreground">{displayId}</td>
                      <td className="py-2 pr-2">
                        <select
                          aria-label={selectLabel}
                          value={pLink?.bucketId ?? ""}
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
          onClick={() => setConfirming(true)}
          className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-40 ${INTERACTIVE}`}
        >
          {t(lang, "timelogApply")}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface-muted px-3 py-2">
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
            onClick={() => setConfirming(false)}
            className={`rounded-md border border-line px-3 py-1 text-sm text-muted-foreground ${INTERACTIVE}`}
          >
            {t(lang, "cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
