import { describe, it, expect } from "vitest";
import { uuidToBytes } from "../../server/utils/yggdrasil.crypto";

describe("uuidToBytes", () => {
  it("converts a hyphenated UUID to its 16 raw bytes", () => {
    const bytes = uuidToBytes("12345678-1234-1234-1234-123456789abc");
    expect(bytes).toHaveLength(16);
    expect(bytes.toString("hex")).toBe("12345678123412341234123456789abc");
  });

  it("treats hyphenated and non-hyphenated forms identically", () => {
    const a = uuidToBytes("12345678-1234-1234-1234-123456789abc");
    const b = uuidToBytes("12345678123412341234123456789abc");
    expect(a.equals(b)).toBe(true);
  });

  it("preserves byte order (big-endian, used in the v2 certificate signature)", () => {
    const bytes = uuidToBytes("00112233-4455-6677-8899-aabbccddeeff");
    expect([...bytes]).toEqual([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
      0xff,
    ]);
  });
});
