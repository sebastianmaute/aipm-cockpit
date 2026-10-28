// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("../_relay", () => ({
  relay: vi.fn(async () => new Response("relayed", { status: 200 })),
}));

import { relay } from "../_relay";
import * as route from "./route";

describe("GET /api/ai/models", () => {
  it("runs on node", () => {
    expect(route.runtime).toBe("nodejs");
  });

  it("hands the request to the relay as a models call", async () => {
    const req = new Request("http://localhost/api/ai/models");
    const res = await route.GET(req);
    expect(vi.mocked(relay)).toHaveBeenCalledWith(req, "models");
    expect(await res.text()).toBe("relayed");
  });
});
