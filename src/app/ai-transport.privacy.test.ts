import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiDeploymentError, postAiMessages, subscribeAiUsage } from "./ai-transport";
import { setAiDeploymentState } from "./ai-deployment";
import { AiPeopleProtectedContentError, aiPrivacyFor, aiPrivacyForNewProject, type AiPrivacy } from "./ai-privacy";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { isPeopleProtectionForced, withPeopleAllowed } from "./ai-people-protection";
import { setDisabledIntegrations } from "./integration-switches";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Resource, Stakeholder } from "./types";

const KEY = "sk-ant-api03-test";

const wsA: Workspace = {
  ...emptyWorkspace(),
  resources: [{ id: 1, firstName: "Rosalind", lastName: "Quenby", email: "r.quenby@example.test", businessPhone: "+49 30 5550111" } as Resource],
};
const wsB: Workspace = {
  ...emptyWorkspace(),
  stakeholders: [{ id: 1, name: "Stellan Hargreave", email: "s.hargreave@example.test" } as Stakeholder],
};
const wsAllowed: Workspace = { ...wsB, settingsOverrides: withPeopleAllowed(undefined, true) };

let seq = 0;
const privacyOf = (...ws: Workspace[]): AiPrivacy => aiPrivacyFor(ws.map((w) => ({ key: `p3-${++seq}`, ws: w })));

function stub(reply: (body: string) => Response) {
  const mock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === "/api/ai/status") return aiStatusResponse(DIRECT_AI_STATUS);
    return reply(String(init?.body));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const messageCalls = (m: ReturnType<typeof stub>) => m.mock.calls.filter((c) => c[0] !== "/api/ai/status");

beforeEach(() => {
  __setAiStatusRequestForTests(null);
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAiDeploymentState(DIRECT_AI_STATUS);
});

const bodyOf = (text: string) => JSON.stringify({ messages: [{ role: "user", content: text }] });

describe("protected send", () => {
  it("sends no name, email or phone and restores the reply; usage tap fires once", async () => {
    const privacy = privacyOf(wsA);
    if (!privacy.protected) throw new Error("expected protected");
    const placeholder = privacy.session.redact("Rosalind Quenby");
    const fetchMock = stub(
      () =>
        new Response(
          JSON.stringify({ content: [{ type: "text", text: `Ask ${placeholder} now` }], usage: { input_tokens: 3, output_tokens: 4 } }),
          { status: 200 },
        ),
    );
    const heard = vi.fn();
    const off = subscribeAiUsage(heard);
    const res = await postAiMessages({
      apiKey: KEY,
      path: "chat",
      privacy,
      body: bodyOf("Rosalind Quenby, r.quenby@example.test, +49 30 5550111"),
    });
    const sent = String(messageCalls(fetchMock)[0][1]?.body);
    expect(sent).not.toMatch(/Rosalind|Quenby|r\.quenby|5550111/);
    const json = (await res.json()) as { content: { text: string }[] };
    expect(json.content[0].text).toBe("Ask Rosalind Quenby now");
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    off();
  });

  it("refuses an image block before any fetch", async () => {
    const privacy = privacyOf(wsA);
    const fetchMock = stub(() => new Response("{}"));
    const body = JSON.stringify({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "AAAA" } }] }] });
    await expect(postAiMessages({ apiKey: KEY, path: "chat", privacy, body })).rejects.toBeInstanceOf(AiPeopleProtectedContentError);
    expect(messageCalls(fetchMock)).toHaveLength(0);
  });

  it("refuses a non-text document but lets a text document through", async () => {
    const privacy = privacyOf(wsA);
    const fetchMock = stub(() => new Response("{}"));
    const pdf = JSON.stringify({ messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", data: "AAAA" } }] }] });
    await expect(postAiMessages({ apiKey: KEY, path: "chat", privacy, body: pdf })).rejects.toBeInstanceOf(AiPeopleProtectedContentError);
    const txt = JSON.stringify({
      messages: [{ role: "user", content: [{ type: "document", source: { type: "text", media_type: "text/plain", data: "Rosalind Quenby" } }] }],
    });
    await postAiMessages({ apiKey: KEY, path: "chat", privacy, body: txt });
    expect(String(messageCalls(fetchMock)[0][1]?.body)).not.toMatch(/Rosalind/);
  });

  it("passes an error response through unrestored", async () => {
    const privacy = privacyOf(wsA);
    stub(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "[Person 1]" } }), { status: 529 }));
    const res = await postAiMessages({ apiKey: KEY, path: "chat", privacy, body: bodyOf("hi") });
    expect(res.status).toBe(529);
    expect(await res.text()).toContain("[Person 1]");
  });

  it("logs ai.peopleRedacted with numeric counts only", async () => {
    const privacy = privacyOf(wsA);
    stub(() => new Response("{}", { status: 200 }));
    await postAiMessages({ apiKey: KEY, path: "chat", privacy, body: bodyOf("Rosalind Quenby r.quenby@example.test") });
    const log = JSON.parse(window.localStorage.getItem("aipm-cockpit:diag-log") ?? "[]") as {
      code: string;
      fields: Record<string, unknown>;
    }[];
    const entry = log.find((e) => e.code === "ai.peopleRedacted");
    expect(entry).toBeDefined();
    const values = Object.values(entry!.fields);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === "number")).toBe(true);
    expect(entry!.fields.person).toBe(1);
    expect(entry!.fields.email).toBe(1);
  });
});

// Review 5, S5: a placeholder the session cannot map (invented by the model, or a near-miss form it never issued)
// stays in the text as written; the reply logs ONE warning with its count, and no text.
describe("unrestored placeholders in a reply (review 5, S5)", () => {
  const diagOf = (code: string) =>
    (JSON.parse(window.localStorage.getItem("aipm-cockpit:diag-log") ?? "[]") as { code: string; level: string; fields: Record<string, unknown> }[])
      .filter((e) => e.code === code);
  const replyWith = (text: string) => () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });

  it("counts invented and near-miss placeholders once per reply and leaves the text unchanged", async () => {
    const privacy = privacyOf(wsA);
    if (!privacy.protected) throw new Error("expected protected");
    expect(privacy.session.redact("Rosalind Quenby")).toBe("[Person 1]");
    stub(replyWith("[Person 1] asked [Person 12], [Person1], [person 12] and [ Email 2 ]."));
    const res = await postAiMessages({ apiKey: KEY, path: "chat", privacy, body: bodyOf("hi") });
    const json = (await res.json()) as { content: { text: string }[] };
    expect(json.content[0].text).toBe("Rosalind Quenby asked [Person 12], [Person1], [person 12] and [ Email 2 ].");
    const warn = diagOf("ai.placeholderUnrestored");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.level).toBe("warn");
    expect(warn[0]!.fields).toEqual({ count: 4 });
  });

  it("logs nothing when every placeholder is restored", async () => {
    const privacy = privacyOf(wsA);
    if (!privacy.protected) throw new Error("expected protected");
    privacy.session.redact("Rosalind Quenby");
    stub(replyWith("Ask [Person 1] and [person 1]."));
    await postAiMessages({ apiKey: KEY, path: "chat", privacy, body: bodyOf("hi") });
    expect(diagOf("ai.placeholderUnrestored")).toEqual([]);
  });
});

describe("unprotected send", () => {
  it("passes the body through byte-identical and the reply untouched", async () => {
    const fetchMock = stub(() => new Response('{"x":"[Person 1]"}', { status: 200 }));
    const body = bodyOf("Rosalind Quenby");
    const res = await postAiMessages({ apiKey: KEY, path: "chat", privacy: { protected: false }, body });
    expect(messageCalls(fetchMock)[0][1]?.body).toBe(body);
    expect(await res.text()).toBe('{"x":"[Person 1]"}');
  });
});

describe("aiPrivacyFor", () => {
  it("is unprotected when every project allows people", () => {
    expect(aiPrivacyFor([{ key: "k-allow", ws: wsAllowed }]).protected).toBe(false);
  });
  it("one protected + one allowed project: protected, names of BOTH redacted", () => {
    const p = aiPrivacyFor([
      { key: "mix-a", ws: wsA },
      { key: "mix-b", ws: wsAllowed },
    ]);
    expect(p.protected).toBe(true);
    if (!p.protected) return;
    const out = p.session.redact("Rosalind Quenby and Stellan Hargreave");
    expect(out).not.toMatch(/Rosalind|Quenby|Stellan|Hargreave/);
  });
});

// Review 4, M3: the deployment lock was read once per page load. The per-send status now says whether the server
// forces people protection; a lock added after the page loaded protects the very next send, whatever the project
// allows, and is folded into the page's forced state.
describe("a people lock the server added after page load (review 4, M3)", () => {
  const FORCED = { ...DIRECT_AI_STATUS, peopleForced: true };
  function stubForced(reply: (body: string) => Response) {
    const mock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
      if (input === "/api/ai/status") return aiStatusResponse(FORCED);
      return reply(String(init?.body));
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  afterEach(() => setDisabledIntegrations([]));

  it("a project that allows people: the next send is redacted and the reply restored", async () => {
    const privacy = privacyOf(wsAllowed);
    expect(privacy.protected).toBe(false);
    expect(isPeopleProtectionForced()).toBe(false);
    let sentBody = "";
    const fetchMock = stubForced((body) => {
      sentBody = body;
      const placeholder = /\[Person \d+\]/.exec(body)?.[0] ?? "none";
      return new Response(JSON.stringify({ content: [{ type: "text", text: `Ask ${placeholder}` }] }), { status: 200 });
    });
    const res = await postAiMessages({ apiKey: KEY, path: "chat", privacy, body: bodyOf("Stellan Hargreave, s.hargreave@example.test") });
    expect(messageCalls(fetchMock)).toHaveLength(1);
    expect(sentBody).not.toMatch(/Stellan|Hargreave|s\.hargreave/);
    expect(await res.text()).toContain("Ask Stellan Hargreave");
    expect(isPeopleProtectionForced()).toBe(true);
  });

  it("the server not forcing: an allowing project sends as before (control)", async () => {
    let sentBody = "";
    stub((body) => {
      sentBody = body;
      return new Response("{}", { status: 200 });
    });
    await postAiMessages({ apiKey: KEY, path: "chat", privacy: privacyOf(wsAllowed), body: bodyOf("Stellan Hargreave") });
    expect(sentBody).toContain("Stellan Hargreave");
    expect(isPeopleProtectionForced()).toBe(false);
  });

  it("an unprotected privacy that cannot be protected is refused before sending (fail closed)", async () => {
    const fetchMock = stubForced(() => new Response("{}", { status: 200 }));
    const err = await postAiMessages({ apiKey: KEY, path: "chat", privacy: { protected: false }, body: bodyOf("x") }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect(messageCalls(fetchMock)).toEqual([]);
  });

  it("the unforced create-project wizard now refuses an image", async () => {
    const privacy = aiPrivacyForNewProject();
    expect(privacy.protected && privacy.refuseUnredactable).toBe(false);
    const fetchMock = stubForced(() => new Response("{}", { status: 200 }));
    const body = JSON.stringify({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] });
    await expect(postAiMessages({ apiKey: KEY, path: "wizard", privacy, body })).rejects.toBeInstanceOf(AiPeopleProtectedContentError);
    expect(messageCalls(fetchMock)).toEqual([]);
  });
});
