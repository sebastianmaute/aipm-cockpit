// §789: the check built-in speech (dictation and voice commands) runs before it starts listening. It reads only the
// status route's people-lock answer, folds a lock into the page, and fails closed on any answer it cannot trust.
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { isIntegrationDisabled, setDisabledIntegrations } from "./integration-switches";
import { checkSpeechPeopleLock } from "./speech-people-lock";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../test/ai-status-fetch";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => setDisabledIntegrations([]));

describe("checkSpeechPeopleLock", () => {
  it("answers clear when the server does not force people protection", async () => {
    __setAiStatusRequestForTests(() => Promise.resolve(aiStatusResponse(DIRECT_AI_STATUS)));
    await expect(checkSpeechPeopleLock()).resolves.toBe("clear");
    expect(isIntegrationDisabled("ai-people")).toBe(false);
  });

  it("answers locked, and records the lock for the page, when the server forces it", async () => {
    __setAiStatusRequestForTests(() => Promise.resolve(aiStatusResponse({ ...DIRECT_AI_STATUS, peopleForced: true })));
    await expect(checkSpeechPeopleLock()).resolves.toBe("locked");
    expect(isIntegrationDisabled("ai-people")).toBe(true);
  });

  it("reads only the people lock: AI switched off or misconfigured still answers clear", async () => {
    __setAiStatusRequestForTests(() => Promise.resolve(json({ ...DIRECT_AI_STATUS, off: true, invalid: true })));
    await expect(checkSpeechPeopleLock()).resolves.toBe("clear");
  });

  it("answers locked without asking once the page already knows the lock", async () => {
    setDisabledIntegrations(["ai-people"]);
    const request = vi.fn(() => Promise.resolve(aiStatusResponse(DIRECT_AI_STATUS)));
    __setAiStatusRequestForTests(request);
    await expect(checkSpeechPeopleLock()).resolves.toBe("locked");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["the request fails (offline)", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["the server answers an error status", () => Promise.resolve(json({ ...DIRECT_AI_STATUS }, 503))],
    ["the answer is not JSON", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["the answer does not say peopleForced", () => Promise.resolve(json({ off: false }))],
    ["peopleForced is not a boolean", () => Promise.resolve(json({ ...DIRECT_AI_STATUS, peopleForced: "no" }))],
    ["the answer is null", () => Promise.resolve(json(null))],
  ])("fails closed (unconfirmed) when %s", async (_label, request) => {
    __setAiStatusRequestForTests(request);
    await expect(checkSpeechPeopleLock()).resolves.toBe("unconfirmed");
    expect(isIntegrationDisabled("ai-people")).toBe(false);
  });
});
