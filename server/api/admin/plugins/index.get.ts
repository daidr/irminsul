export default defineEventHandler((event) => {
  requireAdmin(event);
  const manager = getPluginManager();
  return manager.getPlugins().map((p) => ({
    id: p.id,
    name: p.meta.name,
    version: p.meta.version,
    description: p.meta.description,
    author: p.meta.author,
    hooks: p.meta.hooks,
    status: p.status,
    order: p.order,
    configSchema: p.meta.config ?? [],
    hasConfig: (p.meta.config?.length ?? 0) > 0,
    error: p.error ?? null,
  }));
});
