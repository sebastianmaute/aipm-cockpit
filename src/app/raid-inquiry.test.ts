// src/app/raid-inquiry.test.ts
import { describe, expect, it } from "vitest";
import { resolveRaidOwnerEmail, buildRaidInquiryMailto } from "./raid-inquiry";
import type { RaidItem, Resource } from "./types";

function makeItem(overrides?: Partial<RaidItem>): RaidItem {
  return {
    id: 5,
    category: "R",
    title: "Server capacity risk",
    severity: "High",
    status: "Open",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    documentLinks: [],
    raisedDate: "2026-06-01",
    targetDate: "2026-07-01",
    owner: "Alice Owner",
    ownerEmail: "alice@example.com",
    ...overrides,
  };
}

const resource = (id: number, email?: string): Resource =>
  ({ id, firstName: "Live", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {}, email }) as Resource;

describe("resolveRaidOwnerEmail", () => {
  it("returns the cached ownerEmail when no linked resource", () => {
    expect(resolveRaidOwnerEmail(makeItem(), new Map())).toBe("alice@example.com");
  });

  it("prefers the linked resource's LIVE email over a stale cached ownerEmail", () => {
    const item = makeItem({ ownerEmail: "stale@old.com", ownerResourceId: 7 });
    const byId = new Map([[7, resource(7, "current@corp.com")]]);
    expect(resolveRaidOwnerEmail(item, byId)).toBe("current@corp.com");
  });

  it("returns empty string when nothing is on file", () => {
    expect(resolveRaidOwnerEmail(makeItem({ ownerEmail: undefined }), new Map())).toBe("");
  });
});

describe("buildRaidInquiryMailto", () => {
  it("builds a mailto with the recipient, RAID id and title", () => {
    const url = buildRaidInquiryMailto(makeItem(), "alice@example.com", "en-US");
    expect(url.startsWith("mailto:alice%40example.com")).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("#5");
    expect(decoded).toContain("Server capacity risk");
    expect(decoded).toContain("2026-07-01"); // target date
  });

  it("falls back to an em dash when target/raised dates are absent", () => {
    const url = buildRaidInquiryMailto(makeItem({ targetDate: undefined, raisedDate: undefined }), "a@b.com", "en-US");
    expect(decodeURIComponent(url)).toContain("—");
  });
});
