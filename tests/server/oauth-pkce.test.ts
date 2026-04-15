import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Stubs ---
const mockFindOAuthAppByClientId = vi.fn();
const mockGetSetting = vi.fn();
const mockStoreAuthorizationCode = vi.fn();
const mockUpsertOAuthAuthorization = vi.fn();
const mockGenerateOpaqueToken = vi.fn(() => "fake-code");

const mockReadBody = vi.fn();

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
  // Re-stub globals each test for unstubGlobals compatibility
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
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("checkRateLimit", vi.fn().mockResolvedValue(undefined));
  vi.stubGlobal("extractClientIp", vi.fn(() => "127.0.0.1"));
  vi.stubGlobal(
    "YggdrasilError",
    class MockYggdrasilError extends Error {
      constructor(public httpStatus: number, public error: string, public errorMessage: string) {
        super(errorMessage);
      }
    },
  );
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

  it("normalizes empty-string code_challenge to null for confidential client", async () => {
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
      code_challenge: "", // empty string from broken client
    });

    await authorizePost({ context: {} });

    const stored = mockStoreAuthorizationCode.mock.calls[0][1];
    expect(stored.codeChallenge).toBeNull();
  });

  it("rejects public client with empty-string code_challenge", async () => {
    (globalThis as any).readBody.mockResolvedValue({
      client_id: "cid",
      redirect_uri: "https://app.example.com/cb",
      scope: "profile:read",
      action: "approve",
      code_challenge: "",
      code_challenge_method: "S256",
    });

    await expect(authorizePost({ context: {} })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockStoreAuthorizationCode).not.toHaveBeenCalled();
  });
});

describe("OAuth token.post rate-limit", () => {
  let tokenHandler: Function;
  beforeEach(async () => {
    tokenHandler = (await import("../../server/api/oauth-provider/token.post")).default;
  });

  it("calls checkRateLimit with oauth:token: scope keyed by client_id", async () => {
    const event = { context: {} };
    (globalThis as any).readBody.mockResolvedValue({
      grant_type: "authorization_code",
      client_id: "test-client",
      code: "test-code",
      redirect_uri: "https://app.example.com/cb",
    });

    // Stub checkRateLimit to record the call but not throw
    const mockRL = vi.fn();
    vi.stubGlobal("checkRateLimit", mockRL);
    vi.stubGlobal("setResponseHeader", vi.fn());
    vi.stubGlobal("setResponseStatus", vi.fn());
    vi.stubGlobal("extractClientIp", vi.fn(() => "1.2.3.4"));

    // Stub authenticateClient so handler can proceed past rate limit (it'll fail later, that's OK)
    vi.stubGlobal("authenticateClient", vi.fn().mockRejectedValue(new Error("not relevant")));

    try {
      await tokenHandler(event);
    } catch {
      // expected — we just want to verify the rate-limit call happened
    }

    expect(mockRL).toHaveBeenCalledWith(
      event,
      expect.stringContaining("oauth:token:test-client"),
      expect.objectContaining({ max: 60, fastFail: true }),
    );
  });
});
