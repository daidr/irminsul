import { describe, it, expect, vi, beforeEach } from "vitest";

// 模拟 Bun RedisClient：记录每次 send 调用并按脚本返回计数
interface RedisCall {
  cmd: string;
  args: string[];
}
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

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return { ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) };
});

let checkRateLimit: typeof import("../../server/utils/rate-limit").checkRateLimit;
let YggdrasilError: typeof import("../../server/utils/yggdrasil.handler").YggdrasilError;

// Load the real YggdrasilError class so that `instanceof` works against thrown errors.
const { YggdrasilError: RealYggdrasilError } = await import("../../server/utils/yggdrasil.handler");
YggdrasilError = RealYggdrasilError;

beforeEach(async () => {
  calls.length = 0;
  counter = 0;
  mockRedis.send.mockClear();
  // Re-stub globals each test for unstubGlobals compatibility
  vi.stubGlobal("getRedisClient", () => mockRedis);
  vi.stubGlobal("buildRedisKey", (...parts: string[]) => parts.join(":"));
  vi.stubGlobal("YggdrasilError", RealYggdrasilError);
  const rlMod = await import("../../server/utils/rate-limit");
  checkRateLimit = rlMod.checkRateLimit;
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
