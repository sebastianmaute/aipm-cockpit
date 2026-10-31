import { describe, expect, it, vi } from "vitest";
import {
  AI_ORGANIZATION_ID_ENV,
  AI_WORKSPACE_IDS_ENV,
  parseAiKeyRestriction,
  readAiKeyRestriction,
} from "./ai-key-restriction-config";

const ORG = "11111111-2222-3333-4444-555555555555";
// Workspace ids are `wrkspc_` plus an alphanumeric identifier, case-sensitive (invented here).
const WS_A = "wrkspc_01InventedAlphaQ7x";
const WS_B = "wrkspc_01InventedBetaZ3k";

describe("parseAiKeyRestriction", () => {
  it("names the two settings", () => {
    expect(AI_ORGANIZATION_ID_ENV).toBe("AIPM_AI_ORGANIZATION_ID");
    expect(AI_WORKSPACE_IDS_ENV).toBe("AIPM_AI_WORKSPACE_IDS");
  });

  it("is none when nothing is set, or both are empty or blank", () => {
    expect(parseAiKeyRestriction({})).toEqual({ kind: "none" });
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: "", AIPM_AI_WORKSPACE_IDS: "" })).toEqual({ kind: "none" });
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: "  ", AIPM_AI_WORKSPACE_IDS: " " })).toEqual({ kind: "none" });
  });

  it("restricts to an organisation, with no workspace list", () => {
    const r = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG });
    expect(r).toMatchObject({ kind: "restricted", organizationId: ORG, workspaceIds: null });
  });

  it("trims the workspace list, lower-cases the organisation id and keeps each workspace id's case", () => {
    const r = parseAiKeyRestriction({
      AIPM_AI_ORGANIZATION_ID: ` ${ORG.toUpperCase()} `,
      AIPM_AI_WORKSPACE_IDS: ` ${WS_A} , ${WS_B} `,
    });
    expect(r).toMatchObject({ kind: "restricted", organizationId: ORG, workspaceIds: [WS_A, WS_B] });
  });

  it("does not fold the case of a workspace id: two ids differing only in case stay distinct", () => {
    const r = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: WS_A.toUpperCase().replace("WRKSPC_", "wrkspc_") });
    expect(r).toMatchObject({ kind: "restricted", workspaceIds: ["wrkspc_01INVENTEDALPHAQ7X"] });
  });

  it("gives a stable signature of the two normalised values", () => {
    const a = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: `${WS_A},${WS_B}` });
    const b = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG.toUpperCase(), AIPM_AI_WORKSPACE_IDS: ` ${WS_A} , ${WS_B}` });
    const c = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG });
    const d = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: WS_A });
    const e = parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: "wrkspc_01inventedalphaq7x" });
    const sig = (r: ReturnType<typeof parseAiKeyRestriction>) => (r.kind === "restricted" ? r.signature : null);
    expect(sig(a)).toBeTruthy();
    expect(sig(a)).toBe(sig(b));
    expect(new Set([sig(a), sig(c), sig(d), sig(e)]).size).toBe(4);
  });

  it.each(["not-a-uuid", "1111111122223333444455555555555", `${ORG}x`])("rejects the organisation id %s", (org) => {
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: org })).toEqual({ kind: "invalid", reason: "org-id" });
  });

  it.each([
    `${WS_A},nope`,
    `${WS_A},`,
    `${WS_A},,${WS_B}`,
    ",",
    `${WS_A};${WS_B}`,
    // A UUID is an organisation id's shape, not a workspace id's.
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "wrkspc_",
    "WRKSPC_01InventedAlphaQ7x",
    "wrkspc_01Invented-Alpha",
    "wrkspc_01Invented Alpha",
    "xwrkspc_01InventedAlphaQ7x",
  ])("rejects the workspace list %s", (list) => {
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: list })).toEqual({
      kind: "invalid",
      reason: "workspace-ids",
    });
  });

  it("rejects workspaces without an organisation", () => {
    expect(parseAiKeyRestriction({ AIPM_AI_WORKSPACE_IDS: WS_A })).toEqual({ kind: "invalid", reason: "workspaces-without-org" });
  });

  it("reports the organisation id before the workspace list", () => {
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: "bad", AIPM_AI_WORKSPACE_IDS: "bad" })).toEqual({ kind: "invalid", reason: "org-id" });
  });
});

describe("readAiKeyRestriction", () => {
  it("logs an invalid setting once per reason, by code only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      readAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: "secret-looking-value" });
      readAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: "secret-looking-value" });
      readAiKeyRestriction({ AIPM_AI_WORKSPACE_IDS: WS_A });
      readAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG });
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines).toEqual([
        "ai key restriction invalid: org-id",
        "ai key restriction invalid: workspaces-without-org",
      ]);
      expect(lines.join(" ")).not.toContain("secret-looking-value");
    } finally {
      warn.mockRestore();
    }
  });
});
