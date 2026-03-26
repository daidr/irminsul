import { createLogger } from "evlog";
import type { NitroApp } from "nitropack/types";

export function initDb(nitroApp: NitroApp) {
  const log = createLogger({ category: "startup" });
  log.set({ step: "db", action: "connect" });
  getDb();
  getRedisClient();
  log.set({ status: "ok" });
  log.emit();

  nitroApp.hooks.hook("close", async () => {
    await gracefulCloseDB();
    await gracefulCloseRedis();
  });
}
