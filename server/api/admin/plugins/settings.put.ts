export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const body = await readBody(event);
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Invalid body" });
  }

  const manager = getPluginManager();

  if (typeof body.watcher === "boolean") {
    await setSetting("plugin.system.watcher", body.watcher, "irminsul.plugin");
    if (body.watcher) {
      manager.startWatcher();
    } else {
      manager.stopWatcher();
    }
  }

  if (typeof body.logBufferSize === "number" && body.logBufferSize > 0) {
    await setSetting("plugin.system.logBufferSize", body.logBufferSize, "irminsul.plugin");
  }

  if (typeof body.logRetentionDays === "number" && body.logRetentionDays > 0) {
    await setSetting("plugin.system.logRetentionDays", body.logRetentionDays, "irminsul.plugin");
  }

  return { ok: true };
});
