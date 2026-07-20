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
import type { ExportConfig, ExportSectionKey } from "./settings-types";
import { linkKindOf, type KnowledgeItem } from "./document-link";
import type { Insight } from "./insights/insight";
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

export type ExportSection = {
  key: ExportSectionKey;
  title: string;       // localized section heading
  columns: string[];   // header row (display labels)
  rows: (string | number)[][];  // body rows, one entry per entity
};

// ---------------------------------------------------------------------------
// Per-section projection helpers
// ---------------------------------------------------------------------------

function tasksSection(tasks: readonly Task[], lang: Lang): ExportSection {
  const columns = CSV_COLUMNS as unknown as string[];
  const rows = tasks.map((t) =>
    CSV_COLUMNS.map((c) => fieldToString(t, c))
  );
  return { key: "tasks", title: t(lang, "tasks"), columns, rows };
}

function raidSection(raid: readonly RaidItem[], lang: Lang): ExportSection {
  const columns = RAID_CSV_COLUMNS as unknown as string[];
  const rows = raid.map((r) =>
    RAID_CSV_COLUMNS.map((c) => raidFieldToString(r, c))
  );
  return { key: "raid", title: t(lang, "tabRaid"), columns, rows };
}

function milestonesSection(milestones: readonly Milestone[], lang: Lang): ExportSection {
  const columns = MILESTONES_CSV_COLUMNS as unknown as string[];
  const rows = milestones.map((m) =>
    MILESTONES_CSV_COLUMNS.map((c) => milestoneFieldToString(m, c))
  );
  return { key: "milestones", title: t(lang, "navMilestones"), columns, rows };
}

function changesSection(changes: readonly ChangeItem[], lang: Lang): ExportSection {
  const columns = CHANGES_CSV_COLUMNS as unknown as string[];
  const rows = changes.map((c) =>
    CHANGES_CSV_COLUMNS.map((col) => changeFieldToString(c, col))
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
      value = persons.map((cp) => `${cp.name} <${cp.email}>`).join(", ");
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
