"use client";

// Branded confirm dialog — the app-wide replacement for native `window.confirm`.
//
// Native `window.confirm` is unstyled (breaks the AIPM look), not keyboard/focus
// managed the way the rest of the app is, and can't be theme/palette-aware. This
// provider renders ONE shared `Modal`-based dialog and exposes an imperative
// `useConfirm()` hook returning a Promise<boolean>, so a call site changes from
//
//   if (window.confirm(msg)) { doThing(); }
// to
//   if (await confirm({ message: msg })) { doThing(); }
//
// with no per-site modal state. Messages/labels are passed already-translated
// (the Modal philosophy — the component never reaches into the lazy DE dict);
// defaults fall back to the provider's `lang`.
//
// This is for the lighter destructive tier (delete one row, clear a log). The
// catastrophic tier (clear ALL tasks, hard-delete a project) keeps the
// higher-friction `TypeToConfirmDialog` (type-a-phrase).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { INTERACTIVE } from "./interaction-styles";

export interface ConfirmOptions {
  /** Already-translated body text. May contain newlines (rendered pre-line). */
  message: string;
  /** Already-translated title. Defaults to a generic "Please confirm". */
  title?: string;
  /** Already-translated confirm-button label. Defaults to a generic "Confirm". */
  confirmLabel?: string;
  /** Already-translated cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual tone of the confirm button. Destructive (AIPM-pink) by default —
   *  the overwhelming majority of call sites are deletes/clears. */
  tone?: "danger" | "default";
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

// Default resolves false so a `useConfirm()` call outside a provider (e.g. an
// isolated unit test) is a safe no-op rather than a crash.
const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

const TITLE_ID = "confirm-dialog-title";

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmProviderProps {
  lang: Lang;
  children: ReactNode;
}

export function ConfirmProvider({ lang, children }: ConfirmProviderProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Focus the Cancel button on open so an accidental Enter can't fire a
  // destructive confirm.
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending((prev) => {
        // A new prompt supersedes an unanswered one (should be rare) —
        // resolve the previous as declined before replacing it. NOTE: this is
        // a side-effect inside a state updater, which StrictMode double-invokes
        // in dev — safe ONLY because Promise settlement is idempotent (a second
        // resolve() is a no-op). Keep `resolve` a bare promise-resolver; don't
        // turn it into something non-idempotent here.
        prev?.resolve(false);
        return { ...opts, resolve };
      });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setPending((prev) => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  // Stable context value — an unstable value re-renders every consumer.
  const value = useMemo(() => confirm, [confirm]);

  const danger = pending?.tone !== "default";
  const confirmClass = danger
    ? "border-AIPM-pink/50 bg-AIPM-pink text-white hover:bg-AIPM-pink/90"
    : "border-AIPM-green/50 bg-AIPM-green text-white hover:bg-AIPM-green/90";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <Modal
          open
          onClose={() => settle(false)}
          ariaLabelledby={TITLE_ID}
          align="center"
          backdropClassName="bg-AIPM-dark-blue/50"
          zIndex={60}
          initialFocusRef={cancelRef}
        >
          <div
            data-modal-panel
            className="relative flex w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
          >
            <ModalHeader
              lang={lang}
              title={pending.title ?? t(lang, "confirmTitle")}
              titleId={TITLE_ID}
              onClose={() => settle(false)}
            />
            <div className="flex flex-col gap-4 p-6">
              <p className="whitespace-pre-line text-sm text-foreground">
                {pending.message}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={() => settle(false)}
                  className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {pending.cancelLabel ?? t(lang, "cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => settle(true)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${confirmClass} ${INTERACTIVE}`}
                >
                  {pending.confirmLabel ?? t(lang, "confirm")}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
