// Pure helpers extracted from use-bulk-operations.ts. No React, no side effects —
// deterministic transforms over their inputs, so they can be unit-tested directly.
// (Not i18n-free: buildInquiryMessage takes `lang` and formats via `t`.)

import { type Lang, t } from "./i18n";
import type { BulkEditDraft } from "./task-form-context";
import type { Task } from "./types";
import { greetingName } from "./contacts";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizePriority,
} from "./sanitize";
import { sanitizeRichHtml } from "./sanitize-html";

export type BulkEditBuild =
  | { ok: false; error: "pastDate" | "invalidEmail" }
  | { ok: true; updates: Partial<Task> };

/** Validate the enabled bulk-edit fields and build the sanitized `Task` patch.
 *  Mirrors the original inline logic exactly: due-date is validated before
 *  email, and the patch is only assembled once both pass. The caller still owns
 *  the no-fields-enabled guard and the Jira-assignee block (impure — they need
 *  the selected tasks), which run BEFORE this in the original sequence. */
export function buildBulkEditUpdates(
  bulkEdit: BulkEditDraft,
  today: string,
): BulkEditBuild {
  const fields = bulkEdit.enabled;
  const newDue = fields.dueDate ? sanitizeIsoDate(bulkEdit.dueDate) : "";
  if (fields.dueDate && (!newDue || newDue < today)) {
    return { ok: false, error: "pastDate" };
  }
  const newEmail = fields.assigneeEmail ? sanitizeEmail(bulkEdit.assigneeEmail) : "";
  if (fields.assigneeEmail && newEmail && !isValidEmail(newEmail)) {
    return { ok: false, error: "invalidEmail" };
  }
  const updates: Partial<Task> = {};
  if (fields.priority) updates.priority = sanitizePriority(bulkEdit.priority);
  if (fields.dueDate) updates.dueDate = newDue;
  if (fields.lastUpdateDate)
    updates.lastUpdateDate = sanitizeIsoDate(bulkEdit.lastUpdateDate) || today;
  if (fields.assignee) updates.assignee = sanitizeAssignee(bulkEdit.assignee);
  if (fields.assigneeEmail) updates.assigneeEmail = newEmail;
  if (fields.blockers) updates.blockers = sanitizeBlockers(bulkEdit.blockers);
  if (fields.notes) updates.description = sanitizeRichHtml(bulkEdit.notes);
  if (fields.group) updates.group = sanitizeGroup(bulkEdit.group);
  if (fields.labels) updates.labels = sanitizeLabels(bulkEdit.labels);
  return { ok: true, updates };
}

/** Build the inquiry email subject + body for a group of tasks sharing one
 *  recipient. Single-task and multi-task templates mirror the original. */
export function buildInquiryMessage(
  taskList: readonly Task[],
  lang: Lang,
): { subject: string; body: string } {
  const greeting = greetingName(taskList[0].assignee) || taskList[0].assignee;
  if (taskList.length === 1) {
    const t0 = taskList[0];
    return {
      subject: t(lang, "emailSubject", t0.id, t0.taskName),
      body: t(lang, "emailBodyTemplate", greeting, t0.id, t0.taskName, t0.dueDate, t0.lastUpdateDate),
    };
  }
  const items = taskList
    .map((tk) => `- #${tk.id}: ${tk.taskName} (${tk.dueDate})`)
    .join("\n");
  return {
    subject: t(lang, "emailSubjectBulk", taskList.length),
    body: t(lang, "emailBodyBulkTemplate", greeting, taskList.length, items),
  };
}
