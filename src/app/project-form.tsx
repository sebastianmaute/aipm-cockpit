"use client";

// Shared create/edit project form (stateful container).
//
// - Holds a ProjectFormDraft in state (from `initial` in edit mode, or blank).
// - Runs validateProjectMeta on every render to gate the Save button.
// - Inline per-field errors reveal only after the field is blurred (touched) OR
//   a submit was attempted — mirrors the task form (use-task-submit.ts +
//   task-form-fields.tsx).
// - On submit: build a ProjectMeta from the draft, run sanitizeProjectMeta, and
//   call onSubmit only when it returns non-null.

import { useMemo, useState } from "react";
import { type Contact } from "./contacts";
import { t, type Lang } from "./i18n";
import {
  CustomerFields,
  emptyProjectDraft,
  IdentityPeopleFields,
  OptionalDetailsFields,
  type ProjectFormDraft,
} from "./project-form-fields";
import {
  hasProjectErrors,
  validateProjectMeta,
  type ProjectErrorField,
} from "./project-validation";
import { sanitizeProjectMeta } from "./sanitize";
import { type ProjectMeta, type Resource } from "./types";

export interface ProjectFormProps {
  /** Provided → edit mode (prefilled); omitted → create mode (blank). */
  initial?: ProjectMeta;
  /** Suggestions for the key-stakeholder token inputs. */
  stakeholderNames: string[];
  /** Address book for the "add from address book" contact picker. */
  addressBook: Contact[];
  /** Registry resources for the link-only contact-person picker. */
  resources: readonly Resource[];
  lang: Lang;
  /** Called with a sanitized ProjectMeta on a valid submit. */
  onSubmit: (meta: ProjectMeta) => void;
  onCancel: () => void;
  /** Override the submit button label. Defaults to "Edit project" / "New project". */
  submitLabel?: string;
  /** Optional content rendered at the footer's bottom-left (e.g. a
   *  "Configure M365 integration" button). */
  footerLeft?: React.ReactNode;
}

/** Build the editable draft from an existing ProjectMeta (edit mode). */
function draftFromMeta(meta: ProjectMeta): ProjectFormDraft {
  return {
    name: meta.name,
    code: meta.code,
    description: meta.description ?? "",
    sponsor: meta.sponsor ?? "",
    projectManager: meta.projectManager,
    keyStakeholdersInternal: [...meta.keyStakeholdersInternal],
    keyStakeholdersExternal: [...meta.keyStakeholdersExternal],
    customer: meta.customer,
    naceSection: meta.naceSection,
    identityTypes: [...meta.identityTypes],
    identityCount: meta.identityCount !== undefined ? String(meta.identityCount) : "",
    stakeholderCount: meta.stakeholderCount !== undefined ? String(meta.stakeholderCount) : "",
    products: meta.products,
    platform: meta.platform ?? "",
    deployment: meta.deployment,
    startDate: meta.startDate,
    endDate: meta.endDate,
    profitCenter: meta.profitCenter,
    quotes: meta.quotes ?? "",
    salesforceUrl: meta.salesforceUrl ?? "",
    sharepointUrl: meta.sharepointUrl ?? "",
    confluenceUrl: meta.confluenceUrl ?? "",
    jiraUrl: meta.jiraUrl ?? "",
    contactPersons: meta.contactPersons.map((c) => ({ ...c })),
    docRepoLocation: meta.docRepoLocation ?? "",
    regulatory: [...meta.regulatory],
    notes: meta.notes ?? "",
    documentLinks: meta.documentLinks ?? [],
  };
}

export function ProjectForm({
  initial,
  stakeholderNames,
  addressBook,
  resources,
  lang,
  onSubmit,
  onCancel,
  submitLabel,
  footerLeft,
}: ProjectFormProps) {
  const [draft, setDraft] = useState<ProjectFormDraft>(() =>
    initial ? draftFromMeta(initial) : emptyProjectDraft(),
  );
  const [touched, setTouched] = useState<Set<ProjectErrorField>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);

  // Live errors gate Save; touched/submitted gate their inline display.
  const errors = useMemo(() => validateProjectMeta(draft), [draft]);
  const saveDisabled = hasProjectErrors(errors);

  const markTouched = (field: ProjectErrorField) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const errorFor = (field: ProjectErrorField): string | null => {
    const key = errors[field];
    if (!key || !(submitted || touched.has(field))) return null;
    return t(lang, key);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    // Belt-and-suspenders: Save is already disabled when invalid.
    if (hasProjectErrors(validateProjectMeta(draft))) return;

    // sanitizeProjectMeta coerces identityCount, filters enum arrays, collapses
    // an exclusive "Not applicable", and drops blank optional fields.
    const meta = sanitizeProjectMeta({
      name: draft.name,
      code: draft.code,
      description: draft.description,
      sponsor: draft.sponsor,
      projectManager: draft.projectManager,
      keyStakeholdersInternal: draft.keyStakeholdersInternal,
      keyStakeholdersExternal: draft.keyStakeholdersExternal,
      customer: draft.customer,
      naceSection: draft.naceSection,
      identityTypes: draft.identityTypes,
      identityCount: draft.identityCount,
      stakeholderCount: draft.stakeholderCount,
      products: draft.products,
      platform: draft.platform,
      deployment: draft.deployment,
      startDate: draft.startDate,
      endDate: draft.endDate,
      profitCenter: draft.profitCenter,
      quotes: draft.quotes,
      salesforceUrl: draft.salesforceUrl,
      sharepointUrl: draft.sharepointUrl,
      confluenceUrl: draft.confluenceUrl,
      jiraUrl: draft.jiraUrl,
      contactPersons: draft.contactPersons,
      docRepoLocation: draft.docRepoLocation,
      regulatory: draft.regulatory,
      notes: draft.notes,
      documentLinks: draft.documentLinks,
    });

    // Guard: should pass since validation passed. If it ever returns null,
    // keep the form open rather than emitting an invalid meta.
    if (!meta) return;
    onSubmit(meta);
  };

  const fieldsProps = {
    draft,
    setDraft,
    errorFor,
    markTouched,
    lang,
    stakeholderNames,
    addressBook,
    resources,
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <IdentityPeopleFields {...fieldsProps} />
      <CustomerFields {...fieldsProps} />

      {/* Optional, non-mandatory fields — collapsed by default to keep the
          create flow focused on what's required. */}
      <details className="rounded-md border border-line bg-surface">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-AIPM-dark-blue marker:text-muted-foreground dark:text-AIPM-light-grey">
          {t(lang, "projectFormOptional")}
        </summary>
        <div className="border-t border-line p-4">
          <OptionalDetailsFields {...fieldsProps} />
        </div>
      </details>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex items-center gap-2">{footerLeft}</div>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
        >
          {t(lang, "cancel")}
        </button>
        <button
          type="submit"
          disabled={saveDisabled}
          className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel ?? t(lang, initial ? "projectsEdit" : "projectsNew")}
        </button>
        </div>
      </div>
    </form>
  );
}
