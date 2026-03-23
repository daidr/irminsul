import { createLogger } from "evlog";

export default defineNitroPlugin(async () => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "05.init-settings" });
  await initBuiltinSettings();
  await loadSettingsCache();
  log.set({ status: "ok" });
  log.emit();
});
