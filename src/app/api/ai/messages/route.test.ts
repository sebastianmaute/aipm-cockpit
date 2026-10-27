// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("../_relay", () => ({
  relay: vi.fn(async () => new Response("relayed", { status: 200 })),
}));

import { relay } from "../_relay";
import * as route from "./route";

describe("POST /api/ai/messages", () => {
  it("runs on node", () => {
    expect(route.runtime).toBe("nodejs");
  });

  it("hands the request to the relay as a messages call", async () => {
    const req = new Request("http://localhost/api/ai/messages", { method: "POST", body: "{}" });
    const res = await route.POST(req);
    expect(vi.mocked(relay)).toHaveBeenCalledWith(req, "messages");
    expect(await res.text()).toBe("relayed");
  });
});
