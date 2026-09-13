import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { describeEscalation } from "./action-escalate";
import { entityToken } from "./ai-entity-token";
import { runTool } from "./chat-tools";
import { loadI18n } from "./i18n";
import { authorLabel } from "./note-log-panel";
import { defaultSettings } from "./settings-types";
import type { RaidItem, Resource } from "./types";
import { useChatDispatcher, type ChatDispatcherArgs } from "./use-chat-dispatcher";
import { useWorkspace } from "./workspace-context";

// §515 — the AI appends ONE escalation through the real dispatcher. Every
// assertion reads the STORED row (the tool returns a summary), and every
// refusal carries a positive control in the same test.

function issue(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 5, category: "I", title: "Vendor down", status: "Open", severity: "High",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-05-01",
    ...over,
  };
}
const EARLIER = { at: "2026-05-01T09:00:00.000Z", toEmail: "ops@example.com" };
const JANE = {
  id: 4, firstName: "Jane", lastName: "Doe", email: "jane@example.com",
  roleId: null, utilizationMode: "percent", utilization: {},
} as unknown as Resource;
// The user IS Jane: a note wrongly attributed to `selfResourceId` would carry id 4.
const EN_AS_JANE = { ...defaultSettings, language: "en-US" as const, selfResourceId: 4 };

function probe(raid: RaidItem[], over: Partial<ChatDispatcherArgs> = {}) {
  const logActivityAs = vi.fn();
  const hook = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs({ logActivityAs, ...over })), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith({ raid, resources: [JANE] }) },
  );
  return { ...hook, logActivityAs };
}
const stored = (ws: { raid: readonly RaidItem[] }, id = 5) => ws.raid.find((r) => r.id === id)!;
const tokenOf = (row: RaidItem | null) => entityToken("raid", row!);

describe("escalate_raid_item — the AI appends one escalation (§515)", () => {
  it("appends the entry, an \"AI created\" note, the severity step and one raid.escalated row", async () => {
    const { result, logActivityAs } = probe([issue({ escalations: [EARLIER] })], { settings: EN_AS_JANE });
    let out: unknown;
    await act(async () => {
      out = await runTool(result.current.d, "escalate_raid_item", {
        id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), toEmail: "jane@example.com",
      });
    });
    const row = stored(result.current.ws);
    expect(row.severity).toBe("Critical");
    expect(row.escalations).toEqual([
      EARLIER,
      { at: expect.any(String), toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical" },
    ]);
    expect(row.noteLog).toHaveLength(1);
    expect(row.noteLog?.[0]?.text).toBe(describeEscalation("en-US", row.escalations![1]));
    // Author: the literal label, NOT the user's own resource (selfResourceId 4 is set above).
    expect(row.noteLog?.[0]?.authorName).toBe("AI created");
    expect(row.noteLog?.[0]?.authorResourceId).toBeUndefined();
    expect(authorLabel(row.noteLog![0], [JANE])).toBe("AI created");
    expect(logActivityAs).toHaveBeenCalledTimes(1);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "raid.escalated", 5, "High", "Critical");
    // Positive control above (the row was logged); the address never is.
    expect(JSON.stringify(logActivityAs.mock.calls)).not.toContain("jane@example.com");
    expect(out).toMatchObject({ id: 5, severity: "Critical", severityRaised: true, emailSent: false });
  });

  it.each([
    ["an Issue already at Critical", issue({ severity: "Critical" }), "Critical"],
    ["a Risk, whose severity the matrix owns", issue({ category: "R", severity: "High" }), "High"],
  ])("records %s as notify-only and leaves severity alone", async (_label, seed, severity) => {
    const { result, logActivityAs } = probe([seed]);
    await act(async () => {
      await runTool(result.current.d, "escalate_raid_item", {
        id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), toEmail: "ops@example.com",
      });
    });
    const row = stored(result.current.ws);
    expect(row.severity).toBe(severity);
    expect(row.escalations).toEqual([{ at: expect.any(String), toEmail: "ops@example.com" }]);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "raid.escalated", 5, severity, severity);
  });

  it.each([
    ["clear", []],
    ["rewrite", [{ ...EARLIER, toEmail: "evil@example.com" }]],
  ])("update_raid_item cannot %s the history (positive control: the title DOES change)", async (_verb, escalations) => {
    const { result } = probe([issue({ escalations: [EARLIER] })]);
    await act(async () => {
      await runTool(result.current.d, "update_raid_item", {
        id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), title: "Vendor down (renamed)", escalations,
      });
    });
    const row = stored(result.current.ws);
    expect(row.title).toBe("Vendor down (renamed)");
    expect(row.escalations).toEqual([EARLIER]);
  });

  it("refuses a second escalation made from the same read, so a retried call cannot double-record", async () => {
    const { result } = probe([issue()]);
    const token = tokenOf(result.current.d.getRaidRow(5));
    await act(async () => {
      await runTool(result.current.d, "escalate_raid_item", { id: 5, expectedToken: token, toEmail: "jane@example.com" });
    });
    await act(async () => {
      await expect(
        runTool(result.current.d, "escalate_raid_item", { id: 5, expectedToken: token, toEmail: "jane@example.com" }),
      ).rejects.toThrow(/changed since you read it/);
    });
    expect(stored(result.current.ws).escalations).toHaveLength(1); // the first one DID land
  });

  it("composes with a same-tick human edit to another field (ONE functional write)", () => {
    const { result } = probe([issue()]);
    act(() => {
      result.current.ws.setRaid((prev) => prev.map((r) => (r.id === 5 ? { ...r, title: "Renamed by a human" } : r)));
      result.current.d.escalateRaid(5, { email: "jane@example.com", name: "" });
    });
    const row = stored(result.current.ws);
    expect(row.title).toBe("Renamed by a human");
    expect(row.escalations).toHaveLength(1);
    expect(row.severity).toBe("Critical");
  });

  it("refuses in a read-only popout and records nothing (positive control: the refusal fires)", () => {
    const { result, logActivityAs } = probe([issue()], { isReadOnly: true });
    expect(() => result.current.d.escalateRaid(5, { email: "jane@example.com", name: "" })).toThrow(/pop-?out/i);
    expect(stored(result.current.ws).escalations).toBeUndefined();
    expect(logActivityAs).not.toHaveBeenCalled();
  });

  describe("in German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });
    it("writes the note AND its author label in the project language", async () => {
      const { result } = probe([issue()], { settings: { ...EN_AS_JANE, language: "de" } });
      await act(async () => {
        await runTool(result.current.d, "escalate_raid_item", {
          id: 5, expectedToken: tokenOf(result.current.d.getRaidRow(5)), toEmail: "ops@example.com",
        });
      });
      const row = stored(result.current.ws);
      expect(row.noteLog?.[0]?.text).toBe(describeEscalation("de", row.escalations![0]));
      expect(row.noteLog?.[0]?.text.startsWith("Eskaliert an ops@example.com")).toBe(true);
      expect(row.noteLog?.[0]?.authorName).toBe("Von KI erstellt");
      expect(row.noteLog?.[0]?.authorResourceId).toBeUndefined();
    });
  });
});
