// src/test/fake-dialogs.ts — §752: a scripted stand-in for the app's dialogs, for hook tests that run
// without a ConfirmProvider. Pass `ref` where a hook takes `dialogsRef`; each answer is fixed up front.
import { vi } from "vitest";
import type { AppDialogs, ConfirmFn, NoticeFn, PromptFn } from "../app/confirm-dialog";

export interface FakeDialogAnswers {
  /** What the text prompt answers (null = cancelled). Default null. */
  prompt?: string | null;
  /** What a confirm answers. Default false. */
  confirm?: boolean;
}

export function fakeDialogs(answers: FakeDialogAnswers = {}) {
  const prompt = vi.fn<PromptFn>(async () => answers.prompt ?? null);
  const confirm = vi.fn<ConfirmFn>(async () => answers.confirm ?? false);
  const notice = vi.fn<NoticeFn>(async () => {});
  const ref: { current: AppDialogs } = { current: { prompt, confirm, notice } };
  return { ref, prompt, confirm, notice };
}
