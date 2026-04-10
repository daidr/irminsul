import type { ObjectId } from "mongodb";
import type { OAuthClientType, OAuthScope } from "./oauth-provider.types";

export interface OAuthAppDocument {
  _id: ObjectId;
  clientId: string;
  clientSecretHash: string | null;
  type: OAuthClientType;
  name: string;
  description: string;
  icon: { name: string; hue: number } | null;
  redirectUris: string[];
  scopes: OAuthScope[];
  ownerId: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
