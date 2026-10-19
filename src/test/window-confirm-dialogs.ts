// src/test/window-confirm-dialogs.ts — §752: the storage tests script the reload and file confirms by stubbing
// `window.confirm` (49 stubs, written when the app still called it). Production now asks through the app's
// dialog (`dialogsRef`), so these suites pass this adapter, whose confirm answers with the stub. The app
// itself never calls `window.confirm` again; tests that prove that (and the re-checks after the awaited
// answer) give the hook a `fakeDialogs()` ref instead.
import type { AppDialogs } from "../app/confirm-dialog";
import type { UseStorageBackendArgs } from "../app/use-storage-backend-types";

export const windowConfirmDialogsRef: { readonly current: AppDialogs } = {
  current: {
    confirm: async (opts) => window.confirm(opts.message),
    prompt: async () => null,
    notice: async () => {},
  },
};

/** `args` with the adapter as its dialogs, unless the test gave its own. */
export function withWindowConfirm<A extends Pick<UseStorageBackendArgs, "dialogsRef">>(args: A): A {
  return { ...args, dialogsRef: args.dialogsRef ?? windowConfirmDialogsRef };
}
