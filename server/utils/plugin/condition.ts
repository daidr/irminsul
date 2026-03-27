import type { Condition, FieldCondition, Operator } from "./types";

export function evaluateCondition(
  condition: Condition,
  config: Record<string, unknown>,
): boolean {
  if ("$or" in condition) {
    return (condition.$or as Condition[]).some((c) =>
      evaluateCondition(c, config),
    );
  }
  if ("$and" in condition) {
    return (condition.$and as Condition[]).every((c) =>
      evaluateCondition(c, config),
    );
  }
  if ("$not" in condition) {
    return !evaluateCondition(condition.$not as Condition, config);
  }

  // Shorthand: { field: "fieldName", <op>: value } → { fieldName: { <op>: value } }
  const normalized = normalizeFieldShorthand(condition as Record<string, unknown>);

  // Implicit AND: every field must match
  const fields = normalized as Record<string, FieldCondition>;
  for (const key of Object.keys(fields)) {
    if (!evaluateField(fields[key], config[key])) return false;
  }
  return true;
}

function evaluateField(
  fieldCondition: FieldCondition,
  value: unknown,
): boolean {
  // Bare value -> eq shorthand
  if (!isOperatorObject(fieldCondition)) {
    return value === fieldCondition;
  }

  const op = fieldCondition as Operator;
  if ("eq" in op) return value === op.eq;
  if ("neq" in op) return value !== op.neq;
  if ("in" in op) return (op.in as unknown[]).includes(value);
  if ("nin" in op) return !(op.nin as unknown[]).includes(value);
  if ("gt" in op) return (value as number) > op.gt;
  if ("gte" in op) return (value as number) >= op.gte;
  if ("lt" in op) return (value as number) < op.lt;
  if ("lte" in op) return (value as number) <= op.lte;
  if ("truthy" in op) return op.truthy ? !!value : !value;
  if ("regex" in op) return new RegExp(op.regex).test(String(value ?? ""));

  return false;
}

const OPERATOR_NAMES = [
  "eq", "neq", "in", "nin", "gt", "gte", "lt", "lte", "truthy", "regex",
];

function isOperatorObject(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length !== 1) return false;
  return OPERATOR_NAMES.includes(keys[0]!);
}

/**
 * Detect { field: "fieldName", <op>: value } shorthand and normalize
 * to { fieldName: { <op>: value } } for the implicit AND evaluator.
 */
function normalizeFieldShorthand(
  cond: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof cond.field !== "string") return cond;
  const keys = Object.keys(cond).filter((k) => k !== "field");
  if (keys.length !== 1 || !OPERATOR_NAMES.includes(keys[0]!)) return cond;
  return { [cond.field]: { [keys[0]!]: cond[keys[0]!] } };
}
