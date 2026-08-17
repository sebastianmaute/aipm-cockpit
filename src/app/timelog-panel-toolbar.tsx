"use client";

// Presentational header toolbar for the Timelog panel (gantt-convention leaf).
// PURE: the orchestrator (`timelog-panel.tsx`) owns all state + network and
// passes values + handlers. Left group = fetch controls (customer scope, Clear,
// Fetch, Refresh); right group = view utilities (Print, column/size resets).

import { ArrowPathIcon, ArrowPathRoundedSquareIcon } from "@heroicons/react/24/outline";
import { t, type Lang } from "./i18n";
import { TimelogCustomerScope } from "./timelog-customer-scope";
import { INTERACTIVE } from "./interaction-styles";
import { ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { canClearAllFetched, canFetchBookings, canRefreshAndReapply, canRefreshBookings } from "./timelog-guards";

interface TimelogToolbarProps {
  lang: Lang;
  isPopout: boolean;
  projectCustomerId: number | "";
  customerOptions: readonly { id: number; name: string }[];
  customerFilter: string;
  onCustomerFilterChange: (value: string) => void;
  onCustomerSelectChange: (value: number | "") => void;
  onCustomerFocusLoad: () => void;
  syncBusy: boolean;
  fetchedAt: string | null | undefined;
  confirming: boolean;
  isMisconfigured: boolean;
  selectedCount: number;
  onClearAll: () => void;
  onFetch: () => void;
  onRefresh: () => void;
  onRefreshAndReapply: () => void;
  canRefresh: boolean;
  onResetColWidths: () => void;
  onResetPaneSize: () => void;
}

export function TimelogToolbar({
  lang,
  isPopout,
  projectCustomerId,
  customerOptions,
  customerFilter,
  onCustomerFilterChange,
  onCustomerSelectChange,
  onCustomerFocusLoad,
  syncBusy,
  fetchedAt,
  confirming,
  isMisconfigured,
  selectedCount,
  onClearAll,
  onFetch,
  onRefresh,
  onRefreshAndReapply,
  canRefresh,
  onResetColWidths,
  onResetPaneSize,
}: TimelogToolbarProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {/* Customer scope (lazy-loads on focus). Selecting a customer loads its
            projects into the picker below; Fetch is gated on customer + ≥1 project. */}
        <TimelogCustomerScope
          lang={lang}
          value={projectCustomerId}
          options={customerOptions}
          filter={customerFilter}
          disabled={isPopout}
          onFilterChange={onCustomerFilterChange}
          onSelectChange={onCustomerSelectChange}
          onFocusLoad={onCustomerFocusLoad}
        />
        <button
          type="button"
          disabled={!canClearAllFetched({ isPopout, syncBusy, confirming, hasFetched: !!fetchedAt })}
          onClick={onClearAll}
          className={`rounded-md border border-ui-pink/50 bg-surface px-3 py-1.5 text-sm font-medium text-ui-pink-strong hover:bg-ui-pink/10 disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "clearAll")}
        </button>
        <button
          type="button"
          disabled={!canFetchBookings({ isPopout, syncBusy, confirming, isMisconfigured, projectCustomerId, selectedCount })}
          onClick={onFetch}
          title={projectCustomerId === "" || selectedCount === 0 ? t(lang, "timelogFetchNeedsSelection") : undefined}
          className={`rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
        >
          {syncBusy
            ? t(lang, "loadingTimelog")
            : `${t(lang, "timelogSync")}${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
        </button>
        {/* Refresh — appears once bookings have been read; re-fetches the
            LAST-FETCHED (persisted) customer + project scope so the user can
            pull the latest bookings without re-picking, even if the picker was
            since changed. Distinct from Fetch (current selection). */}
        {fetchedAt && (
          <button
            type="button"
            disabled={!canRefreshBookings({ isPopout, syncBusy, confirming, isMisconfigured, canRefresh })}
            onClick={onRefresh}
            title={t(lang, "timelogRefreshHint")}
            className={`inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
          >
            <ArrowPathIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {t(lang, "timelogRefresh")}
          </button>
        )}
        {/* Refresh & re-apply — the same re-fetch, then the SAME apply confirm
            dialog, seeded with the fresh diff. It exists because attribution is
            baked at fetch time: a person or project linked AFTER a fetch is
            invisible to the cached aggregate, so re-applying that cache cannot
            recover their hours. Sits beside Refresh (whose scope it shares) and
            BEFORE the trailing Print / reset group, which it is not a member
            of. Gated on `fetchedAt` for the same reason Refresh is — with
            nothing fetched there is no persisted scope to re-pull. */}
        {fetchedAt && (
          <button
            type="button"
            disabled={!canRefreshAndReapply({ isPopout, syncBusy, confirming, isMisconfigured, canRefresh })}
            onClick={onRefreshAndReapply}
            title={t(lang, "timelogRefreshReapplyHint")}
            className={`inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
          >
            <ArrowPathRoundedSquareIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {t(lang, "timelogRefreshReapply")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={onResetColWidths} lang={lang} />
        <ResetSizeButton onClick={onResetPaneSize} lang={lang} />
      </div>
    </div>
  );
}
