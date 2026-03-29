# 封禁 Hook 重新设计

## 概述

移除原有的 `user:banned` / `user:unbanned` 两个粗粒度 hook，替换为 4 个细粒度封禁生命周期 hook：`user:ban-created`、`user:ban-edited`、`user:ban-revoked`、`user:ban-deleted`。同时优化 repository 层，消除 hook 触发时的额外数据库查询。

## 背景

原 `user:banned` / `user:unbanned` 存在以下问题：

1. **缺失触发点** — 编辑封禁和删除封禁记录未触发任何 hook
2. **额外 DB 查询** — 触发 hook 时需要额外调用 `findUserByUuid` 获取用户信息
3. **Payload 不完整** — 无 `banId`，插件无法关联后续操作；解封 hook 无封禁详情
4. **语义边界模糊** — 删除活跃封禁等于解封，但不触发 `user:unbanned`

## 设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| Hook 粒度 | 4 个独立 hook | 每种操作语义明确，插件可精确订阅所需事件 |
| 替换策略 | 移除旧 hook | 项目未发布，无兼容性负担 |
| DB 查询优化 | Repository 函数返回用户上下文 | `addBan`/`editBan`/`revokeBan` 使用 `findOneAndUpdate` 一次操作同时获取用户信息；`removeBan` 因 `$pull` 限制仍需两次操作但扩展投影避免第三次查询 |
| 编辑 hook payload | 完整 old/new 快照 | 插件无需自行追踪状态，直接获得变更前后的完整信息 |

## Hook 定义

### 通用 Payload 字段

所有封禁 hook 的 payload 都继承 `UserHookBasePayload`（`uuid`、`email`、`gameId`、`timestamp`），并额外包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `banId` | `string` | 封禁记录 ID |
| `operator` | `string` | 操作管理员 UUID |

### 封禁快照类型

用于在 payload 中传递封禁状态的轻量快照。所有时间字段（`start`、`end`、`revokedAt`）从 `BanRecord` 的 `Date` 类型转换为 `number` 时间戳（`.getTime()`），`reason` 等字符串字段直接透传：

```typescript
interface BanSnapshot {
  start: number;       // 时间戳（Date.getTime()）
  end?: number;        // 时间戳，undefined = 永久
  reason?: string;
  revokedAt?: number;  // 撤销时间戳（仅已撤销的记录有值）
  revokedBy?: string;  // 撤销操作人 UUID
}
```

### `user:ban-created`

创建新封禁后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ban` | `BanSnapshot` | 新封禁的信息 |

### `user:ban-edited`

编辑封禁（修改 end/reason）后触发。**仅在存在实际变更时触发**：若请求 body 不含可变更字段（提前返回），或字段值与现有值完全相同（old/new 快照一致），均不触发此 hook。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `old` | `BanSnapshot` | 编辑前的封禁状态 |
| `new` | `BanSnapshot` | 编辑后的封禁状态 |

### `user:ban-revoked`

撤销封禁后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ban` | `BanSnapshot` | 被撤销封禁的原始信息 |

### `user:ban-deleted`

物理删除封禁记录后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ban` | `BanSnapshot` | 被删除封禁的信息 |
| `wasActive` | `boolean` | 删除时该封禁是否仍活跃 |

### TypeScript 类型定义

```typescript
// BanSnapshot 定义见上方"封禁快照类型"部分

interface BanHookBasePayload extends UserHookBasePayload {
  banId: string;
  operator: string;
}

interface BanCreatedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
}

interface BanEditedPayload extends BanHookBasePayload {
  old: BanSnapshot;
  new: BanSnapshot;
}

interface BanRevokedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
}

interface BanDeletedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
  wasActive: boolean;
}
```

`UserHookPayloadMap` 中移除 `"user:banned"` / `"user:unbanned"`，新增：

```typescript
"user:ban-created": BanCreatedPayload;
"user:ban-edited": BanEditedPayload;
"user:ban-revoked": BanRevokedPayload;
"user:ban-deleted": BanDeletedPayload;
```

## 触发点

| Hook | 文件 | 时机 |
|------|------|------|
| `user:ban-created` | `server/api/admin/users/[userId]/bans.post.ts` | `addBan` 成功后 |
| `user:ban-edited` | `server/api/admin/users/[userId]/bans/[banId].patch.ts` | `editBan` 成功后 |
| `user:ban-revoked` | `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts` | `revokeBan` 成功后 |
| `user:ban-deleted` | `server/api/admin/users/[userId]/bans/[banId].delete.ts` | `removeBan` 成功后 |

## Repository 层优化

### 返回类型

各函数成功时额外返回用户上下文，供 API handler 构建 hook payload：

```typescript
interface BanOpUserContext {
  uuid: string;
  email: string;
  gameId: string;
}
```

### 各函数变更

**`addBan`**

- MongoDB 操作：`updateOne` → `findOneAndUpdate({ returnDocument: 'after' })`
- 成功返回：`{ success, banId, ban: BanRecord, user: BanOpUserContext }`
- 从返回的用户文档中提取 `uuid`/`email`/`gameId` 和新增的 ban 记录

**`editBan`**

- MongoDB 操作：`updateOne` → `findOneAndUpdate({ returnDocument: 'before' })`
- 成功返回：`{ success, old: BanRecord, new: BanRecord, user: BanOpUserContext }`
- 从旧文档提取 old ban 状态，new ban = old ban + 应用的变更字段
- **`$unset` 处理**：当 `end: null`（改为永久封禁）时，使用 `$unset` 移除 `end` 字段。构造 new 快照时需显式删除 `end` 属性（而非设为 `null`/`undefined`），确保 new 快照中无 `end` 字段表示永久封禁
- **无实际变更时**：若请求 body 无可变更字段则提前返回 `{ success: true }`，不查 DB 也不触发 hook；若 `findOneAndUpdate` 执行后 old/new 快照完全相同，同样不触发 hook

**`revokeBan`**

- MongoDB 操作：`updateOne` → `findOneAndUpdate({ returnDocument: 'before' })`
- 成功返回：`{ success, ban: BanRecord, user: BanOpUserContext }`
- 从旧文档提取被撤销的 ban 记录（revoke 前的状态）

**`removeBan`**

- MongoDB 操作：不变（已有 `findOne` + `updateOne`，共两次 DB 操作）。`$pull` 操作无法通过 `findOneAndUpdate` 返回被删除的数组元素，因此此函数是四个函数中的例外，无法进一步缩减为单次操作。优化仅限于扩展 `findOne` 投影以同时获取用户上下文，避免第三次 `findUserByUuid` 调用
- 成功返回：`{ success, removed: BanRecord, wasActive: boolean, user: BanOpUserContext }`
- 扩展 `findOne` 投影以包含 `uuid`/`email`/`gameId`，用 `hasActiveBan` 逻辑判断单条 ban 的 `wasActive`

## API Handler 层变更

所有 4 个 handler 遵循统一模式。注意 `BanRecord`（`Date` 类型）到 `BanSnapshot`（`number` 时间戳）的转换在 handler 层完成：

```typescript
const result = await xxxBan(...);
if (result.success) {
  // BanRecord → BanSnapshot 转换：Date 字段调用 .getTime()
  const banSnapshot = {
    start: result.ban.start.getTime(),
    ...(result.ban.end && { end: result.ban.end.getTime() }),
    ...(result.ban.reason && { reason: result.ban.reason }),
    ...(result.ban.revokedAt && {
      revokedAt: result.ban.revokedAt.getTime(),
      revokedBy: result.ban.revokedBy,
    }),
  };

  emitUserHook("user:ban-xxx", {
    uuid: result.user.uuid,
    email: result.user.email,
    gameId: result.user.gameId,
    banId: result.ban.id,
    operator: admin.userId,
    timestamp: Date.now(),
    ban: banSnapshot,
  });
}
return result; // 前端可见的返回字段不变
```

建议将 `BanRecord → BanSnapshot` 转换提取为一个辅助函数（如 `toBanSnapshot`），供 4 个 handler 共用，避免重复代码。

具体变更：

- `bans.post.ts`：移除旧 `emitUserHook("user:banned", ...)` 及 `findUserByUuid` 调用
- `[banId].patch.ts`：捕获 `requireAdmin` 返回值（当前未捕获），新增 hook 调用
- `[banId]/revoke.post.ts`：移除旧 `emitUserHook("user:unbanned", ...)` 及 `findUserByUuid` 调用
- `[banId].delete.ts`：新增 hook 调用

API 返回给前端的字段保持不变，`user` 等内部字段不暴露。

## 清理项

### 类型系统

- `KNOWN_EVENT_HOOKS`：移除 `"user:banned"` / `"user:unbanned"`，新增 4 个
- 删除 `UserBannedPayload` / `UserUnbannedPayload` 接口
- `UserHookPayloadMap`：替换对应映射

### 示例插件

- `docs/plugin-examples/discord-notify/`：
  - `plugin.yaml`：订阅列表中 `user:banned` / `user:unbanned` 替换为 `user:ban-created`、`user:ban-edited`、`user:ban-revoked`、`user:ban-deleted`
  - `index.js`：原 `user:banned` handler 映射为 `user:ban-created`；原 `user:unbanned` handler 映射为 `user:ban-revoked`；新增 `user:ban-edited`（通知封禁变更详情）和 `user:ban-deleted`（通知封禁记录被删除）的 handler

### 旧文档

- 不修改旧 spec/plan 文档（历史记录），本 spec 替代它们

## 测试策略

### Repository 层

- 更新 `tests/utils/ban.repository.test.ts`，覆盖新的返回值结构（`user` 字段、`old`/`new` 快照、`wasActive` 等）
- 现有 `tests/utils/plugin.emit-user-hook.test.ts` 和 `tests/utils/plugin.emit-helper.test.ts` 不受影响（测试通用 dispatch 逻辑）

### API Handler 层

为 4 个 API handler 编写 hook 触发验证测试，覆盖：

- 各操作成功时 `emitUserHook` 被调用，且 hook name 和 payload 结构正确
- 操作失败时（如用户不存在、封禁记录不存在）`emitUserHook` 不被调用
- `editBan` 无实际变更时不触发 `user:ban-edited`
- `BanRecord` → `BanSnapshot` 转换正确（Date → number 时间戳）

## 需要修改的文件

| 文件 | 变更 |
|------|------|
| `server/utils/plugin/types.ts` | 移除旧 hook/payload，新增 4 个 hook 类型定义 |
| `server/utils/ban.repository.ts` | 4 个函数改用 `findOneAndUpdate`，返回用户上下文 |
| `server/api/admin/users/[userId]/bans.post.ts` | 替换为 `user:ban-created`，移除 `findUserByUuid` |
| `server/api/admin/users/[userId]/bans/[banId].patch.ts` | 新增 `user:ban-edited` 触发 |
| `server/api/admin/users/[userId]/bans/[banId]/revoke.post.ts` | 替换为 `user:ban-revoked`，移除 `findUserByUuid` |
| `server/api/admin/users/[userId]/bans/[banId].delete.ts` | 新增 `user:ban-deleted` 触发 |
| `tests/utils/ban.repository.test.ts` | 更新测试覆盖新返回值 |
| `docs/plugin-examples/discord-notify/plugin.yaml` | 更新 hook 订阅列表 |
| `docs/plugin-examples/discord-notify/index.js` | 替换 hook handler |
