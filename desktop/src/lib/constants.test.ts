// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APP_HOST, APP_ORIGIN, APP_PORT } from "./constants";

describe("desktop origin", () => {
  // ★★★ These two values are HALF THE BROWSER ORIGIN. IndexedDB is scoped to
  // scheme+host+port, so changing either silently swaps every user's data
  // store — workspace, sealed secrets and file handles all become invisible
  // at once, presenting as "the app wiped my data". This test exists to make
  // that change loud. Do not "update it to match" a new value without
  // deciding, deliberately, to strand every existing install.
  it("pins the port to 17300", () => {
    expect(APP_PORT).toBe(17300);
  });

  it("pins the host to 127.0.0.1, NOT localhost", () => {
    // `localhost` and `127.0.0.1` are DIFFERENT origins. This is not a style
    // preference.
    expect(APP_HOST).toBe("127.0.0.1");
  });

  it("composes an origin from exactly those two values", () => {
    expect(APP_ORIGIN).toBe("http://127.0.0.1:17300");
  });

  it("avoids every port the repo's own tooling owns", () => {
    // 3000 dev server, 3100 isolated axe runs, 3200 e2e:smoke:prod.
    expect([3000, 3100, 3200]).not.toContain(APP_PORT);
  });
});
