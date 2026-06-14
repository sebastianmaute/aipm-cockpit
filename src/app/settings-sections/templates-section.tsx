"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { deriveMode } from "../feature-modules";
import { templateFromWorkspace, type ProjectTemplate } from "../templates";
import { useTemplates } from "../use-templates";
import { useCurrentWorkspace } from "../use-current-workspace";
import { useSettings } from "../use-settings";

interface TemplatesSectionProps {
  lang: Lang;
}

const MODE_LABEL_KEY = {
  simple: "modeSimple",
  modular: "modeModular",
  advanced: "modeAdvanced",
} as const;

/** Short, human summary of what a template configures (its derived mode). */
function modeSummary(lang: Lang, tpl: ProjectTemplate): string {
  return t(lang, MODE_LABEL_KEY[deriveMode(tpl.features)]);
}

/** Generate a new template id, preferring crypto.randomUUID. */
function newTemplateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function TemplatesSection({ lang }: TemplatesSectionProps) {
  const { templates, userTemplates, addTemplate, updateTemplate, removeTemplate, duplicateTemplate } =
    useTemplates();
  const buildCurrentWorkspace = useCurrentWorkspace();
  const { settings } = useSettings();
  const [name, setName] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const builtIns = templates.filter((tpl) => tpl.builtIn);

  const trimmed = name.trim();
  function saveCurrent() {
    if (!trimmed) return;
    addTemplate(
      templateFromWorkspace(
        buildCurrentWorkspace(),
        settings.features,
        { name: trimmed, includeContent },
        newTemplateId(),
      ),
    );
    setName("");
    setIncludeContent(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "settingsSectionTemplates")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "templatesIntro")}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t(lang, "templatesSaveCurrent")}
        </h3>
        <input
          type="text"
          value={name}
          aria-label={t(lang, "templateSaveName")}
          placeholder={t(lang, "templateSaveName")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveCurrent();
          }}
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={includeContent}
            aria-label={t(lang, "templateIncludeContent")}
            onChange={(e) => setIncludeContent(e.target.checked)}
            className="h-4 w-4 rounded border-line text-AIPM-green-strong focus:ring-AIPM-green"
          />
          <span>{t(lang, "templateIncludeContent")}</span>
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveCurrent}
            disabled={!trimmed}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "templateSaveAction")}
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t(lang, "templatesBuiltInLabel")}
        </h3>
        <ul className="flex flex-col gap-2">
          {builtIns.map((tpl) => (
            <li
              key={tpl.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{tpl.name}</span>
                <span className="text-xs text-muted-foreground">{modeSummary(lang, tpl)}</span>
              </span>
              <button
                type="button"
                onClick={() => duplicateTemplate(tpl.id)}
                className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                {t(lang, "templatesDuplicate")}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t(lang, "templatesYoursLabel")}
        </h3>
        {userTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "templatesEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {userTemplates.map((tpl) => (
              <li
                key={tpl.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    type="text"
                    defaultValue={tpl.name}
                    aria-label={t(lang, "templatesRename")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== tpl.name) updateTemplate(tpl.id, { name });
                    }}
                    className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
                  />
                  <span className="text-xs text-muted-foreground">{modeSummary(lang, tpl)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeTemplate(tpl.id)}
                  className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm text-AIPM-purple hover:bg-surface-muted"
                >
                  {t(lang, "templatesDelete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
