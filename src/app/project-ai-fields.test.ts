import { describe, it, expect } from "vitest";
import type { ProjectMeta } from "./types";
import {
  PROJECT_AI_FIELDS,
  PROJECT_AI_EXCLUDED,
  judgeProjectField,
  applyProjectPatch,
} from "./project-ai-fields";
import { BUDGET_NAME_MAX } from "./sanitize-entities";

const FULL: Required<ProjectMeta> = {
  name: "Atlas", code: "AT-1", description: "d", sponsor: "s", projectManager: "pm",
  keyStakeholdersInternal: [], keyStakeholdersExternal: [], customer: "Northwind",
  naceSection: "C", identityTypes: [], identityCount: 1, stakeholderCount: 1, products: "p",
  platform: "pl", deployment: "Cloud", startDate: "2026-03-01", endDate: "2026-12-31",
  profitCenter: "pc", quotes: "q", salesforceUrl: "", sharepointUrl: "", confluenceUrl: "",
  jiraUrl: "", operatingTimezone: "Europe/Berlin", contactPersons: [], docRepoLocation: "",
  regulatory: [], notes: "n", knowledgeLinks: [],
};
const CTX = { startDate: "2026-03-01", endDate: "2026-12-31" };
const GDPR = "GDPR / data protection regulation";

describe("project AI fields", () => {
  it("every ProjectMeta key is offered or excluded with a reason", () => {
    const offered = new Set<string>(PROJECT_AI_FIELDS);
    const excluded = Object.keys(PROJECT_AI_EXCLUDED);
    for (const key of Object.keys(FULL)) {
      expect(Number(offered.has(key)) + Number(excluded.includes(key))).toBe(1);
    }
    expect(offered.size + excluded.length).toBe(Object.keys(FULL).length);
    for (const reason of Object.values(PROJECT_AI_EXCLUDED)) expect(reason.length).toBeGreaterThan(0);
  });

  it('regulatory: GDPR accepted; an unknown value refused; "Not applicable" with GDPR normalises to ["Not applicable"]', () => {
    expect(judgeProjectField("regulatory", [GDPR], CTX)).toEqual({ kind: "accepted", value: [GDPR] });
    expect(judgeProjectField("regulatory", ["Made-up act"], CTX).kind).toBe("refused");
    const v = judgeProjectField("regulatory", ["Not applicable", GDPR], CTX);
    expect(v.kind).toBe("normalised");
    expect(v.kind === "normalised" && v.value).toEqual(["Not applicable"]);
  });

  it("deployment and naceSection outside their sets are refused, not the record", () => {
    expect(judgeProjectField("deployment", "Moon", CTX).kind).toBe("refused");
    expect(judgeProjectField("naceSection", "ZZ", CTX).kind).toBe("refused");
    expect(judgeProjectField("deployment", "Cloud", CTX).kind).toBe("accepted");
  });

  it("a text over its cap is normalised to the truncated value", () => {
    const v = judgeProjectField("name", "x".repeat(BUDGET_NAME_MAX + 50), CTX);
    expect(v.kind).toBe("normalised");
    expect(v.kind === "normalised" && (v.value as string).length).toBe(BUDGET_NAME_MAX);
  });

  it("an unsafe URL is refused", () => {
    expect(judgeProjectField("jiraUrl", "javascript:alert(1)", CTX).kind).toBe("refused");
    expect(judgeProjectField("jiraUrl", "https://jira.example.com/browse/X", CTX).kind).toBe("accepted");
  });

  it("endDate before the stored startDate is refused; both passed and inverted refuses the endDate", () => {
    const a = applyProjectPatch(FULL, { endDate: "2026-02-01" });
    expect(a.rows.find((r) => r.field === "endDate")?.verdict.kind).toBe("refused");
    expect(a.next.endDate).toBe(FULL.endDate);
    const b = applyProjectPatch(FULL, { startDate: "2026-05-01", endDate: "2026-04-01" });
    expect(b.rows.find((r) => r.field === "startDate")?.verdict.kind).toBe("accepted");
    expect(b.rows.find((r) => r.field === "endDate")?.verdict.kind).toBe("refused");
    expect(b.next.startDate).toBe("2026-05-01");
  });

  it("counts: a negative or non-integer identityCount is refused", () => {
    expect(judgeProjectField("identityCount", -1, CTX).kind).toBe("refused");
    expect(judgeProjectField("identityCount", 2.5, CTX).kind).toBe("refused");
    expect(judgeProjectField("identityCount", "40", CTX)).toEqual({ kind: "accepted", value: 40 });
    expect(judgeProjectField("identityCount", 40, CTX)).toEqual({ kind: "accepted", value: 40 });
  });

  it("applyProjectPatch leaves fields it was not given untouched and reports unknown keys", () => {
    const stored = { ...FULL, customer: "Northwind" };
    const r = applyProjectPatch(stored, { sponsor: "Elena Fischer", contactPersons: [], expectedToken: "t" });
    expect(r.next.customer).toBe("Northwind");
    expect(r.next.sponsor).toBe("Elena Fischer");
    expect(r.unknownKeys).toEqual(["contactPersons"]);
  });
  it("a refused endDate cannot leave a new startDate after the stored endDate", () => {
    const stored = { ...FULL, startDate: "2026-03-01", endDate: "2026-04-01" };
    const r = applyProjectPatch(stored, { startDate: "2026-05-01", endDate: "2026-04-15" });
    expect(r.rows.find((x) => x.field === "startDate")?.verdict.kind).toBe("refused");
    expect(r.rows.find((x) => x.field === "endDate")?.verdict.kind).toBe("refused");
    expect(r.next.startDate).toBe("2026-03-01");
    expect(r.next.endDate).toBe("2026-04-01");
  });
});
