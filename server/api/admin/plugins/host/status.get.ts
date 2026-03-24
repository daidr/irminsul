export default defineEventHandler((event) => {
  requireAdmin(event);
  const manager = getPluginManager();
  return manager.getHostStatus();
});
