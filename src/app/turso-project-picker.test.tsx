import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TursoProjectPicker } from "./turso-project-picker";
import { defaultSettings } from "./settings-types";

vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn(),
}));
vi.mock("./portfolio-mode", () => ({
  commitTursoPortfolioSwitch: vi.fn(),
}));

import { listProjects } from "./turso-portfolio";
import { commitTursoPortfolioSwitch } from "./portfolio-mode";

const TURSO_SETTINGS = {
  ...defaultSettings,
  integrations: {
    ...defaultSettings.integrations,
    turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
  },
};

function setup() {
  const onClose = vi.fn();
  render(<TursoProjectPicker lang="en-US" settings={TURSO_SETTINGS} onClose={onClose} />);
  return { onClose };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("TursoProjectPicker", () => {
  it("shows each active project as a row and switches on click", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never,
      { id: "p2", meta: { name: "Gemini", code: "GEM-2" }, archived: false } as never,
    ]);
    setup();
    expect(await screen.findByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load – apollo/i }));
    expect(commitTursoPortfolioSwitch).toHaveBeenCalledWith(TURSO_SETTINGS, "p1");
  });

  it("shows an empty state when the database has no projects", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    setup();
    expect(
      await screen.findByText("No projects found in this Turso database."),
    ).toBeInTheDocument();
  });

  it("shows an error with Retry, and Retry re-fetches", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("network down"));
    setup();
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();

    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Apollo")).toBeInTheDocument();
  });

  it("calls onClose when the modal's close button is clicked", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    const { onClose } = setup();
    await screen.findByText("No projects found in this Turso database.");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
