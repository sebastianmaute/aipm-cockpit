import { it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());

it("forwards an upstream 200 and builds the GET query string from query", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ Entities: [] }), { status: 200 }));
  const req = new Request("http://localhost/api/timelog", {
    method: "POST",
    body: JSON.stringify({
      host: "app2.timelog.com", tenant: "Acme", token: "tok",
      path: "/v1/time-tracking-item/get-by-date", query: { startDate: "2026-06-01", endDate: "2026-06-30" },
    }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toContain("/v1/time-tracking-item/get-by-date?startDate=2026-06-01&endDate=2026-06-30");
});

it("returns 400 for a bad path (no upstream call)", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  const req = new Request("http://localhost/api/timelog", {
    method: "POST",
    body: JSON.stringify({ host: "app2.timelog.com", tenant: "Acme", token: "tok", path: "/evil" }),
  });
  expect((await POST(req)).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns 400 for missing credentials", async () => {
  const req = new Request("http://localhost/api/timelog", {
    method: "POST", body: JSON.stringify({ path: "/v1/user" }),
  });
  expect((await POST(req)).status).toBe(400);
});
