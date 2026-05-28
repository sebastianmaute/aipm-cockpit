import { describe, expect, it } from "vitest";
import { parseSharePointFileUrl } from "./sharepoint-backend";

describe("parseSharePointFileUrl", () => {
  it("parses a standard SharePoint Sites URL", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/lop/workspace.json",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/lop/workspace.json",
    });
  });

  it("decodes %20 escapes in itemPath", () => {
    const result = parseSharePointFileUrl(
      "https://contoso.sharepoint.com/sites/A/Shared%20Documents/Project%20X/file.json",
    );
    expect(result?.itemPath).toBe("Shared Documents/Project X/file.json");
  });

  it("strips query string", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/file.json?web=1",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/file.json",
    });
  });

  it("strips fragment", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/file.json#frag",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/file.json",
    });
  });

  it("rejects http:// URLs", () => {
    expect(
      parseSharePointFileUrl(
        "http://contoso.sharepoint.com/sites/A/Shared%20Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects non-sharepoint.com hostnames", () => {
    expect(
      parseSharePointFileUrl("https://example.com/sites/A/Documents/file.json"),
    ).toBeNull();
  });

  it("rejects OneDrive for Business URLs (*-my.sharepoint.com)", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso-my.sharepoint.com/personal/user/Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects URLs without /sites/ segment", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/teams/Alpha/Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseSharePointFileUrl("not a url")).toBeNull();
    expect(parseSharePointFileUrl("")).toBeNull();
  });

  it("rejects trailing-slash (folder, not file)", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/A/Shared%20Documents/folder/",
      ),
    ).toBeNull();
  });

  it("rejects URLs with empty itemPath", () => {
    expect(
      parseSharePointFileUrl("https://contoso.sharepoint.com/sites/A"),
    ).toBeNull();
  });
});
