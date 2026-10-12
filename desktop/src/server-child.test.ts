import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { killServer, spawnServer } from "./server-child";
import { APP_HOST, APP_PORT } from "./lib/constants";

// §697 item 3. This pins killServer's own decisions with Electron and taskkill
// mocked. It does NOT show that killServer matters on a packaged build: there,
// Windows tears the utility-process child down with the app anyway, which is
// why e2e/desktop-smoke.spec.ts stays green with killServer made a no-op.

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  kill: ReturnType<typeof vi.fn>;
}

const execFileSync = vi.hoisted(() => vi.fn());
const fork = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync, default: { execFileSync } }));
vi.mock("electron", () => ({ utilityProcess: { fork } }));

function fakeChild(pid: number | undefined): FakeChild {
  return Object.assign(new EventEmitter(), { pid, kill: vi.fn() });
}

function spawnFake(pid: number | undefined): FakeChild {
  const child = fakeChild(pid);
  fork.mockReturnValueOnce(child);
  spawnServer("/resources");
  return child;
}

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

describe("killServer (§697)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    onPlatform(realPlatform);
  });

  it("does nothing for a null child", () => {
    killServer(null);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("kills the child's own process tree by PID on Windows, never by image name", () => {
    onPlatform("win32");
    const child = spawnFake(4242);
    killServer(child as never);
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith("taskkill", ["/PID", "4242", "/T", "/F"], { stdio: "ignore" });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("kills the child directly off Windows", () => {
    onPlatform("linux");
    const child = spawnFake(4242);
    killServer(child as never);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("leaves a child alone once its exit has fired", () => {
    onPlatform("win32");
    const child = spawnFake(4242);
    child.emit("exit", 0);
    killServer(child as never);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("defers a child that has no PID yet, and kills it the moment it spawns", () => {
    onPlatform("win32");
    const child = spawnFake(undefined);
    killServer(child as never);
    expect(execFileSync).not.toHaveBeenCalled();
    child.pid = 5151;
    child.emit("spawn");
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith("taskkill", ["/PID", "5151", "/T", "/F"], { stdio: "ignore" });
  });

  it("swallows a failed taskkill (already gone)", () => {
    onPlatform("win32");
    execFileSync.mockImplementationOnce(() => {
      throw new Error("not found");
    });
    const child = spawnFake(4242);
    expect(() => killServer(child as never)).not.toThrow();
  });
});

describe("spawnServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds the server to the loopback host and the fixed port", () => {
    spawnFake(1);
    const [, , options] = fork.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(options.env.HOSTNAME).toBe(APP_HOST);
    expect(options.env.PORT).toBe(String(APP_PORT));
    expect(options.env.NODE_ENV).toBe("production");
  });
});
