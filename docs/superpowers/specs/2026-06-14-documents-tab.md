# Standalone Documents Tab — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete) — folds into branch `feat-ui-batch-trends-raci` (0.81.0 "Wolfe")

## Goal
A single **Documents** view that aggregates every document link in the workspace (the 5 entity types + the project) into one table where the user can open a link, jump to its source entity, **remove** it, or **add** a new one to a chosen target. Today links live only inside each entity's editor + the project form.

## Context (verified)
- `DocumentLink = { name: string; url: string; kind: "file" | "folder" }` (`document-link.ts`).
- Carriers (each has `documentLinks?: DocumentLink[]`): `Task` (name field `taskName`), `RaidItem` (`title`), `Milestone` (`name`), `ChangeItem` (`title`), `Stakeholder` (`name`), `ProjectMeta` (`name`). (Resources do NOT carry docs.)
- `useWorkspace()` exposes the arrays + setters `setTasks/setRaid/setChanges/setStakeholders/setMilestones` and `project`/`setProject` — setter map-updates auto-persist via the storage layer. So write-back = a setter `map` that replaces `documentLinks` on the matching id. (Confirm `setProject` + `project` are on `useWorkspace`; if the project lives on `Workspace.project`, update via the same path other project edits use.)
- `DocumentLinksFieldGated({ value, onChange, lang })` (`document-links-field-gated.tsx`) = the SharePoint-picker / paste-URL field, already M365-gated (paste-URL works when the integration is off).
- Add-a-view checklist: `nav-config.ts` (`AppView` union, `NAV_GROUPS`, `LABEL_KEYS` — a `Record<Exclude<AppView,"edit">,…>` so the new view MUST get a label key or tsc fails); `feature-modules.ts` (`FEATURE_MODULES` registry gates nav/views); `workspace-section.tsx` (render the panel for `activeTab`).

## §1 — Pure aggregator `documents.ts`
```ts
export type DocSourceKind = "task" | "raid" | "change" | "milestone" | "stakeholder" | "project";
export interface DocSource { kind: DocSourceKind; id: number; name: string; view: AppView; }
export interface DocRef { link: DocumentLink; source: DocSource; index: number; } // index within the source's documentLinks
export function collectDocuments(args: {
  tasks; raid; changes; milestones; stakeholders; project; // readonly arrays + ProjectMeta|undefined
}): DocRef[];
```
- Walk each array; for every entity with non-empty `documentLinks`, emit one `DocRef` per link with the source `{kind, id, entity-name, view}` and the link's `index`. Project (id 0) emits its `documentLinks`. `view` per kind: task→`"open-points"`, raid→`"raid"`, change→`"changes"`, milestone→`"milestones"`, stakeholder→`"stakeholders"`, project→`"projects"` (or the project view). Pure, unit-tested.

## §2 — `documents-panel.tsx`
- Uses `useWorkspace()` (arrays + setters + project) + `useWorkspaceTab()` (`requestOpen`) + `useSettings()` (lang). `VIEW_PANE_CLASS` shell + `INNER_TABLE_CLASS` table with `TABLE_HEAD_CLASS` (rounded, dark header — matches the app).
- `const docs = useMemo(() => collectDocuments({...}), [tasks, raid, changes, milestones, stakeholders, project])`.
- **Table columns:** Document (file/folder icon by `link.kind` + `link.name`, the name is a safe `<a href={link.url} target="_blank" rel="noopener noreferrer">` ↗ — reuse the `isSafeHttpUrl` guard from `document-link.ts`); Source (kind badge + name, a `<button onClick={() => requestOpen(source.view, source.id)}>` → opens that entity's editor via the deep-link wiring just added); Remove (✕ button).
- **Empty state** when `docs.length === 0`.
- **Remove(ref):** `setDocsForSource(ref.source, currentLinks.filter((_, i) => i !== ref.index))` — a local helper that switches on `source.kind` and calls the matching setter map-update (e.g. task → `setTasks(prev => prev.map(t => t.id === source.id ? { ...t, documentLinks: next } : t))`; project → update `ProjectMeta.documentLinks`). Log via `useActivityLog` if present.
- **Add flow:** a "+ Add document" control opens a small inline form: (1) a `<select>` **target** = every entity (grouped by kind, label = name) + a "Project" option; (2) once a target is picked, render `<DocumentLinksFieldGated value={targetDocs} onChange={next => setDocsForSource(target, next)} lang={lang} />` so the existing SharePoint-picker / paste-URL adds to that target. (The field shows the target's current links + lets you add; reuse as-is.) Collapse after.
- i18n-free strings via `t(lang, …)`.

## §3 — View wiring
- `nav-config.ts`: add `"documents"` to `AppView`; add a nav item (sensible group — e.g. its own or under Overview); `LABEL_KEYS.documents = "navDocuments"`.
- `feature-modules.ts`: add a `documents` `FeatureModule` (`id: "documents"`, `views: ["documents"]`, label/desc keys) so it's toggleable in Settings and gates the nav. Default-enabled via the existing default-all behavior (`sanitizeFeatures(undefined) → all`).
- `workspace-section.tsx`: dynamic-import `DocumentsPanel` and render it when `activeTab === "documents"` (mirror the other panels; works classic + modern).
- The chip/source deep-link already opens entity editors (the pendingOpen wiring on this branch).

## §4 — i18n, version, testing
- **i18n (EN+DE, real umlauts):** `navDocuments` ("Documents"/"Dokumente"), `documentsModuleLabel`/`Desc` (feature toggle), `documentsTitle`, `documentsEmpty`, `documentsColDocument`/`ColSource`/`ColActions`, `documentsAdd` ("Add document"/"Dokument hinzufügen"), `documentsTarget` ("Attach to"/"Anhängen an"), `documentsSourceProject` ("Project"/"Projekt"), `documentsRemove` ("Remove"/"Entfernen"), + per-kind source labels (`documentsSourceTask`/`Raid`/`Change`/`Milestone`/`Stakeholder`) or reuse existing entity labels. + `versionHighlightDocuments`.
- **Version:** already 0.81.0 on this branch — add a CHANGELOG bullet under the existing `## [0.81.0]` entry + append `"versionHighlightDocuments"` to `APP_HIGHLIGHT_KEYS`.
- **Testing:** `documents.test.ts` (`collectDocuments` aggregates across all 5 entities + project; emits one DocRef per link with the right source name/view/index; empty when none). `documents-panel.test.tsx` (renders the rows from a seeded workspace; Remove calls the setter dropping that link; Source-click calls `requestOpen(view,id)`; add-target select + field present; empty state). nav/feature-module: a new view in `LABEL_KEYS`/`FEATURE_MODULES` — extend any exhaustiveness tests. i18n parity/encoding; full suite + e2e/a11y (12-view) green; consider adding the Documents view to the a11y sweep is OPTIONAL (out of scope unless cheap).

## Out of scope
- Editing a link's name/url in place (open the source editor for that).
- Documents for resources (no `documentLinks` field).
- Dedup of the same URL referenced by multiple entities (show each occurrence).
- A separate documents storage table (links stay on their entities).

## File summary
**New:** `documents.ts`, `documents-panel.tsx` (+ tests).
**Modified:** `nav-config.ts`, `feature-modules.ts`, `workspace-section.tsx`, `i18n.ts`/`i18n.de.ts`, `version.ts` (highlight key), `CHANGELOG.md` (+ tests).
