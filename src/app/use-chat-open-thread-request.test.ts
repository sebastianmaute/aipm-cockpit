// §799 — the chat consumes an "open this thread" request from the Activity view exactly once.
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { StrictMode, createElement, type ReactNode } from "react";
import {
  useChatOpenThreadRequest,
  type OpenThreadRequest,
  type UseChatOpenThreadRequestDeps,
} from "./use-chat-open-thread-request";

function setup(initial: Partial<UseChatOpenThreadRequestDeps>, opts: { strict?: boolean } = {}) {
  const selectThread = vi.fn();
  const onConsumed = vi.fn();
  const base: UseChatOpenThreadRequestDeps = {
    request: null, blocked: false, threadIds: ["t1", "t2"], activeThreadId: "t1", selectThread, onConsumed,
    ...initial,
  };
  const wrapper = opts.strict ? ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children) : undefined;
  const hook = renderHook((deps: UseChatOpenThreadRequestDeps) => useChatOpenThreadRequest(deps), {
    initialProps: base, wrapper,
  });
  return { ...hook, base, selectThread, onConsumed };
}

const REQ: OpenThreadRequest = { threadId: "t2", nonce: 1 };

describe("useChatOpenThreadRequest", () => {
  it("does nothing without a request", () => {
    const { result, selectThread, onConsumed } = setup({});
    expect(result.current).toBe(false);
    expect(selectThread).not.toHaveBeenCalled();
    expect(onConsumed).not.toHaveBeenCalled();
  });

  it("switches to a listed thread and consumes the request once", () => {
    const { result, selectThread, onConsumed } = setup({ request: REQ });
    expect(selectThread).toHaveBeenCalledTimes(1);
    expect(selectThread).toHaveBeenCalledWith("t2");
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  it("applies a request present at mount once under StrictMode", () => {
    const { selectThread, onConsumed } = setup({ request: REQ }, { strict: true });
    expect(selectThread).toHaveBeenCalledTimes(1);
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not fire a consumed request again on re-render", () => {
    const { rerender, base, selectThread, onConsumed } = setup({});
    rerender({ ...base, request: REQ });
    rerender({ ...base, request: REQ, activeThreadId: "t2" });
    rerender({ ...base, request: null, activeThreadId: "t2" });
    expect(selectThread).toHaveBeenCalledTimes(1);
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it("applies a NEW request for the same thread", () => {
    const { rerender, base, selectThread, onConsumed } = setup({});
    rerender({ ...base, request: REQ });
    rerender({ ...base, request: null });
    rerender({ ...base, request: { threadId: "t2", nonce: 2 } });
    expect(selectThread).toHaveBeenCalledTimes(2);
    expect(onConsumed).toHaveBeenCalledTimes(2);
  });

  it("consumes a request for a thread that is not listed, without switching", () => {
    const { result, selectThread, onConsumed } = setup({ request: { threadId: "gone", nonce: 1 } });
    expect(selectThread).not.toHaveBeenCalled();
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  it("while blocked: does not switch, shows the notice, and still consumes", () => {
    const { result, selectThread, onConsumed } = setup({ request: REQ, blocked: true });
    expect(selectThread).not.toHaveBeenCalled();
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it("keeps the notice after the parent consumes, and drops it when the send ends", () => {
    const { result, rerender, base, selectThread } = setup({ request: REQ, blocked: true });
    rerender({ ...base, request: null, blocked: true });
    expect(result.current).toBe(true);
    rerender({ ...base, request: null, blocked: false });
    expect(result.current).toBe(false);
    // A later send does not bring a stale notice back, and the refused request is not replayed.
    rerender({ ...base, request: null, blocked: true });
    expect(result.current).toBe(false);
    expect(selectThread).not.toHaveBeenCalled();
  });

  it("while blocked, a request for the thread already open needs no notice", () => {
    const { result, selectThread, onConsumed } = setup({ request: { threadId: "t1", nonce: 1 }, blocked: true });
    expect(result.current).toBe(false);
    expect(selectThread).not.toHaveBeenCalled();
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it("works without a consume callback", () => {
    const { selectThread } = setup({ request: REQ, onConsumed: undefined });
    expect(selectThread).toHaveBeenCalledWith("t2");
  });
});
