import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it, expect, vi, afterEach, describe } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as call from "./inline-ai-edit-call";
import * as tools from "./chat-tools";
import * as planMod from "./inline-ai-edit/plan";
import { useInlineAiEdit, type InlineAiEditDeps } from "./use-inline-ai-edit";
import { useInlineEntityEdit, type InlineEntityEditDeps } from "./use-inline-entity-edit";
import { entityToken } from "./ai-entity-token";
import { t, loadI18n } from "./i18n";
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
  expect(result.current.plan?.updates).toEqual([{ entity: "task", field: "status", before: "To Do", after: "Done", raw: "Done" }]);
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
  // ★★ EQUALITY, NOT PRESENCE — the patch must carry the token derived from the
  // row the model was shown. A constant or an empty string would satisfy a
  // presence check and then be REFUSED by requireToken at runtime, which is the
  // breakage this threading exists to fix.
  expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_task", {
    id: 42, status: "Done", expectedToken: entityToken("task", task),
  });
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

// ★★★ A REFUSAL IS NOT "NO CHANGES" (§392). `isEmptyPlan` counts what a plan
// would WRITE and deliberately does not count `rejected`, so a plan whose only
// content is a refusal is empty by that predicate and used to route to
// "clarify" — telling the user the model needed more from them, when in fact it
// understood and the writer refused a named field.
// ★★ A REAL plan, not a stubbed one: an `update_task` naming an id this row is
//  not produces exactly one `rejected` entry and nothing else, so the route is
//  exercised through the real `describeEntityCalls`/`isEmptyPlan` pair rather
//  than around them.
it("routes a rejection-only plan to the rejected phase, not to clarify", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 999, status: "Done" } }],
    text: "", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("mark task 999 done"); });
  expect(result.current.phase).toBe("rejected");
  expect(result.current.plan?.rejected).toEqual([{ toolName: "update_task", reason: "unknown-id", detail: "999" }]);
  // The plan must reach the popover — the phase alone renders no reason.
  expect(result.current.plan).not.toBeNull();
});

// ★★ THE PAIRED CONTROL, and deliberately NOT a copy of "no tool_use ->
// clarify phase" above: this one DOES return a tool_use block, addressed to the
// right row, whose value already matches what is stored — so the plan is empty
// with an empty `rejected`. That is the only difference from the case above, so
// a route keyed on anything coarser than `rejected.length` turns it red.
it("still routes an empty plan carrying no rejection to clarify", async () => {
  vi.spyOn(call, "callInlineEdit").mockResolvedValue({
    blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "To Do" } }],
    text: "Nothing to change.", usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
  const { result } = renderHook(() => useInlineAiEdit(mkDeps()));
  act(() => result.current.openFor(task));
  await act(async () => { await result.current.submit("set the status to To Do"); });
  expect(result.current.phase).toBe("clarify");
  expect(result.current.clarifyText).toBe("Nothing to change.");
  // The clarify route commits no plan — so the assertion above cannot be
  // passing on a plan that merely failed to render.
  expect(result.current.plan).toBeNull();
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
    expect(result.current.plan?.updates).toEqual([{ entity: "raid", field: "title", before: "Old", after: "New", raw: "New" }]);
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", {
      id: 7, title: "New", expectedToken: entityToken("raid", raidItem),
    });
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
      { entity: "raid", field: "description", before: "", after: "one two", raw: "<p>one</p><p>two</p>" },
    ]);
    await act(async () => { await result.current.apply(); });
    // The APPLIED value keeps its markup.
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", {
      id: 7,
      description: "<p>one</p><p>two</p>",
      expectedToken: entityToken("raid", raidItem),
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
      entity: "raid", field: "status", before: "Mitigated", after: "Open",
    });
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", {
      id: 7, category: "I", status: "Open", expectedToken: entityToken("raid", item),
    });
  });

  // ★★★ A NON-EMPTY PLAN THAT EVERY APPLY BRANCH SKIPS MUST NOT REPORT SUCCESS.
  // `isEmptyPlan` counts EVERY bucket of `EditPlan`, but only the buckets with
  // a write branch in apply() can move `applied`. A plan that is non-empty by
  // the first measure and unwritten by the second reaches an unconditional
  // success toast: "applied" for a write that never happened. The gate is
  // `applied > 0`, so it covers every FUTURE bucket without naming any.
  //
  // ★★★ ITS PREMISE CHANGED WITH THIS SLICE AND THE TEST HAD TO MOVE WITH IT.
  // `links` used to be the live instance of that gap — non-empty, no writer —
  // and this test injected a links-only plan to reach the branch. `links` is
  // now WRITTEN, so that injection would exercise the opposite path and the
  // assertions below would pass only by turning green on a real write. There
  // is no longer ANY bucket with the gap, which is why the emptiness VERDICT is
  // stubbed instead: it is the only way left to stand where the next bucket
  // will stand. Everything else stays real — the hook's own guard, the four
  // write branches, the `applied` counter and the toast call.
  // ★ Do NOT "restore" a links-only injection here. If a future bucket lands
  //   with no writer, prefer injecting THAT bucket with a real `isEmptyPlan`.
  it("does not claim success when no apply branch wrote anything", async () => {
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_raid_item", input: { id: 7 } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    vi.spyOn(planMod, "describeEntityCalls").mockReturnValue({
      updates: [], creates: [], deletes: [], rejected: [], links: [],
    });
    // Stands in for a bucket apply() does not yet know how to write: the plan
    // passes the guard and every write branch skips it.
    vi.spyOn(planMod, "isEmptyPlan").mockReturnValue(false);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps();
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(raidItem));
    await act(async () => { await result.current.submit("link it to the brief"); });
    // Positive control: without this the apply() guard returns early and the
    // "no toast" assertion below passes for the wrong reason.
    expect(result.current.phase).toBe("preview");
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalledWith("info", expect.anything());
    // cancel() stays OUTSIDE the guard — closing the popover is right either way.
    expect(result.current.phase).toBe("idle");
    expect(result.current.activeItem).toBeNull();
  });

  it("writes the sanitized link ids the preview showed", async () => {
    // The card said "Draft brief, Review -> Ship". The patch must carry [2].
    // Assert on what runTool RECEIVES, never on the plan: the plan being right
    // is what `plan.test.ts` covers; this covers the HANDOFF.
    // ★★ A LINKS-ONLY PLAN, deliberately — `updates` is empty, so this also
    //  pins the restructured write condition. Nested inside `if
    //  (plan.updates.length > 0)` the loop previews a change and writes
    //  nothing, which is the exact defect the preview exists to prevent.
    const linked = { id: 7, category: "R", title: "Old", status: "Open", linkedTaskIds: [1, 3] };
    const linkedWs = {
      tasks: [{ id: 1, taskName: "Draft brief" }, { id: 2, taskName: "Ship" }, { id: 3, taskName: "Review" }],
      raid: [linked], milestones: [], changes: [], stakeholders: [],
    } as unknown as InlineEntityEditDeps["ws"];
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_raid_item", input: { id: 7, linkedTaskIds: [2] } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps({ ws: linkedWs });
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(linked));
    await act(async () => { await result.current.submit("link it to Ship instead"); });
    expect(result.current.phase).toBe("preview");
    expect(result.current.plan?.updates).toEqual([]);
    expect(result.current.plan?.links).toEqual([
      { entity: "raid", target: "row", field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] },
    ]);
    await act(async () => { await result.current.apply(); });
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_raid_item", {
      id: 7, linkedTaskIds: [2], expectedToken: entityToken("raid", linked),
    });
    // `applied` really was incremented — otherwise the success toast is gated
    // off and the write above would be reported to the user as nothing.
    expect(deps.showToast).toHaveBeenCalledWith("info", expect.anything());
  });

  it("writes link ids, never the rendered title string", async () => {
    // ★★★ THE REGRESSION THIS EXISTS FOR: a LinkDiff landing in `plan.updates`.
    //  The rebuild loop would write `diff.raw ?? diff.after` — the TITLE STRING —
    //  into `linkedTaskIds`. `sanitizeIdList` splits a string on [.;], finds no
    //  integers, and stores [] — wiping every link on the row.
    //  ★★ THE TYPE SYSTEM DOES NOT PREVENT THIS: `LinkDiff` and `FieldDiff` are
    //  mutually assignable (`raw` is optional), measured with tsc. What holds
    //  the invariant is the CALL GRAPH — `describeEntityCalls` populates only
    //  `links`, and the rebuild loop reads only `updates`. This test is the pin.
    //  Assert on the patch the dispatcher RECEIVES, not on the plan: the plan
    //  being right is exactly what this is guarding against assuming.
    //  ★ A MIXED plan (one scalar update AND one link), so a green run proves
    //  the patch was BUILT — not merely that one key is absent from an empty one.
    const linked = { id: 7, category: "R", title: "Old", status: "Open", linkedTaskIds: [1, 3] };
    const linkedWs = {
      tasks: [{ id: 1, taskName: "Draft brief" }, { id: 2, taskName: "Ship" }, { id: 3, taskName: "Review" }],
      raid: [linked], milestones: [], changes: [], stakeholders: [],
    } as unknown as InlineEntityEditDeps["ws"];
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{
        type: "tool_use", id: "b1", name: "update_raid_item",
        input: { id: 7, title: "New", linkedTaskIds: [2] },
      }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 7 });
    const deps = mkEntityDeps({ ws: linkedWs });
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(linked));
    await act(async () => { await result.current.submit("rename it and link it to Ship"); });
    // Positive control: without it apply()'s guard early-returns and every
    // assertion below passes because runTool was never reached at all.
    expect(result.current.phase).toBe("preview");
    await act(async () => { await result.current.apply(); });
    const input = runToolSpy.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(input?.linkedTaskIds).toEqual([2]);
    // ★ Kept even though the assertion above already catches today's defect: a
    //   future `raw` on the diff could satisfy a shape check while still being a
    //   string. This is the assertion that NAMES the defect.
    expect(typeof input?.linkedTaskIds).not.toBe("string");
    // The scalar update in the same plan still lands, so the patch really was
    // built — the link assertion is not passing over an unbuilt one.
    expect(input?.title).toBe("New");
  });

  it("never writes a CREATE's links onto the open row", async () => {
    // ★★★ DATA LOSS. `plan.links` is ONE flat bucket and both branches of
    //  `describeEntityCalls` push into it — the update branch for the OPEN row,
    //  the create branch for DISCLOSURE only (the create writes its own links by
    //  replaying `c.input`). Rebuilding the update patch from the whole bucket
    //  therefore stamped a create's links onto the row the popover was opened
    //  on, REPLACING them: Risk A loses tasks 1 and 3 and gains task 7, and the
    //  card never said so.
    //  ★★ FILTERING ON `l.entity` DOES NOT FIX IT and must not be "simplified"
    //  back to that: an open RAID row plus `create_raid_item` is the SAME
    //  entity and a DIFFERENT row. The discriminator is `target`, i.e. ORIGIN.
    //  ★ Asserting on the tool names runTool RECEIVES, not on the plan: a
    //  create's links belong in the plan (that is the disclosure §390 added);
    //  what must never happen is the WRITE.
    const linked = { id: 9, category: "R", title: "Risk A", status: "Open", linkedTaskIds: [1, 3] };
    const linkedWs = {
      tasks: [{ id: 1, taskName: "Draft brief" }, { id: 3, taskName: "Review" }, { id: 7, taskName: "Kickoff" }],
      raid: [linked], milestones: [], changes: [], stakeholders: [],
    } as unknown as InlineEntityEditDeps["ws"];
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{
        type: "tool_use", id: "b1", name: "create_raid_item",
        input: { category: "R", title: "Risk B", linkedTaskIds: [7] },
      }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 11 });
    const deps = mkEntityDeps({ ws: linkedWs });
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(linked));
    await act(async () => { await result.current.submit("raise a second risk linked to Kickoff"); });
    // Positive control: the plan really did reach preview AND really does carry
    // the create's link as disclosure — so the assertions below cannot pass
    // because nothing was described.
    expect(result.current.phase).toBe("preview");
    expect(result.current.plan?.links).toHaveLength(1);
    await act(async () => { await result.current.apply(); });
    // The open row is never touched: no `update_raid_item` at all. A pointless
    // update would also carry `expectedToken`, bumping `localModifiedAt` and
    // logging a no-op `actor:"ai"` row — and could abort the apply with a
    // ConcurrencyTokenError before the create ever runs.
    expect(runToolSpy.mock.calls.map((c) => c[1])).toEqual(["create_raid_item"]);
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "create_raid_item", {
      category: "R", title: "Risk B", linkedTaskIds: [7],
    });
  });

  it("keeps a create's links out of a patch the open row is getting anyway", async () => {
    // ★★★ THE OTHER HALF, AND IT NEEDS ITS OWN TEST. The guard and the rebuild
    //  loop each cover a case the other cannot: the test above has an EMPTY
    //  `updates`, so the guard alone already stops it and reverting the LOOP
    //  filter leaves it green. Here the open row has a real scalar update, so
    //  the guard passes on `updates` and the loop is the only thing standing
    //  between the create's `linkedTaskIds` and the open row's patch. Measured:
    //  each mutant reds exactly one of these two.
    const linked = { id: 9, category: "R", title: "Risk A", status: "Open", linkedTaskIds: [1, 3] };
    const linkedWs = {
      tasks: [{ id: 1, taskName: "Draft brief" }, { id: 3, taskName: "Review" }, { id: 7, taskName: "Kickoff" }],
      raid: [linked], milestones: [], changes: [], stakeholders: [],
    } as unknown as InlineEntityEditDeps["ws"];
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [
        { type: "tool_use", id: "b1", name: "update_raid_item", input: { id: 9, title: "Renamed" } },
        { type: "tool_use", id: "b2", name: "create_raid_item", input: { category: "R", title: "Risk B", linkedTaskIds: [7] } },
      ],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 11 });
    const deps = mkEntityDeps({ ws: linkedWs });
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(linked));
    await act(async () => { await result.current.submit("rename this and raise a second risk on Kickoff"); });
    expect(result.current.phase).toBe("preview");
    await act(async () => { await result.current.apply(); });
    // The row's OWN patch: the rename lands (so the patch really was built) and
    // `linkedTaskIds` is ABSENT — not `[7]`, and not `[]` either. The row keeps
    // the [1, 3] it had, because nothing writes that key at all.
    expect(runToolSpy.mock.calls[0]?.[1]).toBe("update_raid_item");
    expect(runToolSpy.mock.calls[0]?.[2]).toEqual({
      id: 9, title: "Renamed", expectedToken: entityToken("raid", linked),
    });
    expect(runToolSpy.mock.calls[1]?.[1]).toBe("create_raid_item");
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
// ★★★ A SINGLE FK IS A LINK FIELD TOO, AND IT MUST NOT BE WRITTEN AS AN ARRAY.
//  `LinkField.sanitize` returns `number[]` for BOTH kinds, so `roleId` reaches
//  the plan as `[12]`. `update_resource` spreads the patch into
//  `sanitizeResource`, which reads `toNumber(input.roleId)` — and `toNumber` is
//  NaN for an array (its own docstring calls this out against bare `Number`),
//  so the stored FK becomes null. The card would have promised a new role and
//  the write would have REMOVED the one the row had: the destructive direction,
//  behind a green preview. The apply path unwraps by `kind`.
describe("useInlineEntityEdit — a single-FK link (resource.roleId)", () => {
  const ada = { id: 3, firstName: "Ada", lastName: "Lovelace", roleId: 11 };
  const roleWs = {
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [],
    resources: [ada],
    roles: [{ id: 11, disciplineId: 1, gradeId: 1 }, { id: 12, disciplineId: 2, gradeId: 1 }],
    disciplines: [{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }],
    grades: [{ id: 1, name: "L3" }],
  } as unknown as InlineEntityEditDeps["ws"];

  function mkResourceDeps(): InlineEntityEditDeps {
    return {
      entity: "resource",
      dispatcher: { getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }) } as unknown as InlineEntityEditDeps["dispatcher"],
      ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } as unknown as InlineEntityEditDeps["ai"],
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx",
      isPopout: false, lang: "en-US",
      showToast: vi.fn(), ws: roleWs, guides: [], recordUsage: vi.fn(),
    };
  }

  async function applyRoleWrite(roleId: unknown) {
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_resource", input: { id: 3, roleId } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const runToolSpy = vi.spyOn(tools, "runTool").mockResolvedValue({ id: 3 });
    const deps = mkResourceDeps();
    const { result } = renderHook(() => useInlineEntityEdit(deps));
    act(() => result.current.openFor(ada));
    await act(async () => { await result.current.submit("change her role"); });
    // Positive control: the preview really reached the Apply gate, so the
    // patch assertion below cannot pass because apply() early-returned.
    expect(result.current.phase).toBe("preview");
    await act(async () => { await result.current.apply(); });
    return { runToolSpy, deps };
  }

  it("unwraps a single-FK link into the number the writer stores", async () => {
    const { runToolSpy, deps } = await applyRoleWrite(12);
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_resource", {
      id: 3, roleId: 12, expectedToken: entityToken("resource", ada),
    });
  });

  it("clears a single-FK link with null, not with an empty array", async () => {
    // `[]` would also survive `toNumber` as NaN and clear the FK by accident.
    // Writing `null` says so on purpose, and matches the card's empty `after`.
    const { runToolSpy, deps } = await applyRoleWrite(null);
    expect(runToolSpy).toHaveBeenCalledWith(deps.dispatcher, "update_resource", {
      id: 3, roleId: null, expectedToken: entityToken("resource", ada),
    });
  });
});

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

// ★★★ THE BEHAVIOUR THE TOKEN EXISTS FOR, driven through the REAL `runTool` and
// a real dispatcher rather than a spy — a spy would prove the argument was
// spelled, never that the guard acts on it. The two cases share one fixture and
// differ only in whether the stored row moves between submit and apply, so the
// success case is the anti-vacuity control: it proves this fixture CAN commit,
// and therefore that the refusal below is the guard and not a broken setup.
describe("optimistic concurrency across the submit → apply window", () => {
  function mkStore() {
    // The row as the pane rendered it — the object handed to openFor. `stored`
    // is REPLACED (not mutated) to model a concurrent writer, exactly as a
    // functional setState would.
    const opened = { id: 42, taskName: "Fix login bug", status: "To Do", dueDate: "2026-08-12" };
    let stored: Record<string, unknown> = { ...opened };
    const dispatcher = {
      getSnapshot: () => ({ today: "2026-07-03", language: "en-US" }),
      getTask: (id: number) => (stored.id === id ? stored : null),
      updateTask: (id: number, patch: Record<string, unknown>) => {
        if (stored.id !== id) return null;
        stored = { ...stored, ...patch };
        return stored;
      },
    } as unknown as InlineAiEditDeps["dispatcher"];
    return {
      opened,
      dispatcher,
      read: () => stored,
      moveIt: () => { stored = { ...stored, taskName: "Renamed by a human" }; },
    };
  }

  async function openSubmit(store: ReturnType<typeof mkStore>) {
    vi.spyOn(call, "callInlineEdit").mockResolvedValue({
      blocks: [{ type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } }],
      text: "", usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Awaited<ReturnType<typeof call.callInlineEdit>>);
    const deps = mkDeps({ dispatcher: store.dispatcher });
    const { result } = renderHook(() => useInlineAiEdit(deps));
    act(() => result.current.openFor(store.opened as unknown as Task));
    await act(async () => { await result.current.submit("mark done"); });
    expect(result.current.phase, "submit did not reach preview").toBe("preview");
    return { deps, result };
  }

  it("commits when nothing touched the row in between", async () => {
    const store = mkStore();
    const { result } = await openSubmit(store);
    await act(async () => { await result.current.apply(); });
    expect(store.read().status).toBe("Done");
    expect(result.current.phase).toBe("idle");
  });

  it("refuses, and writes nothing, when a human edited the row while the model was thinking", async () => {
    const store = mkStore();
    const { result } = await openSubmit(store);
    store.moveIt(); // the concurrent edit the old code silently overwrote
    await act(async () => { await result.current.apply(); });
    // The write never reached the dispatcher: the status is untouched AND the
    // human's edit survived, which is the whole point.
    expect(store.read().status).toBe("To Do");
    expect(store.read().taskName).toBe("Renamed by a human");
    // Nothing committed, so the hook stays in `error` rather than closing with
    // a partial-apply toast.
    expect(result.current.phase).toBe("error");
    // ★★★ THE MESSAGE IS ASSERTED, NOT MERELY ITS NON-EMPTINESS. This line read
    //   `.not.toBe("")` for a release and passed while the user was shown the
    //   generic "Could not apply the change." — a NEW failure mode with the
    //   widest human-scale staleness window in the app (model round-trip, then
    //   a preview read, then an Apply click), and no hint that re-running would
    //   help. Any message satisfies a non-emptiness check, so it cannot tell a
    //   recovery message from a dead end.
    expect(result.current.errorText).toBe(t("en-US", "inlineAiEditStale"));
  });

  // Control for the case above: the stale branch must DISCRIMINATE, not just
  // fire. Without this, replacing `inlineAiEditApplyFailed` with the stale key
  // unconditionally would pass — and every ordinary failure would then lie to
  // the user about why it failed and tell them to retry something that cannot
  // succeed.
  it("keeps the generic message for a failure that is not a staleness refusal", async () => {
    const store = mkStore();
    const { result } = await openSubmit(store);
    vi.spyOn(tools, "runTool").mockRejectedValue(new Error("sanitizer rejected the value"));
    await act(async () => { await result.current.apply(); });
    expect(result.current.phase).toBe("error");
    expect(result.current.errorText).toBe(t("en-US", "inlineAiEditApplyFailed"));
  });

  // ★★ THE EN ASSERTIONS ABOVE CANNOT PIN THE DE SIDE. `t` falls back to the EN
  //   dictionary for a key the DE one lacks, so an `inlineAiEditStale` missing
  //   from `i18n.de.ts` would render the ENGLISH sentence to a German user with
  //   every EN test green. The DE dict is lazy, hence the explicit load.
  it("has a real German string for the staleness message", async () => {
    await loadI18n("de");
    const de = t("de", "inlineAiEditStale");
    expect(de).not.toBe(t("en-US", "inlineAiEditStale"));
    expect(de).toMatch(/geändert/);
  });
});
