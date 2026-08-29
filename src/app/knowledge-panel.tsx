"use client";
import { useMemo, useState } from "react";
import { t } from "./i18n";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { collectDocuments, type DocRef, type DocSource, type DocSourceKind } from "./knowledge";
import { isSafeHttpUrl, type KnowledgeItem, type KnowledgeLink, type KnowledgeLinkKind } from "./document-link";
import { KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { isSharePointEnabled } from "./m365-sharepoint";
import { INTERACTIVE } from "./interaction-styles";
import { TaskLinkPicker } from "./task-link-picker";
import { FieldGroup, Input, Select } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";
import { AddButton } from "./pane-toolbar";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Card } from "./card";
import { AddFirstItemButton } from "./add-first-item-button";
import { hostLabel, fileTypeOf, filterDocs, sortDocs, sourceCounts, effectiveSourceFilter, type DocSort, type DocTypeKey } from "./knowledge-meta";
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
  Confluence: "documentsTypeConfluence",
} as const satisfies Record<DocTypeKey, string>;

const LINK_KIND_LABEL = {
  document: "documentsManualKindDocument",
  confluence: "documentsManualKindConfluence",
  url: "documentsManualKindUrl",
} as const satisfies Record<KnowledgeLinkKind, string>;
const LINK_KIND_OPTIONS: KnowledgeLinkKind[] = ["url", "confluence", "document"];

const SORT_LABEL = {
  name: "documentsSortName",
  added: "documentsSortAdded",
  source: "documentsSortSource",
  type: "documentsSortType",
} as const satisfies Record<DocSort, string>;

const SORT_OPTIONS: DocSort[] = ["added", "name", "source", "type"];
const SOURCE_ORDER: DocSourceKind[] = ["project", "milestone", "task", "raid", "change", "stakeholder"];

const STANDALONE_KEY = "__standalone__";

export interface KnowledgePanelProps {
  /** ★★ Arms the one-shot destructive-save bypass (see `use-storage-backend.ts`)
   *  on a standalone-item remove. `knowledgeItems` counts toward
   *  `workspaceRecordCount`, so removing several inside one save-debounce
   *  window is a mass deletion by Layer B's arithmetic — and the debounce
   *  RESETS on every change, so an ordinary click-per-second burst coalesces
   *  into one save. Optional: the panel renders in contexts (tests, popouts)
   *  that supply no bypass at all. */
  allowDestructiveSave?: () => void;
}

export function KnowledgePanel({ allowDestructiveSave }: KnowledgePanelProps = {}) {
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

  function linksOf(s: DocSource): KnowledgeLink[] {
    if (s.kind === "project") return [...(project?.knowledgeLinks ?? [])];
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
      ...((list as readonly { id: number; knowledgeLinks?: KnowledgeLink[] }[]).find((e) => e.id === s.id)
        ?.knowledgeLinks ?? []),
    ];
  }
  function setDocsForSource(s: DocSource, next: KnowledgeLink[]) {
    const patch = <T extends { id: number; knowledgeLinks?: KnowledgeLink[] }>(arr: readonly T[]): T[] =>
      arr.map((e) => (e.id === s.id ? { ...e, knowledgeLinks: next } : e));
    if (s.kind === "task") ws.setTasks((p) => patch(p));
    else if (s.kind === "raid") ws.setRaid((p) => patch(p));
    else if (s.kind === "change") ws.setChanges((p) => patch(p));
    else if (s.kind === "milestone") ws.setMilestones((p) => patch(p));
    else if (s.kind === "stakeholder") ws.setStakeholders((p) => patch(p));
    else ws.setProject((p) => (p ? { ...p, knowledgeLinks: next } : p));
  }
  function remove(r: DocRef) {
    setDocsForSource(
      r.source,
      linksOf(r.source).filter((_, i) => i !== r.index),
    );
  }

  const [addOpen, setAddOpen] = useState(false);
  const [targetKey, setTargetKey] = useState(STANDALONE_KEY);
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualKind, setManualKind] = useState<KnowledgeLinkKind>("url");
  // Task ids to attach when creating a STANDALONE item (the optional 2nd step).
  const [linkTaskIds, setLinkTaskIds] = useState<number[]>([]);
  const manualValid = manualName.trim() !== "" && isSafeHttpUrl(manualUrl.trim());
  const isStandalone = targetKey === STANDALONE_KEY;
  const kItems: readonly KnowledgeItem[] = ws.knowledgeItems ?? [];
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
    const link: KnowledgeLink = { id: url, kind: "file", name: manualName.trim(), url, addedAt: new Date().toISOString() };
    // linkKind is sparse: only stamp confluence/url; a plain document omits it.
    if (manualKind !== "document") link.linkKind = manualKind;
    if (linksOf(s).some((l) => l.url === link.url)) return;
    setDocsForSource(s, [...linksOf(s), link]);
    setManualName("");
    setManualUrl("");
  }

  // --- Standalone Knowledge-library items (Workspace.knowledgeItems) ----------

  function addStandaloneItem() {
    if (!manualValid) return;
    const url = manualUrl.trim();
    if (kItems.some((it) => it.url === url)) return; // dedupe by URL
    const item: KnowledgeItem = {
      id: url,
      kind: "file",
      name: manualName.trim(),
      url,
      addedAt: new Date().toISOString(),
    };
    if (manualKind !== "document") item.linkKind = manualKind;
    if (linkTaskIds.length) item.taskIds = [...linkTaskIds];
    ws.setKnowledgeItems((prev) => [...(prev ?? []), item]);
    setManualName("");
    setManualUrl("");
    setLinkTaskIds([]);
  }
  function removeStandalone(idx: number) {
    // ★★ Arm the one-shot destructive-save bypass. knowledgeItems now counts
    //    toward workspaceRecordCount, so removing several in one debounce
    //    window is a mass deletion by Layer B's arithmetic — and this IS the
    //    explicit user action the bypass exists for.
    // ★★★ AND THIS IS THE ONE ARMING ROUTE WITH NO CONFIRM IN FRONT OF IT —
    //    deliberately, and the asymmetry is recorded here because nothing else
    //    marks it. `documents-panel.tsx` awaits a `confirm(...)` and
    //    `asset-library.tsx` gates its `onDelete` behind one; this button is
    //    wired straight to `onClick`. The reason is the VALUE of the row, not
    //    the bypass: a knowledge item is a name plus a URL, re-enterable from
    //    the add form in seconds, while those two destroy a document whose only
    //    surviving copy is a version before-image, and asset BYTES. Gating a
    //    two-field link behind a modal would be heavier than every comparable
    //    row delete in the app.
    // ★★ WHAT BOUNDS THE EXPOSURE, since a stray click does arm L3 and Layer B:
    //    the `filter` below ALWAYS mints a new array, so the slice changes
    //    reference, the save effect always runs, and the one-shot is always
    //    consumed by that save — at most one debounce cycle later. It cannot
    //    leak the way `documents-panel.tsx`'s did, where `mutateDocuments`
    //    could return `changed:false` and leave nothing to spend it. The
    //    residual risk is an accidental mass deletion landing inside the same
    //    ~500ms window as a stray click, which is not a human sequence.
    // ★ Do NOT copy the "(the caller confirms each delete before reaching
    //    here)" clause from `use-document-assets.ts` onto this route — it is
    //    false here, and that wording being reused MINUS its clause is exactly
    //    what made the difference invisible.
    allowDestructiveSave?.();
    ws.setKnowledgeItems((prev) => (prev ?? []).filter((_, i) => i !== idx));
  }
  function setStandaloneTasks(idx: number, taskIds: number[]) {
    ws.setKnowledgeItems((prev) =>
      (prev ?? []).map((it, i) => {
        if (i !== idx) return it;
        const next: KnowledgeItem = { ...it };
        if (taskIds.length) next.taskIds = taskIds;
        else delete next.taskIds;
        return next;
      }),
    );
  }

  const counts = sourceCounts(docs);
  const chipKinds = SOURCE_ORDER.filter((k) => counts[k] > 0);
  const effFilter = effectiveSourceFilter(sourceFilter, counts);
  const visible = sortDocs(
    filterDocs(docs, effFilter, query),
    sort,
    (r) => t(lang, DOC_TYPE_LABEL[fileTypeOf(r.link).labelKey]),
  );

  // Lifted verbatim out of the toolbar body below so it stays readable — no
  // behaviour change.
  const filterChips = (
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
                ? "border-ui-dark-blue bg-ui-dark-blue text-white"
                : "border-line bg-surface-muted text-foreground"
            } ${INTERACTIVE}`}
          >
            {label} <span className="opacity-60">{counts[k]}</span>
          </button>
        );
      })}
    </div>
  );

  const sortControl = (
    <label className="shrink-0 text-xs text-muted-foreground">
      {t(lang, "documentsSortBy")}
      <Select
        value={sort}
        aria-label={t(lang, "documentsSortBy")}
        onChange={(e) => setSort(e.target.value as DocSort)}
        size="xs"
        className="ml-1"
      >
        {SORT_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {t(lang, SORT_LABEL[s])}
          </option>
        ))}
      </Select>
    </label>
  );

  // Hoisted OUT of the scroller (previously rendered inside it, so it scrolled
  // away) and rendered UNCONDITIONALLY (previously only in the non-empty
  // branch, so an empty library had no Print/Reset-size at all). The trailing
  // Print · reset-size group is pushed right via ml-auto per the toolbar
  // convention (AGENTS.md): every pane's toolbar ends with that contiguous pair.
  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
      <AddButton
        onClick={() => setAddOpen((o) => !o)}
        aria-expanded={addOpen}
        className="shrink-0"
      >
        + {t(lang, "documentsTabAdd")}
      </AddButton>
      {filterChips}
      <ClearableSearchInput
        value={query}
        onClear={() => setQuery("")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "documentsSearchDocs")}`}
        className="min-w-[8rem] flex-1"
      >
        <Input
          type="search"
          value={query}
          aria-label={t(lang, "documentsSearchDocs")}
          placeholder={t(lang, "documentsSearchDocs")}
          onChange={(e) => setQuery(e.target.value)}
          size="xs"
          className={`w-full [&::-webkit-search-cancel-button]:appearance-none${query ? " pr-8" : ""}`}
        />
      </ClearableSearchInput>
      {sortControl}
      <div className="ml-auto flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetSizeButton onClick={reset} lang={lang} />
      </div>
    </div>
  );

  return (
    <div ref={ref} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {requestHelpConcept && (
        <ViewCallout
          view="knowledge"
          lang={lang}
          showHints={settings.showViewHints !== false}
          isPopout={!!isPopout}
          onLearnMore={requestHelpConcept}
        />
      )}

      {addOpen && (
        <div className="mb-3 shrink-0 rounded-md border border-line bg-surface-muted p-3 print:hidden">
          {/* Target picker + Cancel on one row so Cancel is reachable as soon as
              the add panel opens — including an empty project where no target
              has been chosen yet (the manual-link row below is target-gated). */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm text-foreground">
              {t(lang, "documentsTarget")}
              <Select
                value={targetKey}
                aria-label={t(lang, "documentsTarget")}
                onChange={(e) => setTargetKey(e.target.value)}
                size="xs"
                className="ml-2"
              >
                <option value="">—</option>
                <option value={STANDALONE_KEY}>{t(lang, "knowledgeStandaloneOption")}</option>
                {targets.map((s) => (
                  <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                    {t(lang, SOURCE_LABEL[s.kind])}: {s.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setManualName(""); setManualUrl(""); setTargetKey(STANDALONE_KEY); setAddOpen(false); }}
            >
              {t(lang, "cancel")}
            </Button>
          </div>
          {(target || isStandalone) && (
            <>
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualKind")}</span>
                  <Select
                    value={manualKind}
                    aria-label={t(lang, "documentsManualKind")}
                    onChange={(e) => setManualKind(e.target.value as KnowledgeLinkKind)}
                    size="xs"
                  >
                    {LINK_KIND_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {t(lang, LINK_KIND_LABEL[k])}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualName")}</span>
                  <Input
                    type="text"
                    value={manualName}
                    aria-label={t(lang, "documentsManualName")}
                    onChange={(e) => setManualName(e.target.value)}
                    size="xs"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualUrl")}</span>
                  <Input
                    type="url"
                    value={manualUrl}
                    aria-label={t(lang, "documentsManualUrl")}
                    onChange={(e) => setManualUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (isStandalone) addStandaloneItem();
                        else if (target) addManualLink(target);
                      }
                    }}
                    size="xs"
                    className="w-full min-w-[12rem]"
                  />
                </label>
                {isStandalone && (
                  // ★ Needs its own basis: this sits in a `flex flex-wrap
                  //   items-end` row where every sibling declares one, so
                  //   without it the picker collapses to content width.
                  // ★ `FieldGroup`, not `<label>`: the picker renders unlink
                  //   chips ABOVE its search box, so a label would adopt the
                  //   first ✕ and clicking the caption would unlink a task.
                  <FieldGroup
                    name={t(lang, "knowledgeLinkedTasks")}
                    className="flex flex-1 min-w-[16rem] flex-col gap-1 text-xs text-foreground"
                    caption={<span>{t(lang, "knowledgeLinkedTasks")}</span>}
                  >
                    <TaskLinkPicker
                      lang={lang}
                      tasks={tasks}
                      selectedIds={linkTaskIds}
                      onAdd={(id) => setLinkTaskIds((p) => (p.includes(id) ? p : [...p, id]))}
                      onRemove={(id) => setLinkTaskIds((p) => p.filter((x) => x !== id))}
                      label={t(lang, "knowledgeLinkedTasks")}
                    />
                  </FieldGroup>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (isStandalone) addStandaloneItem();
                    else if (target) addManualLink(target);
                  }}
                  disabled={!manualValid}
                >
                  {t(lang, "documentsManualAdd")}
                </Button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{t(lang, "documentsManualHint")}</p>
              {canAddDocument && target && (
                <KnowledgeLinksFieldGated
                  value={linksOf(target)}
                  onChange={(next) => setDocsForSource(target, next)}
                  lang={lang}
                />
              )}
            </>
          )}
        </div>
      )}

      {toolbar}
      {docs.length === 0 && kItems.length === 0 ? (
        <AddFirstItemButton
          onAdd={() => setAddOpen(true)}
          text={t(lang, "documentsTabEmpty")}
          addLabel={`+ ${t(lang, "documentsTabAdd")}…`}
          rounded="xl"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto pr-2">
          {kItems.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-foreground">{t(lang, "knowledgeLibraryHeading")}</h3>
              {/* xl, not lg: these cards carry a linked-tasks picker whose
                  chips have no room to read at three-up on a laptop. The
                  attached-document grid below has no chips and keeps lg. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {kItems.map((it, idx) => {
                  const ft = fileTypeOf(it);
                  const safe = isSafeHttpUrl(it.url);
                  return (
                    <Card key={`${it.id}:${idx}`} className="relative flex flex-col gap-2 p-3">
                      <IconButton
                        variant="danger"
                        label={`${t(lang, "documentsRemove")} – ${it.name}`}
                        title={t(lang, "documentsRemove")}
                        onClick={() => removeStandalone(idx)}
                        className="absolute right-2 top-2 text-xs"
                      >
                        ✕
                      </IconButton>
                      <div className="text-2xl" aria-hidden="true">{ft.icon}</div>
                      <div className="pr-5">
                        {safe ? (
                          <a
                            href={it.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-ui-dark-blue hover:underline dark:text-ui-light-grey"
                          >
                            {it.name} ↗
                          </a>
                        ) : (
                          <span className="font-medium text-foreground">{it.name}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{t(lang, DOC_TYPE_LABEL[ft.labelKey])}</div>
                      {/* Same trap as the add-form picker above — chips first,
                          so this can never be a `<label>`. Named per card so N
                          cards don't announce N identical groups. */}
                      <FieldGroup
                        name={`${t(lang, "knowledgeLinkedTasks")} – ${it.name} (${idx + 1})`}
                        className="flex flex-col gap-1 text-xs text-muted-foreground"
                        caption={<span>{t(lang, "knowledgeLinkedTasks")}</span>}
                      >
                        <TaskLinkPicker
                          lang={lang}
                          tasks={tasks}
                          selectedIds={it.taskIds ?? []}
                          onAdd={(id) => setStandaloneTasks(idx, [...(it.taskIds ?? []), id])}
                          onRemove={(id) =>
                            setStandaloneTasks(idx, (it.taskIds ?? []).filter((x) => x !== id))
                          }
                          label={`${t(lang, "knowledgeLinkedTasks")} – ${it.name} (${idx + 1})`}
                        />
                      </FieldGroup>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {visible.length === 0 ? (
            docs.length > 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t(lang, "documentsNoneForSource")}</p>
            ) : null
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((r, i) => {
                const ft = fileTypeOf(r.link);
                const safe = isSafeHttpUrl(r.link.url);
                const host = safe ? hostLabel(r.link.url) || t(lang, "documentsHostWeb") : "";
                return (
                  <Card
                    key={`${r.source.kind}:${r.source.id}:${r.index}:${i}`}
                    className="relative flex flex-col gap-2 p-3"
                  >
                    <IconButton
                      variant="danger"
                      label={`${t(lang, "documentsRemove")} – ${r.link.name}`}
                      title={t(lang, "documentsRemove")}
                      onClick={() => remove(r)}
                      className="absolute right-2 top-2 text-xs"
                    >
                      ✕
                    </IconButton>
                    <div className="text-2xl" aria-hidden="true">
                      {ft.icon}
                    </div>
                    <div className="pr-5">
                      {safe ? (
                        <a
                          href={r.link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-ui-dark-blue hover:underline dark:text-ui-light-grey"
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
                      className={`self-start rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ui-dark-blue hover:underline dark:text-ui-light-grey ${INTERACTIVE}`}
                    >
                      {t(lang, SOURCE_LABEL[r.source.kind])}: {r.source.name}
                    </button>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span>{t(lang, DOC_TYPE_LABEL[ft.labelKey])}</span>
                      {host && (
                        <span className="rounded bg-ui-dark-blue px-1 text-[10px] uppercase text-white">{host}</span>
                      )}
                      {r.link.addedAt && (
                        <span>· {t(lang, "documentsAdded", formatExpiryDate(r.link.addedAt.slice(0, 10), lang))}</span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
