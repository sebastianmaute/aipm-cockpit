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
  it("getCtor is exported and returns null when unsupported", () => {
    expect(getCtor()).toBeNull();
  });
});
