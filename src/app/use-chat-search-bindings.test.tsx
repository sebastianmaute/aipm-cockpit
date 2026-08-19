import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatSearchBindings } from "./use-chat-search-bindings";
import { clearChatThreads, publishChatThreads } from "./chat-threads-registry";
import { defaultSettings, type Settings } from "./settings-types";
import { asTimeZoneForTests, createProjectClock } from "./timezone";
import type { ChatThread } from "./chat-threads";

const clock = createProjectClock(asTimeZoneForTests("UTC"), new Date("2026-08-18T12:00:00.000Z"));

function thread(id: string, projectId: string, name: string): ChatThread {
  return {
    id,
    projectId,
    name,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    history: [],
    display: [{ kind: "user", text: "the vendor decision" }],
  };
}

function settingsWith(chatSearch: boolean | undefined): Settings {
  return { ...defaultSettings, ai: { ...defaultSettings.ai, chatSearch } };
}

/** Renders the hook and keeps the FIRST render's object, which is what the
 *  dispatcher's empty-deps `useMemo` captures. Every liveness assertion below
 *  calls through THAT object after a rerender — reading a fresh one would pass
 *  whether the hook ref-routes or captures. */
function render(projectId: string, chatSearch: boolean | undefined) {
  const r = renderHook(
    ({ pid, cs }: { pid: string; cs: boolean | undefined }) =>
      useChatSearchBindings(pid, settingsWith(cs), clock),
    { initialProps: { pid: projectId, cs: chatSearch } },
  );
  return { first: r.result.current, rerender: r.rerender };
}

afterEach(() => {
  // Module state survives RTL cleanup — leaking it poisons the next file the
  // shuffled run schedules.
  clearChatThreads();
});

describe("useChatSearchBindings", () => {
  it("points at the other threads of the live project", () => {
    publishChatThreads("p1", {
      threads: [thread("t1", "p1", "Vendor decision"), thread("t2", "p1", "Kickoff")],
      activeThreadId: "t2",
      available: true,
    });
    const { first } = render("p1", undefined);
    expect(first.chatPointer()).toEqual({
      count: 1,
      recent: [{ title: "Vendor decision", at: expect.stringContaining("2026-08-02") }],
    });
  });

  it("returns no pointer when there is nothing to point at", () => {
    publishChatThreads("p1", {
      threads: [thread("t1", "p1", "Vendor decision")],
      activeThreadId: "t1",
      available: true,
    });
    expect(render("p1", undefined).first.chatPointer()).toBeUndefined();
  });

  it("gates the pointer on the toggle, not just the tool", () => {
    publishChatThreads("p1", {
      threads: [thread("t1", "p1", "Vendor decision"), thread("t2", "p1", "Kickoff")],
      activeThreadId: "t2",
      available: true,
    });
    // The titles ride the volatile prompt suffix, so a user who switched chat
    // search off must not keep paying for them.
    expect(render("p1", false).first.chatPointer()).toBeUndefined();
    expect(render("p1", undefined).first.chatPointer()).toBeDefined();
  });

  it("reads the toggle LIVE, so a mid-conversation switch takes effect", () => {
    const { first, rerender } = render("p1", undefined);
    expect(first.tools.isChatSearchEnabled()).toBe(true);
    rerender({ pid: "p1", cs: false });
    expect(first.tools.isChatSearchEnabled()).toBe(false);
  });

  it("follows a project switch instead of serving the previous project", () => {
    publishChatThreads("p1", {
      threads: [thread("t1", "p1", "Vendor decision")],
      activeThreadId: null,
      available: true,
    });
    const { first, rerender } = render("p1", undefined);
    expect(first.tools.getChatThreads().threads).toHaveLength(1);
    // The panel republishes under the new key; a hook that had CAPTURED "p1"
    // would keep asking for it and get the registry's empty value forever.
    publishChatThreads("p2", {
      threads: [thread("t9", "p2", "New project"), thread("t8", "p2", "Second")],
      activeThreadId: "t8",
      available: true,
    });
    rerender({ pid: "p2", cs: undefined });
    expect(first.tools.getChatThreads().threads.map((t) => t.id)).toEqual(["t9", "t8"]);
    expect(first.chatPointer()?.recent[0]?.title).toBe("New project");
  });

  it("answers a key mismatch with the empty value rather than another project's threads", () => {
    publishChatThreads("p1", {
      threads: [thread("t1", "p1", "Vendor decision")],
      activeThreadId: null,
      available: true,
    });
    const { first } = render("p2", undefined);
    expect(first.tools.getChatThreads()).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });
});
