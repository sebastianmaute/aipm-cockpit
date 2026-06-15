"use client";
import { useRef, useState } from "react";
import { type Lang, t, type TranslationKey } from "../i18n";
import { COMM_TEMPLATE_CATEGORIES, CATEGORY_FIELDS, type CommTemplate, type CommTemplateCategory } from "../comm-templates";

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
}

export function CommTemplatesSection(props: CommTemplatesSectionProps) {
  const { lang, templates } = props;
  const [category, setCategory] = useState<CommTemplateCategory>("status-inquiry");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const inCategory = templates.filter((tpl) => tpl.category === category);
  const selected = inCategory.find((tpl) => tpl.id === selectedId) ?? null;

  function selectTemplate(tpl: CommTemplate) {
    setSelectedId(tpl.id);
    setBodyDraft(tpl.body);
  }

  function createTemplate() {
    const name = newName.trim();
    if (!name) return;
    props.onCreate(category, name, "");
    setNewName("");
  }

  function insertField(field: string) {
    const token = `{{${field}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? bodyDraft.length;
    const end = el?.selectionEnd ?? bodyDraft.length;
    setBodyDraft(bodyDraft.slice(0, start) + token + bodyDraft.slice(end));
    requestAnimationFrame(() => {
      if (!bodyRef.current) return;
      bodyRef.current.focus();
      const pos = start + token.length;
      bodyRef.current.setSelectionRange(pos, pos);
    });
  }

  function persistBody() {
    if (selected && bodyDraft !== selected.body) props.onSaveBody(selected.id, bodyDraft);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "settingsSectionCommTemplates")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "commTplIntro")}</p>
      </div>

      <label className="flex flex-col gap-1 text-sm text-foreground">
        <span className="font-medium">{t(lang, "commTplCategory")}</span>
        <select
          value={category}
          aria-label={t(lang, "commTplCategory")}
          onChange={(e) => { setCategory(e.target.value as CommTemplateCategory); setSelectedId(null); setBodyDraft(""); }}
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
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(lang, "commTplCreate")}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{t(lang, CAT_LABEL_KEY[category])}</h3>
        {inCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "commTplEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inCategory.map((tpl) => (
              <li key={tpl.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
                <button type="button" onClick={() => selectTemplate(tpl)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
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
                  className="shrink-0 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t(lang, "commTplSetDefault")}
                </button>
                <button
                  type="button"
                  onClick={() => { props.onRemove(tpl.id); if (selectedId === tpl.id) { setSelectedId(null); setBodyDraft(""); } }}
                  aria-label={`${t(lang, "commTplDelete")}: ${tpl.name}`}
                  className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-AIPM-purple hover:bg-surface-muted"
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

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t(lang, "commTplMergeFields")}</span>
            <div className="flex flex-wrap gap-1">
              {CATEGORY_FIELDS[category].map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => insertField(field)}
                  className="rounded-md border border-line px-2 py-1 text-xs text-foreground hover:bg-surface-muted"
                >
                  {t(lang, ("commTplField_" + field) as TranslationKey)}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm text-foreground">
            <span className="font-medium">{t(lang, "commTplBody")}</span>
            <textarea
              ref={bodyRef}
              value={bodyDraft}
              aria-label={t(lang, "commTplBody")}
              rows={8}
              onChange={(e) => setBodyDraft(e.target.value)}
              onBlur={persistBody}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            />
          </label>
        </div>
      )}
    </div>
  );
}
