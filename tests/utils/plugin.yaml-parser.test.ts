import { describe, it, expect } from "vitest";
import { validatePluginMeta } from "../../server/utils/plugin/yaml-parser";

describe("validatePluginMeta", () => {
  it("accepts valid minimal plugin", () => {
    const result = validatePluginMeta({
      name: "test-plugin",
      version: "1.0.0",
      hooks: ["evlog:drain"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.name).toBe("test-plugin");
      expect(result.meta.version).toBe("1.0.0");
      expect(result.meta.hooks).toEqual(["evlog:drain"]);
    }
  });

  it("accepts valid plugin with all optional fields", () => {
    const result = validatePluginMeta({
      name: "full-plugin",
      version: "2.0.0",
      description: "A test plugin",
      author: "tester",
      hooks: ["evlog:enricher", "evlog:drain"],
      config: [
        {
          key: "apiKey",
          label: "API Key",
          type: "password",
          required: true,
          group: "Settings",
          restart: true,
        },
        {
          key: "batchSize",
          label: "Batch Size",
          type: "number",
          default: 50,
          validation: { min: 1, max: 1000 },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing name", () => {
    const result = validatePluginMeta({
      version: "1.0.0",
      hooks: ["evlog:drain"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("name"),
      );
  });

  it("rejects missing version", () => {
    const result = validatePluginMeta({
      name: "test",
      hooks: ["evlog:drain"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("version"),
      );
  });

  it("rejects invalid semver version", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "abc",
      hooks: ["evlog:drain"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("version"),
      );
  });

  it("rejects empty hooks array", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "1.0.0",
      hooks: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("hooks"),
      );
  });

  it("rejects missing hooks", () => {
    const result = validatePluginMeta({ name: "test", version: "1.0.0" });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown hook name", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "1.0.0",
      hooks: ["unknown:hook"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("unknown:hook"),
      );
  });

  it("rejects config field with missing key", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "1.0.0",
      hooks: ["evlog:drain"],
      config: [{ label: "Test", type: "text" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("key"),
      );
  });

  it("rejects config field with missing label", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "1.0.0",
      hooks: ["evlog:drain"],
      config: [{ key: "test", type: "text" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("label"),
      );
  });

  it("rejects config field with unknown type", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "1.0.0",
      hooks: ["evlog:drain"],
      config: [{ key: "test", label: "Test", type: "unknown" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(
        expect.stringContaining("type"),
      );
  });

  it("rejects non-object input", () => {
    expect(validatePluginMeta(null).ok).toBe(false);
    expect(validatePluginMeta("string").ok).toBe(false);
    expect(validatePluginMeta(42).ok).toBe(false);
  });

  it("parses restart flag correctly", () => {
    const result = validatePluginMeta({
      name: "test",
      version: "1.0.0",
      hooks: ["evlog:drain"],
      config: [
        { key: "apiKey", label: "API Key", type: "password", restart: true },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.config![0].restart).toBe(true);
    }
  });
});
