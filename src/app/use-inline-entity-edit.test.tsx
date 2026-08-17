import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it, expect, vi, afterEach, describe } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as call from "./inline-ai-edit-call";
import * as tools from "./chat-tools";
import { useInlineAiEdit, type InlineAiEditDeps } from "./use-inline-ai-edit";
import { useInlineEntityEdit, type InlineEntityEditDeps } from "./use-inline-entity-edit";
import { type Task } from "./types";

afterEach(() => vi.restoreAllMocks());

// --- Task path (SP1 API preserved via the thin wrapper) --------------------

const task = { id: 42, taskName: "Fix login bug", status: "To Do", dueDate: "2026-08-12" } as unknown as Task;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as InlineAiEditDeps["ws"];

function mkDeps(over: Partial<InlineAiEditDeps> = {}): InlineAiEditDeps {
  return {
    dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }) } as unknown as InlineAiEditDeps["dispatcher"],
    ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } as unknown as InlineAiEditDeps["ai"],
    apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
    isPopout: false, lang: "en-US",
    showToast: vi.fn(), ws, guides: [], recordUsage: vi.fn(),
    ...over,
  };
}

it("goes thinking -> preview and builds a diff", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark done"); });
  expect(result.current.phase).toBe("preview");
  expect(result.current.plan?.updates).toEqual([{ field: "status", before: "To Do", after: "Done", raw: "Done" }]);
});

// ★★★ THIS USED TO PIN THE OPPOSITE, AND THE REVERSAL IS THE POINT — a reader
//   who remembers the old rule will try to restore the forwarding. The hook DID
//   pass `historySearch: deps.ai.historySearch` into `callInlineEdit` so the
//   kill switch could reach `toolsFor` (measured at the time: hardcoding that
//   argument left 91 tests across 4 suites green, so the delivery was genuinely
//   unobserved). It no longer forwards anything, because `callInlineEdit` now
//   drops `search_history` UNCONDITIONALLY: this path is single-shot, so a
//   `search_history` tool_use can never be answered and `describeEntityCalls`
//   matches only update/create/delete blocks — a searching model yields an empty
//   plan, i.e. a silently failed edit. Offering it is worse than the schema cost
//   that motivated threading it in the first place.
//
// ★★ THE REAL GUARD MOVED, it was not deleted: `inline-ai-edit-call.test.ts`
//   asserts `callClaude` receives a literal `false`. What is left to check HERE
//   is the seam this file owns — that the hook contributes no setting at all, in
//   either position of the toggle, so nothing can re-arm the tool from above.
describe("the hook forwards no historySearch, whatever the toggle says", () => {
  async function captureArgs(ai: Partial<InlineAiEditDeps["ai"]>) {
    let captured: Record<string, unknown> | undefined;
    vi.spyOn(call, "callInlineEdit").mockImplementation(
      ((args: Record<string, unknown>) => {
        captured = args;
        return Promise.resolve({
          blocks: [], text: "", usage: { input_tokens: 1, output_tokens: 1 },
        });
      }) as unknown as typeof call.callInlineEdit,
    );
    const deps = mkDeps();
    const { result } = renderHook(() =>
      useInlineAiEdit({ ...deps, ai: { ...deps.ai, ...ai } as InlineAiEditDeps["ai"] }),
    );
    act(() => result.current.openFor(task));
    await act(async () => { await result.current.submit("mark done"); });
    // Positive observable: the call really happened, so an assertion about its
    // arguments cannot pass because the spy was never invoked.
    expect(captured, "callInlineEdit was never called").toBeDefined();
    return captured!;
  }

  // ★ `in`, not the VALUE. `historySearch: undefined` and an absent key read
  //   identically through `args.historySearch`, so a value assertion would stay
  //   green after someone re-added the forwarding with a defaulted read.
  it("omits the key entirely when the toggle is off", async () => {
    const args = await captureArgs({ historySearch: false });
    expect("historySearch" in args).toBe(false);
    // Positive control: the args object really is the call's, not an empty {}.
    expect(args.instruction).toBe("mark done");
  });

  it("omits it when the toggle is unset (the default-on case)", async () => {
    const args = await captureArgs({});
    expect("historySearch" in args).toBe(false);
    expect(args.instruction).toBe("mark done");
  });
});

it("passes an AbortSignal into callInlineEdit and cancel() aborts the in-flight call", async () => {
  let captured: AbortSignal | undefined;
  vi.spyOn(call, "callInlineEdit").mockImplementation(
    ((args: { signal?: AbortSignal }) => {
      captured = args.signal;
      return new Promise(() => {}); // never resolves — stays in flight
    }) as unknown as typeof call.callInlineEdit,
  );
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  act(() => { void result.current.submit("mark done"); });
  expect(result.current.phase).toBe("thinking");
  expect(captured).toBeInstanceOf(AbortSignal);
  expect(captured?.aborted).toBe(false);
  act(() => result.current.cancel());
  expect(captured?.aborted).toBe(true);
  expect(result.current.phase).toBe("idle");
});

it("aborts the in-flight call when the pane goes inactive (deps.active=false)", async () => {
  let captured: AbortSignal | undefined;
  vi.spyOn(call, "callInlineEdit").mockImplementation(
    ((args: { signal?: AbortSignal }) => {
      captured = args.signal;
      return new Promise(() => {});
    }) as unknown as typeof call.callInlineEdit,
  );
  const { result, rerender } = renderHook(
    (props: { active?: boolean }) => useInlineAiEdit(mkDeps({ active: props.active })),
    { initialProps: { active: true } as { active?: boolean } },
  );
  act(() => result.current.openFor(task));
  act(() => { void result.current.submit("mark done"); });
  expect(captured?.aborted).toBe(false);
  rerender({ active: false });
  expect(captured?.aborted).toBe(true);
});

// ★★ The `active === false` transition above is NOT the same event as UNMOUNT,
// and on the TASK path there is no `active` prop at all (`use-inline-ai-edit`
// spreads deps without one), so nothing there ever deactivated. The modern shell
// renders only the active view and workspace-section only the active tabpanel,
// so navigating away UNMOUNTS the pane — without a cleanup the billed
// `callInlineEdit` kept running with no Stop anywhere.
it("aborts the in-flight call on UNMOUNT (the task path never deactivates)", () => {
  let captured: AbortSignal | undefined;
  vi.spyOn(call, "callInlineEdit").mockImplementation(
    ((args: { signal?: AbortSignal }) => {
      captured = args.signal;
      return new Promise(() => {});
    }) as unknown as typeof call.callInlineEdit,
  );
  const { result, unmount } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  act(() => { void result.current.submit("mark done"); });
  // Control: the signal is live before the unmount, so the assertion below
  // cannot be satisfied by an already-aborted (or absent) signal.
  expect(captured).toBeInstanceOf(AbortSignal);
  expect(captured?.aborted).toBe(false);
  unmount();
  expect(captured?.aborted).toBe(true);
});

it("openFor on a new item aborts the previous item's in-flight call", async () => {
  let captured: AbortSignal | undefined;
  vi.spyOn(call, "callInlineEdit").mockImplementation(
    ((args: { signal?: AbortSignal }) => {
      captured = args.signal;
      return new Promise(() => {});
    }) as unknown as typeof call.callInlineEdit,
  );
  const other = { id: 43, taskName: "Other", status: "To Do" } as unknown as Task;
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  act(() => { void result.current.submit("mark done"); });
  expect(captured?.aborted).toBe(false);
  act(() => result.current.openFor(other));
  expect(captured?.aborted).toBe(true);
});

it("apply routes each block through runTool and logs + toasts, then closes", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 42 });
  const deps = mkDeps();
  const { result } = renderHook(() => useInlineAiEdit(deps));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark done"); });
  await act(async () => { await result.current.apply(); });
  expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_task", { id: 42, status: "Done" });
  expect(deps.showToast).toHaveBeenCalledWith("info", expect.stringContaining("Fix login bug"));
  expect(result.current.phase).toBe("idle");
});

it("no tool_use -> clarify phase", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({ blocks: [], text: "Which task?", usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("do something"); });
  expect(result.current.phase).toBe("clarify");
  expect(result.current.clarifyText).toBe("Which task?");
});

it("error path: callInlineEdit throws -> error phase", async () => {
  vi.spyOn(call, "callInlineEdit").mockRejectedValue(new Error("500"));
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("x"); });
  expect(result.current.phase).toBe("error");
});

it("gates: aiEditEnabled false when disabled / popout / jira-synced", () => {
  const { result: a } = renderHook(() => useInlineAiEdit(mkDeps({ ai: { enabled: false, apiKey: "" } as unknown as InlineAiEditDeps["ai"], apiKey: "" })));
  expect(a.current.aiEditEnabled(task)).toBe(false);
  const { result: b } = renderHook(() => useInlineAiEdit(mkDeps({ isPopout: true })));
  expect(b.current.aiEditEnabled(task)).toBe(false);
  const { result: c } = renderHook(() => useInlineAiEdit(mkDeps()));
  expect(c.current.aiEditEnabled({ ...task, jiraKey: "OPS-1" } as unknown as Task)).toBe(false);
  expect(c.current.aiEditEnabled(task)).toBe(true);
});

it("partial apply: a later op fails after the update committed -> partial toast + close, not error", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [
      { type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } },
      { type: "tool_use", id: "b2", name: "create_raid_item", input: { category: "Risk", title: "R" } },
    ],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const runToolSpy = vi.spyOn(tools, "runTool")
    .mockResolvedValueOnce({ id: 42 })
    .mockRejectedValueOnce(new Error("bad"));
  const deps = mkDeps();
  const { result } = renderHook(() => useInlineAiEdit(deps));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("x"); });
  await act(async () => { await result.current.apply(); });
  expect(runToolSpy).toHaveBeenCalledTimes(2);
  expect(deps.showToast).toHaveBeenCalledWith("error", expect.any(String)); // partial notice
  expect(result.current.phase).toBe("idle"); // closed, not stranded in error
});

it("discards a stale response when the active task changed mid-flight", async () => {
  let resolveCall!: (v: Awaited<ReturnType<typeof call.callInlineEdit>>) => void;
  vi.spyOn(call, "callInlineEdit").mockImplementation(
    () => new Promise((r) => { resolveCall = r; }),
  );
  const taskB = { id: 43, taskName: "Other", status: "To Do" } as unknown as Task;
  const wsAB = { tasks: [task, taskB], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as InlineAiEditDeps["ws"];
  const { result } = renderHook(() => useInlineAiEdit(mkDeps({ ws: wsAB })));
  act(() => result.current.openFor(task));
  let submitPromise!: Promise<void>;
  act(() => { submitPromise = result.current.submit("mark done"); });
  act(() => result.current.openFor(taskB)); // switch while A's call is in-flight
  await act(async () => {
    resolveCall({
      blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    await submitPromise;
  });
  // A's response must NOT land on B: no preview, plan stays null, active task is B.
  expect(result.current.activeTask?.id).toBe(43);
  expect(result.current.plan).toBeNull();
  expect(result.current.phase).not.toBe("preview");
});

// --- Generic entity path (raid) --------------------------------------------

describe("useInlineEntityEdit — raid", () => {
  const raidItem = { id: 7, category: "R", title: "Old", status: "Open" };
  const raidWs = { tasks: [], raid: [raidItem], milestones: [], changes: [], stakeholders: [] } as unknown as InlineEntityEditDeps["ws"];

  function mkEntityDeps(over: Partial<InlineEntityEditDeps> = {}): InlineEntityEditDeps {
    return {
      entity: "raid",
      dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }) } as unknown as InlineEntityEditDeps["dispatcher"],
      ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } as unknown as InlineEntityEditDeps["ai"],
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
      isPopout: false, lang: "en-US",
      showToast: vi.fn(), ws: raidWs, guides: [], recordUsage: vi.fn(),
      ...over,
    };
  }

  it("enables edits without a task-only jira gate", () => {
    const { result } = renderHook(() => useInlineEntityEdit(mkEntityDeps()));
    // A jiraKey field is irrelevant for non-task entities → still enabled.
    expect(result.current.aiEditEnabled({ ...raidItem, jiraKey: "OPS-1" })).toBe(true);
  });

  it("submit -> preview and apply routes through update_raid_item", async () => {
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_raid_item", input: { id: 7, title: "New" } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps();
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(raidItem));
    await act(async () => { await result.current.submit("rename it"); });
    expect(result.current.phase).toBe("preview");
    expect(result.current.plan?.updates).toEqual([{ field: "title", before: "Old", after: "New", raw: "New" }]);
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", { id: 7, title: "New" });
    expect(result.current.phase).toBe("idle");
  });

  it("applies a rich field VERBATIM, not the projected preview text", async () => {
    // ★★★ apply() rebuilds the patch from plan.updates, and `after` on a RICH
    // field is forPreview() output — descriptionText(html), i.e. PLAIN TEXT.
    // Applying that wrote the projection over the user's markup: an inline
    // "Ask Claude" edit silently flattened every one of the seven rich fields
    // (task.description, raid.description/mitigation, change.description/
    // impactDescription/resolutionNotes, milestone.description). The preview
    // must stay projected — it is for reading — while the APPLIED value is the
    // verbatim `raw` the model proposed. That is what `raw` exists for.
    //
    // ★ The induced-enum-reset diffs carry no `raw` (their `after` was never
    // projected), so the fallback `raw ?? after` is load-bearing, not defensive.
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [
        {
          type: "tool_use",
          id: "b1",
          name: "update_raid_item",
          input: { id: 7, description: "<p>one</p><p>two</p>" },
        },
      ],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps();
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(raidItem));
    await act(async () => { await result.current.submit("describe it"); });
    // The PREVIEW is projected — that half must not regress.
    expect(result.current.plan?.updates).toEqual([
      { field: "description", before: "", after: "one two", raw: "<p>one</p><p>two</p>" },
    ]);
    await act(async () => { await result.current.apply(); });
    // The APPLIED value keeps its markup.
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", {
      id: 7,
      description: "<p>one</p><p>two</p>",
    });
  });

  it("applies a sanitizer-INDUCED reset, which carries no raw, from its after", async () => {
    // ★★ This is the other half of `raw ?? after`, and without it the fallback
    // is untested: dropping the `?? diff.after` left the whole suite green.
    // A category change the model DID name invalidates the status it did NOT,
    // so the sanitizer resets it — that diff has no `raw`, because its `after`
    // is a default enum value that was never projected. Reading `raw` alone
    // would put `undefined` into the patch for it.
    const item = { id: 7, category: "R", title: "Old", status: "Mitigated" };
    const ws = { tasks: [], raid: [item], milestones: [], changes: [], stakeholders: [] } as unknown as InlineEntityEditDeps["ws"];
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_raid_item", input: { id: 7, category: "I" } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps({ ws });
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(item));
    await act(async () => { await result.current.submit("make it an issue"); });
    expect(result.current.plan?.updates).toContainEqual({
      field: "status", before: "Mitigated", after: "Open",
    });
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", {
      id: 7, category: "I", status: "Open",
    });
  });

  it("auto-closes a left-open edit when the pane goes inactive (active -> false)", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useInlineEntityEdit(mkEntityDeps({ active })),
      { initialProps: { active: true } },
    );
    act(() => result.current.openFor(raidItem));
    expect(result.current.activeItem?.id).toBe(7);
    // Pane switches away via a non-mouse route → active becomes false → the
    // render-time reconcile closes the stale edit so it can't reappear on return.
    rerender({ active: false });
    expect(result.current.activeItem).toBeNull();
    expect(result.current.phase).toBe("idle");
  });
});

// ★★★ THE ONLY GUARD AGAINST THE SUMMARY ROW COMING BACK, and it has to be a
// SOURCE SCAN rather than a spy: the hook no longer takes a logger at all, so
// there is nothing to assert `not.toHaveBeenCalled()` on — an absence test
// against a dep that does not exist is vacuous by construction. Re-adding the
// row means re-adding the dep, which no pre-written spy can anticipate.
//
// WHY IT WAS REMOVED: every `runTool` the apply path fires already logs its own
// entity row stamped `actor: "ai"` (`use-chat-dispatcher`), carrying the same id
// and title. The summary was a strict subset of them, in a 500-entry ring
// buffer, double-counted by the AI recap — and it could be FALSE, since
// `updateTask` returns null on an id a concurrent writer deleted without
// throwing, while the caller still counted the call as applied.
// ★ The comment-stripped shape is the repo idiom (see rich-text-plain.test.ts):
//   the module may name the retired kind in PROSE, its code may not write it.
describe("writes no activity summary row of its own", () => {
  const code = readFileSync(join(import.meta.dirname, "use-inline-entity-edit.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("strips comments before scanning", () => {
    // Anti-vacuity: the file DOES discuss `ai.inlineEdit` in prose, so if the
    // strip silently failed the ban below would go red rather than pass — and
    // the positive proves a broken read did not leave `code` empty.
    expect(code).not.toMatch(/NO ACTIVITY ROW HERE/);
    expect(code).toMatch(/export function useInlineEntityEdit/);
  });

  it("never writes ai.inlineEdit", () => {
    expect(code).not.toMatch(/ai\.inlineEdit/);
    // The dep is gone too — a re-add would land here first.
    expect(code).not.toMatch(/logActivity/);
    // Positive control: the apply path still routes through runTool, which is
    // what logs the per-entity rows this row was redundant with.
    expect(code).toMatch(/runTool\(deps\.dispatcher/);
  });
});
