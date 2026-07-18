"use client";

import { useState } from "react";

import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { Input, Select } from "./form-controls";

/** The minimal shape the menu needs from any saved-view record. The three
 *  stores (tasks `SavedView`, generic `PanelView`, `ReportsSavedView`) all carry
 *  `id` + `name` plus their own state payload — only these two are used here. */
export interface SavedViewsMenuOption {
  id: number;
  name: string;
}

interface SavedViewsMenuProps {
  lang: Lang;
  views: readonly SavedViewsMenuOption[];
  /** Apply the saved view with this id (caller reads its own store + applies). */
  onApplyView: (id: number) => void;
  /** Persist the current filter/sort state under a (trimmed, non-empty) name. */
  onSaveView: (name: string) => void;
  onDeleteView: (id: number) => void;
}

const BTN_CLASS =
  `rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50 ${INTERACTIVE}`;

/**
 * Presentational select + save-as + delete shell shared by the three saved-view
 * controls (`PanelViewsControl` / `SavedViewsControl` / `ReportsViewsControl`).
 * Owns only the local UI state (selection, save-name draft); the divergent
 * store apply/capture/delete logic stays in each wrapper via the callbacks.
 */
export function SavedViewsMenu({ lang, views, onApplyView, onSaveView, onDeleteView }: SavedViewsMenuProps) {
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  // A previously-selected id may have been evicted (store cap) by a later save.
  // Derive the effective selection so a stale id renders the placeholder and
  // disables Delete. Pure render derivation — no state/effect.
  const selectionValid = selectedId !== "" && views.some((v) => v.id === selectedId);
  const selectValue = selectionValid ? String(selectedId) : "";

  return (
    <div className="inline-flex items-center gap-1">
      <Select
        size="xs"
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
          onApplyView(id);
        }}
      >
        <option value="">{t(lang, "savedViewsPlaceholder")}</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </Select>

      {saving ? (
        <>
          <Input
            size="xs"
            aria-label={t(lang, "savedViewsName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            aria-label={t(lang, "savedViewsSave")}
            disabled={name.trim() === ""}
            onClick={() => {
              const n = name.trim();
              if (n) onSaveView(n);
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
            onDeleteView(Number(selectedId));
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
