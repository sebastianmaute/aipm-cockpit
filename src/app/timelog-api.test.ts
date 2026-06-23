import { describe, it, expect, vi, afterEach } from "vitest";
import { unwrapTaf, listUsers, listTimeItemsSelf, listEmployeeTimeItems,
  getPrivileges, getFinancialDataSelf, type TimelogCreds } from "./timelog-api";

const creds: TimelogCreds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
afterEach(() => vi.restoreAllMocks());

describe("unwrapTaf", () => {
  it("unwraps a TAF list to an array of Properties", () => {
    const out = unwrapTaf({ Entities: [{ Properties: { UserID: 1 } }, { Properties: { UserID: 2 } }],
      Properties: { TotalRecord: 2 } });
    expect(out).toEqual([{ UserID: 1 }, { UserID: 2 }]);
  });
  it("unwraps a TAF single to a one-element array", () => {
    expect(unwrapTaf({ Properties: { UserID: 9 } })).toEqual([{ UserID: 9 }]);
  });
  it("returns [] for an empty/odd payload", () => {
    expect(unwrapTaf(null)).toEqual([]);
  });
  it("drops non-object entities from a list", () => {
    expect(unwrapTaf({ Entities: [null, { Properties: { X: 1 } }] })).toEqual([{ X: 1 }]);
  });
});

describe("listUsers", () => {
  it("POSTs to /api/timelog with the user path and maps fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: { UserID: 5, FirstName: "Ada", LastName: "L", Initials: "AL", Email: "a@b.c", IsActive: true } }],
    }), { status: 200 }));
    const users = await listUsers(creds);
    expect(users).toEqual([{ userId: 5, firstName: "Ada", lastName: "L", initials: "AL", email: "a@b.c", isActive: true }]);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ host: "app2.timelog.com", tenant: "Acme", token: "tok", path: "/v1/user" });
  });
  it("throws TimelogError carrying only the status on a non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(listUsers(creds)).rejects.toMatchObject({ status: 401 });
  });
});

describe("listTimeItemsSelf", () => {
  it("maps a time-tracking item and trims the date to YYYY-MM-DD", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: { TimeRegistrationID: 1, UserID: 5, ProjectID: 9, ProjectName: "P", ProjectNo: "P1",
        TaskID: 3, Date: "2026-06-10T00:00:00", Hours: 4, BillableHours: 4, IsBillable: true } }],
    }), { status: 200 }));
    const items = await listTimeItemsSelf(creds, "2026-06-01", "2026-06-30");
    expect(items[0]).toEqual({ timeRegistrationId: 1, userId: 5, projectId: 9, projectName: "P", projectNo: "P1",
      taskId: 3, date: "2026-06-10", hours: 4, billableHours: 4, isBillable: true });
  });
});

describe("getPrivileges", () => {
  it("reads RegistrationAllTasks from Properties.Privileges", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: { Privileges: { RegistrationAllTasks: true } } }],
    }), { status: 200 }));
    expect(await getPrivileges(creds)).toEqual({ registrationAllTasks: true });
  });
  it("defaults registrationAllTasks to false when Privileges is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: {} }],
    }), { status: 200 }));
    expect(await getPrivileges(creds)).toEqual({ registrationAllTasks: false });
  });
});

describe("listEmployeeTimeItems", () => {
  it("POSTs the approval endpoint with employeeUserId as a string query param", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [],
    }), { status: 200 }));
    await listEmployeeTimeItems(creds, 42, "2026-06-01", "2026-06-30");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.path).toBe("/v1/approval/timesheets/get-status-by-period-with-rejected-time-tracking-items");
    expect(body.query.employeeUserId).toBe("42");
  });
});

describe("getFinancialDataSelf", () => {
  it("maps a financial-day single and trims the date", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Properties: { UserID: 5, Date: "2026-06-10T00:00:00", TotalActualHour: 8, TotalBillableHour: 6,
        TotalBillableAmount: 900, BillableCurrencyABB: "EUR" },
    }), { status: 200 }));
    const days = await getFinancialDataSelf(creds, "2026-06-01", "2026-06-30");
    expect(days[0]).toEqual({ userId: 5, date: "2026-06-10", totalActualHour: 8, totalBillableHour: 6,
      totalBillableAmount: 900, billableCurrency: "EUR" });
  });
});
