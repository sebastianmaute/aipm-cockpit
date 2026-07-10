import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";

function wsWith(budgetFollowsPlan: boolean) {
  const ws = emptyWorkspace();
  return { ...ws, plan: { ...ws.plan, startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month" as const, currency: "EUR", ...(budgetFollowsPlan ? { budgetFollowsPlan: true } : {}) } };
}

describe("plan codec round-trip: budgetFollowsPlan", () => {
  it("CSV: true survives round-trip and emits a 5th plan cell", () => {
    const csv = workspaceToCsv(wsWith(true));
    expect(csv).toMatch(/2026-01-01,2026-06-30,month,EUR,true/);
    expect(csvToWorkspace(csv).plan.budgetFollowsPlan).toBe(true);
  });
  it("CSV: false/absent emits the legacy 4-cell line (byte-stable)", () => {
    const csv = workspaceToCsv(wsWith(false));
    expect(csv).toMatch(/2026-01-01,2026-06-30,month,EUR(\r?\n|$)/);
    expect("budgetFollowsPlan" in csvToWorkspace(csv).plan).toBe(false);
  });
  it("Markdown: true survives round-trip", () => {
    const md = workspaceToMarkdown(wsWith(true));
    expect(markdownToWorkspace(md).plan.budgetFollowsPlan).toBe(true);
  });
  it("Markdown: false emits legacy 4-cell line", () => {
    const md = workspaceToMarkdown(wsWith(false));
    expect("budgetFollowsPlan" in markdownToWorkspace(md).plan).toBe(false);
  });
});
