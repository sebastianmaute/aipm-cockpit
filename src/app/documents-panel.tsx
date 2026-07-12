"use client";
import { useMemo, useState } from "react";
import { t } from "./i18n";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { collectDocuments, type DocRef, type DocSource, type DocSourceKind } from "./documents";
import { isSafeHttpUrl, type DocumentLink } from "./document-link";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { isSharePointEnabled } from "./m365-sharepoint";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";
import { hostLabel, fileTypeOf, filterDocs, sortDocs, sourceCounts, effectiveSourceFilter, type DocSort, type DocTypeKey } from "./document-meta";
import { formatExpiryDate } from "./date-format";
import { ViewCallout } from "./view-callout";

const SOURCE_LABEL = {
  task: "documentsSourceTask",
  raid: "documentsSourceRaid",
  change: "documentsSourceChange",
  milestone: "documentsSourceMilestone",
  stakeholder: "documentsSourceStakeholder",
  project: "documentsSourceProject",
} as const;

const DOC_TYPE_LABEL = {
  Pdf: "documentsTypePdf",
  Word: "documentsTypeWord",
  Excel: "documentsTypeExcel",
  Ppt: "documentsTypePpt",
  Image: "documentsTypeImage",
  Folder: "documentsTypeFolder",
  Link: "documentsTypeLink",
  File: "documentsTypeFile",
} as const satisfies Record<DocTypeKey, string>;

const SORT_LABEL = {
  name: "documentsSortName",
  added: "documentsSortAdded",
  source: "documentsSortSource",
  type: "documentsSortType",
} as const satisfies Record<DocSort, string>;

const SORT_OPTIONS: DocSort[] = ["added", "name", "source", "type"];
const SOURCE_ORDER: DocSourceKind[] = ["project", "milestone", "task", "raid", "change", "stakeholder"];

export function DocumentsPanel() {
  const { settings } = useSettings();
  const lang = settings.language;
  const { ref, reset } = useResizable("aipm-cockpit:documents-size-full");
  const canAddDocument = isSharePointEnabled(settings.integrations);
  const ws = useWorkspace();
  const { requestOpen, isPopout, requestHelpConcept } = useWorkspaceTab();
  const { tasks, raid, changes, milestones, stakeholders, project } = ws;
  const docs = useMemo(
    () => collectDocuments({ tasks, raid, changes, milestones, stakeholders, project }),
    [tasks, raid, changes, milestones, stakeholders, project],
  );

  const [sourceFilter, setSourceFilter] = useState<DocSourceKind | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DocSort>("added");

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
  function remove(r: DocRef) {
    setDocsForSource(
      r.source,
      linksOf(r.source).filter((_, i) => i !== r.index),
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
    const url = manualUrl.trim();
    const link: DocumentLink = { id: url, kind: "file", name: manualName.trim(), url, addedAt: new Date().toISOString() };
    if (linksOf(s).some((l) => l.url === link.url)) return;
    setDocsForSource(s, [...linksOf(s), link]);
    setManualName("");
    setManualUrl("");
  }

  const counts = sourceCounts(docs);
  const chipKinds = SOURCE_ORDER.filter((k) => counts[k] > 0);
  const effFilter = effectiveSourceFilter(sourceFilter, counts);
  const visible = sortDocs(
    filterDocs(docs, effFilter, query),
    sort,
    (r) => t(lang, DOC_TYPE_LABEL[fileTypeOf(r.link).labelKey]),
  );

  return (
    <div ref={ref} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {requestHelpConcept && (
        <ViewCallout
          view="documents"
          lang={lang}
          showHints={settings.showViewHints !== false}
          isPopout={!!isPopout}
          onLearnMore={requestHelpConcept}
        />
      )}

      {addOpen && (
        <div className="mb-3 shrink-0 rounded-md border border-line bg-surface-muted p-3 print:hidden">
          <label className="mb-2 block text-sm text-foreground">
            {t(lang, "documentsTarget")}
            <select
              value={targetKey}
              aria-label={t(lang, "documentsTarget")}
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addManualLink(target);
                    }}
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

      {docs.length === 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
        >
          <span>{t(lang, "documentsTabEmpty")}</span>
          <span className="font-medium">+ {t(lang, "documentsTabAdd")}…</span>
        </button>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto pr-2">
          <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              aria-expanded={addOpen}
              className={`shrink-0 rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
            >
              + {t(lang, "documentsTabAdd")}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {(["all", ...chipKinds] as (DocSourceKind | "all")[]).map((k) => {
                const active = effFilter === k;
                const label = k === "all" ? t(lang, "documentsFilterAll") : t(lang, SOURCE_LABEL[k]);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSourceFilter(k)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      active
                        ? "border-AIPM-dark-blue bg-AIPM-dark-blue text-white"
                        : "border-line bg-surface-muted text-foreground"
                    } ${INTERACTIVE}`}
                  >
                    {label} <span className="opacity-60">{counts[k]}</span>
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={query}
              aria-label={t(lang, "documentsSearchDocs")}
              placeholder={t(lang, "documentsSearchDocs")}
              onChange={(e) => setQuery(e.target.value)}
              className={`min-w-[8rem] flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
            />
            <label className="shrink-0 text-xs text-muted-foreground">
              {t(lang, "documentsSortBy")}
              <select
                value={sort}
                aria-label={t(lang, "documentsSortBy")}
                onChange={(e) => setSort(e.target.value as DocSort)}
                className={`ml-1 rounded-md border border-line bg-surface px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(lang, SORT_LABEL[s])}
                  </option>
                ))}
              </select>
            </label>
            <PrintButton lang={lang} />
            <ResetSizeButton onClick={reset} lang={lang} />
          </div>

          {visible.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t(lang, "documentsNoneForSource")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((r, i) => {
                const ft = fileTypeOf(r.link);
                const safe = isSafeHttpUrl(r.link.url);
                const host = safe ? hostLabel(r.link.url) || t(lang, "documentsHostWeb") : "";
                return (
                  <div
                    key={`${r.source.kind}:${r.source.id}:${r.index}:${i}`}
                    className="relative flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
                  >
                    <button
                      type="button"
                      aria-label={`${t(lang, "documentsRemove")} – ${r.link.name}`}
                      title={t(lang, "documentsRemove")}
                      onClick={() => remove(r)}
                      className={`absolute right-2 top-2 rounded-md px-1.5 text-xs text-muted-foreground hover:text-AIPM-pink-strong ${INTERACTIVE}`}
                    >
                      ✕
                    </button>
                    <div className="text-2xl" aria-hidden="true">
                      {ft.icon}
                    </div>
                    <div className="pr-5">
                      {safe ? (
                        <a
                          href={r.link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey"
                        >
                          {r.link.name} ↗
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">{r.link.name}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => requestOpen(r.source.view, r.source.id)}
                      className={`self-start rounded-full bg-surface-muted px-2 py-0.5 text-xs text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
                    >
                      {t(lang, SOURCE_LABEL[r.source.kind])}: {r.source.name}
                    </button>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span>{t(lang, DOC_TYPE_LABEL[ft.labelKey])}</span>
                      {host && (
                        <span className="rounded bg-AIPM-dark-blue px-1 text-[10px] uppercase text-white">{host}</span>
                      )}
                      {r.link.addedAt && (
                        <span>· {t(lang, "documentsAdded", formatExpiryDate(r.link.addedAt.slice(0, 10), lang))}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
