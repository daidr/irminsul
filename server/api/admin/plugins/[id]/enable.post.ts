export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const manager = getPluginManager();
  const result = await manager.enablePlugin(id);
  if (!result.ok) throw createError({ statusCode: 400, message: result.error });
  return { ok: true };
});
