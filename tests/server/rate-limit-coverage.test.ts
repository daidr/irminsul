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
vi.stubGlobal("readBody", vi.fn());
vi.stubGlobal("getHeader", vi.fn(() => "test-ua"));
vi.stubGlobal("setCookie", vi.fn());
vi.stubGlobal("deleteCookie", vi.fn());

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
});

function createFakeEvent(body: Record<string, unknown>, contextUser?: unknown) {
  const event = { context: { user: contextUser }, headers: new Map() };
  ((globalThis as any).readBody as ReturnType<typeof vi.fn>).mockResolvedValue(body);
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
});
