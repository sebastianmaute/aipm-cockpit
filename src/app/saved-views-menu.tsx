"use client";

import { useState } from "react";

import { type Lang, t } from "./i18n";
import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import { Button } from "./button";
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
  /** Optional guided-tour anchor, put on the root so no empty wrapper is needed. */
  dataTourId?: string;
}

/**
 * Presentational select + save-as + delete shell shared by the three saved-view
 * controls (`PanelViewsControl` / `SavedViewsControl` / `ReportsViewsControl`).
 * Owns only the local UI state (selection, save-name draft); the divergent
 * store apply/capture/delete logic stays in each wrapper via the callbacks.
 */
export function SavedViewsMenu({ lang, views, onApplyView, onSaveView, onDeleteView, dataTourId }: SavedViewsMenuProps) {
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  // A previously-selected id may have been evicted (store cap) by a later save.
  // Derive the effective selection so a stale id renders the placeholder and
  // disables Delete. Pure render derivation — no state/effect.
  const selectionValid = selectedId !== "" && views.some((v) => v.id === selectedId);
  const selectValue = selectionValid ? String(selectedId) : "";

  return (
    <div className="inline-flex items-center gap-1" data-tour-id={dataTourId}>
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
          <Button variant="secondary" size="xs"
            aria-label={t(lang, "savedViewsSave")}
            disabled={name.trim() === ""}
            onClick={() => {
              const n = name.trim();
              if (n) onSaveView(n);
              setSaving(false);
              setName("");
            }}
          >
            {t(lang, "savedViewsSaveConfirm")}
          </Button>
          <Button variant="secondary" size="xs"
            onClick={() => {
              setSaving(false);
              setName("");
            }}
          >
            {t(lang, "savedViewsCancel")}
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="xs"
          onClick={() => {
            setSaving(true);
            setName("");
          }}
        >
          {t(lang, "savedViewsSave")}
        </Button>
      )}

      {/* ★ `md`, not the `sm` default: this sits in one `items-center` row beside the
          BTN_CLASS buttons (`border` + `py-1` + `text-sm`/20px line-height = 30px), and
          it replaced a button that used BTN_CLASS itself. `sm` (`p-1` + a 16px icon +
          `border` = 26px) shrank it below its neighbours; `md` (`p-1.5` → 30px) restores
          the pre-change height exactly. Derived from the class recipes — jsdom has no
          layout, so no unit test can see this. */}
      <IconButton
        variant="bordered"
        size="md"
        label={t(lang, "savedViewsDelete")}
        title={t(lang, "savedViewsDelete")}
        disabled={!selectionValid}
        onClick={() => {
          if (selectionValid) {
            onDeleteView(Number(selectedId));
            setSelectedId("");
          }
        }}
      >
        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
      </IconButton>
    </div>
  );
}
