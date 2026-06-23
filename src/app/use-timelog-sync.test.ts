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
  listUsers: vi.fn(), getPrivileges: vi.fn(),
  listTimeItemsSelf: vi.fn(), listEmployeeTimeItems: vi.fn(),
}));
import * as api from "./timelog-api";
import { useTimelogSync } from "./use-timelog-sync";
import type { TimelogLinks } from "./timelog-types";

const creds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
const links: TimelogLinks = { userLinks: [{ timelogUserId: 5, resourceId: 2, manual: false }], projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }] };
const item = (userId: number, hours: number) => ({ timeRegistrationId: 1, userId, projectId: 9, projectName: "", projectNo: "", taskId: 0, date: "2026-06-10", hours, billableHours: hours, isBillable: true });
beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });

function args(over: Partial<Parameters<typeof useTimelogSync>[0]> = {}) {
  return { creds, links, scopeMode: "auto" as const, projectId: "p1", isPopout: false, onTokenInvalid: vi.fn(), onTokenValid: vi.fn(), ...over };
}

it("self mode aggregates the token user's items and caches them", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  const { result } = renderHook(() => useTimelogSync(args()));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
  // Distinct project refs collected from the fetched items (item() uses projectId 9)
  expect(result.current.projectRefs).toEqual([{ id: 9, name: "", no: "" }]);
});

it("org mode is fail-soft: one employee error does not abort the others", async () => {
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([{ userId: 5, firstName: "", lastName: "", initials: "", email: "", isActive: true }, { userId: 6, firstName: "", lastName: "", initials: "", email: "", isActive: true }]);
  (api.listEmployeeTimeItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce([item(5, 4)]).mockRejectedValueOnce(new MockTimelogError(500));
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "org" })));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
});

it("calls onTokenInvalid on a 401 and sets error", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockRejectedValue(new MockTimelogError(401));
  const onTokenInvalid = vi.fn();
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self", onTokenInvalid })));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(onTokenInvalid).toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});

it("popout is read-only: sync is a no-op", async () => {
  const { result } = renderHook(() => useTimelogSync(args({ scopeMode: "self", isPopout: true })));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(api.listTimeItemsSelf).not.toHaveBeenCalled();
});
