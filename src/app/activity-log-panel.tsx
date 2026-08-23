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
  type ActivityEntry,
  type ActivityGroup,
  type ActivityKind,
  MAX_FIELD_CHANGES,
  activityGroupOf,
  activityMessageKey,
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
import { SortResizeTh, useSortHeaderProps } from "./report-table";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { Input } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";
import { useConfirm } from "./confirm-dialog";

const ACTIVITY_LOG_COL_WIDTHS = {
  timestamp: 160,
  kind: 110,
  actor: 110,
  message: 320,
} as const;
type ActivityLogCol = keyof typeof ACTIVITY_LOG_COL_WIDTHS;

/**
 * Actor → i18n key. ★★ READ IT WITH AN OWN-PROPERTY GUARD, NEVER A BARE INDEX.
 * `ActivityActor` is a closed TS union but `sanitizeActivityEntry` admits ANY
 * string (the same trade `kind: ActivityKind` already makes), so a stored
 * `actor: "toString"` reaches this map on a FULLY SANITIZED log, from every
 * backend. A bare lookup resolves `Function.prototype.toString`, `t()` then
 * misses it in the dictionary and throws on `undefined.replace` — and a throw
 * in this panel is not a blank table, it is the full-screen ErrorBoundary page
 * on every Activity visit until the project data is repaired by hand. Same
 * reasoning as `activityMessageKey`'s own `hasOwnProperty` check.
 */
const ACTOR_KEYS = {
  user: "activityActorUser",
  ai: "activityActorAi",
  integration: "activityActorIntegration",
} as const;

/** An unknown OR absent actor both render this. Absence is genuinely unknown —
 *  every entry written before the B2b release has no actor — so it must never
 *  be defaulted to "user" at read time. */
const ACTOR_UNKNOWN = "—";

/**
 * THE single answer to "which known actor is this?" — `null` means the row is
 * UNATTRIBUTED, covering BOTH shapes that reach here: an ABSENT actor (the
 * entire pre-0.244.0 trail) and an unknown-but-STRING one, which
 * `sanitizeActivityEntry` deliberately keeps so a newer release's actor value
 * is not destroyed by an older client.
 *
 * ★★ The rendered cell and the "unattributed" FILTER both read this, so a row
 * displayed as "—" is exactly a row that filter returns. Writing the filter as
 * `actor === undefined` instead would be a SECOND predicate that drifts on the
 * unknown-string case the moment a forward-compatible value shows up: the row
 * would render "—" and the filter claiming to select unattributed rows would
 * not return it.
 */
function actorKeyOf(actor: unknown): (typeof ACTOR_KEYS)[keyof typeof ACTOR_KEYS] | null {
  return typeof actor === "string" && Object.prototype.hasOwnProperty.call(ACTOR_KEYS, actor)
    ? ACTOR_KEYS[actor as keyof typeof ACTOR_KEYS]
    : null;
}

interface Props {
  lang: Lang;
  entries: readonly ActivityEntry[];
  onClear: () => void;
}

type SortKey = "timestamp" | "kind" | "message" | "actor";
type SortDir = "asc" | "desc";
type SearchMode = "literal" | "wildcard" | "regex";
type GroupFilter = ActivityGroup | "all";
/** ★ `"unknown"` is a REAL member, not a fallback: the whole pre-0.244.0 trail
 *  is actor-less, so "show me the entries nobody can attribute" is a first-class
 *  query — and without it every non-`all` option hides every historical row. */
type ActorFilter = "all" | "user" | "ai" | "integration" | "unknown";

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

/** A row's `changes` payload after normalisation — every field is a string. */
interface RowChange {
  field: string;
  from: string;
  to: string;
}

/**
 * Total, non-throwing coercion for one stored display value — a cell of a
 * `changes` entry, or an element of `args`.
 *
 * It KEEPS exactly three types: string, number, boolean. EVERYTHING else
 * becomes "" — objects, functions, arrays, AND the remaining primitives
 * (symbol, bigint, null, undefined), none of which carries honest audit
 * detail. ★ An earlier docstring said "anything else (an object, a function, a
 * symbol)", which reads as an exhaustive list AND miscategorises a symbol as
 * non-primitive: `typeof Symbol() === "symbol"` is a primitive, and bigint /
 * null / undefined were simply missing. Describe the KEPT set — it is closed
 * and checkable; the rejected set is not.
 *
 * "" rather than a `String()` call, because `String()` on these either THROWS
 * (`String(Symbol())` → TypeError; `String({toString: 1})` → "Cannot convert
 * object to primitive value") or renders "[object Object]" into the audit
 * trail, and neither is a thing to show a user reading a change history.
 */
function changeText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Row-level normalisation of a stored `changes` payload — the same reasoning as
 * the `kind` coercion in `enriched`: `sanitizeActivityLog` strips these shapes
 * at the load boundary, but the panel must not be the ONLY thing between
 * hostile stored bytes and the full-screen ErrorBoundary page. Measured to
 * throw before this guard: a non-array payload → "entry.changes.map is not a
 * function"; a `null` element → "Cannot read properties of null (reading
 * 'field')"; a non-string `field` → "field.replace is not a function" inside
 * `humanizeFieldName`.
 *
 * ★ A null/non-object ELEMENT is dropped (there is nothing to render), while a
 * malformed CELL is coerced — a diff whose field name is a number is still a
 * real audit record and its from/to values are still worth showing.
 *
 * ★★ The result is capped at `MAX_FIELD_CHANGES`, mirroring the load
 * boundary's own per-entry cap. It counts KEPT rows, not input elements, so a
 * payload padded with nulls cannot push real diffs past the limit.
 */
function normalizeChanges(v: unknown): RowChange[] {
  if (!Array.isArray(v)) return [];
  const rows: RowChange[] = [];
  for (const c of v) {
    if (rows.length >= MAX_FIELD_CHANGES) break;
    if (!c || typeof c !== "object") continue;
    const raw = c as { field?: unknown; from?: unknown; to?: unknown };
    rows.push({ field: changeText(raw.field), from: changeText(raw.from), to: changeText(raw.to) });
  }
  return rows;
}

function ActivityLogPanelInner({ lang, entries, onClear }: Props) {
  const { displayTz } = useDisplayTimezone();
  const confirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("literal");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { colWidths, startColResize, resetColWidths } = useColumnResize<ActivityLogCol>(
    "activityLog",
    ACTIVITY_LOG_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;
  // Bound ONCE for the three sortable headers. `SortKey` has no unsorted
  // member and `sortDir` is already a subtype of `SortDir`, so some column is
  // always sorted here and "off" is unreachable — the binding stays correct for
  // that state without a branch for it.
  const th = useSortHeaderProps<SortKey>(sortKey, sortDir, toggleSort, startResize);

  const { ref: actRef, reset: resetActSize } = useResizable("aipm-cockpit:activity-size");

  // Precompute the rendered message and the group once per entries/lang
  // change so the filter+sort passes below don't redo i18n interpolation
  // on every keystroke.
  // ★★★ EVERY LOOKUP HERE IS GUARDED, and this is not belt-and-braces: a throw
  // in this map is not a blank panel — page.tsx wraps the app in the top-level
  // ErrorBoundary, so ONE bad stored entry gives the user the full-screen
  // "App crashed" page every time they open Activity, until the project data
  // is repaired by hand. The log is shared workspace data (a hand-edited JSON
  // file, a Turso row, a device on a different build), so `sanitizeActivityLog`
  // is the boundary but must not be the ONLY thing standing between stored
  // bytes and a crash. Measured before the guards: an unknown kind threw
  // "Cannot read properties of undefined (reading 'replace')" and a non-string
  // one threw "kind.startsWith is not a function".
  // ★★ COERCE ONCE, HERE, AND READ THE ROW EVERYWHERE ELSE. An earlier cut
  // coerced `kind` only for the message lookup and left the search matcher, the
  // sort comparator and the rendered cell reading the RAW `entry.kind` — so a
  // stored `kind: 42` still threw `h.toLowerCase is not a function` the moment a
  // search query was typed, and `kind.localeCompare` threw whenever the numeric
  // kind landed in the comparator's receiver position (a 2-entry fixture can
  // miss that: V8's small-array sort may only ever put the string there).
  // ★★ `timestamp` OBEYS THE SAME RULE and did not until this row carried it —
  // the comparator read `a.entry.timestamp.localeCompare(...)` raw, and since
  // "timestamp" is the DEFAULT sortKey that threw on FIRST RENDER with ≥2
  // entries, no interaction required. Both cells below read the row too.
  // ★★ `args` used to be THE ONE SHAPE THE LOAD BOUNDARY DID NOT COVER, and
  // this was the only guard against it anywhere. §164 moved the check to
  // `sanitizeActivityEntry`, which now coerces each non-string/number element
  // to "" (in place — `args` is positional, so filtering would shift every
  // later argument into the wrong slot). The local guard below is KEPT as
  // defence in depth: this panel also renders entries that never passed the
  // load boundary, and `changeText` is doing the row's own stringification
  // regardless. ★ Do not read its presence as evidence the boundary is still
  // missing — it is not, and re-adding a reader-side guard elsewhere on that
  // belief is the mistake this note exists to stop.
  const enriched = useMemo(
    () =>
      entries.map((e) => {
        const kind = typeof e.kind === "string" ? e.kind : "";
        const timestamp = typeof e.timestamp === "string" ? e.timestamp : "";
        const key = activityMessageKey(kind);
        const args = Array.isArray(e.args) ? e.args.map(changeText) : [];
        // The own-property guard is load-bearing — see ACTOR_KEYS. Kept on the
        // row so the filter reads the SAME derivation the cell renders from.
        const actorKey = actorKeyOf(e.actor);
        return {
          entry: e,
          kind,
          timestamp,
          changes: normalizeChanges(e.changes),
          actorKey,
          actorLabel: actorKey ? t(lang, actorKey) : ACTOR_UNKNOWN,
          message: key ? t(lang, key, ...args) : t(lang, "activityUnknownKind", kind),
          group: activityGroupOf(kind as ActivityKind),
        };
      }),
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
    // ★ Narrows `result`, never re-reads `enriched` — the two filters COMPOSE.
    // ★★ Compared against the DERIVED `row.actorKey`, never the raw
    //   `entry.actor`: that is the same value the cell renders from, so the
    //   "unattributed" option returns exactly the rows shown as "—" — including
    //   the unknown-but-string ones the load boundary deliberately keeps. See
    //   `actorKeyOf`.
    if (actorFilter !== "all") {
      result = result.filter((row) =>
        actorFilter === "unknown"
          ? row.actorKey === null
          : row.actorKey === ACTOR_KEYS[actorFilter],
      );
    }
    if (matcher && !matcher.invalid) {
      result = result.filter(
        (row) => matcher.test(row.message) || matcher.test(row.kind),
      );
    }
    const sorted = result.slice().sort((a, b) => {
      let cmp: number;
      if (sortKey === "timestamp") {
        // The COERCED timestamp, not `entry.timestamp` — see `enriched`.
        cmp = a.timestamp.localeCompare(b.timestamp);
      } else if (sortKey === "kind") {
        cmp = a.kind.localeCompare(b.kind);
      } else if (sortKey === "actor") {
        // The DERIVED label, never `entry.actor` — see `enriched`. `actor` is
        // OPTIONAL on ActivityEntry and a non-string one reaches this panel,
        // so a raw `.localeCompare` here is the same defect that threw on
        // first render for `timestamp`. `actorLabel` is always a string and
        // is what the cell renders, so the order matches what is on screen.
        cmp = a.actorLabel.localeCompare(b.actorLabel);
      } else {
        cmp = a.message.localeCompare(b.message);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [enriched, groupFilter, actorFilter, matcher, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" ? "desc" : "asc");
    }
  }

  /** ONE source for the actor filter's option text — read both as the visible
   *  label and (for every radio but "all") as its accessible name, so the two
   *  cannot drift apart. `optionAriaLabel` is typed to return a `string`, so
   *  the non-colliding radios must name themselves rather than opt out. */
  const actorFilterLabels: Record<ActorFilter, string> = {
    all: t(lang, "activityFilterAll"),
    user: t(lang, "activityActorUser"),
    ai: t(lang, "activityActorAi"),
    integration: t(lang, "activityActorIntegration"),
    unknown: t(lang, "activityActorUnknown"),
  };

  return (
    <section ref={actRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted-foreground">
          {visible.length === entries.length
            ? t(lang, "activityEntriesLogged", entries.length)
            : t(lang, "tasksCountFiltered", visible.length, entries.length)}
        </span>
        <div className="flex items-center gap-2 print:hidden">
          {/* Clear leads; Print · reset-columns · reset-size stay the trailing
            * group, so the resets sit together as they do in every other pane. */}
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
          <PrintButton lang={lang} />
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetActSize} lang={lang} />
        </div>
      </header>

      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
        {/* The sizing + `relative` stay on THIS div, which also anchors the
            absolute invalid-regex hint below the field; the ClearableSearchInput
            wrapper nests inside and takes no className of its own. */}
        <div className="relative min-w-[14rem] flex-1">
          <ClearableSearchInput
            value={searchQuery}
            onClear={() => setSearchQuery("")}
            clearLabel={`${t(lang, "clear")} – ${t(lang, "activitySearchPlaceholder")}`}
          >
            <Input
              type="search"
              size="xs"
              invalid={!!matcher?.invalid}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(lang, "activitySearchPlaceholder")}
              aria-label={t(lang, "activitySearchPlaceholder")}
              title={t(lang, "activitySearchHint")}
              className={`w-full [&::-webkit-search-cancel-button]:appearance-none${searchQuery ? " pr-8" : ""}`}
            />
          </ClearableSearchInput>
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
        {/* ★★ The radiogroup name is `activityGroupFilterLabel` ("Category"),
            NOT `activityFilterAll`. It used to be the latter, so a screen
            reader announced "All, radiogroup" and then "All, radio" — a group
            named after one of its own options, which names nothing, and which
            collided with the actor group beside it. */}
        <SegmentedControl<GroupFilter>
          value={groupFilter}
          ariaLabel={t(lang, "activityGroupFilterLabel")}
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
        {/* ★★ ONE toolbar control, never a per-row one. Per-row controls in a
            list need row-unique accessible names, and NO axe rule can catch a
            collision — of axe-core 4.12.1's 105 rules, the 69 carrying one of
            the four tags e2e/a11y.spec.ts requests include none that flags two
            controls sharing an accessible name. */}
        {/* ★★ `optionAriaLabel` re-names the "All" radio ONLY, and it is the
            right lever rather than a second group name: the group filter beside
            this one has an "All" radio too, and naming the two CONTAINERS
            differently only disambiguates for AT that announces the container,
            whereas a per-radio name is distinct in every announcement and in
            every rotor. That is exactly what the prop is documented for.
            ★ The visible label stays at the FRONT of the accessible name
            ("All" ⊆ "All actors"), so WCAG 2.5.3 label-in-name holds — and no
            axe rule would tell us if it did not (`label-content-name-mismatch`
            is tagged `experimental`, which axe's default tagExclude drops, and
            it cannot see a role that lacks name-from-content anyway).
            ★ The other three radios keep their plain labels — they collide with
            nothing, and qualifying them would only add noise. */}
        <SegmentedControl<ActorFilter>
          value={actorFilter}
          ariaLabel={t(lang, "activityHeaderActor")}
          title={t(lang, "activityActorFilterHint")}
          options={[
            { value: "all", label: actorFilterLabels.all },
            { value: "user", label: actorFilterLabels.user },
            { value: "ai", label: actorFilterLabels.ai },
            { value: "integration", label: actorFilterLabels.integration },
            { value: "unknown", label: actorFilterLabels.unknown },
          ]}
          optionAriaLabel={(v) =>
            v === "all" ? t(lang, "activityActorFilterAll") : actorFilterLabels[v]
          }
          onChange={setActorFilter}
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
                <SortResizeTh
                  {...th}
                  label={t(lang, "activityHeaderWhen")}
                  sortCol="timestamp"
                  width={colWidths.timestamp}
                  title={t(lang, "sortBy", t(lang, "activityHeaderWhen"))}
                />
                <SortResizeTh
                  {...th}
                  label={t(lang, "activityHeaderKind")}
                  sortCol="kind"
                  width={colWidths.kind}
                  title={t(lang, "sortBy", t(lang, "activityHeaderKind"))}
                />
                {/* ★ Sortable since the row moved onto `SortResizeTh`. It was
                    held back only because a FOURTH hand-rolled sort button
                    would have deepened the aria-sort debt the other three
                    carried; the primitive removes that cost. */}
                <SortResizeTh
                  {...th}
                  label={t(lang, "activityHeaderActor")}
                  sortCol="actor"
                  width={colWidths.actor}
                  title={t(lang, "sortBy", t(lang, "activityHeaderActor"))}
                />
                <SortResizeTh
                  {...th}
                  label={t(lang, "activityHeaderMessage")}
                  sortCol="message"
                  width={colWidths.message}
                  title={t(lang, "sortBy", t(lang, "activityHeaderMessage"))}
                />
              </tr>
            </>}
          >
              {visible.map(({ entry, kind, timestamp, actorKey, actorLabel, message, changes }) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {/* The COERCED timestamp, not `entry.timestamp` — same rule
                        as `kind` below; a stored object reaches `dateTime` and
                        the formatter otherwise. */}
                    <time dateTime={timestamp}>
                      {formatDisplayTimestamp(timestamp, displayTz, lang, { withSeconds: true })}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {/* The COERCED kind, not `entry.kind` — a stored object
                        renders as "Objects are not valid as a React child". */}
                    {kind}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[11px] text-muted-foreground">
                    {/* An unknown OR absent actor is an em dash — absence is
                        genuinely unknown, never "user". ★ The dash carries the
                        filter option's own wording as a `title`, so a user who
                        picked "Unattributed" can see which rows it meant; the
                        cell's accessible NAME still comes from its content
                        ("—"), since `title` is the DESCRIPTION. Scoped to the
                        unknown branch — a titled "You"/"AI" would describe a
                        row as unattributed when it is not. */}
                    {actorKey ? actorLabel : <span title={t(lang, "activityActorUnknown")}>{actorLabel}</span>}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {message}
                    {/* Already normalised by `normalizeChanges` (non-array
                        payload → [], hostile elements dropped or coerced, and
                        the list capped at MAX_FIELD_CHANGES). */}
                    {changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {changes.map((c, i) => (
                          // Index-qualified key: a coerced field can repeat.
                          <li key={`${i}-${c.field}`} className="text-xs text-muted-foreground">
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
