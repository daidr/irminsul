import type { OAuthAppDocument } from "../types/oauth-app.schema";

const COLLECTION_NAME = "oauth_apps";

function getOAuthAppCollection() {
  return getDb().collection<OAuthAppDocument>(COLLECTION_NAME);
}

export async function ensureOAuthAppIndexes() {
  const col = getOAuthAppCollection();
  await col.createIndex({ clientId: 1 }, { unique: true });
  await col.createIndex({ ownerId: 1 });
  await col.createIndex({ approved: 1 });
}

export async function findOAuthAppByClientId(clientId: string): Promise<OAuthAppDocument | null> {
  return getOAuthAppCollection().findOne({ clientId });
}

export async function findOAuthAppsByOwner(ownerId: string): Promise<OAuthAppDocument[]> {
  return getOAuthAppCollection().find({ ownerId }).toArray();
}

export async function findAllOAuthApps(filter?: {
  approved?: boolean;
}): Promise<OAuthAppDocument[]> {
  const query: Record<string, unknown> = {};
  if (filter?.approved !== undefined) query.approved = filter.approved;
  return getOAuthAppCollection().find(query).toArray();
}

export async function insertOAuthApp(doc: Omit<OAuthAppDocument, "_id">): Promise<void> {
  await getOAuthAppCollection().insertOne(doc as OAuthAppDocument);
}

export async function updateOAuthApp(
  clientId: string,
  update: Partial<
    Pick<OAuthAppDocument, "name" | "description" | "redirectUris" | "scopes" | "clientSecretHash">
  >,
): Promise<boolean> {
  const result = await getOAuthAppCollection().updateOne(
    { clientId },
    { $set: { ...update, updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function approveOAuthApp(clientId: string, approvedBy: string): Promise<boolean> {
  const now = new Date();
  const result = await getOAuthAppCollection().updateOne(
    { clientId },
    { $set: { approved: true, approvedBy, approvedAt: now, updatedAt: now } },
  );
  return result.modifiedCount > 0;
}

export async function revokeOAuthAppApproval(clientId: string): Promise<boolean> {
  const result = await getOAuthAppCollection().updateOne(
    { clientId },
    { $set: { approved: false, approvedBy: null, approvedAt: null, updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function deleteOAuthApp(clientId: string): Promise<void> {
  await getOAuthAppCollection().deleteOne({ clientId });
}
