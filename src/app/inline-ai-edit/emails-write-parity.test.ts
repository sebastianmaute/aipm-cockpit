// ★★★ open-followups §422 — THE WRITE-PARITY MATRIX for `resource.emails`.
// Three consumers must give ONE answer for the same model call:
//  • the card (`describeEntityCalls`, judged on the RAW incoming value),
//  • the raw dispatcher write, `updateResource` on the ORIGINAL call (what chat
//    Apply sent before §534),
//  • the inline edit, which rebuilds its patch from `plan.updates` through
//    `inlinePatchValue` and sends it to `updateResource`.
// Every cell crosses a stored list with an incoming value and asserts:
//  (0) the plan's verdict matches the HAND-WRITTEN expectation below — never
//      derived from `findTornEmail`, or a broken predicate would agree with
//      itself;
//  (i) the plan rejects `emails` ⇔ the raw replay throws naming emails;
//  (ii) when accepted, every stored unsafe address the value keeps is stored
//      untorn;
//  (iii) the inline patch never holds a rejected `emails`, the sibling `title`
//      lands, and an accepted inline write stores what the raw replay stored.
//  (iv) §534 — chat Apply's STRIPPED call never throws, lands `title`, and
//      never carries a rejected `emails`.
// ★ Seeded through `TestProviders` (the same seed `renderDispatcher` uses):
//  the write boundaries refuse a new unsafe address, so a stored one cannot be
//  created through them.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import { resetMintState } from "../id-mint-session";
import { isDelimiterSafeEmail } from "../sanitize";
import { type Resource } from "../types";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { inlinePatchValue } from "../use-inline-entity-edit";
import { useWorkspace } from "../workspace-context";
import { type Workspace } from "../workspace";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { describeEntityCalls, stripRejectedFields } from "./plan";

const D = INLINE_DESCRIPTORS.resource;

const STORED: ReadonlyArray<{ label: string; list: string[] | undefined }> = [
  { label: "none", list: undefined },
  { label: "safe", list: ["a@x.com"] },
  { label: "unsafe", list: ["a,b@x.com"] },
];

type Incoming = { present: false } | { present: true; value: unknown };

const INCOMING: ReadonlyArray<{ label: string; make: (s: readonly string[]) => Incoming }> = [
  { label: "omitted", make: () => ({ present: false }) },
  { label: "echoArray", make: (s) => ({ present: true, value: [...s] }) },
  { label: "arrayAddsNewUnsafe", make: (s) => ({ present: true, value: [...s, "new;x@y.com"] }) },
  { label: "arrayAddsSafeKeepsStored", make: (s) => ({ present: true, value: [...s, "c@y.com"] }) },
  { label: "arrayDropsStoredUnsafe", make: (s) => ({ present: true, value: [...s.filter(isDelimiterSafeEmail), "c@y.com"] }) },
  { label: "stringContainsStored", make: (s) => ({ present: true, value: [...s, "c@y.com"].join(", ") }) },
  { label: "stringOmitsStored", make: () => ({ present: true, value: "c@y.com" }) },
  { label: "stringNewComma", make: () => ({ present: true, value: "x,y@z.com" }) },
];

// ★★ HAND-WRITTEN, the anti-tautology column. Only a NEW unsafe array member,
//  or a string carrying a stored unsafe address, tears anything — or a string
//  whose split yields a new member that is not an address.
const EXPECT_REJECTED = new Set([
  "none/arrayAddsNewUnsafe",
  "safe/arrayAddsNewUnsafe",
  "unsafe/arrayAddsNewUnsafe",
  "unsafe/stringContainsStored",
  "none/stringNewComma",
  "safe/stringNewComma",
  "unsafe/stringNewComma",
]);

const rowWith = (emails: string[] | undefined): Resource => ({
  id: 1, firstName: "Ada", lastName: "Lovelace",
  roleId: null, utilizationMode: "percent", utilization: {},
  ...(emails ? { emails } : {}),
});

function mount(stored: string[] | undefined) {
  return renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith({ resources: [rowWith(stored)] }) },
  );
}

type Mounted = ReturnType<typeof mount>;

function write(m: Mounted, fields: Record<string, unknown>): unknown {
  let threw: unknown;
  act(() => {
    try {
      m.result.current.d.updateResource(1, fields as never);
    } catch (e) {
      threw = e;
    }
  });
  return threw;
}

const storedRow = (m: Mounted) => m.result.current.ws.resources.find((r) => r.id === 1);

/** The stored unsafe addresses an incoming value KEEPS: all of them when the
 *  key is omitted, the members of an array, the substrings of a string. */
function keptUnsafe(stored: readonly string[], inc: Incoming): string[] {
  const unsafe = stored.filter((e) => !isDelimiterSafeEmail(e));
  if (!inc.present) return unsafe;
  if (Array.isArray(inc.value)) return unsafe.filter((e) => (inc.value as unknown[]).includes(e));
  if (typeof inc.value === "string") return unsafe.filter((e) => (inc.value as string).includes(e));
  return [];
}

const CELLS = STORED.flatMap((s) => INCOMING.map((i) => ({ s, i, key: `${s.label}/${i.label}` })));

beforeEach(() => {
  resetMintState();
});

describe("§422 write parity: card ⇔ updateResource ⇔ inline write", () => {
  it("covers every stored × incoming cell", () => {
    expect(CELLS).toHaveLength(24);
    // Anti-vacuity: every expected rejection names a real cell.
    for (const k of EXPECT_REJECTED) expect(CELLS.map((c) => c.key)).toContain(k);
  });

  it.each(CELLS)("$key", ({ s, i, key }) => {
    const inc = i.make(s.list ?? []);
    const fields: Record<string, unknown> = { title: "Lead", ...(inc.present ? { emails: inc.value } : {}) };

    const chat = mount(s.list);
    const ws = chat.result.current.ws;
    const item = ws.resources[0];
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: D.updateTool, input: { id: 1, ...fields } }],
      { descriptor: D, item, ws: ws as unknown as Workspace },
    );
    const planRejects = plan.rejected.some((r) => r.detail.startsWith("emails="));

    // (0) the verdict itself, against the hand-written column.
    expect(planRejects).toBe(EXPECT_REJECTED.has(key));

    // (i) chat Apply replays the RAW call.
    const threw = write(chat, fields);
    expect(threw !== undefined).toBe(planRejects);
    if (threw !== undefined) expect(String((threw as Error).message)).toMatch(/emails/);

    // (ii) an accepted raw write keeps every stored unsafe address it carries, untorn.
    if (threw === undefined) {
      const row = storedRow(chat);
      expect(row?.title).toBe("Lead");
      for (const addr of keptUnsafe(s.list ?? [], inc)) expect(row?.emails ?? []).toContain(addr);
    }

    // (iii) the inline write, built from the plan exactly as the hook builds it.
    const patch: Record<string, unknown> = {};
    for (const diff of plan.updates) patch[diff.field] = inlinePatchValue(D, diff);
    expect(patch.title).toBe("Lead");
    if (planRejects) expect("emails" in patch).toBe(false);

    const inline = mount(s.list);
    expect(write(inline, patch)).toBeUndefined();
    const inlineRow = storedRow(inline);
    expect(inlineRow?.title).toBe("Lead");
    if (!planRejects) expect(inlineRow?.emails).toEqual(storedRow(chat)?.emails);

    // (iv) §534 — chat Apply sends the STRIPPED call.
    const sent = stripRejectedFields(fields, plan);
    expect("emails" in sent.input).toBe(inc.present && !planRejects);
    const stripped = mount(s.list);
    expect(write(stripped, sent.input)).toBeUndefined();
    expect(storedRow(stripped)?.title).toBe("Lead");
    if (!planRejects) expect(storedRow(stripped)?.emails).toEqual(storedRow(chat)?.emails);
  });
});
