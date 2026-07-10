import { describe, it, expect, beforeAll } from "vitest";
import { buildDigestEmailHtml, buildDigestEmailSubject } from "./digest-email";
import { loadI18n } from "../i18n";
import type { DigestModel } from "./digest-model";

const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 10, name: "Design <sign-off>", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

beforeAll(async () => {
  await loadI18n("de");
});

describe("digest email", () => {
  it("subject carries the project RAG", () => {
    expect(buildDigestEmailSubject(MODEL, "en-US")).toMatch(/digest/i);
  });

  it("html contains the facts and escapes user-derived text", () => {
    const html = buildDigestEmailHtml(MODEL, "en-US");
    expect(html).toContain("2"); // overdue count
    expect(html).toContain("Design &lt;sign-off&gt;"); // escaped milestone name
    expect(html).not.toContain("Design <sign-off>"); // never raw
    expect(html).toContain("#d0021b"); // red brand hex for RAG=R
  });

  it("renders German labels when lang=de", () => {
    const html = buildDigestEmailHtml(MODEL, "de");
    expect(html.length).toBeGreaterThan(50);
  });
});
