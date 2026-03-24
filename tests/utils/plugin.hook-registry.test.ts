import { describe, it, expect } from "vitest";
import { HookRegistry } from "../../server/utils/plugin/hook-registry";

describe("HookRegistry", () => {
  it("registers and retrieves handlers by hook name", () => {
    const registry = new HookRegistry();
    registry.register("plugin-a", "evlog:drain", 1);
    const handlers = registry.get("evlog:drain");
    expect(handlers).toHaveLength(1);
    expect(handlers[0].pluginId).toBe("plugin-a");
  });

  it("sorts handlers by order", () => {
    const registry = new HookRegistry();
    registry.register("plugin-b", "evlog:drain", 2);
    registry.register("plugin-a", "evlog:drain", 1);
    registry.register("plugin-c", "evlog:drain", 3);
    const handlers = registry.get("evlog:drain");
    expect(handlers.map((h) => h.pluginId)).toEqual([
      "plugin-a",
      "plugin-b",
      "plugin-c",
    ]);
  });

  it("returns empty array for unknown hook", () => {
    const registry = new HookRegistry();
    expect(registry.get("unknown:hook")).toEqual([]);
  });

  it("removes all handlers for a plugin", () => {
    const registry = new HookRegistry();
    registry.register("plugin-a", "evlog:drain", 1);
    registry.register("plugin-a", "evlog:enricher", 1);
    registry.register("plugin-b", "evlog:drain", 2);
    registry.removePlugin("plugin-a");
    expect(registry.get("evlog:drain")).toHaveLength(1);
    expect(registry.get("evlog:drain")[0].pluginId).toBe("plugin-b");
    expect(registry.get("evlog:enricher")).toEqual([]);
  });

  it("handles multiple plugins on different hooks with interleaved order", () => {
    const registry = new HookRegistry();
    registry.register("plugin-a", "evlog:enricher", 2);
    registry.register("plugin-b", "evlog:enricher", 1);
    registry.register("plugin-a", "evlog:drain", 1);
    registry.register("plugin-b", "evlog:drain", 2);

    expect(registry.get("evlog:enricher").map((h) => h.pluginId)).toEqual([
      "plugin-b",
      "plugin-a",
    ]);
    expect(registry.get("evlog:drain").map((h) => h.pluginId)).toEqual([
      "plugin-a",
      "plugin-b",
    ]);
  });

  it("clear removes everything", () => {
    const registry = new HookRegistry();
    registry.register("plugin-a", "evlog:drain", 1);
    registry.register("plugin-b", "evlog:enricher", 2);
    registry.clear();
    expect(registry.get("evlog:drain")).toEqual([]);
    expect(registry.get("evlog:enricher")).toEqual([]);
  });
});
