// AI-08 / AI-05 — a thread saved before the tool results were minimised is minimised on load:
// e-mail fields and an absence's real type and note never reach the model again; the user's and the assistant's
// own text stays as written.
import { describe, expect, it } from "vitest";
import { minimiseStoredToolResults, minimiseToolResultText } from "./chat-threads";
import { rowsToThreads } from "./chat-threads-schema";
import type { ApiMessage } from "./chat-api";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

// Tool results in the shapes the tools returned before the upgrade (stringifyResult: pretty JSON).
const OLD_TASK = { id: 1, title: "Deck", assignee: "Ada", assigneeEmail: "ada@example.com", version: "t1" };
const OLD_STAKEHOLDER = { id: 2, name: "Bo", organization: "ACME", email: "bo@example.com", raci: {} };
const OLD_RESOURCE = { id: 3, firstName: "Cy", lastName: "Do", email: "cy@example.com", emails: ["cy2@example.com"] };
const OLD_RAID = {
  id: 4, title: "Risk", owner: "Ada", ownerEmail: "ada@example.com",
  escalations: [{ at: "2026-01-01", toName: "Eve", toEmail: "eve@example.com", note: "kept: not an absence" }],
};
const OLD_ABSENCES = [
  { id: 5, assignee: "Ada", assigneeEmail: "ada@example.com", startDate: "2026-02-01", endDate: "2026-02-03", type: "sick", note: "surgery" },
  { id: 6, assignee: "Bo", startDate: "2026-03-01", endDate: "2026-03-02", type: "vacation" },
];

const USER_TEXT = "Mail ada@example.com about her sick leave note";
const ASSISTANT_TEXT = "Ada (ada@example.com) is off sick: surgery.";

function oldThreadHistory(): ApiMessage[] {
  return [
    { role: "user", content: USER_TEXT },
    {
      role: "assistant",
      content: [
        { type: "text", text: ASSISTANT_TEXT },
        { type: "tool_use", id: "u1", name: "list_absences", input: { assigneeEmail: "ada@example.com" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "u1", content: pretty(OLD_ABSENCES) },
        { type: "tool_result", tool_use_id: "u2", content: pretty(OLD_TASK) },
        { type: "tool_result", tool_use_id: "u3", content: pretty({ stakeholders: [OLD_STAKEHOLDER], resources: [OLD_RESOURCE] }) },
        { type: "tool_result", tool_use_id: "u4", content: pretty(OLD_RAID) },
        { type: "text", text: "a user note with ada@example.com" },
      ],
    },
  ] as ApiMessage[];
}

/** The decoder rows a Turso `chat_threads` select returns, holding `history`. */
function pipelineRow(history: ApiMessage[]) {
  const cols = ["id", "project_id", "name", "created_at", "updated_at", "history_json", "display_json"];
  const values = ["th-1", "default", "Old chat", "2026-01-01", "2026-01-01", JSON.stringify(history), "[]"];
  return {
    type: "ok",
    response: { type: "execute", result: { cols: cols.map((name) => ({ name })), rows: [values.map((value) => ({ type: "text", value }))] } },
  };
}

function toolResults(history: ApiMessage[]): string[] {
  return history.flatMap((m) =>
    typeof m.content === "string" ? [] : m.content.flatMap((b) => (b.type === "tool_result" ? [b.content] : [])));
}

describe("rowsToThreads — a pre-upgrade thread is minimised on load (AI-08, AI-05)", () => {
  const [thread] = rowsToThreads(pipelineRow(oldThreadHistory()) as Parameters<typeof rowsToThreads>[0]);
  const results = toolResults(thread.history);

  it("no stored tool result still carries an e-mail address, an absence's real type or its note", () => {
    expect(results).toHaveLength(4); // control: every tool result was decoded
    for (const r of results) {
      expect(r).not.toMatch(/@example\.com/);
      expect(r).not.toMatch(/"(assigneeEmail|ownerEmail|toEmail|email|emails)"/);
      expect(r).not.toMatch(/"sick"|"vacation"|surgery/);
    }
  });

  it("keeps the rest of every result, and reads each absence as \"absent\"", () => {
    expect(JSON.parse(results[0])).toEqual([
      { id: 5, assignee: "Ada", startDate: "2026-02-01", endDate: "2026-02-03", type: "absent" },
      { id: 6, assignee: "Bo", startDate: "2026-03-01", endDate: "2026-03-02", type: "absent" },
    ]);
    expect(JSON.parse(results[1])).toEqual({ id: 1, title: "Deck", assignee: "Ada", version: "t1" });
    expect(JSON.parse(results[2])).toEqual({
      stakeholders: [{ id: 2, name: "Bo", organization: "ACME", raci: {} }],
      resources: [{ id: 3, firstName: "Cy", lastName: "Do" }],
    });
    // An escalation's note is not an absence's: only its address goes.
    expect(JSON.parse(results[3])).toEqual({
      id: 4, title: "Risk", owner: "Ada",
      escalations: [{ at: "2026-01-01", toName: "Eve", note: "kept: not an absence" }],
    });
  });

  it("leaves the user's and the assistant's own text, and the tool call, as written", () => {
    expect(thread.history[0]).toEqual({ role: "user", content: USER_TEXT });
    expect(thread.history[1]).toEqual(oldThreadHistory()[1]);
    const carrier = thread.history[2].content as { type: string; text?: string }[];
    expect(carrier[4]).toEqual({ type: "text", text: "a user note with ada@example.com" });
  });
});

describe("minimiseToolResultText", () => {
  it("returns an already-minimised result byte for byte (the prompt cache prefix survives)", () => {
    const text = pretty({ id: 1, title: "Deck", assignee: "Ada" });
    expect(minimiseToolResultText(text)).toBe(text);
    const compact = JSON.stringify({ id: 1 });
    expect(minimiseToolResultText(compact)).toBe(compact);
  });

  it("strips addresses, notes and absence types from a result that does not parse", () => {
    const cut = '[{"assignee":"Ada","assigneeEmail":"ada@example.com","type":"sick","note":"surgery","startDate":"2026-0';
    const out = minimiseToolResultText(cut);
    expect(out).not.toMatch(/ada@example\.com|surgery|"sick"/);
    expect(out).toContain('"type": "absent"');
    expect(minimiseToolResultText("Error: no reply from bo@example.com")).toBe("Error: no reply from [email removed]");
  });

  it("minimiseStoredToolResults never mutates its input", () => {
    const history = oldThreadHistory();
    const before = JSON.stringify(history);
    minimiseStoredToolResults(history);
    expect(JSON.stringify(history)).toBe(before);
  });
});

// AI-08 — `get_contact_email` is the one tool built to return an address, one person at a time, when asked: its
// stored result keeps it on load, matched by the `tool_use_id` to a `tool_use` of that name in the same history.
describe("minimiseStoredToolResults — a looked-up address is kept (AI-08)", () => {
  const LOOKED_UP = pretty({ id: 3, email: "cy@example.com", emails: ["cy2@example.com"] });
  function historyWithLookup(): ApiMessage[] {
    return [
      { role: "user", content: "What is Cy's address?" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "c1", name: "get_contact_email", input: { kind: "resource", id: 3 } },
          { type: "tool_use", id: "c2", name: "get_task", input: { id: 1 } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: LOOKED_UP },
          { type: "tool_result", tool_use_id: "c2", content: pretty(OLD_TASK) },
        ],
      },
    ] as ApiMessage[];
  }

  it("keeps a get_contact_email result as stored", () => {
    const [, , carrier] = minimiseStoredToolResults(historyWithLookup());
    expect(toolResults([carrier])[0]).toBe(LOOKED_UP);
  });

  it("still strips every other tool result in the same history", () => {
    const [, , carrier] = minimiseStoredToolResults(historyWithLookup());
    expect(JSON.parse(toolResults([carrier])[1])).toEqual({ id: 1, title: "Deck", assignee: "Ada", version: "t1" });
  });

  it("a result whose tool_use_id names no get_contact_email call is stripped, address-shaped or not", () => {
    const history = historyWithLookup();
    const carrier = history[2].content as { type: string; tool_use_id?: string }[];
    carrier[0].tool_use_id = "c9"; // answers no call in this history
    const [, , out] = minimiseStoredToolResults(history);
    expect(JSON.parse(toolResults([out])[0])).toEqual({ id: 3 });
  });

  it("a result without a tool_use_id is stripped, even beside a get_contact_email call without an id", () => {
    const history = historyWithLookup();
    const calls = history[1].content as { id?: string }[];
    delete calls[0].id; // a malformed get_contact_email call: no id
    const carrier = history[2].content as { tool_use_id?: string }[];
    delete carrier[0].tool_use_id; // a malformed result: no tool_use_id
    const [, , out] = minimiseStoredToolResults(history);
    expect(JSON.parse(toolResults([out])[0])).toEqual({ id: 3 });
    expect(JSON.parse(toolResults([out])[1])).toEqual({ id: 1, title: "Deck", assignee: "Ada", version: "t1" }); // control
  });
});
