import type { PluginMeta, PluginConfigField } from "./types";
import { isKnownHook } from "./types";

export type ParseResult =
  | { ok: true; meta: PluginMeta }
  | { ok: false; errors: string[] };

const VALID_CONFIG_TYPES = [
  "text",
  "password",
  "number",
  "boolean",
  "select",
  "textarea",
  "oauth-callback-url",
];
const SEMVER_REGEX = /^\d+\.\d+\.\d+/;

export function parsePluginYaml(yamlContent: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yamlContent);
  } catch {
    return { ok: false, errors: ["Invalid YAML syntax"] };
  }
  return validatePluginMeta(parsed);
}

export function validatePluginMeta(parsed: unknown): ParseResult {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, errors: ["plugin.yaml must be a YAML object"] };
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required fields
  if (!obj.name || typeof obj.name !== "string")
    errors.push("'name' is required and must be a string");

  if (!obj.version || typeof obj.version !== "string")
    errors.push("'version' is required and must be a string");
  else if (!SEMVER_REGEX.test(obj.version as string))
    errors.push("'version' must be a valid semver (e.g., 1.0.0)");

  if (!Array.isArray(obj.hooks))
    errors.push("'hooks' is required and must be an array");
  else if (obj.hooks.length === 0) errors.push("'hooks' must not be empty");
  else {
    for (const hook of obj.hooks) {
      if (typeof hook !== "string" || !isKnownHook(hook)) {
        errors.push(
          `Unknown hook: '${hook}'. Known hooks: ${["app:started", "app:shutdown", "config:changed", "evlog:enricher", "evlog:drain"].join(", ")}`,
        );
      }
    }
  }

  // Validate config fields if present
  const configFields: PluginConfigField[] = [];
  if (obj.config !== undefined) {
    if (!Array.isArray(obj.config)) {
      errors.push("'config' must be an array");
    } else {
      for (let i = 0; i < obj.config.length; i++) {
        const field = obj.config[i];
        if (!field || typeof field !== "object") {
          errors.push(`config[${i}]: must be an object`);
          continue;
        }
        const f = field as Record<string, unknown>;
        const fieldErrors: string[] = [];
        if (!f.key || typeof f.key !== "string")
          fieldErrors.push(`config[${i}]: 'key' is required`);
        if (!f.label || typeof f.label !== "string")
          fieldErrors.push(`config[${i}]: 'label' is required`);
        if (
          !f.type ||
          typeof f.type !== "string" ||
          !VALID_CONFIG_TYPES.includes(f.type as string)
        )
          fieldErrors.push(
            `config[${i}]: 'type' must be one of: ${VALID_CONFIG_TYPES.join(", ")}`,
          );

        if (fieldErrors.length > 0) {
          errors.push(...fieldErrors);
        } else {
          configFields.push(f as unknown as PluginConfigField);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const meta: PluginMeta = {
    name: obj.name as string,
    version: obj.version as string,
    description:
      typeof obj.description === "string" ? obj.description : undefined,
    author: typeof obj.author === "string" ? obj.author : undefined,
    hooks: obj.hooks as string[],
    config: configFields.length > 0 ? configFields : undefined,
  };

  return { ok: true, meta };
}
