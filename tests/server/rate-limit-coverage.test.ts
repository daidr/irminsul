import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auto-import stubs (Nitro) ---
const mockCheckRateLimit = vi.fn();
const mockExtractClientIp = vi.fn(() => "1.2.3.4");
const mockVerifyAltchaPayload = vi.fn();
const mockGetSetting = vi.fn();
const mockFindUserByEmail = vi.fn();
const mockFindUserByUuid = vi.fn();
const mockConsumePasswordResetToken = vi.fn();
const mockConsumeEmailVerificationToken = vi.fn();
const mockCreateEmailVerificationToken = vi.fn();
const mockSendEmailVerificationEmail = vi.fn();
const mockCreatePasswordResetToken = vi.fn();
const mockSendPasswordResetEmail = vi.fn();
const mockSetEmailVerified = vi.fn();
const mockHashPassword = vi.fn();
const mockUpdatePasswordHash = vi.fn();
const mockRemoveAllTokens = vi.fn();
const mockDestroyAllSessions = vi.fn();
const mockInvalidateSessionUserCache = vi.fn();
const mockEmitUserHook = vi.fn();
const mockVerifyPassword = vi.fn();
const mockRequireAuth = vi.fn();
const mockUseRuntimeConfig = vi.fn(() => ({ yggdrasilBaseUrl: "https://test" }));
const mockGetRedisClient = vi.fn(() => ({
  send: vi.fn(async () => null),
}));
const mockBuildRedisKey = vi.fn((...parts: string[]) => parts.join(":"));

class MockYggdrasilError extends Error {
  constructor(public httpStatus: number, public error: string, public errorMessage: string) {
    super(errorMessage);
  }
}

// Module-level fn refs for readBody/getHeader/setCookie/deleteCookie
const mockReadBody = vi.fn();
const mockGetHeader = vi.fn(() => "test-ua");
const mockSetCookie = vi.fn();
const mockDeleteCookie = vi.fn();

vi.mock("zod", async (importOriginal) => {
  const mod = await importOriginal<typeof import("zod")>();
  return { ...mod, z: mod };
});

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return { ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractClientIp.mockReturnValue("1.2.3.4");
  mockGetSetting.mockReturnValue("smtp.example.com"); // generic non-empty
  // Re-stub Nitro auto-imports each test for unstubGlobals compatibility
  vi.stubGlobal("checkRateLimit", mockCheckRateLimit);
  vi.stubGlobal("extractClientIp", mockExtractClientIp);
  vi.stubGlobal("verifyAltchaPayload", mockVerifyAltchaPayload);
  vi.stubGlobal("getSetting", mockGetSetting);
  vi.stubGlobal("findUserByEmail", mockFindUserByEmail);
  vi.stubGlobal("findUserByUuid", mockFindUserByUuid);
  vi.stubGlobal("consumePasswordResetToken", mockConsumePasswordResetToken);
  vi.stubGlobal("consumeEmailVerificationToken", mockConsumeEmailVerificationToken);
  vi.stubGlobal("createEmailVerificationToken", mockCreateEmailVerificationToken);
  vi.stubGlobal("sendEmailVerificationEmail", mockSendEmailVerificationEmail);
  vi.stubGlobal("createPasswordResetToken", mockCreatePasswordResetToken);
  vi.stubGlobal("sendPasswordResetEmail", mockSendPasswordResetEmail);
  vi.stubGlobal("setEmailVerified", mockSetEmailVerified);
  vi.stubGlobal("hashPassword", mockHashPassword);
  vi.stubGlobal("updatePasswordHash", mockUpdatePasswordHash);
  vi.stubGlobal("removeAllTokens", mockRemoveAllTokens);
  vi.stubGlobal("destroyAllSessions", mockDestroyAllSessions);
  vi.stubGlobal("invalidateSessionUserCache", mockInvalidateSessionUserCache);
  vi.stubGlobal("emitUserHook", mockEmitUserHook);
  vi.stubGlobal("verifyPassword", mockVerifyPassword);
  vi.stubGlobal("requireAuth", mockRequireAuth);
  vi.stubGlobal("useRuntimeConfig", mockUseRuntimeConfig);
  vi.stubGlobal("getRedisClient", mockGetRedisClient);
  vi.stubGlobal("buildRedisKey", mockBuildRedisKey);
  vi.stubGlobal("YggdrasilError", MockYggdrasilError);
  vi.stubGlobal("defineEventHandler", (handler: Function) => handler);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("getHeader", mockGetHeader);
  vi.stubGlobal("setCookie", mockSetCookie);
  vi.stubGlobal("deleteCookie", mockDeleteCookie);
});

function createFakeEvent(body: Record<string, unknown>, contextUser?: unknown) {
  const event = { context: { user: contextUser }, headers: new Map() };
  mockReadBody.mockResolvedValue(body);
  return event;
}

describe("rate-limit coverage: web auth helper endpoints", () => {
  describe("/api/auth/forgot-password", () => {
    let handler: Function;
    beforeEach(async () => {
      handler = (await import("../../server/api/auth/forgot-password.post")).default;
    });

    it("calls checkRateLimit with web:forgot-password:ip: scope", async () => {
      mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
      mockFindUserByEmail.mockResolvedValue(null);
      const event = createFakeEvent({
        email: "u@example.com",
        altchaPayload: "valid",
      });
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        expect.stringContaining("web:forgot-password:ip:"),
        expect.objectContaining({ max: 3, fastFail: true }),
      );
    });
  });

  describe("/api/auth/reset-password", () => {
    let handler: Function;
    beforeEach(async () => {
      handler = (await import("../../server/api/auth/reset-password.post")).default;
    });

    it("calls checkRateLimit with web:reset-password:ip: scope", async () => {
      mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
      mockConsumePasswordResetToken.mockResolvedValue(null);
      const event = createFakeEvent({
        token: "tok",
        password: "longenoughpw",
        confirmPassword: "longenoughpw",
        altchaPayload: "valid",
      });
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        expect.stringContaining("web:reset-password:ip:"),
        expect.objectContaining({ max: 10, fastFail: true }),
      );
    });
  });

  describe("/api/auth/verify-email", () => {
    let handler: Function;
    beforeEach(async () => {
      handler = (await import("../../server/api/auth/verify-email.post")).default;
    });

    it("calls checkRateLimit with web:verify-email:ip: scope", async () => {
      mockConsumeEmailVerificationToken.mockResolvedValue(null);
      const event = createFakeEvent({ token: "tok" });
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        expect.stringContaining("web:verify-email:ip:"),
        expect.objectContaining({ max: 10, fastFail: true }),
      );
    });
  });

  describe("/api/auth/send-verification-email", () => {
    let handler: Function;
    beforeEach(async () => {
      handler = (await import("../../server/api/auth/send-verification-email.post")).default;
    });

    it("calls checkRateLimit with web:send-verification-email:uid: scope", async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === "auth.requireEmailVerification") return true;
        if (key === "smtp.host") return "smtp.example.com";
        return undefined;
      });
      mockFindUserByUuid.mockResolvedValue({
        uuid: "user-uuid",
        email: "u@example.com",
        emailVerified: false,
      });
      mockCreateEmailVerificationToken.mockResolvedValue(null); // lock active path
      const event = createFakeEvent({}, { userId: "user-uuid", email: "u@example.com" });
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        "web:send-verification-email:uid:user-uuid",
        expect.objectContaining({ max: 3, fastFail: true }),
      );
    });
  });

  describe("/api/user/change-password", () => {
    let handler: Function;
    beforeEach(async () => {
      handler = (await import("../../server/api/user/change-password.post")).default;
    });

    it("calls checkRateLimit with web:change-password:uid: scope", async () => {
      mockRequireAuth.mockReturnValue({ userId: "user-uuid", email: "u@example.com", gameId: "P1" });
      mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
      const event = createFakeEvent({
        oldPassword: "old",
        newPassword: "newpassword123",
        confirmPassword: "newpassword123",
        altchaPayload: "valid",
      }, { userId: "user-uuid" });
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        "web:change-password:uid:user-uuid",
        expect.objectContaining({ max: 5, fastFail: true }),
      );
    });
  });

  describe("/api/passkey/auth-verify", () => {
    let handler: Function;
    beforeEach(async () => {
      vi.stubGlobal("findUserByPasskeyCredentialId", vi.fn().mockResolvedValue(null));
      vi.stubGlobal("base64URLToUint8Array", vi.fn(() => new Uint8Array()));
      handler = (await import("../../server/api/passkey/auth-verify.post")).default;
    });

    it("calls checkRateLimit with web:passkey:auth-verify:ip: scope", async () => {
      const event = createFakeEvent({
        credential: { id: "cred-id", response: {} },
        challengeId: "ch-id",
      });
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        expect.stringContaining("web:passkey:auth-verify:ip:"),
        expect.objectContaining({ max: 10, fastFail: true }),
      );
    });
  });

  describe("/api/passkey/rename", () => {
    let handler: Function;
    beforeEach(async () => {
      vi.stubGlobal("renamePasskey", vi.fn().mockResolvedValue(false));
      handler = (await import("../../server/api/passkey/rename.post")).default;
    });

    it("calls checkRateLimit with web:passkey:rename:uid: scope", async () => {
      mockRequireAuth.mockReturnValue({ userId: "user-uuid", email: "u@x.c", gameId: "P1" });
      const event = createFakeEvent(
        { credentialId: "cred-id", newLabel: "New Name" },
        { userId: "user-uuid" },
      );
      await handler(event);
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        event,
        "web:passkey:rename:uid:user-uuid",
        expect.objectContaining({ max: 20, fastFail: true }),
      );
    });
  });
});

describe("rate-limit translation contract", () => {
  // Generic helper: when checkRateLimit throws YggdrasilError(429), every web
  // endpoint must translate it to the standardized envelope.

  it("forgot-password returns standard envelope on 429", async () => {
    mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
    mockCheckRateLimit.mockRejectedValue(
      new MockYggdrasilError(429, "TooManyRequestsException", "rate limited"),
    );
    const handler = (await import("../../server/api/auth/forgot-password.post")).default;
    const event = createFakeEvent({ email: "u@example.com", altchaPayload: "valid" });
    const result = await handler(event);
    expect(result).toEqual({ success: false, error: "请求过于频繁，请稍后再试" });
  });

  it("change-password returns standard envelope on 429", async () => {
    mockRequireAuth.mockReturnValue({ userId: "user-uuid", email: "u@x.c", gameId: "P1" });
    mockCheckRateLimit.mockRejectedValue(
      new MockYggdrasilError(429, "TooManyRequestsException", "rate limited"),
    );
    const handler = (await import("../../server/api/user/change-password.post")).default;
    const event = createFakeEvent({}, { userId: "user-uuid" });
    const result = await handler(event);
    expect(result).toEqual({ success: false, error: "请求过于频繁，请稍后再试" });
  });

  it("forgot-password rethrows non-429 errors", async () => {
    mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
    mockCheckRateLimit.mockRejectedValue(new Error("redis is on fire"));
    const handler = (await import("../../server/api/auth/forgot-password.post")).default;
    const event = createFakeEvent({ email: "u@example.com", altchaPayload: "valid" });
    await expect(handler(event)).rejects.toThrow("redis is on fire");
  });
});
