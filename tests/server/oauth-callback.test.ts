import { describe, it, expect, vi, beforeEach } from "vitest";

// sendRedirect is stubbed to return its target URL so assertions read naturally.
const mockGetRouterParam = vi.fn(() => "github");
const mockConsumeOAuthState = vi.fn();
const mockSendRedirect = vi.fn((_event: unknown, url: string) => url);
const mockGetOAuthProvider = vi.fn(() => ({ pluginId: "plugin-x" }));
const mockCallPluginHook = vi.fn();
const mockGetPluginManager = vi.fn(() => ({
  getOAuthProvider: mockGetOAuthProvider,
  callPluginHook: mockCallPluginHook,
}));
const mockBuildCallbackUrl = vi.fn(() => "https://x/api/oauth/github/callback");
const mockFindUserByOAuthBinding = vi.fn();
const mockAddOAuthBinding = vi.fn();
const mockInvalidateSessionUserCache = vi.fn();
const mockEmitUserHook = vi.fn();
const mockExtractClientIp = vi.fn(() => "1.2.3.4");
const mockGetHeader = vi.fn(() => "ua");
const mockUpdateLastLogin = vi.fn();
const mockDestroySession = vi.fn();
const mockCreateSession = vi.fn();

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return { ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRouterParam.mockReturnValue("github");
  mockGetOAuthProvider.mockReturnValue({ pluginId: "plugin-x" });
  mockSendRedirect.mockImplementation((_e: unknown, url: string) => url);
  // Default happy-path token exchange + profile mapping
  mockCallPluginHook.mockImplementation((_p: string, hook: string) => {
    if (hook === "oauth:exchange-token") return { accessToken: "at", tokenType: "Bearer" };
    if (hook === "oauth:fetch-profile") return { raw: true };
    if (hook === "oauth:map-profile") return { providerId: "ext-123", displayName: "Ext User" };
    return null;
  });
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  vi.stubGlobal("consumeOAuthState", mockConsumeOAuthState);
  vi.stubGlobal("sendRedirect", mockSendRedirect);
  vi.stubGlobal("getPluginManager", mockGetPluginManager);
  vi.stubGlobal("buildCallbackUrl", mockBuildCallbackUrl);
  vi.stubGlobal("findUserByOAuthBinding", mockFindUserByOAuthBinding);
  vi.stubGlobal("addOAuthBinding", mockAddOAuthBinding);
  vi.stubGlobal("invalidateSessionUserCache", mockInvalidateSessionUserCache);
  vi.stubGlobal("emitUserHook", mockEmitUserHook);
  vi.stubGlobal("extractClientIp", mockExtractClientIp);
  vi.stubGlobal("getHeader", mockGetHeader);
  vi.stubGlobal("updateLastLogin", mockUpdateLastLogin);
  vi.stubGlobal("destroySession", mockDestroySession);
  vi.stubGlobal("createSession", mockCreateSession);
});

async function callback(params: Record<string, unknown>, context: Record<string, unknown> = {}) {
  const { handleOAuthCallback } = await import("../../server/utils/oauth-callback");
  return handleOAuthCallback({ context } as never, params as never);
}

describe("handleOAuthCallback — error / guard branches", () => {
  it("redirects to login on access_denied (login flow)", async () => {
    mockConsumeOAuthState.mockResolvedValue({ action: "login", providerId: "github" });
    expect(await callback({ error: "access_denied", state: "s", code: "" })).toBe(
      "/login?oauth=denied",
    );
  });

  it("redirects home on access_denied when the state is a bind", async () => {
    mockConsumeOAuthState.mockResolvedValue({ action: "bind", providerId: "github" });
    expect(await callback({ error: "access_denied", state: "s", code: "" })).toBe("/?oauth=denied");
  });

  it("errors when code or state is missing", async () => {
    expect(await callback({ code: "", state: "" })).toBe("/login?oauth=error");
  });

  it("errors when the state cannot be consumed", async () => {
    mockConsumeOAuthState.mockResolvedValue(null);
    expect(await callback({ code: "c", state: "s" })).toBe("/login?oauth=error");
  });

  it("errors when the state providerId does not match the route", async () => {
    mockConsumeOAuthState.mockResolvedValue({ action: "login", providerId: "gitlab" });
    expect(await callback({ code: "c", state: "s" })).toBe("/login?oauth=error");
  });
});

describe("handleOAuthCallback — bind flow", () => {
  beforeEach(() => {
    mockConsumeOAuthState.mockResolvedValue({
      action: "bind",
      providerId: "github",
      userId: "me-uuid",
    });
  });

  it("rejects binding an identity already bound to another user", async () => {
    mockFindUserByOAuthBinding.mockResolvedValue({ uuid: "someone-else" });
    expect(await callback({ code: "c", state: "s" })).toBe("/?oauth=already-bound");
    expect(mockAddOAuthBinding).not.toHaveBeenCalled();
  });

  it("binds successfully and invalidates the session cache", async () => {
    mockFindUserByOAuthBinding.mockResolvedValue(null);
    mockAddOAuthBinding.mockResolvedValue(true);
    const target = await callback({ code: "c", state: "s" });
    expect(target).toBe("/?oauth=bind-success");
    expect(mockAddOAuthBinding).toHaveBeenCalledOnce();
    expect(mockInvalidateSessionUserCache).toHaveBeenCalledWith("me-uuid");
  });

  it("maps a duplicate-key (11000) error to already-bound", async () => {
    mockFindUserByOAuthBinding.mockResolvedValue(null);
    mockAddOAuthBinding.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    expect(await callback({ code: "c", state: "s" })).toBe("/?oauth=already-bound");
  });
});

describe("handleOAuthCallback — login flow", () => {
  beforeEach(() => {
    mockConsumeOAuthState.mockResolvedValue({ action: "login", providerId: "github" });
  });

  it("redirects to not-bound when no user owns the identity", async () => {
    mockFindUserByOAuthBinding.mockResolvedValue(null);
    expect(await callback({ code: "c", state: "s" })).toBe("/login?oauth=not-bound");
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("creates a session and redirects home on success", async () => {
    mockFindUserByOAuthBinding.mockResolvedValue({
      uuid: "u",
      email: "u@x.c",
      gameId: "U",
    });
    expect(await callback({ code: "c", state: "s" })).toBe("/");
    expect(mockDestroySession).toHaveBeenCalledOnce();
    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockEmitUserHook).toHaveBeenCalledWith("user:login", expect.objectContaining({ method: "oauth" }));
  });
});
