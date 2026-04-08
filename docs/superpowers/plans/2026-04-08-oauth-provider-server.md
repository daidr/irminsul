# OAuth 授权服务器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Irminsul 扩展为 OAuth 2.1 授权服务器，允许第三方应用通过 Irminsul 鉴权并获取玩家数据。

**Architecture:** 独立数据模型（`oauth_apps`、`oauth_tokens`、`oauth_authorizations` 三个 MongoDB 集合），授权码存储在 Redis。OAuth 协议端点放在 `server/api/oauth-provider/` 下，前端新增授权确认页、开发者管理页、用户授权管理页和管理员审批页。

**Tech Stack:** Nuxt 4 + Bun + MongoDB + Redis + Zod + Vitest + DaisyUI v5

**设计文档:** `docs/superpowers/specs/2026-04-08-oauth-provider-server-design.md`

---

## 文件结构

### 新建文件

```
server/types/
  oauth-app.schema.ts              — OAuthAppDocument 类型定义
  oauth-token.schema.ts            — OAuthTokenDocument 类型定义
  oauth-authorization.schema.ts    — OAuthAuthorizationDocument 类型定义
  oauth-provider.types.ts          — Scope 定义、请求/响应类型、常量

server/utils/
  oauth-app.repository.ts          — OAuth 应用 CRUD + 索引
  oauth-token.repository.ts        — OAuth Token CRUD + 索引
  oauth-authorization.repository.ts — 用户授权记录 CRUD + 索引
  oauth-provider.service.ts        — 核心业务逻辑（PKCE、客户端认证、授权码、Token 生命周期）
  require-developer.ts             — isDeveloper 权限检查
  require-oauth-bearer.ts          — Bearer token 解析 + 验证 + scope 检查

server/api/oauth-provider/
  authorize.get.ts                 — 授权端点 GET（检查 → 静默或重定向确认页）
  authorize.post.ts                — 授权端点 POST（用户确认后生成授权码）
  token.post.ts                    — 令牌端点（authorization_code / client_credentials / refresh_token）
  revoke.post.ts                   — 撤销 Token（RFC 7009）
  userinfo.get.ts                  — 获取当前授权用户信息
  well-known.get.ts                — 服务发现元数据

  apps/
    index.get.ts                   — 列出开发者自己的应用
    index.post.ts                  — 创建应用
    [clientId].get.ts              — 查看应用详情
    [clientId].patch.ts            — 更新应用信息
    [clientId].delete.ts           — 删除应用
    [clientId]/
      reset-secret.post.ts        — 重置 client secret

  authorizations/
    index.get.ts                   — 列出用户已授权的应用
    [clientId].delete.ts           — 撤销对某应用的授权

  admin/
    apps/
      index.get.ts                 — 列出所有应用
      [clientId]/
        approve.post.ts            — 审批应用
        revoke-approval.post.ts    — 撤销审批
        index.delete.ts            — 强制删除应用
    developers/
      [uuid].post.ts              — 标记用户为开发者
      [uuid].delete.ts            — 撤销开发者身份

  resources/
    profile/
      [uuid].get.ts               — 查询玩家档案
      [uuid]/
        skin.put.ts               — 上传皮肤
        skin.delete.ts            — 删除皮肤
        cape.put.ts               — 上传披风
        cape.delete.ts            — 删除披风

app/pages/
  oauth/
    authorize.vue                  — 授权确认页
  developer/
    apps/
      index.vue                    — 开发者应用列表
      new.vue                      — 创建新应用
      [clientId].vue               — 应用详情与编辑
  settings/
    authorizations.vue             — 已授权的第三方应用
  admin/
    oauth-apps.vue                 — 管理员审批页

tests/utils/
  oauth-provider.service.test.ts   — OAuth 核心服务测试
  oauth-app.repository.test.ts     — OAuth App 仓库测试
  oauth-token.repository.test.ts   — OAuth Token 仓库测试

tests/server/
  oauth-provider.test.ts           — OAuth 端点集成测试
```

### 修改文件

```
server/types/user.schema.ts        — 添加 isDeveloper 字段
server/utils/user.repository.ts    — 添加 setDeveloperStatus() 函数
server/utils/settings.repository.ts — 添加 oauth.* 内置配置项
server/plugins/server-startup.ts   — 添加 OAuth 集合索引初始化
server/middleware/01.session.ts     — 添加 isDeveloper 到 event.context.user
nuxt.config.ts                     — 无需修改（runtimeConfig 由 settings 管理）
```

---

## Task 1: 类型定义

**Files:**
- Create: `server/types/oauth-app.schema.ts`
- Create: `server/types/oauth-token.schema.ts`
- Create: `server/types/oauth-authorization.schema.ts`
- Create: `server/types/oauth-provider.types.ts`
- Modify: `server/types/user.schema.ts`

- [ ] **Step 1: 创建 OAuth Scope 和常量定义**

```typescript
// server/types/oauth-provider.types.ts

export const OAUTH_SCOPES = {
  "profile:read": "读取基础档案（UUID、游戏 ID、皮肤、披风）",
  "profile:write": "修改材质（上传/删除皮肤和披风）",
  "email:read": "读取邮箱地址",
  "account:read": "读取账户信息（注册时间、封禁状态等）",
} as const;

export type OAuthScope = keyof typeof OAUTH_SCOPES;

export const VALID_SCOPES = Object.keys(OAUTH_SCOPES) as OAuthScope[];

/** Client Credentials 模式允许的 scope */
export const CLIENT_CREDENTIALS_ALLOWED_SCOPES: OAuthScope[] = ["profile:read"];

export type OAuthClientType = "confidential" | "public";

export type OAuthGrantType =
  | "authorization_code"
  | "client_credentials"
  | "refresh_token";

/** 授权码在 Redis 中的数据结构 */
export interface OAuthAuthorizationCodeData {
  clientId: string;
  userId: string;
  scopes: OAuthScope[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: number;
}
```

- [ ] **Step 2: 创建 OAuthAppDocument 类型**

```typescript
// server/types/oauth-app.schema.ts
import type { ObjectId } from "mongodb";
import type { OAuthClientType, OAuthScope } from "./oauth-provider.types";

export interface OAuthAppDocument {
  _id: ObjectId;
  clientId: string;
  clientSecretHash: string | null;
  type: OAuthClientType;
  name: string;
  description: string;
  icon: string | null;
  redirectUris: string[];
  scopes: OAuthScope[];
  ownerId: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 3: 创建 OAuthTokenDocument 类型**

```typescript
// server/types/oauth-token.schema.ts
import type { ObjectId } from "mongodb";
import type { OAuthScope } from "./oauth-provider.types";

export type OAuthTokenType = "access" | "refresh";

export interface OAuthTokenDocument {
  _id: ObjectId;
  tokenHash: string;
  type: OAuthTokenType;
  clientId: string;
  userId: string | null;
  scopes: OAuthScope[];
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  parentTokenHash: string | null;
}
```

- [ ] **Step 4: 创建 OAuthAuthorizationDocument 类型**

```typescript
// server/types/oauth-authorization.schema.ts
import type { ObjectId } from "mongodb";
import type { OAuthScope } from "./oauth-provider.types";

export interface OAuthAuthorizationDocument {
  _id: ObjectId;
  clientId: string;
  userId: string;
  scopes: OAuthScope[];
  grantedAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 5: 在 UserDocument 中添加 isDeveloper 字段**

在 `server/types/user.schema.ts` 的 `UserDocument` 接口中，在 `isAdmin: boolean;` 之后添加：

```typescript
isDeveloper: boolean;
```

- [ ] **Step 6: 提交**

```bash
rtk git add server/types/oauth-app.schema.ts server/types/oauth-token.schema.ts server/types/oauth-authorization.schema.ts server/types/oauth-provider.types.ts server/types/user.schema.ts
rtk git commit -m "feat(oauth-provider): add type definitions for OAuth authorization server"
```

---

## Task 2: OAuth App Repository

**Files:**
- Create: `server/utils/oauth-app.repository.ts`
- Test: `tests/utils/oauth-app.repository.test.ts`

- [ ] **Step 1: 编写 OAuth App Repository 测试**

```typescript
// tests/utils/oauth-app.repository.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockCollection = {
  createIndex: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
  insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: vi.fn().mockResolvedValue(0),
};

vi.stubGlobal("getDb", () => ({
  collection: () => mockCollection,
}));

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return {
    ...mod,
    useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
    createLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
  };
});

let repo: typeof import("../../server/utils/oauth-app.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  repo = await import("../../server/utils/oauth-app.repository");
});

describe("oauth-app.repository", () => {
  describe("ensureOAuthAppIndexes", () => {
    it("should create all required indexes", async () => {
      await repo.ensureOAuthAppIndexes();
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { clientId: 1 },
        { unique: true },
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith({ ownerId: 1 });
      expect(mockCollection.createIndex).toHaveBeenCalledWith({ approved: 1 });
    });
  });

  describe("findOAuthAppByClientId", () => {
    it("should query by clientId", async () => {
      mockCollection.findOne.mockResolvedValue({ clientId: "abc123" });
      const result = await repo.findOAuthAppByClientId("abc123");
      expect(mockCollection.findOne).toHaveBeenCalledWith({
        clientId: "abc123",
      });
      expect(result).toEqual({ clientId: "abc123" });
    });

    it("should return null when not found", async () => {
      mockCollection.findOne.mockResolvedValue(null);
      const result = await repo.findOAuthAppByClientId("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("insertOAuthApp", () => {
    it("should insert a new app document", async () => {
      const doc = {
        clientId: "abc123",
        name: "Test App",
        type: "confidential" as const,
        ownerId: "user-uuid",
      };
      await repo.insertOAuthApp(doc as any);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(doc);
    });
  });

  describe("findOAuthAppsByOwner", () => {
    it("should query by ownerId", async () => {
      const mockArray = [{ clientId: "a" }, { clientId: "b" }];
      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockArray),
      });
      const result = await repo.findOAuthAppsByOwner("user-uuid");
      expect(mockCollection.find).toHaveBeenCalledWith({
        ownerId: "user-uuid",
      });
      expect(result).toEqual(mockArray);
    });
  });

  describe("updateOAuthApp", () => {
    it("should update and return true on success", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
      const result = await repo.updateOAuthApp("abc123", {
        name: "New Name",
      });
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { clientId: "abc123" },
        { $set: { name: "New Name", updatedAt: expect.any(Date) } },
      );
      expect(result).toBe(true);
    });

    it("should return false when no document matched", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 0 });
      const result = await repo.updateOAuthApp("nonexistent", {
        name: "X",
      });
      expect(result).toBe(false);
    });
  });

  describe("deleteOAuthApp", () => {
    it("should delete by clientId", async () => {
      await repo.deleteOAuthApp("abc123");
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({
        clientId: "abc123",
      });
    });
  });

  describe("findAllOAuthApps", () => {
    it("should return all apps without filter", async () => {
      const apps = [{ clientId: "a" }];
      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(apps),
      });
      const result = await repo.findAllOAuthApps();
      expect(mockCollection.find).toHaveBeenCalledWith({});
      expect(result).toEqual(apps);
    });

    it("should filter by approved status", async () => {
      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      });
      await repo.findAllOAuthApps({ approved: true });
      expect(mockCollection.find).toHaveBeenCalledWith({ approved: true });
    });
  });

  describe("approveOAuthApp", () => {
    it("should set approved to true with approver info", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
      const result = await repo.approveOAuthApp("abc123", "admin-uuid");
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { clientId: "abc123" },
        {
          $set: {
            approved: true,
            approvedBy: "admin-uuid",
            approvedAt: expect.any(Date),
            updatedAt: expect.any(Date),
          },
        },
      );
      expect(result).toBe(true);
    });
  });

  describe("revokeOAuthAppApproval", () => {
    it("should set approved to false", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
      const result = await repo.revokeOAuthAppApproval("abc123");
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { clientId: "abc123" },
        {
          $set: {
            approved: false,
            approvedBy: null,
            approvedAt: null,
            updatedAt: expect.any(Date),
          },
        },
      );
      expect(result).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
rtk vitest run tests/utils/oauth-app.repository.test.ts
```

预期：FAIL — 模块不存在。

- [ ] **Step 3: 实现 OAuth App Repository**

```typescript
// server/utils/oauth-app.repository.ts
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

export async function findOAuthAppByClientId(
  clientId: string,
): Promise<OAuthAppDocument | null> {
  return getOAuthAppCollection().findOne({ clientId });
}

export async function findOAuthAppsByOwner(
  ownerId: string,
): Promise<OAuthAppDocument[]> {
  return getOAuthAppCollection().find({ ownerId }).toArray();
}

export async function findAllOAuthApps(
  filter?: { approved?: boolean },
): Promise<OAuthAppDocument[]> {
  const query: Record<string, unknown> = {};
  if (filter?.approved !== undefined) query.approved = filter.approved;
  return getOAuthAppCollection().find(query).toArray();
}

export async function insertOAuthApp(
  doc: Omit<OAuthAppDocument, "_id">,
): Promise<void> {
  await getOAuthAppCollection().insertOne(doc as OAuthAppDocument);
}

export async function updateOAuthApp(
  clientId: string,
  update: Partial<
    Pick<
      OAuthAppDocument,
      "name" | "description" | "icon" | "redirectUris" | "scopes" | "clientSecretHash"
    >
  >,
): Promise<boolean> {
  const result = await getOAuthAppCollection().updateOne(
    { clientId },
    { $set: { ...update, updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function approveOAuthApp(
  clientId: string,
  approvedBy: string,
): Promise<boolean> {
  const now = new Date();
  const result = await getOAuthAppCollection().updateOne(
    { clientId },
    {
      $set: {
        approved: true,
        approvedBy,
        approvedAt: now,
        updatedAt: now,
      },
    },
  );
  return result.modifiedCount > 0;
}

export async function revokeOAuthAppApproval(
  clientId: string,
): Promise<boolean> {
  const result = await getOAuthAppCollection().updateOne(
    { clientId },
    {
      $set: {
        approved: false,
        approvedBy: null,
        approvedAt: null,
        updatedAt: new Date(),
      },
    },
  );
  return result.modifiedCount > 0;
}

export async function deleteOAuthApp(clientId: string): Promise<void> {
  await getOAuthAppCollection().deleteOne({ clientId });
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
rtk vitest run tests/utils/oauth-app.repository.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add server/utils/oauth-app.repository.ts tests/utils/oauth-app.repository.test.ts
rtk git commit -m "feat(oauth-provider): add OAuth app repository with tests"
```

---

## Task 3: OAuth Token Repository

**Files:**
- Create: `server/utils/oauth-token.repository.ts`
- Test: `tests/utils/oauth-token.repository.test.ts`

- [ ] **Step 1: 编写 OAuth Token Repository 测试**

```typescript
// tests/utils/oauth-token.repository.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCollection = {
  createIndex: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
  insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
};

vi.stubGlobal("getDb", () => ({
  collection: () => mockCollection,
}));

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return {
    ...mod,
    useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
    createLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
  };
});

let repo: typeof import("../../server/utils/oauth-token.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  repo = await import("../../server/utils/oauth-token.repository");
});

describe("oauth-token.repository", () => {
  describe("ensureOAuthTokenIndexes", () => {
    it("should create all required indexes", async () => {
      await repo.ensureOAuthTokenIndexes();
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { tokenHash: 1 },
        { unique: true },
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith({
        clientId: 1,
        userId: 1,
      });
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 },
      );
    });
  });

  describe("findOAuthTokenByHash", () => {
    it("should find active token by hash", async () => {
      const token = { tokenHash: "abc", revokedAt: null };
      mockCollection.findOne.mockResolvedValue(token);
      const result = await repo.findOAuthTokenByHash("abc");
      expect(mockCollection.findOne).toHaveBeenCalledWith({
        tokenHash: "abc",
        revokedAt: null,
      });
      expect(result).toEqual(token);
    });
  });

  describe("findOAuthTokenByHashIncludingRevoked", () => {
    it("should find token regardless of revoked status", async () => {
      const token = { tokenHash: "abc", revokedAt: new Date() };
      mockCollection.findOne.mockResolvedValue(token);
      const result = await repo.findOAuthTokenByHashIncludingRevoked("abc");
      expect(mockCollection.findOne).toHaveBeenCalledWith({
        tokenHash: "abc",
      });
      expect(result).toEqual(token);
    });
  });

  describe("insertOAuthToken", () => {
    it("should insert a token document", async () => {
      const doc = { tokenHash: "abc", type: "access" as const };
      await repo.insertOAuthToken(doc as any);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(doc);
    });
  });

  describe("revokeOAuthToken", () => {
    it("should set revokedAt on matching token", async () => {
      await repo.revokeOAuthToken("abc");
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { tokenHash: "abc", revokedAt: null },
        { $set: { revokedAt: expect.any(Date) } },
      );
    });
  });

  describe("revokeAllOAuthTokensForUserAndClient", () => {
    it("should revoke all tokens for user+client pair", async () => {
      await repo.revokeAllOAuthTokensForUserAndClient("cid", "uid");
      expect(mockCollection.updateMany).toHaveBeenCalledWith(
        { clientId: "cid", userId: "uid", revokedAt: null },
        { $set: { revokedAt: expect.any(Date) } },
      );
    });
  });

  describe("revokeAllOAuthTokensForClient", () => {
    it("should revoke all tokens for a client", async () => {
      await repo.revokeAllOAuthTokensForClient("cid");
      expect(mockCollection.updateMany).toHaveBeenCalledWith(
        { clientId: "cid", revokedAt: null },
        { $set: { revokedAt: expect.any(Date) } },
      );
    });
  });

  describe("deleteAllOAuthTokensForClient", () => {
    it("should delete all tokens for a client", async () => {
      await repo.deleteAllOAuthTokensForClient("cid");
      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        clientId: "cid",
      });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
rtk vitest run tests/utils/oauth-token.repository.test.ts
```

预期：FAIL — 模块不存在。

- [ ] **Step 3: 实现 OAuth Token Repository**

```typescript
// server/utils/oauth-token.repository.ts
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

export async function findOAuthTokenByHash(
  tokenHash: string,
): Promise<OAuthTokenDocument | null> {
  return getOAuthTokenCollection().findOne({ tokenHash, revokedAt: null });
}

export async function findOAuthTokenByHashIncludingRevoked(
  tokenHash: string,
): Promise<OAuthTokenDocument | null> {
  return getOAuthTokenCollection().findOne({ tokenHash });
}

export async function insertOAuthToken(
  doc: Omit<OAuthTokenDocument, "_id">,
): Promise<void> {
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

export async function revokeAllOAuthTokensForClient(
  clientId: string,
): Promise<void> {
  await getOAuthTokenCollection().updateMany(
    { clientId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function deleteAllOAuthTokensForClient(
  clientId: string,
): Promise<void> {
  await getOAuthTokenCollection().deleteMany({ clientId });
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
rtk vitest run tests/utils/oauth-token.repository.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add server/utils/oauth-token.repository.ts tests/utils/oauth-token.repository.test.ts
rtk git commit -m "feat(oauth-provider): add OAuth token repository with tests"
```

---

## Task 4: OAuth Authorization Repository

**Files:**
- Create: `server/utils/oauth-authorization.repository.ts`
- Test: `tests/utils/oauth-authorization.repository.test.ts`

- [ ] **Step 1: 编写 OAuth Authorization Repository 测试**

```typescript
// tests/utils/oauth-authorization.repository.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCollection = {
  createIndex: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
};

vi.stubGlobal("getDb", () => ({
  collection: () => mockCollection,
}));

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return {
    ...mod,
    useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
    createLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
  };
});

let repo: typeof import("../../server/utils/oauth-authorization.repository");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  repo = await import("../../server/utils/oauth-authorization.repository");
});

describe("oauth-authorization.repository", () => {
  describe("ensureOAuthAuthorizationIndexes", () => {
    it("should create all required indexes", async () => {
      await repo.ensureOAuthAuthorizationIndexes();
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { clientId: 1, userId: 1 },
        { unique: true },
      );
      expect(mockCollection.createIndex).toHaveBeenCalledWith({ userId: 1 });
    });
  });

  describe("findOAuthAuthorization", () => {
    it("should find by clientId and userId", async () => {
      const auth = { clientId: "cid", userId: "uid", scopes: ["profile:read"] };
      mockCollection.findOne.mockResolvedValue(auth);
      const result = await repo.findOAuthAuthorization("cid", "uid");
      expect(mockCollection.findOne).toHaveBeenCalledWith({
        clientId: "cid",
        userId: "uid",
      });
      expect(result).toEqual(auth);
    });
  });

  describe("upsertOAuthAuthorization", () => {
    it("should upsert authorization with scopes", async () => {
      await repo.upsertOAuthAuthorization("cid", "uid", ["profile:read"]);
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { clientId: "cid", userId: "uid" },
        {
          $set: { scopes: ["profile:read"], updatedAt: expect.any(Date) },
          $setOnInsert: { grantedAt: expect.any(Date) },
        },
        { upsert: true },
      );
    });
  });

  describe("findOAuthAuthorizationsByUser", () => {
    it("should find all authorizations for a user", async () => {
      const auths = [{ clientId: "a" }, { clientId: "b" }];
      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(auths),
      });
      const result = await repo.findOAuthAuthorizationsByUser("uid");
      expect(mockCollection.find).toHaveBeenCalledWith({ userId: "uid" });
      expect(result).toEqual(auths);
    });
  });

  describe("deleteOAuthAuthorization", () => {
    it("should delete by clientId and userId", async () => {
      await repo.deleteOAuthAuthorization("cid", "uid");
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({
        clientId: "cid",
        userId: "uid",
      });
    });
  });

  describe("deleteAllOAuthAuthorizationsForClient", () => {
    it("should delete all authorizations for a client", async () => {
      await repo.deleteAllOAuthAuthorizationsForClient("cid");
      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        clientId: "cid",
      });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
rtk vitest run tests/utils/oauth-authorization.repository.test.ts
```

预期：FAIL — 模块不存在。

- [ ] **Step 3: 实现 OAuth Authorization Repository**

```typescript
// server/utils/oauth-authorization.repository.ts
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

export async function findOAuthAuthorization(
  clientId: string,
  userId: string,
): Promise<OAuthAuthorizationDocument | null> {
  return getOAuthAuthorizationCollection().findOne({ clientId, userId });
}

export async function upsertOAuthAuthorization(
  clientId: string,
  userId: string,
  scopes: OAuthScope[],
): Promise<void> {
  const now = new Date();
  await getOAuthAuthorizationCollection().updateOne(
    { clientId, userId },
    {
      $set: { scopes, updatedAt: now },
      $setOnInsert: { grantedAt: now },
    },
    { upsert: true },
  );
}

export async function findOAuthAuthorizationsByUser(
  userId: string,
): Promise<OAuthAuthorizationDocument[]> {
  return getOAuthAuthorizationCollection().find({ userId }).toArray();
}

export async function deleteOAuthAuthorization(
  clientId: string,
  userId: string,
): Promise<void> {
  await getOAuthAuthorizationCollection().deleteOne({ clientId, userId });
}

export async function deleteAllOAuthAuthorizationsForClient(
  clientId: string,
): Promise<void> {
  await getOAuthAuthorizationCollection().deleteMany({ clientId });
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
rtk vitest run tests/utils/oauth-authorization.repository.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add server/utils/oauth-authorization.repository.ts tests/utils/oauth-authorization.repository.test.ts
rtk git commit -m "feat(oauth-provider): add OAuth authorization repository with tests"
```

---

## Task 5: User isDeveloper 扩展 + Settings + 启动集成

**Files:**
- Modify: `server/utils/user.repository.ts`
- Modify: `server/utils/settings.repository.ts`
- Modify: `server/plugins/server-startup.ts`
- Modify: `server/middleware/01.session.ts`
- Create: `server/utils/require-developer.ts`

- [ ] **Step 1: 在 user.repository.ts 中添加 setDeveloperStatus 函数**

在 `server/utils/user.repository.ts` 文件末尾添加：

```typescript
export async function setDeveloperStatus(
  uuid: string,
  isDeveloper: boolean,
): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid },
    { $set: { isDeveloper } },
  );
  return result.modifiedCount > 0;
}
```

- [ ] **Step 2: 在 insertUser 函数中添加 isDeveloper 默认值**

在 `server/utils/user.repository.ts` 的 `insertUser` 函数中，插入文档对象里 `isAdmin` 之后添加 `isDeveloper: false`。

- [ ] **Step 3: 在 session 中间件中添加 isDeveloper**

在 `server/middleware/01.session.ts` 中，找到从数据库查询用户并构建 `event.context.user` 的部分。在 projection 中添加 `isDeveloper: 1`，在组装 `event.context.user` 时添加 `isDeveloper: dbUser.isDeveloper ?? false`。

- [ ] **Step 4: 创建 requireDeveloper 工具函数**

```typescript
// server/utils/require-developer.ts
import type { H3Event } from "h3";

export function requireDeveloper(event: H3Event) {
  const user = requireAuth(event);
  if (!user.isDeveloper && !user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Developer access required" });
  }
  return user;
}
```

注意：管理员天然具有开发者权限。

- [ ] **Step 5: 在 settings.repository.ts 的 BUILTIN_SETTINGS 中添加 OAuth 配置项**

在 `server/utils/settings.repository.ts` 的 `BUILTIN_SETTINGS` 对象中添加：

```typescript
"oauth.enabled": false,
"oauth.accessTokenTtlMs": 3600000,
"oauth.refreshTokenTtlMs": 2592000000,
"oauth.authorizationCodeTtlS": 60,
```

- [ ] **Step 6: 在 server-startup.ts 中集成 OAuth 索引初始化**

在 `server/plugins/server-startup.ts` 的 `initIndexes` 阶段（`Promise.all` 块）中添加：

```typescript
ensureOAuthAppIndexes(),
ensureOAuthTokenIndexes(),
ensureOAuthAuthorizationIndexes(),
```

这三个函数由 Nitro 自动导入，无需手动 import。

- [ ] **Step 7: 提交**

```bash
rtk git add server/utils/user.repository.ts server/utils/require-developer.ts server/utils/settings.repository.ts server/plugins/server-startup.ts server/middleware/01.session.ts
rtk git commit -m "feat(oauth-provider): integrate isDeveloper, settings, and index initialization"
```

---

## Task 6: OAuth Provider 核心服务

**Files:**
- Create: `server/utils/oauth-provider.service.ts`
- Test: `tests/utils/oauth-provider.service.test.ts`

- [ ] **Step 1: 编写核心服务测试**

```typescript
// tests/utils/oauth-provider.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";

// Mock Redis
const mockRedis = {
  send: vi.fn(),
};
vi.stubGlobal("getRedisClient", () => mockRedis);
vi.stubGlobal("buildRedisKey", (...args: string[]) => `irmin:${args.join(":")}`);

// Mock settings
vi.stubGlobal("getSetting", (key: string) => {
  const settings: Record<string, unknown> = {
    "oauth.enabled": true,
    "oauth.accessTokenTtlMs": 3600000,
    "oauth.refreshTokenTtlMs": 2592000000,
    "oauth.authorizationCodeTtlS": 60,
  };
  return settings[key];
});

// Mock repositories
vi.stubGlobal("findOAuthTokenByHash", vi.fn());
vi.stubGlobal("findOAuthTokenByHashIncludingRevoked", vi.fn());
vi.stubGlobal("insertOAuthToken", vi.fn());
vi.stubGlobal("revokeOAuthToken", vi.fn());
vi.stubGlobal("revokeAllOAuthTokensForUserAndClient", vi.fn());
vi.stubGlobal("findOAuthAppByClientId", vi.fn());

// Mock Bun.password
vi.stubGlobal("Bun", {
  password: {
    hash: vi.fn().mockResolvedValue("hashed"),
    verify: vi.fn().mockResolvedValue(true),
  },
});

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return {
    ...mod,
    useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
    createLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
  };
});

let service: typeof import("../../server/utils/oauth-provider.service");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  service = await import("../../server/utils/oauth-provider.service");
});

describe("oauth-provider.service", () => {
  describe("generateClientId", () => {
    it("should return a 32-character hex string", () => {
      const id = service.generateClientId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("should be unique on consecutive calls", () => {
      const a = service.generateClientId();
      const b = service.generateClientId();
      expect(a).not.toBe(b);
    });
  });

  describe("generateClientSecret", () => {
    it("should return a 48-character base64url string", () => {
      const secret = service.generateClientSecret();
      expect(secret).toMatch(/^[A-Za-z0-9_-]{48}$/);
    });
  });

  describe("generateOpaqueToken", () => {
    it("should return a 43-character base64url string", () => {
      const token = service.generateOpaqueToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe("hashToken", () => {
    it("should return SHA-256 hex digest", () => {
      const hash = service.hashToken("test-token");
      const expected = createHash("sha256").update("test-token").digest("hex");
      expect(hash).toBe(expected);
    });
  });

  describe("verifyPkce", () => {
    it("should return true for valid S256 challenge", () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      expect(service.verifyPkce(verifier, challenge)).toBe(true);
    });

    it("should return false for invalid verifier", () => {
      expect(service.verifyPkce("wrong", "challenge")).toBe(false);
    });
  });

  describe("storeAuthorizationCode / consumeAuthorizationCode", () => {
    it("should store code data in Redis with TTL", async () => {
      mockRedis.send.mockResolvedValue("OK");
      const data = {
        clientId: "cid",
        userId: "uid",
        scopes: ["profile:read" as const],
        redirectUri: "http://localhost/callback",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256" as const,
        createdAt: Date.now(),
      };
      await service.storeAuthorizationCode("code123", data);
      expect(mockRedis.send).toHaveBeenCalledWith("SET", [
        expect.stringContaining("oauth:code:"),
        JSON.stringify(data),
        "EX",
        "60",
      ]);
    });

    it("should consume code data from Redis (GETDEL)", async () => {
      const data = { clientId: "cid", userId: "uid" };
      mockRedis.send.mockResolvedValue(JSON.stringify(data));
      const result = await service.consumeAuthorizationCode("code123");
      expect(mockRedis.send).toHaveBeenCalledWith("GETDEL", [
        expect.stringContaining("oauth:code:"),
      ]);
      expect(result).toEqual(data);
    });

    it("should return null when code not found", async () => {
      mockRedis.send.mockResolvedValue(null);
      const result = await service.consumeAuthorizationCode("expired");
      expect(result).toBeNull();
    });
  });

  describe("authenticateClient", () => {
    it("should authenticate confidential client with valid secret", async () => {
      const mockApp = {
        clientId: "cid",
        type: "confidential",
        clientSecretHash: "hashed-secret",
        approved: true,
      };
      vi.mocked(findOAuthAppByClientId).mockResolvedValue(mockApp as any);
      vi.mocked(Bun.password.verify).mockResolvedValue(true);

      const result = await service.authenticateClient("cid", "secret");
      expect(result).toEqual(mockApp);
    });

    it("should throw for unknown client", async () => {
      vi.mocked(findOAuthAppByClientId).mockResolvedValue(null);
      await expect(service.authenticateClient("bad", "secret")).rejects.toThrow();
    });

    it("should throw for unapproved client", async () => {
      vi.mocked(findOAuthAppByClientId).mockResolvedValue({
        clientId: "cid",
        approved: false,
      } as any);
      await expect(service.authenticateClient("cid", "secret")).rejects.toThrow();
    });

    it("should authenticate public client without secret", async () => {
      const mockApp = {
        clientId: "cid",
        type: "public",
        clientSecretHash: null,
        approved: true,
      };
      vi.mocked(findOAuthAppByClientId).mockResolvedValue(mockApp as any);
      const result = await service.authenticateClient("cid", undefined);
      expect(result).toEqual(mockApp);
    });

    it("should throw when public client provides secret", async () => {
      vi.mocked(findOAuthAppByClientId).mockResolvedValue({
        clientId: "cid",
        type: "public",
        approved: true,
      } as any);
      await expect(
        service.authenticateClient("cid", "should-not-have"),
      ).rejects.toThrow();
    });
  });

  describe("issueTokenPair", () => {
    it("should create access and refresh tokens", async () => {
      vi.mocked(insertOAuthToken).mockResolvedValue(undefined);
      const result = await service.issueTokenPair({
        clientId: "cid",
        userId: "uid",
        scopes: ["profile:read"],
      });
      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");
      expect(result).toHaveProperty("expiresIn");
      expect(result.tokenType).toBe("Bearer");
      expect(insertOAuthToken).toHaveBeenCalledTimes(2);
    });

    it("should omit refresh token when skipRefreshToken is true", async () => {
      vi.mocked(insertOAuthToken).mockResolvedValue(undefined);
      const result = await service.issueTokenPair({
        clientId: "cid",
        userId: null,
        scopes: ["profile:read"],
        skipRefreshToken: true,
      });
      expect(result.refreshToken).toBeUndefined();
      expect(insertOAuthToken).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
rtk vitest run tests/utils/oauth-provider.service.test.ts
```

预期：FAIL — 模块不存在。

- [ ] **Step 3: 实现 OAuth Provider 核心服务**

```typescript
// server/utils/oauth-provider.service.ts
import { createHash, randomBytes } from "node:crypto";
import type { OAuthAuthorizationCodeData, OAuthScope } from "../types/oauth-provider.types";
import type { OAuthAppDocument } from "../types/oauth-app.schema";

// ─── 生成器 ───

export function generateClientId(): string {
  return randomBytes(16).toString("hex");
}

export function generateClientSecret(): string {
  return randomBytes(36).toString("base64url");
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── PKCE ───

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

// ─── 授权码（Redis） ───

export async function storeAuthorizationCode(
  code: string,
  data: OAuthAuthorizationCodeData,
): Promise<void> {
  const key = buildRedisKey("oauth", "code", hashToken(code));
  const ttl = (getSetting("oauth.authorizationCodeTtlS") as number) || 60;
  const redis = getRedisClient();
  await redis.send("SET", [key, JSON.stringify(data), "EX", ttl.toString()]);
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<OAuthAuthorizationCodeData | null> {
  const key = buildRedisKey("oauth", "code", hashToken(code));
  const redis = getRedisClient();
  const raw = await redis.send("GETDEL", [key]);
  if (!raw) return null;
  return JSON.parse(raw as string);
}

// ─── 客户端认证 ───

export class OAuthError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly errorDescription: string,
    public readonly statusCode: number = 400,
  ) {
    super(errorDescription);
  }
}

export async function authenticateClient(
  clientId: string,
  clientSecret: string | undefined,
): Promise<OAuthAppDocument> {
  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw new OAuthError("invalid_client", "Unknown client", 401);
  }
  if (!app.approved) {
    throw new OAuthError("invalid_client", "Client not approved", 401);
  }

  if (app.type === "confidential") {
    if (!clientSecret) {
      throw new OAuthError("invalid_client", "Client secret required", 401);
    }
    const valid = await Bun.password.verify(clientSecret, app.clientSecretHash!);
    if (!valid) {
      throw new OAuthError("invalid_client", "Invalid client secret", 401);
    }
  } else {
    // public client 不应提供 secret
    if (clientSecret) {
      throw new OAuthError(
        "invalid_client",
        "Public clients must not send client_secret",
        400,
      );
    }
  }

  return app;
}

// ─── Token 颁发 ───

export interface IssueTokenParams {
  clientId: string;
  userId: string | null;
  scopes: OAuthScope[];
  skipRefreshToken?: boolean;
  parentRefreshTokenHash?: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string;
}

export async function issueTokenPair(
  params: IssueTokenParams,
): Promise<TokenResponse> {
  const accessTokenTtlMs =
    (getSetting("oauth.accessTokenTtlMs") as number) || 3600000;
  const refreshTokenTtlMs =
    (getSetting("oauth.refreshTokenTtlMs") as number) || 2592000000;

  const now = new Date();
  const accessToken = generateOpaqueToken();
  const accessTokenHash = hashToken(accessToken);

  await insertOAuthToken({
    tokenHash: accessTokenHash,
    type: "access",
    clientId: params.clientId,
    userId: params.userId,
    scopes: params.scopes,
    expiresAt: new Date(now.getTime() + accessTokenTtlMs),
    createdAt: now,
    revokedAt: null,
    parentTokenHash: null,
  });

  const result: TokenResponse = {
    accessToken,
    tokenType: "Bearer",
    expiresIn: Math.floor(accessTokenTtlMs / 1000),
    scope: params.scopes.join(" "),
  };

  if (!params.skipRefreshToken) {
    const refreshToken = generateOpaqueToken();
    const refreshTokenHash = hashToken(refreshToken);

    await insertOAuthToken({
      tokenHash: refreshTokenHash,
      type: "refresh",
      clientId: params.clientId,
      userId: params.userId,
      scopes: params.scopes,
      expiresAt: new Date(now.getTime() + refreshTokenTtlMs),
      createdAt: now,
      revokedAt: null,
      parentTokenHash: params.parentRefreshTokenHash ?? null,
    });

    result.refreshToken = refreshToken;
  }

  return result;
}

// ─── Token 验证 ───

export async function validateBearerToken(
  authorization: string | undefined,
  requiredScopes: OAuthScope[],
): Promise<{ userId: string | null; scopes: OAuthScope[]; clientId: string }> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new OAuthError("invalid_token", "Missing or invalid bearer token", 401);
  }

  const token = authorization.slice(7);
  const tokenDoc = await findOAuthTokenByHash(hashToken(token));

  if (!tokenDoc || tokenDoc.type !== "access") {
    throw new OAuthError("invalid_token", "Invalid or expired token", 401);
  }

  if (tokenDoc.expiresAt < new Date()) {
    throw new OAuthError("invalid_token", "Token expired", 401);
  }

  for (const scope of requiredScopes) {
    if (!tokenDoc.scopes.includes(scope)) {
      throw new OAuthError("insufficient_scope", `Missing scope: ${scope}`, 403);
    }
  }

  return {
    userId: tokenDoc.userId,
    scopes: tokenDoc.scopes as OAuthScope[],
    clientId: tokenDoc.clientId,
  };
}

// ─── Refresh Token Rotation ───

export async function refreshAccessToken(
  refreshTokenRaw: string,
  clientId: string,
): Promise<TokenResponse> {
  const refreshTokenHash = hashToken(refreshTokenRaw);

  // 先检查是否是已撤销的 token（重放攻击检测）
  const tokenDoc = await findOAuthTokenByHashIncludingRevoked(refreshTokenHash);

  if (!tokenDoc || tokenDoc.type !== "refresh") {
    throw new OAuthError("invalid_grant", "Invalid refresh token", 400);
  }

  if (tokenDoc.clientId !== clientId) {
    throw new OAuthError("invalid_grant", "Token does not belong to this client", 400);
  }

  // 重放攻击：已撤销的 refresh token 被再次使用
  if (tokenDoc.revokedAt) {
    // 撤销该用户+客户端的所有 token
    if (tokenDoc.userId) {
      await revokeAllOAuthTokensForUserAndClient(clientId, tokenDoc.userId);
    }
    throw new OAuthError("invalid_grant", "Refresh token has been revoked", 400);
  }

  if (tokenDoc.expiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Refresh token expired", 400);
  }

  // 撤销旧 refresh token
  await revokeOAuthToken(refreshTokenHash);

  // 颁发新 token 对
  return issueTokenPair({
    clientId: tokenDoc.clientId,
    userId: tokenDoc.userId,
    scopes: tokenDoc.scopes as OAuthScope[],
    parentRefreshTokenHash: refreshTokenHash,
  });
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
rtk vitest run tests/utils/oauth-provider.service.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add server/utils/oauth-provider.service.ts tests/utils/oauth-provider.service.test.ts
rtk git commit -m "feat(oauth-provider): add core OAuth service with PKCE, token lifecycle, and client auth"
```

---

## Task 7: Bearer Token 中间件

**Files:**
- Create: `server/utils/require-oauth-bearer.ts`

- [ ] **Step 1: 实现 Bearer Token 解析工具**

```typescript
// server/utils/require-oauth-bearer.ts
import type { H3Event } from "h3";
import type { OAuthScope } from "../types/oauth-provider.types";

/**
 * 从 Authorization header 解析并验证 OAuth Bearer token。
 * 返回 token 中的 userId、scopes 和 clientId。
 */
export async function requireOAuthBearer(
  event: H3Event,
  requiredScopes: OAuthScope[],
) {
  const authorization = getHeader(event, "authorization");
  return validateBearerToken(authorization, requiredScopes);
}
```

- [ ] **Step 2: 提交**

```bash
rtk git add server/utils/require-oauth-bearer.ts
rtk git commit -m "feat(oauth-provider): add requireOAuthBearer helper"
```

---

## Task 8: 授权端点（GET + POST）

**Files:**
- Create: `server/api/oauth-provider/authorize.get.ts`
- Create: `server/api/oauth-provider/authorize.post.ts`

- [ ] **Step 1: 实现 GET /api/oauth-provider/authorize**

此端点检查参数合法性，判断是否需要用户确认：
- 已授权相同 scope → 静默生成授权码，重定向回 `redirect_uri`
- 未授权 → 重定向到前端确认页 `/oauth/authorize`

```typescript
// server/api/oauth-provider/authorize.get.ts
export default defineEventHandler(async (event) => {
  // 检查 OAuth 是否启用
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  const query = getQuery(event);
  const responseType = query.response_type as string;
  const clientId = query.client_id as string;
  const redirectUri = query.redirect_uri as string;
  const scope = query.scope as string;
  const state = query.state as string | undefined;
  const codeChallenge = query.code_challenge as string | undefined;
  const codeChallengeMethod = query.code_challenge_method as string | undefined;

  // 验证 response_type
  if (responseType !== "code") {
    throw createError({ statusCode: 400, statusMessage: "Unsupported response_type" });
  }

  // 验证 client_id
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing client_id" });
  }

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 400, statusMessage: "Unknown client_id" });
  }
  if (!app.approved) {
    throw createError({ statusCode: 400, statusMessage: "Application not approved" });
  }

  // 验证 redirect_uri（必须严格匹配注册列表中的某一项）
  if (!redirectUri || !app.redirectUris.includes(redirectUri)) {
    // redirect_uri 不合法时，不能重定向，直接报错
    throw createError({ statusCode: 400, statusMessage: "Invalid redirect_uri" });
  }

  // 验证 scope
  const requestedScopes = scope ? scope.split(" ") : [];
  const invalidScopes = requestedScopes.filter((s) => !app.scopes.includes(s as any));
  if (invalidScopes.length > 0) {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "invalid_scope", "Requested scope exceeds application scope", state),
    );
  }
  if (requestedScopes.length === 0) {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "invalid_scope", "No scope requested", state),
    );
  }

  // 公开客户端强制 PKCE
  if (app.type === "public" && !codeChallenge) {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "invalid_request", "PKCE required for public clients", state),
    );
  }
  if (codeChallenge && codeChallengeMethod !== "S256") {
    return sendRedirect(
      event,
      buildOAuthRedirectError(redirectUri, "invalid_request", "Only S256 code_challenge_method is supported", state),
    );
  }

  // 需要用户登录
  const user = event.context.user;
  if (!user) {
    // 重定向到登录页，带 redirect 参数
    const currentUrl = getRequestURL(event);
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(currentUrl.pathname + currentUrl.search)}`);
  }

  // 检查静默授权：用户是否已授权过相同或更大范围的 scope
  const existingAuth = await findOAuthAuthorization(clientId, user.userId);
  const scopesAlreadyGranted =
    existingAuth && requestedScopes.every((s) => existingAuth.scopes.includes(s as any));

  if (scopesAlreadyGranted) {
    // 静默授权：直接生成授权码
    const code = generateOpaqueToken();
    await storeAuthorizationCode(code, {
      clientId,
      userId: user.userId,
      scopes: requestedScopes as any,
      redirectUri,
      codeChallenge: codeChallenge || "",
      codeChallengeMethod: "S256",
      createdAt: Date.now(),
    });
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return sendRedirect(event, url.toString());
  }

  // 需要用户确认：重定向到确认页
  const confirmUrl = new URL("/oauth/authorize", getRequestURL(event).origin);
  confirmUrl.searchParams.set("client_id", clientId);
  confirmUrl.searchParams.set("redirect_uri", redirectUri);
  confirmUrl.searchParams.set("scope", scope);
  if (state) confirmUrl.searchParams.set("state", state);
  if (codeChallenge) confirmUrl.searchParams.set("code_challenge", codeChallenge);
  if (codeChallengeMethod) confirmUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
  confirmUrl.searchParams.set("response_type", "code");
  return sendRedirect(event, confirmUrl.toString());
});

/** 构建 OAuth 错误重定向 URL */
function buildOAuthRedirectError(
  redirectUri: string,
  error: string,
  description: string,
  state?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
```

- [ ] **Step 2: 实现 POST /api/oauth-provider/authorize**

用户在确认页点击「授权」后调用此端点。

```typescript
// server/api/oauth-provider/authorize.post.ts
import { z } from "zod";

export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  const user = requireAuth(event);
  const body = await readBody(event);

  const schema = z.object({
    client_id: z.string(),
    redirect_uri: z.string().url(),
    scope: z.string(),
    state: z.string().optional(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.literal("S256").optional(),
    action: z.enum(["approve", "deny"]),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request" });
  }

  const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, action } = parsed.data;

  // 验证应用
  const app = await findOAuthAppByClientId(client_id);
  if (!app || !app.approved) {
    throw createError({ statusCode: 400, statusMessage: "Invalid application" });
  }
  if (!app.redirectUris.includes(redirect_uri)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid redirect_uri" });
  }

  const requestedScopes = scope.split(" ");

  // 用户拒绝
  if (action === "deny") {
    const url = new URL(redirect_uri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "User denied the request");
    if (state) url.searchParams.set("state", state);
    return { redirect: url.toString() };
  }

  // 用户授权
  const code = generateOpaqueToken();
  await storeAuthorizationCode(code, {
    clientId: client_id,
    userId: user.userId,
    scopes: requestedScopes as any,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge || "",
    codeChallengeMethod: "S256",
    createdAt: Date.now(),
  });

  // 保存授权记录（用于后续静默授权）
  await upsertOAuthAuthorization(client_id, user.userId, requestedScopes as any);

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return { redirect: url.toString() };
});
```

- [ ] **Step 3: 提交**

```bash
rtk git add server/api/oauth-provider/authorize.get.ts server/api/oauth-provider/authorize.post.ts
rtk git commit -m "feat(oauth-provider): add authorization endpoints (GET + POST)"
```

---

## Task 9: Token 端点

**Files:**
- Create: `server/api/oauth-provider/token.post.ts`

- [ ] **Step 1: 实现 POST /api/oauth-provider/token**

支持三种 grant_type：`authorization_code`、`client_credentials`、`refresh_token`。

```typescript
// server/api/oauth-provider/token.post.ts
import type { OAuthScope } from "../../types/oauth-provider.types";
import { CLIENT_CREDENTIALS_ALLOWED_SCOPES } from "../../types/oauth-provider.types";

export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  // 设置 CORS
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Pragma", "no-cache");

  const body = await readBody(event);
  const grantType = body?.grant_type;

  try {
    if (grantType === "authorization_code") {
      return await handleAuthorizationCode(body);
    } else if (grantType === "client_credentials") {
      return await handleClientCredentials(body);
    } else if (grantType === "refresh_token") {
      return await handleRefreshToken(body);
    } else {
      throw new OAuthError("unsupported_grant_type", "Unsupported grant_type", 400);
    }
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }
});

async function handleAuthorizationCode(body: any) {
  const code = body.code;
  const redirectUri = body.redirect_uri;
  const clientId = body.client_id;
  const clientSecret = body.client_secret;
  const codeVerifier = body.code_verifier;

  if (!code || !redirectUri || !clientId) {
    throw new OAuthError("invalid_request", "Missing required parameters");
  }

  // 认证客户端
  const app = await authenticateClient(clientId, clientSecret || undefined);

  // 消费授权码
  const codeData = await consumeAuthorizationCode(code);
  if (!codeData) {
    throw new OAuthError("invalid_grant", "Invalid or expired authorization code");
  }

  // 验证参数匹配
  if (codeData.clientId !== clientId) {
    throw new OAuthError("invalid_grant", "Code was not issued to this client");
  }
  if (codeData.redirectUri !== redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  }

  // 验证 PKCE
  if (codeData.codeChallenge) {
    if (!codeVerifier) {
      throw new OAuthError("invalid_grant", "Missing code_verifier");
    }
    if (!verifyPkce(codeVerifier, codeData.codeChallenge)) {
      throw new OAuthError("invalid_grant", "Invalid code_verifier");
    }
  } else if (app.type === "public") {
    throw new OAuthError("invalid_grant", "PKCE required for public clients");
  }

  // 颁发 token
  const tokenResponse = await issueTokenPair({
    clientId,
    userId: codeData.userId,
    scopes: codeData.scopes,
  });

  return {
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    refresh_token: tokenResponse.refreshToken,
    scope: tokenResponse.scope,
  };
}

async function handleClientCredentials(body: any) {
  const clientId = body.client_id;
  const clientSecret = body.client_secret;
  const scope = body.scope;

  if (!clientId || !clientSecret) {
    throw new OAuthError("invalid_request", "Missing client_id or client_secret");
  }

  const app = await authenticateClient(clientId, clientSecret);

  if (app.type !== "confidential") {
    throw new OAuthError("unauthorized_client", "Only confidential clients can use client_credentials");
  }

  // 验证 scope（仅允许 profile:read）
  const requestedScopes = scope ? scope.split(" ") : ["profile:read"];
  for (const s of requestedScopes) {
    if (!CLIENT_CREDENTIALS_ALLOWED_SCOPES.includes(s as OAuthScope)) {
      throw new OAuthError("invalid_scope", `Scope '${s}' not allowed for client_credentials`);
    }
  }

  const tokenResponse = await issueTokenPair({
    clientId,
    userId: null,
    scopes: requestedScopes as OAuthScope[],
    skipRefreshToken: true,
  });

  return {
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    scope: tokenResponse.scope,
  };
}

async function handleRefreshToken(body: any) {
  const refreshToken = body.refresh_token;
  const clientId = body.client_id;
  const clientSecret = body.client_secret;

  if (!refreshToken || !clientId) {
    throw new OAuthError("invalid_request", "Missing refresh_token or client_id");
  }

  // 认证客户端
  await authenticateClient(clientId, clientSecret || undefined);

  // Refresh token rotation
  const tokenResponse = await refreshAccessToken(refreshToken, clientId);

  return {
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    refresh_token: tokenResponse.refreshToken,
    scope: tokenResponse.scope,
  };
}
```

- [ ] **Step 2: 提交**

```bash
rtk git add server/api/oauth-provider/token.post.ts
rtk git commit -m "feat(oauth-provider): add token endpoint with authorization_code, client_credentials, refresh_token"
```

---

## Task 10: Revoke + Userinfo + Well-Known 端点

**Files:**
- Create: `server/api/oauth-provider/revoke.post.ts`
- Create: `server/api/oauth-provider/userinfo.get.ts`
- Create: `server/api/oauth-provider/well-known.get.ts`

- [ ] **Step 1: 实现 POST /api/oauth-provider/revoke**

```typescript
// server/api/oauth-provider/revoke.post.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  const body = await readBody(event);
  const token = body?.token;
  const clientId = body?.client_id;
  const clientSecret = body?.client_secret;

  if (!token || !clientId) {
    setResponseStatus(event, 400);
    return { error: "invalid_request", error_description: "Missing token or client_id" };
  }

  try {
    await authenticateClient(clientId, clientSecret || undefined);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  // RFC 7009: 无论 token 是否存在，都返回 200
  const tokenHash = hashToken(token);
  await revokeOAuthToken(tokenHash);

  setResponseStatus(event, 200);
  return {};
});
```

- [ ] **Step 2: 实现 GET /api/oauth-provider/userinfo**

```typescript
// server/api/oauth-provider/userinfo.get.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, []);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      setResponseHeader(event, "WWW-Authenticate", `Bearer error="${err.errorCode}"`);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  if (!tokenInfo.userId) {
    setResponseStatus(event, 403);
    return { error: "invalid_token", error_description: "Client credentials tokens cannot access userinfo" };
  }

  const user = await findUserByUuid(tokenInfo.userId);
  if (!user) {
    setResponseStatus(event, 404);
    return { error: "invalid_token", error_description: "User not found" };
  }

  const scopes = tokenInfo.scopes;
  const result: Record<string, unknown> = {};

  // profile:read
  if (scopes.includes("profile:read")) {
    result.uuid = user.uuid;
    result.gameId = user.gameId;
    result.skin = user.skin;
    result.cape = user.cape;
  }

  // email:read
  if (scopes.includes("email:read")) {
    result.email = user.email;
    result.emailVerified = user.emailVerified;
  }

  // account:read
  if (scopes.includes("account:read")) {
    result.registeredAt = user.time.register;
    result.hasBan = hasActiveBan(user.bans);
  }

  return result;
});
```

- [ ] **Step 3: 实现 GET /api/oauth-provider/well-known**

```typescript
// server/api/oauth-provider/well-known.get.ts
export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const baseUrl = config.yggdrasilBaseUrl || "";

  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth-provider/authorize`,
    token_endpoint: `${baseUrl}/api/oauth-provider/token`,
    revocation_endpoint: `${baseUrl}/api/oauth-provider/revoke`,
    userinfo_endpoint: `${baseUrl}/api/oauth-provider/userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["profile:read", "profile:write", "email:read", "account:read"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
  };
});
```

- [ ] **Step 4: 提交**

```bash
rtk git add server/api/oauth-provider/revoke.post.ts server/api/oauth-provider/userinfo.get.ts server/api/oauth-provider/well-known.get.ts
rtk git commit -m "feat(oauth-provider): add revoke, userinfo, and well-known endpoints"
```

---

## Task 11: 开发者应用管理 API

**Files:**
- Create: `server/api/oauth-provider/apps/index.get.ts`
- Create: `server/api/oauth-provider/apps/index.post.ts`
- Create: `server/api/oauth-provider/apps/[clientId].get.ts`
- Create: `server/api/oauth-provider/apps/[clientId].patch.ts`
- Create: `server/api/oauth-provider/apps/[clientId].delete.ts`
- Create: `server/api/oauth-provider/apps/[clientId]/reset-secret.post.ts`

- [ ] **Step 1: 实现列出应用和创建应用端点**

```typescript
// server/api/oauth-provider/apps/index.get.ts
export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const apps = await findOAuthAppsByOwner(user.userId);
  // 不返回 clientSecretHash
  return apps.map(({ clientSecretHash, ...rest }) => rest);
});
```

```typescript
// server/api/oauth-provider/apps/index.post.ts
import { z } from "zod";
import { VALID_SCOPES } from "../../../types/oauth-provider.types";

export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const body = await readBody(event);

  const schema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(""),
    type: z.enum(["confidential", "public"]),
    redirectUris: z.array(z.string().url()).min(1).max(10),
    scopes: z.array(z.enum(VALID_SCOPES as [string, ...string[]])).min(1),
    icon: z.string().url().nullable().optional().default(null),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: "参数校验失败", details: parsed.error.flatten() };
  }

  const { name, description, type, redirectUris, scopes, icon } = parsed.data;

  const clientId = generateClientId();
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;

  if (type === "confidential") {
    clientSecret = generateClientSecret();
    clientSecretHash = await Bun.password.hash(clientSecret, "argon2id");
  }

  const now = new Date();
  await insertOAuthApp({
    clientId,
    clientSecretHash,
    type,
    name,
    description,
    icon,
    redirectUris,
    scopes: scopes as any,
    ownerId: user.userId,
    approved: false,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    success: true,
    clientId,
    clientSecret, // 仅此一次返回明文
  };
});
```

- [ ] **Step 2: 实现查看、更新、删除应用端点**

```typescript
// server/api/oauth-provider/apps/[clientId].get.ts
export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const clientId = getRouterParam(event, "clientId")!;
  const app = await findOAuthAppByClientId(clientId);

  if (!app || (app.ownerId !== user.userId && !user.isAdmin)) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  const { clientSecretHash, ...rest } = app;
  return rest;
});
```

```typescript
// server/api/oauth-provider/apps/[clientId].patch.ts
import { z } from "zod";
import { VALID_SCOPES } from "../../../types/oauth-provider.types";

export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const clientId = getRouterParam(event, "clientId")!;
  const app = await findOAuthAppByClientId(clientId);

  if (!app || (app.ownerId !== user.userId && !user.isAdmin)) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  const body = await readBody(event);
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    redirectUris: z.array(z.string().url()).min(1).max(10).optional(),
    scopes: z.array(z.enum(VALID_SCOPES as [string, ...string[]])).min(1).optional(),
    icon: z.string().url().nullable().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: "参数校验失败" };
  }

  const updated = await updateOAuthApp(clientId, parsed.data as any);
  return { success: updated };
});
```

```typescript
// server/api/oauth-provider/apps/[clientId].delete.ts
export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const clientId = getRouterParam(event, "clientId")!;
  const app = await findOAuthAppByClientId(clientId);

  if (!app || (app.ownerId !== user.userId && !user.isAdmin)) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  // 级联删除
  await deleteAllOAuthTokensForClient(clientId);
  await deleteAllOAuthAuthorizationsForClient(clientId);
  await deleteOAuthApp(clientId);

  return { success: true };
});
```

- [ ] **Step 3: 实现重置 secret 端点**

```typescript
// server/api/oauth-provider/apps/[clientId]/reset-secret.post.ts
export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const clientId = getRouterParam(event, "clientId")!;
  const app = await findOAuthAppByClientId(clientId);

  if (!app || (app.ownerId !== user.userId && !user.isAdmin)) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  if (app.type !== "confidential") {
    return { success: false, error: "只有机密客户端可以重置密钥" };
  }

  const newSecret = generateClientSecret();
  const newHash = await Bun.password.hash(newSecret, "argon2id");
  await updateOAuthApp(clientId, { clientSecretHash: newHash });

  // 重置 secret 后撤销所有现有 token
  await revokeAllOAuthTokensForClient(clientId);

  return {
    success: true,
    clientSecret: newSecret, // 仅此一次返回明文
  };
});
```

- [ ] **Step 4: 提交**

```bash
rtk git add server/api/oauth-provider/apps/
rtk git commit -m "feat(oauth-provider): add developer app management API endpoints"
```

---

## Task 12: 用户授权管理 API

**Files:**
- Create: `server/api/oauth-provider/authorizations/index.get.ts`
- Create: `server/api/oauth-provider/authorizations/[clientId].delete.ts`

- [ ] **Step 1: 实现用户授权管理端点**

```typescript
// server/api/oauth-provider/authorizations/index.get.ts
export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const authorizations = await findOAuthAuthorizationsByUser(user.userId);

  // 关联应用信息
  const results = [];
  for (const auth of authorizations) {
    const app = await findOAuthAppByClientId(auth.clientId);
    results.push({
      clientId: auth.clientId,
      appName: app?.name ?? "未知应用",
      appIcon: app?.icon ?? null,
      appDescription: app?.description ?? "",
      scopes: auth.scopes,
      grantedAt: auth.grantedAt,
      updatedAt: auth.updatedAt,
    });
  }

  return results;
});
```

```typescript
// server/api/oauth-provider/authorizations/[clientId].delete.ts
export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const clientId = getRouterParam(event, "clientId")!;

  // 撤销所有 token
  await revokeAllOAuthTokensForUserAndClient(clientId, user.userId);
  // 删除授权记录
  await deleteOAuthAuthorization(clientId, user.userId);

  return { success: true };
});
```

- [ ] **Step 2: 提交**

```bash
rtk git add server/api/oauth-provider/authorizations/
rtk git commit -m "feat(oauth-provider): add user authorization management endpoints"
```

---

## Task 13: 管理员 API

**Files:**
- Create: `server/api/oauth-provider/admin/apps/index.get.ts`
- Create: `server/api/oauth-provider/admin/apps/[clientId]/approve.post.ts`
- Create: `server/api/oauth-provider/admin/apps/[clientId]/revoke-approval.post.ts`
- Create: `server/api/oauth-provider/admin/apps/[clientId]/index.delete.ts`
- Create: `server/api/oauth-provider/admin/developers/[uuid].post.ts`
- Create: `server/api/oauth-provider/admin/developers/[uuid].delete.ts`

- [ ] **Step 1: 实现管理员应用管理端点**

```typescript
// server/api/oauth-provider/admin/apps/index.get.ts
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const query = getQuery(event);
  const filter: { approved?: boolean } = {};
  if (query.approved === "true") filter.approved = true;
  if (query.approved === "false") filter.approved = false;

  const apps = await findAllOAuthApps(filter);
  return apps.map(({ clientSecretHash, ...rest }) => rest);
});
```

```typescript
// server/api/oauth-provider/admin/apps/[clientId]/approve.post.ts
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const clientId = getRouterParam(event, "clientId")!;

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  const result = await approveOAuthApp(clientId, admin.userId);
  return { success: result };
});
```

```typescript
// server/api/oauth-provider/admin/apps/[clientId]/revoke-approval.post.ts
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const clientId = getRouterParam(event, "clientId")!;

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  // 撤销审批 + 级联撤销 token
  await revokeOAuthAppApproval(clientId);
  await revokeAllOAuthTokensForClient(clientId);

  return { success: true };
});
```

```typescript
// server/api/oauth-provider/admin/apps/[clientId]/index.delete.ts
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const clientId = getRouterParam(event, "clientId")!;

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "Application not found" });
  }

  await deleteAllOAuthTokensForClient(clientId);
  await deleteAllOAuthAuthorizationsForClient(clientId);
  await deleteOAuthApp(clientId);

  return { success: true };
});
```

- [ ] **Step 2: 实现开发者管理端点**

```typescript
// server/api/oauth-provider/admin/developers/[uuid].post.ts
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const uuid = getRouterParam(event, "uuid")!;

  const user = await findUserByUuid(uuid);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const result = await setDeveloperStatus(uuid, true);
  return { success: result };
});
```

```typescript
// server/api/oauth-provider/admin/developers/[uuid].delete.ts
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const uuid = getRouterParam(event, "uuid")!;

  const user = await findUserByUuid(uuid);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const result = await setDeveloperStatus(uuid, false);
  return { success: result };
});
```

- [ ] **Step 3: 提交**

```bash
rtk git add server/api/oauth-provider/admin/
rtk git commit -m "feat(oauth-provider): add admin API endpoints for app approval and developer management"
```

---

## Task 14: 资源端点

**Files:**
- Create: `server/api/oauth-provider/resources/profile/[uuid].get.ts`
- Create: `server/api/oauth-provider/resources/profile/[uuid]/skin.put.ts`
- Create: `server/api/oauth-provider/resources/profile/[uuid]/skin.delete.ts`
- Create: `server/api/oauth-provider/resources/profile/[uuid]/cape.put.ts`
- Create: `server/api/oauth-provider/resources/profile/[uuid]/cape.delete.ts`

- [ ] **Step 1: 实现 profile 读取端点**

```typescript
// server/api/oauth-provider/resources/profile/[uuid].get.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, ["profile:read"]);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  const uuid = getRouterParam(event, "uuid")!;
  const user = await findUserByUuid(uuid);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "Player not found" });
  }

  return {
    uuid: user.uuid,
    gameId: user.gameId,
    skin: user.skin,
    cape: user.cape,
  };
});
```

- [ ] **Step 2: 实现材质写入端点（skin + cape）**

材质上传复用现有的材质处理逻辑。由于项目已有 Yggdrasil 材质上传端点，这些端点参考其模式。

```typescript
// server/api/oauth-provider/resources/profile/[uuid]/skin.put.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, ["profile:write"]);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  const uuid = getRouterParam(event, "uuid")!;

  // 只能修改自己的材质
  if (tokenInfo.userId !== uuid) {
    throw createError({ statusCode: 403, statusMessage: "Cannot modify another user's texture" });
  }

  // 委托给现有的材质上传逻辑
  // 读取 multipart body，解析 skin 文件和 model 参数
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: "Missing form data" });
  }

  const fileField = formData.find((f) => f.name === "file");
  const modelField = formData.find((f) => f.name === "model");

  if (!fileField?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing skin file" });
  }

  const model = modelField?.data?.toString() || "classic";
  const skinType = model === "slim" ? 1 : 0;

  // 使用现有的材质处理函数
  const hash = await processAndStoreTexture(fileField.data, "skin");
  await updateUserSkin(uuid, { type: skinType as 0 | 1, hash });

  return { success: true };
});
```

```typescript
// server/api/oauth-provider/resources/profile/[uuid]/skin.delete.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, ["profile:write"]);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  const uuid = getRouterParam(event, "uuid")!;
  if (tokenInfo.userId !== uuid) {
    throw createError({ statusCode: 403, statusMessage: "Cannot modify another user's texture" });
  }

  await removeUserSkin(uuid);
  return { success: true };
});
```

```typescript
// server/api/oauth-provider/resources/profile/[uuid]/cape.put.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, ["profile:write"]);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  const uuid = getRouterParam(event, "uuid")!;
  if (tokenInfo.userId !== uuid) {
    throw createError({ statusCode: 403, statusMessage: "Cannot modify another user's texture" });
  }

  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: "Missing form data" });
  }

  const fileField = formData.find((f) => f.name === "file");
  if (!fileField?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing cape file" });
  }

  const hash = await processAndStoreTexture(fileField.data, "cape");
  await updateUserCape(uuid, { hash });

  return { success: true };
});
```

```typescript
// server/api/oauth-provider/resources/profile/[uuid]/cape.delete.ts
export default defineEventHandler(async (event) => {
  if (!getSetting("oauth.enabled")) {
    throw createError({ statusCode: 503, statusMessage: "OAuth provider is disabled" });
  }

  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, ["profile:write"]);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  const uuid = getRouterParam(event, "uuid")!;
  if (tokenInfo.userId !== uuid) {
    throw createError({ statusCode: 403, statusMessage: "Cannot modify another user's texture" });
  }

  await removeUserCape(uuid);
  return { success: true };
});
```

**注意：** 材质写入端点中的 `processAndStoreTexture`、`updateUserSkin`、`updateUserCape`、`removeUserSkin`、`removeUserCape` 是项目中应已存在的函数。实现时需检查这些函数的实际名称和签名，根据现有 Yggdrasil 材质端点的实现进行对齐。如果函数名不同，需调整调用方式。

- [ ] **Step 3: 提交**

```bash
rtk git add server/api/oauth-provider/resources/
rtk git commit -m "feat(oauth-provider): add resource endpoints for profile read/write"
```

---

## Task 15: 授权确认页（前端）

**Files:**
- Create: `app/pages/oauth/authorize.vue`

- [ ] **Step 1: 实现授权确认页**

```vue
<!-- app/pages/oauth/authorize.vue -->
<script setup lang="ts">
import { OAUTH_SCOPES } from "../../server/types/oauth-provider.types";

useHead({ title: "授权应用" });

const route = useRoute();
const router = useRouter();
const { data: user } = useUser();

// 未登录跳转
if (!user.value) {
  navigateTo(`/login?redirect=${encodeURIComponent(route.fullPath)}`);
}

const clientId = route.query.client_id as string;
const redirectUri = route.query.redirect_uri as string;
const scope = route.query.scope as string;
const state = route.query.state as string | undefined;
const codeChallenge = route.query.code_challenge as string | undefined;
const codeChallengeMethod = route.query.code_challenge_method as string | undefined;
const responseType = route.query.response_type as string;

// 获取应用信息
const { data: appInfo } = await useAsyncData("oauth-app-info", () =>
  $fetch(`/api/oauth-provider/apps/${clientId}`).catch(() => null),
);

const requestedScopes = computed(() =>
  scope ? scope.split(" ") : [],
);

const scopeDescriptions = computed(() =>
  requestedScopes.value.map((s) => ({
    key: s,
    description: (OAUTH_SCOPES as Record<string, string>)[s] ?? s,
  })),
);

const submitting = ref(false);

async function handleAction(action: "approve" | "deny") {
  submitting.value = true;
  try {
    const result = await $fetch("/api/oauth-provider/authorize", {
      method: "POST",
      body: {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        action,
      },
    });
    if (result.redirect) {
      window.location.href = result.redirect;
    }
  } catch {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center">
    <div class="w-full max-w-md p-6">
      <div v-if="!appInfo" class="text-center">
        <p class="text-error">应用不存在或未审批</p>
      </div>

      <div v-else class="space-y-6">
        <!-- 应用信息 -->
        <div class="text-center">
          <img
            v-if="appInfo.icon"
            :src="appInfo.icon"
            :alt="appInfo.name"
            class="mx-auto mb-4 h-16 w-16"
          />
          <h1 class="text-xl font-bold">{{ appInfo.name }}</h1>
          <p v-if="appInfo.description" class="text-base-content/60 mt-1 text-sm">
            {{ appInfo.description }}
          </p>
        </div>

        <!-- 授权提示 -->
        <div class="text-center text-sm">
          <p>
            <span class="font-semibold">{{ appInfo.name }}</span> 请求访问你的账户
            <span class="font-semibold">{{ user?.gameId }}</span>
          </p>
        </div>

        <!-- 请求的权限 -->
        <div class="bg-base-200 p-4">
          <p class="mb-2 text-sm font-semibold">此应用将获得以下权限：</p>
          <ul class="space-y-1">
            <li
              v-for="s in scopeDescriptions"
              :key="s.key"
              class="flex items-center gap-2 text-sm"
            >
              <Icon name="hugeicons:checkmark-circle-02" class="text-success text-lg" />
              {{ s.description }}
            </li>
          </ul>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-3">
          <button
            class="btn btn-ghost flex-1"
            :disabled="submitting"
            @click="handleAction('deny')"
          >
            拒绝
          </button>
          <button
            class="btn btn-primary flex-1"
            :disabled="submitting"
            @click="handleAction('approve')"
          >
            <span v-if="submitting" class="loading loading-spinner loading-sm" />
            授权
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
rtk git add app/pages/oauth/authorize.vue
rtk git commit -m "feat(oauth-provider): add OAuth authorization confirmation page"
```

---

## Task 16: 开发者应用管理页（前端）

**Files:**
- Create: `app/pages/developer/apps/index.vue`
- Create: `app/pages/developer/apps/new.vue`
- Create: `app/pages/developer/apps/[clientId].vue`

- [ ] **Step 1: 实现应用列表页**

```vue
<!-- app/pages/developer/apps/index.vue -->
<script setup lang="ts">
useHead({ title: "我的应用" });
definePageMeta({ hideFooter: true });

const { data: user } = useUser();
const router = useRouter();

watch(
  () => user.value,
  (u) => {
    if (u && !u.isDeveloper && !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

const apps = ref<any[]>([]);
const loading = ref(true);

async function fetchApps() {
  loading.value = true;
  try {
    apps.value = await $fetch("/api/oauth-provider/apps");
  } catch {
    apps.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(fetchApps);
</script>

<template>
  <div class="container mx-auto max-w-4xl p-6">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">我的应用</h1>
      <NuxtLink to="/developer/apps/new" class="btn btn-primary btn-sm">
        创建应用
      </NuxtLink>
    </div>

    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="apps.length === 0" class="py-12 text-center">
      <p class="text-base-content/60">还没有创建任何应用</p>
    </div>

    <div v-else class="space-y-3">
      <NuxtLink
        v-for="app in apps"
        :key="app.clientId"
        :to="`/developer/apps/${app.clientId}`"
        class="bg-base-200 hover:bg-base-300 flex items-center justify-between p-4 transition"
      >
        <div>
          <div class="flex items-center gap-2">
            <span class="font-semibold">{{ app.name }}</span>
            <span
              class="badge badge-sm"
              :class="app.approved ? 'badge-success' : 'badge-warning'"
            >
              {{ app.approved ? "已审批" : "待审批" }}
            </span>
            <span class="badge badge-sm badge-ghost">{{ app.type }}</span>
          </div>
          <p class="text-base-content/60 mt-1 text-sm">{{ app.description }}</p>
        </div>
        <Icon name="hugeicons:arrow-right-01" class="text-xl" />
      </NuxtLink>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 实现创建应用页**

```vue
<!-- app/pages/developer/apps/new.vue -->
<script setup lang="ts">
import { OAUTH_SCOPES } from "../../../server/types/oauth-provider.types";

useHead({ title: "创建应用" });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

watch(
  () => user.value,
  (u) => {
    if (u && !u.isDeveloper && !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

const form = reactive({
  name: "",
  description: "",
  type: "confidential" as "confidential" | "public",
  redirectUris: [""],
  scopes: [] as string[],
  icon: null as string | null,
});

const submitting = ref(false);
const createdResult = ref<{ clientId: string; clientSecret: string | null } | null>(null);

function addRedirectUri() {
  form.redirectUris.push("");
}

function removeRedirectUri(index: number) {
  if (form.redirectUris.length > 1) {
    form.redirectUris.splice(index, 1);
  }
}

async function handleSubmit() {
  submitting.value = true;
  try {
    const result = await $fetch("/api/oauth-provider/apps", {
      method: "POST",
      body: {
        name: form.name,
        description: form.description,
        type: form.type,
        redirectUris: form.redirectUris.filter((u) => u.trim()),
        scopes: form.scopes,
        icon: form.icon,
      },
    });
    if (result.success) {
      createdResult.value = {
        clientId: result.clientId,
        clientSecret: result.clientSecret,
      };
    } else {
      toast.error(result.error || "创建失败");
    }
  } catch {
    toast.error("请求失败");
  } finally {
    submitting.value = false;
  }
}

const scopeEntries = Object.entries(OAUTH_SCOPES);
</script>

<template>
  <div class="container mx-auto max-w-2xl p-6">
    <h1 class="mb-6 text-2xl font-bold">创建应用</h1>

    <!-- 创建成功弹窗 -->
    <ClientOnly>
      <Teleport to="body">
        <dialog
          :open="!!createdResult"
          class="modal modal-bottom sm:modal-middle"
        >
          <div v-if="createdResult" class="modal-box">
            <h3 class="text-lg font-bold">应用创建成功</h3>
            <div class="mt-4 space-y-3">
              <div>
                <label class="text-sm font-semibold">Client ID</label>
                <input
                  :value="createdResult.clientId"
                  class="input input-bordered w-full font-mono"
                  readonly
                />
              </div>
              <div v-if="createdResult.clientSecret">
                <label class="text-sm font-semibold">Client Secret</label>
                <input
                  :value="createdResult.clientSecret"
                  class="input input-bordered w-full font-mono"
                  readonly
                />
                <p class="text-warning mt-1 text-xs">
                  请立即保存 Client Secret，此后将无法再次查看。
                </p>
              </div>
            </div>
            <div class="modal-action">
              <button
                class="btn btn-primary"
                @click="router.push(`/developer/apps/${createdResult!.clientId}`)"
              >
                确定
              </button>
            </div>
          </div>
        </dialog>
      </Teleport>
    </ClientOnly>

    <!-- 表单 -->
    <form class="space-y-4" @submit.prevent="handleSubmit">
      <div class="form-control">
        <label class="label"><span class="label-text">应用名称</span></label>
        <input
          v-model="form.name"
          type="text"
          class="input input-bordered"
          required
          maxlength="100"
        />
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">描述</span></label>
        <textarea
          v-model="form.description"
          class="textarea textarea-bordered"
          maxlength="500"
        />
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">客户端类型</span></label>
        <select v-model="form.type" class="select select-bordered">
          <option value="confidential">机密客户端（有后端服务器）</option>
          <option value="public">公开客户端（SPA / 移动端）</option>
        </select>
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">回调地址</span></label>
        <div class="space-y-2">
          <div
            v-for="(_, index) in form.redirectUris"
            :key="index"
            class="flex gap-2"
          >
            <input
              v-model="form.redirectUris[index]"
              type="url"
              class="input input-bordered flex-1"
              placeholder="https://example.com/callback"
              required
            />
            <button
              v-if="form.redirectUris.length > 1"
              type="button"
              class="btn btn-ghost btn-sm"
              @click="removeRedirectUri(index)"
            >
              &#10005;
            </button>
          </div>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm mt-2"
          @click="addRedirectUri"
        >
          + 添加回调地址
        </button>
      </div>

      <div class="form-control">
        <label class="label"><span class="label-text">权限范围</span></label>
        <div class="space-y-1">
          <label
            v-for="[key, desc] in scopeEntries"
            :key="key"
            class="flex cursor-pointer items-center gap-2"
          >
            <input
              v-model="form.scopes"
              type="checkbox"
              :value="key"
              class="checkbox checkbox-sm"
            />
            <span class="text-sm">{{ key }} — {{ desc }}</span>
          </label>
        </div>
      </div>

      <button
        type="submit"
        class="btn btn-primary w-full"
        :disabled="submitting || form.scopes.length === 0"
      >
        <span v-if="submitting" class="loading loading-spinner loading-sm" />
        创建应用
      </button>
    </form>
  </div>
</template>
```

- [ ] **Step 3: 实现应用详情编辑页**

```vue
<!-- app/pages/developer/apps/[clientId].vue -->
<script setup lang="ts">
import { OAUTH_SCOPES } from "../../../server/types/oauth-provider.types";

useHead({ title: "应用详情" });

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { data: user } = useUser();
const clientId = route.params.clientId as string;

watch(
  () => user.value,
  (u) => {
    if (u && !u.isDeveloper && !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

const app = ref<any>(null);
const loading = ref(true);
const saving = ref(false);

const form = reactive({
  name: "",
  description: "",
  redirectUris: [""],
  scopes: [] as string[],
});

async function fetchApp() {
  loading.value = true;
  try {
    app.value = await $fetch(`/api/oauth-provider/apps/${clientId}`);
    form.name = app.value.name;
    form.description = app.value.description;
    form.redirectUris = [...app.value.redirectUris];
    form.scopes = [...app.value.scopes];
  } catch {
    router.replace("/developer/apps");
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  try {
    const result = await $fetch(`/api/oauth-provider/apps/${clientId}`, {
      method: "PATCH",
      body: {
        name: form.name,
        description: form.description,
        redirectUris: form.redirectUris.filter((u) => u.trim()),
        scopes: form.scopes,
      },
    });
    if (result.success) {
      toast.success("已保存");
      await fetchApp();
    }
  } catch {
    toast.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function handleResetSecret() {
  if (!confirm("重置 Secret 将撤销所有现有 Token，确定继续？")) return;
  try {
    const result = await $fetch(
      `/api/oauth-provider/apps/${clientId}/reset-secret`,
      { method: "POST" },
    );
    if (result.success) {
      alert(`新的 Client Secret（仅显示一次）：\n${result.clientSecret}`);
    }
  } catch {
    toast.error("重置失败");
  }
}

async function handleDelete() {
  if (!confirm("删除应用将撤销所有 Token 和授权记录，确定继续？")) return;
  try {
    await $fetch(`/api/oauth-provider/apps/${clientId}`, { method: "DELETE" });
    toast.success("应用已删除");
    router.replace("/developer/apps");
  } catch {
    toast.error("删除失败");
  }
}

function addRedirectUri() {
  form.redirectUris.push("");
}

function removeRedirectUri(index: number) {
  if (form.redirectUris.length > 1) {
    form.redirectUris.splice(index, 1);
  }
}

onMounted(fetchApp);

const scopeEntries = Object.entries(OAUTH_SCOPES);
</script>

<template>
  <div class="container mx-auto max-w-2xl p-6">
    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="app" class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">{{ app.name }}</h1>
        <span
          class="badge"
          :class="app.approved ? 'badge-success' : 'badge-warning'"
        >
          {{ app.approved ? "已审批" : "待审批" }}
        </span>
      </div>

      <!-- Client ID 展示 -->
      <div>
        <label class="text-sm font-semibold">Client ID</label>
        <input
          :value="app.clientId"
          class="input input-bordered w-full font-mono"
          readonly
        />
      </div>

      <!-- 编辑表单 -->
      <form class="space-y-4" @submit.prevent="handleSave">
        <div class="form-control">
          <label class="label"><span class="label-text">应用名称</span></label>
          <input
            v-model="form.name"
            type="text"
            class="input input-bordered"
            required
          />
        </div>

        <div class="form-control">
          <label class="label"><span class="label-text">描述</span></label>
          <textarea
            v-model="form.description"
            class="textarea textarea-bordered"
          />
        </div>

        <div class="form-control">
          <label class="label"><span class="label-text">回调地址</span></label>
          <div class="space-y-2">
            <div
              v-for="(_, index) in form.redirectUris"
              :key="index"
              class="flex gap-2"
            >
              <input
                v-model="form.redirectUris[index]"
                type="url"
                class="input input-bordered flex-1"
                required
              />
              <button
                v-if="form.redirectUris.length > 1"
                type="button"
                class="btn btn-ghost btn-sm"
                @click="removeRedirectUri(index)"
              >
                &#10005;
              </button>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm mt-2"
            @click="addRedirectUri"
          >
            + 添加
          </button>
        </div>

        <div class="form-control">
          <label class="label"><span class="label-text">权限范围</span></label>
          <div class="space-y-1">
            <label
              v-for="[key, desc] in scopeEntries"
              :key="key"
              class="flex cursor-pointer items-center gap-2"
            >
              <input
                v-model="form.scopes"
                type="checkbox"
                :value="key"
                class="checkbox checkbox-sm"
              />
              <span class="text-sm">{{ key }} — {{ desc }}</span>
            </label>
          </div>
        </div>

        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="saving"
        >
          保存
        </button>
      </form>

      <!-- 危险操作 -->
      <div class="border-error/20 space-y-3 border-t pt-4">
        <button
          v-if="app.type === 'confidential'"
          class="btn btn-warning btn-sm"
          @click="handleResetSecret"
        >
          重置 Client Secret
        </button>
        <button class="btn btn-error btn-sm" @click="handleDelete">
          删除应用
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: 提交**

```bash
rtk git add app/pages/developer/
rtk git commit -m "feat(oauth-provider): add developer app management pages"
```

---

## Task 17: 用户授权管理页（前端）

**Files:**
- Create: `app/pages/settings/authorizations.vue`

- [ ] **Step 1: 实现授权管理页**

```vue
<!-- app/pages/settings/authorizations.vue -->
<script setup lang="ts">
useHead({ title: "第三方应用授权" });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

watch(
  () => user.value,
  (u) => {
    if (!u) router.replace("/login");
  },
  { immediate: true },
);

const authorizations = ref<any[]>([]);
const loading = ref(true);

async function fetchAuthorizations() {
  loading.value = true;
  try {
    authorizations.value = await $fetch("/api/oauth-provider/authorizations");
  } catch {
    authorizations.value = [];
  } finally {
    loading.value = false;
  }
}

async function revokeAuthorization(clientId: string, appName: string) {
  if (!confirm(`确定撤销对「${appName}」的授权？此操作将使所有相关 Token 失效。`)) return;
  try {
    await $fetch(`/api/oauth-provider/authorizations/${clientId}`, {
      method: "DELETE",
    });
    toast.success("已撤销");
    await fetchAuthorizations();
  } catch {
    toast.error("操作失败");
  }
}

onMounted(fetchAuthorizations);
</script>

<template>
  <div class="container mx-auto max-w-2xl p-6">
    <h1 class="mb-6 text-2xl font-bold">第三方应用授权</h1>

    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="authorizations.length === 0" class="py-12 text-center">
      <p class="text-base-content/60">你还没有授权过任何第三方应用</p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="auth in authorizations"
        :key="auth.clientId"
        class="bg-base-200 flex items-center justify-between p-4"
      >
        <div>
          <div class="flex items-center gap-2">
            <img
              v-if="auth.appIcon"
              :src="auth.appIcon"
              class="h-8 w-8"
              :alt="auth.appName"
            />
            <span class="font-semibold">{{ auth.appName }}</span>
          </div>
          <p class="text-base-content/60 mt-1 text-xs">
            权限：{{ auth.scopes.join(", ") }}
          </p>
          <p class="text-base-content/40 text-xs">
            授权于 {{ new Date(auth.grantedAt).toLocaleDateString() }}
          </p>
        </div>
        <button
          class="btn btn-error btn-sm"
          @click="revokeAuthorization(auth.clientId, auth.appName)"
        >
          撤销
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
rtk git add app/pages/settings/authorizations.vue
rtk git commit -m "feat(oauth-provider): add user authorization management page"
```

---

## Task 18: 管理员审批页（前端）

**Files:**
- Create: `app/pages/admin/oauth-apps.vue`

- [ ] **Step 1: 实现管理员审批页**

```vue
<!-- app/pages/admin/oauth-apps.vue -->
<script setup lang="ts">
useHead({ title: "OAuth 应用管理" });
definePageMeta({ hideFooter: true });

const { data: user } = useUser();
const router = useRouter();
const toast = useToast();

watch(
  () => user.value,
  (u) => {
    if (u && !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

const apps = ref<any[]>([]);
const loading = ref(true);
const filterApproved = ref<"all" | "true" | "false">("all");

async function fetchApps() {
  loading.value = true;
  try {
    const query =
      filterApproved.value === "all"
        ? ""
        : `?approved=${filterApproved.value}`;
    apps.value = await $fetch(`/api/oauth-provider/admin/apps${query}`);
  } catch {
    apps.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleApprove(clientId: string) {
  try {
    await $fetch(`/api/oauth-provider/admin/apps/${clientId}/approve`, {
      method: "POST",
    });
    toast.success("已审批");
    await fetchApps();
  } catch {
    toast.error("操作失败");
  }
}

async function handleRevokeApproval(clientId: string) {
  if (!confirm("撤销审批将使该应用的所有 Token 失效，确定继续？")) return;
  try {
    await $fetch(`/api/oauth-provider/admin/apps/${clientId}/revoke-approval`, {
      method: "POST",
    });
    toast.success("已撤销审批");
    await fetchApps();
  } catch {
    toast.error("操作失败");
  }
}

async function handleDelete(clientId: string) {
  if (!confirm("确定删除此应用？所有 Token 和授权记录将被清除。")) return;
  try {
    await $fetch(`/api/oauth-provider/admin/apps/${clientId}`, {
      method: "DELETE",
    });
    toast.success("已删除");
    await fetchApps();
  } catch {
    toast.error("操作失败");
  }
}

watch(filterApproved, fetchApps);
onMounted(fetchApps);
</script>

<template>
  <div class="container mx-auto max-w-4xl p-6">
    <h1 class="mb-6 text-2xl font-bold">OAuth 应用管理</h1>

    <!-- 过滤 -->
    <div class="mb-4">
      <select v-model="filterApproved" class="select select-bordered select-sm">
        <option value="all">全部</option>
        <option value="false">待审批</option>
        <option value="true">已审批</option>
      </select>
    </div>

    <div v-if="loading" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="apps.length === 0" class="py-12 text-center">
      <p class="text-base-content/60">没有应用</p>
    </div>

    <div v-else class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>状态</th>
            <th>所有者</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="app in apps" :key="app.clientId">
            <td>
              <div>
                <div class="font-semibold">{{ app.name }}</div>
                <div class="text-base-content/60 text-xs">{{ app.clientId }}</div>
              </div>
            </td>
            <td>
              <span class="badge badge-ghost badge-sm">{{ app.type }}</span>
            </td>
            <td>
              <span
                class="badge badge-sm"
                :class="app.approved ? 'badge-success' : 'badge-warning'"
              >
                {{ app.approved ? "已审批" : "待审批" }}
              </span>
            </td>
            <td class="text-sm">{{ app.ownerId }}</td>
            <td>
              <div class="flex gap-1">
                <button
                  v-if="!app.approved"
                  class="btn btn-success btn-xs"
                  @click="handleApprove(app.clientId)"
                >
                  审批
                </button>
                <button
                  v-else
                  class="btn btn-warning btn-xs"
                  @click="handleRevokeApproval(app.clientId)"
                >
                  撤销审批
                </button>
                <button
                  class="btn btn-error btn-xs"
                  @click="handleDelete(app.clientId)"
                >
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
rtk git add app/pages/admin/oauth-apps.vue
rtk git commit -m "feat(oauth-provider): add admin OAuth app management page"
```

---

## Task 19: 管理员用户页扩展（开发者标记）

**Files:**
- Modify: `app/pages/admin/users.vue`（或相应的用户详情/管理组件）

- [ ] **Step 1: 在管理员用户管理页中添加开发者标记功能**

在用户列表的操作区域或用户详情弹窗中，添加「标记为开发者」/「撤销开发者」按钮：

```typescript
// 在 admin/users.vue 的 <script setup> 中添加：
async function toggleDeveloper(uuid: string, currentStatus: boolean) {
  try {
    if (currentStatus) {
      await $fetch(`/api/oauth-provider/admin/developers/${uuid}`, {
        method: "DELETE",
      });
      toast.success("已撤销开发者身份");
    } else {
      await $fetch(`/api/oauth-provider/admin/developers/${uuid}`, {
        method: "POST",
      });
      toast.success("已标记为开发者");
    }
    await fetchUsers();
  } catch {
    toast.error("操作失败");
  }
}
```

在用户列表每行的操作按钮区域添加：

```vue
<button
  class="btn btn-xs"
  :class="u.isDeveloper ? 'btn-warning' : 'btn-info'"
  @click="toggleDeveloper(u.uuid, u.isDeveloper)"
>
  {{ u.isDeveloper ? "撤销开发者" : "标记为开发者" }}
</button>
```

**注意：** 此步骤需要在实现时查看 `admin/users.vue` 的实际结构，找到合适的插入位置。上述代码是逻辑指引，具体位置和样式需要对齐现有页面布局。同时需要确保 session 中间件返回的用户数据包含 `isDeveloper` 字段（Task 5 已处理）。

- [ ] **Step 2: 提交**

```bash
rtk git add app/pages/admin/users.vue
rtk git commit -m "feat(oauth-provider): add developer toggle in admin user management"
```

---

## Task 20: 导航入口集成

**Files:**
- Modify: 导航组件（需要在实现时确认具体文件，可能是 `app/layouts/default.vue` 或侧边栏组件）

- [ ] **Step 1: 添加导航入口**

在项目的导航组件中添加以下入口（仅在条件满足时显示）：

1. **开发者入口**：当 `user.isDeveloper || user.isAdmin` 时显示「开发者」链接，指向 `/developer/apps`
2. **用户授权管理**：当用户已登录时，在设置区域显示「第三方应用授权」链接，指向 `/settings/authorizations`
3. **管理后台**：当 `user.isAdmin` 时，在管理菜单中显示「OAuth 应用管理」链接，指向 `/admin/oauth-apps`

**注意：** 需要在实现时查看实际导航组件的结构。入口文字和位置遵循现有导航模式。同时需要根据 `oauth.enabled` 设置决定是否显示开发者入口和授权管理入口（管理后台始终显示）。

- [ ] **Step 2: 提交**

```bash
rtk git add app/layouts/ app/components/
rtk git commit -m "feat(oauth-provider): add navigation entries for OAuth features"
```

---

## Task 21: CORS 处理

**Files:**
- 可能需要创建中间件或在端点中处理

- [ ] **Step 1: 为 OAuth 资源端点添加 CORS 预检处理**

由于 OAuth token、userinfo 和 resources 端点需要支持跨域请求（含预检），需要处理 OPTIONS 请求。在 `server/api/oauth-provider/` 下可能需要添加一个通用的 CORS 中间件，或在各端点中单独处理。

最简方案：在已有的安全头中间件 `server/middleware/02.security-headers.ts` 中为 `/api/oauth-provider/token`、`/api/oauth-provider/userinfo`、`/api/oauth-provider/revoke`、`/api/oauth-provider/resources/**` 路径添加 CORS 头。

```typescript
// 在 02.security-headers.ts 中，检查请求路径：
const pathname = getRequestURL(event).pathname;
const oauthCorsRoutes = [
  "/api/oauth-provider/token",
  "/api/oauth-provider/userinfo",
  "/api/oauth-provider/revoke",
];
if (
  oauthCorsRoutes.includes(pathname) ||
  pathname.startsWith("/api/oauth-provider/resources/")
) {
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  setResponseHeader(event, "Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (event.method === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }
}
```

**注意：** 实现时需查看 `server/middleware/02.security-headers.ts` 的实际内容和结构，在合适位置插入 CORS 逻辑。

- [ ] **Step 2: 提交**

```bash
rtk git add server/middleware/02.security-headers.ts
rtk git commit -m "feat(oauth-provider): add CORS support for OAuth resource endpoints"
```

---

## Task 22: 集成测试

**Files:**
- Create: `tests/server/oauth-provider.test.ts`

- [ ] **Step 1: 编写 OAuth 端点集成测试**

参考 `tests/server/auth.test.ts` 的 mock 模式，测试 token 端点的三种 grant type 和错误处理。

```typescript
// tests/server/oauth-provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";

// ─── Mocks ───

vi.stubGlobal("getSetting", (key: string) => {
  const s: Record<string, unknown> = {
    "oauth.enabled": true,
    "oauth.accessTokenTtlMs": 3600000,
    "oauth.refreshTokenTtlMs": 2592000000,
    "oauth.authorizationCodeTtlS": 60,
  };
  return s[key];
});

vi.stubGlobal("defineEventHandler", (handler: any) => handler);
vi.stubGlobal("readBody", vi.fn());
vi.stubGlobal("setResponseHeader", vi.fn());
vi.stubGlobal("setResponseStatus", vi.fn());
vi.stubGlobal("getHeader", vi.fn());
vi.stubGlobal("createError", (opts: any) => {
  const err = new Error(opts.statusMessage);
  (err as any).statusCode = opts.statusCode;
  return err;
});

vi.stubGlobal("findOAuthAppByClientId", vi.fn());
vi.stubGlobal("findOAuthTokenByHash", vi.fn());
vi.stubGlobal("findOAuthTokenByHashIncludingRevoked", vi.fn());
vi.stubGlobal("insertOAuthToken", vi.fn());
vi.stubGlobal("revokeOAuthToken", vi.fn());
vi.stubGlobal("revokeAllOAuthTokensForUserAndClient", vi.fn());
vi.stubGlobal("buildRedisKey", (...args: string[]) => `irmin:${args.join(":")}`);

const mockRedis = { send: vi.fn() };
vi.stubGlobal("getRedisClient", () => mockRedis);

vi.stubGlobal("Bun", {
  password: {
    hash: vi.fn().mockResolvedValue("hashed"),
    verify: vi.fn().mockResolvedValue(true),
  },
});

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return {
    ...mod,
    useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
    createLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
  };
});

let tokenHandler: any;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  tokenHandler = (
    await import("../../server/api/oauth-provider/token.post")
  ).default;
});

function fakeEvent() {
  return { method: "POST" };
}

describe("POST /api/oauth-provider/token", () => {
  describe("authorization_code grant", () => {
    it("should return tokens for valid authorization code", async () => {
      // Mock readBody
      vi.mocked(readBody).mockResolvedValue({
        grant_type: "authorization_code",
        code: "valid-code",
        redirect_uri: "http://localhost/cb",
        client_id: "cid",
        client_secret: "secret",
        code_verifier: "verifier123",
      });

      // Mock app
      vi.mocked(findOAuthAppByClientId).mockResolvedValue({
        clientId: "cid",
        type: "confidential",
        clientSecretHash: "hashed",
        approved: true,
        scopes: ["profile:read"],
        redirectUris: ["http://localhost/cb"],
      } as any);

      // Mock code consumption
      const challenge = createHash("sha256")
        .update("verifier123")
        .digest("base64url");
      mockRedis.send.mockResolvedValueOnce(
        JSON.stringify({
          clientId: "cid",
          userId: "user-uuid",
          scopes: ["profile:read"],
          redirectUri: "http://localhost/cb",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          createdAt: Date.now(),
        }),
      );

      // Mock token insertion
      vi.mocked(insertOAuthToken).mockResolvedValue(undefined);

      const result = await tokenHandler(fakeEvent());
      expect(result).toHaveProperty("access_token");
      expect(result).toHaveProperty("refresh_token");
      expect(result.token_type).toBe("Bearer");
    });

    it("should reject expired/invalid authorization code", async () => {
      vi.mocked(readBody).mockResolvedValue({
        grant_type: "authorization_code",
        code: "expired-code",
        redirect_uri: "http://localhost/cb",
        client_id: "cid",
        client_secret: "secret",
      });

      vi.mocked(findOAuthAppByClientId).mockResolvedValue({
        clientId: "cid",
        type: "confidential",
        clientSecretHash: "hashed",
        approved: true,
      } as any);

      mockRedis.send.mockResolvedValueOnce(null); // code not found

      const result = await tokenHandler(fakeEvent());
      expect(result.error).toBe("invalid_grant");
    });
  });

  describe("client_credentials grant", () => {
    it("should return access token without refresh token", async () => {
      vi.mocked(readBody).mockResolvedValue({
        grant_type: "client_credentials",
        client_id: "cid",
        client_secret: "secret",
        scope: "profile:read",
      });

      vi.mocked(findOAuthAppByClientId).mockResolvedValue({
        clientId: "cid",
        type: "confidential",
        clientSecretHash: "hashed",
        approved: true,
      } as any);

      vi.mocked(insertOAuthToken).mockResolvedValue(undefined);

      const result = await tokenHandler(fakeEvent());
      expect(result).toHaveProperty("access_token");
      expect(result).not.toHaveProperty("refresh_token");
      expect(result.scope).toBe("profile:read");
    });

    it("should reject non-profile:read scopes", async () => {
      vi.mocked(readBody).mockResolvedValue({
        grant_type: "client_credentials",
        client_id: "cid",
        client_secret: "secret",
        scope: "email:read",
      });

      vi.mocked(findOAuthAppByClientId).mockResolvedValue({
        clientId: "cid",
        type: "confidential",
        clientSecretHash: "hashed",
        approved: true,
      } as any);

      const result = await tokenHandler(fakeEvent());
      expect(result.error).toBe("invalid_scope");
    });
  });

  describe("unsupported grant type", () => {
    it("should return error for unknown grant_type", async () => {
      vi.mocked(readBody).mockResolvedValue({
        grant_type: "password",
        username: "test",
        password: "test",
      });

      const result = await tokenHandler(fakeEvent());
      expect(result.error).toBe("unsupported_grant_type");
    });
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
rtk vitest run tests/server/oauth-provider.test.ts
```

预期：全部 PASS。

- [ ] **Step 3: 提交**

```bash
rtk git add tests/server/oauth-provider.test.ts
rtk git commit -m "test(oauth-provider): add integration tests for token endpoint"
```

---

## Task 23: 全量测试和 Lint

- [ ] **Step 1: 运行全量测试**

```bash
rtk vitest run
```

预期：全部 PASS，无回归。

- [ ] **Step 2: 运行 Lint**

```bash
bun run lint
```

修复所有 lint 问题。

- [ ] **Step 3: 运行格式化检查**

```bash
bun run fmt:check
```

如果有格式问题，运行 `bun run fmt` 修复。

- [ ] **Step 4: 提交修复（如有）**

```bash
rtk git add -A && rtk git commit -m "chore: fix lint and formatting issues"
```
