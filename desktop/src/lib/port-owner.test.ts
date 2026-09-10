// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyPortOwner, type PortProbe } from "./port-owner";

const OURS: PortProbe = {
  reachable: true,
  status: 200,
  body: '<!DOCTYPE html><html lang="en" data-app-version="0.301.0"><body></body></html>',
};

describe("classifyPortOwner", () => {
  it("reports free when nothing is listening", () => {
    expect(classifyPortOwner({ reachable: false })).toBe("free");
  });

  it("reports ours when the response carries data-app-version", () => {
    expect(classifyPortOwner(OURS)).toBe("ours");
  });

  it("reports ours regardless of which version answered", () => {
    // An older build of the same app still owns this origin's data.
    expect(
      classifyPortOwner({ ...OURS, body: '<html data-app-version="0.1.0"></html>' }),
    ).toBe("ours");
  });

  it("reports foreign for an unrelated server on the port", () => {
    expect(
      classifyPortOwner({ reachable: true, status: 200, body: "<html><body>Grafana</body></html>" }),
    ).toBe("foreign");
  });

  it("reports foreign for a reachable non-200 with no marker", () => {
    expect(classifyPortOwner({ reachable: true, status: 403, body: "forbidden" })).toBe("foreign");
  });

  it("does not mistake the attribute NAME appearing in prose for our app", () => {
    // A page that merely mentions the string is not our server.
    expect(
      classifyPortOwner({
        reachable: true,
        status: 200,
        body: "<html><body>docs about data-app-version</body></html>",
      }),
    ).toBe("foreign");
  });
});
