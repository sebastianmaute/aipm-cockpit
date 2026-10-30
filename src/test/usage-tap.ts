// src/test/usage-tap.ts
// A stand-in for the transport's usage tap: a test mocks `subscribeAiUsage` with `fakeSubscribeAiUsage`
// and drives the provider with `emitUsage`, as a finished Messages response would.
import type { ApiUsage } from "../app/ai-transport";
import type { Usage } from "../app/ai-usage";

type Listener = (path: string, usage: ApiUsage) => void;
const listeners = new Set<Listener>();

export function fakeSubscribeAiUsage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function tapListenerCount(): number {
  return listeners.size;
}

export function emitUsage(path: string, usage: Usage): void {
  const wire: ApiUsage = {
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_creation_input_tokens: usage.cacheWrite,
    cache_read_input_tokens: usage.cacheRead,
  };
  for (const l of [...listeners]) l(path, wire);
}
