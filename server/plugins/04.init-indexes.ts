import { createLogger } from "evlog";

export default defineNitroPlugin(async () => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "04.init-indexes" });
  await ensureUserIndexes();
  await ensureSettingsIndexes();
  log.set({ status: "ok" });
  log.emit();
});
