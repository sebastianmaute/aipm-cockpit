"use client";

// Presentational field groups for the shared project create/edit form.
//
// All state lives in the container (project-form.tsx); this module is pure
// layout + controlled inputs. Two visually separated groups:
//   1. Identity + People
//   2. Customer
//
// Inline per-field errors are passed in already-resolved (string | null) so this
// module needs no validation logic of its own. AIPM palette only — no shadows or
// gradients.

import { useState } from "react";
import type React from "react";
import { FieldError } from "./field-feedback";
import { FieldGroup, fieldClass } from "./form-controls";
import { InfoTooltip } from "./info-tooltip";
import { t, type Lang } from "./i18n";
import type { KnowledgeLink } from "./document-link";
import { tzZones } from "./timezone";
import { KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";
import {
  IDENTITY_TYPES,
  DEPLOYMENTS,
  REGULATORY_REQUIREMENTS,
  REGULATORY_NOT_APPLICABLE,
} from "./project-options";
import { NACE_SECTIONS } from "./nace-sections";
import { type ProjectDraft, type ProjectErrorField } from "./project-validation";
import { ResourcePicker } from "./resource-picker";
import { type Contact } from "./contacts";
import {
  type ContactPerson,
  type Deployment,
  type IdentityType,
  type RegulatoryRequirement,
  type Resource,
} from "./types";

// The form's in-progress draft. A SUPERSET of `ProjectDraft` (the shape
// project-validation.ts validates): all of ProjectDraft's fields plus the
// optional ProjectMeta fields the form also edits. Being a structural superset,
// a ProjectFormDraft passes anywhere a ProjectDraft is expected. `identityCount`
// stays a STRING here (raw number-input value); sanitizeProjectMeta coerces it.
export type ProjectFormDraft = ProjectDraft & {
  description: string;
  sponsor: string;
  stakeholderCount: string;
  identityCount: string;
  platform: string;
  quotes: string;
  docRepoLocation: string;
  notes: string;
  knowledgeLinks: KnowledgeLink[];
  operatingTimezone: string;
};

/** A blank create-mode draft: empty strings, empty arrays, no selection. */
export function emptyProjectDraft(): ProjectFormDraft {
  return {
    name: "",
    code: "",
    description: "",
    sponsor: "",
    projectManager: "",
    keyStakeholdersInternal: [],
    keyStakeholdersExternal: [],
    customer: "",
    naceSection: "",
    identityTypes: [],
    stakeholderCount: "",
    identityCount: "",
    products: "",
    platform: "",
    deployment: "",
    startDate: "",
    endDate: "",
    profitCenter: "",
    quotes: "",
    salesforceUrl: "",
    sharepointUrl: "",
    confluenceUrl: "",
    jiraUrl: "",
    contactPersons: [],
    docRepoLocation: "",
    regulatory: [],
    notes: "",
    knowledgeLinks: [],
    operatingTimezone: "",
  };
}

// Canonical field shell, single-sourced from the shared primitive (was a
// copy-declared ring-1 string; now the ring-2 ui-green standard).
export const inputClass = fieldClass(false, "w-full");

// IANA zone list for the operating-timezone select (shared with the settings
// picker via timezone.ts; guarded fallback for older runtimes inside tzZones).
const TIMEZONE_OPTIONS: readonly string[] = tzZones();

// Suggested identity-count steps (datalist) — guidance only; any number is valid.
const IDENTITY_COUNT_STEPS = [
  50, 100, 500, 1000, 2500, 5000, 10000, 30000, 50000, 100000, 250000, 500000,
  1000000, 5000000, 10000000, 50000000,
] as const;

// One titled section. Owns its own two-column grid so wide fields can span. The
// heading uses the AIPM dark-blue token and a bottom divider (mirrors the task
// form's TaskFormSection, minus the leading number).
export function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

// Field wrapper with label + required-asterisk convention (same as task form).
// ★★★ `group` IS NOT COSMETIC — pass it whenever the children's first labelable
// element is a BUTTON. A `<label>` with no `for` binds to its first LABELABLE
// descendant (button · input · meter · output · progress · select · textarea);
// a chip row, a radiogroup and a contenteditable are none of those, so the
// caption silently binds to a BUTTON inside instead — hovering the caption
// paints that button's hover state and clicking it ACTIVATES it. The documents
// field is the case here: it renders a ✕ per link and no input, so clicking
// "Documents" deleted a link. See src/test/label-binding.ts.
export function Field({
  lang,
  label,
  required,
  className,
  tooltip,
  group,
  children,
}: {
  lang: Lang;
  label: string;
  required?: boolean;
  className?: string;
  tooltip?: string;
  /** Children's first labelable element is a button (or there is none) — render
   *  a named `role="group"` wrapper rather than a mis-binding `<label>`. */
  group?: boolean;
  children: React.ReactNode;
}) {
  const caption = (
    <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
      {label}
      {required && <span className="text-ui-pink-strong">*</span>}
      {tooltip && <InfoTooltip text={tooltip} label={t(lang, "infoMore")} />}
    </span>
  );
  if (group) {
    return (
      <FieldGroup name={label} caption={caption} className={`block ${className ?? ""}`}>
        {children}
      </FieldGroup>
    );
  }
  return (
    <label className={`block ${className ?? ""}`}>
      {caption}
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

export interface ProjectFieldsProps {
  draft: ProjectFormDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProjectFormDraft>>;
  /** Resolved error string for a field, or null when it should not show yet. */
  errorFor: (field: ProjectErrorField) => string | null;
  markTouched: (field: ProjectErrorField) => void;
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  resources: readonly Resource[];
}

// ---------------------------------------------------------------------------
// Group 1 — Identity + People
// ---------------------------------------------------------------------------

export function IdentityPeopleFields({
  draft,
  setDraft,
  errorFor,
  markTouched,
  lang,
  addressBook,
  resources,
}: ProjectFieldsProps) {
  return (
    <FormSection title={`${t(lang, "projectFormIdentity")} · ${t(lang, "projectFormPeople")}`}>
      <Field lang={lang} label={t(lang,"projectName")} required tooltip={t(lang, "tipProjectName")}>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
          onBlur={() => markTouched("name")}
          aria-invalid={errorFor("name") ? true : undefined}
          aria-describedby={errorFor("name") ? "name-error" : undefined}
          className={inputClass}
        />
        <FieldError id="name-error">{errorFor("name")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectCode")} required tooltip={t(lang, "tipProjectCode")}>
        <input
          type="text"
          value={draft.code}
          onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))}
          onBlur={() => markTouched("code")}
          aria-invalid={errorFor("code") ? true : undefined}
          aria-describedby={errorFor("code") ? "code-error" : undefined}
          className={inputClass}
        />
        <FieldError id="code-error">{errorFor("code")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectManager")} required tooltip={t(lang, "tipProjectManager")}>
        <input
          type="text"
          value={draft.projectManager}
          onChange={(e) => setDraft((p) => ({ ...p, projectManager: e.target.value }))}
          onBlur={() => markTouched("projectManager")}
          aria-invalid={errorFor("projectManager") ? true : undefined}
          aria-describedby={errorFor("projectManager") ? "projectManager-error" : undefined}
          className={inputClass}
        />
        <FieldError id="projectManager-error">{errorFor("projectManager")}</FieldError>
      </Field>

      {/* Contacts are MANDATORY (≥1). Consumes registry resources + the address
          book via the link-only ResourcePicker. */}
      <div className="sm:col-span-2">
        <ContactPersonsControl
          lang={lang}
          contactPersons={draft.contactPersons}
          addressBook={addressBook}
          resources={resources}
          required
          error={errorFor("contactPersons")}
          onChange={(next) => {
            setDraft((p) => ({ ...p, contactPersons: next }));
            markTouched("contactPersons");
          }}
        />
      </div>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Group 2 — Customer
// ---------------------------------------------------------------------------

export function CustomerFields({
  draft,
  setDraft,
  errorFor,
  markTouched,
  lang,
}: ProjectFieldsProps) {
  // Regulatory checkbox group with an EXCLUSIVE "Not applicable":
  //  - selecting "Not applicable" clears everything else,
  //  - selecting any other requirement clears "Not applicable".
  const toggleRegulatory = (req: RegulatoryRequirement) => {
    markTouched("regulatory");
    setDraft((p) => {
      const has = p.regulatory.includes(req);
      if (req === REGULATORY_NOT_APPLICABLE) {
        return { ...p, regulatory: has ? [] : [REGULATORY_NOT_APPLICABLE] };
      }
      const withoutNa = p.regulatory.filter((x) => x !== REGULATORY_NOT_APPLICABLE);
      return {
        ...p,
        regulatory: has ? withoutNa.filter((x) => x !== req) : [...withoutNa, req],
      };
    });
  };

  return (
    <FormSection title={t(lang, "projectFormCustomer")}>
      <Field lang={lang} label={t(lang,"projectCustomer")} required tooltip={t(lang, "tipCustomer")}>
        <input
          type="text"
          value={draft.customer}
          onChange={(e) => setDraft((p) => ({ ...p, customer: e.target.value }))}
          onBlur={() => markTouched("customer")}
          aria-invalid={errorFor("customer") ? true : undefined}
          aria-describedby={errorFor("customer") ? "customer-error" : undefined}
          className={inputClass}
        />
        <FieldError id="customer-error">{errorFor("customer")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectNaceSection")} required tooltip={t(lang, "tipNace")}>
        <select
          value={draft.naceSection}
          onChange={(e) => setDraft((p) => ({ ...p, naceSection: e.target.value }))}
          onBlur={() => markTouched("naceSection")}
          aria-invalid={errorFor("naceSection") ? true : undefined}
          aria-describedby={errorFor("naceSection") ? "naceSection-error" : undefined}
          className={inputClass}
        >
          <option value="">—</option>
          {NACE_SECTIONS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.title}
            </option>
          ))}
        </select>
        <FieldError id="naceSection-error">{errorFor("naceSection")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectProducts")} required tooltip={t(lang, "tipProducts")}>
        <input
          type="text"
          value={draft.products}
          onChange={(e) => setDraft((p) => ({ ...p, products: e.target.value }))}
          onBlur={() => markTouched("products")}
          aria-invalid={errorFor("products") ? true : undefined}
          aria-describedby={errorFor("products") ? "products-error" : undefined}
          className={inputClass}
        />
        <FieldError id="products-error">{errorFor("products")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectDeployment")} required tooltip={t(lang, "tipDeployment")}>
        <select
          value={draft.deployment}
          onChange={(e) => setDraft((p) => ({ ...p, deployment: e.target.value as Deployment | "" }))}
          onBlur={() => markTouched("deployment")}
          aria-invalid={errorFor("deployment") ? true : undefined}
          aria-describedby={errorFor("deployment") ? "deployment-error" : undefined}
          className={inputClass}
        >
          <option value="">—</option>
          {DEPLOYMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <FieldError id="deployment-error">{errorFor("deployment")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectStartDate")} required tooltip={t(lang, "tipStartDate")}>
        <input
          type="date"
          value={draft.startDate}
          onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))}
          onBlur={() => markTouched("startDate")}
          aria-invalid={errorFor("startDate") ? true : undefined}
          aria-describedby={errorFor("startDate") ? "startDate-error" : undefined}
          className={inputClass}
        />
        <FieldError id="startDate-error">{errorFor("startDate")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectProfitCenter")} required tooltip={t(lang, "tipProfitCenter")}>
        <input
          type="text"
          value={draft.profitCenter}
          onChange={(e) => setDraft((p) => ({ ...p, profitCenter: e.target.value }))}
          onBlur={() => markTouched("profitCenter")}
          aria-invalid={errorFor("profitCenter") ? true : undefined}
          aria-describedby={errorFor("profitCenter") ? "profitCenter-error" : undefined}
          className={inputClass}
        />
        <FieldError id="profitCenter-error">{errorFor("profitCenter")}</FieldError>
      </Field>

      {/* `group`: a grid of checkboxes, each in its own `<label>`. A plain
          caption would adopt the FIRST checkbox — clicking "Regulatory
          requirements" ticked it — and would nest a label inside a label. */}
      <Field lang={lang} label={t(lang,"projectRegulatory")} required className="sm:col-span-2" tooltip={t(lang, "tipRegulatory")} group>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {REGULATORY_REQUIREMENTS.map((req) => (
            <label key={req} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.regulatory.includes(req)}
                onChange={() => toggleRegulatory(req)}
                className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green dark:border-line dark:bg-surface-muted"
              />
              {req}
            </label>
          ))}
        </div>
        <FieldError id="regulatory-error">{errorFor("regulatory")}</FieldError>
      </Field>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Group 3 — Optional details (rendered inside a collapsible disclosure by
// project-form.tsx; every field here is non-mandatory). Renders its own
// two-column grid (no FormSection heading — the disclosure summary titles it).
// ---------------------------------------------------------------------------

export function OptionalDetailsFields({
  draft,
  setDraft,
  errorFor,
  markTouched,
  lang,
}: ProjectFieldsProps) {
  const toggleIdentityType = (type: IdentityType) =>
    setDraft((p) => ({
      ...p,
      identityTypes: p.identityTypes.includes(type)
        ? p.identityTypes.filter((x) => x !== type)
        : [...p.identityTypes, type],
    }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field lang={lang} label={t(lang,"projectDescription")} className="sm:col-span-2">
        <textarea
          rows={2}
          value={draft.description}
          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field lang={lang} label={t(lang,"projectSponsor")}>
        <input
          type="text"
          value={draft.sponsor}
          onChange={(e) => setDraft((p) => ({ ...p, sponsor: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field lang={lang} label={t(lang,"projectPlatform")}>
        <input
          type="text"
          value={draft.platform}
          onChange={(e) => setDraft((p) => ({ ...p, platform: e.target.value }))}
          className={inputClass}
        />
      </Field>

      {/* `group`: checkbox grid, same shape as Regulatory above. */}
      <Field lang={lang} label={t(lang,"projectIdentityTypes")} className="sm:col-span-2" group>
        <div className="flex flex-wrap gap-3">
          {IDENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.identityTypes.includes(type)}
                onChange={() => toggleIdentityType(type)}
                className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green dark:border-line dark:bg-surface-muted"
              />
              {type}
            </label>
          ))}
        </div>
      </Field>

      <Field lang={lang} label={t(lang,"projectIdentityCount")} tooltip={t(lang, "tipIdentityCount")}>
        {/* Only the predefined steps are accepted — no free entry, no by-1 stepper. */}
        <select
          value={draft.identityCount}
          onChange={(e) => setDraft((p) => ({ ...p, identityCount: e.target.value }))}
          className={inputClass}
        >
          <option value="">—</option>
          {IDENTITY_COUNT_STEPS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString("en-US")}
            </option>
          ))}
        </select>
      </Field>

      <Field lang={lang} label={t(lang,"projectEndDate")} tooltip={t(lang, "tipEndDate")}>
        <input
          type="date"
          value={draft.endDate}
          onChange={(e) => setDraft((p) => ({ ...p, endDate: e.target.value }))}
          onBlur={() => markTouched("endDate")}
          aria-invalid={errorFor("endDate") ? true : undefined}
          aria-describedby={errorFor("endDate") ? "endDate-error" : undefined}
          className={inputClass}
        />
        <FieldError id="endDate-error">{errorFor("endDate")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectQuotes")} className="sm:col-span-2">
        <textarea
          rows={2}
          value={draft.quotes}
          onChange={(e) => setDraft((p) => ({ ...p, quotes: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field lang={lang} label={t(lang,"projectLinkSalesforce")}>
        <input
          type="url"
          value={draft.salesforceUrl}
          title={t(lang, "projectSalesforceTip")}
          onChange={(e) => setDraft((p) => ({ ...p, salesforceUrl: e.target.value }))}
          onBlur={() => markTouched("salesforceUrl")}
          aria-invalid={errorFor("salesforceUrl") ? true : undefined}
          aria-describedby={errorFor("salesforceUrl") ? "salesforceUrl-error" : undefined}
          className={inputClass}
        />
        <FieldError id="salesforceUrl-error">{errorFor("salesforceUrl")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectLinkSharepoint")}>
        <input
          type="url"
          value={draft.sharepointUrl}
          title={t(lang, "projectSharepointTip")}
          onChange={(e) => setDraft((p) => ({ ...p, sharepointUrl: e.target.value }))}
          onBlur={() => markTouched("sharepointUrl")}
          aria-invalid={errorFor("sharepointUrl") ? true : undefined}
          aria-describedby={errorFor("sharepointUrl") ? "sharepointUrl-error" : undefined}
          className={inputClass}
        />
        <FieldError id="sharepointUrl-error">{errorFor("sharepointUrl")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectLinkConfluence")}>
        <input
          type="url"
          value={draft.confluenceUrl}
          title={t(lang, "projectConfluenceTip")}
          onChange={(e) => setDraft((p) => ({ ...p, confluenceUrl: e.target.value }))}
          onBlur={() => markTouched("confluenceUrl")}
          aria-invalid={errorFor("confluenceUrl") ? true : undefined}
          aria-describedby={errorFor("confluenceUrl") ? "confluenceUrl-error" : undefined}
          className={inputClass}
        />
        <FieldError id="confluenceUrl-error">{errorFor("confluenceUrl")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang,"projectLinkJira")}>
        <input
          type="url"
          value={draft.jiraUrl}
          title={t(lang, "projectJiraTip")}
          onChange={(e) => setDraft((p) => ({ ...p, jiraUrl: e.target.value }))}
          onBlur={() => markTouched("jiraUrl")}
          aria-invalid={errorFor("jiraUrl") ? true : undefined}
          aria-describedby={errorFor("jiraUrl") ? "jiraUrl-error" : undefined}
          className={inputClass}
        />
        <FieldError id="jiraUrl-error">{errorFor("jiraUrl")}</FieldError>
      </Field>

      <Field lang={lang} label={t(lang, "projectOperatingTimezone")}>
        <select
          aria-label={t(lang, "projectOperatingTimezone")}
          value={draft.operatingTimezone}
          onChange={(e) => setDraft((p) => ({ ...p, operatingTimezone: e.target.value }))}
          className={inputClass}
        >
          <option value="">—</option>
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>

      <Field lang={lang} label={t(lang, "projectStakeholderCount")} tooltip={t(lang, "tipStakeholderCount")}>
        <input
          type="number"
          min={0}
          step={1}
          value={draft.stakeholderCount}
          onChange={(e) => setDraft((p) => ({ ...p, stakeholderCount: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field lang={lang} label={t(lang,"projectDocRepo")} className="sm:col-span-2">
        <input
          type="text"
          value={draft.docRepoLocation}
          onChange={(e) => setDraft((p) => ({ ...p, docRepoLocation: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field lang={lang} label={t(lang,"documents")} className="sm:col-span-2" group>
        <KnowledgeLinksFieldGated
          value={draft.knowledgeLinks}
          onChange={(knowledgeLinks) => setDraft((p) => ({ ...p, knowledgeLinks }))}
          lang={lang}
        />
      </Field>

      <Field lang={lang} label={t(lang,"projectNotes")} className="sm:col-span-2">
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
          className={inputClass}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contact persons control
// ---------------------------------------------------------------------------

function ContactPersonsControl({
  lang,
  contactPersons,
  addressBook,
  resources,
  onChange,
  required,
  error,
}: {
  lang: Lang;
  contactPersons: ContactPerson[];
  addressBook: Contact[];
  resources: readonly Resource[];
  onChange: (next: ContactPerson[]) => void;
  required?: boolean;
  error?: string | null;
}) {
  const [draft, setDraft] = useState<{ name: string; email: string; resourceId: number | null }>(
    { name: "", email: "", resourceId: null },
  );

  const hasName = (name: string) =>
    contactPersons.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const addDraft = () => {
    const name = draft.name.trim();
    if (!name || hasName(name)) return;
    const synced = draft.resourceId != null || addressBook.some((c) => c.name === name);
    onChange([
      ...contactPersons,
      draft.resourceId != null
        ? { name, email: draft.email.trim(), synced, resourceId: draft.resourceId }
        : { name, email: draft.email.trim(), synced },
    ]);
    setDraft({ name: "", email: "", resourceId: null });
  };

  return (
    <div>
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "projectContactPersons")}
        {required && <span className="text-ui-pink-strong">*</span>}
        <InfoTooltip text={t(lang, "contactPersonsTip")} />
      </span>

      {contactPersons.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {contactPersons.map((cp) => (
            <li
              key={cp.name}
              className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground"
            >
              <span className="flex items-center gap-1.5">
                {cp.resourceId != null && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ui-green" title={t(lang, "resourcePickerLinked")} />
                )}
                <span>{cp.name}{cp.email ? ` <${cp.email}>` : ""}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(contactPersons.filter((c) => c.name !== cp.name))}
                aria-label={`${t(lang, "remove")} ${cp.name}`}
                title={`${t(lang, "remove")} ${cp.name}`}
                className="rounded-full px-1 text-muted-foreground hover:text-ui-pink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add a contact: link-only ResourcePicker (registry resources + address
          book as suggestions; no "+ Add as resource" row — project contacts are
          often external clients/vendors). */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <ResourcePicker
            lang={lang}
            value={draft}
            resources={resources}
            contacts={addressBook}
            onChange={(next) => setDraft({ name: next.name, email: next.email, resourceId: next.resourceId })}
            placeholder={t(lang, "contactAddManual")}
            aria-label={t(lang, "contactAddManual")}
          />
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="email"
            value={draft.email}
            placeholder={t(lang, "email")}
            aria-label={`${t(lang, "contactAddManual")} — ${t(lang, "email")}`}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            className={inputClass}
          />
        </div>
        <button
          type="button"
          onClick={addDraft}
          className="shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
        >
          {t(lang, "add")}
        </button>
      </div>

      <FieldError id="contactPersons-error">{error}</FieldError>
    </div>
  );
}
