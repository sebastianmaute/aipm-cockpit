import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook } from "@testing-library/react";
import { server } from "../test/msw-server";
import { useOutlookContacts } from "./use-outlook-contacts";

const CONTACTS = "https://graph.microsoft.com/v1.0/me/contacts";

describe("useOutlookContacts", () => {
  it("walks @odata.nextLink and accumulates mapped contacts", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const requests: Request[] = [];
    server.use(
      http.get(CONTACTS, ({ request }) => {
        requests.push(request);
        if (new URL(request.url).searchParams.has("$skip")) {
          return HttpResponse.json({ value: [{ id: "2", displayName: "C D", emailAddresses: [{ address: "c@x.com" }] }] });
        }
        return HttpResponse.json({
          value: [{ id: "1", displayName: "A B", emailAddresses: [{ address: "a@x.com" }] }],
          "@odata.nextLink": `${CONTACTS}?$skip=100`,
        });
      }),
    );

    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    const contacts = await result.current.fetchContacts();

    expect(contacts).toHaveLength(2);
    expect(contacts[0].email).toBe("a@x.com");
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toContain("$select=");
    expect(requests[0].url).toContain("$top=100");
    expect(requests[0].headers.get("Authorization")).toBe("Bearer tok");
  });

  it("throws outlookSignInRequired when token is null", async () => {
    const acquireToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookSignInRequired");
  });

  it("maps HTTP errors to keys", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    for (const [status, key] of [
      [401, "outlookSignInExpired"],
      [403, "outlookPermissionDenied"],
      [500, "outlookFetchFailed"],
    ] as const) {
      server.use(http.get(CONTACTS, () => HttpResponse.json({}, { status })));
      const { result } = renderHook(() => useOutlookContacts(acquireToken));
      await expect(result.current.fetchContacts()).rejects.toThrow(key);
    }
  });

  it("requests the Contacts.Read scope interactively", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    server.use(http.get(CONTACTS, () => HttpResponse.json({ value: [] })));
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await result.current.fetchContacts();
    expect(acquireToken).toHaveBeenCalledWith(["Contacts.Read"], { interactive: true });
  });

  it("maps a network rejection to outlookFetchFailed", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    server.use(http.get(CONTACTS, () => HttpResponse.error()));
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookFetchFailed");
  });

  it("maps a thrown acquireToken (interaction required) to outlookSignInExpired", async () => {
    const acquireToken = vi.fn().mockRejectedValue(new Error("interaction_required"));
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookSignInExpired");
  });

  it("rejects an @odata.nextLink pointing off the Graph origin", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    server.use(http.get(CONTACTS, () => HttpResponse.json({ value: [], "@odata.nextLink": "https://evil.example.com/steal" })));
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookFetchFailed");
  });
});
