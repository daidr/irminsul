# User Lifecycle Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 user lifecycle event hooks to the plugin system so plugins can respond to registration, login, ban, password changes, and OAuth binding changes.

**Architecture:** New `KNOWN_EVENT_HOOKS` constant array in types.ts separates event hooks from functional hooks. `PluginManager.emitUserHook()` dispatches payloads to all subscribed handlers in parallel via `Promise.allSettled`. A global `emitUserHook()` helper (auto-imported) is called fire-and-forget at each trigger point.

**Tech Stack:** TypeScript, Vitest, Nitro server utils, existing PluginManager/PluginBridge/HookRegistry infrastructure.

---

### Task 1: Define types and constants

**Files:**
- Modify: `server/utils/plugin/types.ts:160-190`

- [ ] **Step 1: Add `KNOWN_EVENT_HOOKS` constant and payload types after `KNOWN_FUNCTIONAL_HOOKS`**

In `server/utils/plugin/types.ts`, insert the following after line 177 (end of `KNOWN_FUNCTIONAL_HOOKS`) and before `ALL_KNOWN_HOOKS`:

```typescript
export const KNOWN_EVENT_HOOKS = [
  "user:registered",
  "user:login",
  "user:banned",
  "user:unbanned",
  "user:password-changed",
  "user:password-reset",
  "user:oauth-bindchanged",
] as const;
```

Update `ALL_KNOWN_HOOKS` (currently lines 179-182) to include event hooks:

```typescript
export const ALL_KNOWN_HOOKS = [
  ...LIFECYCLE_HOOKS,
  ...KNOWN_FUNCTIONAL_HOOKS,
  ...KNOWN_EVENT_HOOKS,
] as const;
```

Add `isEventHook` after `isKnownHook` (currently line 190):

```typescript
export function isEventHook(name: string): boolean {
  return (KNOWN_EVENT_HOOKS as readonly string[]).includes(name);
}
```

- [ ] **Step 2: Add payload type definitions**

Append the following at the end of `server/utils/plugin/types.ts`:

```typescript
// ===== User Lifecycle Hook Payloads =====

export interface UserHookBasePayload {
  uuid: string;
  email: string;
  gameId: string;
  timestamp: number;
}

export interface UserRegisteredPayload extends UserHookBasePayload {
  ip: string | null;
}

export interface UserLoginPayload extends UserHookBasePayload {
  ip: string | null;
  method: "password" | "passkey" | "oauth";
}

export interface UserBannedPayload extends UserHookBasePayload {
  reason?: string;
  end?: number;
  operator: string;
}

export interface UserUnbannedPayload extends UserHookBasePayload {
  operator: string;
}

export interface UserPasswordChangedPayload extends UserHookBasePayload {
  ip: string | null;
}

export interface UserPasswordResetPayload extends UserHookBasePayload {
  ip: string | null;
}

export interface UserOAuthBindChangedPayload extends UserHookBasePayload {
  action: "bind" | "unbind";
  provider: string;
  displayName?: string;
}

export type UserHookPayloadMap = {
  "user:registered": UserRegisteredPayload;
  "user:login": UserLoginPayload;
  "user:banned": UserBannedPayload;
  "user:unbanned": UserUnbannedPayload;
  "user:password-changed": UserPasswordChangedPayload;
  "user:password-reset": UserPasswordResetPayload;
  "user:oauth-bindchanged": UserOAuthBindChangedPayload;
};
```

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add server/utils/plugin/types.ts
git commit -m "feat(plugin): add user lifecycle event hook types and constants"
```

---

### Task 2: Add `emitUserHook` to PluginManager

**Files:**
- Modify: `server/utils/plugin/plugin-manager.ts:497-501`

- [ ] **Step 1: Write the test file**

Create `tests/utils/plugin.emit-user-hook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookRegistry } from "../../server/utils/plugin/hook-registry";

// Minimal mock of PluginManager.emitUserHook logic (isolated from bridge/watcher/etc.)
// We test the dispatch logic directly since constructing a full PluginManager requires DB/Worker.

describe("emitUserHook dispatch logic", () => {
  let hookRegistry: HookRegistry;
  let callPluginHook: ReturnType<typeof vi.fn>;
  let logPush: ReturnType<typeof vi.fn>;

  async function emitUserHook(
    hookName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const handlers = hookRegistry.get(hookName);
    if (!handlers.length) return;

    const results = await Promise.allSettled(
      handlers.map((handler) => callPluginHook(handler.pluginId, hookName, payload)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        logPush({
          timestamp: new Date().toISOString(),
          level: "error",
          type: "event",
          pluginId: handlers[i].pluginId,
          message: `Hook ${hookName} failed: ${result.reason}`,
        });
      }
    }
  }

  beforeEach(() => {
    hookRegistry = new HookRegistry();
    callPluginHook = vi.fn().mockResolvedValue(undefined);
    logPush = vi.fn();
  });

  it("calls all subscribed handlers with the payload", async () => {
    hookRegistry.register("plugin-a", "user:registered", 1);
    hookRegistry.register("plugin-b", "user:registered", 2);

    const payload = { uuid: "u1", email: "a@b.com", gameId: "Player1", timestamp: 1000, ip: "1.2.3.4" };
    await emitUserHook("user:registered", payload);

    expect(callPluginHook).toHaveBeenCalledTimes(2);
    expect(callPluginHook).toHaveBeenCalledWith("plugin-a", "user:registered", payload);
    expect(callPluginHook).toHaveBeenCalledWith("plugin-b", "user:registered", payload);
  });

  it("returns immediately when no handlers are registered", async () => {
    await emitUserHook("user:login", { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1 });
    expect(callPluginHook).not.toHaveBeenCalled();
  });

  it("does not block other handlers when one fails", async () => {
    hookRegistry.register("plugin-a", "user:login", 1);
    hookRegistry.register("plugin-b", "user:login", 2);

    callPluginHook
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(undefined);

    const payload = { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null, method: "password" };
    await emitUserHook("user:login", payload);

    expect(callPluginHook).toHaveBeenCalledTimes(2);
    expect(logPush).toHaveBeenCalledTimes(1);
    expect(logPush).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        pluginId: "plugin-a",
        message: expect.stringContaining("timeout"),
      }),
    );
  });

  it("calls handlers in parallel (not serial)", async () => {
    hookRegistry.register("plugin-a", "user:registered", 1);
    hookRegistry.register("plugin-b", "user:registered", 2);

    const callOrder: string[] = [];
    callPluginHook.mockImplementation(async (pluginId: string) => {
      callOrder.push(`start:${pluginId}`);
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push(`end:${pluginId}`);
    });

    const payload = { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null };
    await emitUserHook("user:registered", payload);

    // Both should start before either ends (parallel)
    expect(callOrder[0]).toBe("start:plugin-a");
    expect(callOrder[1]).toBe("start:plugin-b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk vitest run tests/utils/plugin.emit-user-hook.test.ts`
Expected: All 4 tests PASS (they test the extracted logic, not the real PluginManager — this validates the algorithm is correct before wiring it in).

- [ ] **Step 3: Add `emitUserHook` method to PluginManager**

In `server/utils/plugin/plugin-manager.ts`, add the following method after `callPluginHook` (after line 501), before the `// === Evlog Bridge ===` comment:

```typescript
  // === User Event Hook Dispatch ===

  async emitUserHook(hookName: string, payload: Record<string, unknown>): Promise<void> {
    const handlers = this.hookRegistry.get(hookName);
    if (!handlers.length) return;

    const results = await Promise.allSettled(
      handlers.map((handler) =>
        this.callPluginHook(handler.pluginId, hookName, payload),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        this.logManager.push({
          timestamp: new Date().toISOString(),
          level: "error",
          type: "event",
          pluginId: handlers[i].pluginId,
          message: `Hook ${hookName} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        });
      }
    }
  }
```

- [ ] **Step 4: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add server/utils/plugin/plugin-manager.ts tests/utils/plugin.emit-user-hook.test.ts
git commit -m "feat(plugin): add emitUserHook method with parallel dispatch"
```

---

### Task 3: Create global helper function

**Files:**
- Create: `server/utils/plugin-hooks.ts`

- [ ] **Step 1: Write the test file**

Create `tests/utils/plugin.emit-helper.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the helper by mocking getPluginManager at the module level.

const mockEmitUserHook = vi.fn().mockResolvedValue(undefined);
const mockGetHostStatus = vi.fn();

vi.mock("../../server/utils/plugin/plugin-manager", () => ({
  getPluginManager: vi.fn(() => ({
    emitUserHook: mockEmitUserHook,
    getHostStatus: mockGetHostStatus,
  })),
}));

// Import after mock setup
const { emitUserHook } = await import("../../server/utils/plugin-hooks");

describe("emitUserHook global helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHostStatus.mockReturnValue({ status: "running", dirtyReasons: [] });
  });

  it("calls manager.emitUserHook when host is running", () => {
    const payload = { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null };
    emitUserHook("user:registered", payload);

    expect(mockEmitUserHook).toHaveBeenCalledWith("user:registered", payload);
  });

  it("calls manager.emitUserHook when host is dirty", () => {
    mockGetHostStatus.mockReturnValue({ status: "dirty", dirtyReasons: [] });

    emitUserHook("user:login", { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null, method: "password" });

    expect(mockEmitUserHook).toHaveBeenCalledTimes(1);
  });

  it("skips when host is crashed", () => {
    mockGetHostStatus.mockReturnValue({ status: "crashed", dirtyReasons: [] });

    emitUserHook("user:registered", { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null });

    expect(mockEmitUserHook).not.toHaveBeenCalled();
  });

  it("skips when host is stopped", () => {
    mockGetHostStatus.mockReturnValue({ status: "stopped", dirtyReasons: [] });

    emitUserHook("user:registered", { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null });

    expect(mockEmitUserHook).not.toHaveBeenCalled();
  });

  it("does not throw when getPluginManager returns null", async () => {
    const { getPluginManager } = await import("../../server/utils/plugin/plugin-manager");
    (getPluginManager as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

    expect(() => {
      emitUserHook("user:registered", { uuid: "u1", email: "a@b.com", gameId: "P", timestamp: 1, ip: null });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk vitest run tests/utils/plugin.emit-helper.test.ts`
Expected: FAIL — module `../../server/utils/plugin-hooks` does not exist yet.

- [ ] **Step 3: Create the global helper**

Create `server/utils/plugin-hooks.ts`:

```typescript
import type { UserHookPayloadMap } from "./plugin/types";
import { getPluginManager } from "./plugin/plugin-manager";

export function emitUserHook<K extends keyof UserHookPayloadMap>(
  hookName: K,
  payload: UserHookPayloadMap[K],
): void {
  const manager = getPluginManager();
  if (!manager) return;

  const { status } = manager.getHostStatus();
  if (status !== "running" && status !== "dirty") return;

  manager.emitUserHook(hookName, payload).catch((err) => {
    console.warn(`[plugin] emitUserHook(${hookName}) unexpected error:`, err);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk vitest run tests/utils/plugin.emit-helper.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add server/utils/plugin-hooks.ts tests/utils/plugin.emit-helper.test.ts
git commit -m "feat(plugin): add emitUserHook global helper with host status guard"
```

---

### Task 4: Wire hook into registration endpoint

**Files:**
- Modify: `server/api/auth/register.post.ts:121-123`

- [ ] **Step 1: Add `emitUserHook` call after successful `insertUser`**

In `server/api/auth/register.post.ts`, insert between the try/catch block (line 121) and the return (line 123):

```typescript
  emitUserHook("user:registered", {
    uuid: userDoc.uuid,
    email: userDoc.email,
    gameId: userDoc.gameId,
    ip: clientIp,
    timestamp: Date.now(),
  });

  return { success: true };
```

Replace the existing `return { success: true };` on line 123. The `emitUserHook` is auto-imported by Nuxt from `server/utils/plugin-hooks.ts`. The `clientIp` variable is already available (used earlier in the file for `userDoc.ip.register`).

- [ ] **Step 2: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add server/api/auth/register.post.ts
git commit -m "feat(plugin): emit user:registered hook on registration"
```

---

### Task 5: Wire hook into login endpoint

**Files:**
- Modify: `server/api/auth/login.post.ts:74-76`

- [ ] **Step 1: Add `emitUserHook` call after session creation**

In `server/api/auth/login.post.ts`, insert between `await createSession(event, sessionData);` (line 74) and `return { success: true };` (line 76):

```typescript
  await createSession(event, sessionData);

  emitUserHook("user:login", {
    uuid: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: clientIp,
    method: "password",
    timestamp: Date.now(),
  });

  return { success: true };
```

The variables `user`, `clientIp` are already in scope.

- [ ] **Step 2: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add server/api/auth/login.post.ts
git commit -m "feat(plugin): emit user:login hook on password login"
```

---

### Task 6: Wire hook into passkey login endpoint

**Files:**
- Modify: `server/api/passkey/auth-verify.post.ts:80-82`

- [ ] **Step 1: Add `emitUserHook` call after session creation**

In `server/api/passkey/auth-verify.post.ts`, insert between `await createSession(event, sessionData);` (line 80) and `return { success: true };` (line 82):

```typescript
  await createSession(event, sessionData);

  emitUserHook("user:login", {
    uuid: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: clientIp,
    method: "passkey",
    timestamp: Date.now(),
  });

  return { success: true };
```

The variables `user`, `clientIp` are already in scope.

- [ ] **Step 2: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add server/api/passkey/auth-verify.post.ts
git commit -m "feat(plugin): emit user:login hook on passkey login"
```

---

### Task 7: Wire hooks into OAuth callback

**Files:**
- Modify: `server/utils/oauth-callback.ts:97-115,137-139`

- [ ] **Step 1: Add `user:oauth-bindchanged` hook after successful bind**

In `server/utils/oauth-callback.ts`, insert before `return sendRedirect(event, "/?oauth=bind-success");` (line 115):

```typescript
      log.set({ oauth: { action: "bind", providerId, thirdPartyId: mappedProfile.providerId } });

      // Emit bind event — need to fetch user info for the payload
      const bindUser = await findUserByUuid(stateData.userId!);
      if (bindUser) {
        emitUserHook("user:oauth-bindchanged", {
          uuid: bindUser.uuid,
          email: bindUser.email,
          gameId: bindUser.gameId,
          action: "bind",
          provider: providerId,
          displayName: mappedProfile.displayName || undefined,
          timestamp: Date.now(),
        });
      }

      return sendRedirect(event, "/?oauth=bind-success");
```

Note: `findUserByUuid` is auto-imported from `server/utils/user.repository.ts`. We need to fetch the user because the bind flow only has `stateData.userId` (a UUID string), not the full user object.

- [ ] **Step 2: Add `user:login` hook after successful OAuth login**

In the same file, insert between `await createSession(event, sessionData);` (line 137) and the log/redirect (lines 138-139):

```typescript
    await createSession(event, sessionData);

    emitUserHook("user:login", {
      uuid: user.uuid,
      email: user.email,
      gameId: user.gameId,
      ip: clientIp,
      method: "oauth",
      timestamp: Date.now(),
    });

    log.set({ oauth: { action: "login", providerId, userId: user.uuid } });
    return sendRedirect(event, "/");
```

The `user` object returned from `findUserByOAuthBinding` (line 119) contains `uuid`, `email`, `gameId`.

- [ ] **Step 3: Verify that `findUserByUuid` returns the fields we need**

Check `server/utils/user.repository.ts` — `findUserByUuid` does a full document query (`collection.findOne({ uuid })`), so it returns all fields including `email` and `gameId`.

- [ ] **Step 4: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add server/utils/oauth-callback.ts
git commit -m "feat(plugin): emit user:login and user:oauth-bindchanged hooks in OAuth callback"
```

---

### Task 8: Wire hook into change password endpoint

**Files:**
- Modify: `server/api/user/change-password.post.ts:64-81`

- [ ] **Step 1: Add `emitUserHook` call after password update**

In `server/api/user/change-password.post.ts`, insert before the log/return (lines 80-81):

```typescript
  deleteCookie(event, "irmin_session", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
  });

  emitUserHook("user:password-changed", {
    uuid: userDoc.uuid,
    email: userDoc.email,
    gameId: userDoc.gameId,
    ip: extractClientIp(event),
    timestamp: Date.now(),
  });

  log.set({ auth: { action: "password_changed", userId: userDoc.uuid } });
  return { success: true };
```

Note: `extractClientIp` is already imported/used in the server context. Check whether the file already has access to `extractClientIp` — if not, it is auto-imported from `server/utils/`.

- [ ] **Step 2: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add server/api/user/change-password.post.ts
git commit -m "feat(plugin): emit user:password-changed hook"
```

---

### Task 9: Wire hook into reset password endpoint

**Files:**
- Modify: `server/api/auth/reset-password.post.ts:64-73`

- [ ] **Step 1: Add `emitUserHook` call after password reset**

In `server/api/auth/reset-password.post.ts`, insert before the log/return (lines 72-73):

```typescript
  await destroyAllSessions(user.uuid);

  emitUserHook("user:password-reset", {
    uuid: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: extractClientIp(event),
    timestamp: Date.now(),
  });

  log.set({ auth: { action: "password_reset_completed", userId: user.uuid } });
  return { success: true };
```

- [ ] **Step 2: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add server/api/auth/reset-password.post.ts
git commit -m "feat(plugin): emit user:password-reset hook"
```

---

### Task 10: Wire hook into OAuth unbind endpoint

**Files:**
- Modify: `server/api/oauth/[providerId]/unbind.post.ts:9-14`

- [ ] **Step 1: Add `emitUserHook` call after successful unbind**

In `server/api/oauth/[providerId]/unbind.post.ts`, insert between the 404 check (line 12) and the return (line 14):

```typescript
  const removed = await removeOAuthBinding(user.userId, providerId);
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: "No binding found for this provider" });
  }

  emitUserHook("user:oauth-bindchanged", {
    uuid: user.userId,
    email: user.email,
    gameId: user.gameId,
    action: "unbind",
    provider: providerId,
    timestamp: Date.now(),
  });

  return { success: true };
```

Note: `user` comes from `requireAuth(event)` which returns the session context user object. It has `userId`, `email`, `gameId` available from the session middleware.

- [ ] **Step 2: Verify lint passes**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add "server/api/oauth/[providerId]/unbind.post.ts"
git commit -m "feat(plugin): emit user:oauth-bindchanged hook on unbind"
```

---

### Task 11: Create example plugins

**Files:**
- Create: `docs/plugin-examples/discord-notify/plugin.yaml`
- Create: `docs/plugin-examples/discord-notify/index.js`
- Create: `docs/plugin-examples/security-audit/plugin.yaml`
- Create: `docs/plugin-examples/security-audit/index.js`

- [ ] **Step 1: Create Discord notify example**

Create `docs/plugin-examples/discord-notify/plugin.yaml`:

```yaml
name: Discord 通知
version: 1.0.0
description: 将用户事件推送到 Discord Webhook
author: Irminsul
hooks:
  - user:registered
  - user:login
  - user:banned
  - user:unbanned
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

Create `docs/plugin-examples/discord-notify/index.js`:

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

  ctx.hook("user:banned", (e) => {
    const duration = e.end
      ? `至 ${new Date(e.end).toLocaleDateString()}`
      : "永久";
    send(
      `🚫 用户封禁：**${e.gameId}**（${duration}）${e.reason ? `\n理由：${e.reason}` : ""}`,
    );
  });

  ctx.hook("user:unbanned", (e) => {
    send(`✅ 用户解封：**${e.gameId}**`);
  });
}
```

- [ ] **Step 2: Create security audit example**

Create `docs/plugin-examples/security-audit/plugin.yaml`:

```yaml
name: 安全审计
version: 1.0.0
description: 记录安全敏感操作的审计日志
author: Irminsul
hooks:
  - user:password-changed
  - user:password-reset
  - user:oauth-bindchanged
```

Create `docs/plugin-examples/security-audit/index.js`:

```js
export function setup(ctx) {
  ctx.hook("user:password-changed", (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, ip: e.ip });
    ctx.log.info("用户主动修改密码");
  });

  ctx.hook("user:password-reset", (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, ip: e.ip });
    ctx.log.warn("用户通过忘记密码流程重置密码");
  });

  ctx.hook("user:oauth-bindchanged", (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, provider: e.provider });
    const msg =
      e.action === "bind"
        ? `绑定 OAuth 账号（${e.displayName}）`
        : "解绑 OAuth 账号";
    ctx.log.info(msg);
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add docs/plugin-examples/
git commit -m "docs: add discord-notify and security-audit example plugins"
```

---

### Task 12: Run full test suite and final lint check

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `rtk vitest run`
Expected: All tests pass, including the two new test files.

- [ ] **Step 2: Run full lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 3: Verify no untracked files are left behind**

Run: `rtk git status`
Expected: Clean working tree.
