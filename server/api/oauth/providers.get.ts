export default defineEventHandler(() => {
  const manager = getPluginManager();
  const providers = manager.getOAuthProviders();
  return {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      brandColor: p.brandColor,
    })),
  };
});
