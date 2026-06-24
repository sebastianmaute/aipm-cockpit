import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTimelogRequest, callTimelog, type TimelogCreds } from "./_helpers";

const creds: TimelogCreds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
function req(body: unknown): Request {
  return new Request("http://localhost/api/timelog", { method: "POST", body: JSON.stringify(body) });
}
afterEach(() => vi.restoreAllMocks());

describe("timelog proxy SSRF guard", () => {
  it("rejects a non-timelog.com host", async () => {
    const r = await callTimelog({ ...creds, host: "evil.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a lookalike host (timelog.com.attacker.com)", async () => {
    const r = await callTimelog({ ...creds, host: "app2.timelog.com.attacker.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a private-IP host", async () => {
    const r = await callTimelog({ ...creds, host: "10.0.0.1" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("accepts app1.timelog.com and builds the tenant base path with Bearer auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callTimelog({ ...creds, host: "app1.timelog.com", tenant: "acme" }, "/v1/user", { method: "GET" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app1.timelog.com/acme/api/v1/user",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    );
  });
  it("parseTimelogRequest returns missing-credentials when fields absent", async () => {
    const out = await parseTimelogRequest(req({ path: "/v1/user" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest rejects a path not starting with /v1/", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/evil" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest accepts a valid /v1/ path + creds", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v1/time-tracking-item/get-by-date", query: { startDate: "2026-06-01" } }));
    expect("error" in out).toBe(false);
  });
  it("rejects a host with a port (app2.timelog.com:8080)", async () => {
    const r = await callTimelog({ ...creds, host: "app2.timelog.com:8080" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a host with userinfo (evil.com@app2.timelog.com)", async () => {
    const r = await callTimelog({ ...creds, host: "evil.com@app2.timelog.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("parseTimelogRequest rejects a path with traversal (/v1/../../etc)", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v1/../../etc" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest rejects a path with CRLF injection", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v1/x\r\nX: y" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
});
