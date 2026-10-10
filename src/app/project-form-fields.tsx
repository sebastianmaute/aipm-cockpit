"use client";

// Presentational field groups for the shared project create/edit form.
//
// All state lives in the container (project-form.tsx); this module is pure
// layout + controlled inputs. Two visually separated groups:
//   1. Identity + People
//   2. Customer
//
// Inline per-field errors are passed in already-resolved (string | null) so this
// module needs no validation logic of its own. Brand palette only — no shadows or
// gradients.

import { useId, useState } from "react";
import type React from "react";
import { FieldError } from "./field-feedback";
import { fieldClass, Checkbox } from "./form-controls";
import { Field } from "./form-field";
import { IconButton } from "./icon-button";
import { Button } from "./button";
import { PencilIcon } from "./icons";
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
import { sanitizeLoadedEmail } from "./sanitize";
import { editorEmailRefusalMessage, linkedResourceEmail } from "./editor-email-rule";
import { ResourcePicker } from "./resource-picker";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { type Contact } from "./contacts";
import { contactDisplay } from "./contact-display";
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
// heading uses the dark-blue token and a bottom divider (mirrors the task
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
      <Field label={t(lang,"projectName")} required hint={t(lang, "tipProjectName")}>
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

      <Field label={t(lang,"projectCode")} hint={t(lang, "tipProjectCode")}>
        <input
          type="text"
          value={draft.code}
          onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectManager")} hint={t(lang, "tipProjectManager")}>
        <input
          type="text"
          value={draft.projectManager}
          onChange={(e) => setDraft((p) => ({ ...p, projectManager: e.target.value }))}
          className={inputClass}
        />
      </Field>

      {/* Contacts are optional (O-1). Consumes registry resources + the address
          book via the link-only ResourcePicker. */}
      <div className="sm:col-span-2">
        <ContactPersonsControl
          lang={lang}
          contactPersons={draft.contactPersons}
          addressBook={addressBook}
          resources={resources}
          onChange={(next) => {
            setDraft((p) => ({ ...p, contactPersons: next }));
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
  lang,
}: ProjectFieldsProps) {
  // Regulatory checkbox group with an EXCLUSIVE "Not applicable":
  //  - selecting "Not applicable" clears everything else,
  //  - selecting any other requirement clears "Not applicable".
  const toggleRegulatory = (req: RegulatoryRequirement) => {
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
      <Field label={t(lang,"projectCustomer")} hint={t(lang, "tipCustomer")}>
        <input
          type="text"
          value={draft.customer}
          onChange={(e) => setDraft((p) => ({ ...p, customer: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectNaceSection")} hint={t(lang, "tipNace")}>
        <select
          value={draft.naceSection}
          onChange={(e) => setDraft((p) => ({ ...p, naceSection: e.target.value }))}
          className={inputClass}
        >
          <option value="">—</option>
          {NACE_SECTIONS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.title}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t(lang,"projectProducts")} hint={t(lang, "tipProducts")}>
        <input
          type="text"
          value={draft.products}
          onChange={(e) => setDraft((p) => ({ ...p, products: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectDeployment")} hint={t(lang, "tipDeployment")}>
        <select
          value={draft.deployment}
          onChange={(e) => setDraft((p) => ({ ...p, deployment: e.target.value as Deployment | "" }))}
          className={inputClass}
        >
          <option value="">—</option>
          {DEPLOYMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t(lang,"projectStartDate")} hint={t(lang, "tipStartDate")}>
        <input
          type="date"
          value={draft.startDate}
          onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectProfitCenter")} hint={t(lang, "tipProfitCenter")}>
        <input
          type="text"
          value={draft.profitCenter}
          onChange={(e) => setDraft((p) => ({ ...p, profitCenter: e.target.value }))}
          className={inputClass}
        />
      </Field>

      {/* `group`: a grid of checkboxes, each in its own `<label>`. A plain
          caption would adopt the FIRST checkbox — clicking "Regulatory
          requirements" ticked it — and would nest a label inside a label. */}
      <Field label={t(lang,"projectRegulatory")} className="sm:col-span-2" hint={t(lang, "tipRegulatory")} group>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {REGULATORY_REQUIREMENTS.map((req) => (
            <label key={req} className="flex items-center gap-1.5 text-sm text-foreground">
              <Checkbox
                checked={draft.regulatory.includes(req)}
                onChange={() => toggleRegulatory(req)}
              />
              {req}
            </label>
          ))}
        </div>
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
      <Field label={t(lang,"projectDescription")} className="sm:col-span-2">
        <textarea
          rows={2}
          value={draft.description}
          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectSponsor")}>
        <input
          type="text"
          value={draft.sponsor}
          onChange={(e) => setDraft((p) => ({ ...p, sponsor: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectPlatform")}>
        <input
          type="text"
          value={draft.platform}
          onChange={(e) => setDraft((p) => ({ ...p, platform: e.target.value }))}
          className={inputClass}
        />
      </Field>

      {/* `group`: checkbox grid, same shape as Regulatory above. */}
      <Field label={t(lang,"projectIdentityTypes")} className="sm:col-span-2" group>
        <div className="flex flex-wrap gap-3">
          {IDENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm text-foreground">
              <Checkbox
                checked={draft.identityTypes.includes(type)}
                onChange={() => toggleIdentityType(type)}
              />
              {type}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t(lang,"projectIdentityCount")} hint={t(lang, "tipIdentityCount")}>
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

      <Field label={t(lang,"projectEndDate")} hint={t(lang, "tipEndDate")}>
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

      <Field label={t(lang,"projectQuotes")} className="sm:col-span-2">
        <textarea
          rows={2}
          value={draft.quotes}
          onChange={(e) => setDraft((p) => ({ ...p, quotes: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectLinkSalesforce")}>
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

      <Field label={t(lang,"projectLinkSharepoint")}>
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

      <Field label={t(lang,"projectLinkConfluence")}>
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

      <Field label={t(lang,"projectLinkJira")}>
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

      <Field label={t(lang, "projectOperatingTimezone")}>
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

      <Field label={t(lang, "projectStakeholderCount")} hint={t(lang, "tipStakeholderCount")}>
        <input
          type="number"
          min={0}
          step={1}
          value={draft.stakeholderCount}
          onChange={(e) => setDraft((p) => ({ ...p, stakeholderCount: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"projectDocRepo")} className="sm:col-span-2">
        <input
          type="text"
          value={draft.docRepoLocation}
          onChange={(e) => setDraft((p) => ({ ...p, docRepoLocation: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <Field label={t(lang,"documents")} className="sm:col-span-2" group>
        <KnowledgeLinksFieldGated
          value={draft.knowledgeLinks}
          onChange={(knowledgeLinks) => setDraft((p) => ({ ...p, knowledgeLinks }))}
          lang={lang}
        />
      </Field>

      <Field label={t(lang,"projectNotes")} className="sm:col-span-2">
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
}: {
  lang: Lang;
  contactPersons: ContactPerson[];
  addressBook: Contact[];
  resources: readonly Resource[];
  onChange: (next: ContactPerson[]) => void;
}) {
  const [draft, setDraft] = useState<{ name: string; email: string; resourceId: number | null }>(
    { name: "", email: "", resourceId: null },
  );
  const [emailError, setEmailError] = useState<string | null>(null);
  const emailErrorId = useId();
  // §537 — the contact being edited in place, by id, with its working copy.
  const [editing, setEditing] = useState<{ id: number; name: string; email: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editErrorId = useId();

  /** `exceptId` lets an in-place edit keep its own name (§537). */
  const hasName = (name: string, exceptId?: number) =>
    contactPersons.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase());

  // ★★★ A CONTACT'S IDENTITY IS ITS ID (§537) — it was its POSITION until ids
  // existed, and NEVER its NAME. Removal used to
  // filter on `c.name !== cp.name`, so two contacts sharing a name meant either
  // ✕ deleted BOTH — silent data loss, and a nicer button label would only have
  // hidden it. The same mistake sat in the list `key`. Duplicates are reachable
  // in two ways: `hasName` trims but does not COLLAPSE internal whitespace runs
  // (which accessible-name computation does), so "Bob  Jones" adds happily
  // beside "Bob Jones"; and `sanitizeProjectMeta` does not dedupe an imported
  // project, so exact repeats arrive from a file.
  /** ★★★ THE EMAIL JOINS THE TOKEN ONLY FOR A NAME THAT ACTUALLY REPEATS, and
   *  the conditional is the whole point. Two "Bob Jones" rows with different
   *  addresses are visually distinct but would announce as "Remove – Bob Jones
   *  (1)" / "(2)", leaving an AT user to guess which ✕ they were on; the address
   *  is a discriminator already on screen, so the colliding subset uses it and
   *  drops the index entirely.
   *  ★★ Spending it UNCONDITIONALLY was the first cut and was wrong for the same
   *  reason `row-tokens.ts` rejects ids: a cost paid on every control, by exactly
   *  the users 2.4.6 protects, for a discriminator almost no row needs. On the
   *  repo's own sample project — two contacts, no collision — it more than
   *  doubled every remove label. Number the colliding rows, leave the rest
   *  bare — the same principle `buildRowTokens` itself applies.
   *  ★★ The benefit is IMPORT-ONLY: `addDraft` rejects a duplicate via `hasName`,
   *  which compares names alone, so the product cannot create this pair. It
   *  arrives from a file, because `sanitizeProjectMeta` does not dedupe.
   *  ★★ Counting mirrors `hasName` (trim + case-fold), and `buildRowTokens`
   *  folds whitespace runs AND case in its collision key since §669 review 5, so
   *  the two now agree: a "Bob"/"bob" pair whose displayed strings fold equal is
   *  numbered, as well as taking the address path. (Before that review the token
   *  missed case, and a "Bob"/"bob" pair with equal emails was spoken alike; only
   *  an import could reach it.)
   *  ★ The 2.5.3 claim an earlier revision made here was wrong: 2.5.3 governs a
   *  control's name against its OWN label, and the rendered name is a SIBLING
   *  `<span>`. This button's only visible content is the glyph "×" (U+00D7) — an
   *  icon, not text for the name to have to contain. ★★ NOT because axe curates
   *  it: measured, `removeUnicode("×", {punctuations: true})` returns it
   *  UNCHANGED (U+00D7 is a math symbol), and the rule is `experimental` so
   *  `tagExclude` drops it regardless. A third revision of this paragraph. */
  const contactNameCounts = new Map<string, number>();
  for (const cp of contactPersons) {
    const key = cp.name.trim().toLowerCase();
    contactNameCounts.set(key, (contactNameCounts.get(key) ?? 0) + 1);
  }
  const contactTokens = buildRowTokens(
    contactPersons.map((cp) => ({
      id: cp.id,
      name: (contactNameCounts.get(cp.name.trim().toLowerCase()) ?? 0) > 1 ? contactDisplay(cp) : cp.name,
    })),
  );

  const addDraft = () => {
    const name = draft.name.trim();
    if (!name || hasName(name)) return;
    // Judge (and store) the value that would be STORED: `sanitizeContactPerson`
    // stores `sanitizeLoadedEmail` (unwrap `Name <addr>`, then trim + EMAIL_MAX)
    // — the same treatment every other editor's email field gets (fix round 2
    // ruling; unwrapped since M-C4). A TYPED unsafe email refuses the add; a
    // copy of the picked person's stored email is exempt (spec Part 1,
    // decision 1 + Part 7 ruling).
    const cappedEmail = sanitizeLoadedEmail(draft.email);
    const copySources = [
      linkedResourceEmail(resources, draft.resourceId),
      addressBook.find((c) => c.name === name)?.email,
    ];
    const refusal = editorEmailRefusalMessage(lang, cappedEmail, undefined, copySources);
    if (refusal) {
      setEmailError(refusal);
      return;
    }
    setEmailError(null);
    const synced = draft.resourceId != null || addressBook.some((c) => c.name === name);
    // §537 — the next id above the list's maximum, the same rule the load
    // funnel's `withContactPersonIds` mints with.
    const id = contactPersons.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    onChange([
      ...contactPersons,
      draft.resourceId != null
        ? { id, name, email: cappedEmail, synced, resourceId: draft.resourceId }
        : { id, name, email: cappedEmail, synced },
    ]);
    setDraft({ name: "", email: "", resourceId: null });
  };

  return (
    <div>
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "projectContactPersons")}
        <InfoTooltip text={t(lang, "contactPersonsTip")} />
      </span>

      {contactPersons.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {contactPersons.map((cp) =>
            editing !== null && editing.id === cp.id ? (
              // §537 — in-place edit. Correcting a contact used to mean remove +
              // re-add. Name and email are edited; the resource link and the
              // synced flag are kept, and the email passes the SAME write rule
              // the add path uses, with this contact's stored address exempt.
              <li key={cp.id} className="flex flex-wrap items-start gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                <input
                  type="text"
                  aria-label={rowLabel(t(lang, "name"), contactTokens.get(cp.id) ?? cp.name)}
                  value={editing.name}
                  onChange={(e) => { setEditing({ ...editing, name: e.target.value }); setEditError(null); }}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <input
                  type="email"
                  aria-label={rowLabel(t(lang, "email"), contactTokens.get(cp.id) ?? cp.name)}
                  aria-invalid={editError ? true : undefined}
                  aria-describedby={editError ? editErrorId : undefined}
                  value={editing.email}
                  onChange={(e) => { setEditing({ ...editing, email: e.target.value }); setEditError(null); }}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const name = editing.name.trim();
                    if (!name || hasName(name, cp.id)) return;
                    const email = sanitizeLoadedEmail(editing.email);
                    const refusal = editorEmailRefusalMessage(lang, email, cp.email, [linkedResourceEmail(resources, cp.resourceId ?? null)]);
                    if (refusal) { setEditError(refusal); return; }
                    onChange(contactPersons.map((c) => (c.id === cp.id ? { ...c, name, email } : c)));
                    setEditing(null);
                    setEditError(null);
                  }}
                >
                  {t(lang, "contactEditSave")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setEditError(null); }}>
                  {t(lang, "cancel")}
                </Button>
                {editError && (
                  <p id={editErrorId} role="alert" className="w-full text-xs text-ui-pink-strong">{editError}</p>
                )}
              </li>
            ) : (
            <li
              key={cp.id}
              className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground"
            >
              <span className="flex items-center gap-1.5">
                {cp.resourceId != null && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ui-green" title={t(lang, "resourcePickerLinked")} />
                )}
                <span>{contactDisplay(cp)}</span>
              </span>
              <span className="flex items-center gap-1">
                <IconButton
                  onClick={() => { setEditing({ id: cp.id, name: cp.name, email: cp.email }); setEditError(null); }}
                  label={rowLabel(t(lang, "edit"), contactTokens.get(cp.id) ?? cp.name)}
                  title={rowLabel(t(lang, "edit"), contactTokens.get(cp.id) ?? cp.name)}
                >
                  <PencilIcon aria-hidden="true" className="h-3.5 w-3.5" />
                </IconButton>
                {/* ★ The name is ROW-UNIQUE (rowLabel over contactTokens) and is
                    threaded through `label` byte-for-byte. Two contacts can share
                    a display name, and no gate would report a collision here —
                    axe has no rule that flags two controls sharing an accessible
                    name, in any view at any seed size. */}
                <IconButton
                  onClick={() => onChange(contactPersons.filter((c) => c.id !== cp.id))}
                  label={rowLabel(t(lang, "remove"), contactTokens.get(cp.id) ?? cp.name)}
                  title={rowLabel(t(lang, "remove"), contactTokens.get(cp.id) ?? cp.name)}
                  variant="danger"
                >
                  ×
                </IconButton>
              </span>
            </li>
            ),
          )}
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
            onChange={(next) => {
              setDraft({ name: next.name, email: next.email, resourceId: next.resourceId });
              setEmailError(null);
            }}
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
            onChange={(e) => {
              setDraft((d) => ({ ...d, email: e.target.value }));
              setEmailError(null);
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? emailErrorId : undefined}
            className={inputClass}
          />
          <FieldError id={emailErrorId}>{emailError}</FieldError>
        </div>
        <Button variant="secondary" size="md"
          onClick={addDraft}
          className="shrink-0"
        >
          {t(lang, "add")}
        </Button>
      </div>
    </div>
  );
}
