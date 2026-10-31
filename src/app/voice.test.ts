import { describe, it, expect, afterEach, vi } from "vitest";
import { startRecognition, getCtor } from "./voice";

class FakeRecog {
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  lang = "";
  onresult: unknown = null;
  onend: unknown = null;
  onerror: unknown = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}
function installCtor(capture?: (r: FakeRecog) => void) {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    class extends FakeRecog {
      constructor() {
        super();
        capture?.(this);
      }
    };
}
afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
});

describe("startRecognition continuous flag", () => {
  it("defaults continuous to false (command mode unchanged)", () => {
    let created: FakeRecog | undefined;
    installCtor((r) => (created = r));
    startRecognition({ lang: "en-US", onFinal: () => {} });
    expect(created!.continuous).toBe(false);
  });
  it("sets continuous true when requested (dictation mode)", () => {
    let created: FakeRecog | undefined;
    installCtor((r) => (created = r));
    startRecognition({ lang: "en-US", onFinal: () => {}, continuous: true });
    expect(created!.continuous).toBe(true);
  });
  it("the returned stop still calls recog.stop (normal end, final result kept)", () => {
    let created: FakeRecog | undefined;
    installCtor((r) => (created = r));
    const stop = startRecognition({ lang: "en-US", onFinal: () => {} });
    stop!();
    expect(created!.stop).toHaveBeenCalledTimes(1);
    expect(created!.abort).not.toHaveBeenCalled();
  });
  it("abort calls recog.abort and drops any result that still arrives (AI people protection)", () => {
    let created: FakeRecog | undefined;
    installCtor((r) => (created = r));
    const onFinal = vi.fn();
    const stop = startRecognition({ lang: "en-US", onFinal });
    const onresult = () => created!.onresult as ((e: unknown) => void) | null;
    const result = { resultIndex: 0, results: [Object.assign([{ transcript: "delete task 3", confidence: 1 }], { isFinal: true })] };
    // Anti-vacuity: before the abort, the same result reaches onFinal.
    onresult()?.(result);
    expect(onFinal).toHaveBeenCalledTimes(1);
    stop!.abort();
    expect(created!.abort).toHaveBeenCalledTimes(1);
    expect(created!.stop).not.toHaveBeenCalled();
    onresult()?.(result);
    expect(onFinal).toHaveBeenCalledTimes(1);
  });
  it("getCtor is exported and returns null when unsupported", () => {
    expect(getCtor()).toBeNull();
  });
});
