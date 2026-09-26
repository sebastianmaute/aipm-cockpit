import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DigestCard } from "./digest-card";
import { densityClasses } from "../dashboard-density";
import type { DigestModel } from "../digest/digest-model";

const dc = densityClasses("comfortable");
const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 1, name: "M1", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

describe("DigestCard", () => {
  it("returns null when there is no digest", () => {
    const { container } = render(
      <DigestCard lang="en-US" digest={null} dc={dc} m365Configured={false} busy={false} generating={false} onGenerate={vi.fn()} onCancel={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders facts + a labeled Generate button", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured={false} busy={false} generating={false} onGenerate={vi.fn()} onCancel={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("hides the Email button when M365 is not configured", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured={false} busy={false} generating={false} onGenerate={vi.fn()} onCancel={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /email/i })).toBeNull();
  });

  it("shows the Email button when M365 is configured", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured busy={false} generating={false} onGenerate={vi.fn()} onCancel={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /email/i })).toBeInTheDocument();
  });

  // §125: the narrative is a billed Anthropic call — it must be stoppable.
  it("turns Generate into an enabled Stop while the narrative is in flight, and Stop cancels", () => {
    const onGenerate = vi.fn();
    const onCancel = vi.fn();
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured busy generating onGenerate={onGenerate} onCancel={onCancel} onEmail={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Generate now" })).toBeNull();
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
    // The email send is not abortable here — Email stays disabled while busy.
    expect(screen.getByRole("button", { name: "Email digest" })).toBeDisabled();
  });

  it("keeps Generate (not Stop) disabled during an email send, where nothing is abortable", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured busy generating={false} onGenerate={vi.fn()} onCancel={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getByRole("button", { name: "Generate now" })).toBeDisabled();
  });
});
