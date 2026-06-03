import { describe, it, expect } from "vitest";
// @ts-expect-error pngjs-nozlib has no type definitions
import { PNG } from "pngjs-nozlib";
import { computeTextureHash, processTextureUpload } from "../../server/utils/texture.service";

function img(width: number, height: number, data: number[]) {
  return { width, height, data: Buffer.from(data) };
}

/** Build a valid PNG buffer of the given dimensions (transparent black pixels). */
function makePng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.alloc(width * height * 4, 0);
  return PNG.sync.write(png);
}

describe("computeTextureHash", () => {
  it("returns a 64-char lowercase hex SHA-256", () => {
    expect(computeTextureHash(img(1, 1, [10, 20, 30, 255]))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    const data = [1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 0, 10, 11, 12, 255];
    expect(computeTextureHash(img(2, 2, data))).toBe(computeTextureHash(img(2, 2, data)));
  });

  it("ignores RGB where alpha is 0 (GHAuth normalization)", () => {
    // Both fully transparent but with different RGB → must hash identically
    const transparentRed = computeTextureHash(img(1, 1, [255, 0, 0, 0]));
    const transparentBlue = computeTextureHash(img(1, 1, [0, 0, 255, 0]));
    expect(transparentRed).toBe(transparentBlue);
  });

  it("distinguishes opaque pixels that differ in RGB", () => {
    const red = computeTextureHash(img(1, 1, [255, 0, 0, 255]));
    const blue = computeTextureHash(img(1, 1, [0, 0, 255, 255]));
    expect(red).not.toBe(blue);
  });

  it("folds dimensions into the hash", () => {
    // Same pixel bytes, different shape → different hash
    const data = [1, 2, 3, 255, 4, 5, 6, 255];
    expect(computeTextureHash(img(2, 1, data))).not.toBe(computeTextureHash(img(1, 2, data)));
  });

  it("handles images larger than the 8192-byte internal buffer", () => {
    // 64x64 = 16384 pixel bytes, crossing the internal flush boundary
    const data = Array.from({ length: 64 * 64 * 4 }, (_, i) => i % 256);
    const hash = computeTextureHash(img(64, 64, data));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeTextureHash(img(64, 64, data))).toBe(hash); // determinism across the boundary
  });
});

describe("processTextureUpload validation", () => {
  const event = {} as never;

  it("rejects a non-PNG buffer", async () => {
    await expect(
      processTextureUpload(event, {
        uuid: "u",
        textureType: "skin",
        fileBuffer: Buffer.from("definitely not a png"),
      }),
    ).rejects.toThrow("Invalid PNG file.");
  });

  it("accepts skin dimensions 64x64 and 64x32 (passes validation)", async () => {
    // Valid dimensions pass the size check, then fail later at the (unstubbed)
    // DB lookup — so "not a dimension error" proves validation accepted them.
    for (const height of [64, 32]) {
      await expect(
        processTextureUpload(event, {
          uuid: "u",
          textureType: "skin",
          fileBuffer: makePng(64, height),
        }),
      ).rejects.not.toThrow(/Invalid skin dimensions/);
    }
  });

  it("rejects wrong skin dimensions", async () => {
    await expect(
      processTextureUpload(event, {
        uuid: "u",
        textureType: "skin",
        fileBuffer: makePng(32, 32),
      }),
    ).rejects.toThrow("Invalid skin dimensions. Expected 64x64 or 64x32.");
  });

  it("rejects cape that is not 64x32", async () => {
    await expect(
      processTextureUpload(event, {
        uuid: "u",
        textureType: "cape",
        fileBuffer: makePng(64, 64),
      }),
    ).rejects.toThrow("Invalid cape dimensions. Expected 64x32.");
  });
});
