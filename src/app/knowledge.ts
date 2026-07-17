// src/app/knowledge.ts — pure aggregator of every document link in a workspace.
import type { KnowledgeLink } from "./document-link";
import type { AppView } from "./nav-config";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, ProjectMeta } from "./types";

export type DocSourceKind = "task" | "raid" | "change" | "milestone" | "stakeholder" | "project";

export interface DocSource {
  kind: DocSourceKind;
  id: number;
  name: string;
  view: AppView;
}

export interface DocRef {
  link: KnowledgeLink;
  source: DocSource;
  index: number;
}

export interface CollectDocumentsArgs {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  project: ProjectMeta | undefined;
}

function push(out: DocRef[], links: readonly KnowledgeLink[] | undefined, source: DocSource): void {
  (links ?? []).forEach((link, index) => out.push({ link, source, index }));
}

export function collectDocuments(a: CollectDocumentsArgs): DocRef[] {
  const out: DocRef[] = [];
  for (const t of a.tasks)
    push(out, t.documentLinks, { kind: "task", id: t.id, name: t.taskName, view: "open-points" });
  for (const r of a.raid)
    push(out, r.documentLinks, { kind: "raid", id: r.id, name: r.title, view: "raid" });
  for (const c of a.changes)
    push(out, c.documentLinks, { kind: "change", id: c.id, name: c.title, view: "changes" });
  for (const m of a.milestones)
    push(out, m.documentLinks, { kind: "milestone", id: m.id, name: m.name, view: "milestones" });
  for (const s of a.stakeholders)
    push(out, s.documentLinks, { kind: "stakeholder", id: s.id, name: s.name, view: "stakeholders" });
  if (a.project)
    push(out, a.project.documentLinks, { kind: "project", id: 0, name: a.project.name, view: "projects" });
  return out;
}
