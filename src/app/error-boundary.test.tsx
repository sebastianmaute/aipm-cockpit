import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";
import * as recovery from "./recovery-config";

function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(getByText("hello")).toBeTruthy();
  });

  it("renders the fallback with a Recover link when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByText, getByRole } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(getByText(/Something went wrong/i)).toBeTruthy();
    const link = getByRole("link", { name: /Recover/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/recovery");
    spy.mockRestore();
  });

  it("Reset button quarantines config", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const q = vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: true, id: "1" });
    const { getByText } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(getByText(/Reset config & reload/i));
    expect(q).toHaveBeenCalledTimes(1);
    q.mockRestore();
    spy.mockRestore();
  });
});
