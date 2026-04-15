import type { OAuthScope } from "../../types/oauth-provider.types";
import { VALID_SCOPES } from "../../types/oauth-provider.types";

function buildOAuthRedirectError(
  redirectUri: string,
  error: string,
  description: string,
  state?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export default defineEventHandler(async (event) => {
  // 1. Check if OAuth is enabled
  const oauthEnabled = getSetting("oauth.enabled");
  if (!oauthEnabled) {
    throw createError({ statusCode: 404, statusMessage: "OAuth is not enabled" });
  }

  // 2. Validate query params
  const query = getQuery(event);
  const responseType = query.response_type as string | undefined;
  const clientId = query.client_id as string | undefined;
  const redirectUri = query.redirect_uri as string | undefined;
  const scope = query.scope as string | undefined;
  const codeChallenge = query.code_challenge as string | undefined;
  const codeChallengeMethod = query.code_challenge_method as string | undefined;
  const state = query.state as string | undefined;

  if (!clientId || !redirectUri) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required parameters: client_id and redirect_uri",
    });
  }

  // 3. Validate app exists, is approved, and redirect_uri matches
  const app = await findOAuthAppByClientId(clientId);
  if (!app || !app.approved) {
    throw createError({ statusCode: 400, statusMessage: "Invalid or unapproved client" });
  }

  if (!app.redirectUris.includes(redirectUri)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid redirect_uri" });
  }

  // From here on, we can redirect errors to the client
  if (responseType !== "code") {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "unsupported_response_type", "Only response_type=code is supported", state),
    );
  }

  // 4. Validate scope
  if (!scope) {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "invalid_scope", "Missing scope parameter", state),
    );
  }

  const requestedScopes = scope.split(" ") as OAuthScope[];
  for (const s of requestedScopes) {
    if (!VALID_SCOPES.includes(s)) {
      return sendRedirect(
        event,
        buildOAuthRedirectError(redirectUri, "invalid_scope", `Unknown scope: ${s}`, state),
      );
    }
    if (!app.scopes.includes(s)) {
      return sendRedirect(
        event,
        buildOAuthRedirectError(redirectUri, "invalid_scope", `Scope not allowed for this client: ${s}`, state),
      );
    }
  }

  // 5. Enforce PKCE for public clients (only S256)
  if (app.type === "public") {
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      return sendRedirect(
        event,
        buildOAuthRedirectError(redirectUri, "invalid_request", "Public clients must use PKCE with S256", state),
      );
    }
  }

  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "invalid_request", "Only S256 code_challenge_method is supported", state),
    );
  }

  // 6. If user not logged in, redirect to login
  const user = event.context.user;
  if (!user) {
    const currentUrl = getRequestURL(event);
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(currentUrl.pathname + currentUrl.search)}`);
  }

  // 7. If user already authorized same scopes, silent authorization
  const existingAuth = await findOAuthAuthorization(clientId, user.userId);
  if (existingAuth) {
    const allScopesCovered = requestedScopes.every((s) => existingAuth.scopes.includes(s));
    if (allScopesCovered) {
      const code = generateOpaqueToken();
      await storeAuthorizationCode(code, {
        clientId,
        userId: user.userId,
        scopes: requestedScopes,
        redirectUri,
        codeChallenge: codeChallenge && codeChallenge.length > 0 ? codeChallenge : null,
        codeChallengeMethod: "S256",
        createdAt: Date.now(),
      });

      const url = new URL(redirectUri);
      url.searchParams.set("code", code);
      if (state) url.searchParams.set("state", state);
      return sendRedirect(event, url.toString());
    }
  }

  // 8. Redirect to frontend confirm page
  const authorizeUrl = new URL("/oauth/authorize", getRequestURL(event).origin);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scope);
  if (state) authorizeUrl.searchParams.set("state", state);
  if (codeChallenge) authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  if (codeChallengeMethod) authorizeUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
  return sendRedirect(event, authorizeUrl.pathname + authorizeUrl.search);
});
