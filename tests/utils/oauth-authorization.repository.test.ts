import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateIndex = vi.fn();
const mockFindOne = vi.fn();
const mockFind = vi.fn();
const mockUpdateOne = vi.fn();
const mockDeleteOne = vi.fn();
const mockDeleteMany = vi.fn();
const mockToArray = vi.fn();

const mockCollection = {
  createIndex: mockCreateIndex,
  findOne: mockFindOne,
  find: mockFind,
  updateOne: mockUpdateOne,
  deleteOne: mockDeleteOne,
  deleteMany: mockDeleteMany,
};

mockFind.mockReturnValue({ toArray: mockToArray });

let repo: typeof import("../../server/utils/oauth-authorization.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  mockFind.mockReturnValue({ toArray: mockToArray });
  // Re-stub getDb each test for unstubGlobals compatibility
  vi.stubGlobal("getDb", () => ({
    collection: () => mockCollection,
  }));
  repo = await import("../../server/utils/oauth-authorization.repository");
});

describe("ensureOAuthAuthorizationIndexes", () => {
  it("creates clientId+userId unique index and userId index", async () => {
    await repo.ensureOAuthAuthorizationIndexes();
    expect(mockCreateIndex).toHaveBeenCalledTimes(2);
    expect(mockCreateIndex).toHaveBeenCalledWith({ clientId: 1, userId: 1 }, { unique: true });
    expect(mockCreateIndex).toHaveBeenCalledWith({ userId: 1 });
  });
});

describe("findOAuthAuthorization", () => {
  it("finds authorization by clientId and userId", async () => {
    const auth = { clientId: "c1", userId: "u1", scopes: ["profile:read"] };
    mockFindOne.mockResolvedValue(auth);
    const result = await repo.findOAuthAuthorization("c1", "u1");
    expect(mockFindOne).toHaveBeenCalledWith({ clientId: "c1", userId: "u1" });
    expect(result).toEqual(auth);
  });

  it("returns null when not found", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await repo.findOAuthAuthorization("c1", "u1");
    expect(result).toBeNull();
  });
});

describe("upsertOAuthAuthorization", () => {
  it("upserts authorization with scopes", async () => {
    await repo.upsertOAuthAuthorization("c1", "u1", ["profile:read", "email:read"]);
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update, options] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ clientId: "c1", userId: "u1" });
    expect(update.$set.scopes).toEqual(["profile:read", "email:read"]);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$setOnInsert.grantedAt).toBeInstanceOf(Date);
    expect(options.upsert).toBe(true);
  });
});

describe("findOAuthAuthorizationsByUser", () => {
  it("returns all authorizations for user", async () => {
    const auths = [{ clientId: "c1" }, { clientId: "c2" }];
    mockToArray.mockResolvedValue(auths);
    const result = await repo.findOAuthAuthorizationsByUser("u1");
    expect(mockFind).toHaveBeenCalledWith({ userId: "u1" });
    expect(result).toEqual(auths);
  });
});

describe("deleteOAuthAuthorization", () => {
  it("deletes by clientId and userId", async () => {
    await repo.deleteOAuthAuthorization("c1", "u1");
    expect(mockDeleteOne).toHaveBeenCalledWith({ clientId: "c1", userId: "u1" });
  });
});

describe("deleteAllOAuthAuthorizationsForClient", () => {
  it("deletes all authorizations for client", async () => {
    await repo.deleteAllOAuthAuthorizationsForClient("c1");
    expect(mockDeleteMany).toHaveBeenCalledWith({ clientId: "c1" });
  });
});
