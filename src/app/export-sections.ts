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
import { htmlToRichLines } from "./rich-text-runs";
import type { RichLine, RichLineKind, TextRun } from "./rich-text-runs";
import { TASK_MARK_CHECKED, TASK_MARK_UNCHECKED } from "./rich-text-plain";
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
  NoteLogEntry,
} from "./types";
import type { KnowledgeLink } from "./document-link";

/** A cell whose stored value is rich HTML.
 *
 *  ★★ IT CARRIES BOTH REPRESENTATIONS, ALWAYS. A renderer that can lay out
 *  paragraphs parses `html`; every other one reads `text`. That redundancy is
 *  the whole guarantee — a flat consumer can never accidentally receive markup,
 *  which is what a mode flag or a side-channel would have risked.
 *
 *  ★★ THE SECTION BUILDERS CARRY THE CELL AND NEVER PARSE IT, and that is the
 *  whole property — it is what lets ONE section model feed both the structural
 *  consumers (DOCX runs, HTML markup, and the workspace .pptx row slides) and
 *  the flat ones (XLSX, doc-render-pptx's table cells). A builder that parsed
 *  "helpfully" on the way in would collapse that.
 *
 *  ★★ This split said "(XLSX, PPTX)" until 2026-09-01, when export-pptx.ts's
 *  row slides gained a link sink and moved to the structural side — while the
 *  `cellTextWithLinks` docblock further down THIS FILE was updated in the same
 *  commit. (No line distance is quoted here on purpose: this file's own
 *  register entry records two such distances found wrong, and any insertion
 *  above invalidates one silently.) One file disagreeing with itself is the cheap version of
 *  this failure; the expensive one is a reader trusting whichever half they
 *  reach first.
 *
 *  ★★★ THAT IS A RULE ABOUT THE BUILDERS, NOT ABOUT THIS MODULE, and an earlier
 *  revision of this comment stated it as the latter ("the cell is carried, NEVER
 *  parsed"). `cellTextWithLinks` below DOES parse, through the very same
 *  `htmlToRichLines` the OOXML renderers use — deliberately, because a sink that
 *  cannot hold a hyperlink still has to print the address, and the only way to
 *  learn where a link sits inside the text is to read the parse the renderers
 *  already read. It is an explicit opt-in projection a flat sink asks for, never
 *  something a builder does behind one's back, and reusing the renderers' parse
 *  is what keeps it from becoming a second anchor walk that drifts.
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

/** One maximal stretch of a line's runs sharing a single link target. */
type FlatLink = { text: string; href?: string };

/** Adjacent runs under ONE anchor collapsed into ONE link.
 *
 *  ★★ LOAD-BEARING. A link whose text carries an inline mark is SEVERAL
 *  `TextRun`s sharing one `href` (`<a …>the <strong>spec</strong></a>` is two),
 *  so a per-RUN suffix prints the address inside its own anchor text — "the
 *  (url)spec (url)".
 *
 *  ★★★ IT COALESCES BY `href` ALONE AND KNOWS NOTHING ABOUT ANCHORS, so TWO
 *  DIRECTLY ADJACENT anchors sharing one address DO merge — `<a
 *  href="https://u">a</a><a href="https://u">b</a>` renders as one "ab
 *  (https://u)", not two. An earlier revision of this docblock asserted the
 *  opposite ("two SEPARATE anchors never coalesce"), reasoning from the source
 *  markup rather than from the run list this function actually receives: by the
 *  time runs arrive the anchor boundaries are gone, and only a run with a
 *  DIFFERENT `href` — including an unlinked one, whose `href` is undefined —
 *  breaks the stretch. Whitespace or any other text between the two anchors is
 *  such a run, which is why the ordinary case looks like the false claim.
 *
 *  ★★ THE BEHAVIOUR IS KEPT, only the claim corrected. Merging loses no
 *  address and reads better than printing one address twice in a row, and the
 *  markup that produces it — two anchors to one target with nothing at all
 *  between them — is not something the editor emits. Pinned by "merges two
 *  DIRECTLY ADJACENT anchors that share one address", which is deliberately
 *  separate from the `and`-separated pair beside it: that fixture cannot
 *  distinguish the two readings. */
function coalesceLinks(runs: readonly TextRun[]): FlatLink[] {
  const out: FlatLink[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.href === run.href) {
      out[out.length - 1] = { ...prev, text: prev.text + run.text };
    } else {
      out.push({ text: run.text, href: run.href });
    }
  }
  return out;
}

/** ★ A link whose text ALREADY IS its address gets no suffix: a pasted URL is
 *  its own link text, and "https://a (https://a)" is worse than the value it
 *  replaced. Compared against the TRIMMED text because a run can carry the
 *  anchor's surrounding whitespace. */
function isAddressed(link: FlatLink): boolean {
  return link.href !== undefined && link.href !== link.text.trim();
}

function renderLink(link: FlatLink): string {
  return isAddressed(link) ? `${link.text} (${link.href})` : link.text;
}

/** The task marker `markTaskItems` would have put in front of this line.
 *
 *  ★★ REUSES THE FLAT PROJECTION'S OWN CONSTANTS so the two cannot drift on the
 *  marker itself — the same argument `bulletMarker` makes in rich-text-runs.ts.
 *  ★★ A CONTINUATION gets NONE: `markTaskItems` rewrites the item's OPENING tag
 *  exactly once, so the text after a `<br>` carries no second "[x] ", while a
 *  continuation `RichLine` copies `task` off the item it continues. */
function taskMarker(line: RichLine): string {
  if (line.kind !== "li" || !line.task || line.continuation) return "";
  return line.task === "checked" ? TASK_MARK_CHECKED : TASK_MARK_UNCHECKED;
}

/** ★★ The whitespace shape `descriptionTextWithBreaks` ends on — `htmlToText`'s
 *  `preserveBreaks` branch: a run CONTAINING a newline collapses to one "\n", a
 *  purely horizontal run to one " ", then trim. Duplicated rather than imported
 *  because `htmlToText` runs DOMPurify FIRST, and feeding it already-extracted
 *  plain text would strip any "<" the user actually typed. If you tighten
 *  `htmlToText`'s break-mode collapse, track it here — this projection's whole
 *  contract is that it equals `cell.text` plus the addresses. */
function collapseFlat(text: string): string {
  return text
    .replace(/[^\S\n]*\n\s*/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

/** The flat projection for a sink that CANNOT hold a hyperlink — `cellText`
 *  plus each link's address, inline, as `text (url)` (§119/§30).
 *
 *  Used by the XLSX shared-string cell and the PPTX table-cell path. The PPTX
 *  ROW SLIDES left this projection when they gained a link sink — see
 *  `cellLinkedLines` below. `.docx`/`.pptx` PARAGRAPH renderers must NOT call it: they
 *  emit a real external relationship, and printing the address as well would
 *  duplicate it.
 *
 *  ★★★ IT MUST NOT BECOME `htmlToText`. That projection feeds global search,
 *  the AI entity digests and the inline-AI plan preview; widening it would put
 *  raw addresses into a search index and into model prompts, which §30 forbids
 *  explicitly. This is a SEPARATE, export-only projection for that reason, and
 *  `sanitize-html.test.ts` carries a POSITIVE byte-unchanged pin on the other
 *  one so a widening goes red there rather than silently passing here.
 *
 *  ★★ ADDRESSLESS CONTENT TAKES THE IDENTITY PATH — `cell.text` is returned
 *  VERBATIM when the parse finds no address to add. The rebuild below is meant
 *  to reproduce `descriptionTextWithBreaks` exactly (same line join, same task
 *  markers, same final collapse), so the two paths should agree; returning the
 *  stored projection when there is nothing to add means a drift between them
 *  can only ever affect a cell that actually carries a link, instead of
 *  silently re-deriving every rich cell in every flat export.
 *
 *  ★ A non-rich cell passes through UNCHANGED, number included — same contract
 *  as `cellText`, including its `undefined`-at-runtime tolerance for a short
 *  row, so every caller keeps its own `?? ""` guard. */
export function cellTextWithLinks(cell: ExportCell): string | number {
  if (!isRichCell(cell)) return cell;
  const lines = htmlToRichLines(cell.html).map((line) => ({
    marker: taskMarker(line),
    links: coalesceLinks(line.runs),
  }));
  if (!lines.some((line) => line.links.some(isAddressed))) return cell.text;
  return collapseFlat(
    lines.map((line) => line.marker + line.links.map(renderLink).join("")).join("\n"),
  );
}

/** One line of a rich cell as RUNS. `kind` travels because a slide has no style
 *  part, so a renderer folds the LINE's styling into every run (`pptxRun` takes
 *  it for exactly that). */
export type CellRunLine = { kind: RichLineKind; runs: readonly TextRun[] };

/** The STRUCTURED counterpart of `cellTextWithLinks`, for a sink that CAN mint
 *  a relationship — the PPTX row slides. `undefined` means "no link here to
 *  make live", and the caller must fall back to its existing `cellText` branch.
 *
 *  ★★★ `undefined` RATHER THAN AN EMPTY ARRAY, and that is the byte-identity
 *  contract, not a taste call: `pptxTextBox` splits a uniform-text paragraph on
 *  "\n" into SEVERAL `<a:p>` and emits exactly ONE for a run list, so the two
 *  branches do not produce the same bytes. A caller that routed every cell
 *  through runs would silently reshape every slide it has ever written.
 *
 *  ★★ THE PREDICATE IS `href`, NOT `isAddressed` — deliberately WIDER than the
 *  flat projection's. `isAddressed` asks "would printing the address ADD
 *  anything", so a pasted URL that is its own link text answers NO; this asks
 *  "is there a link to make live", and that same pasted URL answers YES. Borrow
 *  the flat predicate here and exactly the self-addressed link ships dead,
 *  which is the defect this path exists to close.
 *
 *  ★ The task marker is prepended as its OWN run so it inherits none of the
 *  item's marks, and it is the SAME `taskMarker` the flat projection uses — the
 *  two cannot drift on which items get one.
 *
 *  ★★ NO EDGE TRIM, and one was written and then DELETED, so do not add it back
 *  "for parity with `collapseFlat`". Measured against the real parse: for every
 *  line kind but `pre`, `htmlToRichLines` has ALREADY dropped a line's leading
 *  and trailing whitespace — `<p>  see <a …>x</a>  </p>` arrives as
 *  `["see ", "x"]` — so a trim here is unobservable (its mutant survived the
 *  whole suite). For `pre` the whitespace is preserved ON PURPOSE and a trim
 *  would eat a code block's indentation, which is the flat projection's own
 *  loss and not one worth copying. */
export function cellLinkedLines(cell: ExportCell): readonly CellRunLine[] | undefined {
  if (!isRichCell(cell)) return undefined;
  const lines = htmlToRichLines(cell.html);
  if (!lines.some((line) => line.runs.some((run) => run.href !== undefined))) return undefined;
  return lines.map((line) => {
    const marker = taskMarker(line);
    const runs: readonly TextRun[] =
      marker === "" ? line.runs : [{ text: marker, marks: [] }, ...line.runs];
    return { kind: line.kind, runs };
  });
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
  const rows = tasks.map((task) =>
    CSV_COLUMNS.map((c) =>
      richCell(
        c === "noteLog" ? projectNoteLog(task.noteLog, lang) : fieldToString(task, c),
        c,
        TASK_RICH_COLUMNS
      )
    )
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

/** Projects a note log to one `author · date · text` line per entry, for a
 *  DOCUMENT-EXPORT cell — never for storage (CSV/Markdown/Turso keep the
 *  `encodeNoteLog` JSON blob; that round-trip is byte-pinned and must not
 *  change). Reads the entity's OWN `noteLog` array directly rather than
 *  re-encoding/decoding through `encodeNoteLog`/`decodeNoteLog`, so it carries
 *  no DOM dependency and cannot hit `decodeNoteLog`'s bare-node blind spot.
 *
 *  ★ `.text`, never `.html` — `.text` is the maintained plain projection
 *  (re-derived after sanitising), so no markup can reach a flat XLSX/PPTX
 *  cell. ★ The date is the ISO date part of `timestamp` (`slice(0, 10)`), NOT
 *  a localized display timestamp — this builder receives no timezone, so
 *  `formatDisplayTimestamp` is unreachable without a signature change across
 *  both consumers. ★ A missing/empty log stays an empty cell, mirroring
 *  `encodeNoteLog`'s own empty-string case. */
function projectNoteLog(log: readonly NoteLogEntry[] | undefined, lang: Lang): string {
  if (!log || log.length === 0) return "";
  return log
    .map((entry) => {
      const author = entry.authorName || t(lang, "noteLogNoAuthor");
      const date = entry.timestamp.slice(0, 10);
      return `${author} · ${date} · ${entry.text}`;
    })
    .join("\n");
}

function raidSection(raid: readonly RaidItem[], lang: Lang): ExportSection {
  const columns = RAID_CSV_COLUMNS as unknown as string[];
  const rows = raid.map((r) =>
    RAID_CSV_COLUMNS.map((c) =>
      richCell(
        c === "noteLog" ? projectNoteLog(r.noteLog, lang) : raidFieldToString(r, c),
        c,
        RAID_RICH_COLUMNS
      )
    )
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
      richCell(
        col === "noteLog" ? projectNoteLog(c.noteLog, lang) : changeFieldToString(c, col),
        col,
        CHANGE_RICH_COLUMNS
      )
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
