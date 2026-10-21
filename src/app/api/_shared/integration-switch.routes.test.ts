// §762 — each integration's real route refuses when the deployment switched it off,
// before any upstream call, and only its own switch closes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as jiraTest } from "../jira/test/route";
import { POST as confluencePage } from "../confluence/page/route";
import { POST as timelog } from "../timelog/route";
import { POST as stt } from "../stt/route";
import { GET as ecb } from "../ecb/route";

const jsonPost = (path: string) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

const CALLS: Array<[name: string, call: () => Promise<Response>]> = [
  ["jira", () => jiraTest(jsonPost("/api/jira/test"))],
  ["confluence", () => confluencePage(jsonPost("/api/confluence/page"))],
  ["timelog", () => timelog(jsonPost("/api/timelog"))],
  ["stt", () => stt(new Request("http://localhost/api/stt", { method: "POST" }))],
  ["ecb", () => ecb(new Request("http://localhost/api/ecb"))],
];

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no upstream in this test"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a switched-off integration's route", () => {
  it.each(CALLS)("%s refuses with 503 integration-disabled and calls nothing upstream", async (name, call) => {
    vi.stubEnv("AIPM_DISABLED_INTEGRATIONS", name);
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "integration-disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(CALLS)("%s is not refused when only the others are switched off", async (name, call) => {
    vi.stubEnv("AIPM_DISABLED_INTEGRATIONS", CALLS.map(([n]) => n).filter((n) => n !== name).join(","));
    const res = await call();
    const body: unknown = await res.clone().json().catch(() => null);
    expect(body).not.toEqual({ error: "integration-disabled" });
  });
});
