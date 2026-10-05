// Pins the two Outlook import flows `useOutlookImports` owns (§491): the fetch
// with its i18n error-key mapping, the confirm writers, the calendar target
// resolution and its dedupe keys. The Graph fetchers are mocked; everything
// else is the real hook over real React state.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { t, tPlural } from "./i18n";
import type { Absence, Resource } from "./types";
import type { ContactsMap } from "./contacts";
import type { OutlookContact } from "./outlook-contacts";
import type { OutlookEvent } from "./outlook-calendar";
import type { UseMsAuthResult } from "./use-ms-auth";
import { useOutlookImports, type OutlookImportsDeps } from "./use-outlook-imports";

const fetchContacts = vi.fn<() => Promise<OutlookContact[]>>();
const fetchEvents = vi.fn<(range: { startDateTime: string; endDateTime: string }) => Promise<OutlookEvent[]>>();
vi.mock("./use-outlook-contacts", () => ({ useOutlookContacts: () => ({ fetchContacts }) }));
vi.mock("./use-outlook-calendar", () => ({ useOutlookCalendar: () => ({ fetchEvents }) }));

const LANG = "en-US" as const;
const TODAY = "2026-10-05";

function resource(id: number, firstName: string, lastName: string, email?: string): Resource {
  return { id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} };
}

function contact(displayName: string, email: string): OutlookContact {
  const [firstName = "", lastName = ""] = displayName.split(" ");
  return { sourceId: email, firstName, lastName, displayName, email };
}

const EVENT: OutlookEvent = {
  sourceId: "e1", subject: "Leave", startDate: "2026-10-10", endDate: "2026-10-12", isAllDay: true, showAs: "oof",
};

type Account = UseMsAuthResult["account"];
function account(username: string, name?: string): Account {
  return { username, name } as Account;
}

function setup(over: Partial<Omit<OutlookImportsDeps, "setContacts">> = {}) {
  const handleImportResources = vi.fn();
  const handleImportAbsences = vi.fn();
  const showToast = vi.fn();
  const hook = renderHook(() => {
    const [contacts, setContacts] = useState<ContactsMap>({});
    const imports = useOutlookImports({
      lang: LANG,
      today: TODAY,
      msAuth: { account: null, acquireToken: async () => "tok" },
      resources: [],
      absences: [],
      handleImportResources,
      handleImportAbsences,
      showToast,
      ...over,
      setContacts,
    });
    return { contacts, imports };
  });
  return { ...hook, handleImportResources, handleImportAbsences, showToast };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  fetchContacts.mockReset();
  fetchEvents.mockReset();
});

describe("useOutlookImports — contacts", () => {
  it("opens, loads and holds the fetched contacts", async () => {
    const fetched = [contact("Ada Lovelace", "ada@x.io")];
    fetchContacts.mockResolvedValue(fetched);
    const { result } = setup();
    await act(() => result.current.imports.handleOpenOutlookImport());
    expect(result.current.imports).toMatchObject({
      importOpen: true, importLoading: false, importError: null, importContacts: fetched,
    });
  });

  it("translates a known error key and falls back to the generic one", async () => {
    const { result } = setup();
    fetchContacts.mockRejectedValueOnce(new Error("outlookPermissionDenied"));
    await act(() => result.current.imports.handleOpenOutlookImport());
    expect(result.current.imports.importError).toBe(t(LANG, "outlookPermissionDenied"));
    expect(result.current.imports.importLoading).toBe(false);

    fetchContacts.mockRejectedValueOnce(new Error("boom"));
    await act(() => result.current.imports.handleOpenOutlookImport());
    expect(result.current.imports.importError).toBe(t(LANG, "outlookFetchFailed"));
  });

  it("reopening after a failure clears the error and the list, and shows loading while the fetch is pending", async () => {
    const { result } = setup();
    fetchContacts.mockResolvedValueOnce([contact("Ada Lovelace", "ada@x.io")]);
    await act(() => result.current.imports.handleOpenOutlookImport());
    fetchContacts.mockRejectedValueOnce(new Error("outlookPermissionDenied"));
    await act(() => result.current.imports.handleOpenOutlookImport());
    expect(result.current.imports.importError).not.toBeNull();

    const pending = deferred<OutlookContact[]>();
    fetchContacts.mockReturnValueOnce(pending.promise);
    let open!: Promise<void>;
    act(() => { open = result.current.imports.handleOpenOutlookImport(); });
    expect(result.current.imports).toMatchObject({ importError: null, importContacts: [], importLoading: true });
    await act(async () => { pending.resolve([]); await open; });
    expect(result.current.imports.importLoading).toBe(false);
  });

  it("confirm imports the resources, adds them to the address book, closes and toasts", async () => {
    fetchContacts.mockResolvedValue([]);
    const { result, handleImportResources, showToast } = setup();
    await act(() => result.current.imports.handleOpenOutlookImport());
    const selected = [contact("Ada Lovelace", "ada@x.io"), contact("Alan Turing", "alan@x.io")];
    act(() => result.current.imports.handleConfirmOutlookImport(selected));
    expect(handleImportResources).toHaveBeenCalledWith(selected);
    expect(Object.values(result.current.contacts)).toEqual([
      { name: "Ada Lovelace", email: "ada@x.io" },
      { name: "Alan Turing", email: "alan@x.io" },
    ]);
    expect(result.current.imports.importOpen).toBe(false);
    expect(showToast).toHaveBeenCalledWith("info", t(LANG, "outlookImportedN", 2));
  });

  it("existing e-mails are trimmed, lower-cased and drop blanks", () => {
    const { result } = setup({
      resources: [resource(1, "A", "B", "  Ada@X.io "), resource(2, "C", "D", "  "), resource(3, "E", "F")],
    });
    expect([...result.current.imports.existingResourceEmails]).toEqual(["ada@x.io"]);
  });
});

describe("useOutlookImports — calendar", () => {
  it("targets the resource whose e-mail matches the signed-in account", () => {
    const { result } = setup({
      msAuth: { account: account(" Ada@X.io ", "Graph Name"), acquireToken: async () => "tok" },
      resources: [resource(1, "Other", "Person", "o@x.io"), resource(7, "Ada", "Lovelace", " ADA@x.io ")],
    });
    expect(result.current.imports.calendarTarget).toEqual({
      assignee: "Ada Lovelace", assigneeEmail: "Ada@X.io", resourceId: 7,
    });
  });

  it("falls back to the account name, then the e-mail, with no resource link", () => {
    const named = setup({ msAuth: { account: account("ada@x.io", "Graph Name"), acquireToken: async () => "tok" } });
    expect(named.result.current.imports.calendarTarget).toEqual({
      assignee: "Graph Name", assigneeEmail: "ada@x.io", resourceId: undefined,
    });
    const unnamed = setup({ msAuth: { account: account("ada@x.io"), acquireToken: async () => "tok" } });
    expect(unnamed.result.current.imports.calendarTarget.assignee).toBe("ada@x.io");
    const none = setup();
    expect(none.result.current.imports.calendarTarget).toEqual({
      assignee: "", assigneeEmail: undefined, resourceId: undefined,
    });
  });

  it("existing keys cover only the target's own absences", () => {
    const absences: Absence[] = [
      { id: 1, assignee: " graph name ", startDate: "2026-10-01", endDate: "2026-10-02", type: "vacation" },
      { id: 2, assignee: "Someone Else", startDate: "2026-10-03", endDate: "2026-10-04", type: "sick" },
    ];
    const { result } = setup({
      msAuth: { account: account("ada@x.io", "Graph Name"), acquireToken: async () => "tok" },
      absences,
    });
    expect([...result.current.imports.calendarExistingKeys]).toEqual(["graph name|2026-10-01|2026-10-02"]);
  });

  it("fetches 30 days back to 180 days ahead and holds the events", async () => {
    fetchEvents.mockResolvedValue([EVENT]);
    const { result } = setup();
    await act(() => result.current.imports.handleOpenCalendarImport());
    expect(fetchEvents).toHaveBeenCalledWith({
      startDateTime: "2026-09-05T00:00:00Z",
      endDateTime: "2027-04-03T00:00:00Z",
    });
    expect(result.current.imports).toMatchObject({
      calImportOpen: true, calImportLoading: false, calImportError: null, calImportEvents: [EVENT],
    });
  });

  it("translates its own error keys; a contacts-only key falls back", async () => {
    const { result } = setup();
    fetchEvents.mockRejectedValueOnce(new Error("outlookCalendarPermissionDenied"));
    await act(() => result.current.imports.handleOpenCalendarImport());
    expect(result.current.imports.calImportError).toBe(t(LANG, "outlookCalendarPermissionDenied"));
    expect(result.current.imports.calImportLoading).toBe(false);

    fetchEvents.mockRejectedValueOnce(new Error("outlookPermissionDenied"));
    await act(() => result.current.imports.handleOpenCalendarImport());
    expect(result.current.imports.calImportError).toBe(t(LANG, "outlookCalendarFetchFailed"));
  });

  it("reopening after a failure clears the error and the events, and shows loading while the fetch is pending", async () => {
    const { result } = setup();
    fetchEvents.mockResolvedValueOnce([EVENT]);
    await act(() => result.current.imports.handleOpenCalendarImport());
    fetchEvents.mockRejectedValueOnce(new Error("outlookCalendarPermissionDenied"));
    await act(() => result.current.imports.handleOpenCalendarImport());
    expect(result.current.imports.calImportError).not.toBeNull();

    const pending = deferred<OutlookEvent[]>();
    fetchEvents.mockReturnValueOnce(pending.promise);
    let open!: Promise<void>;
    act(() => { open = result.current.imports.handleOpenCalendarImport(); });
    expect(result.current.imports).toMatchObject({ calImportError: null, calImportEvents: [], calImportLoading: true });
    await act(async () => { pending.resolve([]); await open; });
    expect(result.current.imports.calImportLoading).toBe(false);
  });

  it("confirm imports the rows for the target, closes and toasts", async () => {
    fetchEvents.mockResolvedValue([]);
    const { result, handleImportAbsences, showToast } = setup({
      msAuth: { account: account("ada@x.io", "Graph Name"), acquireToken: async () => "tok" },
    });
    await act(() => result.current.imports.handleOpenCalendarImport());
    const rows = [{ event: EVENT, type: "vacation" as const }];
    act(() => result.current.imports.handleConfirmCalendarImport(rows));
    expect(handleImportAbsences).toHaveBeenCalledWith(rows, result.current.imports.calendarTarget);
    expect(result.current.imports.calImportOpen).toBe(false);
    expect(showToast).toHaveBeenCalledWith("info", tPlural(LANG, "outlookCalImportedN", 1, 1));
  });
});
