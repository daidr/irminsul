import { createLogger } from "evlog";

export async function initIndexes() {
  const log = createLogger({ category: "startup" });
  log.set({ step: "init-indexes" });
  await ensureUserIndexes();
  await ensureSettingsIndexes();
  log.set({ status: "ok" });
  log.emit();
}
