import { describe, it, expect } from "vitest";
import { stripUuidHyphens, addUuidHyphens } from "../../server/utils/yggdrasil.util";
import { parseLauncherLabel } from "../../server/utils/yggdrasil.util.ua";

describe("stripUuidHyphens", () => {
  it("removes hyphens from a standard UUID", () => {
    expect(stripUuidHyphens("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400e29b41d4a716446655440000",
    );
  });

  it("returns the same string if no hyphens present", () => {
    expect(stripUuidHyphens("550e8400e29b41d4a716446655440000")).toBe(
      "550e8400e29b41d4a716446655440000",
    );
  });

  it("handles empty string", () => {
    expect(stripUuidHyphens("")).toBe("");
  });
});

describe("addUuidHyphens", () => {
  it("adds hyphens to a 32-char hex string", () => {
    expect(addUuidHyphens("550e8400e29b41d4a716446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("round-trips with stripUuidHyphens", () => {
    const original = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(addUuidHyphens(stripUuidHyphens(original))).toBe(original);
  });
});

describe("parseLauncherLabel", () => {
  it("parses HMCL user agent", () => {
    expect(parseLauncherLabel("HMCL/3.10.4")).toBe("HMCL (3.10.4)");
  });

  it("parses PCL2 user agent", () => {
    expect(parseLauncherLabel("PCL2/2.12.2.50")).toBe("PCL2 (2.12.2.50)");
  });

  it("parses BakaXL user agent", () => {
    expect(parseLauncherLabel("BakaXL/4.0.0")).toBe("BakaXL (4.0.0)");
  });

  it("returns Unknown for unrecognized user agent", () => {
    expect(parseLauncherLabel("Mozilla/5.0")).toBe("Unknown");
  });

  it("returns Unknown for null/undefined", () => {
    expect(parseLauncherLabel(null)).toBe("Unknown");
    expect(parseLauncherLabel(undefined)).toBe("Unknown");
  });

  it("returns Unknown for empty string", () => {
    expect(parseLauncherLabel("")).toBe("Unknown");
  });
});
