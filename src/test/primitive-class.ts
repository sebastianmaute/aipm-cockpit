// The exact `className` a design-system primitive renders for given props, read
// off a throwaway render of the primitive itself. A migrated call site pins its
// element with `toBe(primitiveClassFor(<Primitive … />))`, which also pins the
// size and the caller's own extra classes, and cannot go stale when the
// primitive's classes change. `buttonClassFor` (`button-variant.ts`) is the
// `Button`-specific form of the same idea.
import type { ReactElement } from "react";
import { render } from "@testing-library/react";

/** `selector` picks the element inside the render whose class is wanted; it
 *  defaults to the render's first element. */
export function primitiveClassFor(element: ReactElement, selector?: string): string {
  const { container, unmount } = render(element);
  const el = selector ? container.querySelector(selector) : container.firstElementChild;
  if (!el) throw new Error(`primitiveClassFor: nothing rendered${selector ? ` for "${selector}"` : ""}`);
  const cls = el.getAttribute("class") ?? "";
  unmount();
  return cls;
}
