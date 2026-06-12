// src/app/use-features-sync.test.tsx
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { useWorkspace, WorkspaceProvider } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { useFeaturesSync } from "./use-features-sync";

function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function Harness({ setSettings }: { setSettings: (u: unknown) => void }) {
  useFeaturesSync(setSettings as never);
  const { setFeatures } = useWorkspace();
  return <button onClick={() => setFeatures(["raid"])}>set</button>;
}

describe("useFeaturesSync", () => {
  it("syncs settings.features when workspace features becomes defined", () => {
    const setSettings = vi.fn();
    const { getByText } = render(
      <Providers>
        <Harness setSettings={setSettings} />
      </Providers>,
    );
    // The initial render has features === undefined → the effect early-returns.
    setSettings.mockClear();
    act(() => getByText("set").click());
    expect(setSettings).toHaveBeenCalled();
    // setSettings is called with an updater; apply it to a fake settings to
    // verify it copies the workspace features into settings.features.
    const updater = setSettings.mock.calls.at(-1)![0] as (s: {
      features: string[];
    }) => { features: string[] };
    expect(updater({ features: [] }).features).toEqual(["raid"]);
  });

  it("does NOT sync when workspace features is undefined (initial)", () => {
    const setSettings = vi.fn();
    render(
      <Providers>
        <Harness setSettings={setSettings} />
      </Providers>,
    );
    // features starts undefined → the effect early-returns → no sync call.
    expect(setSettings).not.toHaveBeenCalled();
  });
});
