"use client";

// Activity log panel — sortable, filterable, searchable table of recorded
// user actions. The log state lives in TaskManager (single source of truth
// for persistence); this component owns only its view-state (sort, filter,
// search).
//
// Search supports three modes:
//   • Text     — case-insensitive substring match
//   • Wildcard — `*` matches any run of chars, `?` matches one char; other
//                regex metacharacters are escaped
//   • Regex    — raw user-supplied pattern, case-insensitive; invalid
//                patterns are flagged inline and the filter falls through
//
// memo()-wrapped so the panel skips re-renders when the parent re-renders
// for unrelated reasons (the entries array reference stays stable until a
// new log entry is appended).

import { memo, useMemo, useState } from "react";
import {
  ACTIVITY_KIND_TO_KEY,
  type ActivityEntry,
  type ActivityGroup,
  activityGroupOf,
  humanizeFieldName,
} from "./activity-log";
import { type Lang, t } from "./i18n";
import { useDisplayTimezone } from "./display-timezone-context";
import { formatDisplayTimestamp } from "./tz-display";
import { SegmentedControl } from "./segmented-control";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { ColumnResizeHandle, PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { DataTable } from "./data-table";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { Input } from "./form-controls";
import { useConfirm } from "./confirm-dialog";

const ACTIVITY_LOG_COL_WIDTHS = {
  timestamp: 160,
  kind: 110,
  message: 320,
} as const;
type ActivityLogCol = keyof typeof ACTIVITY_LOG_COL_WIDTHS;

interface Props {
  lang: Lang;
  entries: readonly ActivityEntry[];
  onClear: () => void;
}

type SortKey = "timestamp" | "kind" | "message";
type SortDir = "asc" | "desc";
type SearchMode = "literal" | "wildcard" | "regex";
type GroupFilter = ActivityGroup | "all";

// Escape regex special characters except `*` and `?` (which we substitute
// for wildcard semantics). Used only by wildcard mode.
function escapeForWildcard(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

interface Matcher {
  test: (haystack: string) => boolean;
  invalid?: boolean;
}

function buildMatcher(query: string, mode: SearchMode): Matcher | null {
  const q = query.trim();
  if (!q) return null;
  if (mode === "literal") {
    const lc = q.toLowerCase();
    return { test: (h) => h.toLowerCase().includes(lc) };
  }
  try {
    const pattern =
      mode === "regex"
        ? q
        : escapeForWildcard(q).replace(/\*/g, ".*").replace(/\?/g, ".");
    const re = new RegExp(pattern, "i");
    return { test: (h) => re.test(h) };
  } catch {
    return { test: () => true, invalid: true };
  }
}

function ActivityLogPanelInner({ lang, entries, onClear }: Props) {
  const { displayTz } = useDisplayTimezone();
  const confirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("literal");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { colWidths, startColResize, resetColWidths } = useColumnResize<ActivityLogCol>(
    "activityLog",
    ACTIVITY_LOG_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  const { ref: actRef, reset: resetActSize } = useResizable("aipm-cockpit:activity-size");

  // Precompute the rendered message and the group once per entries/lang
  // change so the filter+sort passes below don't redo i18n interpolation
  // on every keystroke.
  const enriched = useMemo(
    () =>
      entries.map((e) => ({
        entry: e,
        message: t(lang, ACTIVITY_KIND_TO_KEY[e.kind], ...e.args),
        group: activityGroupOf(e.kind),
      })),
    [entries, lang],
  );

  const matcher = useMemo(
    () => buildMatcher(searchQuery, searchMode),
    [searchQuery, searchMode],
  );

  const visible = useMemo(() => {
    let result = enriched;
    if (groupFilter !== "all") {
      result = result.filter((row) => row.group === groupFilter);
    }
    if (matcher && !matcher.invalid) {
      result = result.filter(
        (row) =>
          matcher.test(row.message) || matcher.test(row.entry.kind),
      );
    }
    const sorted = result.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === "timestamp") {
        cmp = a.entry.timestamp.localeCompare(b.entry.timestamp);
      } else if (sortKey === "kind") {
        cmp = a.entry.kind.localeCompare(b.entry.kind);
      } else {
        cmp = a.message.localeCompare(b.message);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [enriched, groupFilter, matcher, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <section ref={actRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted-foreground">
          {visible.length === entries.length
            ? t(lang, "activityEntriesLogged", entries.length)
            : t(lang, "tasksCountFiltered", visible.length, entries.length)}
        </span>
        <div className="flex items-center gap-2 print:hidden">
          <PrintButton lang={lang} />
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetActSize} lang={lang} />
          {entries.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (
                  await confirm({
                    message: t(lang, "confirmClearActivityLog", entries.length),
                  })
                )
                  onClear();
              }}
              title={t(lang, "activityClearHint")}
              className={`rounded-md border border-ui-pink/50 bg-surface px-2.5 py-1 text-xs font-medium text-ui-pink-strong hover:bg-ui-pink/10 ${INTERACTIVE}`}
            >
              {t(lang, "activityClear")}
            </button>
          )}
        </div>
      </header>

      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
        <div className="relative min-w-[14rem] flex-1">
          <Input
            type="search"
            size="xs"
            invalid={!!matcher?.invalid}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(lang, "activitySearchPlaceholder")}
            aria-label={t(lang, "activitySearchPlaceholder")}
            title={t(lang, "activitySearchHint")}
            className="w-full"
          />
          {matcher?.invalid && (
            <span className="absolute -bottom-4 left-1 text-[10px] text-ui-pink-strong">
              {t(lang, "activitySearchInvalidRegex")}
            </span>
          )}
        </div>
        <SegmentedControl<SearchMode>
          value={searchMode}
          ariaLabel={t(lang, "activitySearchPlaceholder")}
          title={t(lang, "activitySearchModeHint")}
          options={[
            { value: "literal", label: t(lang, "activitySearchLiteral") },
            { value: "wildcard", label: t(lang, "activitySearchWildcard") },
            { value: "regex", label: t(lang, "activitySearchRegex") },
          ]}
          onChange={setSearchMode}
        />
        <SegmentedControl<GroupFilter>
          value={groupFilter}
          ariaLabel={t(lang, "activityFilterAll")}
          title={t(lang, "activityGroupFilterHint")}
          options={[
            { value: "all", label: t(lang, "activityFilterAll") },
            { value: "tasks", label: t(lang, "activityFilterTasks") },
            { value: "raid", label: t(lang, "activityFilterRaid") },
            { value: "bulk", label: t(lang, "activityFilterBulk") },
            { value: "jira", label: t(lang, "activityFilterJira") },
            { value: "general", label: t(lang, "activityFilterGeneral") },
          ]}
          onChange={setGroupFilter}
        />
      </div>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted-foreground">
          {t(lang, "activityEmpty")}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted-foreground">
          {t(lang, "activityNoMatches")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pr-2">
          <DataTable
            className="w-full text-left text-sm"
            tbodyClassName="divide-y divide-line"
            head={<>
              <tr>
                <th
                  className="relative px-3 py-2 font-medium"
                  style={{ width: colWidths.timestamp, minWidth: colWidths.timestamp }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("timestamp")}
                    title={t(lang, "sortBy", t(lang, "activityHeaderWhen"))}
                    className={`cursor-pointer select-none text-left text-xs uppercase tracking-wide hover:text-ui-green ${INTERACTIVE}`}
                  >
                    {t(lang, "activityHeaderWhen")}
                    {sortIndicator("timestamp")}
                  </button>
                  <ColumnResizeHandle col="timestamp" onMouseDown={startResize} />
                </th>
                <th
                  className="relative px-3 py-2 font-medium"
                  style={{ width: colWidths.kind, minWidth: colWidths.kind }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("kind")}
                    title={t(lang, "sortBy", t(lang, "activityHeaderKind"))}
                    className={`cursor-pointer select-none text-left text-xs uppercase tracking-wide hover:text-ui-green ${INTERACTIVE}`}
                  >
                    {t(lang, "activityHeaderKind")}
                    {sortIndicator("kind")}
                  </button>
                  <ColumnResizeHandle col="kind" onMouseDown={startResize} />
                </th>
                <th
                  className="relative px-3 py-2 font-medium"
                  style={{ width: colWidths.message, minWidth: colWidths.message }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("message")}
                    title={t(lang, "sortBy", t(lang, "activityHeaderMessage"))}
                    className={`cursor-pointer select-none text-left text-xs uppercase tracking-wide hover:text-ui-green ${INTERACTIVE}`}
                  >
                    {t(lang, "activityHeaderMessage")}
                    {sortIndicator("message")}
                  </button>
                  <ColumnResizeHandle col="message" onMouseDown={startResize} />
                </th>
              </tr>
            </>}
          >
              {visible.map(({ entry, message }) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                    <time dateTime={entry.timestamp}>
                      {formatDisplayTimestamp(entry.timestamp, displayTz, lang, { withSeconds: true })}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {entry.kind}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {message}
                    {entry.changes && entry.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {entry.changes.map((c) => (
                          <li key={c.field} className="text-xs text-muted-foreground">
                            <span className="font-medium">{humanizeFieldName(c.field)}</span>
                            {": "}
                            <span className="sr-only">{t(lang, "activityChangeFrom")} </span>
                            <span className="line-through">{c.from || "—"}</span>{" "}
                            <span aria-hidden="true">→</span>{" "}
                            <span className="sr-only">{t(lang, "activityChangeTo")} </span>
                            <span className="text-foreground">{c.to || "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
          </DataTable>
        </div>
      )}
    </section>
  );
}

export const ActivityLogPanel = memo(ActivityLogPanelInner);
