"use client";

// Stable identities for a bag of handler props, so a `memo()`'d child can bail
// when only the handlers' identities changed (open-followups §1).
//
// Each returned function is created once per key and forwards to the handler
// passed on the LATEST render. That is the property `useCallback` cannot give:
// a memoized handler closes over the values of the render that created it, and
// the deps-object hooks in task-manager deliberately return unmemoized handlers
// that read live render scope. Wrapping them here keeps them live AND stable.
//
// ★ The latest bag is published in `useInsertionEffect`, which runs before any
// layout or passive effect of the same commit — so a child effect that calls a
// handler already reaches this render's handler. Calling one DURING a child's
// render would still reach the previous render's handler; nothing does that.
//
// ★ A handler that is `undefined` stays `undefined`: several panels gate a
// control on a handler's presence (a popout passes none). Adding or removing
// a handler changes the bag's shape, which mints a new set of wrappers.

import { useInsertionEffect, useMemo, useRef } from "react";

type AnyHandler = (...args: never[]) => unknown;

export function useStableHandlers<T extends Record<string, AnyHandler | undefined>>(handlers: T): T {
  const latest = useRef(handlers);
  useInsertionEffect(() => {
    latest.current = handlers;
  });
  const shape = Object.keys(handlers)
    .filter((key) => handlers[key] !== undefined)
    .join("\u0000");
  return useMemo(() => {
    const stable: Record<string, AnyHandler> = {};
    for (const key of shape === "" ? [] : shape.split("\u0000")) {
      stable[key] = (...args: never[]) => latest.current[key]?.(...args);
    }
    return stable as T;
  }, [shape]);
}
