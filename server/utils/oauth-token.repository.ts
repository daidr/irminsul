import type { OAuthTokenDocument } from "../types/oauth-token.schema";

const COLLECTION_NAME = "oauth_tokens";

function getOAuthTokenCollection() {
  return getDb().collection<OAuthTokenDocument>(COLLECTION_NAME);
}

export async function ensureOAuthTokenIndexes() {
  const col = getOAuthTokenCollection();
  await col.createIndex({ tokenHash: 1 }, { unique: true });
  await col.createIndex({ clientId: 1, userId: 1 });
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function findOAuthTokenByHash(tokenHash: string): Promise<OAuthTokenDocument | null> {
  return getOAuthTokenCollection().findOne({ tokenHash, revokedAt: null });
}

export async function findOAuthTokenByHashIncludingRevoked(
  tokenHash: string,
): Promise<OAuthTokenDocument | null> {
  return getOAuthTokenCollection().findOne({ tokenHash });
}

export async function insertOAuthToken(doc: Omit<OAuthTokenDocument, "_id">): Promise<void> {
  await getOAuthTokenCollection().insertOne(doc as OAuthTokenDocument);
}

export async function revokeOAuthToken(tokenHash: string): Promise<void> {
  await getOAuthTokenCollection().updateOne(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllOAuthTokensForUserAndClient(
  clientId: string,
  userId: string,
): Promise<void> {
  await getOAuthTokenCollection().updateMany(
    { clientId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllOAuthTokensForClient(clientId: string): Promise<void> {
  await getOAuthTokenCollection().updateMany(
    { clientId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function deleteAllOAuthTokensForClient(clientId: string): Promise<void> {
  await getOAuthTokenCollection().deleteMany({ clientId });
}
