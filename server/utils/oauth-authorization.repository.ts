import type { OAuthAuthorizationDocument } from "../types/oauth-authorization.schema";
import type { OAuthScope } from "../types/oauth-provider.types";

const COLLECTION_NAME = "oauth_authorizations";

function getOAuthAuthorizationCollection() {
  return getDb().collection<OAuthAuthorizationDocument>(COLLECTION_NAME);
}

export async function ensureOAuthAuthorizationIndexes() {
  const col = getOAuthAuthorizationCollection();
  await col.createIndex({ clientId: 1, userId: 1 }, { unique: true });
  await col.createIndex({ userId: 1 });
}

export async function findOAuthAuthorization(clientId: string, userId: string): Promise<OAuthAuthorizationDocument | null> {
  return getOAuthAuthorizationCollection().findOne({ clientId, userId });
}

export async function upsertOAuthAuthorization(clientId: string, userId: string, scopes: OAuthScope[]): Promise<void> {
  const now = new Date();
  await getOAuthAuthorizationCollection().updateOne(
    { clientId, userId },
    { $set: { scopes, updatedAt: now }, $setOnInsert: { grantedAt: now } },
    { upsert: true },
  );
}

export async function findOAuthAuthorizationsByUser(userId: string): Promise<OAuthAuthorizationDocument[]> {
  return getOAuthAuthorizationCollection().find({ userId }).toArray();
}

export async function deleteOAuthAuthorization(clientId: string, userId: string): Promise<void> {
  await getOAuthAuthorizationCollection().deleteOne({ clientId, userId });
}

export async function deleteAllOAuthAuthorizationsForClient(clientId: string): Promise<void> {
  await getOAuthAuthorizationCollection().deleteMany({ clientId });
}
