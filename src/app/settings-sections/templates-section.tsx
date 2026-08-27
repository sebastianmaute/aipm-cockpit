"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";
import { Checkbox, Input } from "../form-controls";
import { EmptyState } from "../empty-state";
import { deriveMode } from "../feature-modules";
import { templateFromWorkspace, type ProjectTemplate } from "../templates";
import { useTemplates } from "../use-templates";
import { useCurrentWorkspace } from "../use-current-workspace";
import { useSettings } from "../use-settings";
import { buildRowTokens, rowLabel } from "../row-tokens";

// Module-scope accessor (see use-row-tokens.ts): a fresh inline arrow would
// defeat the memo and trip react-hooks/exhaustive-deps (fatal here).
// `ProjectTemplate.id` is a string, so `useRowTokens` (constrained to
// `{ id: number }`) does not fit — this calls `buildRowTokens` directly.
const nameOfTemplate = (tpl: ProjectTemplate) => tpl.name;

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
  const { templates, userTemplates, addTemplate, updateTemplate, removeTemplate } =
    useTemplates();
  const buildCurrentWorkspace = useCurrentWorkspace();
  const { settings } = useSettings();
  const [name, setName] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const builtIns = templates.filter((tpl) => tpl.builtIn);

  // Built over `userTemplates` — the same array rendered below — so the
  // occurrence numbering matches what a screen-reader user navigates.
  const userTemplateTokens = useMemo(
    () => buildRowTokens(userTemplates.map((tpl) => ({ id: tpl.id, name: nameOfTemplate(tpl) }))),
    [userTemplates],
  );

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
        <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "settingsSectionTemplates")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "templatesIntro")}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t(lang, "templatesSaveCurrent")}
        </h3>
        <Input
          type="text"
          size="xs"
          className="w-full"
          value={name}
          aria-label={t(lang, "templateSaveName")}
          placeholder={t(lang, "templateSaveName")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveCurrent();
          }}
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={includeContent}
            aria-label={t(lang, "templateIncludeContent")}
            onChange={(e) => setIncludeContent(e.target.checked)}
          />
          <span>{t(lang, "templateIncludeContent")}</span>
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveCurrent}
            disabled={!trimmed}
            className={`shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
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
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t(lang, "templatesYoursLabel")}
        </h3>
        {userTemplates.length === 0 ? (
          <EmptyState compact title={t(lang, "templatesEmpty")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {userTemplates.map((tpl) => {
              // ★ Cannot miss: userTemplateTokens is built from this same
              // .map()'s own userTemplates array, via buildRowTokens covering
              // every id in it.
              const token = userTemplateTokens.get(tpl.id) ?? tpl.name;
              return (
              <li
                key={tpl.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input
                    type="text"
                    size="xs"
                    className="w-full"
                    defaultValue={tpl.name}
                    aria-label={rowLabel(t(lang, "templatesRename"), token)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== tpl.name) updateTemplate(tpl.id, { name });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{modeSummary(lang, tpl)}</span>
                </span>
                {/* ★★★ Found beyond the plan: this button carried NO
                    aria-label at all, so its accessible name fell back to its
                    CONTENT — the constant translated "Delete", identical for
                    EVERY row regardless of template name (see
                    use-row-tokens.ts's note on this landmine). Set
                    unconditionally, not only under a collision. */}
                <button
                  type="button"
                  onClick={() => removeTemplate(tpl.id)}
                  aria-label={rowLabel(t(lang, "templatesDelete"), token)}
                  className={`shrink-0 rounded-md border border-line px-3 py-1.5 text-sm text-ui-purple hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {t(lang, "templatesDelete")}
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
