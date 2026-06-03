import { createLogger } from "evlog";
import type { NitroApp } from "nitropack/types";
import { PluginManager, setPluginManager } from "../utils/plugin/plugin-manager";

export async function initPlugins(nitroApp: NitroApp) {
  const log = createLogger({ category: "startup" });
  log.set({ step: "plugins", action: "init" });

  const manager = new PluginManager(PLUGINS_DIR);
  setPluginManager(manager);

  await manager.scan();
  await manager.start();

  manager.bridgeEvlogHooks(nitroApp);

  const plugins = manager.getPlugins();
  const enabled = plugins.filter((p) => p.status === "enabled").length;
  log.set({ status: "ok", discovered: plugins.length, enabled });
  log.emit();

  nitroApp.hooks.hook("close", async () => {
    await manager.destroy();
  });
}
