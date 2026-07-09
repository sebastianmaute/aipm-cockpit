import { it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// vi.hoisted runs before the vi.mock factory, making MockTimelogError available
// both inside the factory and in test bodies — avoids the hoisting TDZ trap.
const { MockTimelogError } = vi.hoisted(() => {
  class MockTimelogError extends Error {
    status: number;
    constructor(s: number) { super(); this.status = s; }
  }
  return { MockTimelogError };
});

vi.mock("./timelog-api", () => ({
  TimelogError: MockTimelogError,
  listUsers: vi.fn(), getPrivileges: vi.fn(), getMe: vi.fn(), listManagedProjects: vi.fn(),
  listProjectsForCustomer: vi.fn(), listCustomers: vi.fn(),
  listTimeItemsSelf: vi.fn(), listEmployeeTimeItems: vi.fn(),
  listProjectTimeRegistrations: vi.fn(),
}));
import * as api from "./timelog-api";
import { useTimelogSync } from "./use-timelog-sync";
import type { TimelogLinks } from "./timelog-types";

const creds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
// Persisted links are always MANUAL pins in production (auto-matches are never
// written back). autoMatch* keeps manual links regardless of directory/refs, so
// these attribute without needing resources/budgets seeded.
const links: TimelogLinks = { userLinks: [{ timelogUserId: 5, resourceId: 2, manual: true }], projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: true }] };
const item = (userId: number, hours: number) => ({ timeRegistrationId: 1, userId, projectId: 9, projectName: "", projectNo: "", taskId: 0, date: "2026-06-10", hours, billableHours: hours, isBillable: true });
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // Directory fetch now runs in BOTH scopes; default to an empty list so the
  // self-scope tests don't crash on an unmocked listUsers (org tests override).
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

function args(over: Partial<Parameters<typeof useTimelogSync>[0]> = {}) {
  return { creds, links, resources: [], budgets: [], scopeMode: "auto" as const, granularity: "month" as const, projectId: "p1", isPopout: false, onTokenInvalid: vi.fn(), onTokenValid: vi.fn(), ...over };
}

it("self mode aggregates the token user's items and caches them", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  const { result } = renderHook(() => useTimelogSync(args()));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
  // Distinct project refs collected from the fetched items (item() uses projectId 9)
  expect(result.current.projectRefs).toEqual([{ id: 9, name: "", no: "" }]);
});

it("attributes hours via AUTO-matched links (no manual pins persisted)", async () => {
  // The reported bug: person + project shown as "Auto" in the table, but with
  // NO persisted links every booking fell into `unattributed` (booked 0h). The
  // aggregation must resolve the SAME effective links the UI derives.
  const emptyLinks: TimelogLinks = { userLinks: [], projectLinks: [] };
  const resources = [
    { id: 2, firstName: "Carl", lastName: "Ng", email: "c@x.com", roleId: null },
  ] as unknown as Parameters<typeof useTimelogSync>[0]["resources"];
  const budgets = [{ id: 7, name: "Acme" }] as unknown as Parameters<typeof useTimelogSync>[0]["budgets"];
  // self scope skips the auto→privilege probe, so getPrivileges isn't mocked here.
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
    { userId: 5, firstName: "Carl", lastName: "Ng", initials: "CN", email: "c@x.com", isActive: true },
  ]);
  // Booking on project 9 whose NAME "Acme" auto-matches budget bucket 7 by name.
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([
    { ...item(5, 6), projectName: "Acme" },
  ]);
  const { result } = renderHook(() =>
    useTimelogSync(args({ scopeMode: "self", links: emptyLinks, resources, budgets })),
  );
  await act(async () => { await result.current.loadDirectory(); });
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  // Attributed to resource 2 (user 5 auto-matched by email) + bucket 7 (project
  // "Acme" auto-matched by name) — NOT dumped into unattributed.
  expect(result.current.aggregates?.byResource[2].hours).toBe(6);
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(6);
  expect(result.current.aggregates?.unattributed.hours).toBe(0);
});

it("exposes only displayable directory users (drops inactive/nameless rows)", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
    { userId: 1, firstName: "Alice", lastName: "Smith", initials: "AS", email: "a@x.com", isActive: true },
    { userId: 2, firstName: "", lastName: "", initials: "", email: "", isActive: true },   // nameless
    { userId: 3, firstName: "Bob", lastName: "Lee", initials: "BL", email: "b@x.com", isActive: false }, // inactive
  ]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await result.current.loadDirectory(); });
  expect(result.current.users.map((u) => u.userId)).toEqual([1]);
});

it("restores users + projectRefs from the per-project cache on remount", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
    { userId: 5, firstName: "Carl", lastName: "Ng", initials: "CN", email: "c@x.com", isActive: true },
  ]);
  // First mount loads directory + fetches bookings, then caches both.
  const first = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await first.result.current.loadDirectory(); });
  await act(async () => { await first.result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  expect(first.result.current.users.map((u) => u.userId)).toEqual([5]);
  first.unmount();

  // Fresh mount (same projectId) restores from cache WITHOUT a new fetch.
  const second = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  expect(second.result.current.users.map((u) => u.userId)).toEqual([5]);
  expect(second.result.current.projectRefs).toEqual([{ id: 9, name: "", no: "" }]);
});

it("removeUsers drops people and persists the trimmed list to the cache", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
    { userId: 1, firstName: "Ada", lastName: "L", initials: "AL", email: "a@x.com", isActive: true },
    { userId: 2, firstName: "Bob", lastName: "M", initials: "BM", email: "b@x.com", isActive: true },
  ]);
  const first = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await first.result.current.loadDirectory(); });
  await act(async () => { await first.result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  act(() => { first.result.current.removeUsers([1]); });
  expect(first.result.current.users.map((u) => u.userId)).toEqual([2]);
  first.unmount();
  // Trimmed list persisted: a fresh mount restores only user 2.
  const second = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  expect(second.result.current.users.map((u) => u.userId)).toEqual([2]);
  expect(second.result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4); // aggregates kept
});

it("clearAll resets state and clears the cache", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
    { userId: 1, firstName: "Ada", lastName: "L", initials: "AL", email: "a@x.com", isActive: true },
  ]);
  const first = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await first.result.current.loadDirectory(); });
  await act(async () => { await first.result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  act(() => { first.result.current.clearAll(); });
  expect(first.result.current.users).toEqual([]);
  expect(first.result.current.aggregates).toBeUndefined();
  expect(first.result.current.fetchedAt).toBeUndefined();
  first.unmount();
  // Cache wiped: a fresh mount has nothing to restore.
  const second = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  expect(second.result.current.users).toEqual([]);
  expect(second.result.current.aggregates).toBeUndefined();
});

it("org mode is fail-soft: one employee error does not abort the others", async () => {
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([{ userId: 5, firstName: "", lastName: "", initials: "", email: "", isActive: true }, { userId: 6, firstName: "", lastName: "", initials: "", email: "", isActive: true }]);
  (api.listEmployeeTimeItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce([item(5, 4)]).mockRejectedValueOnce(new MockTimelogError(500));
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "org" })));
  // Org bookings scoped to the explicitly-chosen user ids (the ticked people).
  let fetchResult: { failedEmployees: number } | undefined;
  await act(async () => { fetchResult = await result.current.fetchBookings("2026-06-01", "2026-06-30", [5, 6]); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
  // The swallowed per-employee failure is still counted and surfaced to the
  // caller, so a partial fetch doesn't silently look like a complete one.
  expect(fetchResult?.failedEmployees).toBe(1);
});

it("fetchBookings surfaces failedEmployees:0 when every employee succeeds", async () => {
  (api.listEmployeeTimeItems as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "org" })));
  let fetchResult: { failedEmployees: number } | undefined;
  await act(async () => { fetchResult = await result.current.fetchBookings("2026-06-01", "2026-06-30", [5]); });
  expect(fetchResult?.failedEmployees).toBe(0);
});

it("loadCustomers propagates a fetch failure to the caller (no longer swallowed)", async () => {
  (api.listCustomers as ReturnType<typeof vi.fn>).mockRejectedValue(new MockTimelogError(500));
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await expect(result.current.loadCustomers()).rejects.toThrow();
  expect(result.current.customers).toEqual([]);
});

it("fetchBookings excludes non-project (ProjectID 0 absence) rows from projectRefs", async () => {
  const absence = { ...item(5, 8), projectId: 0, projectName: "" }; // absence/internal time
  (api.listEmployeeTimeItems as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4), absence]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "org" })));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30", [5]); });
  // Real project 9 present; the ProjectID-0 absence must NOT add a (blank) ref row.
  expect(result.current.projectRefs.map((r) => r.id)).toEqual([9]);
});

it("org fetchBookings only requests timesheets for the given user ids", async () => {
  (api.listEmployeeTimeItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "org" })));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30", [11, 22]); });
  const calledIds = (api.listEmployeeTimeItems as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
  expect(calledIds).toEqual([11, 22]);
  expect(api.listUsers).not.toHaveBeenCalled(); // directory not re-fetched for bookings
});

it("fetchBookingsForCustomer resolves the customer's projects then fetches each per-project", async () => {
  (api.listProjectsForCustomer as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 9, name: "Acme", no: "" }, { id: 12, name: "Acme 2", no: "" }]);
  (api.listProjectTimeRegistrations as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce([item(5, 4)])
    .mockResolvedValueOnce([{ ...item(5, 3), projectId: 12 }]);
  const { result } = renderHook(() => useTimelogSync(args()));
  let out: { failedProjects: number; customerId: number } | undefined;
  await act(async () => { out = await result.current.fetchBookingsForCustomer(667, "2026-06-01", "2026-06-30"); });
  // includeClosed=true (historical bookings live on closed projects)
  expect(api.listProjectsForCustomer).toHaveBeenCalledWith(creds, 667, expect.anything(), true);
  const calledIds = (api.listProjectTimeRegistrations as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
  expect(calledIds).toEqual([9, 12]);
  // Booking on project 9 attributes to bucket 7 via the persisted manual link.
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
  expect(out).toEqual({ failedProjects: 0, customerId: 667 });
  // No per-user / org path touched.
  expect(api.listEmployeeTimeItems).not.toHaveBeenCalled();
  expect(api.listTimeItemsSelf).not.toHaveBeenCalled();
});

it("fetchBookingsForCustomer is fail-soft: one project error does not abort the rest", async () => {
  (api.listProjectsForCustomer as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 9, name: "A", no: "" }, { id: 12, name: "B", no: "" }]);
  (api.listProjectTimeRegistrations as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce([item(5, 4)])
    .mockRejectedValueOnce(new MockTimelogError(500));
  const { result } = renderHook(() => useTimelogSync(args()));
  let out: { failedProjects: number; customerId: number } | undefined;
  await act(async () => { out = await result.current.fetchBookingsForCustomer(667, "2026-06-01", "2026-06-30"); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
  expect(out?.failedProjects).toBe(1);
});

it("loadManagedProjects sets projectRefs to the token owner's managed projects", async () => {
  (api.getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 2144 });
  (api.listManagedProjects as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 12286, name: "KfW", no: "x" }]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await result.current.loadManagedProjects(); });
  expect(result.current.projectRefs).toEqual([{ id: 12286, name: "KfW", no: "x" }]);
  expect(api.listManagedProjects).toHaveBeenCalledWith(creds, 2144, expect.anything(), false);
});

it("loadManagedProjects(true) requests closed projects too", async () => {
  (api.getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 2144 });
  (api.listManagedProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await result.current.loadManagedProjects(true); });
  expect(api.listManagedProjects).toHaveBeenCalledWith(creds, 2144, expect.anything(), true);
});

it("loadManagedProjects with a customerId loads that customer's projects (not PM-scoped)", async () => {
  (api.listProjectsForCustomer as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 5, name: "Acme P1", no: "" }]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await result.current.loadManagedProjects(false, 667); });
  expect(api.listProjectsForCustomer).toHaveBeenCalledWith(creds, 667, expect.anything(), false);
  expect(api.getMe).not.toHaveBeenCalled();
  expect(api.listManagedProjects).not.toHaveBeenCalled();
  expect(result.current.projectRefs).toEqual([{ id: 5, name: "Acme P1", no: "" }]);
});

it("loadCustomers populates the customer picker", async () => {
  (api.listCustomers as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 667, name: "Acme" }]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self" })));
  await act(async () => { await result.current.loadCustomers(); });
  expect(result.current.customers).toEqual([{ id: 667, name: "Acme" }]);
});

it("a cancelled fetch (AbortError) surfaces no error and clears busy", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException("aborted", "AbortError"));
  const onTokenInvalid = vi.fn();
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self", onTokenInvalid })));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  expect(result.current.error).toBeNull();
  expect(result.current.busy).toBe(false);
  expect(onTokenInvalid).not.toHaveBeenCalled();
});

it("calls onTokenInvalid on a 401 and sets error", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockRejectedValue(new MockTimelogError(401));
  const onTokenInvalid = vi.fn();
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self", onTokenInvalid })));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  expect(onTokenInvalid).toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});

it("popout is read-only: sync is a no-op", async () => {
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self", isPopout: true })));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  expect(api.listTimeItemsSelf).not.toHaveBeenCalled();
});

it("week granularity: aggregates under weekly key (2026-W24), not monthly key (2026-06)", async () => {
  // item date 2026-06-10 is Wednesday of ISO week 2026-W24
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self", granularity: "week" })));
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  const byPeriod = result.current.aggregates?.byBucket[7];
  expect(byPeriod?.["2026-W24"]?.hours).toBe(4);
  expect(byPeriod?.["2026-06"]).toBeUndefined();
});
