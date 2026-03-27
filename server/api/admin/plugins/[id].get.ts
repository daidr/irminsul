export default defineEventHandler((event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const manager = getPluginManager();
  const plugin = manager.getPlugin(id);
  if (!plugin) throw createError({ statusCode: 404, message: "Plugin not found" });

  // Get stored config and mask password fields
  const rawConfig = (getSetting(`plugin.custom.${id}.config`) as Record<string, unknown>) ?? {};
  const maskedConfig: Record<string, unknown> = { ...rawConfig };
  for (const field of plugin.meta.config ?? []) {
    if (field.type === "password" && maskedConfig[field.key]) {
      maskedConfig[field.key] = "****";
    }
  }

  // Compute OAuth callback URL if plugin has registered a provider
  let oauthCallbackUrl: string | null = null;
  const oauthProvider = manager.getOAuthProviderByPlugin(id);
  if (oauthProvider) {
    const config = useRuntimeConfig();
    const baseUrl = (config.yggdrasilBaseUrl as string)?.replace(/\/+$/, "");
    if (baseUrl) {
      oauthCallbackUrl = `${baseUrl}/api/oauth/${oauthProvider.descriptor.id}/callback`;
    }
  }

  return {
    id: plugin.id,
    name: plugin.meta.name,
    version: plugin.meta.version,
    description: plugin.meta.description,
    author: plugin.meta.author,
    hooks: plugin.meta.hooks,
    status: plugin.status,
    order: plugin.order,
    error: plugin.error ?? null,
    configSchema: plugin.meta.config ?? [],
    config: maskedConfig,
    oauthCallbackUrl,
  };
});
