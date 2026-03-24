import { createLogger } from "evlog";

export default defineNitroPlugin((nitroApp) => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "03.db", action: "connect" });
  getDb();
  getRedisClient();
  log.set({ status: "ok" });
  log.emit();

  nitroApp.hooks.hook("close", async () => {
    await gracefulCloseDB();
    await gracefulCloseRedis();
  });
});
