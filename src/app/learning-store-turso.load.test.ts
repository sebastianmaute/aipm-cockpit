import { describe, it, expect, vi } from "vitest";
import { tursoLearningStore } from "./learning-store-turso";
import { runTursoPipeline } from "./turso-pipeline";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));

// §781 (review M1) — a response without the SELECT result must not read as an
// EMPTY table: the hook would mark the load done, and its next save (a full
// rewrite) would replace every stored row. It throws instead, so the hook treats
// it as a failed load and saves nothing.
describe("tursoLearningStore.load", () => {
  it("throws when the select result is missing", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([{ type: "ok" } as never]); // DDL only
    await expect(tursoLearningStore({ httpUrl: "https://example.test", authToken: "" }).load()).rejects.toThrow();
  });
});
