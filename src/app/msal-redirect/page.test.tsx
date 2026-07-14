import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const broadcastMock = vi.fn();

vi.mock("@azure/msal-browser/redirect-bridge", () => ({
  broadcastResponseToMainFrame: broadcastMock,
}));

import MsalRedirectPage from "./page";

describe("MsalRedirectPage", () => {
  afterEach(() => {
    broadcastMock.mockReset();
  });

  it("broadcasts the auth response to the opener on mount", async () => {
    broadcastMock.mockResolvedValue(undefined);
    render(<MsalRedirectPage />);
    await waitFor(() => expect(broadcastMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/signing you in/i)).toBeInTheDocument();
  });

  it("shows a closable message when the bridge fails (no hang)", async () => {
    broadcastMock.mockRejectedValue(new Error("no payload"));
    render(<MsalRedirectPage />);
    await waitFor(() =>
      expect(screen.getByText(/could not be completed/i)).toBeInTheDocument(),
    );
  });
});
