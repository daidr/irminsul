export default defineEventHandler((event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const query = getQuery(event);

  const manager = getPluginManager();
  const logManager = manager.getLogManager();

  return logManager.getHistory(id, {
    before: query.before as string | undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    level: query.level as string | undefined,
    type: query.type as string | undefined,
  });
});
