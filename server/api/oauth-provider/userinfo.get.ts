import { hasActiveBan, isBanActive } from "../../types/user.schema";
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

  // account:base -> emailVerified, registeredAt
  if (scopes.includes("account:base")) {
    result.emailVerified = user.emailVerified;
    result.registeredAt = user.time.register;
  }

  // account:ban -> isBanned, bans (full history)
  if (scopes.includes("account:ban")) {
    result.isBanned = hasActiveBan(user.bans);
    result.bans = user.bans.map((ban) => ({
      id: ban.id,
      start: ban.start,
      end: ban.end ?? null,
      reason: ban.reason ?? null,
      active: isBanActive(ban),
      revokedAt: ban.revokedAt ?? null,
    }));
  }

  return result;
});
