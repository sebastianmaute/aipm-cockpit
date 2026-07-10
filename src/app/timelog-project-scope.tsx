// Presentational multi-select of a customer's TimeLog projects — the second
// step of the customer→project booking-fetch flow. Renders a labelled,
// scrollable checkbox list with a select-all control. i18n-free logic; all
// strings via `t`. Time-bookings IS in the axe A11Y_VIEWS, so every control
// carries an accessible name (row-unique per project).
"use client";
import { t, type Lang } from "./i18n";
import type { TimelogProjectRef } from "./timelog-match";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

interface TimelogProjectScopeProps {
  lang: Lang;
  /** The customer's projects, ALREADY wildcard-filtered by the caller. */
  projects: readonly TimelogProjectRef[];
  selectedIds: ReadonlySet<number>;
  /** True until a customer is chosen (list disabled + hint shown). */
  hasCustomer: boolean;
  /** Wildcard filter text (`*` supported) + its setter — filters name/number. */
  filter: string;
  onFilterChange: (v: string) => void;
  onToggle: (id: number) => void;
  /** Toggle every CURRENTLY-VISIBLE (filtered) project. */
  onToggleAll: () => void;
  disabled?: boolean;
}

export function TimelogProjectScope({
  lang,
  projects,
  selectedIds,
  hasCustomer,
  filter,
  onFilterChange,
  onToggle,
  onToggleAll,
  disabled,
}: TimelogProjectScopeProps) {
  const allSelected = projects.length > 0 && projects.every((p) => selectedIds.has(p.id));
  const off = disabled || !hasCustomer;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t(lang, "timelogProjectScopeLabel")}
          {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
        </span>
        {projects.length > 0 && !off && (
          <label className={`flex items-center gap-1 text-xs text-muted-foreground ${TRANSITION}`}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              className={`accent-AIPM-dark-blue ${FOCUS_RING}`}
              aria-label={t(lang, "timelogProjectSelectAll")}
            />
            {t(lang, "timelogProjectSelectAll")}
          </label>
        )}
      </div>
      {hasCustomer && (
        <input
          type="text"
          role="searchbox"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={t(lang, "timelogProjectFilter")}
          aria-label={t(lang, "timelogProjectFilter")}
          disabled={disabled}
          className={`w-full rounded-md border border-line bg-surface px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
        />
      )}
      {!hasCustomer ? (
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted-foreground">
          {t(lang, "timelogProjectPickCustomerFirst")}
        </p>
      ) : projects.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted-foreground">
          {t(lang, filter.trim() ? "timelogProjectNoMatch" : "timelogNoCustomerProjects")}
        </p>
      ) : (
        <ul className="max-h-40 min-w-56 overflow-auto rounded-md border border-line pr-2">

          {projects.map((p) => (
            <li key={p.id}>
              <label className={`flex items-center gap-2 px-2 py-1 text-sm ${INTERACTIVE}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={() => onToggle(p.id)}
                  disabled={off}
                  className={`accent-AIPM-dark-blue ${FOCUS_RING}`}
                  aria-label={`${t(lang, "timelogProjectScopeLabel")} – ${p.name}${p.no ? ` (${p.no})` : ""}`}
                />
                <span className="truncate">
                  {p.name}
                  {p.no ? <span className="text-muted-foreground"> · {p.no}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
