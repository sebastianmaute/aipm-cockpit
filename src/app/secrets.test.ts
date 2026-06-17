import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { sealDevice, openDevice } from "./secrets";

describe("secrets device wrap", () => {
  it("round-trips a secret through the device key", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-ant-secret-123");
    expect(sealed.wrap).toBe("device");
    expect(sealed.ciphertext).not.toContain("sk-ant"); // ciphertext, not plaintext
    expect(await openDevice(sealed)).toBe("sk-ant-secret-123");
  });
});
