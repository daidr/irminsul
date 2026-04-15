import { z } from "zod";
import type { OAuthScope } from "../../types/oauth-provider.types";
import { VALID_SCOPES } from "../../types/oauth-provider.types";

const bodySchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  action: z.enum(["approve", "deny"]),
});

function buildRedirectUrl(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export default defineEventHandler(async (event) => {
  // 1. Require user session
  const user = requireAuth(event);

  // Check if OAuth is enabled
  const oauthEnabled = getSetting("oauth.enabled");
  if (!oauthEnabled) {
    throw createError({ statusCode: 404, statusMessage: "OAuth is not enabled" });
  }

  // Rate limit by user (already authenticated via requireAuth)
  try {
    await checkRateLimit(event, `oauth:authorize:uid:${user.userId}`, {
      duration: 60_000,
      max: 20,
      delayAfter: 10,
      timeWait: 1_000,
      fastFail: true,
    });
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      throw createError({ statusCode: 429, statusMessage: "Too many requests" });
    }
    throw err;
  }

  // 2. Validate body
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request body" });
  }

  const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, action } = parsed.data;

  // 3. Validate app and redirect_uri
  const app = await findOAuthAppByClientId(client_id);
  if (!app || !app.approved) {
    throw createError({ statusCode: 400, statusMessage: "Invalid or unapproved client" });
  }

  if (!app.redirectUris.includes(redirect_uri)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid redirect_uri" });
  }

  // Validate scopes
  const requestedScopes = scope.split(" ") as OAuthScope[];
  for (const s of requestedScopes) {
    if (!VALID_SCOPES.includes(s) || !app.scopes.includes(s)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid scope: ${s}` });
    }
  }

  // Enforce PKCE for public clients
  if (app.type === "public") {
    if (!code_challenge || code_challenge_method !== "S256") {
      throw createError({
        statusCode: 400,
        statusMessage: "Public clients must use PKCE with S256",
      });
    }
  }
  if (code_challenge_method && code_challenge_method !== "S256") {
    throw createError({ statusCode: 400, statusMessage: "Only S256 code_challenge_method is supported" });
  }

  // 4. If deny, return error redirect
  if (action === "deny") {
    return {
      redirect: buildRedirectUrl(redirect_uri, {
        error: "access_denied",
        error_description: "The user denied the authorization request",
        state,
      }),
    };
  }

  // 5. Approve: generate code, store in Redis, save authorization
  const code = generateOpaqueToken();
  await storeAuthorizationCode(code, {
    clientId: client_id,
    userId: user.userId,
    scopes: requestedScopes,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge && code_challenge.length > 0 ? code_challenge : null,
    codeChallengeMethod: "S256",
    createdAt: Date.now(),
  });

  // Save/update authorization record
  await upsertOAuthAuthorization(client_id, user.userId, requestedScopes);

  return {
    redirect: buildRedirectUrl(redirect_uri, {
      code,
      state,
    }),
  };
});
