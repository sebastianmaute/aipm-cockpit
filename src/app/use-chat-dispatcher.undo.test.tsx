import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dispatcherWrapper, makeDispatcherArgs } from "./test/chat-dispatcher-fixture";
import { useChatDispatcher } from "./use-chat-dispatcher";

// CHARACTERIZATION (RED by design until the capture lands): every HUMAN write
// path goes through the shipped undo stack (`undo/use-undo-stack.ts`); the AI
// tool-call path is the one writer that bypasses it, so an AI write is
// unrecoverable. This file pins the contract that closes that gap.
describe("AI writes capture undo", () => {
  test("createTask pushes exactly one undo entry", () => {
    const captureComposite = vi.fn();
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapper() },
    );

    act(() => {
      result.current.createTask({
        taskName: "Ingest review",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    expect(captureComposite).toHaveBeenCalledTimes(1);
    const opts = captureComposite.mock.calls[0][0];
    expect(opts.kind).toBe("task.created");
    expect(opts.primaryCount).toBe(1);
  });
});
