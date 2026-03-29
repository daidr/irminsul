# 封禁 Hook 重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 `user:banned` / `user:unbanned`，替换为 4 个细粒度封禁 hook（`user:ban-created`、`user:ban-edited`、`user:ban-revoked`、`user:ban-deleted`），同时优化 repository 层消除额外 DB 查询。

**Architecture:** 类型定义层移除旧 hook 并新增 4 个 hook + `BanSnapshot` 类型。Repository 层 4 个函数改用 `findOneAndUpdate` 返回用户上下文（`removeBan` 例外，扩展投影）。API handler 层使用 `toBanSnapshot` 辅助函数构建 payload 并调用 `emitUserHook`。

**Tech Stack:** TypeScript, Vitest, MongoDB `findOneAndUpdate`, Nitro auto-import, 现有 PluginManager/HookRegistry 基础设施。

---

### Task 1: 更新类型定义

**Files:**
- Modify: `server/utils/plugin/types.ts:179-257`

- [ ] **Step 1: 移除旧 hook 名称并新增 4 个**

在 `server/utils/plugin/types.ts` 中，替换 `KNOWN_EVENT_HOOKS` 数组（当前第 179-187 行）：

```typescript
export const KNOWN_EVENT_HOOKS = [
  "user:registered",
  "user:login",
  "user:ban-created",
  "user:ban-edited",
  "user:ban-revoked",
  "user:ban-deleted",
  "user:password-changed",
  "user:password-reset",
  "user:oauth-bindchanged",
] as const;
```

- [ ] **Step 2: 替换 payload 类型定义**

在同一文件中，删除 `UserBannedPayload` 和 `UserUnbannedPayload` 接口（当前第 225-232 行），替换为新类型。找到 `// ===== User Lifecycle Hook Payloads =====` 部分，将 `UserBannedPayload` 和 `UserUnbannedPayload` 替换为：

```typescript
export interface BanSnapshot {
  start: number;
  end?: number;
  reason?: string;
  revokedAt?: number;
  revokedBy?: string;
}

export interface BanHookBasePayload extends UserHookBasePayload {
  banId: string;
  operator: string;
}

export interface BanCreatedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
}

export interface BanEditedPayload extends BanHookBasePayload {
  old: BanSnapshot;
  new: BanSnapshot;
}

export interface BanRevokedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
}

export interface BanDeletedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
  wasActive: boolean;
}
```

- [ ] **Step 3: 更新 `UserHookPayloadMap`**

在 `UserHookPayloadMap` 中（当前第 249-257 行），将 `"user:banned"` / `"user:unbanned"` 替换为：

```typescript
export type UserHookPayloadMap = {
  "user:registered": UserRegisteredPayload;
  "user:login": UserLoginPayload;
  "user:ban-created": BanCreatedPayload;
  "user:ban-edited": BanEditedPayload;
  "user:ban-revoked": BanRevokedPayload;
  "user:ban-deleted": BanDeletedPayload;
  "user:password-changed": UserPasswordChangedPayload;
  "user:password-reset": UserPasswordResetPayload;
  "user:oauth-bindchanged": UserOAuthBindChangedPayload;
};
```

- [ ] **Step 4: 验证 lint**

Run: `bun run lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```bash
git add server/utils/plugin/types.ts
git commit -m "feat(plugin): replace user:banned/unbanned with 4 fine-grained ban hooks"
```

---

### Task 2: 创建 toBanSnapshot 辅助函数

**Files:**
- Create: `server/utils/ban-snapshot.ts`
- Create: `tests/utils/ban-snapshot.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/utils/ban-snapshot.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { toBanSnapshot } from "../../server/utils/ban-snapshot";

describe("toBanSnapshot", () => {
  it("converts all fields from BanRecord to BanSnapshot", () => {
    const ban = {
      id: "ban-1",
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-06-01T00:00:00Z"),
      reason: "违规行为",
      operatorId: "admin-1",
      revokedAt: new Date("2026-04-01T00:00:00Z"),
      revokedBy: "admin-2",
    };

    const snapshot = toBanSnapshot(ban);

    expect(snapshot).toEqual({
      start: new Date("2026-03-01T00:00:00Z").getTime(),
      end: new Date("2026-06-01T00:00:00Z").getTime(),
      reason: "违规行为",
      revokedAt: new Date("2026-04-01T00:00:00Z").getTime(),
      revokedBy: "admin-2",
    });
  });

  it("omits optional fields when not present", () => {
    const ban = {
      id: "ban-2",
      start: new Date("2026-03-01T00:00:00Z"),
      operatorId: "admin-1",
    };

    const snapshot = toBanSnapshot(ban);

    expect(snapshot).toEqual({
      start: new Date("2026-03-01T00:00:00Z").getTime(),
    });
    expect(snapshot).not.toHaveProperty("end");
    expect(snapshot).not.toHaveProperty("reason");
    expect(snapshot).not.toHaveProperty("revokedAt");
    expect(snapshot).not.toHaveProperty("revokedBy");
  });

  it("preserves empty string reason", () => {
    const ban = {
      id: "ban-3",
      start: new Date("2026-03-01T00:00:00Z"),
      reason: "",
      operatorId: "admin-1",
    };

    const snapshot = toBanSnapshot(ban);

    expect(snapshot).toHaveProperty("reason", "");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk vitest run tests/utils/ban-snapshot.test.ts`
Expected: FAIL — 模块 `../../server/utils/ban-snapshot` 不存在。

- [ ] **Step 3: 实现 toBanSnapshot**

创建 `server/utils/ban-snapshot.ts`：

```typescript
import type { BanRecord } from "../types/user.schema";
import type { BanSnapshot } from "./plugin/types";

export function toBanSnapshot(ban: BanRecord): BanSnapshot {
  return {
    start: ban.start.getTime(),
    ...(ban.end !== undefined && { end: ban.end.getTime() }),
    ...(ban.reason !== undefined && { reason: ban.reason }),
    ...(ban.revokedAt !== undefined && {
      revokedAt: ban.revokedAt.getTime(),
      revokedBy: ban.revokedBy,
    }),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk vitest run tests/utils/ban-snapshot.test.ts`
Expected: 3 个测试全部 PASS。

- [ ] **Step 5: 验证 lint**

Run: `bun run lint`
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add server/utils/ban-snapshot.ts tests/utils/ban-snapshot.test.ts
git commit -m "feat(plugin): add toBanSnapshot helper for BanRecord to BanSnapshot conversion"
```

---

### Task 3: 更新 addBan 和 revokeBan

**Files:**
- Modify: `server/utils/ban.repository.ts:1-58`
- Modify: `tests/utils/ban.repository.test.ts:1-82`

- [ ] **Step 1: 添加 mock 和类型基础设施**

在 `tests/utils/ban.repository.test.ts` 中，在 `mockFindOne` 声明后新增 `mockFindOneAndUpdate`（第 5 行后）：

```typescript
const mockFindOneAndUpdate = vi.fn();
```

更新 `mockCollection` 对象以包含新 mock（第 6-9 行）：

```typescript
const mockCollection = {
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
};
```

- [ ] **Step 2: 更新 addBan 测试**

替换整个 `describe("addBan", ...)` 块（第 28-58 行）为：

```typescript
describe("addBan", () => {
  it("pushes a new ban and returns ban record with user context", async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      uuid: "user-uuid",
      email: "user@test.com",
      gameId: "Player1",
    });
    const result = await banRepo.addBan("user-uuid", { reason: "test" }, "admin-uuid");

    expect(mockFindOneAndUpdate).toHaveBeenCalledOnce();
    const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$push.bans.id).toBe("test-uuid-1234");
    expect(update.$push.bans.operatorId).toBe("admin-uuid");
    expect(update.$push.bans.reason).toBe("test");
    expect(update.$push.bans.start).toBeInstanceOf(Date);
    expect(update.$push.bans.end).toBeUndefined();
    expect(options.returnDocument).toBe("after");

    expect(result).toEqual({
      success: true,
      banId: "test-uuid-1234",
      ban: expect.objectContaining({ id: "test-uuid-1234", reason: "test" }),
      user: { uuid: "user-uuid", email: "user@test.com", gameId: "Player1" },
    });
  });

  it("sets end date when provided", async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      uuid: "user-uuid",
      email: "u@t.com",
      gameId: "P",
    });
    const end = new Date("2026-12-31T00:00:00Z");
    await banRepo.addBan("user-uuid", { end, reason: "temp" }, "admin-uuid");

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$push.bans.end).toEqual(end);
  });

  it("returns failure when user not found", async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);
    const result = await banRepo.addBan("nonexistent", {}, "admin-uuid");
    expect(result).toEqual({ success: false, error: "用户不存在" });
  });
});
```

- [ ] **Step 3: 更新 revokeBan 测试**

替换整个 `describe("revokeBan", ...)` 块（第 60-82 行）为：

```typescript
describe("revokeBan", () => {
  it("sets revokedAt/revokedBy and returns ban record with user context", async () => {
    const banStart = new Date("2026-03-01T00:00:00Z");
    mockFindOneAndUpdate.mockResolvedValue({
      uuid: "user-uuid",
      email: "user@test.com",
      gameId: "Player1",
      bans: [{ id: "ban-id", start: banStart, operatorId: "op", reason: "test" }],
    });
    const result = await banRepo.revokeBan("user-uuid", "ban-id", "admin-uuid");

    expect(mockFindOneAndUpdate).toHaveBeenCalledOnce();
    const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter.uuid).toBe("user-uuid");
    expect(filter.bans.$elemMatch.id).toBe("ban-id");
    expect(filter.bans.$elemMatch.revokedAt).toEqual({ $exists: false });
    expect(update.$set["bans.$.revokedAt"]).toBeInstanceOf(Date);
    expect(update.$set["bans.$.revokedBy"]).toBe("admin-uuid");
    expect(options.returnDocument).toBe("before");

    expect(result).toEqual({
      success: true,
      ban: { id: "ban-id", start: banStart, operatorId: "op", reason: "test" },
      user: { uuid: "user-uuid", email: "user@test.com", gameId: "Player1" },
    });
  });

  it("returns failure when ban already revoked, expired, or not found", async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);
    const result = await banRepo.revokeBan("user-uuid", "ban-id", "admin-uuid");
    expect(result).toEqual({ success: false, error: "该封禁已被撤销、已过期或不存在" });
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: FAIL — `addBan` 和 `revokeBan` 测试失败（实现仍使用 `updateOne`）。

- [ ] **Step 5: 更新 addBan 实现**

在 `server/utils/ban.repository.ts` 中，替换 `addBan` 函数（第 4-26 行）：

```typescript
export interface BanOpUserContext {
  uuid: string;
  email: string;
  gameId: string;
}

export async function addBan(
  userUuid: string,
  opts: { end?: Date; reason?: string },
  operatorUuid: string,
): Promise<
  | { success: true; banId: string; ban: BanRecord; user: BanOpUserContext }
  | { success: false; error: string }
> {
  const ban: BanRecord = {
    id: crypto.randomUUID(),
    start: new Date(),
    operatorId: operatorUuid,
    ...(opts.end && { end: opts.end }),
    ...(opts.reason && { reason: opts.reason }),
  };

  const doc = await getUserCollection().findOneAndUpdate(
    { uuid: userUuid },
    { $push: { bans: ban } },
    { returnDocument: "after", projection: { uuid: 1, email: 1, gameId: 1 } },
  );

  if (!doc) {
    return { success: false, error: "用户不存在" };
  }
  return {
    success: true,
    banId: ban.id,
    ban,
    user: { uuid: doc.uuid, email: doc.email, gameId: doc.gameId },
  };
}
```

- [ ] **Step 6: 更新 revokeBan 实现**

替换 `revokeBan` 函数（当前紧跟 `addBan` 之后）：

```typescript
export async function revokeBan(
  userUuid: string,
  banId: string,
  operatorUuid: string,
): Promise<
  | { success: true; ban: BanRecord; user: BanOpUserContext }
  | { success: false; error: string }
> {
  const now = new Date();
  const doc = await getUserCollection().findOneAndUpdate(
    {
      uuid: userUuid,
      bans: {
        $elemMatch: {
          id: banId,
          revokedAt: { $exists: false },
          start: { $lte: now },
          $or: [{ end: { $exists: false } }, { end: { $gt: now } }],
        },
      },
    },
    {
      $set: {
        "bans.$.revokedAt": now,
        "bans.$.revokedBy": operatorUuid,
      },
    },
    { returnDocument: "before", projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
  );

  if (!doc) {
    return { success: false, error: "该封禁已被撤销、已过期或不存在" };
  }

  const ban = doc.bans.find((b) => b.id === banId)!;
  return {
    success: true,
    ban,
    user: { uuid: doc.uuid, email: doc.email, gameId: doc.gameId },
  };
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: `addBan` 和 `revokeBan` 测试 PASS，`editBan` 测试仍可能 PASS（未修改）。

- [ ] **Step 8: 提交**

```bash
git add server/utils/ban.repository.ts tests/utils/ban.repository.test.ts
git commit -m "feat(plugin): update addBan and revokeBan to return user context via findOneAndUpdate"
```

---

### Task 4: 更新 editBan

**Files:**
- Modify: `server/utils/ban.repository.ts` (editBan 函数)
- Modify: `tests/utils/ban.repository.test.ts` (editBan 测试)

- [ ] **Step 1: 更新 editBan 测试**

替换整个 `describe("editBan", ...)` 块为：

```typescript
describe("editBan", () => {
  it("returns old and new ban records with user context", async () => {
    const banStart = new Date("2026-03-01T00:00:00Z");
    const oldEnd = new Date("2026-06-01T00:00:00Z");
    mockFindOneAndUpdate.mockResolvedValue({
      uuid: "user-uuid",
      email: "user@test.com",
      gameId: "Player1",
      bans: [{ id: "ban-id", start: banStart, end: oldEnd, reason: "old reason", operatorId: "op" }],
    });
    const newEnd = new Date("2027-01-01T00:00:00Z");
    const result = await banRepo.editBan("user-uuid", "ban-id", { end: newEnd, reason: "updated" });

    const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid", "bans.id": "ban-id" });
    expect(update.$set["bans.$.end"]).toEqual(newEnd);
    expect(update.$set["bans.$.reason"]).toBe("updated");
    expect(options.returnDocument).toBe("before");

    expect(result).toEqual({
      success: true,
      old: { id: "ban-id", start: banStart, end: oldEnd, reason: "old reason", operatorId: "op" },
      new: { id: "ban-id", start: banStart, end: newEnd, reason: "updated", operatorId: "op" },
      user: { uuid: "user-uuid", email: "user@test.com", gameId: "Player1" },
    });
  });

  it("handles $unset end (make permanent) — removes end from new ban", async () => {
    const banStart = new Date("2026-03-01T00:00:00Z");
    const oldEnd = new Date("2026-06-01T00:00:00Z");
    mockFindOneAndUpdate.mockResolvedValue({
      uuid: "user-uuid",
      email: "u@t.com",
      gameId: "P",
      bans: [{ id: "ban-id", start: banStart, end: oldEnd, operatorId: "op" }],
    });
    const result = await banRepo.editBan("user-uuid", "ban-id", { end: null });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$unset["bans.$.end"]).toBe("");

    expect(result.success).toBe(true);
    if (result.success && "old" in result) {
      expect(result.old.end).toEqual(oldEnd);
      expect(result.new).not.toHaveProperty("end");
    }
  });

  it("returns { success: true } without old/new when no fields to update", async () => {
    const result = await banRepo.editBan("user-uuid", "ban-id", {});
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("returns failure when ban not found", async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);
    const result = await banRepo.editBan("user-uuid", "ban-id", { reason: "x" });
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: FAIL — `editBan` 测试失败（实现仍使用 `updateOne`）。

- [ ] **Step 3: 更新 editBan 实现**

替换 `editBan` 函数：

```typescript
export async function editBan(
  userUuid: string,
  banId: string,
  opts: { end?: Date | null; reason?: string },
): Promise<
  | { success: true; old: BanRecord; new: BanRecord; user: BanOpUserContext }
  | { success: true }
  | { success: false; error: string }
> {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, unknown> = {};

  if (opts.end === null) {
    $unset["bans.$.end"] = "";
  } else if (opts.end !== undefined) {
    $set["bans.$.end"] = opts.end;
  }

  if (opts.reason !== undefined) {
    $set["bans.$.reason"] = opts.reason;
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;

  if (Object.keys(update).length === 0) {
    return { success: true };
  }

  const doc = await getUserCollection().findOneAndUpdate(
    { uuid: userUuid, "bans.id": banId },
    update,
    { returnDocument: "before", projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
  );

  if (!doc) {
    return { success: false, error: "封禁记录不存在" };
  }

  const oldBan = doc.bans.find((b) => b.id === banId)!;

  // Construct new ban from old + applied changes
  const newBan: BanRecord = { ...oldBan };
  if (opts.end === null) {
    delete newBan.end;
  } else if (opts.end !== undefined) {
    newBan.end = opts.end;
  }
  if (opts.reason !== undefined) {
    newBan.reason = opts.reason;
  }

  return {
    success: true,
    old: oldBan,
    new: newBan,
    user: { uuid: doc.uuid, email: doc.email, gameId: doc.gameId },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: 所有 `editBan` 测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/utils/ban.repository.ts tests/utils/ban.repository.test.ts
git commit -m "feat(plugin): update editBan to return old/new snapshots via findOneAndUpdate"
```

---

### Task 5: 更新 removeBan

**Files:**
- Modify: `server/utils/ban.repository.ts` (removeBan 函数)
- Modify: `tests/utils/ban.repository.test.ts` (removeBan 测试)

- [ ] **Step 1: 更新 removeBan 测试**

替换整个 `describe("removeBan", ...)` 块为：

```typescript
describe("removeBan", () => {
  it("pulls ban record and returns removed ban with wasActive and user context", async () => {
    const now = new Date();
    const activeBan = { id: "ban-id", start: new Date(now.getTime() - 1000), operatorId: "op" };
    mockFindOne.mockResolvedValue({
      uuid: "user-uuid",
      email: "user@test.com",
      gameId: "Player1",
      bans: [activeBan],
    });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.removeBan("user-uuid", "ban-id");

    expect(mockFindOne).toHaveBeenCalledWith(
      { uuid: "user-uuid" },
      { projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
    );
    expect(mockUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ uuid: "user-uuid" });
    expect(update.$pull.bans).toEqual({ id: "ban-id" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.removed).toEqual(activeBan);
      expect(result.wasActive).toBe(true);
      expect(result.user).toEqual({ uuid: "user-uuid", email: "user@test.com", gameId: "Player1" });
    }
  });

  it("sets wasActive to false for revoked ban", async () => {
    const revokedBan = {
      id: "ban-id",
      start: new Date("2026-01-01"),
      operatorId: "op",
      revokedAt: new Date("2026-02-01"),
      revokedBy: "admin",
    };
    mockFindOne.mockResolvedValue({
      uuid: "user-uuid",
      email: "u@t.com",
      gameId: "P",
      bans: [revokedBan],
    });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.removeBan("user-uuid", "ban-id");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.wasActive).toBe(false);
    }
  });

  it("sets wasActive to false for expired ban", async () => {
    const expiredBan = {
      id: "ban-id",
      start: new Date("2025-01-01"),
      end: new Date("2025-06-01"),
      operatorId: "op",
    };
    mockFindOne.mockResolvedValue({
      uuid: "user-uuid",
      email: "u@t.com",
      gameId: "P",
      bans: [expiredBan],
    });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const result = await banRepo.removeBan("user-uuid", "ban-id");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.wasActive).toBe(false);
    }
  });

  it("returns failure when ban not found", async () => {
    mockFindOne.mockResolvedValue({ uuid: "user-uuid", email: "u@t.com", gameId: "P", bans: [] });
    const result = await banRepo.removeBan("user-uuid", "nonexistent");
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });

  it("returns failure when user not found", async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await banRepo.removeBan("user-uuid", "ban-id");
    expect(result).toEqual({ success: false, error: "封禁记录不存在" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: FAIL — `removeBan` 测试因新断言失败。

- [ ] **Step 3: 更新 removeBan 实现**

替换 `removeBan` 函数：

```typescript
export async function removeBan(
  userUuid: string,
  banId: string,
): Promise<
  | { success: true; removed: BanRecord; wasActive: boolean; user: BanOpUserContext }
  | { success: false; error: string }
> {
  const user = await getUserCollection().findOne(
    { uuid: userUuid },
    { projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
  );

  const ban = user?.bans?.find((b) => b.id === banId);
  if (!ban) {
    return { success: false, error: "封禁记录不存在" };
  }

  const result = await getUserCollection().updateOne(
    { uuid: userUuid },
    { $pull: { bans: { id: banId } } },
  );

  if (result.modifiedCount === 0) {
    return { success: false, error: "封禁记录不存在" };
  }

  // Determine if the ban was active at removal time
  const now = new Date();
  const wasActive = !ban.revokedAt && ban.start <= now && (!ban.end || ban.end > now);

  return {
    success: true,
    removed: ban,
    wasActive,
    user: { uuid: user!.uuid, email: user!.email, gameId: user!.gameId },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk vitest run tests/utils/ban.repository.test.ts`
Expected: 所有测试 PASS。

- [ ] **Step 5: 验证 lint**

Run: `bun run lint`
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add server/utils/ban.repository.ts tests/utils/ban.repository.test.ts
git commit -m "feat(plugin): update removeBan to return wasActive and user context"
```

---

### Task 6: 接入 API Handler Hook

**Files:**
- Modify: `server/api/admin/users/[userId]/bans.post.ts`
- Modify: `server/api/admin/users/[userId]/bans/[banId].patch.ts`
- Modify: `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts`
- Modify: `server/api/admin/users/[userId]/bans/[banId].delete.ts`

- [ ] **Step 1: 更新 bans.post.ts（ban-created）**

替换 `server/api/admin/users/[userId]/bans.post.ts` 的整个默认导出函数体。移除旧的 `emitUserHook("user:banned", ...)` 和 `findUserByUuid` 调用，替换为：

```typescript
import { z } from "zod";

const bodySchema = z.object({
  end: z.string().optional(),
  reason: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  if (!userId) {
    return { success: false, error: "缺少用户 ID" };
  }

  // Prevent self-ban
  if (userId === admin.userId) {
    return { success: false, error: "不能封禁自己" };
  }

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const { end, reason } = parsed.data;

  // Validate reason length
  if (reason && reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  // Validate and parse end date
  let endDate: Date | undefined;
  if (end) {
    endDate = new Date(end);
    if (Number.isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    if (endDate <= new Date()) {
      return { success: false, error: "截止时间必须是未来时间" };
    }
  }

  const result = await addBan(
    userId,
    { end: endDate, reason: reason || undefined },
    admin.userId,
  );

  if (result.success) {
    emitUserHook("user:ban-created", {
      uuid: result.user.uuid,
      email: result.user.email,
      gameId: result.user.gameId,
      banId: result.banId,
      operator: admin.userId,
      timestamp: Date.now(),
      ban: toBanSnapshot(result.ban),
    });
  }

  return result.success
    ? { success: true, banId: result.banId }
    : { success: false, error: result.error };
});
```

注意：返回值仍然只暴露 `success` 和 `banId`，不暴露 `ban` / `user` 给前端。

- [ ] **Step 2: 更新 [banId].patch.ts（ban-edited）**

替换 `server/api/admin/users/[userId]/bans/[banId].patch.ts` 的整个文件内容：

```typescript
import { z } from "zod";

const bodySchema = z.object({
  end: z.string().nullable().optional(),
  reason: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const { end, reason } = parsed.data;

  if (reason !== undefined && reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  let endDate: Date | null | undefined;
  if (end === null) {
    endDate = null; // make permanent
  } else if (end !== undefined) {
    endDate = new Date(end);
    if (Number.isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    // No future-time check here: editing historical records may need past dates
  }

  const result = await editBan(userId, banId, {
    end: endDate,
    reason,
  });

  if (result.success && "old" in result) {
    const oldSnap = toBanSnapshot(result.old);
    const newSnap = toBanSnapshot(result.new);
    // Only emit hook if there's an actual change
    if (JSON.stringify(oldSnap) !== JSON.stringify(newSnap)) {
      emitUserHook("user:ban-edited", {
        uuid: result.user.uuid,
        email: result.user.email,
        gameId: result.user.gameId,
        banId,
        operator: admin.userId,
        timestamp: Date.now(),
        old: oldSnap,
        new: newSnap,
      });
    }
  }

  return { success: result.success, error: result.success ? undefined : result.error };
});
```

关键点：`"old" in result` 区分有实际 DB 操作的情况（返回 old/new）和无变更的提前返回（仅 `{ success: true }`）。`JSON.stringify` 对比确保值完全相同时不触发 hook。

- [ ] **Step 3: 更新 revoke.post.ts（ban-revoked）**

替换 `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts` 的整个文件内容：

```typescript
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await revokeBan(userId, banId, admin.userId);

  if (result.success) {
    emitUserHook("user:ban-revoked", {
      uuid: result.user.uuid,
      email: result.user.email,
      gameId: result.user.gameId,
      banId,
      operator: admin.userId,
      timestamp: Date.now(),
      ban: toBanSnapshot(result.ban),
    });
  }

  return { success: result.success, error: result.success ? undefined : result.error };
});
```

- [ ] **Step 4: 更新 [banId].delete.ts（ban-deleted）**

替换 `server/api/admin/users/[userId]/bans/[banId].delete.ts` 的整个文件内容：

```typescript
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await removeBan(userId, banId);

  if (result.success) {
    emitUserHook("user:ban-deleted", {
      uuid: result.user.uuid,
      email: result.user.email,
      gameId: result.user.gameId,
      banId,
      operator: admin.userId,
      timestamp: Date.now(),
      ban: toBanSnapshot(result.removed),
      wasActive: result.wasActive,
    });
  }

  return { success: result.success, error: result.success ? undefined : result.error };
});
```

注意：原有的 `console.info("[ban-audit]...")` 审计日志被移除——审计功能现由插件 hook 承担。

- [ ] **Step 5: 验证 lint**

Run: `bun run lint`
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add server/api/admin/users/[userId]/bans.post.ts server/api/admin/users/[userId]/bans/[banId].patch.ts "server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts" "server/api/admin/users/[userId]/bans/[banId].delete.ts"
git commit -m "feat(plugin): wire ban-created/edited/revoked/deleted hooks in API handlers"
```

---

### Task 7: 更新示例插件

**Files:**
- Modify: `docs/plugin-examples/discord-notify/plugin.yaml`
- Modify: `docs/plugin-examples/discord-notify/index.js`

- [ ] **Step 1: 更新 plugin.yaml**

替换 `docs/plugin-examples/discord-notify/plugin.yaml` 的 `hooks` 部分：

```yaml
name: Discord 通知
version: 1.0.0
description: 将用户事件推送到 Discord Webhook
author: Irminsul
hooks:
  - user:registered
  - user:login
  - user:ban-created
  - user:ban-edited
  - user:ban-revoked
  - user:ban-deleted
config:
  - key: webhookUrl
    label: Webhook URL
    type: text
    required: true
  - key: enableLogin
    label: 推送登录事件
    type: boolean
    default: false
```

- [ ] **Step 2: 更新 index.js**

替换 `docs/plugin-examples/discord-notify/index.js` 的整个文件内容：

```js
export function setup(ctx) {
  async function send(content) {
    const { webhookUrl } = ctx.config.getAll();
    if (!webhookUrl) return;
    await ctx.fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  ctx.hook("user:registered", (e) => {
    send(`📋 新用户注册：**${e.gameId}**（${e.email}）`);
  });

  ctx.hook("user:login", (e) => {
    const { enableLogin } = ctx.config.getAll();
    if (!enableLogin) return;
    const methods = { password: "密码", passkey: "Passkey", oauth: "OAuth" };
    send(`🔑 用户登录：**${e.gameId}**（${methods[e.method]}）`);
  });

  ctx.hook("user:ban-created", (e) => {
    const duration = e.ban.end
      ? `至 ${new Date(e.ban.end).toLocaleDateString()}`
      : "永久";
    send(
      `🚫 用户封禁：**${e.gameId}**（${duration}）${e.ban.reason ? `\n理由：${e.ban.reason}` : ""}`,
    );
  });

  ctx.hook("user:ban-edited", (e) => {
    const oldDuration = e.old.end
      ? `至 ${new Date(e.old.end).toLocaleDateString()}`
      : "永久";
    const newDuration = e.new.end
      ? `至 ${new Date(e.new.end).toLocaleDateString()}`
      : "永久";
    send(`📝 封禁变更：**${e.gameId}**\n${oldDuration} → ${newDuration}`);
  });

  ctx.hook("user:ban-revoked", (e) => {
    send(`✅ 用户解封：**${e.gameId}**`);
  });

  ctx.hook("user:ban-deleted", (e) => {
    const status = e.wasActive ? "（活跃封禁）" : "（已失效）";
    send(`🗑️ 封禁记录删除：**${e.gameId}**${status}`);
  });
}
```

- [ ] **Step 3: 提交**

```bash
git add docs/plugin-examples/discord-notify/plugin.yaml docs/plugin-examples/discord-notify/index.js
git commit -m "docs: update discord-notify example for new ban hook names"
```

---

### Task 8: 最终验证

**Files:** 无（仅验证）

- [ ] **Step 1: 运行全部测试**

Run: `rtk vitest run`
Expected: 所有测试通过，包括新增的 `ban-snapshot.test.ts` 和更新的 `ban.repository.test.ts`。

- [ ] **Step 2: 运行 lint**

Run: `bun run lint`
Expected: 无错误。

- [ ] **Step 3: 检查工作区状态**

Run: `rtk git status`
Expected: 工作区干净。
