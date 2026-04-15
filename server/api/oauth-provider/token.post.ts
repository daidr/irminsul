import type { OAuthScope } from "../../types/oauth-provider.types";
import { CLIENT_CREDENTIALS_ALLOWED_SCOPES, VALID_SCOPES } from "../../types/oauth-provider.types";

export default defineEventHandler(async (event) => {
  // Set CORS and cache headers
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Pragma", "no-cache");

  try {
    const body = await readBody(event);
    const grantType = body?.grant_type;

    if (grantType === "authorization_code") {
      return await handleAuthorizationCode(event, body);
    } else if (grantType === "client_credentials") {
      return await handleClientCredentials(event, body);
    } else if (grantType === "refresh_token") {
      return await handleRefreshToken(event, body);
    } else {
      throw new OAuthError("unsupported_grant_type", "Unsupported grant_type", 400);
    }
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return {
        error: err.errorCode,
        error_description: err.errorDescription,
      };
    }
    throw err;
  }
});

async function handleAuthorizationCode(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  body: Record<string, string>,
) {
  const { client_id, client_secret, code, redirect_uri, code_verifier } = body;

  if (!client_id || !code || !redirect_uri) {
    throw new OAuthError("invalid_request", "Missing required parameters", 400);
  }

  // Authenticate client
  const app = await authenticateClient(client_id, client_secret || undefined);

  // Consume authorization code from Redis
  const codeData = await consumeAuthorizationCode(code);
  if (!codeData) {
    throw new OAuthError("invalid_grant", "Invalid or expired authorization code", 400);
  }

  // Verify redirect_uri matches
  if (codeData.redirectUri !== redirect_uri) {
    throw new OAuthError("invalid_grant", "redirect_uri mismatch", 400);
  }

  // Verify client_id matches
  if (codeData.clientId !== client_id) {
    throw new OAuthError("invalid_grant", "client_id mismatch", 400);
  }

  // Verify PKCE
  if (codeData.codeChallenge !== null) {
    if (!code_verifier) {
      throw new OAuthError("invalid_grant", "code_verifier required", 400);
    }
    if (!verifyPkce(code_verifier, codeData.codeChallenge)) {
      throw new OAuthError("invalid_grant", "PKCE verification failed", 400);
    }
  }

  // Issue token pair
  const tokenResponse = await issueTokenPair({
    clientId: client_id,
    userId: codeData.userId,
    scopes: codeData.scopes,
  });

  return {
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    refresh_token: tokenResponse.refreshToken,
    scope: tokenResponse.scope,
  };
}

async function handleClientCredentials(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  body: Record<string, string>,
) {
  const { client_id, client_secret, scope } = body;

  if (!client_id || !client_secret) {
    throw new OAuthError("invalid_request", "Missing client credentials", 400);
  }

  // Authenticate client (must be confidential)
  const app = await authenticateClient(client_id, client_secret);
  if (app.type !== "confidential") {
    throw new OAuthError("unauthorized_client", "Only confidential clients can use client_credentials grant", 400);
  }

  // Validate scope
  const requestedScopes = scope ? (scope.split(" ") as OAuthScope[]) : CLIENT_CREDENTIALS_ALLOWED_SCOPES;
  for (const s of requestedScopes) {
    if (!VALID_SCOPES.includes(s)) {
      throw new OAuthError("invalid_scope", `Unknown scope: ${s}`, 400);
    }
    if (!CLIENT_CREDENTIALS_ALLOWED_SCOPES.includes(s)) {
      throw new OAuthError("invalid_scope", `Scope not allowed for client_credentials: ${s}`, 400);
    }
  }

  // Issue access token only (no refresh token)
  const tokenResponse = await issueTokenPair({
    clientId: client_id,
    userId: null,
    scopes: requestedScopes,
    skipRefreshToken: true,
  });

  return {
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    scope: tokenResponse.scope,
  };
}

async function handleRefreshToken(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  body: Record<string, string>,
) {
  const { client_id, client_secret, refresh_token } = body;

  if (!client_id || !refresh_token) {
    throw new OAuthError("invalid_request", "Missing required parameters", 400);
  }

  // Authenticate client
  await authenticateClient(client_id, client_secret || undefined);

  // Refresh the token
  const tokenResponse = await refreshAccessToken(refresh_token, client_id);

  return {
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    refresh_token: tokenResponse.refreshToken,
    scope: tokenResponse.scope,
  };
}
