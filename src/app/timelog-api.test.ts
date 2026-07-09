import { describe, it, expect, vi, afterEach } from "vitest";
import { unwrapTaf, listUsers, listTimeItemsSelf, listEmployeeTimeItems,
  getPrivileges, getMe, listManagedProjects, listProjectsForCustomer, listCustomers,
  listProjectTimeRegistrations, getFinancialDataSelf, type TimelogCreds } from "./timelog-api";

const creds: TimelogCreds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

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

describe("getMe", () => {
  it("returns the token owner's UserID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Properties: { UserID: 2144, FirstName: "Seb", LastName: "M", Email: "s@x.com" },
    }), { status: 200 }));
    expect(await getMe(creds)).toEqual({ userId: 2144 });
  });
});

describe("listManagedProjects", () => {
  it("keeps only projects the given user manages and maps id/name/no", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [
        { Properties: { ProjectID: 10, Name: "Mine", No: "P-10", ProjectManagerID: 2144 } },
        { Properties: { ProjectID: 11, Name: "Theirs", No: "P-11", ProjectManagerID: 99 } },
      ],
    }), { status: 200 }));
    const out = await listManagedProjects(creds, 2144);
    expect(out).toEqual([{ id: 10, name: "Mine", no: "P-10" }]);
  });

  it("returns [] without any request when the manager id is non-positive", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await listManagedProjects(creds, 0)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includeClosed also pulls isActive=false and merges both sets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      const active = body.query.isActive === "true";
      const proj = active
        ? { ProjectID: 10, Name: "Active", No: "A", ProjectManagerID: 2144 }
        : { ProjectID: 20, Name: "Closed", No: "C", ProjectManagerID: 2144 };
      return new Response(JSON.stringify({ Properties: { TotalPage: 1 }, Entities: [{ Properties: proj }] }), { status: 200 });
    });
    const out = await listManagedProjects(creds, 2144, undefined, true);
    expect(out.map((p) => p.id).sort((a, b) => a - b)).toEqual([10, 20]);
  });
});

describe("listCustomers", () => {
  it("maps customer id + name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [
        { Properties: { CustomerID: 667, Name: "Acme", No: "00" } },
        { Properties: { CustomerID: 0, Name: "" } },
      ],
    }), { status: 200 }));
    expect(await listCustomers(creds)).toEqual([{ id: 667, name: "Acme" }]);
  });
});

describe("listProjectsForCustomer", () => {
  it("filters by customerID server-side and returns all (no PM filter)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [
        { Properties: { ProjectID: 10, Name: "A", No: "P-10", ProjectManagerID: 1 } },
        { Properties: { ProjectID: 11, Name: "B", No: "P-11", ProjectManagerID: 2 } },
      ],
    }), { status: 200 }));
    const out = await listProjectsForCustomer(creds, 667);
    expect(out).toEqual([{ id: 10, name: "A", no: "P-10" }, { id: 11, name: "B", no: "P-11" }]);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).query).toMatchObject({ customerID: "667", isActive: "true" });
  });
  it("returns [] without a request for a non-positive customerId", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await listProjectsForCustomer(creds, 0)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("listProjectTimeRegistrations", () => {
  it("POSTs the v2 per-project path and maps items", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: { TimeRegistrationID: 1, UserID: 5, ProjectID: 9, ProjectName: "P", ProjectNo: "P1",
        TaskID: 3, Date: "2026-06-10T00:00:00", Hours: 4, BillableHours: 4, IsBillable: true } }],
    }), { status: 200 }));
    const items = await listProjectTimeRegistrations(creds, 9, "2026-06-01", "2026-06-30");
    expect(items[0]).toMatchObject({ timeRegistrationId: 1, userId: 5, projectId: 9, hours: 4 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.path).toBe("/v2/projects/9/time-registrations");
    expect(body.query).toMatchObject({ startDate: "2026-06-01", endDate: "2026-06-30" });
  });
  it("returns [] without a request for a non-positive or non-integer projectId", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await listProjectTimeRegistrations(creds, 0, "a", "b")).toEqual([]);
    expect(await listProjectTimeRegistrations(creds, -1, "a", "b")).toEqual([]);
    expect(await listProjectTimeRegistrations(creds, 1.5, "a", "b")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("paging ($page / $pagesize)", () => {
  const page = (reg: number, totalPage: number) =>
    new Response(JSON.stringify({
      Properties: { TotalPage: totalPage, PageNumber: 1 },
      Entities: [{ Properties: { TimeRegistrationID: reg, UserID: 5, ProjectID: 9, ProjectName: "P",
        ProjectNo: "", TaskID: 0, Date: "2026-06-10T00:00:00", Hours: 4, BillableHours: 4, IsBillable: true } }],
    }), { status: 200 });

  it("follows $page through TotalPage and concatenates every page's rows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(page(1, 2))
      .mockResolvedValueOnce(page(2, 2));
    const items = await listTimeItemsSelf(creds, "2026-06-01", "2026-06-30");
    expect(items.map((i) => i.timeRegistrationId)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const q1 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).query;
    const q2 = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).query;
    expect(q1).toMatchObject({ $page: "1", $pagesize: "500" });
    expect(q2).toMatchObject({ $page: "2", $pagesize: "500" });
  });

  it("stops after one request when TotalPage is 1", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ Properties: { TotalPage: 1 }, Entities: [] }), { status: 200 }),
    );
    await listTimeItemsSelf(creds, "2026-06-01", "2026-06-30");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("429 backoff", () => {
  it("retries a 429 (honouring Retry-After) then resolves", async () => {
    vi.useFakeTimers();
    const ok = new Response(JSON.stringify({
      Entities: [{ Properties: { UserID: 7, FirstName: "A", LastName: "B", Initials: "", Email: "", IsActive: true } }],
    }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(ok);
    const p = listUsers(creds);
    await vi.advanceTimersByTimeAsync(1000);
    const users = await p;
    expect(users[0].userId).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with TimelogError(429) after the retry budget on a persistent 429", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 429, headers: { "Retry-After": "1" } }),
    );
    const assertion = expect(listUsers(creds)).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(5); // initial + 4 retries
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
