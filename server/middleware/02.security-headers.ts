export default defineEventHandler((event) => {
  setHeader(event, "X-Authlib-Injector-API-Location", "/api/yggdrasil/");
  setHeader(event, "X-Content-Type-Options", "nosniff");
  setHeader(event, "X-Frame-Options", "DENY");
  setHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");

  if (process.env.NODE_ENV !== "development") {
    setHeader(event, "Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});
