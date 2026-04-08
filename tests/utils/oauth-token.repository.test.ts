import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateIndex = vi.fn();
const mockFindOne = vi.fn();
const mockInsertOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockUpdateMany = vi.fn();
const mockDeleteMany = vi.fn();

const mockCollection = {
  createIndex: mockCreateIndex,
  findOne: mockFindOne,
  insertOne: mockInsertOne,
  updateOne: mockUpdateOne,
  updateMany: mockUpdateMany,
  deleteMany: mockDeleteMany,
};

vi.stubGlobal("getDb", () => ({
  collection: () => mockCollection,
}));

let repo: typeof import("../../server/utils/oauth-token.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  repo = await import("../../server/utils/oauth-token.repository");
});

describe("ensureOAuthTokenIndexes", () => {
  it("creates tokenHash, clientId+userId, and expiresAt TTL indexes", async () => {
    await repo.ensureOAuthTokenIndexes();
    expect(mockCreateIndex).toHaveBeenCalledTimes(3);
    expect(mockCreateIndex).toHaveBeenCalledWith({ tokenHash: 1 }, { unique: true });
    expect(mockCreateIndex).toHaveBeenCalledWith({ clientId: 1, userId: 1 });
    expect(mockCreateIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });
});

describe("findOAuthTokenByHash", () => {
  it("finds non-revoked token by hash", async () => {
    const token = { tokenHash: "abc", revokedAt: null };
    mockFindOne.mockResolvedValue(token);
    const result = await repo.findOAuthTokenByHash("abc");
    expect(mockFindOne).toHaveBeenCalledWith({ tokenHash: "abc", revokedAt: null });
    expect(result).toEqual(token);
  });

  it("returns null when not found or revoked", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await repo.findOAuthTokenByHash("nonexistent");
    expect(result).toBeNull();
  });
});

describe("findOAuthTokenByHashIncludingRevoked", () => {
  it("finds token regardless of revocation status", async () => {
    const token = { tokenHash: "abc", revokedAt: new Date() };
    mockFindOne.mockResolvedValue(token);
    const result = await repo.findOAuthTokenByHashIncludingRevoked("abc");
    expect(mockFindOne).toHaveBeenCalledWith({ tokenHash: "abc" });
    expect(result).toEqual(token);
  });
});

describe("insertOAuthToken", () => {
  it("inserts a token document", async () => {
    const doc = { tokenHash: "abc", type: "access", clientId: "c1" };
    await repo.insertOAuthToken(doc as any);
    expect(mockInsertOne).toHaveBeenCalledWith(doc);
  });
});

describe("revokeOAuthToken", () => {
  it("sets revokedAt on non-revoked token", async () => {
    await repo.revokeOAuthToken("abc");
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ tokenHash: "abc", revokedAt: null });
    expect(update.$set.revokedAt).toBeInstanceOf(Date);
  });
});

describe("revokeAllOAuthTokensForUserAndClient", () => {
  it("revokes all non-revoked tokens for user+client", async () => {
    await repo.revokeAllOAuthTokensForUserAndClient("c1", "u1");
    expect(mockUpdateMany).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateMany.mock.calls[0];
    expect(filter).toEqual({ clientId: "c1", userId: "u1", revokedAt: null });
    expect(update.$set.revokedAt).toBeInstanceOf(Date);
  });
});

describe("revokeAllOAuthTokensForClient", () => {
  it("revokes all non-revoked tokens for client", async () => {
    await repo.revokeAllOAuthTokensForClient("c1");
    expect(mockUpdateMany).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateMany.mock.calls[0];
    expect(filter).toEqual({ clientId: "c1", revokedAt: null });
    expect(update.$set.revokedAt).toBeInstanceOf(Date);
  });
});

describe("deleteAllOAuthTokensForClient", () => {
  it("deletes all tokens for client", async () => {
    await repo.deleteAllOAuthTokensForClient("c1");
    expect(mockDeleteMany).toHaveBeenCalledWith({ clientId: "c1" });
  });
});
