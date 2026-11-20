// Since §798 the AI transport reads every answer's body itself (`res.text()`, inside the time limit)
// and hands the caller a fresh Response over that text. A test fetch stub that answers a plain
// `{ ok, status, json }` stand-in cannot be read that way; wrap the stub with `answersRealResponses`
// and each stand-in is turned into a real Response carrying the same status and JSON body. The
// wrapped mock still records the calls, so assertions on it are unchanged.
import { vi } from "vitest";

type StandIn = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
  json?: () => unknown;
  text?: () => unknown;
};

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

async function bodyOf(standIn: StandIn): Promise<string> {
  try {
    // `json` first: a stand-in that offers both usually stubs `text` as a blank afterthought.
    if (standIn.json) return JSON.stringify(await standIn.json());
    if (standIn.text) return String(await standIn.text());
  } catch {
    // A stand-in whose body cannot be read answers an unreadable body.
  }
  return "";
}

/** A real Response for a stand-in; anything else (a Response, undefined) is returned as it is. */
export async function toRealResponse(answer: unknown): Promise<unknown> {
  if (answer instanceof Response || typeof answer !== "object" || answer === null) return answer;
  const standIn = answer as StandIn;
  const status = standIn.status ?? (standIn.ok === false ? 500 : 200);
  const body = NULL_BODY_STATUSES.has(status) ? null : await bodyOf(standIn);
  return new Response(body, { status, statusText: standIn.statusText, headers: standIn.headers });
}

/** A fetch that calls `mock` and answers its stand-ins as real Responses. */
export function answersRealResponses(mock: (...args: never[]) => unknown): typeof fetch {
  return (async (...args: never[]) => toRealResponse(await mock(...args))) as unknown as typeof fetch;
}

/** `vi.stubGlobal("fetch", answersRealResponses(mock))`. */
export function stubAiFetch(mock: (...args: never[]) => unknown): void {
  vi.stubGlobal("fetch", answersRealResponses(mock));
}

/** In place of `vi.spyOn(globalThis, "fetch")`: the returned mock is configured and asserted on as
 *  the spy was (`.mockResolvedValue(standIn)`, `.mock.calls`), and `globalThis.fetch` answers its
 *  stand-ins as real Responses. `mockRestore()` on it, or `vi.restoreAllMocks()`, puts fetch back. */
export function spyAiFetch() {
  const answers = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(answersRealResponses(answers));
  const restoreAnswers = answers.mockRestore.bind(answers);
  answers.mockRestore = () => {
    spy.mockRestore();
    restoreAnswers();
  };
  return answers;
}
