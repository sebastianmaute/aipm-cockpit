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
import { FieldHint } from "../field-hint";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "../interaction-styles";
import { Button } from "../button";
import { Input, Select } from "../form-controls";
import { reportSilentFailure } from "../guard-feedback";
import { useToastContext } from "../toast-context";
import { RichTextEditor } from "../rich-text-editor-lazy";
import { buildRowTokens, rowLabel } from "../row-tokens";

const CAT_LABEL_KEY: Record<CommTemplateCategory, TranslationKey> = {
  "status-inquiry": "commTplCat_statusInquiry",
  "stakeholder-update": "commTplCat_stakeholderUpdate",
};

export interface CommTemplatesSectionProps {
  lang: Lang;
  templates: CommTemplate[];
  onCreate: (category: CommTemplateCategory, name: string, body: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onSaveBody: (id: string, body: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSetDefault: (category: CommTemplateCategory, id: string) => Promise<void>;
  config: TursoConfig | null;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function CommTemplatesSection(props: CommTemplatesSectionProps) {
  const { lang, templates } = props;
  const showToast = useToastContext();
  const [category, setCategory] = useState<CommTemplateCategory>("status-inquiry");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const CURRENT_ID = "__current__";
  const inCategory = templates.filter((tpl) => tpl.category === category);
  // ★★ Built over `inCategory` — the RENDERED, category-filtered rows — not
  // over `templates`. A same-named template in the other category is not on
  // screen, so letting it consume an occurrence index would number the visible
  // rows (2)/(3) with no (1) anywhere.
  // ★ Template names are free text with no uniqueness constraint, so every
  // per-row control here (the name button, "Set as default" and "Delete") takes
  // the same token — an already-interpolated name is no more unique than a bare
  // verb when the name itself repeats.
  const rowTokens = buildRowTokens(inCategory.map((tpl) => ({ id: tpl.id, name: tpl.name })));
  const selected = inCategory.find((tpl) => tpl.id === selectedId) ?? null;

  const versions = useCommTemplateVersions({ active: props.config !== null, config: props.config, templateId: selectedId });
  // ★★ A version name is whatever `window.prompt` returned in
  // `saveCurrentVersion` — nothing on any backend constrains it — so two
  // versions can share one and BOTH of a row's controls (Compare, Restore)
  // interpolated it raw. Same free-text class as the template rows above.
  // ★ The CURRENT pseudo-row is in the SAME rendered list and carries the SAME
  // Compare verb, so it joins the map rather than sitting outside it: a user
  // who names a saved version "Current" collides with it, and only a map
  // spanning both can number the pair. It leads the list because it renders
  // first — the occurrence index has to follow what is on screen.
  const versionRowTokens = buildRowTokens<string>([
    { id: CURRENT_ID, name: t(lang, "commTplCurrent") },
    ...versions.versions.map((v) => ({ id: v.id, name: v.name })),
  ]);

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
    void props.onCreate(category, name, "").catch((e) =>
      reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"),
    );
    setNewName("");
  }

  function persistBody() {
    if (selected && bodyDraft !== selected.body) {
      void props.onSaveBody(selected.id, bodyDraft).catch((e) =>
        reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"),
      );
    }
  }

  function saveCurrentVersion() {
    if (!selected) return;
    const name = window.prompt(t(lang, "commTplVersionNamePrompt"), "");
    if (!name || !name.trim()) return;
    void versions.saveVersion(name.trim(), bodyDraft, false).catch((e) =>
      reportSilentFailure(showToast, lang, "commTemplateVersions.saveFailed", e, "guardCommVersionSaveFailed"),
    );
  }

  function cancelEdit() {
    if (!selected) return;
    setBodyDraft(selected.body);
    setRestoreNonce((n) => n + 1);
  }

  function restoreVersion(body: string) {
    if (!selected) return;
    const stamp = new Date().toISOString();
    void versions.saveVersion(`${t(lang, "commTplBeforeRestore")} — ${stamp}`, bodyDraft, true).catch((e) =>
      reportSilentFailure(showToast, lang, "commTemplateVersions.saveFailed", e, "guardCommVersionSaveFailed"),
    );
    setBodyDraft(body);
    void props.onSaveBody(selected.id, body).catch((e) =>
      reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"),
    );
    setRestoreNonce((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
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
              className={`h-4 w-4 cursor-pointer border-line text-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
            />
            <span>{t(lang, key)}</span>
          </label>
        ))}
        <FieldHint as="span">{t(lang, "commSendModeHint")}</FieldHint>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm text-foreground">
        <span className="font-medium">{t(lang, "commTplCategory")}</span>
        <Select
          size="xs"
          value={category}
          aria-label={t(lang, "commTplCategory")}
          onChange={(e) => { setCategory(e.target.value as CommTemplateCategory); setSelectedId(null); setBodyDraft(""); setCompareIds([]); }}
          className="w-full"
        >
          {COMM_TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(lang, CAT_LABEL_KEY[c])}</option>
          ))}
        </Select>
      </label>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm text-foreground">
          <span className="font-medium">{t(lang, "commTplName")}</span>
          <Input
            size="xs"
            type="text"
            value={newName}
            aria-label={t(lang, "commTplName")}
            placeholder={t(lang, "commTplNew")}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createTemplate(); }}
            className="w-full"
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={createTemplate}
          disabled={!newName.trim()}
        >
          {t(lang, "commTplCreate")}
        </Button>
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
            {inCategory.map((tpl) => {
              const token = rowTokens.get(tpl.id) ?? tpl.name;
              // The default badge is VISIBLE text inside this button, so it stays
              // in the accessible name — dropping it would lose information for
              // AT that every sighted user gets.
              // ★★ THIS IS NOT A CLEAN WCAG 2.5.3 PASS AND DO NOT RECORD IT AS
              // ONE. On a row whose name COLLIDES the token carries an occurrence
              // suffix, so the name reads "X (2) Default" while the visible label
              // reads "X Default" — 2.5.3 wants the visible label CONTAINED in
              // the accessible name, and the "(2)" interrupts it. Accepted
              // deliberately: it is strictly better than the status quo (which
              // failed 2.4.6 outright on every duplicate name), it bites only a
              // duplicate-named DEFAULT row, and the alternative — a second token
              // map built over the full visible label — puts two parallel maps in
              // this component that can drift apart. Revisit if a 2.5.3 gate ever
              // runs; axe's rule is experimental and cannot see this today.
              const rowName = tpl.isDefault ? `${token} ${t(lang, "commTplDefaultBadge")}` : token;
              return (
              <li key={tpl.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 transition-colors hover:border-ui-dark-blue/40 hover:bg-surface-muted">
                <button type="button" onClick={() => selectTemplate(tpl)} aria-label={rowName} title={t(lang, "commTplRowsClickableHint")} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left ${INTERACTIVE}`}>
                  <span className="truncate text-sm font-medium text-foreground">{tpl.name}</span>
                  {tpl.isDefault && (
                    <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground">
                      {t(lang, "commTplDefaultBadge")}
                    </span>
                  )}
                </button>
                <Button
                  variant="secondary"
                  size="xs"
                  className="shrink-0"
                  onClick={() =>
                    void props.onSetDefault(category, tpl.id).catch((e) =>
                      reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"),
                    )
                  }
                  disabled={tpl.isDefault}
                  aria-label={rowLabel(t(lang, "commTplSetDefault"), token)}
                >
                  {t(lang, "commTplSetDefault")}
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  className="shrink-0"
                  onClick={() => {
                    void props.onRemove(tpl.id).catch((e) =>
                      reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"),
                    );
                    if (selectedId === tpl.id) { setSelectedId(null); setBodyDraft(""); }
                  }}
                  aria-label={`${t(lang, "commTplDelete")}: ${token}`}
                >
                  {t(lang, "commTplDelete")}
                </Button>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-3">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            <span className="font-medium">{t(lang, "commTplRename")}</span>
            <Input
              key={selected.id}
              size="xs"
              type="text"
              defaultValue={selected.name}
              aria-label={t(lang, "commTplRename")}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => {
                const n = e.target.value.trim();
                if (n && n !== selected.name) {
                  void props.onRename(selected.id, n).catch((err) =>
                    reportSilentFailure(showToast, lang, "commTemplates.saveFailed", err, "guardCommTemplateSaveFailed"),
                  );
                }
              }}
              className="w-full"
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
              <Button
                variant="secondary"
                size="xs"
                className="shrink-0"
                onClick={cancelEdit}
              >
                {t(lang, "commTemplateCancelEdit")}
              </Button>
            </div>
            <RichTextEditor
              key={`${selected.id}:${restoreNonce}`}
              value={bodyDraft}
              onChange={setBodyDraft}
              label={t(lang, "commTplBody")}
              mergeFields={CATEGORY_FIELDS[category]}
              fieldLabel={(f) => t(lang, ("commTplField_" + f) as TranslationKey)}
              lang={lang}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t(lang, "commTplVersions")}</span>
              <Button
                variant="secondary"
                size="xs"
                className="shrink-0"
                onClick={saveCurrentVersion}
              >
                {t(lang, "commTplSaveVersion")}
              </Button>
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
                  aria-label={`${t(lang, "commTplCompare")}: ${versionRowTokens.get(CURRENT_ID) ?? t(lang, "commTplCurrent")}`}
                  className={`${compareIds.includes(CURRENT_ID)
                    ? "shrink-0 rounded-md border border-line bg-ui-dark-blue px-2 py-0.5 text-[11px] text-white"
                    : "shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"} ${INTERACTIVE}`}
                >
                  {t(lang, "commTplCompare")}
                </button>
              </li>
              {versions.versions.map((v) => {
                // Cannot miss: the map is built over this exact list, keyed on
                // the same `v.id`. The fallback keeps the pre-token behaviour
                // rather than rendering an unnamed control if it ever did.
                const vToken = versionRowTokens.get(v.id) ?? v.name;
                return (
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
                    aria-label={`${t(lang, "commTplCompare")}: ${vToken}`}
                    className={`${compareIds.includes(v.id)
                      ? "shrink-0 rounded-md border border-line bg-ui-dark-blue px-2 py-0.5 text-[11px] text-white"
                      : "shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"} ${INTERACTIVE}`}
                  >
                    {t(lang, "commTplCompare")}
                  </button>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="shrink-0"
                    onClick={() => restoreVersion(v.body)}
                    aria-label={`${t(lang, "commTplRestore")}: ${vToken}`}
                  >
                    {t(lang, "commTplRestore")}
                  </Button>
                </li>
                );
              })}
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
