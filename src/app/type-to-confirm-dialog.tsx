"use client";

// Reusable destructive-confirmation dialog. The confirm button stays disabled
// until the user types the required value (e.g. the project's exact name) into
// the input. Used for permanent (hard) project deletion. Palette-safe: the
// destructive action uses ui-pink.

import { useId, useState } from "react";
import { t, type Lang } from "./i18n";
import { Input } from "./form-controls";
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

export function TypeToConfirmDialog({
  lang,
  title,
  message,
  confirmValue,
  confirmLabel,
  onConfirm,
  onCancel,
}: TypeToConfirmDialogProps) {
  // ★★ §326. Per-INSTANCE ids. These were module constants, and two mounted
  // dialogs then put duplicate ids in the document: `aria-labelledby` and
  // `aria-describedby` resolve to whichever element comes first in document
  // order, so the wrong dialog's title and mismatch text were announced — no
  // visible symptom, nothing thrown. Measured in Chromium: with both open, the
  // Delete-selected dialog announced "Clear all tasks?" as its own name.
  // ★ Reachable via the VOICE clearAll path, not by two toolbar clicks —
  // `Modal`'s `fixed inset-0` backdrop intercepts pointer events, so a second
  // toolbar button cannot be clicked while a dialog is open. The nonce
  // reconcile in `tasks-section.tsx` opens the second dialog with no click at
  // all. This also retires an unwritten "only one may be mounted" rule that no
  // gate could ever have enforced.
  const titleId = useId();
  const mismatchId = useId();
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  // ★ Trim, do NOT case-fold. A trailing space arrives whenever the phrase is
  // copied out of the prompt above, and a dead button with no explanation is
  // the same silent failure this dialog's mismatch message exists to end.
  // Case-folding would weaken a deliberate destructive gate, and `confirmValue`
  // is sometimes a project NAME, where case is meaningful.
  // ★ BOTH sides are trimmed, because two of the six call sites pass an entity
  // NAME rather than a fixed phrase, and trimming only one side would make a
  // whitespace-bearing name unmatchable while the prompt renders it as if it
  // were fine — a permanently dead button, now compounded by a mismatch message
  // telling the user their exactly-correct input does not match.
  // ★ A blank `confirmValue` can never match. Trimming both sides would
  // otherwise make an untouched EMPTY field satisfy the gate the moment the
  // dialog opens — a permanently armed irreversible action requiring no typing
  // at all. The dialog must not depend on a caller three files away validating
  // its phrase.
  const matched = confirmValue.trim() !== "" && typed.trim() === confirmValue.trim();
  // ★ Gated until the first blur OR the first Enter keypress, live thereafter:
  // `touched` never resets, so once either has happened the message updates on
  // every keystroke. The text node only mutates on a matched↔mismatched flip,
  // so a screen reader gets one announcement per flip, not one per character of
  // a 30-character phrase.
  // ★★ Enter is the second gate because a DISABLED button dispatches no mouse
  // events: "type the wrong phrase, click the dead Confirm" never blurs the
  // input, so the blur gate alone leaves the most natural recourse path silent —
  // the exact failure this message exists to end.
  // ★ The second conjunct is `typed !== ""`, NOT `typed.trim() !== ""` —
  // whitespace-only input is a real mismatch and must say so (a visibly
  // non-empty field with a dead button and no explanation is the exact
  // silent failure this message exists to end); an untouched EMPTY field
  // stays silent on blur, which this conjunct also preserves.
  const showMismatch = touched && typed !== "" && !matched;

  return (
    <Modal
      open
      onClose={onCancel}
      ariaLabelledby={titleId}
      align="center"
      backdropClassName="bg-ui-dark-blue/50"
      zIndex={60}
    >
      <div
        data-modal-panel
        className="relative flex w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={title} titleId={titleId} onClose={onCancel} />
        <div className="flex flex-col gap-4 p-6">
          <p className="text-sm text-foreground">{message}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t(lang, "typeToConfirmPrompt", confirmValue)}
            </span>
            <Input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setTouched(true);
              }}
              aria-label={t(lang, "typeToConfirmPrompt", confirmValue)}
              invalid={showMismatch}
              aria-describedby={showMismatch ? mismatchId : undefined}
              autoComplete="off"
            />
            {/* ★ ALWAYS mounted, content swapped — a live region added to the DOM
                at the same moment it gains text is not reliably announced.
                ★ Hand-rolled rather than the shared `FieldError` (`field-feedback.tsx`)
                for two reasons: `FieldError` returns null on falsy children, which
                is exactly the mount-and-populate shape this comment insists on; and
                it uses role="alert" (assertive), where this blur-gated notice wants
                role="status" (polite) instead. `text-ui-pink-strong` (not the raw
                `text-ui-pink` fill/border token) is the AA-derived text color — see
                globals.css and scheme-tokens.ts `nudgeToAa`. */}
            <span id={mismatchId} role="status" className="text-xs text-ui-pink-strong">
              {showMismatch ? t(lang, "typeToConfirmMismatch") : ""}
            </span>
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
              className="rounded-md border border-ui-pink/50 bg-ui-pink px-3 py-1.5 text-sm font-medium text-white hover:bg-ui-pink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
