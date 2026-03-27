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
