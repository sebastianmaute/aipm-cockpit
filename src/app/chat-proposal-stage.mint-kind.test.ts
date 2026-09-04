// A CONSUMER test for `CREATE_MINT_KIND`, kept in its own file because the two
// mocks below are hoisted file-wide and would distort every other assertion.
//
// ★★★ WHY IT IS NOT A TAUTOLOGY. Asserting that the staging wiring mints
// `create_task` as kind "task" proves nothing about WHERE that answer came
// from — a hand-written `if (name === "create_task") return "task"` passes it
// identically, and `CREATE_MINT_KIND` then has zero production consumers, keeps
// passing its own drift tests, and rots into a decoy the next reader trusts. So
// the table is REPLACED with a deliberately wrong-but-valid entry and the
// assertion is that the wiring used THE TABLE'S answer. A re-derivation cannot
// see the replacement and goes red.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mintProvisionalIds } from "./chat-proposal-stage";
import { mintIds, resetMintState } from "./id-mint-session";
import { emptyWorkspace } from "./workspace";

vi.mock("./chat-proposal", async (importOriginal) => {
  const real = await importOriginal<typeof import("./chat-proposal")>();
  return {
    ...real,
    // Wrong on purpose, and a REAL `MintKind` so nothing downstream can reject
    // it as malformed — the only way to notice is to have read the table.
    // `as const` matters: without it the literal widens to `string`, which is
    // not a `MintKind`, and vitest typechecks this factory against the module.
    CREATE_MINT_KIND: { ...real.CREATE_MINT_KIND, create_task: "milestone" as const },
  };
});

vi.mock("./id-mint-session", async (importOriginal) => {
  const real = await importOriginal<typeof import("./id-mint-session")>();
  return { ...real, mintIds: vi.fn(real.mintIds) };
});

beforeEach(() => {
  resetMintState();
  vi.mocked(mintIds).mockClear();
});

describe("mintProvisionalIds consumes CREATE_MINT_KIND", () => {
  it("mints under the kind the TABLE names, not one re-derived from the tool name", () => {
    mintProvisionalIds([{ name: "create_task", input: { taskName: "a" } }], emptyWorkspace());
    expect(vi.mocked(mintIds)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mintIds).mock.calls[0][0]).toBe("milestone");
  });

  it("still reads the LIST from the descriptor, which is a separate derivation", () => {
    // The kind comes from CREATE_MINT_KIND (mocked to "milestone" above); the
    // list comes from INLINE_DESCRIPTORS via TOOL_ENTITY and is unaffected, so
    // it is still `tasks`. Pins that the two halves are read from two sources —
    // collapsing them into one lookup would change this id to 81.
    const [id] = mintProvisionalIds([{ name: "create_task", input: {} }], {
      ...emptyWorkspace(),
      tasks: [{ id: 30 }] as never,
      milestones: [{ id: 80 }] as never,
    });
    expect(id).toBe(31);
  });
});
