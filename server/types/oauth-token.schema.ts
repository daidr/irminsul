import type { ObjectId } from "mongodb";
import type { OAuthScope } from "./oauth-provider.types";

export type OAuthTokenType = "access" | "refresh";

export interface OAuthTokenDocument {
  _id: ObjectId;
  tokenHash: string;
  type: OAuthTokenType;
  clientId: string;
  userId: string | null;
  scopes: OAuthScope[];
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  parentTokenHash: string | null;
}
