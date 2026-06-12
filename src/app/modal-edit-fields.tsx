"use client";

import { useMemo } from "react";
import { type Lang, t } from "./i18n";

type AssigneeOption = { name: string; email?: string };

/**
 * Deduplicate known assignees by case-folded name (keeping the first observed
 * casing) and sort alphabetically. Shared by the assignee datalist in the
 * Absence and Shift editors.
 */
function dedupeAssignees(
  known: ReadonlyArray<AssigneeOption>,
): AssigneeOption[] {
  const seen = new Set<string>();
  const out: AssigneeOption[] = [];
  for (const a of known) {
    const name = a.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email: a.email });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Assignee name + email pair with a datalist autocomplete of known people.
 * Typing a name that matches a known person auto-fills the email (only when the
 * email is still empty). Shared by the Absence and Shift editors.
 */
export function AssigneeField({
  datalistId,
  assignee,
  assigneeEmail,
  knownAssignees,
  onAssigneeChange,
  onEmailChange,
  assigneeLabel,
  assigneeEmailLabel,
  assigneePlaceholder,
  showEmail = true,
}: {
  datalistId: string;
  assignee: string;
  assigneeEmail: string | undefined;
  knownAssignees: ReadonlyArray<AssigneeOption>;
  onAssigneeChange: (name: string) => void;
  onEmailChange: (email: string | undefined) => void;
  assigneeLabel: string;
  assigneeEmailLabel: string;
  assigneePlaceholder: string;
  /** When false, the email input is hidden (its value is preserved by the caller). */
  showEmail?: boolean;
}) {
  const options = useMemo(
    () => dedupeAssignees(knownAssignees),
    [knownAssignees],
  );

  return (
    <>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        <span className="font-medium text-foreground">{assigneeLabel} *</span>
        <input
          type="text"
          required
          value={assignee}
          onChange={(e) => {
            const name = e.target.value;
            onAssigneeChange(name);
            // Auto-fill email when the typed name matches a known one.
            const match = options.find(
              (o) => o.name.toLowerCase() === name.trim().toLowerCase(),
            );
            if (match?.email && !assigneeEmail) {
              onEmailChange(match.email);
            }
          }}
          list={datalistId}
          placeholder={assigneePlaceholder}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
        <datalist id={datalistId}>
          {options.map((o) => (
            <option key={o.name} value={o.name}>
              {o.email ?? ""}
            </option>
          ))}
        </datalist>
      </label>

      {showEmail && (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">{assigneeEmailLabel}</span>
          <input
            type="email"
            value={assigneeEmail ?? ""}
            onChange={(e) => onEmailChange(e.target.value || undefined)}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
        </label>
      )}
    </>
  );
}

/**
 * Standard edit-modal footer: an optional Delete (edit mode only) on the left,
 * Cancel + Save on the right. The Save button is `type="submit"`, so the footer
 * must be rendered inside the modal's `<form>`. Shared by the Absence, Shift,
 * and Resource editors.
 */
export function ModalEditFooter({
  lang,
  isNew,
  onDelete,
  onClose,
  saveLabel,
}: {
  lang: Lang;
  isNew: boolean;
  onDelete: () => void;
  onClose: () => void;
  saveLabel: string;
}) {
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-line pt-3 sm:col-span-2">
      <div>
        {!isNew && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink hover:bg-AIPM-pink/10 dark:border-AIPM-pink/50"
          >
            {t(lang, "delete")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "cancel")}
        </button>
        <button
          type="submit"
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90"
        >
          {saveLabel}
        </button>
      </div>
    </footer>
  );
}
