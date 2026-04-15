import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookRegistry } from "../../server/utils/plugin/hook-registry";

// Minimal mock of PluginManager.emitUserHook logic (isolated from bridge/watcher/etc.)
// We test the dispatch logic directly since constructing a full PluginManager requires DB/Worker.

describe("emitUserHook dispatch logic", () => {
  let hookRegistry: HookRegistry;
  let callPluginHook: ReturnType<typeof vi.fn>;
  let logPush: ReturnType<typeof vi.fn>;

  async function emitUserHook(hookName: string, payload: Record<string, unknown>): Promise<void> {
    const handlers = hookRegistry.get(hookName);
    if (!handlers.length) return;

    const results = await Promise.allSettled(
      handlers.map((handler) => callPluginHook(handler.pluginId, hookName, payload)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        logPush({
          timestamp: new Date().toISOString(),
          level: "error",
          type: "event",
          pluginId: handlers[i].pluginId,
          message: `Hook ${hookName} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        });
      }
    }
  }

  beforeEach(() => {
    hookRegistry = new HookRegistry();
    callPluginHook = vi.fn().mockResolvedValue(undefined);
    logPush = vi.fn();
  });

  it("calls all subscribed handlers with the payload", async () => {
    hookRegistry.register("plugin-a", "user:registered", 1);
    hookRegistry.register("plugin-b", "user:registered", 2);

    const payload = {
      uuid: "u1",
      email: "a@b.com",
      gameId: "Player1",
      timestamp: 1000,
      ip: "1.2.3.4",
    };
    await emitUserHook("user:registered", payload);

    expect(callPluginHook).toHaveBeenCalledTimes(2);
    expect(callPluginHook).toHaveBeenCalledWith("plugin-a", "user:registered", payload);
    expect(callPluginHook).toHaveBeenCalledWith("plugin-b", "user:registered", payload);
  });

  it("returns immediately when no handlers are registered", async () => {
    await emitUserHook("user:login", { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1 });
    expect(callPluginHook).not.toHaveBeenCalled();
  });

  it("does not block other handlers when one fails", async () => {
    hookRegistry.register("plugin-a", "user:login", 1);
    hookRegistry.register("plugin-b", "user:login", 2);

    callPluginHook.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(undefined);

    const payload = {
      uuid: "u1",
      email: "a@b.com",
      gameId: "P",
      timestamp: 1,
      ip: null,
      method: "password",
    };
    await emitUserHook("user:login", payload);

    expect(callPluginHook).toHaveBeenCalledTimes(2);
    expect(logPush).toHaveBeenCalledTimes(1);
    expect(logPush).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        pluginId: "plugin-a",
        message: expect.stringContaining("timeout"),
      }),
    );
  });

  it("calls handlers in parallel (not serial)", async () => {
    hookRegistry.register("plugin-a", "user:registered", 1);
    hookRegistry.register("plugin-b", "user:registered", 2);

    const callOrder: string[] = [];
    callPluginHook.mockImplementation(async (pluginId: string) => {
      callOrder.push(`start:${pluginId}`);
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push(`end:${pluginId}`);
    });

    const payload = { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null };
    await emitUserHook("user:registered", payload);

    // Both should start before either ends (parallel)
    expect(callOrder[0]).toBe("start:plugin-a");
    expect(callOrder[1]).toBe("start:plugin-b");
  });
});
