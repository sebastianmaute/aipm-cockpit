import { describe, expect, it } from "vitest";
import { parseConfluencePageId, confluenceJsonToText, MAX_INGEST_TEXT } from "./project-ingest";

describe("parseConfluencePageId", () => {
  it("extracts the id from the common URL shapes", () => {
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/spaces/ENG/pages/123456789/My+Page")).toBe("123456789");
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/spaces/ENG/pages/42")).toBe("42");
    expect(parseConfluencePageId("https://x.atlassian.net/pages/viewpage.action?pageId=987")).toBe("987");
  });
  it("returns null for tiny-links and garbage", () => {
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/x/AbCdE")).toBeNull();
    expect(parseConfluencePageId("not a url")).toBeNull();
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/spaces/ENG/overview")).toBeNull();
  });
});

describe("confluenceJsonToText", () => {
  it("pulls title + plain text from a Confluence content payload and caps length", () => {
    const payload = { title: "Charter", body: { view: { value: "<p>Hello <b>world</b></p>" } } };
    const out = confluenceJsonToText(payload);
    expect(out).toMatch(/Charter/);
    expect(out).toMatch(/Hello world/);
    expect(out.length).toBeLessThanOrEqual(MAX_INGEST_TEXT + 64);
  });
  it("returns empty string on a malformed payload (never throws)", () => {
    expect(confluenceJsonToText(null)).toBe("");
    expect(confluenceJsonToText({ body: {} })).toBe("");
  });
});
