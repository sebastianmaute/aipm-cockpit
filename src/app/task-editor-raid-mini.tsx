"use client";

import { type ReactNode, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Button } from "./button";
import { Input, Select } from "./form-controls";
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
  /** Rendered at the end of whichever row is showing: beside the toggle when
   *  collapsed, after Add in the bottom-aligned form row when open. The caller
   *  never needs to know which. */
  trailing?: ReactNode;
}

/**
 * Collapsible "+ Create RAID" mini-form for the task editor. Reveals a
 * [category][title][Add] row; on Add it emits `{category,title}` and clears the
 * title. Renders the pending (buffered) specs so create-mode staging is visible.
 * Pure surface — the parent owns validation (sanitizeRaidItem) and persistence.
 */
export function TaskEditorRaidMini({ lang, onAdd, pending, trailing }: TaskEditorRaidMiniProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RaidCategory>("R");
  const [title, setTitle] = useState("");

  const handleAdd = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd({ category, title: trimmed });
    setTitle("");
  };

  return (
    <div className="space-y-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {`+ ${t(lang, "taskEditorCreateRaid")}`}
          </Button>
          {trailing}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t(lang, "raidCategory")}
            <Select
              size="xs"
              aria-label={`RAID ${t(lang, "raidCategory")}`}
              value={category}
              onChange={(e) => setCategory(e.target.value as RaidCategory)}
            >
              {RAID_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(lang, CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t(lang, "raidTitle")}
            <Input
              type="text"
              size="xs"
              aria-label={`RAID ${t(lang, "raidTitle")}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className="min-w-[10rem]"
            />
          </label>
          <Button size="sm" onClick={handleAdd}>
            {t(lang, "add")}
          </Button>
          {trailing}
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
