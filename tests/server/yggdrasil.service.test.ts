import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auto-import stubs (Nitro) ---
const mockFindUserByEmail = vi.fn();
const mockDummyPasswordVerify = vi.fn();
const mockVerifyPassword = vi.fn();
const mockHashPassword = vi.fn();
const mockUpdatePasswordHash = vi.fn();
const mockGetSetting = vi.fn();
const mockAddToken = vi.fn();
const mockBuildBasicProfile = vi.fn(() => ({ id: "uuid32", name: "Player" }));
const mockBuildYggdrasilUser = vi.fn(() => ({ id: "uuid32", properties: [] }));
const mockParseLauncherLabel = vi.fn(() => "HMCL (1.0)");

const mockFindTokenByAccessToken = vi.fn();
const mockValidateAccessToken = vi.fn();
const mockRemoveToken = vi.fn();
const mockReactivateToken = vi.fn();
const mockUseRuntimeConfig = vi.fn(() => ({ yggdrasilTokenExpiryMs: 432000000 }));

class MockYggdrasilError extends Error {
  constructor(
    public httpStatus: number,
    public error: string,
    public errorMessage: string,
  ) {
    super(errorMessage);
  }
}

vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return { ...mod, useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("findUserByEmail", mockFindUserByEmail);
  vi.stubGlobal("dummyPasswordVerify", mockDummyPasswordVerify);
  vi.stubGlobal("verifyPassword", mockVerifyPassword);
  vi.stubGlobal("hashPassword", mockHashPassword);
  vi.stubGlobal("updatePasswordHash", mockUpdatePasswordHash);
  vi.stubGlobal("getSetting", mockGetSetting);
  vi.stubGlobal("addToken", mockAddToken);
  vi.stubGlobal("buildBasicProfile", mockBuildBasicProfile);
  vi.stubGlobal("buildYggdrasilUser", mockBuildYggdrasilUser);
  vi.stubGlobal("parseLauncherLabel", mockParseLauncherLabel);
  vi.stubGlobal("findTokenByAccessToken", mockFindTokenByAccessToken);
  vi.stubGlobal("validateAccessToken", mockValidateAccessToken);
  vi.stubGlobal("removeToken", mockRemoveToken);
  vi.stubGlobal("reactivateToken", mockReactivateToken);
  vi.stubGlobal("useRuntimeConfig", mockUseRuntimeConfig);
  vi.stubGlobal("YggdrasilError", MockYggdrasilError);
  vi.stubGlobal("DEFAULT_YGGDRASIL_TOKEN_EXPIRY_MS", 432000000);
});

const event = {} as never;
const activeUser = {
  uuid: "11111111-1111-1111-1111-111111111111",
  email: "p@example.com",
  gameId: "Player",
  passwordHash: "hash",
  hashVersion: "argon2id",
  emailVerified: true,
  bans: [],
};

describe("yggdrasilAuthenticate", () => {
  async function authenticate(overrides: Record<string, unknown> = {}) {
    const { yggdrasilAuthenticate } = await import("../../server/utils/yggdrasil.service");
    return yggdrasilAuthenticate(event, {
      username: "p@example.com",
      password: "pw",
      ip: "1.2.3.4",
      userAgent: "HMCL",
      ...overrides,
    });
  }

  it("runs a dummy verify and rejects for an unknown user (timing safety)", async () => {
    mockFindUserByEmail.mockResolvedValue(null);
    await expect(authenticate()).rejects.toThrow("Invalid credentials");
    expect(mockDummyPasswordVerify).toHaveBeenCalledWith("pw");
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("runs a dummy verify and rejects for a banned user", async () => {
    mockFindUserByEmail.mockResolvedValue({
      ...activeUser,
      bans: [{ id: "b", start: new Date(0), operatorId: "op" }],
    });
    await expect(authenticate()).rejects.toThrow("Invalid credentials");
    expect(mockDummyPasswordVerify).toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("rejects on wrong password", async () => {
    mockFindUserByEmail.mockResolvedValue(activeUser);
    mockVerifyPassword.mockResolvedValue(false);
    await expect(authenticate()).rejects.toThrow("Invalid credentials");
    expect(mockAddToken).not.toHaveBeenCalled();
  });

  it("rejects when email verification is required and the user is unverified", async () => {
    mockFindUserByEmail.mockResolvedValue({ ...activeUser, emailVerified: false });
    mockVerifyPassword.mockResolvedValue(true);
    mockGetSetting.mockReturnValue(true);
    await expect(authenticate()).rejects.toThrow("Email not verified");
    expect(mockAddToken).not.toHaveBeenCalled();
  });

  it("issues a token pair on success", async () => {
    mockFindUserByEmail.mockResolvedValue(activeUser);
    mockVerifyPassword.mockResolvedValue(true);
    mockGetSetting.mockReturnValue(false);
    const res = (await authenticate()) as Record<string, any>;
    expect(typeof res.accessToken).toBe("string");
    expect(res.accessToken).toHaveLength(32);
    expect(typeof res.clientToken).toBe("string");
    expect(res.selectedProfile).toEqual({ id: "uuid32", name: "Player" });
    expect(res.user).toBeUndefined();
    expect(mockAddToken).toHaveBeenCalledOnce();
  });

  it("reuses a provided clientToken and includes user when requestUser is set", async () => {
    mockFindUserByEmail.mockResolvedValue(activeUser);
    mockVerifyPassword.mockResolvedValue(true);
    mockGetSetting.mockReturnValue(false);
    const res = (await authenticate({ clientToken: "fixed-client", requestUser: true })) as Record<
      string,
      any
    >;
    expect(res.clientToken).toBe("fixed-client");
    expect(res.user).toEqual({ id: "uuid32", properties: [] });
  });

  it("migrates a legacy password hash to argon2id on successful login", async () => {
    mockFindUserByEmail.mockResolvedValue({ ...activeUser, hashVersion: "legacy" });
    mockVerifyPassword.mockResolvedValue(true);
    mockHashPassword.mockResolvedValue("new-argon-hash");
    mockGetSetting.mockReturnValue(false);
    await authenticate();
    expect(mockUpdatePasswordHash).toHaveBeenCalledWith(
      activeUser.uuid,
      "new-argon-hash",
      "argon2id",
    );
  });
});

describe("yggdrasilRefresh", () => {
  async function refresh(overrides: Record<string, unknown> = {}) {
    const { yggdrasilRefresh } = await import("../../server/utils/yggdrasil.service");
    return yggdrasilRefresh({ accessToken: "tok", ip: "1.2.3.4", ...overrides });
  }

  it("rejects an unknown token", async () => {
    mockFindTokenByAccessToken.mockResolvedValue(null);
    await expect(refresh()).rejects.toThrow("Invalid token");
  });

  it("rejects a banned user's token", async () => {
    mockFindTokenByAccessToken.mockResolvedValue({
      user: { ...activeUser, bans: [{ id: "b", start: new Date(0), operatorId: "op" }] },
      token: { createdAt: Date.now() },
    });
    await expect(refresh()).rejects.toThrow("Invalid token");
    expect(mockReactivateToken).not.toHaveBeenCalled();
  });

  it("deletes and rejects an expired token", async () => {
    mockFindTokenByAccessToken.mockResolvedValue({
      user: activeUser,
      token: { createdAt: Date.now() - 432000000 - 1000 },
    });
    await expect(refresh()).rejects.toThrow("Invalid token");
    expect(mockRemoveToken).toHaveBeenCalledWith("tok");
    expect(mockReactivateToken).not.toHaveBeenCalled();
  });

  it("reactivates a valid token without minting a new one", async () => {
    mockFindTokenByAccessToken.mockResolvedValue({
      user: activeUser,
      token: { accessToken: "tok", clientToken: "cli", createdAt: Date.now() },
    });
    const res = (await refresh()) as Record<string, any>;
    expect(mockReactivateToken).toHaveBeenCalledWith("tok", "1.2.3.4");
    // refresh echoes the original token pair rather than minting a new one
    expect(res.accessToken).toBe("tok");
    expect(res.clientToken).toBe("cli");
  });
});

describe("yggdrasilValidate / yggdrasilInvalidate", () => {
  it("returns true when the access token resolves", async () => {
    mockValidateAccessToken.mockResolvedValue({ user: activeUser, token: {} });
    const { yggdrasilValidate } = await import("../../server/utils/yggdrasil.service");
    expect(await yggdrasilValidate({ accessToken: "tok", ip: "1.2.3.4" })).toBe(true);
    expect(mockValidateAccessToken).toHaveBeenCalledWith("tok", undefined, "1.2.3.4");
  });

  it("returns false when the access token does not resolve", async () => {
    mockValidateAccessToken.mockResolvedValue(null);
    const { yggdrasilValidate } = await import("../../server/utils/yggdrasil.service");
    expect(await yggdrasilValidate({ accessToken: "tok", ip: "1.2.3.4" })).toBe(false);
  });

  it("invalidate removes the token", async () => {
    const { yggdrasilInvalidate } = await import("../../server/utils/yggdrasil.service");
    await yggdrasilInvalidate({ accessToken: "tok" });
    expect(mockRemoveToken).toHaveBeenCalledWith("tok");
  });
});
