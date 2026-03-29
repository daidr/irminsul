import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getUserCollection
const mockUpdateOne = vi.fn();
const mockFindOne = vi.fn();
const mockCollection = {
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
};

vi.mock("../../server/utils/user.repository", () => ({
  getUserCollection: () => mockCollection,
}));

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "test-uuid-1234",
});

let banRepo: typeof import("../../server/utils/ban.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  banRepo = await import("../../server/utils/ban.repository");
});

describe("addBan", () => {
  it("pushes a new ban record with generated id and operatorId", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.addBan("user-uuid", { reason: "test" }, "admin-uuid");

    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$push.bans.id).toBe("test-uuid-1234");
    expect(update.$push.bans.operatorId).toBe("admin-uuid");
    expect(update.$push.bans.reason).toBe("test");
    expect(update.$push.bans.start).toBeInstanceOf(Date);
    expect(update.$push.bans.end).toBeUndefined();
    expect(result).toEqual({ success: true, banId: "test-uuid-1234" });
  });

  it("sets end date when provided", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const end = new Date("2026-12-31T00:00:00Z");
    await banRepo.addBan("user-uuid", { end, reason: "temp" }, "admin-uuid");

    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$push.bans.end).toEqual(end);
  });

  it("returns failure when user not found", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const result = await banRepo.addBan("nonexistent", {}, "admin-uuid");
    expect(result).toEqual({ success: false, error: "用户不存在" });
  });
});

describe("revokeBan", () => {
  it("sets revokedAt and revokedBy on matching active ban using $elemMatch", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.revokeBan("user-uuid", "ban-id", "admin-uuid");

    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    // Must use $elemMatch to ensure conditions match the SAME array element
    expect(filter.uuid).toBe("user-uuid");
    expect(filter.bans.$elemMatch.id).toBe("ban-id");
    expect(filter.bans.$elemMatch.revokedAt).toEqual({ $exists: false });
    expect(filter.bans.$elemMatch.start).toBeDefined(); // $lte check
    expect(update.$set["bans.$.revokedAt"]).toBeInstanceOf(Date);
    expect(update.$set["bans.$.revokedBy"]).toBe("admin-uuid");
    expect(result).toEqual({ success: true });
  });

  it("returns failure when ban already revoked, expired, or not found", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const result = await banRepo.revokeBan("user-uuid", "ban-id", "admin-uuid");
    expect(result).toEqual({ success: false, error: "该封禁已被撤销、已过期或不存在" });
  });
});

describe("editBan", () => {
  it("updates end and reason on matching ban", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const end = new Date("2027-01-01T00:00:00Z");
    const result = await banRepo.editBan("user-uuid", "ban-id", { end, reason: "updated" });

    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid", "bans.id": "ban-id" });
    expect(update.$set["bans.$.end"]).toEqual(end);
    expect(update.$set["bans.$.reason"]).toBe("updated");
    expect(result).toEqual({ success: true });
  });

  it("unsets end when null (make permanent)", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.editBan("user-uuid", "ban-id", { end: null });

    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$unset["bans.$.end"]).toBe("");
    expect(result).toEqual({ success: true });
  });

  it("returns failure when ban not found", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const result = await banRepo.editBan("user-uuid", "ban-id", { reason: "x" });
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });
});

describe("removeBan", () => {
  it("pulls ban record from array", async () => {
    mockFindOne.mockResolvedValue({ bans: [{ id: "ban-id", start: new Date(), operatorId: "op" }] });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.removeBan("user-uuid", "ban-id");

    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$pull.bans).toEqual({ id: "ban-id" });
    expect(result.success).toBe(true);
    expect(result.removed).toBeDefined();
  });

  it("returns failure when ban not found", async () => {
    mockFindOne.mockResolvedValue({ bans: [] });
    const result = await banRepo.removeBan("user-uuid", "nonexistent");
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });
});

describe("getUserBans", () => {
  it("returns bans array for user", async () => {
    const bans = [
      { id: "1", start: new Date("2026-03-01"), operatorId: "op" },
      { id: "2", start: new Date("2026-01-01"), operatorId: "op" },
    ];
    mockFindOne.mockResolvedValue({ bans });
    const result = await banRepo.getUserBans("user-uuid");
    expect(result).toEqual(bans);
    expect(mockFindOne).toHaveBeenCalledWith(
      { uuid: "user-uuid" },
      { projection: { bans: 1 } },
    );
  });

  it("returns empty array when user not found", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await banRepo.getUserBans("nonexistent");
    expect(result).toEqual([]);
  });
});
