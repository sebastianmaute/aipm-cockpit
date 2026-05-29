import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOutlookContacts } from "./use-outlook-contacts";

const G = "https://graph.microsoft.com/v1.0/me/contacts";

describe("useOutlookContacts", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonRes(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it("walks @odata.nextLink and accumulates mapped contacts", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy
      .mockResolvedValueOnce(
        jsonRes({
          value: [{ id: "1", displayName: "A B", emailAddresses: [{ address: "a@x.com" }] }],
          "@odata.nextLink": `${G}?$skip=100`,
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({ value: [{ id: "2", displayName: "C D", emailAddresses: [{ address: "c@x.com" }] }] }),
      );

    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    const contacts = await result.current.fetchContacts();

    expect(contacts).toHaveLength(2);
    expect(contacts[0].email).toBe("a@x.com");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain("$select=");
    expect(fetchSpy.mock.calls[0][0]).toContain("$top=100");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("throws outlookSignInRequired when token is null", async () => {
    const acquireToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookSignInRequired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to keys", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    for (const [status, key] of [
      [401, "outlookSignInExpired"],
      [403, "outlookPermissionDenied"],
      [500, "outlookFetchFailed"],
    ] as const) {
      fetchSpy.mockResolvedValueOnce(jsonRes({}, status));
      const { result } = renderHook(() => useOutlookContacts(acquireToken));
      await expect(result.current.fetchContacts()).rejects.toThrow(key);
    }
  });

  it("requests the Contacts.Read scope", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy.mockResolvedValueOnce(jsonRes({ value: [] }));
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await result.current.fetchContacts();
    expect(acquireToken).toHaveBeenCalledWith(["Contacts.Read"]);
  });

  it("maps a network rejection to outlookFetchFailed", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookFetchFailed");
  });
});
