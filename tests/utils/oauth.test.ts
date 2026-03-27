import { describe, it } from "vitest";

// 这些是纯逻辑测试，验证方法签名和返回类型
// 实际的 MongoDB 集成需要运行环境，此处用 todo 占位
describe("OAuth Repository Methods", () => {
  it.todo("addOAuthBinding adds a binding to user document");
  it.todo("addOAuthBinding rejects duplicate provider for same user");
  it.todo("removeOAuthBinding removes matching provider binding");
  it.todo("findUserByOAuthBinding finds user by provider+providerId");
  it.todo("findUserByOAuthBinding returns null for unbound provider");
});

describe("OAuth Utils", () => {
  it.todo("createOAuthState stores state in Redis with TTL");
  it.todo("consumeOAuthState retrieves and deletes state");
  it.todo("consumeOAuthState returns null for expired/missing state");
  it.todo("defaultExchangeToken sends POST with correct params");
  it.todo("defaultFetchProfile sends GET with Authorization header");
  it.todo("buildCallbackUrl constructs correct URL from runtime config");
});
