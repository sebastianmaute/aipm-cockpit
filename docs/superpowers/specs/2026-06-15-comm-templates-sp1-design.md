# Communication Templates — SP1: Model, Storage, Categories, Send-Wiring — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** new `comm-templates*`, `html-to-text`, `use-comm-templates`; Settings rail; send sites (`use-task-row-handlers.ts`, `task-manager.tsx`)

---

## Goal

Let users author, store, and default named **communication templates** (one per send use-case),
and have the existing "send inquiry" / "draft stakeholder message" flows **auto-use the category's
default template**. Turso-only. SP1 is the foundation: data model + Turso storage + fixed
categories + named merge-fields + default-per-category + send-wiring + a basic settings pane
(plain `<textarea>` body). End-to-end usable without the rich editor.

This is **SP1 of a 4-part roadmap** (the whole "editable HTML comms templates with versioning"
feature). Later SPs — explicitly OUT of scope here:
- **SP2:** Tiptap rich-text HTML editor + DOMPurify sanitization (replaces the textarea).
- **SP3:** template version history (named versions, compare, restore) — reuse the version-* pattern.
- **SP5 (optional):** real HTML email send via M365 Graph (vs the plain-text mailto here).

## Decisions taken during brainstorming

1. **Send mechanism stays `mailto:` (plain-text).** HTML is authoring-only; on send the template
   body is rendered HTML → plain text for the mailto body. Real HTML send (Graph) is deferred (SP5).
2. **Shared library, cross-project.** Templates are NOT project-scoped — authored once, visible in
   every project. Stored in a global Turso table.
3. **Fixed categories**, one per send use-case, each with a static merge-field registry. No
   user-defined categories.
4. **Body stored as HTML** from SP1 (so SP2's rich editor needs no migration); SP1 edits it via a
   plain `<textarea>`.
5. **Turso-only system, but send still works for everyone:** no Turso / no template → fall back to
   the existing i18n body template (current behaviour unchanged for non-Turso users).

---

## Data model

```ts
// comm-templates.ts (pure — no React, no Turso, no i18n side effects)
export type CommTemplateCategory = "status-inquiry" | "stakeholder-update";

export interface CommTemplate {
  id: string;                  // client-generated (e.g. crypto-free: `${category}-${counter}`/ISO ts)
  category: CommTemplateCategory;
  name: string;
  body: string;                // HTML
  isDefault: boolean;
  createdAt: string;           // ISO
  updatedAt: string;           // ISO
}

/** Static per-category merge-field registry: the tokens a template in this
 *  category may use, each with an i18n label key for the palette. */
export const CATEGORY_FIELDS: Record<CommTemplateCategory, readonly string[]> = {
  "status-inquiry": ["taskId", "taskName", "dueDate", "lastUpdate", "assignee"],
  "stakeholder-update": ["stakeholderName", "projectName"],
};

export const COMM_TEMPLATE_CATEGORIES: readonly CommTemplateCategory[] =
  ["status-inquiry", "stakeholder-update"];
```

### Interpolation + html→text (pure)

```ts
// renderTemplate: replace {{field}} for fields in the category registry; HTML-escape
// the inserted value (body is HTML); leave unknown {{x}} literal (typos stay visible).
export function renderTemplate(
  body: string,
  category: CommTemplateCategory,
  vars: Readonly<Record<string, string>>,
): string;

// html-to-text.ts — basic, dependency-free: <br>/<p>/<div>/</li> → newline, strip
// remaining tags, decode the common entities (&amp; &lt; &gt; &quot; &#39; &nbsp;),
// collapse 3+ blank lines. Good enough for SP1 bodies; SP2 may harden.
export function htmlToPlainText(html: string): string;
```

### Per-category var builders (pure)

```ts
// Built from the existing send-site data.
buildStatusInquiryVars(task: Task, lang: Lang): Record<string,string>
  // taskId=String(id), taskName, dueDate, lastUpdate=lastUpdateDate, assignee=greetingName(assignee)||assignee
buildStakeholderUpdateVars(sh: Stakeholder, projectName: string): Record<string,string>
  // stakeholderName=sh.name, projectName
```

### Default-management invariant

Exactly one `isDefault` per category. A pure helper computes the next list when setting a default:
```ts
export function withDefault(list: readonly CommTemplate[], id: string): CommTemplate[];
// maps category-siblings: isDefault = (t.id === id); other categories untouched
```

## Storage (Turso-only, global)

- New module `comm-templates-store.ts` mirroring `snapshot-store.ts` / `version-store.ts`:
  `ensureTable()` DDL (`CREATE TABLE IF NOT EXISTS comm_templates (id TEXT PRIMARY KEY, category TEXT,
  name TEXT, body TEXT, is_default INTEGER, created_at TEXT, updated_at TEXT)`), then
  `listTemplates(config)`, `upsertTemplate(config, t)`, `deleteTemplate(config, id)`,
  `setDefaultTemplate(config, category, id)` (a single pipeline: clear is_default for the category,
  set it for `id`). Run via the same `runTursoPipeline` helper.
- ★ **Global, NOT project-scoped:** `comm_templates` has no `project_id`. In multi-tenant mode it
  lives in the shared DB (alongside `projects`), so templates are visible across projects.
- ★ **Out of `TABLE_NAMES`** (like `project_versions`): the workspace save/load select/replace
  pipeline must never touch `comm_templates`. No main `turso-schema` `SCHEMA_VERSION` bump — the
  store ensures its own table (the version-store precedent).

## Hook + send-wiring

```ts
// use-comm-templates.ts — Turso-gated load (mirrors useSnapshots' active/cfgRef pattern):
//   active = (storageConfig.kind==="turso" || portfolioMode==="turso") && tursoConfig!==null && !isPopout
// Returns: templates, busy, create/rename/save/remove/setDefault, and:
resolveTemplateBody(category): string | null   // the category's default template body, or null
```

- **Send sites consume `resolveTemplateBody`:**
  - `onSendInquiry` (use-task-row-handlers.ts): if `resolveTemplateBody("status-inquiry")` returns a
    body → `htmlToPlainText(renderTemplate(body, "status-inquiry", buildStatusInquiryVars(task,lang)))`
    becomes the mailto body; else the existing `emailBodyTemplate` i18n path (unchanged). Subject
    unchanged (`emailSubject`). Inject `resolveTemplateBody` as a new optional arg
    (`UseTaskRowHandlersArgs.resolveTemplateBody?`); undefined → always i18n fallback.
  - Comms draft (`handleDraftMessageFromAction` in task-manager.tsx, stakeholder-update branch):
    same pattern with `buildStakeholderUpdateVars` and the `commsEmailBodyTemplate` fallback.
- The surface (`task-manager.tsx`) instantiates `useCommTemplates()` and passes `resolveTemplateBody`
  into both send paths.

## Settings pane

- New Settings rail section **"Communication templates"** (label key `settingsSectionCommTemplates`),
  distinct from the existing project "Templates" section. **Turso-gated** — hidden from the rail
  when not on Turso (mirrors how Trends/History are gated; reuse the rail's gating mechanism).
- Component `settings-sections/comm-templates-section.tsx` (own pane):
  - A fixed-category selector (the `COMM_TEMPLATE_CATEGORIES`, translated).
  - The list of templates in the selected category (name + a "Default" badge).
  - Create / rename / delete; a `<textarea>` body editor; "Set as default" (calls `setDefault`,
    enforcing the one-per-category invariant); a **merge-field palette** — clickable chips for the
    category's `CATEGORY_FIELDS`, each inserting `{{field}}` at the cursor.
  - Empty state: a "create your first template" affordance (optionally seed a default from the
    current i18n template — nice-to-have, not required for SP1).
- i18n keys: section label, category labels, field labels, button labels, empty state.

## Error handling / edge cases

- Not on Turso → the section is hidden and `resolveTemplateBody` returns null everywhere → all sends
  use the i18n fallback (today's behaviour).
- Turso present but no template for a category → null → i18n fallback.
- A template with a typo'd `{{xyz}}` → left literal in the body (visible to the author on next edit).
- Merge value missing from the vars map → empty string for that token (registry fields are always
  built, so this is rare; defend anyway).
- Deleting the current default → the category simply has no default → send falls back to i18n until a
  new default is set.
- HTML body in SP1 is author-controlled (single-user local app); `renderTemplate` still HTML-escapes
  *interpolated values* to avoid breaking markup. (SP2 adds DOMPurify on the editor boundary.)

## Testing

- `comm-templates.test.ts`: `renderTemplate` (replaces known tokens, HTML-escapes values, leaves
  unknown tokens literal); `withDefault` (one-per-category, other categories untouched); the var
  builders (correct field map from a Task / Stakeholder).
- `html-to-text.test.ts`: `<br>`/`<p>`/`<div>` → newlines; tag strip; entity decode; blank-line
  collapse.
- `comm-templates-store.test.ts`: each CRUD op emits the expected Turso statements (mock the pipeline
  runner); `setDefaultTemplate` clears + sets in one pipeline; `comm_templates` is NOT in
  `TABLE_NAMES` (guard test).
- `use-comm-templates.test.tsx`: inactive (non-Turso) → empty + `resolveTemplateBody` null; active →
  loads; `resolveTemplateBody(category)` returns the default's body.
- Send fallback: `onSendInquiry` with a resolver returning a body uses the rendered template; with the
  resolver absent/null uses the i18n template (extend `use-task-row-handlers.test.ts`).
- `comm-templates-section.test.tsx`: create / rename / set-default / delete; merge-field chip inserts
  `{{field}}`; Turso-gated visibility.
- i18n EN/DE parity (tsc); a11y (the pane's controls labelled; axe gate).
- Full gate: tsc, lint, vitest, build, e2e axe.

## Out of scope (this SP)

- Rich-text editor + sanitizer (SP2); version history (SP3); Graph HTML send (SP5).
- Subject-line templating (body only); user-defined categories; per-project templates; seeding is
  optional.

## Release

0.88.0, new minor codename "Niven" (Larry Niven). Standard checklist: `version.ts`
(APP_VERSION + APP_MILESTONE + build-date comment), `CHANGELOG.md`, append a `versionHighlight*`
key to `APP_HIGHLIGHT_KEYS` (+ EN/DE). Per [[gitlab-ci-and-ops]] + AGENTS.md.
