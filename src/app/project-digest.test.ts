import { describe, expect, test } from "vitest";
import { CONTEXT_CAP_PER_CATEGORY } from "./action-ai";
import { buildProjectDigest, DIGEST_MAX_CHARS, type ProjectDigestInput } from "./project-digest";
import { TEXTAREA_MAX } from "./sanitize-core";
import type { ChangeItem, Milestone, RaidItem, Stakeholder, Task } from "./types";

const task = (over: Partial<Task>): Task =>
  ({
    id: 1, taskName: "Task", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "2026-10-01",
    priority: "Medium", status: "To Do", blockers: "", description: "", ...over,
  }) as Task;
const raidItem = (over: Partial<RaidItem>): RaidItem =>
  ({ id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-10-01", causedByRaidIds: [], stakeholderIds: [], ...over }) as RaidItem;
const milestone = (over: Partial<Milestone>): Milestone =>
  ({ id: 1, name: "Milestone", date: "2026-11-01", linkedTaskIds: [], ...over }) as Milestone;
const change = (over: Partial<ChangeItem>): ChangeItem =>
  ({ id: 1, title: "Change", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-10-01", linkedTaskIds: [], linkedRaidIds: [], ...over }) as ChangeItem;
const stakeholder = (over: Partial<Stakeholder>): Stakeholder =>
  ({ id: 1, name: "Sofia Ramirez", category: "Sponsor", influence: "High", interest: "High", ...over }) as Stakeholder;

const base = (over: Partial<ProjectDigestInput> = {}): ProjectDigestInput => ({
  projectName: "Apollo", today: "2026-10-23", mode: "advanced", enabledModules: ["raid"],
  tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], queue: [], ...over,
});

const lineWith = (text: string, needle: string): string => text.split("\n").find((l) => l.includes(needle))!;

describe("buildProjectDigest", () => {
  test("omits Done and Cancelled tasks and Closed RAID items", () => {
    const text = buildProjectDigest(base({
      tasks: [
        task({ id: 1, taskName: "Finished work", status: "Done" }),
        task({ id: 2, taskName: "Dropped work", status: "Cancelled" }),
        task({ id: 3, taskName: "Live work" }),
      ],
      raid: [raidItem({ id: 4, title: "Settled risk", status: "Closed" }), raidItem({ id: 5, title: "Live risk" })],
    }));
    expect(text).not.toContain("Finished work");
    expect(text).not.toContain("Dropped work");
    expect(text).toContain("Live work");
    expect(text).not.toContain("Settled risk");
    expect(text).toContain("Live risk");
  });

  test("lists an overdue task before one due later and marks it overdue", () => {
    const text = buildProjectDigest(base({
      tasks: [
        task({ id: 1, taskName: "Later job", dueDate: "2026-12-01" }),
        task({ id: 2, taskName: "Late job", dueDate: "2026-10-01" }),
      ],
    }));
    expect(text.indexOf("Late job")).toBeLessThan(text.indexOf("Later job"));
    expect(lineWith(text, "Late job")).toContain("overdue");
    expect(lineWith(text, "Later job")).not.toContain("overdue");
  });

  test("a task line carries status, priority, assignee and due date", () => {
    const text = buildProjectDigest(base({
      tasks: [task({ id: 7, taskName: "Wire up", status: "In Progress", priority: "High", assignee: "Liam Foster", dueDate: "2026-11-05" })],
    }));
    const line = lineWith(text, "Wire up");
    for (const part of ["open-points#7:", "In Progress", "High", "Liam Foster", "2026-11-05"]) expect(line).toContain(part);
  });

  test("a RAID line carries category, severity, status and owner", () => {
    const text = buildProjectDigest(base({
      raid: [raidItem({ id: 9, category: "I", title: "Vendor slip", severity: "Critical", status: "In Progress", owner: "Sofia Ramirez" })],
    }));
    const line = lineWith(text, "Vendor slip");
    for (const part of ["raid#9:", "[I, ", "Critical", "In Progress", "Sofia Ramirez"]) expect(line).toContain(part);
  });

  test("a RAID item past its target date is listed first and marked overdue", () => {
    const text = buildProjectDigest(base({
      raid: [
        raidItem({ id: 1, title: "Soon risk", severity: "Critical", targetDate: "2026-11-30" }),
        raidItem({ id: 2, title: "Later risk", severity: "Critical", targetDate: "2027-01-15" }),
        raidItem({ id: 3, title: "Stale risk", severity: "Low", targetDate: "2026-09-01" }),
      ],
    }));
    const order = ["Stale risk", "Soon risk", "Later risk"].map((n) => text.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(lineWith(text, "Stale risk")).toContain("overdue");
    expect(lineWith(text, "Soon risk")).not.toContain("overdue");
  });

  test("a milestone line carries its date and a change line its status", () => {
    const text = buildProjectDigest(base({
      milestones: [milestone({ id: 3, name: "Go-live", date: "2026-12-15" })],
      changes: [change({ id: 4, title: "Add SSO", status: "Under Review" })],
    }));
    expect(lineWith(text, "Go-live")).toContain("2026-12-15");
    expect(lineWith(text, "Add SSO")).toContain("Under Review");
    expect(text).toContain("milestones#3:");
    expect(text).toContain("changes#4:");
  });

  test("an approved change carries its decision date", () => {
    const text = buildProjectDigest(base({
      changes: [change({ id: 5, title: "Extra scope", status: "Approved", decisionDate: "2026-10-10" })],
    }));
    expect(lineWith(text, "Extra scope")).toContain("decided 2026-10-10");
  });

  test("a stakeholder line shows title, then organisation, then category", () => {
    const text = buildProjectDigest(base({
      stakeholders: [
        stakeholder({ id: 1, name: "Sofia Ramirez", title: "CFO", organization: "Acme" }),
        stakeholder({ id: 2, name: "Liam Foster", organization: "Globex" }),
        stakeholder({ id: 3, name: "Mia Chen" }),
      ],
    }));
    expect(text).toContain("stakeholders#1: Sofia Ramirez [CFO]");
    expect(text).toContain("stakeholders#2: Liam Foster [Globex]");
    expect(text).toContain("stakeholders#3: Mia Chen [Sponsor]");
  });

  test("the queue keeps its tier format", () => {
    const text = buildProjectDigest(base({
      queue: [{ title: "Call Sofia", why: "No contact for 30 days", tier: "now" }],
    }));
    expect(text).toContain("[now] Call Sofia");
  });

  test("with a budget one line names the currency and the three figures", () => {
    const text = buildProjectDigest(base({ budget: { currency: "CHF", planned: 1000, actual: 400, forecast: 1200 } }));
    const line = lineWith(text, "CHF");
    for (const n of ["1000", "400", "1200"]) expect(line).toContain(n);
    expect(buildProjectDigest(base())).not.toContain("Budget");
  });

  test("a missing forecast is printed as n/a, not as the plan", () => {
    const text = buildProjectDigest(base({ budget: { currency: "EUR", planned: 1000, actual: 400 } }));
    expect(text).toContain("forecast n/a");
  });

  test("an instruction ends the text in a Job instruction section, verbatim", () => {
    const instruction = "Focus on  the *vendor* risks.\nBe brief.";
    const text = buildProjectDigest(base({ instruction }));
    expect(text.endsWith(`## Job instruction\n${instruction}`)).toBe(true);
    expect(buildProjectDigest(base())).not.toContain("## Job instruction");
  });

  test("each category is capped and says how many were left out", () => {
    const tasks = Array.from({ length: 2000 }, (_, i) => task({ id: i + 1, taskName: `Task ${i}` }));
    const text = buildProjectDigest(base({ tasks }));
    expect(text.split("\n").filter((l) => l.startsWith("- open-points#"))).toHaveLength(CONTEXT_CAP_PER_CATEGORY);
    expect(text).toContain(`- …(${2000 - CONTEXT_CAP_PER_CATEGORY} more)`);
    expect(text).toContain("Open task count: 2000");
  });

  test("a flood of tasks cannot push a RAID item out of the digest", () => {
    const tasks = Array.from({ length: 2000 }, (_, i) => task({ id: i + 1, taskName: `Long task ${i} ${"x".repeat(150)}` }));
    const text = buildProjectDigest(base({ tasks, raid: [raidItem({ id: 77, title: "Single risk" })] }));
    expect(text).toContain("raid#77: Single risk");
  });

  test("an over-wide digest is cut to the cap on a whole-line boundary", () => {
    const wide = (i: number) => "z".repeat(200) + i;
    const input = base({
      tasks: Array.from({ length: 40 }, (_, i) => task({ id: i + 1, taskName: `T${i}`, assignee: wide(i) })),
      raid: Array.from({ length: 40 }, (_, i) => raidItem({ id: i + 1, title: `R${i}`, owner: wide(i) })),
      milestones: Array.from({ length: 40 }, (_, i) => milestone({ id: i + 1, name: wide(i) })),
      changes: Array.from({ length: 40 }, (_, i) => change({ id: i + 1, title: wide(i) })),
      stakeholders: Array.from({ length: 40 }, (_, i) => stakeholder({ id: i + 1, name: wide(i) })),
    });
    const full = buildProjectDigest(input, Number.MAX_SAFE_INTEGER).split("\n");
    expect(full.join("\n").length).toBeGreaterThan(DIGEST_MAX_CHARS);
    const text = buildProjectDigest(input);
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(text.endsWith("…(truncated)")).toBe(true);
    const kept = text.split("\n").slice(0, -1);
    expect(kept.length).toBeGreaterThan(10);
    expect(kept).toEqual(full.slice(0, kept.length));
  });

  test("the instruction survives truncation", () => {
    const tasks = Array.from({ length: 40 }, (_, i) => task({ id: i + 1, assignee: "q".repeat(500) }));
    const raid = Array.from({ length: 40 }, (_, i) => raidItem({ id: i + 1, owner: "q".repeat(500) }));
    const text = buildProjectDigest(base({ tasks, raid, instruction: "Keep me." }));
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(text.endsWith("## Job instruction\nKeep me.")).toBe(true);
    expect(text).toContain("…(truncated)");
  });

  test("an oversized instruction is clipped so the digest never exceeds the cap", () => {
    const text = buildProjectDigest(base({ instruction: "i".repeat(DIGEST_MAX_CHARS * 2) }));
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(text.endsWith("i".repeat(TEXTAREA_MAX))).toBe(true);
    expect(text.endsWith("i".repeat(TEXTAREA_MAX + 1))).toBe(false);
  });
});
