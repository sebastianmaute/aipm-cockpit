"use client";

// Two header dropdowns that wire the project-template library into the per-
// project actions cluster, mirroring ExportMenu's popover UX (a small icon
// button toggling a popover; same AIPM palette tokens):
//
//   • SaveTemplateMenu  — capture the current project as a reusable template
//                         (name + "include current content as starter").
//   • ApplyTemplateMenu — stamp a saved template onto the current project
//                         (pick a template + optional starter seed).
//
// Both are PRESENTATIONAL: all data + handlers arrive via props, no hooks or
// data-fetching inside, so they're unit-testable in isolation. The parent owns
// useTemplates()/useWorkspace() and builds the workspace + toast side effects.

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { PopoverPanel } from "./popover-panel";
import { Checkbox, Input, Select } from "./form-controls";
import { type Lang, t } from "./i18n";
import type { ProjectTemplate } from "./templates";
import type { SaveTemplateInput } from "./templates";

const TRIGGER_CLASS =
  "rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-muted-foreground dark:hover:text-ui-light-grey";

const POPOVER_CLASS = "w-72 overflow-y-auto p-3";

const HEADING_CLASS =
  "mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const PRIMARY_BTN_CLASS =
  "rounded-md bg-ui-green px-3 py-1.5 text-sm font-medium text-ui-dark-blue hover:bg-ui-dark-blue hover:text-ui-white focus:outline-none focus:ring-2 focus:ring-ui-green disabled:cursor-not-allowed disabled:opacity-50";

/** A "save as template" tray icon (a tagged bookmark). */
function SaveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
      <path d="M5 2.75A1.75 1.75 0 016.75 1h6.5A1.75 1.75 0 0115 2.75v14.5a.75.75 0 01-1.2.6L10 15l-3.8 2.85a.75.75 0 01-1.2-.6V2.75z" />
    </svg>
  );
}

/** An "apply template" stacked-layers icon. */
function ApplyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
      <path d="M10 1.5l8 4-8 4-8-4 8-4zM2.6 9.2l7.4 3.7 7.4-3.7 1.6.8-9 4.5-9-4.5 1.6-.8zm0 4l7.4 3.7 7.4-3.7 1.6.8-9 4.5-9-4.5 1.6-.8z" />
    </svg>
  );
}

export interface SaveTemplateMenuProps {
  lang: Lang;
  onSave: (input: SaveTemplateInput) => void;
}

export function SaveTemplateMenu({ lang, onSave }: SaveTemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const checkboxId = useId();

  const trimmed = name.trim();

  function submit() {
    if (!trimmed) return;
    onSave({ name: trimmed, includeContent });
    setOpen(false);
    setName("");
    setIncludeContent(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "templateSaveTitle")}
        aria-expanded={open}
        title={t(lang, "templateSaveTitle")}
        className={TRIGGER_CLASS}
      >
        <SaveIcon />
      </button>

      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "templateSaveTitle")}
        className={POPOVER_CLASS}
      >
        <h3 className={HEADING_CLASS}>{t(lang, "templateSaveTitle")}</h3>
          <div className="space-y-3">
            <Input
              type="text"
              size="xs"
              className="w-full"
              aria-label={t(lang, "templateSaveName")}
              placeholder={t(lang, "templateSaveName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                id={checkboxId}
                aria-label={t(lang, "templateIncludeContent")}
                checked={includeContent}
                onChange={(e) => setIncludeContent(e.target.checked)}
              />
              <span>{t(lang, "templateIncludeContent")}</span>
            </label>
            <p className="text-xs text-muted-foreground">
              {t(lang, "templateSaveCaptures")}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={!trimmed}
                className={PRIMARY_BTN_CLASS}
              >
                {t(lang, "templateSaveAction")}
              </button>
            </div>
          </div>
      </PopoverPanel>
    </div>
  );
}

export interface ApplyTemplateMenuProps {
  lang: Lang;
  templates: readonly ProjectTemplate[];
  onApply: (id: string, opts: { includeSeed: boolean }) => void;
}

/** Count the seed entities a template carries, for the popover summary line. */
function seedCount(tpl: ProjectTemplate | undefined): number {
  const s = tpl?.seed;
  if (!s) return 0;
  return (
    (s.tasks?.length ?? 0) +
    (s.milestones?.length ?? 0) +
    (s.raid?.length ?? 0) +
    (s.changes?.length ?? 0) +
    (s.stakeholders?.length ?? 0) +
    (s.budgets?.length ?? 0)
  );
}

/**
 * Per-entity breakdown of a template's seed, e.g. "12 tasks, 3 milestones,
 * 5 RAID", listing only non-empty collections. Presentational only.
 */
function seedBreakdown(lang: Lang, tpl: ProjectTemplate | undefined): string {
  const s = tpl?.seed;
  if (!s) return "";
  const parts: string[] = [];
  const add = (n: number | undefined, label: string) => {
    if (n) parts.push(`${n} ${label}`);
  };
  add(s.tasks?.length, t(lang, "tasks"));
  add(s.milestones?.length, t(lang, "navMilestones"));
  add(s.raid?.length, t(lang, "tabRaid"));
  add(s.changes?.length, t(lang, "navChanges"));
  add(s.stakeholders?.length, t(lang, "navStakeholders"));
  add(s.budgets?.length, t(lang, "tabBudget"));
  return parts.join(", ");
}

export function ApplyTemplateMenu({ lang, templates, onApply }: ApplyTemplateMenuProps) {
  const [open, setOpen] = useState(false);
  // `null` = "follow the default (first template)". A user pick sets an explicit
  // id; if that id later disappears from the list we fall back to the default
  // during render — no effect / no cascading set-state.
  const [picked, setPicked] = useState<string | null>(null);
  const [includeSeed, setIncludeSeed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const checkboxId = useId();
  const seedDescId = useId();

  const selectedId = useMemo(() => {
    if (picked && templates.some((tpl) => tpl.id === picked)) return picked;
    return templates[0]?.id ?? "";
  }, [picked, templates]);

  const selected = useMemo(
    () => templates.find((tpl) => tpl.id === selectedId),
    [templates, selectedId],
  );
  const count = seedCount(selected);
  const breakdown = seedBreakdown(lang, selected);
  const hasTemplates = templates.length > 0;

  function submit() {
    if (!selectedId) return;
    onApply(selectedId, { includeSeed });
    setOpen(false);
    setIncludeSeed(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "templateApplyTitle")}
        aria-expanded={open}
        title={t(lang, "templateApplyTitle")}
        className={TRIGGER_CLASS}
      >
        <ApplyIcon />
      </button>

      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "templateApplyTitle")}
        className={POPOVER_CLASS}
      >
        <h3 className={HEADING_CLASS}>{t(lang, "templateApplyTitle")}</h3>
          <div className="space-y-3">
            <Select
              size="xs"
              className="w-full"
              aria-label={t(lang, "templatePick")}
              value={selectedId}
              onChange={(e) => setPicked(e.target.value)}
              disabled={!hasTemplates}
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(lang, "templateApplyReplacesFv")}
            </p>
            {count > 0 && (
              <p id={seedDescId} className="text-xs text-muted-foreground">
                {t(lang, "templateIncludeSeed")} ({breakdown})
              </p>
            )}
            <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                id={checkboxId}
                aria-label={t(lang, "templateIncludeSeed")}
                aria-describedby={count > 0 ? seedDescId : undefined}
                checked={includeSeed}
                onChange={(e) => setIncludeSeed(e.target.checked)}
              />
              <span>{t(lang, "templateIncludeSeed")}</span>
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={!hasTemplates}
                className={PRIMARY_BTN_CLASS}
              >
                {t(lang, "templateApplyAction")}
              </button>
            </div>
          </div>
      </PopoverPanel>
    </div>
  );
}
