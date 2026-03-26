import { createLogger } from "evlog";

export async function initSettings() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "init-settings" });
  await initBuiltinSettings();
  await loadSettingsCache();
  log.set({ status: "ok" });
  log.emit();
}
