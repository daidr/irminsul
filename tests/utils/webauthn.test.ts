import { describe, it, expect } from "vitest";
import {
  base64URLToUint8Array,
  uint8ArrayToBase64URL,
  inferPasskeyLabel,
  deduplicateLabel,
} from "../../server/utils/webauthn";

describe("base64url <-> Uint8Array (credential key encoding)", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64, 7]);
    expect([...base64URLToUint8Array(uint8ArrayToBase64URL(bytes))]).toEqual([...bytes]);
  });

  it("encodes without padding and using url-safe alphabet", () => {
    // 0xFB 0xFF -> base64 "+/8=" -> url-safe, unpadded "-_8"
    expect(uint8ArrayToBase64URL(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("decodes a url-safe unpadded string", () => {
    expect([...base64URLToUint8Array("-_8")]).toEqual([0xfb, 0xff]);
  });

  it("matches a known ASCII vector", () => {
    const hello = new Uint8Array([72, 101, 108, 108, 111]);
    expect(uint8ArrayToBase64URL(hello)).toBe("SGVsbG8");
    expect([...base64URLToUint8Array("SGVsbG8")]).toEqual([...hello]);
  });
});

describe("inferPasskeyLabel", () => {
  it("labels cross-platform authenticators as a security key", () => {
    expect(inferPasskeyLabel("any", false, "cross-platform")).toBe("安全密钥");
  });

  it("infers Windows Hello", () => {
    expect(inferPasskeyLabel("Mozilla/5.0 (Windows NT 10.0)", false)).toBe("Windows Hello");
  });

  it("infers Apple platform by backup eligibility", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)";
    expect(inferPasskeyLabel(ua, true)).toBe("iCloud 钥匙串");
    expect(inferPasskeyLabel(ua, false)).toBe("Touch ID");
  });

  it("infers Android platform by backup eligibility", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14)";
    expect(inferPasskeyLabel(ua, true)).toBe("Google 密码管理器");
    expect(inferPasskeyLabel(ua, false)).toBe("Android");
  });

  it("falls back to a security key for unknown platforms", () => {
    expect(inferPasskeyLabel("Mozilla/5.0 (X11; Linux x86_64)", false)).toBe("安全密钥");
  });
});

describe("deduplicateLabel", () => {
  it("keeps a unique label unchanged", () => {
    expect(deduplicateLabel("Touch ID", ["Windows Hello"])).toBe("Touch ID");
  });

  it("suffixes the next free number on collision", () => {
    expect(deduplicateLabel("Touch ID", ["Touch ID"])).toBe("Touch ID #2");
    expect(deduplicateLabel("Touch ID", ["Touch ID", "Touch ID #2"])).toBe("Touch ID #3");
  });
});
