// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyPortOwner, probedAppVersion, type PortProbe } from "./port-owner";

const VERSION = "0.301.0";

const OURS_BODY = `<!DOCTYPE html><html lang="en" data-app-version="${VERSION}"><body></body></html>`;

const OURS: PortProbe = { reachable: true, status: 200, body: OURS_BODY };

describe("classifyPortOwner", () => {
  it("reports free when nothing is listening", () => {
    expect(classifyPortOwner({ reachable: false }, VERSION)).toBe("free");
  });

  it("reports ours when the response carries this build's data-app-version", () => {
    expect(classifyPortOwner(OURS, VERSION)).toBe("ours");
  });

  it("accepts whitespace around the equals sign", () => {
    expect(
      classifyPortOwner({ ...OURS, body: `<html data-app-version = "${VERSION}"></html>` }, VERSION),
    ).toBe("ours");
  });

  it("accepts a single-quoted attribute", () => {
    expect(
      classifyPortOwner({ ...OURS, body: `<html data-app-version='${VERSION}'></html>` }, VERSION),
    ).toBe("ours");
  });

  // §631: a leftover server from an earlier build still answers with our
  // attribute. Reusing it would show the user the OLD build after an update,
  // and this launch could not stop it on quit (it never spawned it).
  it("reports stale when an older build answers", () => {
    expect(
      classifyPortOwner({ ...OURS, body: '<html data-app-version="0.1.0"></html>' }, VERSION),
    ).toBe("stale");
  });

  it("reports stale when a newer build answers", () => {
    expect(
      classifyPortOwner({ ...OURS, body: '<html data-app-version="9.0.0"></html>' }, VERSION),
    ).toBe("stale");
  });

  it("reports stale for an empty version value", () => {
    expect(classifyPortOwner({ ...OURS, body: '<html data-app-version=""></html>' }, VERSION)).toBe(
      "stale",
    );
  });

  it("does not treat a version that merely starts with this one as a match", () => {
    expect(
      classifyPortOwner({ ...OURS, body: `<html data-app-version="${VERSION}-rc1"></html>` }, VERSION),
    ).toBe("stale");
  });

  it("reports foreign for an unrelated server on the port", () => {
    expect(
      classifyPortOwner(
        { reachable: true, status: 200, body: "<html><body>Grafana</body></html>" },
        VERSION,
      ),
    ).toBe("foreign");
  });

  it("reports foreign for a reachable non-200 with no marker", () => {
    expect(classifyPortOwner({ reachable: true, status: 403, body: "forbidden" }, VERSION)).toBe(
      "foreign",
    );
  });

  it("does not mistake the attribute NAME appearing in prose for our app", () => {
    // A page that merely mentions the string is not our server.
    expect(
      classifyPortOwner(
        {
          reachable: true,
          status: 200,
          body: "<html><body>docs about data-app-version</body></html>",
        },
        VERSION,
      ),
    ).toBe("foreign");
  });
});

describe("probedAppVersion", () => {
  it("reads the attribute's value", () => {
    expect(probedAppVersion(OURS_BODY)).toBe(VERSION);
  });

  it("reads an empty value as the empty string, not as absent", () => {
    expect(probedAppVersion('<html data-app-version=""></html>')).toBe("");
  });

  it("reads up to the quote that opened the value, not the first quote of either kind", () => {
    expect(probedAppVersion(`<html data-app-version="1.0'rc"></html>`)).toBe("1.0'rc");
  });

  it("returns null when there is no attribute", () => {
    expect(probedAppVersion("<html><body>docs about data-app-version</body></html>")).toBeNull();
  });
});
