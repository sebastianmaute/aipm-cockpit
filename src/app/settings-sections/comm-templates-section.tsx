"use client";
import { useState } from "react";
import { type Lang, t, type TranslationKey } from "../i18n";
import { COMM_TEMPLATE_CATEGORIES, CATEGORY_FIELDS, type CommTemplate, type CommTemplateCategory } from "../comm-templates";
import type { TursoConfig } from "../turso-config";
import type { Settings } from "../settings-types";
import type { CommTemplateSendMode } from "../comm-send";
import { useCommTemplateVersions } from "../use-comm-template-versions";
import { diffLines } from "../text-diff";
import { htmlToPlainText } from "../html-to-text";
import { CommTemplateDiffView } from "../comm-template-diff-view";
import { InfoTooltip } from "../info-tooltip";
import { EmptyState } from "../empty-state";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "../interaction-styles";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("../rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
});

const CAT_LABEL_KEY: Record<CommTemplateCategory, TranslationKey> = {
  "status-inquiry": "commTplCat_statusInquiry",
  "stakeholder-update": "commTplCat_stakeholderUpdate",
};

export interface CommTemplatesSectionProps {
  lang: Lang;
  templates: CommTemplate[];
  onCreate: (category: CommTemplateCategory, name: string, body: string) => void;
  onRename: (id: string, name: string) => void;
  onSaveBody: (id: string, body: string) => void;
  onRemove: (id: string) => void;
  onSetDefault: (category: CommTemplateCategory, id: string) => void;
  config: TursoConfig | null;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function CommTemplatesSection(props: CommTemplatesSectionProps) {
  const { lang, templates } = props;
  const [category, setCategory] = useState<CommTemplateCategory>("status-inquiry");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const CURRENT_ID = "__current__";
  const inCategory = templates.filter((tpl) => tpl.category === category);
  const selected = inCategory.find((tpl) => tpl.id === selectedId) ?? null;

  const versions = useCommTemplateVersions({ active: props.config !== null, config: props.config, templateId: selectedId });

  function toggleCompare(id: string) {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? [prev[1], id] : [...prev, id],
    );
  }

  function bodyOf(id: string): string {
    if (id === CURRENT_ID) return bodyDraft;
    return versions.versions.find((v) => v.id === id)?.body ?? "";
  }

  function sortKey(id: string): string {
    if (id === CURRENT_ID) return "￿"; // Current sorts newest
    return versions.versions.find((v) => v.id === id)?.createdAt ?? "";
  }

  function selectTemplate(tpl: CommTemplate) {
    setSelectedId(tpl.id);
    setBodyDraft(tpl.body);
    setCompareIds([]);
  }

  function createTemplate() {
    const name = newName.trim();
    if (!name) return;
    props.onCreate(category, name, "");
    setNewName("");
  }

  function persistBody() {
    if (selected && bodyDraft !== selected.body) props.onSaveBody(selected.id, bodyDraft);
  }

  function saveCurrentVersion() {
    if (!selected) return;
    const name = window.prompt(t(lang, "commTplVersionNamePrompt"), "");
    if (!name || !name.trim()) return;
    void versions.saveVersion(name.trim(), bodyDraft, false);
  }

  function cancelEdit() {
    if (!selected) return;
    setBodyDraft(selected.body);
    setRestoreNonce((n) => n + 1);
  }

  function restoreVersion(body: string) {
    if (!selected) return;
    const stamp = new Date().toISOString();
    void versions.saveVersion(`${t(lang, "commTplBeforeRestore")} — ${stamp}`, bodyDraft, true);
    setBodyDraft(body);
    props.onSaveBody(selected.id, body);
    setRestoreNonce((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "settingsSectionCommTemplates")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "commTplIntro")}</p>
      </div>

      <fieldset className="flex flex-col gap-1 text-sm text-foreground">
        <legend className="font-medium">{t(lang, "commSendMode")}</legend>
        {([
          ["mailto", "commSendModeMailto"],
          ["outlook-draft", "commSendModeDraft"],
          ["in-app-preview", "commSendModePreview"],
        ] as [CommTemplateSendMode, TranslationKey][]).map(([value, key]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="commSendMode"
              checked={(props.settings.commTemplateSendMode ?? "mailto") === value}
              onChange={() => props.onChange({ ...props.settings, commTemplateSendMode: value })}
              className={`h-4 w-4 cursor-pointer border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
            />
            <span>{t(lang, key)}</span>
          </label>
        ))}
        <span className="text-xs text-muted-foreground">{t(lang, "commSendModeHint")}</span>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm text-foreground">
        <span className="font-medium">{t(lang, "commTplCategory")}</span>
        <select
          value={category}
          aria-label={t(lang, "commTplCategory")}
          onChange={(e) => { setCategory(e.target.value as CommTemplateCategory); setSelectedId(null); setBodyDraft(""); setCompareIds([]); }}
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
        >
          {COMM_TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(lang, CAT_LABEL_KEY[c])}</option>
          ))}
        </select>
      </label>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm text-foreground">
          <span className="font-medium">{t(lang, "commTplName")}</span>
          <input
            type="text"
            value={newName}
            aria-label={t(lang, "commTplName")}
            placeholder={t(lang, "commTplNew")}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createTemplate(); }}
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          />
        </label>
        <button
          type="button"
          onClick={createTemplate}
          disabled={!newName.trim()}
          className={`shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "commTplCreate")}
        </button>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-foreground">
          {t(lang, CAT_LABEL_KEY[category])}
          <InfoTooltip text={t(lang, "commTplRowsClickableHint")} />
        </h3>
        {inCategory.length === 0 ? (
          <EmptyState compact title={t(lang, "commTplEmpty")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {inCategory.map((tpl) => (
              <li key={tpl.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted">
                <button type="button" onClick={() => selectTemplate(tpl)} title={t(lang, "commTplRowsClickableHint")} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left ${INTERACTIVE}`}>
                  <span className="truncate text-sm font-medium text-foreground">{tpl.name}</span>
                  {tpl.isDefault && (
                    <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground">
                      {t(lang, "commTplDefaultBadge")}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => props.onSetDefault(category, tpl.id)}
                  disabled={tpl.isDefault}
                  className={`shrink-0 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
                >
                  {t(lang, "commTplSetDefault")}
                </button>
                <button
                  type="button"
                  onClick={() => { props.onRemove(tpl.id); if (selectedId === tpl.id) { setSelectedId(null); setBodyDraft(""); } }}
                  aria-label={`${t(lang, "commTplDelete")}: ${tpl.name}`}
                  className={`shrink-0 rounded-md border border-line px-2 py-1 text-xs text-AIPM-purple hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {t(lang, "commTplDelete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-3">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            <span className="font-medium">{t(lang, "commTplRename")}</span>
            <input
              key={selected.id}
              type="text"
              defaultValue={selected.name}
              aria-label={t(lang, "commTplRename")}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== selected.name) props.onRename(selected.id, n); }}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            />
          </label>

          <div
            className="flex flex-col gap-1"
            onBlur={(e) => {
              // Persist only when focus leaves the whole editor+toolbar group —
              // clicking a toolbar button blurs the contenteditable but keeps
              // focus inside this wrapper, so it must not trigger a save.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) persistBody();
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t(lang, "commTplBody")}</span>
              <button
                type="button"
                onClick={cancelEdit}
                className={`shrink-0 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted ${INTERACTIVE}`}
              >
                {t(lang, "commTemplateCancelEdit")}
              </button>
            </div>
            <RichTextEditor
              key={`${selected.id}:${restoreNonce}`}
              value={bodyDraft}
              onChange={setBodyDraft}
              label={t(lang, "commTplBody")}
              mergeFields={CATEGORY_FIELDS[category]}
              fieldLabel={(f) => t(lang, ("commTplField_" + f) as TranslationKey)}
              labels={{
                bold: t(lang, "commTplBold"),
                italic: t(lang, "commTplItalic"),
                underline: t(lang, "commTplUnderline"),
                heading1: t(lang, "commTplHeading1"),
                heading2: t(lang, "commTplHeading2"),
                bulletList: t(lang, "commTplBulletList"),
                numberedList: t(lang, "commTplNumberedList"),
                link: t(lang, "commTplLink"),
                unlink: t(lang, "commTplUnlink"),
                linkPrompt: t(lang, "commTplLinkPrompt"),
              }}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t(lang, "commTplVersions")}</span>
              <button
                type="button"
                onClick={saveCurrentVersion}
                className={`shrink-0 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted ${INTERACTIVE}`}
              >
                {t(lang, "commTplSaveVersion")}
              </button>
            </div>
            {versions.versions.length === 0 && (
              <EmptyState compact title={t(lang, "commTplVersionsEmpty")} />
            )}
            <ul className="flex flex-col gap-1">
              <li className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2 py-1">
                <span className="truncate text-xs text-foreground">{t(lang, "commTplCurrent")}</span>
                <button
                  type="button"
                  onClick={() => toggleCompare(CURRENT_ID)}
                  aria-pressed={compareIds.includes(CURRENT_ID)}
                  aria-label={`${t(lang, "commTplCompare")}: ${t(lang, "commTplCurrent")}`}
                  className={`${compareIds.includes(CURRENT_ID)
                    ? "shrink-0 rounded-md border border-line bg-AIPM-dark-blue px-2 py-0.5 text-[11px] text-white"
                    : "shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"} ${INTERACTIVE}`}
                >
                  {t(lang, "commTplCompare")}
                </button>
              </li>
              {versions.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2 py-1">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-xs text-foreground">{v.name}</span>
                    {v.isAuto && (
                      <span className="shrink-0 rounded bg-surface-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {t(lang, "commTplVersionAuto")}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCompare(v.id)}
                    aria-pressed={compareIds.includes(v.id)}
                    aria-label={`${t(lang, "commTplCompare")}: ${v.name}`}
                    className={`${compareIds.includes(v.id)
                      ? "shrink-0 rounded-md border border-line bg-AIPM-dark-blue px-2 py-0.5 text-[11px] text-white"
                      : "shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"} ${INTERACTIVE}`}
                  >
                    {t(lang, "commTplCompare")}
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreVersion(v.body)}
                    aria-label={`${t(lang, "commTplRestore")}: ${v.name}`}
                    className={`shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted ${INTERACTIVE}`}
                  >
                    {t(lang, "commTplRestore")}
                  </button>
                </li>
              ))}
            </ul>
            {compareIds.length === 2 && (() => {
              const [a, b] = [...compareIds].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
              const before = htmlToPlainText(bodyOf(a)).split("\n");
              const after = htmlToPlainText(bodyOf(b)).split("\n");
              const lines = diffLines(before, after);
              const added = lines.filter((l) => l.type === "added").length;
              const removed = lines.filter((l) => l.type === "removed").length;
              return (
                <CommTemplateDiffView
                  lines={lines}
                  addedLabel={t(lang, "commTplDiffAdded")}
                  removedLabel={t(lang, "commTplDiffRemoved")}
                  summary={t(lang, "commTplDiffSummary", String(added), String(removed))}
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
