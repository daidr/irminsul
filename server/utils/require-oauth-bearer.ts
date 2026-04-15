import type { H3Event } from "h3";
import type { OAuthScope } from "../types/oauth-provider.types";

export async function requireOAuthBearer(event: H3Event, requiredScopes: OAuthScope[]) {
  const authorization = getHeader(event, "authorization");
  return validateBearerToken(authorization, requiredScopes);
}
