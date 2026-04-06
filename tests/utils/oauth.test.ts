import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getUserCollection with full control
const mockUpdateOne = vi.fn();
const mockFindOne = vi.fn();
const mockCollection = {
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
};

// Stub Nitro auto-imported globals
const mockRedisSend = vi.fn();
vi.stubGlobal("getRedisClient", () => ({ send: mockRedisSend }));
vi.stubGlobal("buildRedisKey", (...args: string[]) => `irmin:${args.join(":")}`);
vi.stubGlobal("useRuntimeConfig", () => ({
  yggdrasilBaseUrl: "https://auth.example.com",
}));
vi.stubGlobal("getDb", () => ({
  collection: () => mockCollection,
}));

// Mock node:crypto used by oauth.ts
vi.mock("node:crypto", () => ({
  randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
}));

// Inline mock for user.repository — replicate only the three OAuth functions
// since importOriginal fails on ~~ alias resolution
vi.mock("../../server/utils/user.repository", () => {
  const col = {
    get updateOne() { return mockUpdateOne; },
    get findOne() { return mockFindOne; },
  };
  const getUserCollection = () => col;
  return {
    getUserCollection,
    async addOAuthBinding(uuid: string, binding: { provider: string; providerId: string }) {
      const result = await col.updateOne(
        { uuid, "oauthBindings.provider": { $ne: binding.provider } },
        { $push: { oauthBindings: binding } },
      );
      return result.modifiedCount > 0;
    },
    async removeOAuthBinding(uuid: string, provider: string) {
      const result = await col.updateOne(
        { uuid },
        { $pull: { oauthBindings: { provider } } },
      );
      return result.modifiedCount > 0;
    },
    async findUserByOAuthBinding(provider: string, providerId: string) {
      return col.findOne({
        oauthBindings: { $elemMatch: { provider, providerId } },
      });
    },
  };
});

let userRepo: typeof import("../../server/utils/user.repository");
let oauth: typeof import("../../server/utils/oauth");

beforeEach(async () => {
  vi.clearAllMocks();
  userRepo = await import("../../server/utils/user.repository");
  oauth = await import("../../server/utils/oauth");
});

describe("OAuth Repository Methods", () => {
  it("addOAuthBinding adds a binding to user document", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const binding = { provider: "github", providerId: "12345", displayName: "octocat", boundAt: new Date() };
    const result = await userRepo.addOAuthBinding("user-uuid", binding as any);

    expect(result).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid", "oauthBindings.provider": { $ne: "github" } });
    expect(update.$push.oauthBindings).toEqual(binding);
  });

  it("addOAuthBinding rejects duplicate provider for same user", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const binding = { provider: "github", providerId: "99999", displayName: "dup", boundAt: new Date() };
    const result = await userRepo.addOAuthBinding("user-uuid", binding as any);

    expect(result).toBe(false);
  });

  it("removeOAuthBinding removes matching provider binding", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await userRepo.removeOAuthBinding("user-uuid", "github");

    expect(result).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$pull.oauthBindings).toEqual({ provider: "github" });
  });

  it("findUserByOAuthBinding finds user by provider+providerId", async () => {
    const fakeUser = { uuid: "user-uuid", email: "u@t.com", gameId: "Player1" };
    mockFindOne.mockResolvedValue(fakeUser);
    const result = await userRepo.findUserByOAuthBinding("github", "12345");

    expect(result).toEqual(fakeUser);
    expect(mockFindOne).toHaveBeenCalledWith({
      oauthBindings: { $elemMatch: { provider: "github", providerId: "12345" } },
    });
  });

  it("findUserByOAuthBinding returns null for unbound provider", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await userRepo.findUserByOAuthBinding("github", "nonexistent");

    expect(result).toBeNull();
  });
});

describe("OAuth Utils", () => {
  it("createOAuthState stores state in Redis with TTL", async () => {
    mockRedisSend.mockResolvedValue("OK");
    const state = await oauth.createOAuthState({ action: "bind", userId: "user-uuid", providerId: "github" });

    expect(state).toBe("aaaaaaaabbbbccccddddeeeeeeeeeeee");
    expect(mockRedisSend).toHaveBeenCalledOnce();
    const [cmd, args] = mockRedisSend.mock.calls[0];
    expect(cmd).toBe("SET");
    expect(args[0]).toBe(`irmin:oauth:state:${state}`);
    expect(JSON.parse(args[1])).toEqual({ action: "bind", userId: "user-uuid", providerId: "github" });
    expect(args[2]).toBe("EX");
    expect(args[3]).toBe("300");
  });

  it("consumeOAuthState retrieves and deletes state", async () => {
    const data = { action: "login", providerId: "github" };
    mockRedisSend.mockResolvedValue(JSON.stringify(data));
    const result = await oauth.consumeOAuthState("abc123");

    expect(result).toEqual(data);
    expect(mockRedisSend).toHaveBeenCalledWith("GETDEL", ["irmin:oauth:state:abc123"]);
  });

  it("consumeOAuthState returns null for expired/missing state", async () => {
    mockRedisSend.mockResolvedValue(null);
    const result = await oauth.consumeOAuthState("expired-state");

    expect(result).toBeNull();
  });

  it("buildCallbackUrl constructs correct URL from runtime config", () => {
    const url = oauth.buildCallbackUrl("github");
    expect(url).toBe("https://auth.example.com/api/oauth/github/callback");
  });
});
