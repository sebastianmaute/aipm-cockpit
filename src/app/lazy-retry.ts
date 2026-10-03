/** Memoise an async loader, but forget a REJECTED result so the next call retries.
 *  A success stays cached; callers during one in-flight load share it. Used for
 *  dynamic `import()` — a transient chunk-download failure must not stay cached. */
export function lazyRetryOnReject<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const attempt = load().catch((err: unknown) => {
      if (pending === attempt) pending = null;
      throw err;
    });
    pending = attempt;
    return attempt;
  };
}
