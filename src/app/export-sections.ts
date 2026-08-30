// src/app/export-sections.ts
//
// Pure model layer: given a Workspace + ExportConfig + Lang, produce an ordered
// list of ExportSection values ready for any format builder (PDF/DOCX/XLSX/…).
//
// Columns and row projections are derived from the same constants and
// field-to-string helpers that `workspaceToCsv` uses, keeping a single source
// of truth for "what a section looks like".

import type { Workspace } from "./storage";
import {
  CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  STAKEHOLDERS_CSV_COLUMNS,
  ABSENCES_CSV_COLUMNS,
  SHIFTS_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS,
  ROLES_CSV_COLUMNS,
  BUDGETS_CSV_COLUMNS,
  fieldToString,
  raidFieldToString,
  milestoneFieldToString,
  changeFieldToString,
  stakeholderFieldToString,
  absenceFieldToString,
  shiftFieldToString,
  resourceFieldToString,
  budgetFieldToString,
  statusToCsv,
} from "./storage";
import { descriptionTextWithBreaks } from "./rich-text-projection";
import { contactDisplay } from "./contact-display";
import type { ExportConfig, ExportSectionKey } from "./settings-types";
import { linkKindOf, type KnowledgeItem } from "./document-link";
import type { Insight } from "./insights/insight";
import type { CalendarEvent, RecurrenceRule } from "./calendar-event";
import { nearestOccurrence } from "./recurrence";
import { EXPORT_SECTION_KEYS } from "./settings-types";
import type { Lang, TranslationKey } from "./i18n";
import { t } from "./i18n";
import type {
  Task,
  RaidItem,
  Milestone,
  ChangeItem,
  Stakeholder,
  Absence,
  Shift,
  Resource,
  Role,
  BudgetBucket,
  ProjectStatus,
  ProjectMeta,
} from "./types";
import type { KnowledgeLink } from "./document-link";

/** A cell whose stored value is rich HTML.
 *
 *  ★★ IT CARRIES BOTH REPRESENTATIONS, ALWAYS. A renderer that can lay out
 *  paragraphs parses `html`; every other one reads `text`. That redundancy is
 *  the whole guarantee — a flat consumer can never accidentally receive markup,
 *  which is what a mode flag or a side-channel would have risked.
 *
 *  ★★ THE CELL IS CARRIED, NEVER PARSED, and that is the whole property.
 *  `htmlToRichLines` is DOMParser-bound, so every parse of this html lives in
 *  a DOM-bound renderer — which is exactly what lets ONE section model feed
 *  both the structural consumers (DOCX runs, HTML markup) and the flat ones
 *  (XLSX, PPTX). Parsing "helpfully" one level up here collapses that.
 *
 *  ★★★ IT IS NOT A DOM-FREE CLAIM ABOUT THIS MODULE, and an earlier revision of
 *  this comment made one. `richCell` derives `text` through
 *  `descriptionTextWithBreaks`, whose own module header states it goes through
 *  DOMPurify and must never be imported by anything that can run under bare
 *  node — so this file has had a DOM dependency since the day it gained that
 *  import. The false claim was false in the PERMISSIVE direction: a reader
 *  takes "DOM-free" as a rule about what may be ADDED here, when the only rule
 *  is about what may be PARSED here. */
export type RichCell = { html: string; text: string };

export type ExportCell = string | number | RichCell;

/** ★ Sound only because every NON-rich cell this module emits is a `string` or
 *  a `number` — each one comes from a `*FieldToString` helper, an explicit
 *  `String(...)`, or a string field. No section builder emits any other object,
 *  so "is an object with an `html` key" cannot collide with a plain cell. */
export function isRichCell(cell: ExportCell): cell is RichCell {
  return typeof cell === "object" && cell !== null && "html" in cell;
}

/** The flat projection of any cell — the ONLY thing a renderer that cannot lay
 *  out paragraphs should call.
 *
 *  ★★ Its parameter is `ExportCell`, which does NOT include `undefined`, and
 *  `noUncheckedIndexedAccess` is off — so `row[i]` typechecks here while a
 *  short row hands it `undefined` at RUNTIME. That is survivable rather than
 *  accidental: `isRichCell(undefined)` is false, so the value passes through
 *  unchanged to the caller's own `?? ""` / `String(… ?? "")` guard, exactly as
 *  the raw cell did before this indirection existed. Keep those guards. */
export function cellText(cell: ExportCell): string | number {
  return isRichCell(cell) ? cell.text : cell;
}

export type ExportSection = {
  key: ExportSectionKey;
  title: string;       // localized section heading
  columns: string[];   // header row (display labels)
  rows: ExportCell[][];  // body rows, one entry per entity
};

// ---------------------------------------------------------------------------
// Per-section projection helpers
// ---------------------------------------------------------------------------

function tasksSection(tasks: readonly Task[], lang: Lang): ExportSection {
  const columns = CSV_COLUMNS as unknown as string[];
  const rows = tasks.map((t) =>
    CSV_COLUMNS.map((c) => richCell(fieldToString(t, c), c, TASK_RICH_COLUMNS))
  );
  return { key: "tasks", title: t(lang, "tasks"), columns, rows };
}

// Columns whose stored value is rich HTML. Exports are read by humans and by
// Office renderers, so they carry the text projection — the codec itself keeps
// the HTML, because CSV *storage* round-trips through the same function
// (golden-workspace.test.ts pins those bytes). CSV *export* and CSV *storage*
// are different callers of the same field-to-string helper, so the projection
// belongs HERE and never inside raid/milestone/changeFieldToString.
//
// ★ A name that is not a real column would make the set silently never match,
// leaving the fix absent with nothing else noticing — export-sections.test.ts
// pins each set as a subset of its *_CSV_COLUMNS list.
export const TASK_RICH_COLUMNS: ReadonlySet<string> = new Set(["description"]);
export const RAID_RICH_COLUMNS: ReadonlySet<string> = new Set(["description", "mitigation"]);
export const MILESTONE_RICH_COLUMNS: ReadonlySet<string> = new Set(["description"]);
export const CHANGE_RICH_COLUMNS: ReadonlySet<string> = new Set([
  "description",
  "impactDescription",
  "resolutionNotes",
]);

function richCell(value: string, column: string, rich: ReadonlySet<string>): ExportCell {
  if (!rich.has(column)) return value;
  return { html: value, text: descriptionTextWithBreaks(value) };
}

function raidSection(raid: readonly RaidItem[], lang: Lang): ExportSection {
  const columns = RAID_CSV_COLUMNS as unknown as string[];
  const rows = raid.map((r) =>
    RAID_CSV_COLUMNS.map((c) => richCell(raidFieldToString(r, c), c, RAID_RICH_COLUMNS))
  );
  return { key: "raid", title: t(lang, "tabRaid"), columns, rows };
}

function milestonesSection(milestones: readonly Milestone[], lang: Lang): ExportSection {
  const columns = MILESTONES_CSV_COLUMNS as unknown as string[];
  const rows = milestones.map((m) =>
    MILESTONES_CSV_COLUMNS.map((c) =>
      richCell(milestoneFieldToString(m, c), c, MILESTONE_RICH_COLUMNS)
    )
  );
  return { key: "milestones", title: t(lang, "navMilestones"), columns, rows };
}

function changesSection(changes: readonly ChangeItem[], lang: Lang): ExportSection {
  const columns = CHANGES_CSV_COLUMNS as unknown as string[];
  const rows = changes.map((c) =>
    CHANGES_CSV_COLUMNS.map((col) =>
      richCell(changeFieldToString(c, col), col, CHANGE_RICH_COLUMNS)
    )
  );
  return { key: "changes", title: t(lang, "navChanges"), columns, rows };
}

function stakeholdersSection(stakeholders: readonly Stakeholder[], lang: Lang): ExportSection {
  const columns = STAKEHOLDERS_CSV_COLUMNS as unknown as string[];
  const rows = stakeholders.map((s) =>
    STAKEHOLDERS_CSV_COLUMNS.map((col) => stakeholderFieldToString(s, col))
  );
  return { key: "stakeholders", title: t(lang, "navStakeholders"), columns, rows };
}

function budgetsSection(budgets: readonly BudgetBucket[]): ExportSection {
  const columns = BUDGETS_CSV_COLUMNS as unknown as string[];
  const rows = budgets.map((b) =>
    BUDGETS_CSV_COLUMNS.map((c) => budgetFieldToString(b, c))
  );
  return { key: "budgets", title: "Budgets", columns, rows };
}

function resourcesSection(resources: readonly Resource[], lang: Lang): ExportSection {
  const columns = RESOURCES_CSV_COLUMNS as unknown as string[];
  const rows = resources.map((r) =>
    RESOURCES_CSV_COLUMNS.map((c) => resourceFieldToString(r, c))
  );
  return { key: "resources", title: t(lang, "tabResources"), columns, rows };
}

function rolesSection(roles: readonly Role[]): ExportSection {
  const columns = ROLES_CSV_COLUMNS as unknown as string[];
  const rows = roles.map((r) =>
    ROLES_CSV_COLUMNS.map((c) => String((r as Record<string, unknown>)[c] ?? ""))
  );
  return { key: "roles", title: "Roles", columns, rows };
}

function absencesSection(absences: readonly Absence[]): ExportSection {
  const columns = ABSENCES_CSV_COLUMNS as unknown as string[];
  const rows = absences.map((a) =>
    ABSENCES_CSV_COLUMNS.map((c) => absenceFieldToString(a, c))
  );
  return { key: "absences", title: "Absences", columns, rows };
}

function shiftsSection(shifts: readonly Shift[]): ExportSection {
  const columns = SHIFTS_CSV_COLUMNS as unknown as string[];
  const rows = shifts.map((s) =>
    SHIFTS_CSV_COLUMNS.map((c) => shiftFieldToString(s, c))
  );
  return { key: "shifts", title: "Shifts", columns, rows };
}

// Maps each ProjectMeta field key to its i18n translation key, in display order.
const PROJECT_FIELD_I18N_KEYS: Readonly<Record<keyof ProjectMeta, TranslationKey>> = {
  name:                      "projectName",
  code:                      "projectCode",
  description:               "projectDescription",
  sponsor:                   "projectSponsor",
  projectManager:            "projectManager",
  keyStakeholdersInternal:   "projectStakeholdersInternal",
  keyStakeholdersExternal:   "projectStakeholdersExternal",
  customer:                  "projectCustomer",
  naceSection:               "projectNaceSection",
  identityTypes:             "projectIdentityTypes",
  identityCount:             "projectIdentityCount",
  stakeholderCount:          "projectStakeholderCount",
  products:                  "projectProducts",
  platform:                  "projectPlatform",
  deployment:                "projectDeployment",
  startDate:                 "projectStartDate",
  endDate:                   "projectEndDate",
  profitCenter:              "projectProfitCenter",
  quotes:                    "projectQuotes",
  salesforceUrl:             "projectSalesforce",
  sharepointUrl:             "projectSharepoint",
  confluenceUrl:             "projectConfluence",
  jiraUrl:                   "projectJira",
  operatingTimezone:         "projectOperatingTimezone",
  contactPersons:            "projectContactPersons",
  docRepoLocation:           "projectDocRepo",
  regulatory:                "projectRegulatory",
  notes:                     "projectNotes",
  knowledgeLinks:            "projectDocumentLinks",
};

/**
 * Pivots a ProjectMeta into a ["field", "value"] key/value section.
 * Only non-empty fields are included (undefined, empty string, empty array all
 * produce no row).  Arrays are joined with ", "; ContactPerson items are
 * rendered as "name <email>" then joined with ", ".
 */
function projectSection(p: ProjectMeta, lang: Lang): ExportSection {
  const rows: string[][] = [];

  for (const key of Object.keys(PROJECT_FIELD_I18N_KEYS) as (keyof ProjectMeta)[]) {
    const raw = p[key];

    // Skip undefined / null
    if (raw === undefined || raw === null) continue;

    let value: string;

    if (key === "contactPersons") {
      const persons = raw as ProjectMeta["contactPersons"];
      if (persons.length === 0) continue;
      value = persons.map(contactDisplay).join(", ");
    } else if (key === "knowledgeLinks") {
      const links = raw as KnowledgeLink[];
      if (links.length === 0) continue;
      value = links.map((l) => l.name).join(", ");
    } else if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      value = (raw as string[]).join(", ");
    } else {
      value = String(raw);
      if (value === "") continue;
    }

    rows.push([t(lang, PROJECT_FIELD_I18N_KEYS[key]), value]);
  }

  return { key: "project", title: t(lang, "exportLabelProject"), columns: ["field", "value"], rows };
}

function statusSection(status: ProjectStatus): ExportSection {
  // Status is a key/value map, not a flat list of entities. We represent it
  // as two columns ("field", "value") with one row per non-empty status field,
  // matching what statusToCsv emits (minus the header row it includes).
  const csv = statusToCsv(status);
  const rows: string[][] = csv
    .split(/\r?\n/)
    .slice(1) // skip "field,value" header
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const comma = line.indexOf(",");
      if (comma < 0) return [line, ""];
      const field = line.slice(0, comma);
      // strip CSV quoting from value if present
      let val = line.slice(comma + 1);
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/""/g, '"');
      }
      return [field, val];
    });
  return { key: "status", title: "Project Status", columns: ["field", "value"], rows };
}

function knowledgeItemsSection(items: readonly KnowledgeItem[], lang: Lang): ExportSection {
  const rows = items.map((it) => [
    it.name,
    linkKindOf(it),
    it.url,
    (it.taskIds ?? []).join(" "),
  ]);
  return {
    key: "knowledgeItems",
    title: t(lang, "exportLabelKnowledgeItems"),
    columns: ["name", "type", "url", "tasks"],
    rows,
  };
}

// English-only builder (consistent with budgets/roles/absences); the insight
// text is derived from type+data by the React surfaces, so the export renders
// the structural fields plus a compact key=value dump of `data`.
function insightsSection(insights: readonly Insight[]): ExportSection {
  const rows = insights.map((it) => [
    it.type,
    it.severity,
    it.status,
    Object.entries(it.data)
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
    String(it.occurrences),
    it.lastSeenAt,
  ]);
  return {
    key: "insights",
    title: "Insights",
    columns: ["type", "severity", "status", "data", "occurrences", "lastSeen"],
    rows,
  };
}

function ordinalLabel(n: 1 | 2 | 3 | 4 | -1): string {
  return n === -1 ? "last" : n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : "4th";
}

/** English-only, i18n-free (consistent with budgets/roles/absences/shifts/
 *  insights): a compact plain-language summary of a recurrence rule, derived
 *  from the rule alone — no occurrence expansion needed, since an event's own
 *  `startDate`/`startTime` already IS its first occurrence. */
function describeRecurrence(r: RecurrenceRule | undefined): string {
  if (!r) return "Does not repeat";
  const unit = (word: string) => (r.interval > 1 ? `${r.interval} ${word}s` : word);
  if (r.freq === "daily") return `Every ${unit("day")}`;
  if (r.freq === "weekly") {
    const days = r.byDay && r.byDay.length > 0 ? ` on ${r.byDay.join(", ")}` : "";
    return `Every ${unit("week")}${days}`;
  }
  if (r.byDay) return `Every ${unit("month")} on the ${ordinalLabel(r.byDay.ordinal)} ${r.byDay.day}`;
  return `Every ${unit("month")} on day ${r.byMonthDay ?? "?"}`;
}

/** The date+time the calendar actually renders FIRST for this event — which
 *  can differ from event.startDate/startTime whenever an exception touches
 *  the very first rule-generated instance: a `skip` on startDate pushes the
 *  true first occurrence to the next rule date, and a `move` on startDate
 *  makes the calendar show it at the moved date/time instead. Thin wrapper
 *  over recurrence.ts's `nearestOccurrence` (windowStart = the event's own
 *  startDate — "first occurrence ever"; the all-series list's analogous
 *  next-occurrence-from-today reuses the SAME helper with `today` as the
 *  start, since the search mechanics and lookahead bound are identical —
 *  only the window start and the empty-result fallback differ per caller).
 *
 *  Falls back to "" — deliberately NOT the raw startDate — when nothing
 *  resolves within the lookahead (every candidate in range was skipped, or a
 *  small `count` was entirely consumed by skips). Printing startDate there
 *  would repeat the exact bug this fixes: claiming a date the calendar never
 *  actually renders. An empty cell says "unknown/none found"; a date says
 *  "this is when it happens" — those must not be conflated.
 *
 *  ★ `nearestOccurrence`'s `truncated` flag is deliberately IGNORED here,
 *  not silently dropped — but NOT because truncation itself can't happen.
 *  It routinely does: `truncated` is set whenever EITHER of
 *  `expandOccurrences`' two caps fires, and `MAX_OCCURRENCES` (1000 pushed
 *  results) trips for any ordinary daily/weekly-ish series once its walk
 *  crosses ~11 years of candidates — which is the WHOLE lookahead here,
 *  since windowStart is always the event's own `startDate` for this caller
 *  (by construction — "first occurrence ever"). So `truncated === true` is
 *  the COMMON case, not a rare one, and is uninformative for what this
 *  function needs: `occurrence` is element 0 of an already-sorted list, so
 *  it is correct regardless of whether the TAIL got cut off by
 *  `MAX_OCCURRENCES`.
 *
 *  What genuinely can't happen for this call shape is `occurrence ===
 *  undefined && truncated` — the "search gave up before confirming
 *  anything" state `NearestOccurrenceResult.truncated`'s own doc warns
 *  about. That requires exhausting `MAX_ITERATIONS` (20,000 candidates
 *  evaluated) before ever reaching the window, which needs a real gap
 *  between where generation starts and where the window begins — impossible
 *  here since they're the same date. (Verified: `occurrence` resolves for
 *  both an ordinary and a ~125-year-old daily series passed through this
 *  exact call shape — see the pinning test below.) Contrast the all-series
 *  list's `nextOccurrenceLabel`, which passes `today` — independent of the
 *  event's own startDate — where that gap is real and `occurrence ===
 *  undefined && truncated` DOES need its own message. */
function firstOccurrenceLabel(event: CalendarEvent): string {
  const { occurrence } = nearestOccurrence(event, event.startDate);
  return occurrence ? `${occurrence.date} ${occurrence.time}` : "";
}

function calendarEventsSection(events: readonly CalendarEvent[], lang: Lang): ExportSection {
  const rows = events.map((e) => [
    e.title,
    firstOccurrenceLabel(e),
    describeRecurrence(e.recurrence),
    e.location ?? "",
  ]);
  return {
    key: "calendarEvents",
    title: t(lang, "exportLabelCalendarEvents"),
    columns: ["title", "first occurrence", "recurs", "location"],
    rows,
  };
}

// ---------------------------------------------------------------------------
// Builder map keyed by ExportSectionKey
// ---------------------------------------------------------------------------

type SectionBuilder = (ws: Workspace, lang: Lang) => ExportSection | null;

const BUILDERS: Record<ExportSectionKey, SectionBuilder> = {
  project: (ws, lang) => (ws.project ? projectSection(ws.project, lang) : null),
  tasks: (ws, lang) => {
    const items = ws.tasks;
    return items.length > 0 ? tasksSection(items, lang) : null;
  },
  raid: (ws, lang) => {
    const items = ws.raid;
    return items.length > 0 ? raidSection(items, lang) : null;
  },
  milestones: (ws, lang) => {
    const items = ws.milestones ?? [];
    return items.length > 0 ? milestonesSection(items, lang) : null;
  },
  changes: (ws, lang) => {
    const items = ws.changes ?? [];
    return items.length > 0 ? changesSection(items, lang) : null;
  },
  stakeholders: (ws, lang) => {
    const items = ws.stakeholders ?? [];
    return items.length > 0 ? stakeholdersSection(items, lang) : null;
  },
  budgets: (ws) => {
    const items = ws.budgets ?? [];
    return items.length > 0 ? budgetsSection(items) : null;
  },
  knowledgeItems: (ws, lang) => {
    const items = ws.knowledgeItems ?? [];
    return items.length > 0 ? knowledgeItemsSection(items, lang) : null;
  },
  insights: (ws) => {
    const items = ws.insights ?? [];
    return items.length > 0 ? insightsSection(items) : null;
  },
  resources: (ws, lang) => {
    const items = ws.resources;
    return items.length > 0 ? resourcesSection(items, lang) : null;
  },
  roles: (ws) => {
    const items = ws.roles;
    return items.length > 0 ? rolesSection(items) : null;
  },
  absences: (ws) => {
    const items = ws.absences;
    return items.length > 0 ? absencesSection(items) : null;
  },
  shifts: (ws) => {
    const items = ws.shifts;
    return items.length > 0 ? shiftsSection(items) : null;
  },
  calendarEvents: (ws, lang) => {
    const items = ws.calendarEvents ?? [];
    return items.length > 0 ? calendarEventsSection(items, lang) : null;
  },
  status: (ws) => {
    const s = ws.status;
    if (!s || Object.keys(s).length === 0) return null;
    return statusSection(s);
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an ordered list of ExportSection values from a workspace.
 *
 * Sections are included only when:
 *  1. `cfg[key] === true` (enabled in the export config), AND
 *  2. the underlying workspace array / object is non-empty.
 *
 * Order follows EXPORT_SECTION_KEYS (fixed canonical order).
 * Pure — no IO.
 */
export function buildExportSections(
  ws: Workspace,
  cfg: ExportConfig,
  lang: Lang,
): ExportSection[] {
  const result: ExportSection[] = [];
  for (const key of EXPORT_SECTION_KEYS) {
    if (!cfg[key]) continue;
    const section = BUILDERS[key](ws, lang);
    if (section !== null) result.push(section);
  }
  return result;
}
