// Wraps an action so it becomes a no-op (with a notification) when read-only.
// Used to lock down edit affordances in popout/mirror windows: the affordance
// stays visible but committing is intercepted with a toast.
export function makeEditGuard(isReadOnly: boolean, notify: () => void) {
  return <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (isReadOnly) {
        notify();
        return;
      }
      fn(...args);
    };
}
