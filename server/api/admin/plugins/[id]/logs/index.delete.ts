export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const manager = getPluginManager();
  await manager.getLogManager().clearLogs(id);
  return { ok: true };
});
