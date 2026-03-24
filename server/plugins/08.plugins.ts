import { createLogger } from "evlog";
import { PluginManager, setPluginManager } from "../utils/plugin/plugin-manager";

export default defineNitroPlugin(async (nitroApp) => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "08.plugins", action: "init" });

  const pluginsDir = "./irminsul-data/plugins";
  const manager = new PluginManager(pluginsDir);
  setPluginManager(manager);

  await manager.scan();
  await manager.start();

  // Bridge enricher/drain hooks to plugin system
  manager.bridgeEvlogHooks(nitroApp);

  const plugins = manager.getPlugins();
  const enabled = plugins.filter((p) => p.status === "enabled").length;
  log.set({ status: "ok", discovered: plugins.length, enabled });
  log.emit();

  nitroApp.hooks.hook("close", async () => {
    await manager.destroy();
  });
});
