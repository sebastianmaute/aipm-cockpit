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

import { useId, useState } from "react";
import type React from "react";
import { FieldError } from "./field-feedback";
import { t, type Lang } from "./i18n";
import {
  IDENTITY_TYPES,
  DEPLOYMENTS,
  REGULATORY_REQUIREMENTS,
  REGULATORY_NOT_APPLICABLE,
} from "./project-options";
import { NACE_SECTIONS } from "./nace-sections";
import { type ProjectDraft, type ProjectErrorField } from "./project-validation";
import { StakeholderRecipientInput } from "./stakeholder-recipient-input";
import { type Contact } from "./contacts";
import {
  type ContactPerson,
  type Deployment,
  type IdentityType,
  type RegulatoryRequirement,
} from "./types";

// The form's in-progress draft. A SUPERSET of `ProjectDraft` (the shape
// project-validation.ts validates): all of ProjectDraft's fields plus the
// optional ProjectMeta fields the form also edits. Being a structural superset,
// a ProjectFormDraft passes anywhere a ProjectDraft is expected. `identityCount`
// stays a STRING here (raw number-input value); sanitizeProjectMeta coerces it.
export type ProjectFormDraft = ProjectDraft & {
  description: string;
  sponsor: string;
  identityCount: string;
  platform: string;
  quotes: string;
  docRepoLocation: string;
  notes: string;
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
    contactPersons: [],
    docRepoLocation: "",
    regulatory: [],
    notes: "",
  };
}

// Same compact input class the task form uses (declared locally to avoid a
// cross-form import).
export const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green dark:border-line dark:bg-surface dark:text-foreground";

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
      <h3 className="mb-3 border-b border-line pb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

// Field wrapper with label + required-asterisk convention (same as task form).
export function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-AIPM-pink">*</span>}
      </span>
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
  stakeholderNames,
}: ProjectFieldsProps) {
  return (
    <FormSection title={`${t(lang, "projectFormIdentity")} · ${t(lang, "projectFormPeople")}`}>
      <Field label={t(lang, "projectName")} required>
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

      <Field label={t(lang, "projectCode")} required>
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

      <Field label={t(lang, "projectDescription")} className="sm:col-span-2">
        <textarea
          rows={2}
          value={draft.description}
          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang, "projectSponsor")}>
        <input
          type="text"
          value={draft.sponsor}
          onChange={(e) => setDraft((p) => ({ ...p, sponsor: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang, "projectManager")} required>
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

      <div className="sm:col-span-2">
        <StakeholderRecipientInput
          id="keyStakeholdersInternal"
          label={`${t(lang, "projectStakeholdersInternal")} *`}
          value={draft.keyStakeholdersInternal}
          suggestions={stakeholderNames}
          onChange={(next) => {
            setDraft((p) => ({ ...p, keyStakeholdersInternal: next }));
            markTouched("keyStakeholdersInternal");
          }}
        />
        <FieldError id="keyStakeholdersInternal-error">
          {errorFor("keyStakeholdersInternal")}
        </FieldError>
      </div>

      <div className="sm:col-span-2">
        <StakeholderRecipientInput
          id="keyStakeholdersExternal"
          label={`${t(lang, "projectStakeholdersExternal")} *`}
          value={draft.keyStakeholdersExternal}
          suggestions={stakeholderNames}
          onChange={(next) => {
            setDraft((p) => ({ ...p, keyStakeholdersExternal: next }));
            markTouched("keyStakeholdersExternal");
          }}
        />
        <FieldError id="keyStakeholdersExternal-error">
          {errorFor("keyStakeholdersExternal")}
        </FieldError>
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
  addressBook,
}: ProjectFieldsProps) {
  const toggleIdentityType = (type: IdentityType) =>
    setDraft((p) => ({
      ...p,
      identityTypes: p.identityTypes.includes(type)
        ? p.identityTypes.filter((x) => x !== type)
        : [...p.identityTypes, type],
    }));

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
      <Field label={t(lang, "projectCustomer")} required>
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

      <Field label={t(lang, "projectNaceSection")} required>
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

      <Field label={t(lang, "projectIdentityTypes")} className="sm:col-span-2">
        <div className="flex flex-wrap gap-3">
          {IDENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.identityTypes.includes(type)}
                onChange={() => toggleIdentityType(type)}
                className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green dark:border-line dark:bg-surface-muted"
              />
              {type}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t(lang, "projectIdentityCount")}>
        <input
          type="number"
          min={0}
          value={draft.identityCount}
          onChange={(e) => setDraft((p) => ({ ...p, identityCount: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang, "projectProducts")} required>
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

      <Field label={t(lang, "projectPlatform")}>
        <input
          type="text"
          value={draft.platform}
          onChange={(e) => setDraft((p) => ({ ...p, platform: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang, "projectDeployment")} required>
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

      <Field label={t(lang, "projectStartDate")} required>
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

      <Field label={t(lang, "projectEndDate")} required>
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

      <Field label={t(lang, "projectProfitCenter")} required>
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

      <Field label={t(lang, "projectQuotes")} className="sm:col-span-2">
        <textarea
          rows={2}
          value={draft.quotes}
          onChange={(e) => setDraft((p) => ({ ...p, quotes: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang, "projectSalesforce")}>
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

      <Field label={t(lang, "projectSharepoint")}>
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

      <Field label={t(lang, "projectConfluence")}>
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

      <div className="sm:col-span-2">
        <ContactPersonsControl
          lang={lang}
          contactPersons={draft.contactPersons}
          addressBook={addressBook}
          onChange={(next) => setDraft((p) => ({ ...p, contactPersons: next }))}
        />
      </div>

      <Field label={t(lang, "projectDocRepo")} className="sm:col-span-2">
        <input
          type="text"
          value={draft.docRepoLocation}
          onChange={(e) => setDraft((p) => ({ ...p, docRepoLocation: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang, "projectRegulatory")} required className="sm:col-span-2">
        <div className="flex flex-col gap-2">
          {REGULATORY_REQUIREMENTS.map((req) => (
            <label key={req} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.regulatory.includes(req)}
                onChange={() => toggleRegulatory(req)}
                className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green dark:border-line dark:bg-surface-muted"
              />
              {req}
            </label>
          ))}
        </div>
        <FieldError id="regulatory-error">{errorFor("regulatory")}</FieldError>
      </Field>

      <Field label={t(lang, "projectNotes")} className="sm:col-span-2">
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
          className={inputClass}
        />
      </Field>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Contact persons control
// ---------------------------------------------------------------------------

function ContactPersonsControl({
  lang,
  contactPersons,
  addressBook,
  onChange,
}: {
  lang: Lang;
  contactPersons: ContactPerson[];
  addressBook: Contact[];
  onChange: (next: ContactPerson[]) => void;
}) {
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [bookSel, setBookSel] = useState("");
  const nameId = useId();
  const emailId = useId();

  const hasName = (name: string) =>
    contactPersons.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const addFromBook = (name: string) => {
    const found = addressBook.find((c) => c.name === name);
    if (!found || hasName(found.name)) {
      setBookSel("");
      return;
    }
    onChange([...contactPersons, { name: found.name, email: found.email, synced: true }]);
    setBookSel("");
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name || hasName(name)) return;
    onChange([...contactPersons, { name, email: manualEmail.trim(), synced: false }]);
    setManualName("");
    setManualEmail("");
  };

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-foreground">
        {t(lang, "projectContactPersons")}
      </span>

      {contactPersons.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {contactPersons.map((cp) => (
            <li
              key={cp.name}
              className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground"
            >
              <span>
                {cp.name}
                {cp.email ? ` <${cp.email}>` : ""}
              </span>
              <button
                type="button"
                onClick={() => onChange(contactPersons.filter((c) => c.name !== cp.name))}
                aria-label={`${t(lang, "remove")} ${cp.name}`}
                className="rounded-full px-1 text-muted-foreground hover:text-AIPM-pink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add from address book */}
      {addressBook.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <select
            aria-label={t(lang, "contactAddFromBook")}
            value={bookSel}
            onChange={(e) => addFromBook(e.target.value)}
            className={inputClass}
          >
            <option value="">{t(lang, "contactAddFromBook")}</option>
            {addressBook.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
                {c.email ? ` <${c.email}>` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Add manually */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <input
            id={nameId}
            type="text"
            value={manualName}
            placeholder={t(lang, "contactAddManual")}
            aria-label={`${t(lang, "contactAddManual")} — name`}
            onChange={(e) => setManualName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="min-w-0 flex-1">
          <input
            id={emailId}
            type="email"
            value={manualEmail}
            placeholder="email"
            aria-label={`${t(lang, "contactAddManual")} — email`}
            onChange={(e) => setManualEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="button"
          onClick={addManual}
          className="shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
        >
          {t(lang, "add")}
        </button>
      </div>
    </div>
  );
}
