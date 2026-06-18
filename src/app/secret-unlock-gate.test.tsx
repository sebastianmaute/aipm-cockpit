import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SecretUnlockGate } from "./secret-unlock-gate";

describe("SecretUnlockGate", () => {
  it("calls onUnlock with the typed passphrase and shows error on failure", async () => {
    const onUnlock = vi.fn().mockResolvedValue(false);
    render(<SecretUnlockGate lang="en-US" messageKey="secretUnlockTursoToken" onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("pw"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/wrong passphrase/i);
  });
  it("clears + reports success when onUnlock resolves true", async () => {
    const onUnlock = vi.fn().mockResolvedValue(true);
    render(<SecretUnlockGate lang="en-US" messageKey="secretUnlockTursoToken" onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
