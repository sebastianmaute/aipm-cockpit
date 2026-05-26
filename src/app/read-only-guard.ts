// Wraps an action so it becomes a no-op (with a notification) when read-only.
// Used to lock down edit affordances in popout/mirror windows: the affordance
// stays visible but committing is intercepted with a toast. In the editable
// path the wrapper preserves the handler's return value; in the read-only path
// it returns undefined (the action did not run).
export function makeEditGuard(isReadOnly: boolean, notify: () => void) {
  return <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R | undefined => {
      if (isReadOnly) {
        notify();
        return undefined;
      }
      return fn(...args);
    };
}
