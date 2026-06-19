import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiActionRow } from "./ai-action-row";
import type { AiAction } from "./action-ai";

const grounded: AiAction = { title: "Unblock M2", why: "Tasks block it.", severity: "now", entity: { view: "milestones", id: "2" } };
const ungrounded: AiAction = { title: "Review risks", why: "Stale 30d.", severity: "soon" };

describe("AiActionRow", () => {
  it("renders title + why and fires onAct with an action-unique accessible name (grounded → Open)", async () => {
    const onAct = vi.fn();
    render(<AiActionRow lang="en-US" action={grounded} onAct={onAct} />);
    expect(screen.getByText("Unblock M2")).toBeInTheDocument();
    expect(screen.getByText("Tasks block it.")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Open – Unblock M2/i });
    await userEvent.click(btn);
    expect(onAct).toHaveBeenCalledWith(grounded);
  });

  it("uses the Discuss-in-chat label when the action has no entity", () => {
    render(<AiActionRow lang="en-US" action={ungrounded} onAct={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Discuss in chat – Review risks/i })).toBeInTheDocument();
  });
});
