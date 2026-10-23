import { describe, expect, test } from "vitest";
import { buildProjectDigest, DIGEST_MAX_CHARS, type ProjectDigestInput } from "./project-digest";
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
    const lateLine = text.split("\n").find((l) => l.includes("Late job"))!;
    expect(lateLine).toContain("overdue");
    expect(text.split("\n").find((l) => l.includes("Later job"))!).not.toContain("overdue");
  });

  test("a task line carries status, priority, assignee and due date", () => {
    const text = buildProjectDigest(base({
      tasks: [task({ id: 7, taskName: "Wire up", status: "In Progress", priority: "High", assignee: "Liam Foster", dueDate: "2026-11-05" })],
    }));
    const line = text.split("\n").find((l) => l.includes("Wire up"))!;
    for (const part of ["open-points#7:", "In Progress", "High", "Liam Foster", "2026-11-05"]) expect(line).toContain(part);
  });

  test("a RAID line carries category, severity, status and owner", () => {
    const text = buildProjectDigest(base({
      raid: [raidItem({ id: 9, category: "I", title: "Vendor slip", severity: "Critical", status: "In Progress", owner: "Sofia Ramirez" })],
    }));
    const line = text.split("\n").find((l) => l.includes("Vendor slip"))!;
    for (const part of ["raid#9:", "I", "Critical", "In Progress", "Sofia Ramirez"]) expect(line).toContain(part);
  });

  test("a milestone line carries its date and a change line its status", () => {
    const text = buildProjectDigest(base({
      milestones: [milestone({ id: 3, name: "Go-live", date: "2026-12-15" })],
      changes: [change({ id: 4, title: "Add SSO", status: "Under Review" })],
    }));
    expect(text.split("\n").find((l) => l.includes("Go-live"))!).toContain("2026-12-15");
    expect(text.split("\n").find((l) => l.includes("Add SSO"))!).toContain("Under Review");
    expect(text).toContain("milestones#3:");
    expect(text).toContain("changes#4:");
  });

  test("stakeholders and the queue keep their grounding format", () => {
    const text = buildProjectDigest(base({
      stakeholders: [stakeholder({ id: 2, name: "Sofia Ramirez" })],
      queue: [{ title: "Call Sofia", why: "No contact for 30 days", tier: "now" }],
    }));
    expect(text).toContain("stakeholders#2: Sofia Ramirez");
    expect(text).toContain("[now] Call Sofia");
  });

  test("with a budget one line names the currency and the three figures", () => {
    const text = buildProjectDigest(base({ budget: { currency: "CHF", planned: 1000, actual: 400, forecast: 1200 } }));
    const line = text.split("\n").find((l) => l.includes("CHF"))!;
    for (const n of ["1000", "400", "1200"]) expect(line).toContain(n);
    expect(buildProjectDigest(base())).not.toContain("Budget");
  });

  test("an instruction ends the text in a Job instruction section, verbatim", () => {
    const instruction = "Focus on  the *vendor* risks.\nBe brief.";
    const text = buildProjectDigest(base({ instruction }));
    expect(text.endsWith(`## Job instruction\n${instruction}`)).toBe(true);
    expect(buildProjectDigest(base())).not.toContain("## Job instruction");
  });

  test("a 2000-task project is cut to the cap on a whole-line boundary", () => {
    const tasks = Array.from({ length: 2000 }, (_, i) =>
      task({ id: i + 1, taskName: `Long task ${i} ${"x".repeat(150)}`, dueDate: "2026-11-01" }));
    const full = buildProjectDigest(base({ tasks }), Number.MAX_SAFE_INTEGER).split("\n");
    const text = buildProjectDigest(base({ tasks }));
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(text.endsWith("…(truncated)")).toBe(true);
    const kept = text.split("\n").slice(0, -1);
    expect(kept.length).toBeGreaterThan(10);
    expect(kept).toEqual(full.slice(0, kept.length));
  });

  test("the instruction survives truncation", () => {
    const tasks = Array.from({ length: 2000 }, (_, i) => task({ id: i + 1, taskName: `Task ${i} ${"y".repeat(150)}` }));
    const text = buildProjectDigest(base({ tasks, instruction: "Keep me." }));
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(text.endsWith("## Job instruction\nKeep me.")).toBe(true);
    expect(text).toContain("…(truncated)");
  });
});
