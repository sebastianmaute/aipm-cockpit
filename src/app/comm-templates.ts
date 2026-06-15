// src/app/comm-templates.ts — pure model + interpolation for communication templates.
import type { Lang } from "./i18n";
import type { Task, Stakeholder } from "./types";
import { greetingName } from "./contacts";

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
  const allowed = new Set(CATEGORY_FIELDS[category]);
  return body.replace(/\{\{(\w+)\}\}/g, (m, field) => (allowed.has(field) ? htmlEscape(vars[field] ?? "") : m));
}

export function withDefault(list: readonly CommTemplate[], id: string): CommTemplate[] {
  const target = list.find((t) => t.id === id);
  if (!target) return [...list];
  return list.map((t) => (t.category === target.category ? { ...t, isDefault: t.id === id } : t));
}

export function buildStatusInquiryVars(task: Task, _lang: Lang): Record<string, string> {
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
