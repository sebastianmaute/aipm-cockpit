"use client";

import type { Contact } from "./contacts";
import { InfoTooltip } from "./info-tooltip";
import { HintedLabel, Input } from "./form-controls";
import { type Lang } from "./i18n";
import { ResourcePicker } from "./resource-picker";
import type { Resource } from "./types";

export type AssigneePick = { name: string; email: string; resourceId: number | null };

/**
 * Assignee name + email pair. The name is the shared searchable `ResourcePicker`
 * (the resource directory plus contacts, as in the task and shift editors), so
 * picking a person also links them (`resourceId`) and fills their email; a name
 * typed freely is still accepted. Used by the Absence editor.
 */
export function AssigneeField({
  lang,
  assignee,
  assigneeEmail,
  resourceId,
  resources,
  contacts,
  onCreateResource,
  onAssigneeChange,
  onEmailChange,
  assigneeLabel,
  assigneeEmailLabel,
  assigneePlaceholder,
  showEmail = true,
  tooltip,
  emailInvalid,
  emailDescribedBy,
}: {
  lang: Lang;
  assignee: string;
  assigneeEmail: string | undefined;
  resourceId: number | null | undefined;
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource?: (name: string, email: string) => number;
  /** The picked or typed person. `email` is "" when the picker has none to offer. */
  onAssigneeChange: (next: AssigneePick) => void;
  onEmailChange: (email: string | undefined) => void;
  assigneeLabel: string;
  assigneeEmailLabel: string;
  assigneePlaceholder: string;
  /** When false, the email input is hidden (its value is preserved by the caller). */
  showEmail?: boolean;
  /** Optional already-translated tooltip text shown inline after the label. */
  tooltip?: string;
  /** Marks the email input invalid: a stored or copied unsafe value the caller flags. */
  emailInvalid?: boolean;
  /** Id of the caller's flag element, for the email input's aria-describedby. */
  emailDescribedBy?: string;
}) {
  const caption = `${assigneeLabel} *`;
  const assigneeInput = (
    <ResourcePicker
      lang={lang}
      value={{ name: assignee, email: assigneeEmail ?? "", resourceId: resourceId ?? null }}
      resources={resources}
      contacts={contacts}
      onCreateResource={onCreateResource}
      onChange={onAssigneeChange}
      placeholder={assigneePlaceholder}
      // Named explicitly: inside the <label>, the picker's own clear button
      // would otherwise join the accessible name once a person is set.
      aria-label={caption}
      aria-required
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
            <span className="flex items-center gap-1 font-medium text-foreground">{caption}</span>
          }
        >
          {assigneeInput}
        </HintedLabel>
      ) : (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">{caption}</span>
          {assigneeInput}
        </label>
      )}

      {showEmail && (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">{assigneeEmailLabel}</span>
          <Input
            type="email"
            value={assigneeEmail ?? ""}
            onChange={(e) => onEmailChange(e.target.value || undefined)}
            invalid={emailInvalid || undefined}
            aria-describedby={emailDescribedBy}
          />
        </label>
      )}
    </>
  );
}
