"use client";

import { useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { Button } from "./button";
import { RAID_CATEGORIES, type RaidCategory } from "./types";
import type { RaidSpec } from "./use-task-editor-buffer";

const CATEGORY_LABEL_KEY: Record<RaidCategory, TranslationKey> = {
  R: "raidCategoryR",
  A: "raidCategoryA",
  I: "raidCategoryI",
  D: "raidCategoryD",
};

export interface TaskEditorRaidMiniProps {
  lang: Lang;
  onAdd: (spec: RaidSpec) => void;
  /** Create-mode staged specs (buffered until the parent id exists). */
  pending: readonly RaidSpec[];
}

/**
 * Collapsible "+ Create RAID" mini-form for the task editor. Reveals a
 * [category][title][Add] row; on Add it emits `{category,title}` and clears the
 * title. Renders the pending (buffered) specs so create-mode staging is visible.
 * Pure surface — the parent owns validation (sanitizeRaidItem) and persistence.
 */
export function TaskEditorRaidMini({ lang, onAdd, pending }: TaskEditorRaidMiniProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RaidCategory>("R");
  const [title, setTitle] = useState("");

  const handleAdd = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd({ category, title: trimmed });
    setTitle("");
  };

  const fieldClass = `rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground dark:border-line dark:bg-surface dark:text-foreground ${FOCUS_RING} ${TRANSITION}`;

  return (
    <div className="space-y-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ui-dark-blue hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-ui-light-grey dark:hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {`+ ${t(lang, "taskEditorCreateRaid")}`}
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t(lang, "raidCategory")}
            <select
              aria-label={`RAID ${t(lang, "raidCategory")}`}
              value={category}
              onChange={(e) => setCategory(e.target.value as RaidCategory)}
              className={fieldClass}
            >
              {RAID_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(lang, CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t(lang, "raidTitle")}
            <input
              type="text"
              aria-label={`RAID ${t(lang, "raidTitle")}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className={`min-w-[10rem] ${fieldClass}`}
            />
          </label>
          <Button size="sm" onClick={handleAdd}>
            {t(lang, "add")}
          </Button>
        </div>
      )}
      {pending.length > 0 && (
        <ul className="space-y-1">
          {pending.map((spec, i) => (
            <li
              key={`${spec.category}-${i}`}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 font-medium text-ui-dark-blue dark:text-ui-light-grey">
                {t(lang, CATEGORY_LABEL_KEY[(spec.category as RaidCategory) in CATEGORY_LABEL_KEY ? (spec.category as RaidCategory) : "R"])}
              </span>
              <span className="truncate">{spec.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
