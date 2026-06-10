import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./project-switcher";
import { type ProjectRegistryEntry } from "./projects-registry";
import { t } from "./i18n";

const projects: ProjectRegistryEntry[] = [
  {
    id: "p1",
    name: "Apollo",
    code: "APL",
    storageConfig: { kind: "browser" },
  },
  {
    id: "p2",
    name: "Gemini",
    code: "GMN",
    storageConfig: { kind: "browser" },
  },
];

function renderSwitcher(overrides: Partial<React.ComponentProps<typeof ProjectSwitcher>> = {}) {
  const onSwitch = vi.fn();
  const onLoadFromFile = vi.fn();
  const onNew = vi.fn();
  render(
    <ProjectSwitcher
      currentProjectName="Apollo"
      projects={projects}
      currentProjectId="p1"
      lang="en-US"
      onSwitch={onSwitch}
      onLoadFromFile={onLoadFromFile}
      onNew={onNew}
      {...overrides}
    />,
  );
  return { onSwitch, onLoadFromFile, onNew };
}

describe("ProjectSwitcher", () => {
  it("renders the current project name on the trigger", () => {
    renderSwitcher();
    expect(
      screen.getByRole("button", { name: /Apollo/ }),
    ).toBeInTheDocument();
  });

  it("shows the fallback label when the current name is null", () => {
    renderSwitcher({ currentProjectName: null, currentProjectId: null });
    const label = t("en-US", "projectCurrentLabel");
    // The trigger's accessible name includes the fallback label.
    expect(
      screen.getByRole("button", { name: new RegExp(label) }),
    ).toBeInTheDocument();
  });

  it("opens the dropdown listing the projects when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Gemini/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Apollo/ })).toBeInTheDocument();
  });

  it("calls onSwitch and closes when a non-current project is clicked", async () => {
    const user = userEvent.setup();
    const { onSwitch } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    await user.click(screen.getByRole("menuitem", { name: /Gemini/ }));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith("p2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("marks the current project entry as disabled and does not call onSwitch", async () => {
    const user = userEvent.setup();
    const { onSwitch } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    const currentItem = screen.getByRole("menuitem", { name: /Apollo/ });
    expect(currentItem).toBeDisabled();
    expect(currentItem).toHaveAttribute("aria-current", "true");

    await user.click(currentItem);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("calls onLoadFromFile and closes when 'Load from file' is clicked", async () => {
    const user = userEvent.setup();
    const { onLoadFromFile } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    await user.click(
      screen.getByRole("menuitem", {
        name: t("en-US", "projectSwitcherLoadFile"),
      }),
    );

    expect(onLoadFromFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("calls onNew and closes when '+ New project' is clicked", async () => {
    const user = userEvent.setup();
    const { onNew } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    await user.click(
      screen.getByRole("menuitem", {
        name: new RegExp(t("en-US", "projectsNew")),
      }),
    );

    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
