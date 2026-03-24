export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const body = await readBody(event);
  if (!body?.order || !Array.isArray(body.order)) {
    throw createError({ statusCode: 400, message: "body.order must be a string array" });
  }
  const manager = getPluginManager();
  await manager.updateOrder(body.order);
  return { ok: true };
});
