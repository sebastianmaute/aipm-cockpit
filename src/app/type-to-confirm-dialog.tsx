"use client";

// Reusable destructive-confirmation dialog. The confirm button stays disabled
// until the user types the required value (e.g. the project's exact name) into
// the input. Used for permanent (hard) project deletion. Palette-safe: the
// destructive action uses AIPM-pink.

import { useState } from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";

export interface TypeToConfirmDialogProps {
  lang: Lang;
  title: string;
  message: string;
  /** The exact string the user must type to enable the confirm button. */
  confirmValue: string;
  /** Label for the destructive confirm button. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const TITLE_ID = "type-to-confirm-title";

export function TypeToConfirmDialog({
  lang,
  title,
  message,
  confirmValue,
  confirmLabel,
  onConfirm,
  onCancel,
}: TypeToConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const matched = typed === confirmValue;

  return (
    <Modal
      open
      onClose={onCancel}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-AIPM-dark-blue/50"
      zIndex={60}
    >
      <div
        data-modal-panel
        className="relative flex w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={title} titleId={TITLE_ID} onClose={onCancel} />
        <div className="flex flex-col gap-4 p-6">
          <p className="text-sm text-foreground">{message}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t(lang, "typeToConfirmPrompt", confirmValue)}
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={t(lang, "typeToConfirmPrompt", confirmValue)}
              autoComplete="off"
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="button"
              disabled={!matched}
              onClick={onConfirm}
              className="rounded-md border border-AIPM-pink/50 bg-AIPM-pink px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-pink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
