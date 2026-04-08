const oauthCorsPatterns = [
  "/api/oauth-provider/token",
  "/api/oauth-provider/userinfo",
  "/api/oauth-provider/revoke",
  "/api/oauth-provider/resources/",
];

function isOAuthCorsPath(path: string): boolean {
  return oauthCorsPatterns.some((pattern) =>
    pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern,
  );
}

export default defineEventHandler((event) => {
  setHeader(event, "X-Authlib-Injector-API-Location", "/api/yggdrasil/");
  setHeader(event, "X-Content-Type-Options", "nosniff");
  setHeader(event, "X-Frame-Options", "DENY");
  setHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");

  if (process.env.NODE_ENV !== "development") {
    setHeader(event, "Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // CORS for OAuth provider endpoints
  const path = getRequestURL(event).pathname;
  if (isOAuthCorsPath(path)) {
    setHeader(event, "Access-Control-Allow-Origin", "*");
    setHeader(event, "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    setHeader(event, "Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (getMethod(event) === "OPTIONS") {
      setResponseStatus(event, 204);
      return "";
    }
  }
});
