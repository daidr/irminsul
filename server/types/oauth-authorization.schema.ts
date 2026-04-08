import type { ObjectId } from "mongodb";
import type { OAuthScope } from "./oauth-provider.types";

export interface OAuthAuthorizationDocument {
  _id: ObjectId;
  clientId: string;
  userId: string;
  scopes: OAuthScope[];
  grantedAt: Date;
  updatedAt: Date;
}
