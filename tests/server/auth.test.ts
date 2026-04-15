import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks for auto-imported server utils ---

const mockVerifyAltchaPayload = vi.fn();
const mockFindUserByEmail = vi.fn();
const mockEmailExists = vi.fn();
const mockGameIdExists = vi.fn();
const mockHashPassword = vi.fn();
const mockVerifyPassword = vi.fn();
const mockInsertUser = vi.fn();
const mockUpdatePasswordHash = vi.fn();
const mockUpdateLastLogin = vi.fn();
const mockCreateSession = vi.fn();
const mockExtractClientIp = vi.fn();
const mockEmitUserHook = vi.fn();

const mockDestroySession = vi.fn();

// Stub rate limiting (added by security fix)
const mockCheckRateLimit = vi.fn();

// Stub YggdrasilError (used by rate limit catch block)
class MockYggdrasilError extends Error {
  constructor(public httpStatus: number, public error: string, public errorMessage: string) {
    super(errorMessage);
  }
}

// Stubs applied per-test via beforeEach below (for unstubGlobals compatibility).
// Keep readBody/getHeader/setCookie as module-level vi.fn() refs so createFakeEvent can use them.
const mockReadBody = vi.fn();
const mockGetHeader = vi.fn();
const mockSetCookie = vi.fn();

// Fix zod v4 named export `z` not available in Bun vitest environment
vi.mock("zod", async (importOriginal) => {
  const mod = await importOriginal<typeof import("zod")>();
  return { ...mod, z: mod };
});

// Mock evlog — useLogger requires Nitro plugin initialization
vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return { ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) };
});

// Helper: create a fake H3 event
function createFakeEvent(body: Record<string, unknown>, contextUser?: unknown) {
  const event = { context: { user: contextUser }, headers: new Map() };
  mockReadBody.mockResolvedValue(body);
  mockGetHeader.mockReturnValue("test-ua");
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractClientIp.mockReturnValue("127.0.0.1");
  // Re-stub globals each test for unstubGlobals compatibility
  vi.stubGlobal("verifyAltchaPayload", mockVerifyAltchaPayload);
  vi.stubGlobal("findUserByEmail", mockFindUserByEmail);
  vi.stubGlobal("emailExists", mockEmailExists);
  vi.stubGlobal("gameIdExists", mockGameIdExists);
  vi.stubGlobal("hashPassword", mockHashPassword);
  vi.stubGlobal("verifyPassword", mockVerifyPassword);
  vi.stubGlobal("insertUser", mockInsertUser);
  vi.stubGlobal("updatePasswordHash", mockUpdatePasswordHash);
  vi.stubGlobal("updateLastLogin", mockUpdateLastLogin);
  vi.stubGlobal("createSession", mockCreateSession);
  vi.stubGlobal("extractClientIp", mockExtractClientIp);
  vi.stubGlobal("emitUserHook", mockEmitUserHook);
  vi.stubGlobal("destroySession", mockDestroySession);
  vi.stubGlobal("checkRateLimit", mockCheckRateLimit);
  vi.stubGlobal("YggdrasilError", MockYggdrasilError);
  vi.stubGlobal("defineEventHandler", (handler: Function) => handler);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("getHeader", mockGetHeader);
  vi.stubGlobal("setCookie", mockSetCookie);
});

describe("auth API", () => {
  describe("/api/auth/me", () => {
    let meHandler: Function;
    beforeEach(async () => {
      meHandler = (await import("../../server/api/auth/me.get")).default;
    });

    it("returns null for unauthenticated", () => {
      const result = meHandler({ context: {} });
      expect(result).toEqual({});
    });
  });

  describe("/api/auth/register", () => {
    let registerHandler: Function;
    beforeEach(async () => {
      registerHandler = (await import("../../server/api/auth/register.post")).default;
    });

    it("creates user", async () => {
      mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
      mockEmailExists.mockResolvedValue(false);
      mockGameIdExists.mockResolvedValue(false);
      mockHashPassword.mockResolvedValue("hashed-pw");
      mockInsertUser.mockResolvedValue({ uuid: "test-uuid" });

      const event = createFakeEvent({
        email: "test@example.com",
        gameId: "Player1",
        password: "securepass123",
        confirmPassword: "securepass123",
        altchaPayload: "valid-payload",
      });

      const result = await registerHandler(event);

      expect(result).toEqual({ success: true });
      expect(mockInsertUser).toHaveBeenCalledOnce();
      expect(mockEmitUserHook).toHaveBeenCalledWith(
        "user:registered",
        expect.objectContaining({ email: "test@example.com", gameId: "Player1" }),
      );
    });
  });

  describe("/api/auth/login", () => {
    let loginHandler: Function;
    beforeEach(async () => {
      loginHandler = (await import("../../server/api/auth/login.post")).default;
    });

    it("returns session", async () => {
      const fakeUser = {
        uuid: "user-uuid",
        email: "test@example.com",
        gameId: "Player1",
        passwordHash: "hashed",
        hashVersion: "argon2id",
      };
      mockVerifyAltchaPayload.mockResolvedValue({ verified: true, expired: false });
      mockFindUserByEmail.mockResolvedValue(fakeUser);
      mockVerifyPassword.mockResolvedValue(true);
      mockUpdateLastLogin.mockResolvedValue(undefined);
      mockCreateSession.mockResolvedValue(undefined);

      const event = createFakeEvent({
        email: "test@example.com",
        password: "securepass123",
        altchaPayload: "valid-payload",
      });

      const result = await loginHandler(event);

      expect(result).toEqual({ success: true });
      expect(mockFindUserByEmail).toHaveBeenCalledWith("test@example.com");
      expect(mockVerifyPassword).toHaveBeenCalledOnce();
      expect(mockCreateSession).toHaveBeenCalledOnce();
      expect(mockDestroySession).toHaveBeenCalledWith(event);
      // destroySession must happen BEFORE createSession
      expect(mockDestroySession.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateSession.mock.invocationCallOrder[0],
      );
      expect(mockEmitUserHook).toHaveBeenCalledWith(
        "user:login",
        expect.objectContaining({ uuid: "user-uuid", method: "password" }),
      );
    });
  });
});
