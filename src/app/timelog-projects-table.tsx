"use client";

// Presentational Projects-matching section for the Timelog panel (gantt-convention
// leaf). PURE: the orchestrator (`timelog-panel.tsx`) owns state + network; this
// renders the project→budget link table plus its "Load my projects" controls.

import { t, type Lang } from "./i18n";
import { DataTable } from "./data-table";
import { Checkbox, Select } from "./form-controls";
import { INTERACTIVE } from "./interaction-styles";
import { canLoadManagedProjects } from "./timelog-guards";
import type { TimelogProjectRef } from "./timelog-match";
import type { BudgetBucket } from "./types";
import { ROW_RULE_CLASS } from "./table-styles";

/** Effective project→budget link (auto or manual, manual wins). */
type ProjectLinkView = { timelogProjectId: number; bucketId: number | null; manual: boolean };

interface TimelogProjectsTableProps {
  lang: Lang;
  isPopout: boolean;
  knownProjectRefs: readonly TimelogProjectRef[];
  effectiveProjectLinks: readonly ProjectLinkView[];
  budgets: readonly BudgetBucket[];
  onManualLinkProject: (timelogProjectId: number, bucketId: number | null) => void;
  includeClosedProjects: boolean;
  onIncludeClosedChange: (checked: boolean) => void;
  syncBusy: boolean;
  isMisconfigured: boolean;
  confirming: boolean;
  onLoadManagedProjects: () => void;
}

export function TimelogProjectsTable({
  lang,
  isPopout,
  knownProjectRefs,
  effectiveProjectLinks,
  budgets,
  onManualLinkProject,
  includeClosedProjects,
  onIncludeClosedChange,
  syncBusy,
  isMisconfigured,
  confirming,
  onLoadManagedProjects,
}: TimelogProjectsTableProps) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
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
            <Checkbox
              checked={includeClosedProjects}
              disabled={isPopout}
              onChange={(e) => onIncludeClosedChange(e.target.checked)}
              className="align-middle"
            />
            {t(lang, "timelogIncludeClosed")}
          </label>
          <button
            type="button"
            disabled={!canLoadManagedProjects({ isPopout, syncBusy, confirming, isMisconfigured })}
            onClick={onLoadManagedProjects}
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
          <DataTable className="w-full text-sm" head={<>
              <tr>
                <th scope="col" className="px-2 py-1 text-left">{t(lang, "timelogMatchProjects")}</th>
                <th scope="col" className="px-2 py-1 text-left">{t(lang, "tabBudget")}</th>
                <th scope="col" className="px-2 py-1 text-left">{t(lang, "status")}</th>
                <th scope="col" className="px-2 py-1 text-left">{t(lang, "timelogMatchClear")}</th>
              </tr>
            </>}>
              {knownProjectRefs.map((p) => {
                const pLink = effectiveProjectLinks.find((l) => l.timelogProjectId === p.id);
                const displayId = p.name;
                const selectLabel = `${t(lang, "timelogMatchProjects")} – ${displayId}`;
                const clearLabel = `${t(lang, "timelogMatchClear")} – ${displayId}`;
                return (
                  <tr key={p.id} className={ROW_RULE_CLASS}>
                    <td className="py-2 pr-3 text-foreground">{displayId}</td>
                    <td className="py-2 pr-2">
                      <Select
                        size="xs"
                        aria-label={selectLabel}
                        value={pLink?.bucketId ?? ""}
                        disabled={isPopout}
                        onChange={(e) =>
                          onManualLinkProject(
                            p.id,
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      >
                        <option value="">{t(lang, "timelogMatchNone")}</option>
                        {budgets.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
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
                        onClick={() => onManualLinkProject(p.id, null)}
                        className={`rounded border border-line px-2 py-0.5 text-xs text-muted-foreground ${INTERACTIVE}`}
                      >
                        {t(lang, "timelogMatchClear")}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </DataTable>
        </div>
      )}
    </section>
  );
}
