// src/app/comm-templates.ts — pure model + interpolation for communication templates.
import type { Task, Stakeholder } from "./types";
import { greetingName } from "./contacts";
// Pure regex, no DOM — safe to import into this DOM-free model module.
import { htmlToPlainText } from "./html-to-text";

export type CommTemplateCategory = "status-inquiry" | "stakeholder-update";

export const COMM_TEMPLATE_CATEGORIES: readonly CommTemplateCategory[] = ["status-inquiry", "stakeholder-update"];

export const CATEGORY_FIELDS: Record<CommTemplateCategory, readonly string[]> = {
  "status-inquiry": ["taskId", "taskName", "dueDate", "lastUpdate", "assignee"],
  "stakeholder-update": ["stakeholderName", "projectName"],
};

export interface CommTemplate {
  id: string;
  category: CommTemplateCategory;
  name: string;
  body: string;        // HTML
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function htmlEscape(s: string): string { return s.replace(/[&<>"']/g, (c) => ESC[c]); }

export function renderTemplate(body: string, category: CommTemplateCategory, vars: Readonly<Record<string, string>>): string {
  const allowed = new Set(CATEGORY_FIELDS[category] ?? []);
  return body.replace(/\{\{(\w+)\}\}/g, (m, field) => (allowed.has(field) ? htmlEscape(vars[field] ?? "") : m));
}

/** Render a template for SENDING, or `null` when it has nothing to send.
 *
 *  ★★★ `null` MEANS "FALL BACK TO THE i18n BODY", AND AN EMPTY TEMPLATE MUST
 *  PRODUCE IT. A `body != null` guard at the call site is NOT enough, and the
 *  gap is reachable on the very first use of the feature with no partial
 *  input: `createTemplate` (settings-sections/comm-templates-section.tsx)
 *  creates every template with body `""`, and `create` (use-comm-templates.ts)
 *  makes the first template in a category its default on purpose. So naming a
 *  template and clicking Create — typing no body at all — leaves a DEFAULT
 *  that resolves to `""`. `""` is not null, so the old guard admitted it, the
 *  i18n fallback `use-comm-templates.ts`'s own header promises was skipped,
 *  and the mail client opened on a literal `&body=`.
 *  ★★ THE TEST IS ON THE RENDERED PLAIN TEXT, NOT THE RAW BODY, and the two
 *  disagree in both directions. The rich-text editor's empty document
 *  serialises to `<p></p>` / `<p><br></p>` — a non-empty STRING that trims to
 *  nothing. And a body that is nothing but placeholders (`<p>{{dueDate}}</p>`
 *  on a task with no due date) is non-blank raw and blank once rendered. Only
 *  the value about to be sent can answer the question.
 *  ★ `rendered` is handed back beside `plain` so the caller sanitises the SAME
 *  render it decided on — rendering twice would let the HTML and plain-text
 *  halves of one mail drift.
 */
export function renderTemplateForSend(
  body: string | null,
  category: CommTemplateCategory,
  vars: Readonly<Record<string, string>>,
): { plain: string; rendered: string } | null {
  if (body == null) return null;
  const rendered = renderTemplate(body, category, vars);
  const plain = htmlToPlainText(rendered);
  return plain === "" ? null : { plain, rendered };
}

export function withDefault(list: readonly CommTemplate[], id: string): CommTemplate[] {
  const target = list.find((t) => t.id === id);
  if (!target) return [...list];
  return list.map((t) => (t.category === target.category ? { ...t, isDefault: t.id === id } : t));
}

export function buildStatusInquiryVars(task: Task): Record<string, string> {
  return {
    taskId: String(task.id),
    taskName: task.taskName,
    dueDate: task.dueDate ?? "",
    lastUpdate: task.lastUpdateDate ?? "",
    assignee: greetingName(task.assignee) || task.assignee || "",
  };
}

export function buildStakeholderUpdateVars(sh: Stakeholder, projectName: string): Record<string, string> {
  return { stakeholderName: sh.name, projectName };
}
