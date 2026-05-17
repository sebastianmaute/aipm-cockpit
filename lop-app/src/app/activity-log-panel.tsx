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
} from "./activity-log";
import { type Lang, t } from "./i18n";
import { SegmentedControl } from "./segmented-control";

interface Props {
  lang: Lang;
  entries: readonly ActivityEntry[];
  onClear: () => void;
}

type SortKey = "timestamp" | "kind" | "message";
type SortDir = "asc" | "desc";
type SearchMode = "literal" | "wildcard" | "regex";
type GroupFilter = ActivityGroup | "all";

function localeFor(lang: Lang): string {
  if (lang === "de") return "de-DE";
  if (lang === "en-GB") return "en-GB";
  return "en-US";
}

function formatTimestamp(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleString(localeFor(lang), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("literal");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {t(lang, "tabActivity")}{" "}
          <span className="text-sm font-normal text-AIPM-medium-grey">
            {visible.length === entries.length
              ? t(lang, "activityCount", entries.length)
              : t(lang, "tasksCountFiltered", visible.length, entries.length)}
          </span>
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t(lang, "activityClear")}
          </button>
        )}
      </header>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(lang, "activitySearchPlaceholder")}
            aria-label={t(lang, "activitySearchPlaceholder")}
            aria-invalid={matcher?.invalid ? true : undefined}
            className={`w-full rounded-md border bg-white px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 dark:bg-zinc-900 ${
              matcher?.invalid
                ? "border-red-500 focus:border-red-500 focus:ring-red-500 dark:border-red-500"
                : "border-zinc-300 focus:border-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-700"
            }`}
          />
          {matcher?.invalid && (
            <span className="absolute -bottom-4 left-1 text-[10px] text-red-600 dark:text-red-400">
              {t(lang, "activitySearchInvalidRegex")}
            </span>
          )}
        </div>
        <SegmentedControl<SearchMode>
          value={searchMode}
          ariaLabel={t(lang, "activitySearchPlaceholder")}
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
          options={[
            { value: "all", label: t(lang, "activityFilterAll") },
            { value: "tasks", label: t(lang, "activityFilterTasks") },
            { value: "raid", label: t(lang, "activityFilterRaid") },
            { value: "bulk", label: t(lang, "activityFilterBulk") },
            { value: "jira", label: t(lang, "activityFilterJira") },
          ]}
          onChange={setGroupFilter}
        />
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
          {t(lang, "activityEmpty")}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex-1 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
          {t(lang, "activityNoMatches")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("timestamp")}
                    className="cursor-pointer select-none text-left text-xs uppercase tracking-wide hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
                  >
                    {t(lang, "activityHeaderWhen")}
                    {sortIndicator("timestamp")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("kind")}
                    className="cursor-pointer select-none text-left text-xs uppercase tracking-wide hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
                  >
                    {t(lang, "activityHeaderKind")}
                    {sortIndicator("kind")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("message")}
                    className="cursor-pointer select-none text-left text-xs uppercase tracking-wide hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
                  >
                    {t(lang, "activityHeaderMessage")}
                    {sortIndicator("message")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {visible.map(({ entry, message }) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-AIPM-medium-grey">
                    <time dateTime={entry.timestamp}>
                      {formatTimestamp(entry.timestamp, lang)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-AIPM-medium-grey">
                    {entry.kind}
                  </td>
                  <td className="px-3 py-2 text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export const ActivityLogPanel = memo(ActivityLogPanelInner);
