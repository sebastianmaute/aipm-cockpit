import { describe, it, expect } from "vitest";
import { renderTemplate, withDefault, CATEGORY_FIELDS, buildStatusInquiryVars, buildStakeholderUpdateVars, type CommTemplate } from "./comm-templates";

describe("renderTemplate", () => {
  it("replaces known tokens and html-escapes values", () => {
    const out = renderTemplate("Hi {{assignee}} re {{taskName}}", "status-inquiry", { assignee: "A & B", taskName: "<x>" });
    expect(out).toBe("Hi A &amp; B re &lt;x&gt;");
  });
  it("leaves unknown tokens literal", () => {
    expect(renderTemplate("{{nope}}", "status-inquiry", {})).toBe("{{nope}}");
  });
  it("empty for a known token with no value", () => {
    expect(renderTemplate("[{{dueDate}}]", "status-inquiry", {})).toBe("[]");
  });
});

describe("withDefault", () => {
  const list: CommTemplate[] = [
    { id: "a", category: "status-inquiry", name: "A", body: "", isDefault: true, createdAt: "", updatedAt: "" },
    { id: "b", category: "status-inquiry", name: "B", body: "", isDefault: false, createdAt: "", updatedAt: "" },
    { id: "c", category: "stakeholder-update", name: "C", body: "", isDefault: true, createdAt: "", updatedAt: "" },
  ];
  it("moves the default within a category, leaving others untouched", () => {
    const next = withDefault(list, "b");
    expect(next.find((t) => t.id === "a")!.isDefault).toBe(false);
    expect(next.find((t) => t.id === "b")!.isDefault).toBe(true);
    expect(next.find((t) => t.id === "c")!.isDefault).toBe(true);
  });
});

describe("var builders", () => {
  it("builds status-inquiry vars", () => {
    const v = buildStatusInquiryVars({ id: 7, taskName: "Ship", dueDate: "2026-07-01", lastUpdateDate: "2026-06-01", assignee: "Mara Vega" } as never);
    expect(v.taskId).toBe("7");
    expect(v.taskName).toBe("Ship");
    expect(v.dueDate).toBe("2026-07-01");
    expect(v.assignee).toBeTruthy();
  });
  it("builds stakeholder-update vars", () => {
    expect(buildStakeholderUpdateVars({ name: "Acme" } as never, "Proj X")).toEqual({ stakeholderName: "Acme", projectName: "Proj X" });
  });
  it("registry covers both categories", () => {
    expect(CATEGORY_FIELDS["status-inquiry"]).toContain("taskName");
    expect(CATEGORY_FIELDS["stakeholder-update"]).toContain("stakeholderName");
  });
});
