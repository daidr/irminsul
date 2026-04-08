import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateIndex = vi.fn();
const mockFindOne = vi.fn();
const mockFind = vi.fn();
const mockInsertOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockDeleteOne = vi.fn();
const mockToArray = vi.fn();

const mockCollection = {
  createIndex: mockCreateIndex,
  findOne: mockFindOne,
  find: mockFind,
  insertOne: mockInsertOne,
  updateOne: mockUpdateOne,
  deleteOne: mockDeleteOne,
};

mockFind.mockReturnValue({ toArray: mockToArray });

vi.stubGlobal("getDb", () => ({
  collection: () => mockCollection,
}));

let repo: typeof import("../../server/utils/oauth-app.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  mockFind.mockReturnValue({ toArray: mockToArray });
  repo = await import("../../server/utils/oauth-app.repository");
});

describe("ensureOAuthAppIndexes", () => {
  it("creates clientId, ownerId, and approved indexes", async () => {
    await repo.ensureOAuthAppIndexes();
    expect(mockCreateIndex).toHaveBeenCalledTimes(3);
    expect(mockCreateIndex).toHaveBeenCalledWith({ clientId: 1 }, { unique: true });
    expect(mockCreateIndex).toHaveBeenCalledWith({ ownerId: 1 });
    expect(mockCreateIndex).toHaveBeenCalledWith({ approved: 1 });
  });
});

describe("findOAuthAppByClientId", () => {
  it("finds app by clientId", async () => {
    const app = { clientId: "abc", name: "Test" };
    mockFindOne.mockResolvedValue(app);
    const result = await repo.findOAuthAppByClientId("abc");
    expect(mockFindOne).toHaveBeenCalledWith({ clientId: "abc" });
    expect(result).toEqual(app);
  });

  it("returns null when not found", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await repo.findOAuthAppByClientId("nonexistent");
    expect(result).toBeNull();
  });
});

describe("findOAuthAppsByOwner", () => {
  it("returns apps for owner", async () => {
    const apps = [{ clientId: "a" }, { clientId: "b" }];
    mockToArray.mockResolvedValue(apps);
    const result = await repo.findOAuthAppsByOwner("owner-1");
    expect(mockFind).toHaveBeenCalledWith({ ownerId: "owner-1" });
    expect(result).toEqual(apps);
  });
});

describe("findAllOAuthApps", () => {
  it("returns all apps when no filter", async () => {
    const apps = [{ clientId: "a" }];
    mockToArray.mockResolvedValue(apps);
    const result = await repo.findAllOAuthApps();
    expect(mockFind).toHaveBeenCalledWith({});
    expect(result).toEqual(apps);
  });

  it("filters by approved status", async () => {
    mockToArray.mockResolvedValue([]);
    await repo.findAllOAuthApps({ approved: true });
    expect(mockFind).toHaveBeenCalledWith({ approved: true });
  });

  it("filters by approved=false", async () => {
    mockToArray.mockResolvedValue([]);
    await repo.findAllOAuthApps({ approved: false });
    expect(mockFind).toHaveBeenCalledWith({ approved: false });
  });
});

describe("insertOAuthApp", () => {
  it("inserts a new app document", async () => {
    const doc = { clientId: "abc", name: "Test", ownerId: "owner-1" };
    await repo.insertOAuthApp(doc as any);
    expect(mockInsertOne).toHaveBeenCalledWith(doc);
  });
});

describe("updateOAuthApp", () => {
  it("updates fields and sets updatedAt", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await repo.updateOAuthApp("abc", { name: "New Name" });
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ clientId: "abc" });
    expect(update.$set.name).toBe("New Name");
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(result).toBe(true);
  });

  it("returns false when nothing modified", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await repo.updateOAuthApp("nonexistent", { name: "X" });
    expect(result).toBe(false);
  });
});

describe("approveOAuthApp", () => {
  it("sets approved=true with approvedBy and timestamps", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await repo.approveOAuthApp("abc", "admin-1");
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ clientId: "abc" });
    expect(update.$set.approved).toBe(true);
    expect(update.$set.approvedBy).toBe("admin-1");
    expect(update.$set.approvedAt).toBeInstanceOf(Date);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(result).toBe(true);
  });

  it("returns false when app not found", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await repo.approveOAuthApp("nonexistent", "admin-1");
    expect(result).toBe(false);
  });
});

describe("revokeOAuthAppApproval", () => {
  it("sets approved=false and clears approvedBy/approvedAt", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await repo.revokeOAuthAppApproval("abc");
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ clientId: "abc" });
    expect(update.$set.approved).toBe(false);
    expect(update.$set.approvedBy).toBeNull();
    expect(update.$set.approvedAt).toBeNull();
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(result).toBe(true);
  });

  it("returns false when app not found", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await repo.revokeOAuthAppApproval("nonexistent");
    expect(result).toBe(false);
  });
});

describe("deleteOAuthApp", () => {
  it("deletes by clientId", async () => {
    await repo.deleteOAuthApp("abc");
    expect(mockDeleteOne).toHaveBeenCalledWith({ clientId: "abc" });
  });
});
