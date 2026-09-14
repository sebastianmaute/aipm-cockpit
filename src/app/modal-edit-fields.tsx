"use client";

import { useMemo } from "react";
import { InfoTooltip } from "./info-tooltip";
import { HintedLabel, Input } from "./form-controls";

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
  tooltip,
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
  /** Optional already-translated tooltip text shown inline after the label. */
  tooltip?: string;
}) {
  const options = useMemo(
    () => dedupeAssignees(knownAssignees),
    [knownAssignees],
  );

  const assigneeInput = (
    <Input
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
    />
  );

  return (
    <>
      {tooltip ? (
        // ★★ The hint must stay OUTSIDE the naming <label> (open-followups
        //   §386): inside it, the trigger's text joins the input's name.
        <HintedLabel
          className="text-sm sm:col-span-2"
          bodyClassName="flex flex-col gap-1"
          hint={<InfoTooltip text={tooltip} />}
          caption={
            <span className="flex items-center gap-1 font-medium text-foreground">{assigneeLabel} *</span>
          }
        >
          {assigneeInput}
        </HintedLabel>
      ) : (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">{assigneeLabel} *</span>
          {assigneeInput}
        </label>
      )}
      {/* Outside the label either way: only the input's `list` references it. */}
      <datalist id={datalistId}>
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.email ?? ""}
          </option>
        ))}
      </datalist>

      {showEmail && (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">{assigneeEmailLabel}</span>
          <Input
            type="email"
            value={assigneeEmail ?? ""}
            onChange={(e) => onEmailChange(e.target.value || undefined)}
          />
        </label>
      )}
    </>
  );
}

