// @vitest-environment node
//
// jsdom's Blob/FormData/Request implementations don't interoperate with
// Node's undici multipart parser (a Blob appended with a filename fails
// undici's `webidl.is.File` brand check on decode) — this route has no DOM
// dependency, so run it under the real `node` environment instead.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

function req(fields: Record<string, string>, key = "sk-test", withFile = true): Request {
  const form = new FormData();
  if (withFile) form.append("file", new Blob(["x"], { type: "audio/webm" }), "a.webm");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/stt", {
    method: "POST",
    headers: key ? { "x-stt-key": key } : {},
    body: form,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "hi" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

describe("POST /api/stt", () => {
  it("blocks a private-IP baseUrl (SSRF)", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://192.168.0.1/v1" }));
    expect(res.status).toBe(400);
  });

  it("blocks a non-https baseUrl", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "http://api.openai.com/v1" }));
    expect(res.status).toBe(400);
  });

  it("400 when the key header is missing", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, ""));
    expect(res.status).toBe(400);
  });

  it("forwards to {baseUrl}/audio/transcriptions with Bearer key", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
    expect(res.status).toBe(200);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });
});
