export default defineEventHandler((event) => {
  requireAdmin(event);
  return {
    watcher: getSetting("plugin.system.watcher") ?? true,
    logBufferSize: getSetting("plugin.system.logBufferSize") ?? 200,
    logRetentionDays: getSetting("plugin.system.logRetentionDays") ?? 7,
  };
});
