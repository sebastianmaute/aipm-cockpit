"use client";
import { useMemo, useState } from "react";
import { t } from "./i18n";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { collectDocuments, type DocRef, type DocSource } from "./documents";
import { isSafeHttpUrl, type DocumentLink } from "./document-link";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { VIEW_PANE_RESIZABLE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { useResizable } from "./use-resizable";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { isSharePointEnabled } from "./m365-sharepoint";
import { EmptyState } from "./empty-state";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";

const DOCS_COL_WIDTHS = { document: 360, source: 240 } as const;
type DocCol = keyof typeof DOCS_COL_WIDTHS;

const SOURCE_LABEL = {
  task: "documentsSourceTask",
  raid: "documentsSourceRaid",
  change: "documentsSourceChange",
  milestone: "documentsSourceMilestone",
  stakeholder: "documentsSourceStakeholder",
  project: "documentsSourceProject",
} as const;

export function DocumentsPanel() {
  const { settings } = useSettings();
  const lang = settings.language;
  // `-full` suffix: the view changed from a centered half-width pane to full
  // width — use a fresh key so a stale half-width size doesn't override `w-full`.
  const { ref, reset } = useResizable("lop-app:documents-size-full");
  const { colWidths, startColResize, resetColWidths } = useColumnResize<DocCol>("documents", DOCS_COL_WIDTHS);
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;
  const canAddDocument = isSharePointEnabled(settings.integrations);
  const ws = useWorkspace();
  const { requestOpen } = useWorkspaceTab();
  const { tasks, raid, changes, milestones, stakeholders, project } = ws;
  const docs = useMemo(
    () => collectDocuments({ tasks, raid, changes, milestones, stakeholders, project }),
    [tasks, raid, changes, milestones, stakeholders, project],
  );

  function linksOf(s: DocSource): DocumentLink[] {
    if (s.kind === "project") return [...(project?.documentLinks ?? [])];
    const list =
      s.kind === "task"
        ? tasks
        : s.kind === "raid"
          ? raid
          : s.kind === "change"
            ? changes
            : s.kind === "milestone"
              ? milestones
              : stakeholders;
    return [
      ...((list as readonly { id: number; documentLinks?: DocumentLink[] }[]).find((e) => e.id === s.id)
        ?.documentLinks ?? []),
    ];
  }
  function setDocsForSource(s: DocSource, next: DocumentLink[]) {
    const patch = <T extends { id: number; documentLinks?: DocumentLink[] }>(arr: readonly T[]): T[] =>
      arr.map((e) => (e.id === s.id ? { ...e, documentLinks: next } : e));
    if (s.kind === "task") ws.setTasks((p) => patch(p));
    else if (s.kind === "raid") ws.setRaid((p) => patch(p));
    else if (s.kind === "change") ws.setChanges((p) => patch(p));
    else if (s.kind === "milestone") ws.setMilestones((p) => patch(p));
    else if (s.kind === "stakeholder") ws.setStakeholders((p) => patch(p));
    else ws.setProject((p) => (p ? { ...p, documentLinks: next } : p));
  }
  function remove(ref: DocRef) {
    setDocsForSource(
      ref.source,
      linksOf(ref.source).filter((_, i) => i !== ref.index),
    );
  }

  const [addOpen, setAddOpen] = useState(false);
  const [targetKey, setTargetKey] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const manualValid = manualName.trim() !== "" && isSafeHttpUrl(manualUrl.trim());
  const targets: DocSource[] = useMemo(
    () => [
      ...tasks.map((x) => ({ kind: "task" as const, id: x.id, name: x.taskName, view: "open-points" as const })),
      ...raid.map((x) => ({ kind: "raid" as const, id: x.id, name: x.title, view: "raid" as const })),
      ...changes.map((x) => ({ kind: "change" as const, id: x.id, name: x.title, view: "changes" as const })),
      ...milestones.map((x) => ({ kind: "milestone" as const, id: x.id, name: x.name, view: "milestones" as const })),
      ...stakeholders.map((x) => ({
        kind: "stakeholder" as const,
        id: x.id,
        name: x.name,
        view: "stakeholders" as const,
      })),
      ...(project ? [{ kind: "project" as const, id: 0, name: project.name, view: "projects" as const }] : []),
    ],
    [tasks, raid, changes, milestones, stakeholders, project],
  );
  const target = targets.find((s) => `${s.kind}:${s.id}` === targetKey);

  function addManualLink(s: DocSource) {
    if (!manualValid) return;
    // Manual entries have no Graph driveItem id — derive a stable id from the URL
    // (also the dedupe key used across the documents surfaces).
    const url = manualUrl.trim();
    const link: DocumentLink = { id: url, kind: "file", name: manualName.trim(), url };
    if (linksOf(s).some((l) => l.url === link.url)) return;
    setDocsForSource(s, [...linksOf(s), link]);
    setManualName("");
    setManualUrl("");
  }

  return (
    <div ref={ref} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "documentsTitle")}</h2>
        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
          >
            + {t(lang, "documentsTabAdd")}
          </button>
          <PrintButton lang={lang} />
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>
      {addOpen && (
        <div className="mb-3 shrink-0 rounded-md border border-line bg-surface-muted p-3 print:hidden">
          <label className="mb-2 block text-sm text-foreground">
            {t(lang, "documentsTarget")}
            <select
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
              className={`ml-2 rounded-md border border-line bg-surface px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
            >
              <option value="">—</option>
              {targets.map((s) => (
                <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                  {t(lang, SOURCE_LABEL[s.kind])}: {s.name}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <>
              {/* Manual link entry — always available, no SharePoint required. */}
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualName")}</span>
                  <input
                    type="text"
                    value={manualName}
                    aria-label={t(lang, "documentsManualName")}
                    onChange={(e) => setManualName(e.target.value)}
                    className={`rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualUrl")}</span>
                  <input
                    type="url"
                    value={manualUrl}
                    aria-label={t(lang, "documentsManualUrl")}
                    onChange={(e) => setManualUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addManualLink(target); }}
                    className={`w-full min-w-[12rem] rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => addManualLink(target)}
                  disabled={!manualValid}
                  className={`rounded-md border border-line bg-surface px-3 py-1 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey ${INTERACTIVE}`}
                >
                  {t(lang, "documentsManualAdd")}
                </button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{t(lang, "documentsManualHint")}</p>
              {/* SharePoint picker (when M365 + SharePoint enabled). */}
              {canAddDocument && (
                <DocumentLinksFieldGated
                  value={linksOf(target)}
                  onChange={(next) => setDocsForSource(target, next)}
                  lang={lang}
                />
              )}
            </>
          )}
        </div>
      )}
      <div className={INNER_TABLE_CLASS}>
        <table className="w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.document, minWidth: colWidths.document }}>
                {t(lang, "documentsColDocument")}
                <ColumnResizeHandle col="document" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.source, minWidth: colWidths.source }}>
                {t(lang, "documentsColSource")}
                <ColumnResizeHandle col="source" onMouseDown={startResize} />
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {docs.map((ref, i) => (
              <tr key={`${ref.source.kind}:${ref.source.id}:${ref.index}:${i}`} className="align-top">
                <td className="px-3 py-2">
                  {isSafeHttpUrl(ref.link.url) ? (
                    <a
                      href={ref.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey"
                    >
                      {ref.link.kind === "folder" ? "📁 " : "📄 "}
                      {ref.link.name} ↗
                    </a>
                  ) : (
                    <span className="text-foreground">{ref.link.name}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => requestOpen(ref.source.view, ref.source.id)}
                    className={`text-muted-foreground hover:text-AIPM-dark-blue hover:underline ${INTERACTIVE}`}
                  >
                    {t(lang, SOURCE_LABEL[ref.source.kind])}: {ref.source.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    aria-label={`${t(lang, "documentsRemove")} – ${ref.link.name}`}
                    title={t(lang, "documentsRemove")}
                    onClick={() => remove(ref)}
                    className={`rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-AIPM-pink-strong ${INTERACTIVE}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.length === 0 && (
          <EmptyState compact title={t(lang, "documentsTabEmpty")} />
        )}
      </div>
    </div>
  );
}
