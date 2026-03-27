import type { PluginConfigField } from "./types";
import { evaluateCondition } from "./condition";

export type ValidateResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

export function validatePluginConfig(
  schema: PluginConfigField[],
  input: Record<string, unknown>,
): ValidateResult {
  const errors: Record<string, string> = {};
  const config: Record<string, unknown> = {};

  for (const field of schema) {
    let value = input[field.key];

    // Apply default if value is missing
    if (value === undefined || value === null) {
      if (field.default !== undefined) {
        value = field.default;
      }
    }

    // Treat blank strings as empty for required checks
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");

    // Check required
    if (field.required && isEmpty) {
      errors[field.key] = `${field.label} is required`;
      continue;
    }

    // Check required_when
    if (
      field.required_when &&
      isEmpty &&
      evaluateCondition(field.required_when, input)
    ) {
      errors[field.key] = `${field.label} is required`;
      continue;
    }

    // If value is still missing and not required, skip further checks
    if (value === undefined || value === null) {
      continue;
    }

    // Type check
    const typeError = checkType(field, value);
    if (typeError) {
      errors[field.key] = typeError;
      continue;
    }

    // Validation rules
    if (field.validation) {
      const validationError = checkValidation(field, value);
      if (validationError) {
        errors[field.key] = validationError;
        continue;
      }
    }

    config[field.key] = value;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, config };
}

function checkType(field: PluginConfigField, value: unknown): string | null {
  switch (field.type) {
    case "text":
    case "password":
    case "textarea":
      if (typeof value !== "string") {
        return `${field.label} must be a string`;
      }
      break;
    case "number":
      if (typeof value !== "number") {
        return `${field.label} must be a number`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return `${field.label} must be a boolean`;
      }
      break;
    case "select":
      // select accepts any type
      break;
    case "oauth-callback-url":
      // Read-only server-computed field, skip type check
      break;
  }
  return null;
}

function checkValidation(
  field: PluginConfigField,
  value: unknown,
): string | null {
  const validation = field.validation!;

  // Pattern check (for string values)
  if (validation.pattern && typeof value === "string") {
    const regex = new RegExp(validation.pattern);
    if (!regex.test(value)) {
      return (
        validation.message ??
        `${field.label} does not match the required pattern`
      );
    }
  }

  // Min/max range check (for number values)
  if (typeof value === "number") {
    if (validation.min !== undefined && value < validation.min) {
      return (
        validation.message ??
        `${field.label} must be at least ${validation.min}`
      );
    }
    if (validation.max !== undefined && value > validation.max) {
      return (
        validation.message ??
        `${field.label} must be at most ${validation.max}`
      );
    }
  }

  return null;
}
