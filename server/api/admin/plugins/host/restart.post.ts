export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const manager = getPluginManager();
  await manager.restartHost();
  return { ok: true };
});
