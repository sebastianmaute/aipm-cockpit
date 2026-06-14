# Standalone Documents Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development (recommended) or executing-plans. `- [ ]` checkboxes. Folds into branch `feat-ui-batch-trends-raci`.

**Spec:** `docs/superpowers/specs/2026-06-14-documents-tab.md`

**Pinned facts:**
- `DocumentLink = { name; url; kind: "file"|"folder" }` (`document-link.ts`); `isSafeHttpUrl(url)` exported there.
- Carriers + name field: `Task.taskName`, `RaidItem.title`, `Milestone.name`, `ChangeItem.title`, `Stakeholder.name`, `ProjectMeta.name`. Each `documentLinks?: DocumentLink[]`.
- `useWorkspace()` (`workspace-context.tsx`) exposes `tasks/raid/changes/milestones/stakeholders` arrays + `setTasks/setRaid/setChanges/setStakeholders/setMilestones` + `project: ProjectMeta|undefined` + `setProject`. Setter map-updates auto-persist.
- `DocumentLinksFieldGated({ value, onChange, lang })` (`document-links-field-gated.tsx`).
- `FeatureModule = { id: FeatureModuleId; labelKey: TranslationKey; descKey?: TranslationKey; views: readonly AppView[] }`; registry `FEATURE_MODULES` (`feature-modules.ts:26`); `FeatureModuleId` union must gain `"documents"`. `NAV_GROUPS` (`nav-config.ts:47`) items are `{ view }`; `AppView` union + `LABEL_KEYS` (`Record<Exclude<AppView,"edit">,TranslationKey>` — exhaustive, tsc-enforced).
- Conventions: `npx vitest run <p>`, `npx tsc --noEmit`, `npx eslint <f> --max-warnings=0`. i18n EN/DE parity + real umlauts. Pure modules i18n-free.

---

## Task 1: i18n keys

**Files:** `i18n.ts`, `i18n.de.ts`.

- [ ] EN (after the `versionHighlightUiBatch` block):
```ts
  // --- Documents tab (0.81.0) ---
  navDocuments: "Documents",
  documentsModuleDesc: "A single place to see and manage every document link across the project.",
  documentsTitle: "Documents",
  documentsEmpty: "No documents linked yet. Add one below or from any item's editor.",
  documentsColDocument: "Document",
  documentsColSource: "Linked to",
  documentsColActions: "",
  documentsAdd: "Add document",
  documentsTarget: "Attach to",
  documentsRemove: "Remove link",
  documentsSourceTask: "Task",
  documentsSourceRaid: "RAID",
  documentsSourceChange: "Change",
  documentsSourceMilestone: "Milestone",
  documentsSourceStakeholder: "Stakeholder",
  documentsSourceProject: "Project",
  versionHighlightDocuments: "A new Documents tab gathers every linked file across the project — open, jump to the source, remove, or add new links in one place",
```
- [ ] DE (real umlauts) at the matching position:
```ts
  // --- Dokumente-Tab (0.81.0) ---
  navDocuments: "Dokumente",
  documentsModuleDesc: "Ein zentraler Ort, um alle Dokument-Verknüpfungen im Projekt zu sehen und zu verwalten.",
  documentsTitle: "Dokumente",
  documentsEmpty: "Noch keine Dokumente verknüpft. Unten oder im Editor eines Eintrags hinzufügen.",
  documentsColDocument: "Dokument",
  documentsColSource: "Verknüpft mit",
  documentsColActions: "",
  documentsAdd: "Dokument hinzufügen",
  documentsTarget: "Anhängen an",
  documentsRemove: "Verknüpfung entfernen",
  documentsSourceTask: "Aufgabe",
  documentsSourceRaid: "RAID",
  documentsSourceChange: "Änderung",
  documentsSourceMilestone: "Meilenstein",
  documentsSourceStakeholder: "Stakeholder",
  documentsSourceProject: "Projekt",
  versionHighlightDocuments: "Ein neuer Dokumente-Tab sammelt alle verknüpften Dateien des Projekts — öffnen, zur Quelle springen, entfernen oder neue Verknüpfungen an einem Ort hinzufügen",
```
- [ ] `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS (umlauts: `Verknüpfung`, `Änderung`, `hinzufügen`). Commit `feat: i18n keys for the Documents tab (EN/DE)`.

---

## Task 2: `documents.ts` aggregator + test

**Files:** Create `src/app/documents.ts`, `src/app/documents.test.ts`.

- [ ] **Test first** `documents.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { collectDocuments } from "./documents";

const doc = (name: string) => ({ name, url: `https://x/${name}`, kind: "file" as const });

describe("collectDocuments", () => {
  it("aggregates links across entities + project with source + index", () => {
    const refs = collectDocuments({
      tasks: [{ id: 1, taskName: "Ship", documentLinks: [doc("a"), doc("b")] }] as never,
      raid: [{ id: 7, title: "Risk", documentLinks: [doc("c")] }] as never,
      changes: [], milestones: [], stakeholders: [],
      project: { id: 0, name: "Demo", documentLinks: [doc("p")] } as never,
    });
    expect(refs).toHaveLength(4);
    expect(refs.find((r) => r.link.name === "b")).toMatchObject({ source: { kind: "task", id: 1, name: "Ship", view: "open-points" }, index: 1 });
    expect(refs.find((r) => r.link.name === "c")?.source).toMatchObject({ kind: "raid", id: 7, name: "Risk", view: "raid" });
    expect(refs.find((r) => r.link.name === "p")?.source).toMatchObject({ kind: "project", view: "projects" });
  });
  it("returns [] when nothing is linked", () => {
    expect(collectDocuments({ tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], project: undefined })).toEqual([]);
  });
});
```
- [ ] Run → FAIL.
- [ ] Write `src/app/documents.ts`:
```ts
// src/app/documents.ts — pure aggregator of every document link in a workspace.
import type { DocumentLink } from "./document-link";
import type { AppView } from "./nav-config";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, ProjectMeta } from "./types";

export type DocSourceKind = "task" | "raid" | "change" | "milestone" | "stakeholder" | "project";
export interface DocSource { kind: DocSourceKind; id: number; name: string; view: AppView; }
export interface DocRef { link: DocumentLink; source: DocSource; index: number; }

export interface CollectDocumentsArgs {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  project: ProjectMeta | undefined;
}

function push(out: DocRef[], links: readonly DocumentLink[] | undefined, source: Omit<DocSource, never>): void {
  (links ?? []).forEach((link, index) => out.push({ link, source, index }));
}

export function collectDocuments(a: CollectDocumentsArgs): DocRef[] {
  const out: DocRef[] = [];
  for (const t of a.tasks) push(out, t.documentLinks, { kind: "task", id: t.id, name: t.taskName, view: "open-points" });
  for (const r of a.raid) push(out, r.documentLinks, { kind: "raid", id: r.id, name: r.title, view: "raid" });
  for (const c of a.changes) push(out, c.documentLinks, { kind: "change", id: c.id, name: c.title, view: "changes" });
  for (const m of a.milestones) push(out, m.documentLinks, { kind: "milestone", id: m.id, name: m.name, view: "milestones" });
  for (const s of a.stakeholders) push(out, s.documentLinks, { kind: "stakeholder", id: s.id, name: s.name, view: "stakeholders" });
  if (a.project) push(out, a.project.documentLinks, { kind: "project", id: 0, name: a.project.name, view: "projects" });
  return out;
}
```
> If a field name differs (e.g. `ChangeItem.title` vs another), READ `types.ts` and fix. The test literal `{ project: { id: 0, name, documentLinks } }` must match `ProjectMeta` (cast `as never` already).
- [ ] Run → PASS. tsc + eslint clean. Commit `feat: collectDocuments aggregator`.

---

## Task 3: View wiring (nav + feature-module)

**Files:** `nav-config.ts`, `feature-modules.ts`.

- [ ] `nav-config.ts`: add `| "documents"` to the `AppView` union; add `documents: "navDocuments"` to `LABEL_KEYS`; add `{ view: "documents" }` to a `NAV_GROUPS` group (put it in the **Plan** group, or wherever RAID/changes live — read the groups and pick the document-y spot).
- [ ] `feature-modules.ts`: add `"documents"` to the `FeatureModuleId` union (find its definition); add `{ id: "documents", labelKey: "navDocuments", descKey: "documentsModuleDesc", views: ["documents"] }` to `FEATURE_MODULES`. (Default-enabled via `sanitizeFeatures(undefined) → all`. Do NOT add to `CORE_VIEWS`.)
- [ ] Verify `npx tsc --noEmit && npx eslint src/app/nav-config.ts src/app/feature-modules.ts --max-warnings=0` → clean. Run any nav/feature exhaustiveness tests (`npx vitest run src/app/nav-config.test.ts src/app/feature-modules.test.ts` if present) → PASS (a new view may need adding to a fixture). Commit `feat: register the documents view + feature module`.

---

## Task 4: `documents-panel.tsx` + test

**Files:** Create `src/app/documents-panel.tsx`, `src/app/documents-panel.test.tsx`.

- [ ] Implement `DocumentsPanel` (props: minimal — it pulls from contexts). Structure:
```tsx
"use client";
import { useMemo, useState } from "react";
import { t } from "./i18n";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { collectDocuments, type DocRef, type DocSource } from "./documents";
import { isSafeHttpUrl, type DocumentLink } from "./document-link";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { VIEW_PANE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";

const SOURCE_LABEL = { task: "documentsSourceTask", raid: "documentsSourceRaid", change: "documentsSourceChange", milestone: "documentsSourceMilestone", stakeholder: "documentsSourceStakeholder", project: "documentsSourceProject" } as const;

export function DocumentsPanel() {
  const { settings } = useSettings();
  const lang = settings.language;
  const ws = useWorkspace();
  const { requestOpen } = useWorkspaceTab();
  const { tasks, raid, changes, milestones, stakeholders, project } = ws;
  const docs = useMemo(() => collectDocuments({ tasks, raid, changes, milestones, stakeholders, project }), [tasks, raid, changes, milestones, stakeholders, project]);

  // current documentLinks for a source + a setter that writes the new list back
  function linksOf(s: DocSource): DocumentLink[] {
    if (s.kind === "project") return [...(project?.documentLinks ?? [])];
    const list = s.kind === "task" ? tasks : s.kind === "raid" ? raid : s.kind === "change" ? changes : s.kind === "milestone" ? milestones : stakeholders;
    return [...((list as { id: number; documentLinks?: DocumentLink[] }[]).find((e) => e.id === s.id)?.documentLinks ?? [])];
  }
  function setDocsForSource(s: DocSource, next: DocumentLink[]) {
    const patch = <T extends { id: number; documentLinks?: DocumentLink[] }>(arr: readonly T[]) => arr.map((e) => (e.id === s.id ? { ...e, documentLinks: next } : e));
    if (s.kind === "task") ws.setTasks((p) => patch(p));
    else if (s.kind === "raid") ws.setRaid((p) => patch(p));
    else if (s.kind === "change") ws.setChanges((p) => patch(p));
    else if (s.kind === "milestone") ws.setMilestones((p) => patch(p));
    else if (s.kind === "stakeholder") ws.setStakeholders((p) => patch(p));
    else ws.setProject((p) => (p ? { ...p, documentLinks: next } : p));
  }
  function remove(ref: DocRef) {
    setDocsForSource(ref.source, linksOf(ref.source).filter((_, i) => i !== ref.index));
  }

  const [addOpen, setAddOpen] = useState(false);
  const [targetKey, setTargetKey] = useState<string>(""); // `${kind}:${id}`
  // Build the target options: every entity + the project.
  const targets: DocSource[] = useMemo(() => [
    ...tasks.map((x) => ({ kind: "task" as const, id: x.id, name: x.taskName, view: "open-points" as const })),
    ...raid.map((x) => ({ kind: "raid" as const, id: x.id, name: x.title, view: "raid" as const })),
    ...changes.map((x) => ({ kind: "change" as const, id: x.id, name: x.title, view: "changes" as const })),
    ...milestones.map((x) => ({ kind: "milestone" as const, id: x.id, name: x.name, view: "milestones" as const })),
    ...stakeholders.map((x) => ({ kind: "stakeholder" as const, id: x.id, name: x.name, view: "stakeholders" as const })),
    ...(project ? [{ kind: "project" as const, id: 0, name: project.name, view: "projects" as const }] : []),
  ], [tasks, raid, changes, milestones, stakeholders, project]);
  const target = targets.find((s) => `${s.kind}:${s.id}` === targetKey);

  return (
    <div className={VIEW_PANE_CLASS}>
      {/* heading + Add button (toggles addOpen) */}
      {/* when addOpen: a <select> of targets (option value `${kind}:${id}`, label `${t(SOURCE_LABEL[kind])}: ${name}`) + when a target is chosen, <DocumentLinksFieldGated value={linksOf(target)} onChange={(next)=>setDocsForSource(target,next)} lang={lang} /> */}
      <div className={INNER_TABLE_CLASS}>
        <table className="w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr><th className="px-3 py-2">{t(lang,"documentsColDocument")}</th><th className="px-3 py-2">{t(lang,"documentsColSource")}</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {docs.map((ref, i) => (
              <tr key={i} className="align-top">
                <td className="px-3 py-2">{isSafeHttpUrl(ref.link.url)
                  ? <a href={ref.link.url} target="_blank" rel="noopener noreferrer" className="text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey">{ref.link.kind === "folder" ? "📁 " : "📄 "}{ref.link.name} ↗</a>
                  : <span>{ref.link.name}</span>}</td>
                <td className="px-3 py-2"><button type="button" onClick={() => requestOpen(ref.source.view, ref.source.id)} className="text-muted-foreground hover:text-AIPM-dark-blue hover:underline">{t(lang, SOURCE_LABEL[ref.source.kind])}: {ref.source.name}</button></td>
                <td className="px-3 py-2 text-right"><button type="button" aria-label={t(lang,"documentsRemove")} title={t(lang,"documentsRemove")} onClick={() => remove(ref)} className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-pink hover:text-AIPM-pink-strong">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t(lang,"documentsEmpty")}</p>}
      </div>
    </div>
  );
}
```
Flesh out the heading + Add-form region (the comment block): a "+ Add document" button toggling `addOpen`; when open, the target `<select>` (value `${kind}:${id}`) + the gated field bound to the chosen `target`. Use brand-palette classes. Verify `ws.setTasks` etc. accept an updater fn (they're `Dispatch<SetStateAction<…>>`).
- [ ] **Test** `documents-panel.test.tsx`: wrap in `WorkspaceProvider` + `WorkspaceTabProvider` + `SettingsProvider` (mirror an existing panel test). Seed a workspace with a task that has 1 link. Assert: the row renders the link name + a source button; clicking Remove drops the link (the row disappears / setter called); clicking the source button calls `requestOpen("open-points", <id>)`; empty workspace → empty state. (Adapt to the real provider/seed helpers in the repo's panel tests.)
- [ ] tsc + eslint + the panel test → clean/PASS. Commit `feat: Documents panel (aggregate · open · source-jump · remove · add)`.

---

## Task 5: Render the panel + CHANGELOG/highlight + sweep

**Files:** `workspace-section.tsx`, `version.ts`, `CHANGELOG.md`.

- [ ] `workspace-section.tsx`: dynamic-import `DocumentsPanel` (mirror the other `dynamic(() => import(...))` panels) and render it in a `<div … hidden={activeTab !== "documents"}>` / `activeTab === "documents"` block like the peers.
- [ ] `version.ts`: append `"versionHighlightDocuments",` to `APP_HIGHLIGHT_KEYS` (key from Task 1).
- [ ] `CHANGELOG.md`: add a bullet under the existing `## [0.81.0] - 2026-06-14 "Wolfe"` **Added / Changed** list:
```markdown
- New **Documents** tab: every linked file across tasks, RAID, changes, milestones,
  stakeholders, and the project in one place — open a link, jump to its source,
  remove it, or attach a new one to any item.
```
- [ ] FULL sweep: `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → green. `npx playwright test e2e/a11y.spec.ts` → 12/12 (the new view isn't in the gate; just confirm no regression). Commit `docs: Documents tab — 0.81.0 highlight + changelog`.

---

## Final verification
- [ ] tsc/vitest/eslint green; a11y 12/12.
- [ ] Manual: the Documents tab lists every linked file; open ↗ works; clicking a source opens that entity's editor; Remove drops the link (and persists); "+ Add" → pick a target → SharePoint picker / paste-URL attaches; toggling the Documents feature off hides the tab.
- [ ] Use **superpowers:finishing-a-development-branch**.
