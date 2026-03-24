import { describe, it, expect } from "vitest";
import { validatePluginConfig } from "../../server/utils/plugin/config-validator";
import type { PluginConfigField } from "../../server/utils/plugin/types";

describe("validatePluginConfig", () => {
  it("accepts valid config matching schema", () => {
    const schema: PluginConfigField[] = [
      { key: "host", label: "Host", type: "text", required: true },
      { key: "port", label: "Port", type: "number", default: 443 },
    ];
    const result = validatePluginConfig(schema, { host: "example.com", port: 8080 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({ host: "example.com", port: 8080 });
    }
  });

  it("applies default values for missing fields", () => {
    const schema: PluginConfigField[] = [
      { key: "port", label: "Port", type: "number", default: 443 },
    ];
    const result = validatePluginConfig(schema, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.port).toBe(443);
  });

  it("rejects missing required field", () => {
    const schema: PluginConfigField[] = [
      { key: "host", label: "Host", type: "text", required: true },
    ];
    const result = validatePluginConfig(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.host).toBeDefined();
  });

  it("rejects when required_when condition met and field missing", () => {
    const schema: PluginConfigField[] = [
      { key: "provider", label: "Provider", type: "select", options: [{ label: "A", value: "axiom" }] },
      { key: "dataset", label: "Dataset", type: "text", required_when: { provider: "axiom" } },
    ];
    const result = validatePluginConfig(schema, { provider: "axiom" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.dataset).toBeDefined();
  });

  it("allows missing field when required_when condition not met", () => {
    const schema: PluginConfigField[] = [
      { key: "provider", label: "Provider", type: "select", options: [{ label: "C", value: "custom" }] },
      { key: "dataset", label: "Dataset", type: "text", required_when: { provider: "axiom" } },
    ];
    const result = validatePluginConfig(schema, { provider: "custom" });
    expect(result.ok).toBe(true);
  });

  it("rejects validation.pattern mismatch", () => {
    const schema: PluginConfigField[] = [
      { key: "url", label: "URL", type: "text", validation: { pattern: "^https?://", message: "Must be HTTP(S)" } },
    ];
    const result = validatePluginConfig(schema, { url: "ftp://example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.url).toContain("Must be HTTP(S)");
  });

  it("accepts validation.pattern match", () => {
    const schema: PluginConfigField[] = [
      { key: "url", label: "URL", type: "text", validation: { pattern: "^https?://" } },
    ];
    const result = validatePluginConfig(schema, { url: "https://example.com" });
    expect(result.ok).toBe(true);
  });

  it("rejects number out of min range", () => {
    const schema: PluginConfigField[] = [
      { key: "count", label: "Count", type: "number", validation: { min: 1, max: 100 } },
    ];
    const result = validatePluginConfig(schema, { count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.count).toBeDefined();
  });

  it("rejects number out of max range", () => {
    const schema: PluginConfigField[] = [
      { key: "count", label: "Count", type: "number", validation: { min: 1, max: 100 } },
    ];
    const result = validatePluginConfig(schema, { count: 200 });
    expect(result.ok).toBe(false);
  });

  it("rejects type mismatch (string for number)", () => {
    const schema: PluginConfigField[] = [
      { key: "port", label: "Port", type: "number" },
    ];
    const result = validatePluginConfig(schema, { port: "not-a-number" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.port).toBeDefined();
  });

  it("rejects type mismatch (number for boolean)", () => {
    const schema: PluginConfigField[] = [
      { key: "enabled", label: "Enabled", type: "boolean" },
    ];
    const result = validatePluginConfig(schema, { enabled: 42 });
    expect(result.ok).toBe(false);
  });

  it("strips unknown keys from output", () => {
    const schema: PluginConfigField[] = [
      { key: "host", label: "Host", type: "text" },
    ];
    const result = validatePluginConfig(schema, { host: "test", unknownKey: "value" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({ host: "test" });
      expect("unknownKey" in result.config).toBe(false);
    }
  });

  it("collects multiple errors", () => {
    const schema: PluginConfigField[] = [
      { key: "host", label: "Host", type: "text", required: true },
      { key: "port", label: "Port", type: "number", required: true },
    ];
    const result = validatePluginConfig(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).length).toBe(2);
    }
  });

  it("accepts empty optional fields", () => {
    const schema: PluginConfigField[] = [
      { key: "note", label: "Note", type: "textarea" },
    ];
    const result = validatePluginConfig(schema, {});
    expect(result.ok).toBe(true);
  });
});
