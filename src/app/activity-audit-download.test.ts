import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./download-json", () => ({ downloadJson: vi.fn(() => true) }));
vi.mock("./turso-portfolio", () => ({ readPortfolioActivityLogs: vi.fn() }));

import { downloadJson } from "./download-json";
import { readPortfolioActivityLogs } from "./turso-portfolio";
import { activityAuditDownloader } from "./activity-audit-download";
import { ACTIVITY_AUDIT_CLASSIFICATION, type ActivityAuditSource } from "./activity-audit";

// open-followups §510 — one value decides the announced scope AND what is read.

const cfg = { httpUrl: "https://x.turso.io", authToken: "t" };
const current: ActivityAuditSource = { id: "p1", name: "Apollo", archived: false, log: [] };

beforeEach(() => vi.clearAllMocks());

describe("activityAuditDownloader", () => {
  it("without a portfolio: announces the current project and downloads it alone, never reading Turso", async () => {
    const d = activityAuditDownloader(null, current);
    expect(d.scope).toBe("current");
    expect(await d.download()).toBe(true);
    expect(readPortfolioActivityLogs).not.toHaveBeenCalled();
    const [name, json] = vi.mocked(downloadJson).mock.calls[0];
    expect(name).toMatch(/^aipm-cockpit-INTERNAL-activity-audit-\d{4}-\d{2}-\d{2}\.json$/);
    const body = JSON.parse(json);
    expect(body).toMatchObject({ classification: ACTIVITY_AUDIT_CLASSIFICATION, scope: "current" });
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual(["p1"]);
  });

  it("with a portfolio: announces the portfolio and downloads every project it reads", async () => {
    vi.mocked(readPortfolioActivityLogs).mockResolvedValueOnce([current, { id: "p2", name: "Zeus", archived: true, log: [] }]);
    const d = activityAuditDownloader(cfg, current);
    expect(d.scope).toBe("portfolio");
    await d.download();
    expect(readPortfolioActivityLogs).toHaveBeenCalledWith(cfg);
    const body = JSON.parse(vi.mocked(downloadJson).mock.calls[0][1]);
    expect(body.scope).toBe("portfolio");
    expect(body.projects.map((p: { id: string; archived: boolean }) => [p.id, p.archived])).toEqual([["p1", false], ["p2", true]]);
  });

  it("with a portfolio: the project open now contributes its LIVE log, not its last saved one", async () => {
    const live = [{ id: "e-live", timestamp: "2026-10-04T08:00:00.000Z", kind: "task.created", args: [1, "New"] }] as ActivityAuditSource["log"];
    vi.mocked(readPortfolioActivityLogs).mockResolvedValueOnce([{ ...current, log: [] }, { id: "p2", name: "Zeus", archived: false, log: [] }]);
    await activityAuditDownloader(cfg, { ...current, log: live }).download();
    const body = JSON.parse(vi.mocked(downloadJson).mock.calls[0][1]);
    expect(body.projects.find((p: { id: string }) => p.id === "p1").entries.map((e: { id: string }) => e.id)).toEqual(["e-live"]);
    expect(body.projects.find((p: { id: string }) => p.id === "p2").entries).toEqual([]);
  });

  it("with a portfolio: adds the project open now when it is not in the projects table yet", async () => {
    vi.mocked(readPortfolioActivityLogs).mockResolvedValueOnce([{ id: "p2", name: "Zeus", archived: false, log: [] }]);
    await activityAuditDownloader(cfg, current).download();
    const body = JSON.parse(vi.mocked(downloadJson).mock.calls[0][1]);
    expect(body.projects.map((p: { id: string }) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("with a portfolio but no project open (the \"default\" sentinel): adds no phantom project", async () => {
    vi.mocked(readPortfolioActivityLogs).mockResolvedValueOnce([{ id: "p2", name: "Zeus", archived: false, log: [] }]);
    await activityAuditDownloader(cfg, { ...current, id: "default" }).download();
    const body = JSON.parse(vi.mocked(downloadJson).mock.calls[0][1]);
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual(["p2"]);
  });

  it("with a portfolio: keeps the open project's own unreadable flag when its live log replaces the stored one", async () => {
    vi.mocked(readPortfolioActivityLogs).mockResolvedValueOnce([{ ...current, log: [] }]);
    await activityAuditDownloader(cfg, { ...current, logUnreadable: true }).download();
    const body = JSON.parse(vi.mocked(downloadJson).mock.calls[0][1]);
    expect(body.projects[0]).toMatchObject({ id: "p1", logUnreadable: true });
  });

  it("passes on the browser's refusal", async () => {
    vi.mocked(downloadJson).mockReturnValueOnce(false);
    expect(await activityAuditDownloader(null, current).download()).toBe(false);
  });
});
