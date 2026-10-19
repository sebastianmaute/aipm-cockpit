"use client";

// Branded confirm dialog — the app-wide replacement for native `window.confirm`.
//
// Native `window.confirm` is unstyled (breaks the app's look), not keyboard/focus
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
//
// §752 — the same provider also replaces `window.prompt` (`usePrompt`, which THROWS in the desktop
// app: Electron does not implement it) and `window.alert` (`useNotice`). One dialog shows at a time;
// a new one answers an open one with its "no" (false, null, or done).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { INTERACTIVE } from "./interaction-styles";
import { Button } from "./button";
import { Input } from "./form-controls";
import { rowLabel } from "./row-tokens";
import { logDiag } from "./diagnostics";

export interface ConfirmOptions {
  /** Already-translated body text. May contain newlines (rendered pre-line). */
  message: string;
  /** Already-translated title. Defaults to a generic "Please confirm". */
  title?: string;
  /** Already-translated confirm-button label. Defaults to a generic "Confirm". */
  confirmLabel?: string;
  /** Already-translated cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual tone of the confirm button. Destructive (ui-pink) by default —
   *  the overwhelming majority of call sites are deletes/clears. */
  tone?: "danger" | "default";
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** §752 — a one-line text question. `message` is the input's label. */
export interface PromptOptions {
  message: string;
  /** Defaults to a generic "Please enter". */
  title?: string;
  defaultValue?: string;
  /** Defaults to "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: "text" | "email" | "url";
}

/** The typed text as entered (untrimmed), or null when cancelled. */
export type PromptFn = (opts: PromptOptions) => Promise<string | null>;

/** §752 — a message with one OK button. */
export interface NoticeOptions {
  message: string;
  /** Defaults to a generic "Please note". */
  title?: string;
  okLabel?: string;
}

export type NoticeFn = (opts: NoticeOptions) => Promise<void>;

/** All three, for code above the provider (`dialogsRef`). */
export interface AppDialogs {
  confirm: ConfirmFn;
  prompt: PromptFn;
  notice: NoticeFn;
}

/** §752 — the dialogs a `dialogsRef` holds until a provider fills it: each answers "no" and logs, because a
 *  dropped bridge would otherwise turn every question into a silent no-op. */
export function unbridgedDialogs(): AppDialogs {
  return {
    confirm: async () => { logDiag("warn", "dialog.noBridge", { kind: "confirm" }); return false; },
    prompt: async () => { logDiag("warn", "dialog.noBridge", { kind: "prompt" }); return null; },
    notice: async () => { logDiag("warn", "dialog.noBridge", { kind: "notice" }); },
  };
}

// Default resolves false so a `useConfirm()` call outside a provider (e.g. an
// isolated unit test) is a safe no-op rather than a crash.
const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));
const PromptContext = createContext<PromptFn>(() => Promise.resolve(null));
const NoticeContext = createContext<NoticeFn>(() => Promise.resolve());

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function usePrompt(): PromptFn {
  return useContext(PromptContext);
}

export function useNotice(): NoticeFn {
  return useContext(NoticeContext);
}

const TITLE_ID = "confirm-dialog-title";
const INPUT_ID = "confirm-dialog-input";

type Pending =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions)
  | ({ kind: "notice"; resolve: () => void } & NoticeOptions);

/** Answers `p` with its "no". Promise settlement is idempotent, so a second call is a no-op. */
function decline(p: Pending | null): void {
  if (p === null) return;
  if (p.kind === "confirm") p.resolve(false);
  else if (p.kind === "prompt") p.resolve(null);
  else p.resolve();
}

interface ConfirmProviderProps {
  lang: Lang;
  children: ReactNode;
  /** Filled with this provider's confirm, for code ABOVE it that cannot call `useConfirm`: task-manager's
   *  hooks run before the provider it renders (§715 D5). */
  bridgeRef?: { current: ConfirmFn };
  /** §752 — the same for all three dialogs. */
  dialogsRef?: { current: AppDialogs };
}

export function ConfirmProvider({ lang, children, bridgeRef, dialogsRef }: ConfirmProviderProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  // Focus the Cancel button on open so an accidental Enter can't fire a
  // destructive confirm.
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);

  // A new prompt supersedes an unanswered one (should be rare) — the previous is
  // answered with its "no" before it is replaced. NOTE: this is a side-effect
  // inside a state updater, which StrictMode double-invokes in dev — safe ONLY
  // because Promise settlement is idempotent (a second resolve() is a no-op).
  // Keep `resolve` a bare promise-resolver; don't turn it into something
  // non-idempotent here.
  const open = useCallback((next: Pending) => {
    setPending((prev) => {
      decline(prev);
      return next;
    });
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => open({ ...opts, kind: "confirm", resolve })),
    [open],
  );
  const prompt = useCallback<PromptFn>(
    (opts) => new Promise<string | null>((resolve) => {
      setDraft(opts.defaultValue ?? "");
      open({ ...opts, kind: "prompt", resolve });
    }),
    [open],
  );
  const notice = useCallback<NoticeFn>(
    (opts) => new Promise<void>((resolve) => open({ ...opts, kind: "notice", resolve })),
    [open],
  );
  useEffect(() => {
    if (bridgeRef) bridgeRef.current = confirm;
  }, [bridgeRef, confirm]);
  useEffect(() => {
    if (dialogsRef) dialogsRef.current = { confirm, prompt, notice };
  }, [dialogsRef, confirm, prompt, notice]);

  /** Closes the dialog with its "no". */
  const dismiss = useCallback(() => {
    setPending((prev) => {
      decline(prev);
      return null;
    });
  }, []);
  /** Closes the dialog with its "yes": true, the typed text, or done. */
  const accept = useCallback(() => {
    setPending((prev) => {
      if (prev?.kind === "confirm") prev.resolve(true);
      else if (prev?.kind === "prompt") prev.resolve(draft);
      else prev?.resolve();
      return null;
    });
  }, [draft]);

  // Stable context values — an unstable value re-renders every consumer.
  const confirmValue = useMemo(() => confirm, [confirm]);
  const promptValue = useMemo(() => prompt, [prompt]);
  const noticeValue = useMemo(() => notice, [notice]);

  const danger = pending?.kind === "confirm" && pending.tone !== "default";
  const confirmClass = danger
    ? "border-ui-pink/50 bg-ui-pink text-white hover:bg-ui-pink/90"
    : "border-ui-green/50 bg-ui-green text-white hover:bg-ui-green/90";

  const title = pending === null
    ? ""
    : pending.title ?? t(lang, pending.kind === "confirm" ? "confirmTitle" : pending.kind === "prompt" ? "dialogPromptTitle" : "dialogNoticeTitle");
  const initialFocusRef = pending?.kind === "prompt" ? inputRef : pending?.kind === "notice" ? okRef : cancelRef;

  return (
    <ConfirmContext.Provider value={confirmValue}>
      <PromptContext.Provider value={promptValue}>
        <NoticeContext.Provider value={noticeValue}>
          {children}
          {pending && (
            <Modal
              open
              onClose={dismiss}
              ariaLabelledby={TITLE_ID}
              align="center"
              backdropClassName="bg-ui-dark-blue/50"
              zIndex={60}
              initialFocusRef={initialFocusRef}
            >
              <div
                data-modal-panel
                className="relative flex w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
              >
                <ModalHeader
                  lang={lang}
                  title={title}
                  titleId={TITLE_ID}
                  onClose={dismiss}
                  // §389: this is the shared confirm surface (delete/clear
                  // gates) — it commonly opens from an edit modal's own delete
                  // button (`edit-modal-chrome.tsx`), stacked over that modal's
                  // own bare ✕. Qualify with the SAME title the header renders,
                  // so the two cannot drift.
                  closeLabel={rowLabel(t(lang, "alertModalClose"), title)}
                />
                {pending.kind === "prompt" ? (
                  // `noValidate`: each caller checks the answer itself and says why in the app's language;
                  // the browser's own check of an email field would block the submit before it could.
                  <form
                    noValidate
                    className="flex flex-col gap-4 p-6"
                    onSubmit={(e) => { e.preventDefault(); accept(); }}
                  >
                    <label htmlFor={INPUT_ID} className="whitespace-pre-line text-sm text-foreground">
                      {pending.message}
                    </label>
                    <Input
                      id={INPUT_ID}
                      ref={inputRef}
                      type={pending.inputType ?? "text"}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      autoComplete="off"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={dismiss}>
                        {pending.cancelLabel ?? t(lang, "cancel")}
                      </Button>
                      <Button type="submit" variant="primary" size="sm">
                        {pending.confirmLabel ?? t(lang, "dialogOk")}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-4 p-6">
                    <p className="whitespace-pre-line text-sm text-foreground">
                      {pending.message}
                    </p>
                    <div className="flex justify-end gap-2">
                      {pending.kind === "notice" ? (
                        <Button ref={okRef} variant="primary" size="sm" onClick={accept}>
                          {pending.okLabel ?? t(lang, "dialogOk")}
                        </Button>
                      ) : (
                        <>
                          <Button ref={cancelRef} variant="secondary" size="sm" onClick={dismiss}>
                            {pending.cancelLabel ?? t(lang, "cancel")}
                          </Button>
                          <button
                            type="button"
                            onClick={accept}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium ${confirmClass} ${INTERACTIVE}`}
                          >
                            {pending.confirmLabel ?? t(lang, "confirm")}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Modal>
          )}
        </NoticeContext.Provider>
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  );
}
