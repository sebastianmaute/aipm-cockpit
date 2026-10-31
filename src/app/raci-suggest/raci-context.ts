// The digest "Suggest RACI" sends the model. Pure and i18n-free; the model's output is untrusted,
// but this text is built only from the live workspace and the user's own request.
import type { Discipline, Grade, Milestone, Resource, Role } from "../types";
import type { ProjectDocument } from "../document-model";
import { descriptionHtml, htmlPlainProjection, oneLine } from "../rich-text-plain";
import { buildRaciEvidence, evidenceLine, type RaciEvidenceInput } from "./raci-evidence";

export const MAX_CONTEXT_STAKEHOLDERS = 120;
export const MAX_CONTEXT_MILESTONES = 60;
/** Visible characters of a milestone description the model is shown; the rest is cut with "…". */
export const RACI_CONTEXT_DESCRIPTION_CHARS = 300;
export const MAX_EVIDENCE_LINES = 500;
export const MAX_DOC_TITLES_PER_MILESTONE = 5;
export const DOC_TITLE_CHARS = 80;
export const RACI_REQUEST_MAX_CHARS = 2000;

export interface RaciContextInput extends RaciEvidenceInput {
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  documents: readonly ProjectDocument[];
  request?: string;
}

/** One table cell: a single line, with the column separator replaced, so a value
 *  can never split its row or add a column (§770). */
function cell(v: string | undefined): string {
  return oneLine(v ?? "").replace(/\s+/g, " ").replace(/\|/g, "/");
}

/** `text` cut to `max` code points (never splitting an emoji), with "…" when cut. */
function capChars(text: string, max: number): { text: string; cut: boolean } {
  const chars = [...text];
  return chars.length > max
    ? { text: `${chars.slice(0, max).join("")}…`, cut: true }
    : { text, cut: false };
}

/** A milestone description as one capped plain-text cell. A legacy plain value
 *  is escaped first (`descriptionHtml`), so a literal "<" in it survives. */
function descriptionCell(stored: string | undefined): string {
  return capChars(cell(htmlPlainProjection(descriptionHtml(stored, "rich"))), RACI_CONTEXT_DESCRIPTION_CHARS).text;
}

/** Discipline and grade names for a resource, via Resource.roleId → Role. Blank when any link is missing. */
function disciplineGradeOf(input: RaciContextInput): (r: Resource | undefined) => [string, string] {
  const roles = new Map(input.roles.map((r) => [r.id, r]));
  const disciplines = new Map(input.disciplines.map((d) => [d.id, d.name]));
  const grades = new Map(input.grades.map((g) => [g.id, g.name]));
  return (r) => {
    const role = r?.roleId != null ? roles.get(r.roleId) : undefined;
    if (!role) return ["", ""];
    return [cell(disciplines.get(role.disciplineId)), cell(grades.get(role.gradeId))];
  };
}

/** Titles of the documents linked to the milestone or to one of its (existing) tasks, once each. */
function documentTitles(
  m: Milestone,
  documents: readonly ProjectDocument[],
  taskIds: ReadonlySet<number>,
  milestoneIds: ReadonlySet<number>,
): string[] {
  if (!milestoneIds.has(m.id)) return [];
  const own = new Set((m.linkedTaskIds ?? []).filter((id) => taskIds.has(id)));
  const titles: string[] = [];
  for (const doc of documents) {
    const hit = (doc.linkedEntities ?? []).some(
      (ref) => (ref.kind === "milestone" && ref.id === m.id) || (ref.kind === "task" && own.has(ref.id)),
    );
    if (hit) titles.push(doc.title);
  }
  return titles;
}

/** The request as separate one-line rows (newlines kept as line breaks), capped in code points. */
function requestLines(request: string | undefined): { lines: string[]; cut: boolean } {
  if (!request || request.trim() === "") return { lines: [], cut: false };
  const capped = capChars(request.trim(), RACI_REQUEST_MAX_CHARS);
  const lines = capped.text.split(/\r\n|\r|\n/).map((l) => cell(l)).filter((l) => l !== "");
  return { lines, cut: capped.cut };
}

/** Compact English digest for the model. Capped, and reports the cap — a silent
 *  truncation reads as "covered everything". */
export function buildRaciContext(input: RaciContextInput): { text: string; truncated: boolean } {
  const s = input.stakeholders.slice(0, MAX_CONTEXT_STAKEHOLDERS);
  const m = input.milestones.slice(0, MAX_CONTEXT_MILESTONES);
  const resourcesById = new Map(input.resources.map((r) => [r.id, r]));
  const disciplineGrade = disciplineGradeOf(input);
  let truncated =
    input.stakeholders.length > MAX_CONTEXT_STAKEHOLDERS || input.milestones.length > MAX_CONTEXT_MILESTONES;

  const lines: string[] = [
    "STAKEHOLDERS (id | name | title | organization | category | influence | interest | discipline | grade)",
  ];
  for (const p of s) {
    const linked = p.resourceId != null ? resourcesById.get(p.resourceId) : undefined;
    lines.push(
      [
        p.id, cell(p.name), cell(p.title), cell(p.organization), p.category, p.influence, p.interest,
        ...disciplineGrade(linked),
      ].join(" | "),
    );
  }

  const taskIds = new Set(input.tasks.map((t) => t.id));
  const milestoneIds = new Set(input.milestones.map((x) => x.id));
  lines.push("", "MILESTONES (id | name | date | scope | documents | description)");
  for (const x of m) {
    const scope = new Set((x.linkedTaskIds ?? []).filter((id) => taskIds.has(id))).size;
    const titles = documentTitles(x, input.documents, taskIds, milestoneIds);
    if (titles.length > MAX_DOC_TITLES_PER_MILESTONE) truncated = true;
    // Shortening one title is not a dropped row (like the description cut); only dropped titles flag.
    const shown = titles.slice(0, MAX_DOC_TITLES_PER_MILESTONE).map((t) => capChars(cell(t), DOC_TITLE_CHARS).text);
    lines.push([x.id, cell(x.name), x.date ?? "", scope, shown.join("; "), descriptionCell(x.description)].join(" | "));
  }

  lines.push("", "EXISTING ASSIGNMENTS (stakeholderId | milestoneId | role)");
  // Restricted to the milestones actually listed above. Emitting an assignment
  // for a milestone outside the capped slice shows the model an id it was never
  // given, inviting it to reason about — or propose against — a row it cannot
  // see. Grounding would reject such a cell anyway; this keeps the prompt
  // self-consistent rather than relying on that backstop.
  const shownMilestones = new Set(m.map((x) => String(x.id)));
  for (const p of s) {
    for (const [key, role] of Object.entries(p.raci)) {
      if (!shownMilestones.has(key)) continue;
      lines.push([p.id, key, role].join(" | "));
    }
  }

  // Evidence is built over the SHOWN rows only, so it never names an id the model was not given.
  const evidence = buildRaciEvidence({ ...input, stakeholders: s, milestones: m });
  if (evidence.length > MAX_EVIDENCE_LINES) truncated = true;
  lines.push("", "EVIDENCE (stakeholderId | milestoneId | evidence)");
  for (const e of evidence.slice(0, MAX_EVIDENCE_LINES)) {
    lines.push([e.stakeholderId, e.milestoneId, evidenceLine(e)].join(" | "));
  }

  const request = requestLines(input.request);
  if (request.cut) truncated = true;
  if (request.lines.length > 0) lines.push("", "REQUEST", ...request.lines);

  return { text: lines.join("\n"), truncated };
}
