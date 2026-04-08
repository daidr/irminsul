export default defineEventHandler(async (event) => {
  // Set CORS and cache headers
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Pragma", "no-cache");

  try {
    const body = await readBody(event);
    const { token, client_id, client_secret } = body || {};

    if (!token || !client_id) {
      // RFC 7009: return 200 even for invalid requests for token param
      // But we need client_id to authenticate
      setResponseStatus(event, 200);
      return {};
    }

    // Authenticate client
    await authenticateClient(client_id, client_secret || undefined);

    // Hash and revoke the token
    const tokenHash = hashToken(token);
    await revokeOAuthToken(tokenHash);
  } catch {
    // RFC 7009: always return 200
  }

  setResponseStatus(event, 200);
  return {};
});
