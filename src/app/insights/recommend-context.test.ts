import { describe, it, expect } from "vitest";
import { buildRecommendContext, buildRecommendSystemPrompt } from "./recommend-context";

const BASE = {
  projectName: "Apollo",
  today: "2026-07-20",
  insightType: "milestoneSlip",
  severity: "high",
  data: { name: "Go-live", date: "2026-06-01", daysOverdue: 49 },
  relatedTasks: [],
} as const;

describe("buildRecommendContext — linked entity", () => {
  it("renders the entity header + field block when an entity IS supplied", () => {
    // Arrange
    const entity = {
      view: "milestones",
      id: 42,
      title: "Go-live",
      fields: "achieved: no\nlinkedTasks: 3",
    };

    // Act
    const out = buildRecommendContext({ ...BASE, entity });

    // Assert
    expect(out).toContain("Linked milestones#42: Go-live");
    expect(out).toContain("achieved: no");
    expect(out).toContain("linkedTasks: 3");
    expect(out).not.toContain("(no linked entity)");
  });

  it("renders a raid entity under its own view/id", () => {
    const out = buildRecommendContext({
      ...BASE,
      insightType: "raidAging",
      severity: "medium",
      entity: {
        view: "raid",
        id: 7,
        title: "Vendor contract unsigned",
        fields: "category: R\nstatus: Open\nseverity: High\nowner: Dana Ruiz",
      },
    });

    expect(out).toContain("Linked raid#7: Vendor contract unsigned");
    expect(out).toContain("owner: Dana Ruiz");
  });

  it("falls back to the no-entity marker when omitted", () => {
    const out = buildRecommendContext(BASE);

    expect(out).toContain("## Linked entity\n(no linked entity)");
    // No `Linked <view>#<id>:` header — the section heading itself legitimately
    // contains the word "Linked", so match the header's real shape.
    expect(out).not.toMatch(/Linked \w[\w-]*#\d+:/);
  });

  it("keeps the entity block under its own section heading", () => {
    const out = buildRecommendContext({
      ...BASE,
      entity: { view: "milestones", id: 1, title: "M1", fields: "achieved: no" },
    });
    const heading = out.indexOf("## Linked entity");
    const linked = out.indexOf("Linked milestones#1");
    const tasksHeading = out.indexOf("## Related open tasks");

    expect(heading).toBeGreaterThan(-1);
    expect(linked).toBeGreaterThan(heading);
    expect(linked).toBeLessThan(tasksHeading);
  });
});

describe("buildRecommendContext — insight data", () => {
  it("renders each data entry as a bullet", () => {
    const out = buildRecommendContext(BASE);

    expect(out).toContain("- name: Go-live");
    expect(out).toContain("- daysOverdue: 49");
  });

  it("marks empty data as none", () => {
    const out = buildRecommendContext({ ...BASE, data: {} });

    expect(out).toContain("## Insight data\n(none)");
  });
});

describe("buildRecommendContext — related tasks", () => {
  it("caps the related-task list at 30", () => {
    const relatedTasks = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, title: `T${i + 1}` }));

    const out = buildRecommendContext({ ...BASE, relatedTasks });

    expect(out).toContain("- open-points#30: T30");
    expect(out).not.toContain("open-points#31");
  });

  it("truncates a very long task title", () => {
    const out = buildRecommendContext({
      ...BASE,
      relatedTasks: [{ id: 1, title: "x".repeat(200) }],
    });

    expect(out).toContain(`- open-points#1: ${"x".repeat(120)}\n`.trimEnd());
    expect(out).not.toContain("x".repeat(121));
  });
});

// §782 — create_task requires an assignee, and the digest named no person, so
// the model had no name it could give.
describe("buildRecommendContext — people", () => {
  it("lists the people a create may assign, under its own heading after the tasks", () => {
    const out = buildRecommendContext({ ...BASE, people: ["Dana Ortiz", "Lee Park"] });

    expect(out).toContain("## People (assign by name)\n- Dana Ortiz\n- Lee Park");
    expect(out.indexOf("## People")).toBeGreaterThan(out.indexOf("## Related open tasks"));
  });

  it("caps the list at 30 and marks an empty one as none", () => {
    const people = Array.from({ length: 40 }, (_, i) => `Person ${i + 1}`);

    const out = buildRecommendContext({ ...BASE, people });

    expect(out).toContain("- Person 30");
    expect(out).not.toContain("- Person 31");
    expect(buildRecommendContext(BASE)).toContain("## People (assign by name)\n(none)");
  });
});

describe("buildRecommendSystemPrompt", () => {
  it("tells the model to give every required argument and to assign only listed people", () => {
    const p = buildRecommendSystemPrompt();

    expect(p).toContain("every required argument");
    expect(p).toContain("listed under People");
  });

  it("is a stable single-line cacheable prefix", () => {
    const a = buildRecommendSystemPrompt();
    const b = buildRecommendSystemPrompt();

    expect(a).toBe(b);
    expect(a).not.toContain("\n");
    expect(a).toContain("propose_insight_actions");
  });
});
