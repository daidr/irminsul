export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const baseUrl = config.yggdrasilBaseUrl as string;

  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth-provider/authorize`,
    token_endpoint: `${baseUrl}/api/oauth-provider/token`,
    revocation_endpoint: `${baseUrl}/api/oauth-provider/revoke`,
    userinfo_endpoint: `${baseUrl}/api/oauth-provider/userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: [
      "profile:read",
      "profile:write",
      "email:read",
      "account:base",
      "account:ban",
    ],
    code_challenge_methods_supported: ["S256"],
  };
});
