import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { logDiag, readDiagLog } from "./diagnostics";
import { t } from "./i18n";

beforeEach(() => window.localStorage.clear());

describe("DiagnosticsPanel", () => {
  it("renders recorded events", () => {
    logDiag("warn", "storage.saveFailed", { kind: "turso" });
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByText("storage.saveFailed")).toBeInTheDocument();
  });

  it("Clear empties the ring", () => {
    logDiag("info", "x");
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /clear log/i }));
    expect(readDiagLog()).toEqual([]);
  });

  it("does not crash on a malformed ring", () => {
    window.localStorage.setItem("aipm-cockpit:diag-log", JSON.stringify([1, 2, { at: null }]));
    expect(() => render(<DiagnosticsPanel lang="en-US" />)).not.toThrow();
  });

  it("reports a clipboard copy failure", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) } });
    logDiag("info", "seed");
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostic bundle/i }));
    await vi.waitFor(() => expect(readDiagLog().some((e) => e.code === "diagnostics.copyFailed")).toBe(true));
  });

  it("shows a singular-aware summary line and the newest-error time", () => {
    logDiag("error", "boom.error");
    logDiag("warn", "boom.warn");
    logDiag("info", "boom.info");
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByText(/1 error\b/)).toBeInTheDocument();
    expect(screen.getByText(/1 warning\b/)).toBeInTheDocument();
    expect(screen.getByText(/1 info/)).toBeInTheDocument();
    expect(screen.getByText(/newest error \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("pluralizes the summary counts when more than one event", () => {
    logDiag("error", "boom.error.a");
    logDiag("error", "boom.error.b");
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByText(/2 errors\b/)).toBeInTheDocument();
  });

  it("hides a level's rows when its checkbox is unticked", () => {
    logDiag("error", "keep.error");
    logDiag("info", "hide.info");
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByText("hide.info")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /info/i }));
    expect(screen.queryByText("hide.info")).not.toBeInTheDocument();
    expect(screen.getByText("keep.error")).toBeInTheDocument();
  });

  it("filters rows by a code substring", () => {
    logDiag("info", "storage.saveFailed");
    logDiag("info", "network.timeout");
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.change(screen.getByLabelText(/filter by code/i), { target: { value: "storage" } });
    expect(screen.getByText("storage.saveFailed")).toBeInTheDocument();
    expect(screen.queryByText("network.timeout")).not.toBeInTheDocument();
  });

  it("shows a no-match message when the filter excludes every event", () => {
    logDiag("info", "only.event");
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.change(screen.getByLabelText(/filter by code/i), { target: { value: "nope" } });
    expect(screen.getByText(/no events match the current filter/i)).toBeInTheDocument();
  });

  it("gives the search input and level checkboxes accessible names", () => {
    logDiag("info", "seed.event");
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByLabelText(/filter by code/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /errors/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /warnings/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^info$/i })).toBeInTheDocument();
  });

  it("clears the search box from a labelled button", async () => {
    const user = userEvent.setup();
    logDiag("info", "seed.event");
    render(<DiagnosticsPanel lang="en-US" />);
    const field = screen.getByRole("textbox", {
      name: t("en-US", "diagnosticsSearchCode"),
    }) as HTMLInputElement;
    await user.type(field, "jira");
    expect(field.value).toBe("jira");
    await user.click(
      screen.getByRole("button", {
        name: `${t("en-US", "clear")} – ${t("en-US", "diagnosticsSearchCode")}`,
      }),
    );
    expect(field.value).toBe("");
  });

  it("shows the split-pair count when one is supplied", () => {
    render(<DiagnosticsPanel lang="en-US" splitPairs={3} />);
    expect(screen.getByText(/inconsistent completion data: 3/i)).toBeInTheDocument();
  });

  it("shows a zero count as a positive signal", () => {
    // 0 is meaningful in a SUPPORT panel: it distinguishes "measured, clean"
    // from "not measured", which is what the recovery mount below looks like.
    render(<DiagnosticsPanel lang="en-US" splitPairs={0} />);
    expect(screen.getByText(/inconsistent completion data: 0/i)).toBeInTheDocument();
  });

  it("omits the row entirely when no count is supplied", () => {
    // The recovery mount renders the panel with no workspace behind it.
    render(<DiagnosticsPanel lang="en-US" />);
    // ★ Positive observable FIRST. On its own the absence assertion below also
    //   passes when the panel renders nothing at all — an
    //   everything-is-broken run reads as a passing fence. Anchor it on a
    //   control the panel renders unconditionally, so the absence claim is only
    //   made about a panel that actually rendered.
    // ★★ Refresh, NOT the search box: the filter row is inside the
    //   `events.length === 0` else-branch, and this test seeds no events. The
    //   toolbar buttons are the only controls outside every branch.
    expect(
      screen.getByRole("button", { name: t("en-US", "diagnosticsRefresh") }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/inconsistent completion data/i)).not.toBeInTheDocument();
  });
});
