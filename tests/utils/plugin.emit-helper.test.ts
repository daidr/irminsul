import { describe, it, expect, vi, beforeEach } from "vitest";

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
