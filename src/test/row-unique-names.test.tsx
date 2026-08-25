import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectRowUniqueNames } from "./row-unique-names";

function Rows({ names, role = "button" }: { names: string[]; role?: string }) {
  return (
    <ul data-testid="rows">
      {names.map((n, i) => (
        <li key={i}>
          {role === "button" ? (
            <button type="button" aria-label={n}>
              x
            </button>
          ) : (
            <input type="checkbox" aria-label={n} readOnly checked={false} />
          )}
        </li>
      ))}
    </ul>
  );
}

describe("expectRowUniqueNames", () => {
  it("passes when every control has a distinct name", () => {
    render(<Rows names={["Delete – Alpha", "Delete – Beta"]} />);
    expect(() => expectRowUniqueNames({ minRows: 2 })).not.toThrow();
  });

  it("FAILS when two controls share a name", () => {
    // ★ The mutation proof. Without this the helper could be a no-op and every
    // adopting test would pass vacuously.
    render(<Rows names={["Delete – Alpha", "Delete – Alpha"]} />);
    expect(() => expectRowUniqueNames({ minRows: 2 })).toThrow(/Delete – Alpha/);
  });

  it("THROWS rather than passing when the fixture renders too few controls", () => {
    // ★ This is the whole point. A one-row fixture cannot express a collision,
    // so silently passing would be a vacuous green.
    render(<Rows names={["Delete – Alpha"]} />);
    expect(() => expectRowUniqueNames({ minRows: 2 })).toThrow(/minRows/);
  });

  it("scopes to a container when one is given", () => {
    render(
      <div>
        <button type="button" aria-label="Outside">
          x
        </button>
        <Rows names={["Delete – Alpha", "Delete – Beta"]} />
      </div>,
    );
    const scope = screen.getByTestId("rows");
    expect(() => expectRowUniqueNames({ minRows: 2, scope })).not.toThrow();
  });

  it("checks roles beyond button when asked", () => {
    render(<Rows names={["Pick – Alpha", "Pick – Alpha"]} role="checkbox" />);
    expect(() => expectRowUniqueNames({ minRows: 2, roles: ["checkbox"] })).toThrow(/Pick – Alpha/);
  });

  it("does not see a checkbox collision when only buttons are checked", () => {
    // ★ Anti-vacuity control for the test above: proves `roles` is load-bearing
    // and the previous case did not pass for an unrelated reason.
    render(<Rows names={["Pick – Alpha", "Pick – Alpha"]} role="checkbox" />);
    expect(() => expectRowUniqueNames({ minRows: 2, roles: ["checkbox"] })).toThrow();
    expect(() => expectRowUniqueNames({ minRows: 1, roles: ["button"] })).toThrow(/minRows/);
  });
});
