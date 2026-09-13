import { describe, it, expect, beforeAll } from "vitest";
import {
  nextSeverity,
  planEscalation,
  applyEscalation,
  buildEscalationMail,
  buildEscalationEntry,
  buildEscalationRecord,
  describeEscalation,
  escalationActivityArgs,
  resolveEscalationRecipient,
  aiEscalationNoteAuthor,
} from "./action-escalate";
import { loadI18n, t } from "./i18n";
import { severityLabel } from "./raid-labels";
import type { RaidItem } from "./types";

function raid(partial: Partial<RaidItem>): RaidItem {
  return { id: 1, category: "I", title: "X", status: "Open", severity: "High", ...partial } as RaidItem;
}

describe("nextSeverity", () => {
  it("steps one level up", () => {
    expect(nextSeverity("Low")).toBe("Medium");
    expect(nextSeverity("Medium")).toBe("High");
    expect(nextSeverity("High")).toBe("Critical");
  });
  it("returns null at the top", () => {
    expect(nextSeverity("Critical")).toBeNull();
  });
});

describe("planEscalation", () => {
  it("raises severity for a High Issue", () => {
    expect(planEscalation(raid({ category: "I", severity: "High" }))).toEqual({
      raisesSeverity: true, from: "High", to: "Critical",
    });
  });
  it("raises a Medium Dependency to High", () => {
    expect(planEscalation(raid({ category: "D", severity: "Medium" }))).toEqual({
      raisesSeverity: true, from: "Medium", to: "High",
    });
  });
  it("is notify-only for Risks (matrix-derived)", () => {
    expect(planEscalation(raid({ category: "R", severity: "High" }))).toEqual({
      raisesSeverity: false, reason: "risk",
    });
  });
  it("is notify-only for an already-Critical Issue", () => {
    expect(planEscalation(raid({ category: "I", severity: "Critical" }))).toEqual({
      raisesSeverity: false, reason: "max",
    });
  });
  it("is notify-only when severity is missing", () => {
    expect(planEscalation(raid({ category: "A", severity: undefined }))).toEqual({
      raisesSeverity: false, reason: "max",
    });
  });
});

describe("applyEscalation", () => {
  it("raises the matched item immutably", () => {
    const before = [raid({ id: 1, severity: "High" }), raid({ id: 2, severity: "High" })];
    const after = applyEscalation(before, 1, "Critical");
    expect(after[0].severity).toBe("Critical");
    expect(after[1].severity).toBe("High");
    expect(after).not.toBe(before);
    expect(before[0].severity).toBe("High");
  });
  it("returns the same ref when no item matches", () => {
    const before = [raid({ id: 1 })];
    expect(applyEscalation(before, 99, "Critical")).toBe(before);
  });
});

describe("buildEscalationMail", () => {
  beforeAll(() => loadI18n("de"));
  const item = raid({ id: 7, title: "Vendor slip", category: "I", severity: "High" });

  it("builds an EN subject and includes the severity-raised line when raising", () => {
    const plan = planEscalation(item);
    const { subject, body } = buildEscalationMail("en-US", item, plan, "Apollo");
    expect(subject).toBe("Escalation: RAID #7 — Vendor slip");
    expect(body).toContain("RAID item #7 (Vendor slip) needs escalation.");
    expect(body).toContain("Severity raised from High to Critical.");
    expect(body).toContain("Project: Apollo");
    expect(body).toContain("Please advise on next steps.");
  });

  it("omits the severity-raised line for a notify-only (Risk) plan", () => {
    const riskItem = raid({ id: 8, title: "FX risk", category: "R", severity: "High" });
    const plan = planEscalation(riskItem);
    const { body } = buildEscalationMail("en-US", riskItem, plan, "Apollo");
    expect(body).not.toContain("Severity raised");
    expect(body).toContain("RAID item #8 (FX risk) needs escalation.");
  });

  it("renders in German", () => {
    const plan = planEscalation(item);
    const { subject, body } = buildEscalationMail("de", item, plan, "Apollo");
    expect(subject).toBe("Eskalation: RAID #7 — Vendor slip");
    expect(body).toContain("Schweregrad von High auf Critical erhöht.");
  });
});

const JANE = { name: "Jane Doe", email: "jane@example.com", resourceId: 4 };
const AT = "2026-09-13T08:00:00.000Z";
const AUTHOR = { self: 7, authorName: "Pat Lee" };

describe("buildEscalationEntry", () => {
  it("records recipient and the severity step when the plan raises", () => {
    expect(buildEscalationEntry({ raisesSeverity: true, from: "High", to: "Critical" }, JANE, AT)).toEqual({
      at: AT, toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical",
    });
  });
  it("is notify-only for a Risk and drops a blank name and a null resource", () => {
    expect(buildEscalationEntry({ raisesSeverity: false, reason: "risk" }, { name: "  ", email: "ops@example.com", resourceId: null }, AT))
      .toEqual({ at: AT, toEmail: "ops@example.com" });
  });
  it("strips a <br> tag from a free-text name, so the record and the note echo cannot carry it (§515)", () => {
    const entry = buildEscalationEntry({ raisesSeverity: false, reason: "risk" }, { name: "Jane<BR/>Doe", email: "jane@example.com", resourceId: null }, AT);
    expect(entry.toName).toBe("Jane Doe");
    expect(describeEscalation("en-US", entry)).not.toMatch(/<br/i);
    expect(describeEscalation("en-US", entry)).toContain("Jane Doe <jane@example.com>"); // positive control
  });
});

describe("describeEscalation", () => {
  it("names the recipient and the translated severity step", () => {
    expect(describeEscalation("en-US", { at: AT, toName: "Jane Doe", toEmail: "jane@example.com", fromSeverity: "High", toSeverity: "Critical" }))
      .toBe(t("en-US", "raidEscalationNoteRaised", "Jane Doe <jane@example.com>", severityLabel("High", "en-US"), severityLabel("Critical", "en-US")));
  });
  it("falls back to the bare address and says notify only", () => {
    expect(describeEscalation("en-US", { at: AT, toEmail: "ops@example.com" })).toBe("Escalated to ops@example.com (notify only)");
  });
  it("renders in German", async () => {
    await loadI18n("de");
    expect(describeEscalation("de", { at: AT, toEmail: "ops@example.com" })).toBe("Eskaliert an ops@example.com (nur Benachrichtigung)");
  });
});

describe("buildEscalationRecord", () => {
  it("raises severity, appends the record and a note, and stamps localModifiedAt", () => {
    const item = raid({ id: 3, category: "I", severity: "High" });
    const plan = planEscalation(item);
    const text = describeEscalation("en-US", buildEscalationEntry(plan, JANE, AT));
    const next = buildEscalationRecord(item, plan, JANE, AT, text, AUTHOR);
    expect(next.severity).toBe("Critical");
    expect(next.escalations).toEqual([buildEscalationEntry(plan, JANE, AT)]);
    expect(next.noteLog).toHaveLength(1);
    expect(next.noteLog?.[0]).toMatchObject({ timestamp: AT, text, authorResourceId: 7, authorName: "Pat Lee" });
    expect(next.localModifiedAt).toBe(AT);
    expect(item.escalations).toBeUndefined(); // input not mutated
  });
  it("leaves severity alone for a notify-only escalation", () => {
    const item = raid({ category: "R", severity: "High" });
    const plan = planEscalation(item);
    const next = buildEscalationRecord(item, plan, JANE, AT, "x", AUTHOR);
    expect(next.severity).toBe("High");
    expect(next.escalations?.[0]?.toSeverity).toBeUndefined();
  });
  it("appends to an existing record and PRESERVES the existing note log", () => {
    const earlier = { at: "2026-09-01T00:00:00.000Z", toEmail: "ops@example.com" };
    const older = { id: 1, timestamp: "2026-08-01T00:00:00.000Z", html: "<p>older</p>", text: "older" };
    const item = raid({ category: "I", severity: "Medium", escalations: [earlier], noteLog: [older] });
    const next = buildEscalationRecord(item, planEscalation(item), JANE, AT, "escalated", AUTHOR);
    expect(next.escalations).toEqual([earlier, expect.objectContaining({ fromSeverity: "Medium", toSeverity: "High" })]);
    expect(next.noteLog?.map((n) => n.text)).toEqual(["older", "escalated"]);
    expect(next.noteLog?.[1]?.id).toBe(2);
  });
});

describe("escalationActivityArgs", () => {
  it("is the severity step when the plan raises", () => {
    expect(escalationActivityArgs({ severity: "High" }, { raisesSeverity: true, from: "High", to: "Critical" }))
      .toEqual(["High", "Critical"]);
  });
  it("repeats the current severity, or an em dash, when notify-only", () => {
    expect(escalationActivityArgs({ severity: "Critical" }, { raisesSeverity: false, reason: "max" }))
      .toEqual(["Critical", "Critical"]);
    expect(escalationActivityArgs({}, { raisesSeverity: false, reason: "risk" })).toEqual(["—", "—"]);
  });
});

describe("resolveEscalationRecipient (§515 AI path)", () => {
  const ADA = { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", emails: ["a.l@example.com"] };
  const GRACE = { id: 8, firstName: "Grace", lastName: "Hopper", email: "grace@example.com" };

  it("links the one resource whose primary address matches, case-insensitively, and borrows its name", () => {
    expect(resolveEscalationRecipient(" ADA@example.com ", "", [ADA, GRACE]))
      .toEqual({ name: "Ada Lovelace", email: "ADA@example.com", resourceId: 7 });
  });
  it("matches an additional address too, and a model-chosen name wins", () => {
    expect(resolveEscalationRecipient("a.l@example.com", " The Countess ", [ADA, GRACE]))
      .toEqual({ name: "The Countess", email: "a.l@example.com", resourceId: 7 });
  });
  it("links nobody when no resource, or more than one, matches", () => {
    expect(resolveEscalationRecipient("ops@example.com", "", [ADA, GRACE]))
      .toEqual({ name: "", email: "ops@example.com", resourceId: null });
    expect(resolveEscalationRecipient("grace@example.com", "", [GRACE, { ...GRACE, id: 9 }]))
      .toEqual({ name: "", email: "grace@example.com", resourceId: null });
  });
});

describe("aiEscalationNoteAuthor (§515, user decision: \"AI created\")", () => {
  it("labels the note \"AI created\" and attributes it to no resource (positive control: a self id DOES attribute)", () => {
    const item = raid({ id: 3, category: "I", severity: "High" });
    const plan = planEscalation(item);
    const ai = buildEscalationRecord(item, plan, JANE, AT, "x", aiEscalationNoteAuthor("en-US"));
    const human = buildEscalationRecord(item, plan, JANE, AT, "x", AUTHOR);
    expect(ai.noteLog?.[0]?.authorName).toBe("AI created");
    expect(ai.noteLog?.[0]?.authorResourceId).toBeUndefined();
    expect(human.noteLog?.[0]?.authorResourceId).toBe(7);
  });
  it("is translated in German", async () => {
    await loadI18n("de");
    expect(aiEscalationNoteAuthor("de")).toEqual({ self: null, authorName: "Von KI erstellt" });
  });
});
