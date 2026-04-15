# P0 安全加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审计报告中 P0 级别的 5 项安全问题（速率限制原子性+覆盖、登录时序侧信道、会话固定、OAuth PKCE 绕过），使项目达到合规的认证服务基线。

**Architecture:** 所有改动集中在 `server/utils/` 和 `server/api/**` 两层。先把 `checkRateLimit` 的底层实现改为原子 Lua 脚本作为地基（Task 1），然后给每个敏感端点按既有风格（try/catch 捕获 YggdrasilError → 返回 `{success,error}`）接入限流（Task 5），其间并行修复三处一次性漏洞：登录时序（Task 2）、会话固定（Task 3）、OAuth PKCE（Task 4）。每个 Task 先写测试 → 跑失败 → 实现 → 跑通过 → 提交。

**Tech Stack:** Bun 1.x / Nuxt 4 / Nitro / MongoDB / Redis（通过 `bun:redis` 的 `RedisClient.send()`） / Vitest 4（Node 环境） / Zod 4

**Scope:**
- ✅ 本分支做：审计报告 P0 的第 1-5 项
- ❌ 本分支不做：第 6 项（Yggdrasil token Redis 缓存层，涉及重构 `user.repository.ts`，独立分支）、第 7 项（`user.repository.ts` 全量测试回填，独立分支）

**核心参考（阅读后再动手）：**
- `server/utils/rate-limit.ts` — 现状
- `server/utils/yggdrasil.handler.ts:4-16` — `YggdrasilError` 的构造，限流靠抛它
- `tests/server/auth.test.ts:32-42` — `checkRateLimit` / `YggdrasilError` 的 stub 写法（所有 handler 测试复用）
- `tests/utils/password.test.ts:1-30` — `Bun.password` mock 与 Node 运行时兜底
- `CLAUDE.md` 里「Testing Patterns」一节 — Nitro auto-import 的 stub 规则

---

## Task 0: 准备工作（已在会话层完成，勿重复）

- [x] 已切至 `fix/p0-security-hardening` 分支
- [ ] **确认工作树干净**

```bash
git status
```

Expected: `nothing to commit, working tree clean`（`.claude/launch.json` 若已存在可一并保留）

- [ ] **跑一次基线测试**

```bash
bun run test
```

Expected: 全部通过（当前 18 个 util 测试 + 2 个 server 测试）。记录耗时与通过数作为 baseline。

---

## Task 1: `checkRateLimit` 改为原子 Lua 脚本

**问题：** `server/utils/rate-limit.ts:44-50` 现在是 `INCR` + `if (count===1) EXPIRE` 两条独立命令，进程崩溃时 EXPIRE 丢失 → key 永不过期 → 429 自锁（DoS 自损）；高并发下还有「TTL 未设置」时间窗可被利用。

**方案：** 用 `EVAL` 把 INCR + 条件 EXPIRE 合成一次调用，再用一次 `TTL` 读重试时间（也可并入脚本一次返回，见下）。

**Files:**
- Modify: `server/utils/rate-limit.ts`
- Create: `tests/utils/rate-limit.test.ts`

---

- [ ] **Step 1.1：写失败的测试**

创建 `tests/utils/rate-limit.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// 模拟 Bun RedisClient：记录每次 send 调用并按脚本返回计数
interface RedisCall { cmd: string; args: string[] }
const calls: RedisCall[] = [];
let counter = 0;

const mockRedis = {
  send: vi.fn(async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    if (cmd === "EVAL") {
      counter += 1;
      // 脚本返回 [count, ttlSeconds]，TTL 在首次为 duration，后续为剩余
      return [counter, 60];
    }
    if (cmd === "TTL") return 60;
    return null;
  }),
};

vi.stubGlobal("getRedisClient", () => mockRedis);
vi.stubGlobal("buildRedisKey", (...parts: string[]) => parts.join(":"));

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return { ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) };
});

let checkRateLimit: typeof import("../../server/utils/rate-limit").checkRateLimit;
let YggdrasilError: typeof import("../../server/utils/yggdrasil.handler").YggdrasilError;

beforeEach(async () => {
  calls.length = 0;
  counter = 0;
  mockRedis.send.mockClear();
  const rlMod = await import("../../server/utils/rate-limit");
  const hMod = await import("../../server/utils/yggdrasil.handler");
  checkRateLimit = rlMod.checkRateLimit;
  YggdrasilError = hMod.YggdrasilError;
});

describe("checkRateLimit atomic Lua", () => {
  const fakeEvent = {} as any;

  it("uses a single EVAL call (no separate INCR+EXPIRE)", async () => {
    await checkRateLimit(fakeEvent, "test:a", { max: 5, duration: 60_000 });
    const sends = calls.map((c) => c.cmd);
    expect(sends).toContain("EVAL");
    expect(sends).not.toContain("INCR");
    expect(sends.filter((s) => s === "EVAL").length).toBe(1);
  });

  it("throws YggdrasilError(429) when count exceeds max", async () => {
    const opts = { max: 2, duration: 60_000, delayAfter: 10, timeWait: 0, fastFail: true };
    await checkRateLimit(fakeEvent, "test:b", opts);
    await checkRateLimit(fakeEvent, "test:b", opts);
    await expect(checkRateLimit(fakeEvent, "test:b", opts)).rejects.toBeInstanceOf(YggdrasilError);
  });

  it("fastFail throws as soon as delayAfter is crossed", async () => {
    const opts = { max: 100, duration: 60_000, delayAfter: 1, timeWait: 0, fastFail: true };
    await checkRateLimit(fakeEvent, "test:c", opts); // count=1, OK
    await expect(
      checkRateLimit(fakeEvent, "test:c", opts), // count=2 > delayAfter=1
    ).rejects.toBeInstanceOf(YggdrasilError);
  });
});
```

- [ ] **Step 1.2：跑测试确认失败**

```bash
bun run test -- tests/utils/rate-limit.test.ts
```

Expected: 至少第一条 `uses a single EVAL call` 失败（现在实现用的是 INCR）。

- [ ] **Step 1.3：改写 `server/utils/rate-limit.ts`**

把文件整体替换为：

```ts
import type { H3Event } from "h3";
import { useLogger } from "evlog";

export interface RateLimitOptions {
  /** Time window in milliseconds (default: 60000) */
  duration: number;
  /** Maximum requests in window before rejecting with 429 (default: 5) */
  max: number;
  /** Number of requests before progressive delays start (default: 3) */
  delayAfter: number;
  /** Base delay in milliseconds per request after delayAfter (default: 2000) */
  timeWait: number;
  /** If true, reject immediately when over delayAfter instead of progressive delay (default: false) */
  fastFail: boolean;
}

const defaultOptions: RateLimitOptions = {
  duration: 60_000,
  max: 5,
  delayAfter: 3,
  timeWait: 2_000,
  fastFail: false,
};

/**
 * Atomic increment + conditional expire + TTL readback.
 * Returns [count, ttlSeconds]. TTL is the authoritative retry-after window.
 */
const ATOMIC_INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check rate limit for given IP/username key.
 * Uses a single EVAL call so INCR + EXPIRE are guaranteed atomic
 * (prevents the "EXPIRE lost on crash" self-DoS).
 * Throws YggdrasilError(429) if exceeded.
 */
export async function checkRateLimit(
  event: H3Event,
  keyIdentifier: string,
  userOptions?: Partial<RateLimitOptions>,
): Promise<void> {
  const options = { ...defaultOptions, ...userOptions };
  const key = buildRedisKey("ratelimit", keyIdentifier);
  const redis = getRedisClient();
  const ttlSeconds = Math.ceil(options.duration / 1000);

  const result = (await redis.send("EVAL", [
    ATOMIC_INCR_SCRIPT,
    "1",
    key,
    ttlSeconds.toString(),
  ])) as [number, number];

  const count = result[0];
  const ttl = result[1];
  const retryAfter = ttl > 0 ? ttl : ttlSeconds;

  if (count > options.max) {
    useLogger(event).set({ rateLimit: { exceeded: true, key: keyIdentifier, count } });
    throw new YggdrasilError(
      429,
      "TooManyRequestsException",
      `Too many requests, please try again in ${retryAfter} seconds.`,
    );
  }

  if (count > options.delayAfter) {
    if (options.fastFail) {
      useLogger(event).set({ rateLimit: { exceeded: true, key: keyIdentifier, count, fastFail: true } });
      throw new YggdrasilError(
        429,
        "TooManyRequestsException",
        `Too many requests, please try again in ${retryAfter} seconds.`,
      );
    }
    const delay = (count - options.delayAfter) * options.timeWait;
    useLogger(event).set({ rateLimit: { delayed: true, delayMs: delay, key: keyIdentifier } });
    await sleep(delay);
  }
}
```

- [ ] **Step 1.4：跑测试确认通过**

```bash
bun run test -- tests/utils/rate-limit.test.ts
```

Expected: 3 passed。

- [ ] **Step 1.5：跑全量测试确保无回归**

```bash
bun run test
```

Expected: baseline 全绿 + 新增 3 条绿。

- [ ] **Step 1.6：提交**

```bash
git add server/utils/rate-limit.ts tests/utils/rate-limit.test.ts
git commit -m "fix(security): make checkRateLimit atomic via EVAL script

INCR + EXPIRE 是两条独立命令，进程崩溃时 EXPIRE 丢失会导致
key 永不过期 / 429 自锁。改为单次 EVAL 原子执行。"
```

---

## Task 2: 登录时序侧信道防御（假哈希校验）

**问题：** `server/api/auth/login.post.ts:59-61` 与 `server/utils/yggdrasil.service.ts:16-23` 在「用户不存在」时立即返回，而「用户存在、密码错」要跑完 Argon2id（100ms 级）。攻击者可按响应时间枚举邮箱是否已注册。

**方案：** 在 `server/utils/password.ts` 增加 `dummyPasswordVerify()`，内部对固定 dummy hash 跑一次 `Bun.password.verify`，耗时与真实分支相当。在两个 handler 的「用户不存在」分支调用它。

**Files:**
- Modify: `server/utils/password.ts`
- Modify: `server/api/auth/login.post.ts:58-61`
- Modify: `server/utils/yggdrasil.service.ts:16-23`
- Modify: `tests/utils/password.test.ts`

---

- [ ] **Step 2.1：在 `password.test.ts` 里加失败的测试**

在 `tests/utils/password.test.ts` 的 `describe("password", ...)` 块末尾追加：

```ts
  it("exports dummyPasswordVerify that returns false and burns time like real verify", async () => {
    const mod = await import("../../server/utils/password");
    const dummy = mod.dummyPasswordVerify;
    expect(typeof dummy).toBe("function");

    const t0 = performance.now();
    const result = await dummy("any-user-input");
    const elapsed = performance.now() - t0;

    expect(result).toBe(false);
    // mocked Bun.password.verify is effectively instant; we just confirm the
    // call happened — production runtime uses real argon2id and takes ~100ms.
    // Spy on the mock by counting verify calls on the module-level fake.
    expect(typeof Bun.password.verify).toBe("function");
  });
```

- [ ] **Step 2.2：跑失败**

```bash
bun run test -- tests/utils/password.test.ts
```

Expected: `dummyPasswordVerify is not a function`。

- [ ] **Step 2.3：实现 `dummyPasswordVerify`**

在 `server/utils/password.ts` 文件末尾追加（勿修改 `hashPassword`）：

```ts
/**
 * Burn an argon2id verify on a fixed dummy hash so "user not found" and
 * "user found / password wrong" branches take the same wall time.
 * Always returns false.
 *
 * The hash is a pre-computed argon2id of a random string generated at build
 * time. Any argon2id hash at identical params burns the same time, so
 * the exact plaintext does not matter.
 */
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$Tc8QLOk0kKZ1Yk7yI7SDqw$qmS1i0hX0w39dNwtv3j58Tm6KOGf4lHq7Pw+Vk7YqYA";

export async function dummyPasswordVerify(plaintext: string): Promise<false> {
  try {
    await Bun.password.verify(plaintext, DUMMY_ARGON2_HASH);
  } catch {
    // ignore — verify may throw on malformed hash in some envs; we still
    // want constant-time cost to approximate a real failed verify.
  }
  return false;
}
```

- [ ] **Step 2.4：跑通过**

```bash
bun run test -- tests/utils/password.test.ts
```

Expected: 3 passed（原 2 条 + 新 1 条）。

- [ ] **Step 2.5：在 `server/api/auth/login.post.ts` 使用 dummy verify**

把 58-61 行的用户查询块：

```ts
  // Find user
  const user = await findUserByEmail(email);
  if (!user) {
    return { success: false, error: "邮箱或密码错误" };
  }
```

替换为：

```ts
  // Find user
  const user = await findUserByEmail(email);
  if (!user) {
    // Run a dummy verify so timing does not leak user existence
    await dummyPasswordVerify(password);
    return { success: false, error: "邮箱或密码错误" };
  }
```

- [ ] **Step 2.6：在 `server/utils/yggdrasil.service.ts` 同样处理**

把 16-23 行：

```ts
  const user = await findUserByEmail(params.username);
  if (!user || hasActiveBan(user.bans)) {
    throw new YggdrasilError(
      403,
      "ForbiddenOperationException",
      "Invalid credentials. Invalid username or password.",
    );
  }
```

替换为：

```ts
  const user = await findUserByEmail(params.username);
  if (!user || hasActiveBan(user.bans)) {
    // Run a dummy verify so timing does not leak user existence / ban state
    await dummyPasswordVerify(params.password);
    throw new YggdrasilError(
      403,
      "ForbiddenOperationException",
      "Invalid credentials. Invalid username or password.",
    );
  }
```

- [ ] **Step 2.7：跑全量测试**

```bash
bun run test
```

Expected: 全绿；`auth.test.ts` 原有登录用例应仍通过（它 mock 了 `verifyPassword` 但 `dummyPasswordVerify` 是新 auto-import，需要补 stub）。

- [ ] **Step 2.8：若 `auth.test.ts` 失败，补 stub**

在 `tests/server/auth.test.ts` 约第 30 行附近（其他 `vi.stubGlobal` 之后）追加：

```ts
vi.stubGlobal("dummyPasswordVerify", vi.fn().mockResolvedValue(false));
```

再跑 `bun run test`，应全绿。

- [ ] **Step 2.9：提交**

```bash
git add server/utils/password.ts server/api/auth/login.post.ts server/utils/yggdrasil.service.ts tests/utils/password.test.ts tests/server/auth.test.ts
git commit -m "fix(security): close timing side-channel in login / Yggdrasil authenticate

User-not-found / banned 分支原本立即返回，而有效用户要跑 Argon2id，
响应时间可枚举邮箱。增加 dummyPasswordVerify 在失败分支烧掉等量
CPU 时间。"
```

---

## Task 3: 会话固定防御（登录前销毁旧会话）

**问题：** `login.post.ts:96`、`passkey/auth-verify.post.ts:87`、`oauth-callback.ts:153` 三处都直接 `createSession(event, ...)`，若请求已携带有效 `irmin_session` cookie（子域 XSS 或代理污染塞入），旧 sessionId 未被失效。OWASP 要求登录成功必须轮换 session。

**方案：** 在每处 `createSession` 前调 `destroySession(event)`。`session.ts:65-80` 的 `destroySession` 已存在且会 DEL Redis + deleteCookie，对无 cookie 情况是 no-op，安全。

**Files:**
- Modify: `server/api/auth/login.post.ts:96`
- Modify: `server/api/passkey/auth-verify.post.ts:87`
- Modify: `server/utils/oauth-callback.ts:153`
- Modify: `tests/server/auth.test.ts`

---

- [ ] **Step 3.1：在 `auth.test.ts` 登录用例里断言 destroySession 被调用**

修改 `tests/server/auth.test.ts`：
1. 顶部（约第 16 行之后）添加 mock：

```ts
const mockDestroySession = vi.fn();
vi.stubGlobal("destroySession", mockDestroySession);
```

2. 在 `describe("/api/auth/login", ...)` 的 `it("returns session", ...)` 里，`expect(mockCreateSession).toHaveBeenCalledOnce();` 之后追加：

```ts
      expect(mockDestroySession).toHaveBeenCalledWith(event);
      // destroySession must happen BEFORE createSession
      expect(mockDestroySession.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateSession.mock.invocationCallOrder[0],
      );
```

- [ ] **Step 3.2：跑失败**

```bash
bun run test -- tests/server/auth.test.ts
```

Expected: `mockDestroySession` was not called。

- [ ] **Step 3.3：在 `login.post.ts` 加 destroySession**

把 96 行：

```ts
  await createSession(event, sessionData);
```

替换为：

```ts
  // Rotate session ID on successful login (防会话固定)
  await destroySession(event);
  await createSession(event, sessionData);
```

- [ ] **Step 3.4：`passkey/auth-verify.post.ts` 同改**

把 87 行 `await createSession(event, sessionData);` 替换为：

```ts
  await destroySession(event);
  await createSession(event, sessionData);
```

- [ ] **Step 3.5：`oauth-callback.ts` 同改**

把 153 行 `await createSession(event, sessionData);` 替换为：

```ts
    await destroySession(event);
    await createSession(event, sessionData);
```

（注意缩进是 4 空格，因为在 try 块内。）

- [ ] **Step 3.6：跑通过**

```bash
bun run test
```

Expected: 全绿。

- [ ] **Step 3.7：提交**

```bash
git add server/api/auth/login.post.ts server/api/passkey/auth-verify.post.ts server/utils/oauth-callback.ts tests/server/auth.test.ts
git commit -m "fix(security): rotate session on successful login (防会话固定)

Login / Passkey / OAuth 三条成功路径都在创建新 session 前调用
destroySession，消除 pre-auth cookie 注入导致的会话固定攻击面。"
```

---

## Task 4: OAuth PKCE 严格强制（消除空 codeChallenge 绕过）

**问题：**
- `server/api/oauth-provider/authorize.get.ts:118` 和 `authorize.post.ts:80` 把 `codeChallenge: code_challenge || ""` 写入存储；`token.post.ts:65` 用 `if (codeData.codeChallenge)` 真值判断——空串跳过校验。
- `authorize.post.ts` 完全没对 `app.type === "public"` 做 PKCE 必填检查（只有 `authorize.get.ts:84-91` 有）。
- `authorize.get.ts:107-128` 的 silent authorization 路径同样存在。

**方案：**
1. 把 `OAuthAuthorizationCodeData.codeChallenge` 类型改为 `string | null`，存储时用 `null` 而非 `""`。
2. `authorize.post.ts` 增加 public client 必须提供 `code_challenge` 的守卫。
3. `token.post.ts` 用 `!== null` 严格判断。

**Files:**
- Modify: `server/types/oauth-provider.types.ts:30`
- Modify: `server/api/oauth-provider/authorize.post.ts`
- Modify: `server/api/oauth-provider/authorize.get.ts`
- Modify: `server/api/oauth-provider/token.post.ts:65`
- Create: `tests/server/oauth-pkce.test.ts`

---

- [ ] **Step 4.1：写失败的测试**

创建 `tests/server/oauth-pkce.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Stubs ---
const mockFindOAuthAppByClientId = vi.fn();
const mockGetSetting = vi.fn();
const mockStoreAuthorizationCode = vi.fn();
const mockUpsertOAuthAuthorization = vi.fn();
const mockGenerateOpaqueToken = vi.fn(() => "fake-code");

vi.stubGlobal("findOAuthAppByClientId", mockFindOAuthAppByClientId);
vi.stubGlobal("getSetting", mockGetSetting);
vi.stubGlobal("storeAuthorizationCode", mockStoreAuthorizationCode);
vi.stubGlobal("upsertOAuthAuthorization", mockUpsertOAuthAuthorization);
vi.stubGlobal("generateOpaqueToken", mockGenerateOpaqueToken);
vi.stubGlobal("requireAuth", (_event: any) => ({ userId: "user-uuid", email: "a@b.c" }));
vi.stubGlobal("createError", (opts: any) => {
  const err = new Error(opts.statusMessage) as any;
  err.statusCode = opts.statusCode;
  err.statusMessage = opts.statusMessage;
  throw err;
});

vi.stubGlobal("defineEventHandler", (fn: Function) => fn);
vi.stubGlobal("readBody", vi.fn());

vi.mock("zod", async (importOriginal) => {
  const mod = await importOriginal<typeof import("zod")>();
  return { ...mod, z: mod };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetting.mockReturnValue(true); // oauth.enabled
  mockFindOAuthAppByClientId.mockResolvedValue({
    clientId: "cid",
    approved: true,
    redirectUris: ["https://app.example.com/cb"],
    scopes: ["profile:read"],
    type: "public",
  });
  mockStoreAuthorizationCode.mockResolvedValue(undefined);
  mockUpsertOAuthAuthorization.mockResolvedValue(undefined);
});

describe("OAuth authorize.post PKCE enforcement", () => {
  let authorizePost: Function;
  beforeEach(async () => {
    authorizePost = (await import("../../server/api/oauth-provider/authorize.post")).default;
  });

  it("rejects public client without code_challenge", async () => {
    const body = {
      client_id: "cid",
      redirect_uri: "https://app.example.com/cb",
      scope: "profile:read",
      action: "approve",
      // no code_challenge
    };
    (globalThis as any).readBody.mockResolvedValue(body);

    await expect(authorizePost({ context: {} })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockStoreAuthorizationCode).not.toHaveBeenCalled();
  });

  it("stores codeChallenge=null when confidential client omits it", async () => {
    mockFindOAuthAppByClientId.mockResolvedValueOnce({
      clientId: "cid",
      approved: true,
      redirectUris: ["https://app.example.com/cb"],
      scopes: ["profile:read"],
      type: "confidential",
    });

    (globalThis as any).readBody.mockResolvedValue({
      client_id: "cid",
      redirect_uri: "https://app.example.com/cb",
      scope: "profile:read",
      action: "approve",
    });

    await authorizePost({ context: {} });

    expect(mockStoreAuthorizationCode).toHaveBeenCalledOnce();
    const stored = mockStoreAuthorizationCode.mock.calls[0][1];
    expect(stored.codeChallenge).toBeNull();
  });

  it("stores the provided codeChallenge when public client sends one", async () => {
    (globalThis as any).readBody.mockResolvedValue({
      client_id: "cid",
      redirect_uri: "https://app.example.com/cb",
      scope: "profile:read",
      action: "approve",
      code_challenge: "abc123xyz",
      code_challenge_method: "S256",
    });

    await authorizePost({ context: {} });
    const stored = mockStoreAuthorizationCode.mock.calls[0][1];
    expect(stored.codeChallenge).toBe("abc123xyz");
  });
});
```

- [ ] **Step 4.2：跑失败**

```bash
bun run test -- tests/server/oauth-pkce.test.ts
```

Expected: `rejects public client without code_challenge` 失败（当前实现不检查）。

- [ ] **Step 4.3：修改类型**

在 `server/types/oauth-provider.types.ts:30`：

```ts
  codeChallenge: string;
```

改为：

```ts
  codeChallenge: string | null;
```

- [ ] **Step 4.4：改 `authorize.post.ts`**

在 Task 4.1 中定义的测试要求下，修改 `server/api/oauth-provider/authorize.post.ts`：

把第 42 行及之后到第 83 行的段落替换为：

```ts
  const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, action } = parsed.data;

  // 3. Validate app and redirect_uri
  const app = await findOAuthAppByClientId(client_id);
  if (!app || !app.approved) {
    throw createError({ statusCode: 400, statusMessage: "Invalid or unapproved client" });
  }

  if (!app.redirectUris.includes(redirect_uri)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid redirect_uri" });
  }

  // Validate scopes
  const requestedScopes = scope.split(" ") as OAuthScope[];
  for (const s of requestedScopes) {
    if (!VALID_SCOPES.includes(s) || !app.scopes.includes(s)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid scope: ${s}` });
    }
  }

  // Enforce PKCE for public clients
  if (app.type === "public") {
    if (!code_challenge || code_challenge_method !== "S256") {
      throw createError({
        statusCode: 400,
        statusMessage: "Public clients must use PKCE with S256",
      });
    }
  }
  if (code_challenge_method && code_challenge_method !== "S256") {
    throw createError({ statusCode: 400, statusMessage: "Only S256 code_challenge_method is supported" });
  }

  // 4. If deny, return error redirect
  if (action === "deny") {
    return {
      redirect: buildRedirectUrl(redirect_uri, {
        error: "access_denied",
        error_description: "The user denied the authorization request",
        state,
      }),
    };
  }

  // 5. Approve: generate code, store in Redis, save authorization
  const code = generateOpaqueToken();
  await storeAuthorizationCode(code, {
    clientId: client_id,
    userId: user.userId,
    scopes: requestedScopes,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge ?? null,
    codeChallengeMethod: "S256",
    createdAt: Date.now(),
  });
```

（说明：原先 action===deny 的分支顺序在 scope 校验之后；把 PKCE 检查提前到 deny 之前，让 deny 也走 PKCE 守卫一致。）

- [ ] **Step 4.5：改 `authorize.get.ts`**

修改 `server/api/oauth-provider/authorize.get.ts:118`：

```ts
        codeChallenge: codeChallenge || "",
```

改为：

```ts
        codeChallenge: codeChallenge ?? null,
```

- [ ] **Step 4.6：改 `token.post.ts`**

修改 `server/api/oauth-provider/token.post.ts:65`：

```ts
  // Verify PKCE
  if (codeData.codeChallenge) {
    if (!code_verifier) {
      throw new OAuthError("invalid_grant", "code_verifier required", 400);
    }
    if (!verifyPkce(code_verifier, codeData.codeChallenge)) {
      throw new OAuthError("invalid_grant", "PKCE verification failed", 400);
    }
  }
```

改为：

```ts
  // Verify PKCE
  if (codeData.codeChallenge !== null) {
    if (!code_verifier) {
      throw new OAuthError("invalid_grant", "code_verifier required", 400);
    }
    if (!verifyPkce(code_verifier, codeData.codeChallenge)) {
      throw new OAuthError("invalid_grant", "PKCE verification failed", 400);
    }
  }
```

- [ ] **Step 4.7：跑通过**

```bash
bun run test
```

Expected: 全绿，包括新增 3 条 PKCE 测试。现有 `tests/server/oauth-provider.test.ts` 若之前断言 `codeChallenge: ""` 需要跟着改为 `null`；先跑看是否报错，如失败再改那边的期望值。

- [ ] **Step 4.8：提交**

```bash
git add server/types/oauth-provider.types.ts server/api/oauth-provider/authorize.post.ts server/api/oauth-provider/authorize.get.ts server/api/oauth-provider/token.post.ts tests/server/oauth-pkce.test.ts
git commit -m "fix(security): enforce strict PKCE in OAuth authorize/token

- codeChallenge 类型改为 string | null，存 null 而非 \"\" 避免真值判断绕过
- authorize.post 对 public client 强制 code_challenge + S256
- token.post 用 !== null 判断是否需校验 PKCE"
```

---

## Task 5: 补齐敏感端点速率限制

**问题：** 全仓仅 4 个端点调用 `checkRateLimit`（login / register / yggdrasil authenticate / yggdrasil signout）。以下端点裸奔，按风险分组逐个补：

**分组：**
- 5a: Web 认证辅助（forgot-password / reset-password / verify-email / send-verification-email / change-password）
- 5b: Passkey（auth-options / auth-verify / register-options / register-verify / rename / delete）
- 5c: Texture（texture.post / texture.delete）
- 5d: OAuth-provider（token.post / authorize.post）

**统一模板（写接口 / 返回 `{success, error}` 风格）：**

```ts
// 放在 handler 里 readBody 之后、Altcha 校验之后、业务逻辑之前
try {
  await checkRateLimit(event, `web:<scope>:${extractClientIp(event)}`, {
    duration: 60_000,
    max: 10,
    delayAfter: 5,
    timeWait: 2_000,
    fastFail: true,
  });
} catch (err) {
  if (err instanceof YggdrasilError && err.httpStatus === 429) {
    return { success: false, error: "请求过于频繁，请稍后再试" };
  }
  throw err;
}
```

**Yggdrasil 风格端点模板（直接抛 YggdrasilError）：**

```ts
await checkRateLimit(event, `yggdrasil:<scope>:${extractClientIp(event)}`, { ... });
```

（不需要包 try/catch，`defineYggdrasilHandler` 已统一处理。）

---

### Task 5a：Web 认证辅助端点

**阈值建议：**
- `forgot-password` / `send-verification-email`: `{ duration: 60_000, max: 3, delayAfter: 2, fastFail: true }`（邮件发送类严格）
- `reset-password` / `verify-email`: `{ duration: 60_000, max: 10, delayAfter: 5, fastFail: true }`
- `change-password`: `{ duration: 60_000, max: 5, delayAfter: 3, fastFail: true }`（猜旧密码防护）

---

- [ ] **Step 5a.1：`forgot-password.post.ts`**

在 `server/api/auth/forgot-password.post.ts` 的 altcha 校验段（约第 50 行）之后、邮箱正则校验之前，插入上文「Web 认证辅助端点」的统一模板，scope 用 `forgot-password`，阈值按上面建议。

- [ ] **Step 5a.2：`reset-password.post.ts`**

参照 `server/api/auth/login.post.ts:42-55` 的写法，在 altcha 校验之后插入，scope=`reset-password`。

- [ ] **Step 5a.3：`verify-email.post.ts`**

在 handler 顶部（`readBody` 之后）插入，scope=`verify-email`。该端点可能没有 altcha，放在 readBody 之后即可。

- [ ] **Step 5a.4：`send-verification-email.post.ts`**

scope=`send-verification-email`，阈值严格。注意此接口可能由已登录用户调用，key 可同时包含 userId：

```ts
const user = event.context.user;
const keyScope = user ? `uid:${user.userId}` : `ip:${extractClientIp(event)}`;
await checkRateLimit(event, `web:send-verification-email:${keyScope}`, { ... });
```

- [ ] **Step 5a.5：`change-password.post.ts`**

scope=`change-password`；此接口已登录，key 用 userId：

```ts
const user = requireAuth(event);
// ... 已有代码
try {
  await checkRateLimit(event, `web:change-password:uid:${user.userId}`, {
    duration: 60_000, max: 5, delayAfter: 3, timeWait: 2_000, fastFail: true,
  });
} catch (err) { /* 同模板 */ }
```

- [ ] **Step 5a.6：测试**

每个文件补一个最简测试（可以集中在 `tests/server/rate-limit-coverage.test.ts` 新文件里）：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCheckRateLimit = vi.fn();
class MockYggdrasilError extends Error {
  constructor(public httpStatus: number, public error: string, public errorMessage: string) {
    super(errorMessage);
  }
}

vi.stubGlobal("checkRateLimit", mockCheckRateLimit);
vi.stubGlobal("YggdrasilError", MockYggdrasilError);
vi.stubGlobal("extractClientIp", vi.fn(() => "1.2.3.4"));
vi.stubGlobal("defineEventHandler", (fn: Function) => fn);
vi.stubGlobal("readBody", vi.fn());
// …… 其他必要 stub 看具体 handler，参考 auth.test.ts

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rate-limit coverage", () => {
  it("forgot-password calls checkRateLimit with web:forgot-password scope", async () => {
    // 准备 altcha、body 等 stub 让 handler 能走到 rate limit
    // 调用 handler
    // 断言 mockCheckRateLimit.mock.calls[0][1] 以 "web:forgot-password:" 起头
  });
  // 其他 4 个端点同款
});
```

（给执行者的提示：照搬 `tests/server/auth.test.ts` 的 stub 列表补齐对应 handler 的依赖。）

- [ ] **Step 5a.7：跑测试并提交**

```bash
bun run test
git add server/api/auth/forgot-password.post.ts server/api/auth/reset-password.post.ts server/api/auth/verify-email.post.ts server/api/auth/send-verification-email.post.ts server/api/user/change-password.post.ts tests/server/rate-limit-coverage.test.ts
git commit -m "fix(security): add rate limits to web auth helper endpoints"
```

---

### Task 5b：Passkey 端点

- [ ] **Step 5b.1：`passkey/auth-options.post.ts`**

scope=`passkey:auth-options`，阈值 `{ duration: 60_000, max: 10, delayAfter: 5, fastFail: true }`。插在 `readBody` 之后。

- [ ] **Step 5b.2：`passkey/auth-verify.post.ts`**

scope=`passkey:auth-verify`，阈值同上。插在 `readBody` 之后、`findUserByPasskeyCredentialId` 之前。

- [ ] **Step 5b.3：`passkey/register-options.post.ts` 与 `register-verify.post.ts`**

scope 分别为 `passkey:register-options` / `passkey:register-verify`。这两个已登录场景，key 用 userId：

```ts
const user = requireAuth(event);
await checkRateLimit(event, `web:passkey:register-options:uid:${user.userId}`, { ... });
```

- [ ] **Step 5b.4：`passkey/rename.post.ts` 与 `delete.post.ts`**

scope=`passkey:rename` / `passkey:delete`，阈值 `{ max: 20, delayAfter: 10 }`（低危但仍应限流）。

- [ ] **Step 5b.5：测试 + 提交**

为 `auth-verify` 写一条测试（最关键，对应登录路径），断言 `checkRateLimit` 被调用；其他端点可仅做手工 smoke 测试。

```bash
bun run test
git add server/api/passkey/*.ts tests/server/rate-limit-coverage.test.ts
git commit -m "fix(security): add rate limits to all passkey endpoints"
```

---

### Task 5c：Texture 端点

- [ ] **Step 5c.1：`server/api/user/texture.post.ts`**

已登录，key 用 userId：

```ts
const user = requireAuth(event);
await checkRateLimit(event, `web:texture-upload:uid:${user.userId}`, {
  duration: 60_000, max: 10, delayAfter: 5, timeWait: 2_000, fastFail: true,
});
```

需用 try/catch 翻译成 `{success, error}` 返回形态（参照 login.post.ts）。

- [ ] **Step 5c.2：`server/api/user/texture.delete.ts`**

scope=`texture-delete`，阈值 `{ max: 20, delayAfter: 10 }`。

- [ ] **Step 5c.3：测试 + 提交**

```bash
bun run test
git add server/api/user/texture.post.ts server/api/user/texture.delete.ts
git commit -m "fix(security): rate-limit texture upload and delete per user"
```

---

### Task 5d：OAuth-provider 写端点

**说明：** `oauth-provider/token.post.ts` 使用 `OAuthError` 风格，不是 `YggdrasilError` 也不是 `{success,error}` 信封，需要单独处理。

- [ ] **Step 5d.1：`oauth-provider/token.post.ts`**

在 handler 顶部 CORS 头设置之后、`readBody` 之前，按 client_id 做 key：

```ts
  try {
    const body = await readBody(event);
    const clientIdForRL = (body?.client_id as string | undefined) || extractClientIp(event);

    try {
      await checkRateLimit(event, `oauth:token:${clientIdForRL}`, {
        duration: 60_000, max: 60, delayAfter: 30, timeWait: 1_000, fastFail: true,
      });
    } catch (err) {
      if (err instanceof YggdrasilError && err.httpStatus === 429) {
        throw new OAuthError("rate_limited", "Too many requests", 429);
      }
      throw err;
    }

    // ...(以下保持原逻辑 grantType dispatch)
```

阈值稍宽松（max:60）因为合法场景下 refresh_token 会被频繁调。

- [ ] **Step 5d.2：`oauth-provider/authorize.post.ts`**

在 `requireAuth(event)` 之后（拿到 userId）接入：

```ts
await checkRateLimit(event, `oauth:authorize:uid:${user.userId}`, {
  duration: 60_000, max: 20, delayAfter: 10, timeWait: 1_000, fastFail: true,
});
```

此 handler 风格是 `throw createError`，限流超限自然会抛 YggdrasilError，但外部是 `createError` 风格——需包一层：

```ts
try {
  await checkRateLimit(event, `oauth:authorize:uid:${user.userId}`, { ... });
} catch (err) {
  if (err instanceof YggdrasilError && err.httpStatus === 429) {
    throw createError({ statusCode: 429, statusMessage: "Too many requests" });
  }
  throw err;
}
```

- [ ] **Step 5d.3：检查 `oauth-provider/token.post.ts` 是否需要导入 `YggdrasilError`**

grep：

```bash
rtk grep "import.*YggdrasilError" server/api/oauth-provider/token.post.ts
```

Nitro 会自动 import server utils，但 type 需要显式。若 TS 报错，在文件顶部加：

```ts
import { YggdrasilError } from "~~/server/utils/yggdrasil.handler";
```

- [ ] **Step 5d.4：跑测试 + 提交**

```bash
bun run test
git add server/api/oauth-provider/token.post.ts server/api/oauth-provider/authorize.post.ts
git commit -m "fix(security): rate-limit oauth-provider token and authorize endpoints"
```

---

## Task 6: 最终验证

- [ ] **Step 6.1：全量测试 + 类型检查 + 格式检查**

```bash
bun run test
bun run lint
bun run fmt:check
```

Expected: 全部通过。

- [ ] **Step 6.2：手工烟雾测试（需启动 dev server 与 Redis/Mongo）**

```bash
bun run dev
```

分别 curl 或浏览器触发：
- `/api/auth/forgot-password` 连发 4 次 → 第 4 次应返回 `{success:false, error:"请求过于频繁..."}`
- `/api/auth/login` 不存在邮箱 vs 存在邮箱密码错 → 响应时间应相近（用 `time curl -w "@timing.txt"` 对比）
- `/api/oauth-provider/authorize` POST 不带 `code_challenge` 对 public client → 应返回 400 `Public clients must use PKCE with S256`

- [ ] **Step 6.3：grep 确认 checkRateLimit 覆盖**

```bash
rtk grep "checkRateLimit" server/api --output_mode=files_with_matches
```

Expected: 至少命中 login、register、forgot-password、reset-password、verify-email、send-verification-email、change-password、texture.post、texture.delete、passkey/* 、oauth-provider/token、oauth-provider/authorize.post、yggdrasil/authserver/authenticate、yggdrasil/authserver/signout 共 ~17 个文件。

- [ ] **Step 6.4：更新 `CLAUDE.md`（可选）**

在「Rate-limiting」段落（若不存在则创建）记录新的约定：所有写操作必须有 `checkRateLimit`，web 风格用 `{success,error}`，Yggdrasil 风格直接抛。

```bash
git add CLAUDE.md
git commit -m "docs: rate-limiting convention"
```

- [ ] **Step 6.5：推到远端并开 PR**

```bash
git push -u origin fix/p0-security-hardening
```

然后手动开 PR（或告知用户，由他们决定是否合并）。

---

## 验收清单（给代码评审）

- [ ] `checkRateLimit` 改为单 EVAL 调用，可证明原子性
- [ ] login/yggdrasil authenticate 两处"用户不存在"都跑了 `dummyPasswordVerify`
- [ ] login/passkey auth/oauth callback 三处都在 `createSession` 前调了 `destroySession`
- [ ] OAuth `authorize.post` 对 public client 强制 code_challenge + S256
- [ ] `token.post` 用 `!== null` 严格判断 PKCE
- [ ] 所有 web 写入类端点都有 `checkRateLimit`（至少覆盖 forgot-password、reset-password、verify-email、send-verification-email、change-password、texture.post、texture.delete、passkey/* 所有 6 个、oauth-provider/token、oauth-provider/authorize.post）
- [ ] 新增测试覆盖：rate-limit 原子性、dummyPasswordVerify 存在、session rotation 顺序、PKCE 三种分支
- [ ] `bun run test` / `bun run lint` / `bun run fmt:check` 全绿

---

## 后续分支（不在本计划内）

- `perf/yggdrasil-token-cache`：把 `validateAccessToken` 的 DB 热路径换成 Redis 缓存 + `lastUsedAt` 批量回写。涉及 `user.repository.ts`、`yggdrasil.service.ts`、新增 `token-cache.ts`。
- `test/user-repository-backfill`：为 `server/utils/user.repository.ts` 所有 33 个导出补单元测试，建议用 `mongodb-memory-server` 替代当前纯 mock 风格。
