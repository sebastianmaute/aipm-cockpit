import { describe, expect, it, vi } from "vitest";
import {
  AI_ORGANIZATION_ID_ENV,
  AI_WORKSPACE_IDS_ENV,
  isMisspelledRestrictionEnv,
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

describe("parseAiKeyRestriction — misspelled settings", () => {
  const MISSPELLED = [
    "AIPM_AI_ORGANISATION_ID",
    "AIPM_AI_ORGANISATION_IDS",
    "AIPM_AI_ORGANIZATION_IDS",
    "AIPM_AI_WORKSPACE_ID",
    "AIPM_AI_ORG_ID",
    "AIPM_AI_WORKSPACES_IDS",
    "aipm_ai_organization_id",
    "Aipm_Ai_Workspace_Ids",
  ];

  it.each(MISSPELLED)("the rule catches %s", (name) => {
    expect(isMisspelledRestrictionEnv(name)).toBe(true);
  });

  it.each(["AIPM_AI_ORGANIZATION_ID", "AIPM_AI_WORKSPACE_IDS", "AIPM_AI_GATEWAY_URL", "AIPM_AI_GATEWAY_TOKEN", "AIPM_DISABLED_INTEGRATIONS", "ORG_ID", "XAIPM_AI_ORG_ID"])(
    "the rule leaves %s alone",
    (name) => {
      expect(isMisspelledRestrictionEnv(name)).toBe(false);
    },
  );

  it.each(MISSPELLED)("%s alone is invalid, never silently unrestricted", (name) => {
    expect(parseAiKeyRestriction({ [name]: ORG })).toEqual({ kind: "invalid", reason: "misspelled-setting" });
  });

  it.each(MISSPELLED)("%s beside a valid setting is still invalid", (name) => {
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: WS_A, [name]: ORG })).toEqual({
      kind: "invalid",
      reason: "misspelled-setting",
    });
  });

  it.each(MISSPELLED)("%s empty or blank is ignored", (name) => {
    expect(parseAiKeyRestriction({ [name]: "" })).toEqual({ kind: "none" });
    expect(parseAiKeyRestriction({ [name]: "   " })).toEqual({ kind: "none" });
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: ORG, [name]: " " })).toMatchObject({ kind: "restricted" });
  });

  it("is reported before an invalid correctly spelled setting", () => {
    expect(parseAiKeyRestriction({ AIPM_AI_ORGANIZATION_ID: "bad", AIPM_AI_WORKSPACE_ID: WS_A })).toEqual({
      kind: "invalid",
      reason: "misspelled-setting",
    });
  });

  it("an unrelated AIPM_AI_ setting does not count", () => {
    expect(parseAiKeyRestriction({ AIPM_AI_GATEWAY_URL: "https://gateway.example.net/x", AIPM_AI_ORGANIZATION_ID: ORG })).toMatchObject({
      kind: "restricted",
    });
  });

  /** Windows' `process.env`: lookups ignore case, and its keys are the names exactly as they were set. */
  function windowsLikeEnv(vars: Record<string, string>): Record<string, string | undefined> {
    const find = (name: string) => Object.keys(vars).find((k) => k.toUpperCase() === name.toUpperCase());
    return new Proxy(vars, {
      get: (target, prop) => (typeof prop === "string" ? target[find(prop) ?? prop] : undefined),
      has: (_target, prop) => typeof prop === "string" && find(prop) !== undefined,
    });
  }

  it("on a case-insensitive environment, the real names set as written still restrict", () => {
    expect(parseAiKeyRestriction(windowsLikeEnv({ AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: WS_A }))).toMatchObject({
      kind: "restricted",
      workspaceIds: [WS_A],
    });
  });

  it("on a case-insensitive environment, a real name set in lower case is still misspelled", () => {
    // The lookup by the real name would find it there, but the name was not written as documented.
    expect(parseAiKeyRestriction(windowsLikeEnv({ aipm_ai_organization_id: ORG }))).toEqual({ kind: "invalid", reason: "misspelled-setting" });
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
