import { hasActiveBan } from "../../types/user.schema";
import type { OAuthScope } from "../../types/oauth-provider.types";

export default defineEventHandler(async (event) => {
  // Set CORS headers
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Pragma", "no-cache");

  // Validate bearer token
  const tokenInfo = await requireOAuthBearer(event, []);

  // client_credentials tokens have no userId
  if (!tokenInfo.userId) {
    throw createError({ statusCode: 403, statusMessage: "This token has no associated user" });
  }

  // Fetch user
  const user = await findUserByUuid(tokenInfo.userId);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const scopes = tokenInfo.scopes as OAuthScope[];
  const result: Record<string, unknown> = {};

  // profile:read -> uuid, gameId, skin, cape
  if (scopes.includes("profile:read")) {
    result.uuid = user.uuid;
    result.gameId = user.gameId;
    result.skin = user.skin;
    result.cape = user.cape;
  }

  // email:read -> email, emailVerified
  if (scopes.includes("email:read")) {
    result.email = user.email;
    result.emailVerified = user.emailVerified;
  }

  // account:read -> registeredAt, hasBan
  if (scopes.includes("account:read")) {
    result.registeredAt = user.time.register;
    result.hasBan = hasActiveBan(user.bans);
  }

  return result;
});
