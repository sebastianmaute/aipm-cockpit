// §502 — the Forecast view is held back for the release (RELEASE_HIDDEN_VIEWS), so every simulation
// surface is off in the real app. A test that needs the simulation ON shows the view for ITS run only:
// "forecast" answers true, every other view still asks the real function. Restore it in afterEach.
import { vi } from "vitest";
import * as featureModules from "../app/feature-modules";

export function showForecastView() {
  const real = featureModules.isViewEnabled;
  return vi
    .spyOn(featureModules, "isViewEnabled")
    .mockImplementation((view, features) => view === "forecast" || real(view, features));
}
