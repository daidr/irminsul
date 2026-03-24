export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const manager = getPluginManager();
  await manager.disablePlugin(id);
  return { ok: true };
});
