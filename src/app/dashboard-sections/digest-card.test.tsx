import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
      <DigestCard lang="en-US" digest={null} dc={dc} m365Configured={false} busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders facts + a labeled Generate button", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured={false} busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("hides the Email button when M365 is not configured", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured={false} busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /email/i })).toBeNull();
  });

  it("shows the Email button when M365 is configured", () => {
    render(
      <DigestCard lang="en-US" digest={MODEL} dc={dc} m365Configured busy={false} onGenerate={vi.fn()} onEmail={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /email/i })).toBeInTheDocument();
  });
});
