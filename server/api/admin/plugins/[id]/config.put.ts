export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const body = await readBody(event);
  const manager = getPluginManager();
  const result = await manager.updateConfig(id, body ?? {});
  if (!result.ok) throw createError({ statusCode: 400, data: result.errors });
  return { ok: true };
});
