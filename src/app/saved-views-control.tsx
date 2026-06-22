"use client";

import type React from "react";
import { useState } from "react";

import { type Lang, t } from "./i18n";
import { useFilters } from "./filters-context";
import { useSavedViews } from "./use-saved-views";
import { type SavedView, type SavedViewPayload } from "./saved-views";

interface SavedViewsControlProps {
  lang: Lang;
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
}

const INPUT_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:ring-AIPM-green";
const BTN_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50";

export function SavedViewsControl({ lang, hiddenCols, setHiddenCols }: SavedViewsControlProps) {
  const f = useFilters();
  const { views, addView, removeView } = useSavedViews();

  const [selectedId, setSelectedId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  // A previously-selected id may have been evicted (cap of MAX_SAVED_VIEWS)
  // by a later save. Derive the effective selection so a stale id renders the
  // placeholder and disables Delete. Pure render derivation — no state/effect.
  const selectionValid = selectedId !== "" && views.some((v) => v.id === selectedId);
  const selectValue = selectionValid ? String(selectedId) : "";

  function capturePayload(): SavedViewPayload {
    return {
      search: f.search,
      priorityFilter: f.priorityFilter,
      assigneeFilter: f.assigneeFilter,
      groupFilter: f.groupFilter,
      labelFilter: f.labelFilter,
      sortKey: f.sortKey,
      sortDir: f.sortDir,
      hiddenCols: [...hiddenCols],
    };
  }

  function applyView(v: SavedView) {
    f.setSearchImmediate(v.payload.search);
    f.setPriorityFilter(v.payload.priorityFilter);
    f.setAssigneeFilter(v.payload.assigneeFilter);
    f.setGroupFilter(v.payload.groupFilter);
    f.setLabelFilter(v.payload.labelFilter);
    f.setSortKey(v.payload.sortKey);
    f.setSortDir(v.payload.sortDir);
    f.setRaidFilterTaskId(null);
    setHiddenCols(new Set(v.payload.hiddenCols));
  }

  return (
    <div className="inline-flex items-center gap-1">
      <select
        aria-label={t(lang, "savedViewsApply")}
        value={selectValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setSelectedId("");
            return;
          }
          const id = Number(raw);
          setSelectedId(id);
          const v = views.find((x) => x.id === id);
          if (v) applyView(v);
        }}
        className={INPUT_CLASS}
      >
        <option value="">{t(lang, "savedViewsPlaceholder")}</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>

      {saving ? (
        <>
          <input
            aria-label={t(lang, "savedViewsName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            aria-label={t(lang, "savedViewsSave")}
            onClick={() => {
              const n = name.trim();
              if (n) addView(n, capturePayload());
              setSaving(false);
              setName("");
            }}
            className={BTN_CLASS}
          >
            {t(lang, "savedViewsSaveConfirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSaving(false);
              setName("");
            }}
            className={BTN_CLASS}
          >
            {t(lang, "savedViewsCancel")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSaving(true);
            setName("");
          }}
          className={BTN_CLASS}
        >
          {t(lang, "savedViewsSave")}
        </button>
      )}

      <button
        type="button"
        aria-label={t(lang, "savedViewsDelete")}
        title={t(lang, "savedViewsDelete")}
        disabled={!selectionValid}
        onClick={() => {
          if (selectionValid) {
            removeView(Number(selectedId));
            setSelectedId("");
          }
        }}
        className={BTN_CLASS}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
