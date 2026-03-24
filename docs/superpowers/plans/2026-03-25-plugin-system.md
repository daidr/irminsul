# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a general-purpose plugin system with Bun Worker isolation, hot-loading, and admin management API.

**Architecture:** Single Plugin Host Worker (VS Code Extension Host model) runs all enabled plugins. Main thread manages discovery, state, hooks, and admin API. IPC via `postMessage` with structured protocol. Enrichers return patches to minimize serialization overhead.

**Tech Stack:** Bun Worker API, Nitro server routes, MongoDB (settings persistence), SSE (log streaming), `Bun.YAML` (plugin.yaml parsing), `fs.watch` (file watching)

**Spec:** `docs/superpowers/specs/2026-03-25-plugin-system-design.md`

---

## File Structure

### New Files

```
server/utils/plugin/
  types.ts                     — All TypeScript types (IPC messages, plugin metadata, conditions, config schema)
  condition.ts                 — Condition evaluator engine ($or/$and/$not, operators)
  config-validator.ts          — Validate user config against plugin.yaml config schema
  ring-buffer.ts               — Generic fixed-capacity ring buffer for in-memory logs
  log-manager.ts               — Per-plugin log pipeline: ring buffer + JSONL file persistence + SSE broadcast
  hook-registry.ts             — Hook name → ordered handler list, with add/remove/get by plugin ID
  plugin-bridge.ts             — Main-thread IPC: send messages to Host Worker, match callId → Promise
  plugin-manager.ts            — Orchestrator: lifecycle, dirty state, enable/disable/restart/crash recovery
  plugin-watcher.ts            — fs.watch on irminsul-data/plugins/, debounced, with ignore patterns
  yaml-parser.ts               — Parse + validate plugin.yaml using Bun.YAML, return typed PluginMeta or errors

server/worker/plugin-host.ts   — Worker entry point (NOT in utils/ to avoid auto-import)
                                  Receives IPC, constructs ctx per plugin, manages hook handlers,
                                  intercepts console, handles config:update

server/plugins/08.plugins.ts   — Nitro startup plugin: scan, sync registry, create Host, load plugins, start watcher

server/api/admin/plugins/
  index.get.ts                 — GET  /api/admin/plugins
  [id].get.ts                  — GET  /api/admin/plugins/:id
  [id]/
    enable.post.ts             — POST /api/admin/plugins/:id/enable
    disable.post.ts            — POST /api/admin/plugins/:id/disable
    config.put.ts              — PUT  /api/admin/plugins/:id/config
    logs/
      stream.get.ts            — GET  /api/admin/plugins/:id/logs/stream (SSE)
      history.get.ts           — GET  /api/admin/plugins/:id/logs/history
      index.delete.ts          — DELETE /api/admin/plugins/:id/logs
      download.get.ts          — GET  /api/admin/plugins/:id/logs/download
  order.put.ts                 — PUT  /api/admin/plugins/order
  settings.get.ts              — GET  /api/admin/plugins/settings
  settings.put.ts              — PUT  /api/admin/plugins/settings
  host/
    restart.post.ts            — POST /api/admin/plugins/host/restart
    status.get.ts              — GET  /api/admin/plugins/host/status

tests/utils/
  plugin.condition.test.ts     — Condition evaluator unit tests
  plugin.ring-buffer.test.ts   — Ring buffer unit tests
  plugin.config-validator.test.ts — Config validator unit tests
  plugin.yaml-parser.test.ts   — YAML parser/validator unit tests
  plugin.hook-registry.test.ts — Hook registry unit tests
```

### Modified Files

```
server/plugins/01.init-dirs.ts — Add irminsul-data/plugins/ directory creation
server/plugins/02.evlog-drain.ts — Bridge plugin enrichers/drains into evlog:drain hook
server/utils/settings.repository.ts — Add plugin.system.* to BUILTIN_SETTINGS
```

---

## Phase 1: Core Types & Pure Logic

### Task 1: TypeScript Types

**Files:**
- Create: `server/utils/plugin/types.ts`

- [ ] **Step 1: Define all types**

```typescript
// ===== Plugin Metadata (from plugin.yaml) =====

export interface PluginMeta {
  name: string;
  version: string;
  description?: string;
  author?: string;
  hooks: string[];
  config?: PluginConfigField[];
}

export interface PluginConfigField {
  key: string;
  label: string;
  description?: string;
  type: "text" | "password" | "number" | "boolean" | "select" | "textarea";
  group?: string;
  default?: unknown;
  default_when?: ConditionalValue[];
  required?: boolean;
  required_when?: Condition;
  visible_when?: Condition;
  disabled?: boolean;
  disabled_when?: Condition;
  options?: SelectOption[];
  options_when?: ConditionalOptions[];
  validation?: ValidationRule;
  restart?: boolean;
}

export interface SelectOption {
  label: string;
  value: unknown;
}

export interface ValidationRule {
  pattern?: string;
  message?: string;
  min?: number;
  max?: number;
}

export interface ConditionalValue {
  when: Condition;
  value: unknown;
}

export interface ConditionalOptions {
  when: Condition;
  options: SelectOption[];
}

// ===== Condition System =====

export type Operator =
  | { eq: unknown }
  | { neq: unknown }
  | { in: unknown[] }
  | { nin: unknown[] }
  | { gt: number }
  | { gte: number }
  | { lt: number }
  | { lte: number }
  | { truthy: boolean }
  | { regex: string };

export type FieldCondition = Operator | unknown; // bare value = eq shorthand

export type Condition =
  | { $or: Condition[] }
  | { $and: Condition[] }
  | { $not: Condition }
  | Record<string, FieldCondition>; // implicit AND

// ===== Plugin Runtime State =====

export type PluginStatus = "disabled" | "enabled" | "error" | "loading";

export interface PluginRegistryEntry {
  id: string;
  enabled: boolean;
  order: number;
}

export interface PluginState {
  id: string;
  meta: PluginMeta;
  status: PluginStatus;
  order: number;
  error?: string;
  dir: string;
}

export interface DirtyReason {
  pluginId: string;
  reason: "disabled" | "file_changed" | "config_restart" | "deleted";
}

export type HostStatus = "running" | "dirty" | "crashed" | "stopped";

// ===== IPC Messages: Main → Worker =====

export type MainToWorkerMessage =
  | { type: "init" }
  | {
      type: "plugin:load";
      pluginId: string;
      pluginDir: string;
      entryPath: string;
      config: Record<string, unknown>;
      meta: { id: string; name: string; version: string; dir: string };
      allowedHooks: string[];
    }
  | {
      type: "hook:call";
      pluginId: string;
      hookName: string;
      args: unknown[];
      callId: string;
    }
  | {
      type: "config:update";
      pluginId: string;
      config: Record<string, unknown>;
      changes: Record<string, { old: unknown; new: unknown }>;
    }
  | { type: "shutdown" };

// ===== IPC Messages: Worker → Main =====

export type WorkerToMainMessage =
  | { type: "plugin:loaded"; pluginId: string; ok: true }
  | { type: "plugin:loaded"; pluginId: string; ok: false; error: string }
  | { type: "hook:result"; callId: string; ok: true; result?: unknown }
  | { type: "hook:result"; callId: string; ok: false; error: string }
  | { type: "hook:register"; pluginId: string; hookName: string }
  | {
      type: "log";
      pluginId: string | null;
      level: "info" | "warn" | "error" | "debug";
      logType: "event" | "console";
      message?: string;
      data?: Record<string, unknown>;
    };

// ===== Plugin Log Entry =====

export interface PluginLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  type: "event" | "console";
  message?: string;
  data?: Record<string, unknown>;
  pluginId: string;
}

// ===== Known Hook Names =====

export const LIFECYCLE_HOOKS = [
  "app:started",
  "app:shutdown",
  "config:changed",
] as const;

export const KNOWN_FUNCTIONAL_HOOKS = [
  "evlog:enricher",
  "evlog:drain",
] as const;

export const ALL_KNOWN_HOOKS = [
  ...LIFECYCLE_HOOKS,
  ...KNOWN_FUNCTIONAL_HOOKS,
] as const;

export function isLifecycleHook(name: string): boolean {
  return (LIFECYCLE_HOOKS as readonly string[]).includes(name);
}

export function isKnownHook(name: string): boolean {
  return (ALL_KNOWN_HOOKS as readonly string[]).includes(name);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/types.ts
git commit -m "feat(plugin): add TypeScript type definitions for plugin system"
```

---

### Task 2: Condition Evaluator

**Files:**
- Create: `server/utils/plugin/condition.ts`
- Create: `tests/utils/plugin.condition.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../../server/utils/plugin/condition";

describe("evaluateCondition", () => {
  const config = { provider: "axiom", batchSize: 100, retryEnabled: true, name: "https://example.com" };

  describe("bare value (eq shorthand)", () => {
    it("matches equal value", () => {
      expect(evaluateCondition({ provider: "axiom" }, config)).toBe(true);
    });
    it("rejects unequal value", () => {
      expect(evaluateCondition({ provider: "custom" }, config)).toBe(false);
    });
  });

  describe("operators", () => {
    it("eq", () => expect(evaluateCondition({ provider: { eq: "axiom" } }, config)).toBe(true));
    it("neq", () => expect(evaluateCondition({ provider: { neq: "custom" } }, config)).toBe(true));
    it("in", () => expect(evaluateCondition({ provider: { in: ["axiom", "betterstack"] } }, config)).toBe(true));
    it("nin", () => expect(evaluateCondition({ provider: { nin: ["custom"] } }, config)).toBe(true));
    it("gt", () => expect(evaluateCondition({ batchSize: { gt: 50 } }, config)).toBe(true));
    it("gte", () => expect(evaluateCondition({ batchSize: { gte: 100 } }, config)).toBe(true));
    it("lt", () => expect(evaluateCondition({ batchSize: { lt: 200 } }, config)).toBe(true));
    it("lte", () => expect(evaluateCondition({ batchSize: { lte: 100 } }, config)).toBe(true));
    it("truthy true", () => expect(evaluateCondition({ retryEnabled: { truthy: true } }, config)).toBe(true));
    it("truthy false", () => expect(evaluateCondition({ retryEnabled: { truthy: false } }, config)).toBe(false));
    it("regex match", () => expect(evaluateCondition({ name: { regex: "^https?://" } }, config)).toBe(true));
    it("regex no match", () => expect(evaluateCondition({ name: { regex: "^ftp://" } }, config)).toBe(false));
  });

  describe("implicit AND (multiple fields)", () => {
    it("all match", () => {
      expect(evaluateCondition({ provider: "axiom", batchSize: { gt: 50 } }, config)).toBe(true);
    });
    it("one fails", () => {
      expect(evaluateCondition({ provider: "axiom", batchSize: { gt: 200 } }, config)).toBe(false);
    });
  });

  describe("$or", () => {
    it("one matches", () => {
      expect(evaluateCondition({ $or: [{ provider: "custom" }, { provider: "axiom" }] }, config)).toBe(true);
    });
    it("none match", () => {
      expect(evaluateCondition({ $or: [{ provider: "custom" }, { provider: "betterstack" }] }, config)).toBe(false);
    });
  });

  describe("$and", () => {
    it("all match", () => {
      expect(evaluateCondition({ $and: [{ provider: "axiom" }, { batchSize: { gte: 100 } }] }, config)).toBe(true);
    });
    it("one fails", () => {
      expect(evaluateCondition({ $and: [{ provider: "axiom" }, { batchSize: { gt: 200 } }] }, config)).toBe(false);
    });
  });

  describe("$not", () => {
    it("negates true to false", () => {
      expect(evaluateCondition({ $not: { provider: "axiom" } }, config)).toBe(false);
    });
    it("negates false to true", () => {
      expect(evaluateCondition({ $not: { provider: "custom" } }, config)).toBe(true);
    });
  });

  describe("nested", () => {
    it("$or with implicit AND branches", () => {
      expect(evaluateCondition({
        $or: [
          { provider: "axiom", batchSize: { gt: 50 } },
          { provider: "betterstack" },
        ],
      }, config)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("missing config key returns undefined for comparison", () => {
      expect(evaluateCondition({ unknownKey: "value" }, config)).toBe(false);
    });
    it("empty condition object returns true (vacuous truth)", () => {
      expect(evaluateCondition({}, config)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun run test -- tests/utils/plugin.condition.test.ts`
Expected: All tests fail (module not found)

- [ ] **Step 3: Implement condition evaluator**

```typescript
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

  // Implicit AND: every field must match
  const fields = condition as Record<string, FieldCondition>;
  for (const key of Object.keys(fields)) {
    if (!evaluateField(fields[key], config[key])) return false;
  }
  return true;
}

function evaluateField(
  fieldCondition: FieldCondition,
  value: unknown,
): boolean {
  // Bare value → eq shorthand
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

function isOperatorObject(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length !== 1) return false;
  return [
    "eq", "neq", "in", "nin", "gt", "gte", "lt", "lte", "truthy", "regex",
  ].includes(keys[0]);
}
```

**Performance notes:**
- `isOperatorObject` fast-paths nulls and primitives before key check
- No intermediate object allocation in the hot path
- `RegExp` constructed per-call — for high-frequency use, cache compiled regexes externally

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- tests/utils/plugin.condition.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/utils/plugin/condition.ts tests/utils/plugin.condition.test.ts
git commit -m "feat(plugin): implement condition evaluator with operators and logical combinators"
```

---

### Task 3: Ring Buffer

**Files:**
- Create: `server/utils/plugin/ring-buffer.ts`
- Create: `tests/utils/plugin.ring-buffer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../server/utils/plugin/ring-buffer";

describe("RingBuffer", () => {
  it("stores items up to capacity", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.size).toBe(3);
  });

  it("overwrites oldest when full", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.toArray()).toEqual([2, 3, 4]);
    expect(buf.size).toBe(3);
  });

  it("returns items in insertion order", () => {
    const buf = new RingBuffer<number>(5);
    for (let i = 0; i < 8; i++) buf.push(i);
    expect(buf.toArray()).toEqual([3, 4, 5, 6, 7]);
  });

  it("clear resets the buffer", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.toArray()).toEqual([]);
    expect(buf.size).toBe(0);
  });

  it("handles capacity of 1", () => {
    const buf = new RingBuffer<number>(1);
    buf.push(1);
    buf.push(2);
    expect(buf.toArray()).toEqual([2]);
  });

  it("filter returns matching items", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1); buf.push(2); buf.push(3); buf.push(4);
    expect(buf.filter(n => n % 2 === 0)).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun run test -- tests/utils/plugin.ring-buffer.test.ts`

- [ ] **Step 3: Implement ring buffer**

```typescript
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    if (this.count === 0) return [];
    const start =
      this.count < this.capacity ? 0 : this.head;
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(start + i) % this.capacity] as T;
    }
    return result;
  }

  filter(predicate: (item: T) => boolean): T[] {
    const result: T[] = [];
    const start =
      this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[(start + i) % this.capacity] as T;
      if (predicate(item)) result.push(item);
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
```

**Performance notes:**
- Pre-allocated fixed array — no dynamic resizing
- `push` is O(1) with no allocation
- `toArray` avoids `Array.from` + index arithmetic, pre-allocates result size

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- tests/utils/plugin.ring-buffer.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/utils/plugin/ring-buffer.ts tests/utils/plugin.ring-buffer.test.ts
git commit -m "feat(plugin): implement ring buffer for in-memory log storage"
```

---

### Task 4: YAML Parser & Validator

**Files:**
- Create: `server/utils/plugin/yaml-parser.ts`
- Create: `tests/utils/plugin.yaml-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases should cover:
- Valid plugin.yaml with all fields → returns `PluginMeta`
- Minimal valid plugin.yaml (name, version, hooks only) → returns `PluginMeta`
- Missing `name` → returns error
- Missing `version` → returns error
- Invalid semver `version` → returns error
- Empty `hooks` array → returns error
- Unknown hook name → returns error
- Config field with missing `key`/`label`/`type` → returns error
- Config field with unknown `type` → returns error
- Condition referencing non-existent config key → returns error
- `restart` field parsed correctly

Use this signature:

```typescript
type ParseResult =
  | { ok: true; meta: PluginMeta }
  | { ok: false; errors: string[] };

export function parsePluginYaml(yamlContent: string): ParseResult;
```

Note: Since `Bun.YAML` is Bun-specific and not available in vitest's Node environment, the parser should accept a raw YAML string and use a portable YAML parser. Check if `yaml` package is available (it's in `cli/` but not main deps). **If not available, use `Bun.YAML.parse` and mock it in tests with `vi.stubGlobal`.**

Actually, reviewing the codebase: `secrets.ts` uses `Bun.YAML.parse()`. Tests run in vitest with `environment: "node"`. So we need to mock `Bun` in tests, or accept a pre-parsed object. **Better approach: split into `parsePluginYaml(yamlString)` that calls `Bun.YAML.parse` internally, and `validatePluginMeta(parsed: unknown)` that validates the parsed object. Test only `validatePluginMeta`.**

```typescript
// yaml-parser.ts
export function parsePluginYaml(yamlContent: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yamlContent);
  } catch {
    return { ok: false, errors: ["Invalid YAML syntax"] };
  }
  return validatePluginMeta(parsed);
}

export function validatePluginMeta(parsed: unknown): ParseResult { ... }
```

Tests call `validatePluginMeta` with plain objects — no Bun mock needed.

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement parser and validator**

Validate:
- `name`: string, non-empty
- `version`: string, matches `/^\d+\.\d+\.\d+/` (semver-like)
- `hooks`: non-empty string array, each element in `ALL_KNOWN_HOOKS`
- `config`: optional array, each item validated for required fields (`key`, `label`, `type`), `type` in allowed set
- Condition cross-references: every config key referenced in `*_when` conditions exists in the same config array
- `restart` parsed as boolean

Return `{ ok: true, meta }` or `{ ok: false, errors: string[] }`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add server/utils/plugin/yaml-parser.ts tests/utils/plugin.yaml-parser.test.ts
git commit -m "feat(plugin): implement plugin.yaml parser with validation"
```

---

### Task 5: Config Validator

**Files:**
- Create: `server/utils/plugin/config-validator.ts`
- Create: `tests/utils/plugin.config-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Required field missing → error
- `required_when` condition met + field missing → error
- `required_when` condition not met + field missing → OK
- `validation.pattern` mismatch → error
- `validation.min`/`max` out of range → error
- Type mismatch (string for number field) → error
- Unknown keys stripped from output
- `password` type value preserved (validation only, masking is API layer)
- Valid config → returns sanitized config
- Multiple errors collected

Signature:

```typescript
type ValidateResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

export function validatePluginConfig(
  schema: PluginConfigField[],
  input: Record<string, unknown>,
): ValidateResult;
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement config validator**

Uses `evaluateCondition` from `./condition.ts` for `required_when` evaluation. Iterates schema fields, applies type coercion, validation rules, strips unknown keys.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add server/utils/plugin/config-validator.ts tests/utils/plugin.config-validator.test.ts
git commit -m "feat(plugin): implement config validator with conditional rules"
```

---

## Phase 2: Infrastructure

### Task 6: Hook Registry

**Files:**
- Create: `server/utils/plugin/hook-registry.ts`
- Create: `tests/utils/plugin.hook-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Register handler, retrieve by hook name → returns handler
- Multiple handlers sorted by order
- Remove all handlers for a plugin → gone from results
- `get` returns empty array for unknown hook
- Handlers from different plugins interleave by order
- Clear removes everything

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement hook registry**

```typescript
interface RegisteredHandler {
  pluginId: string;
  hookName: string;
  order: number;
}

export class HookRegistry {
  private handlers = new Map<string, RegisteredHandler[]>();

  register(pluginId: string, hookName: string, order: number): void {
    const list = this.handlers.get(hookName) ?? [];
    list.push({ pluginId, hookName, order });
    list.sort((a, b) => a.order - b.order);
    this.handlers.set(hookName, list);
  }

  get(hookName: string): RegisteredHandler[] {
    return this.handlers.get(hookName) ?? [];
  }

  removePlugin(pluginId: string): void {
    for (const [hookName, list] of this.handlers) {
      const filtered = list.filter((h) => h.pluginId !== pluginId);
      if (filtered.length === 0) this.handlers.delete(hookName);
      else this.handlers.set(hookName, filtered);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
```

**Performance note:** `sort` on register is fine because registrations are infrequent. `get` returns reference — caller must not mutate.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add server/utils/plugin/hook-registry.ts tests/utils/plugin.hook-registry.test.ts
git commit -m "feat(plugin): implement hook registry with order-based sorting"
```

---

### Task 7: Plugin Log Manager

**Files:**
- Create: `server/utils/plugin/log-manager.ts`

- [ ] **Step 1: Implement log manager**

Responsibilities:
- Maintain a `Map<pluginId, RingBuffer<PluginLogEntry>>` for in-memory logs
- Write log entries to `irminsul-data/plugins/<pluginId>/logs/<YYYY-MM-DD>.jsonl` (append mode, one JSON line per entry)
- Support SSE subscribers per plugin (maintain `Set<ReadableStreamController>` per pluginId)
- On `push(entry)`: add to ring buffer → append to file → notify SSE subscribers
- Cleanup: on startup, delete JSONL files older than `logRetentionDays`
- `getHistory(pluginId, before, limit, filters)`: read JSONL file(s) in reverse, cursor-based, cross day boundaries
- `clearLogs(pluginId)`: clear ring buffer + delete all JSONL files
- `getBuffer(pluginId, filters)`: read from ring buffer with optional level/type filter

**Performance details:**
- File append uses `Bun.file().writer()` in append mode — no `fs.appendFileSync` per entry
- Buffer file writes: collect entries, flush every 1 second or when buffer reaches 20 entries (whichever first)
- History reading: use `Bun.file().text()` then split by newlines and parse in reverse — for typical log sizes (< 10MB/day) this is fast enough. For the `before` cursor, skip entries with timestamp >= cursor.
- SSE: on push, `controller.enqueue()` the serialized entry. If enqueue fails (client disconnected), remove from subscriber set.
- Cross-day history: when current file exhausted and `hasMore`, compute previous day's filename and continue reading.

```typescript
import type { PluginLogEntry } from "./types";
import { RingBuffer } from "./ring-buffer";

export class PluginLogManager {
  private buffers = new Map<string, RingBuffer<PluginLogEntry>>();
  private subscribers = new Map<string, Set<ReadableStreamDefaultController>>();
  private writers = new Map<string, { writer: FileSink; date: string }>();
  private pendingWrites = new Map<string, PluginLogEntry[]>();
  private flushTimer: Timer | null = null;
  private bufferSize: number;
  private pluginsDir: string;

  constructor(pluginsDir: string, bufferSize = 200) { ... }

  push(entry: PluginLogEntry): void { ... }
  getBuffer(pluginId: string, filters?: LogFilters): PluginLogEntry[] { ... }
  async getHistory(pluginId: string, opts: HistoryOpts): Promise<HistoryResult> { ... }
  subscribe(pluginId: string, controller: ReadableStreamDefaultController): () => void { ... }
  async clearLogs(pluginId: string): Promise<void> { ... }
  async cleanupExpiredLogs(retentionDays: number): Promise<void> { ... }
  async flush(): Promise<void> { ... }
  destroy(): void { ... }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/log-manager.ts
git commit -m "feat(plugin): implement log manager with ring buffer, file persistence, and SSE"
```

---

### Task 8: Plugin Host Worker

**Files:**
- Create: `server/worker/plugin-host.ts`

- [ ] **Step 1: Implement the Worker entry point**

This is the core of the plugin system. It runs in a Bun Worker thread.

```typescript
/// <reference lib="webworker" />
declare const self: Worker;

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "../utils/plugin/types";

// --- State ---
interface LoadedPlugin {
  id: string;
  hooks: Map<string, Function>;
  config: Record<string, unknown>;
  allowedHooks: string[];
}

const plugins = new Map<string, LoadedPlugin>();
let currentPluginId: string | null = null;

// --- Console interception ---
const originalConsole = globalThis.console;

function formatArgs(args: unknown[]): string {
  return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
}

function send(msg: WorkerToMainMessage): void {
  postMessage(msg);
}

globalThis.console = {
  ...originalConsole,
  log: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "info", logType: "console", message: formatArgs(args) }),
  warn: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "warn", logType: "console", message: formatArgs(args) }),
  error: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "error", logType: "console", message: formatArgs(args) }),
  debug: (...args: unknown[]) =>
    send({ type: "log", pluginId: currentPluginId, level: "debug", logType: "console", message: formatArgs(args) }),
} as Console;

// --- ctx factory ---
function createPluginContext(pluginId: string, plugin: LoadedPlugin, meta: any): PluginContext {
  // ctx.log accumulates fields for wide-event style
  let pendingFields: Record<string, unknown> = {};

  return {
    meta: Object.freeze({ ...meta }),
    config: {
      get(key: string) { return plugin.config[key]; },
      getAll() { return { ...plugin.config }; },
    },
    hook(name: string, handler: Function) {
      // Validate: lifecycle hooks always allowed, functional hooks must be declared
      const isLifecycle = ["app:started", "app:shutdown", "config:changed"].includes(name);
      if (!isLifecycle && !plugin.allowedHooks.includes(name)) {
        send({ type: "log", pluginId, level: "error", logType: "event",
          message: `Hook "${name}" not declared in plugin.yaml` });
        return;
      }
      plugin.hooks.set(name, handler);
      send({ type: "hook:register", pluginId, hookName: name });
    },
    log: {
      set(fields) { Object.assign(pendingFields, fields); },
      emit() {
        send({ type: "log", pluginId, level: "info", logType: "event", data: pendingFields });
        pendingFields = {};
      },
      error(error, context) {
        send({ type: "log", pluginId, level: "error", logType: "event",
          message: error?.message ?? String(error),
          data: { ...context, stack: error?.stack } });
      },
      info(message, data) {
        send({ type: "log", pluginId, level: "info", logType: "event", message, data });
      },
      warn(message, data) {
        send({ type: "log", pluginId, level: "warn", logType: "event", message, data });
      },
      debug(message, data) {
        send({ type: "log", pluginId, level: "debug", logType: "event", message, data });
      },
    },
    fetch: globalThis.fetch.bind(globalThis),
  };
}

// --- Message handler ---
self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      // Host ready — nothing to do beyond console interception (already done)
      break;

    case "plugin:load": {
      const { pluginId, pluginDir, entryPath, config, meta, allowedHooks } = msg;
      const plugin: LoadedPlugin = { id: pluginId, hooks: new Map(), config, allowedHooks };
      plugins.set(pluginId, plugin);

      try {
        currentPluginId = pluginId;
        const mod = await import(entryPath);
        if (typeof mod.setup !== "function") {
          throw new Error("index.js must export a setup() function");
        }
        const ctx = createPluginContext(pluginId, plugin, { ...meta, dir: pluginDir });
        await mod.setup(ctx);

        // Auto-call app:started
        const startedHandler = plugin.hooks.get("app:started");
        if (startedHandler) {
          try { await startedHandler(); } catch {}
        }

        send({ type: "plugin:loaded", pluginId, ok: true });
      } catch (err: any) {
        plugins.delete(pluginId);
        send({ type: "plugin:loaded", pluginId, ok: false, error: err?.message ?? String(err) });
      } finally {
        currentPluginId = null;
      }
      break;
    }

    case "hook:call": {
      const { pluginId, hookName, args, callId } = msg;
      const plugin = plugins.get(pluginId);
      const handler = plugin?.hooks.get(hookName);
      if (!handler) {
        send({ type: "hook:result", callId, ok: false, error: `No handler for ${hookName} in ${pluginId}` });
        break;
      }
      try {
        currentPluginId = pluginId;
        const result = await handler(...args);
        send({ type: "hook:result", callId, ok: true, result });
      } catch (err: any) {
        send({ type: "hook:result", callId, ok: false, error: err?.message ?? String(err) });
      } finally {
        currentPluginId = null;
      }
      break;
    }

    case "config:update": {
      const { pluginId, config, changes } = msg;
      const plugin = plugins.get(pluginId);
      if (!plugin) break;
      plugin.config = config;
      const handler = plugin.hooks.get("config:changed");
      if (handler) {
        try {
          currentPluginId = pluginId;
          await handler({ changes, config });
        } catch {} finally {
          currentPluginId = null;
        }
      }
      break;
    }

    case "shutdown": {
      // Call app:shutdown on all plugins in reverse order
      const pluginList = [...plugins.values()].reverse();
      for (const plugin of pluginList) {
        const handler = plugin.hooks.get("app:shutdown");
        if (handler) {
          try {
            currentPluginId = plugin.id;
            await Promise.race([
              handler(),
              new Promise((_, reject) => setTimeout(() => reject(new Error("shutdown timeout")), 5000)),
            ]);
          } catch {} finally {
            currentPluginId = null;
          }
        }
      }
      // Let the main thread terminate us
      break;
    }
  }
};
```

**Performance details:**
- `ctx.config.get()` is a direct property lookup — O(1)
- `ctx.config.getAll()` shallow-copies to prevent mutation — acceptable since config reads are infrequent
- `ctx.log.set()` mutates `pendingFields` in-place — no allocation
- `currentPluginId` tracking for console attribution — single variable, no overhead
- Shutdown timeout: 5 seconds per plugin via `Promise.race`, prevents hanging

- [ ] **Step 2: Commit**

```bash
git add server/worker/plugin-host.ts
git commit -m "feat(plugin): implement Plugin Host Worker with ctx, IPC, and console interception"
```

---

### Task 9: Plugin Bridge (Main Thread IPC)

**Files:**
- Create: `server/utils/plugin/plugin-bridge.ts`

- [ ] **Step 1: Implement bridge**

Responsibilities:
- Create and manage the Worker instance
- Send typed messages to Worker
- `callHook(pluginId, hookName, ...args)` → returns `Promise<unknown>` using callId correlation
- Timeout handling: if response not received within 30s, reject the promise
- `loadPlugin(...)` → sends `plugin:load`, returns Promise that resolves on `plugin:loaded`
- `updateConfig(...)` → sends `config:update` (fire-and-forget, no response needed)
- `shutdown()` → sends `shutdown`, waits for Worker close event with timeout
- Route `log` messages to `PluginLogManager`
- Route `hook:register` messages to `HookRegistry`
- Handle Worker `error`/`close` events → trigger crash recovery callback

```typescript
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./types";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: Timer;
}

export class PluginBridge {
  private worker: Worker | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private pendingLoads = new Map<string, PendingCall>();
  private callIdCounter = 0;
  private onLog: (msg: WorkerToMainMessage & { type: "log" }) => void;
  private onHookRegister: (pluginId: string, hookName: string) => void;
  private onCrash: (error: string) => void;
  private hookTimeoutMs: number;

  constructor(opts: {
    onLog: (...) => void;
    onHookRegister: (...) => void;
    onCrash: (...) => void;
    hookTimeoutMs?: number;
  }) { ... }

  start(): void {
    this.worker = new Worker("./server/worker/plugin-host.ts", { smol: true });
    this.worker.unref(); // don't keep main process alive
    this.worker.onmessage = (e) => this.handleMessage(e.data);
    this.worker.onerror = (e) => this.handleCrash(e.message);
    this.worker.addEventListener("close", () => this.handleCrash("Worker closed unexpectedly"));
    this.send({ type: "init" });
  }

  async loadPlugin(payload: Omit<MainToWorkerMessage & { type: "plugin:load" }, "type">): Promise<void> { ... }

  async callHook(pluginId: string, hookName: string, ...args: unknown[]): Promise<unknown> {
    const callId = String(++this.callIdCounter);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`Hook ${hookName} timed out after ${this.hookTimeoutMs}ms`));
      }, this.hookTimeoutMs);
      this.pendingCalls.set(callId, { resolve, reject, timer });
      this.send({ type: "hook:call", pluginId, hookName, args, callId });
    });
  }

  updateConfig(pluginId: string, config: Record<string, unknown>,
    changes: Record<string, { old: unknown; new: unknown }>): void {
    this.send({ type: "config:update", pluginId, config, changes });
  }

  async shutdown(): Promise<void> {
    if (!this.worker) return;
    this.send({ type: "shutdown" });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.terminate(); resolve(); }, 6000);
      this.worker!.addEventListener("close", () => { clearTimeout(timer); resolve(); });
    });
    this.terminate();
  }

  terminate(): void {
    if (!this.worker) return;
    // Reject all pending calls
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Worker terminated"));
    }
    this.pendingCalls.clear();
    for (const [, pending] of this.pendingLoads) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Worker terminated"));
    }
    this.pendingLoads.clear();
    this.worker.terminate();
    this.worker = null;
  }

  get isRunning(): boolean { return this.worker !== null; }

  private send(msg: MainToWorkerMessage): void { this.worker?.postMessage(msg); }

  private handleMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case "hook:result": { ... resolve/reject pending call ... }
      case "plugin:loaded": { ... resolve/reject pending load ... }
      case "hook:register": { this.onHookRegister(msg.pluginId, msg.hookName); break; }
      case "log": { this.onLog(msg as any); break; }
    }
  }

  private handleCrash(error: string): void { ... reject all pending, call onCrash ... }
}
```

**Performance details:**
- `callIdCounter` is a simple number increment — no UUID generation overhead
- `pendingCalls` Map lookup is O(1) for message correlation
- `setTimeout` per call for timeout — cleared on response, no memory leak
- Worker `unref()` prevents keeping the main process alive unnecessarily

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/plugin-bridge.ts
git commit -m "feat(plugin): implement Plugin Bridge for main thread ↔ Worker IPC"
```

---

### Task 10: Plugin Watcher

**Files:**
- Create: `server/utils/plugin/plugin-watcher.ts`

- [ ] **Step 1: Implement file watcher**

Uses `fs.watch` (Bun-compatible, no external deps). Watches `irminsul-data/plugins/` directory.

```typescript
import { watch, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export class PluginWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private debounceTimers = new Map<string, Timer>();
  private debounceMs = 500;
  private pluginsDir: string;

  constructor(
    pluginsDir: string,
    private callbacks: {
      onPluginAdded: (pluginId: string) => void;
      onPluginChanged: (pluginId: string) => void;
      onPluginRemoved: (pluginId: string) => void;
    },
  ) {
    this.pluginsDir = pluginsDir;
  }

  start(): void {
    if (!existsSync(this.pluginsDir)) return;
    this.watcher = watch(this.pluginsDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Extract pluginId (first path segment)
      const parts = filename.replace(/\\/g, "/").split("/");
      const pluginId = parts[0];
      if (!pluginId) return;

      // Ignore patterns
      const relPath = parts.slice(1).join("/");
      if (this.shouldIgnore(relPath)) return;

      // Debounce per pluginId
      const existing = this.debounceTimers.get(pluginId);
      if (existing) clearTimeout(existing);
      this.debounceTimers.set(pluginId, setTimeout(() => {
        this.debounceTimers.delete(pluginId);
        this.handleChange(pluginId);
      }, this.debounceMs));
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }

  private shouldIgnore(relPath: string): boolean {
    if (!relPath) return false; // directory-level event
    return /(?:^|\/)(?:node_modules|\.git|logs)(?:\/|$)/.test(relPath)
      || /\.tmp$|~$/.test(relPath);
  }

  private handleChange(pluginId: string): void {
    const pluginDir = join(this.pluginsDir, pluginId);
    if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) {
      this.callbacks.onPluginRemoved(pluginId);
      return;
    }
    const yamlPath = join(pluginDir, "plugin.yaml");
    const ymlPath = join(pluginDir, "plugin.yml");
    if (!existsSync(yamlPath) && !existsSync(ymlPath)) {
      // Not a valid plugin directory (yet) — could be a new dir without plugin.yaml
      return;
    }
    // Check if this is a newly discovered plugin or a change to an existing one
    // Delegate decision to callbacks — they check the registry
    this.callbacks.onPluginChanged(pluginId);
  }
}
```

**Details:**
- `recursive: true` on `fs.watch` — supported by Bun on all platforms
- Ignores `node_modules/`, `.git/`, `logs/` (plugin log dir), temp files
- 500ms debounce per plugin prevents rapid-fire events during file saves
- `onPluginChanged` callback — the PluginManager decides if it's new or existing

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/plugin-watcher.ts
git commit -m "feat(plugin): implement file watcher with debounce and ignore patterns"
```

---

### Task 11: Plugin Manager (Orchestrator)

**Files:**
- Create: `server/utils/plugin/plugin-manager.ts`

- [ ] **Step 1: Implement plugin manager**

This is the main orchestrator. It wires together all components.

Key responsibilities:
- `scan()` — scan plugins dir, parse YAML, sync with registry in settings DB
- `start()` — create Host Worker, load enabled plugins, start watcher
- `enablePlugin(id)` — dynamic load into Host
- `disablePlugin(id)` — remove from HookRegistry, mark dirty
- `updateConfig(id, newConfig)` — validate, persist, hot-update or mark dirty
- `restartHost()` — shutdown + terminate + recreate + reload all enabled
- `getPlugins()` / `getPlugin(id)` — read state for API
- `getHostStatus()` — running/dirty/crashed + dirty reasons
- `updateOrder(ids)` — persist new order to settings
- Crash recovery via bridge's `onCrash` callback

State:
- `plugins: Map<string, PluginState>` — all discovered plugins
- `dirtyReasons: DirtyReason[]` — why Host needs restart
- `hostStatus: HostStatus`

Internal flow for `scan()`:
1. `readdirSync(pluginsDir)` → list subdirs
2. For each subdir: check for `plugin.yaml` or `plugin.yml`, parse, validate
3. Load `plugin.system.registry` from settings
4. Merge: new plugins get `enabled: false`, existing keep state, deleted get removed
5. Save updated registry back to settings
6. Populate `this.plugins` Map

Internal flow for evlog bridge (`bridgeEvlogHooks(nitroApp)`):
- Hook into `nitroApp.hooks.hook("evlog:drain", ...)` — call enricher plugins (patch merge), then drain plugins

```typescript
export class PluginManager {
  private plugins = new Map<string, PluginState>();
  private dirtyReasons: DirtyReason[] = [];
  private hostStatus: HostStatus = "stopped";
  private bridge: PluginBridge;
  private hookRegistry: HookRegistry;
  private logManager: PluginLogManager;
  private watcher: PluginWatcher | null = null;
  private pluginsDir: string;

  constructor(pluginsDir: string) { ... }

  async scan(): Promise<void> { ... }
  async start(): Promise<void> { ... }
  async enablePlugin(id: string): Promise<{ ok: boolean; error?: string }> { ... }
  async disablePlugin(id: string): Promise<void> { ... }
  async updateConfig(id: string, input: Record<string, unknown>): Promise<ValidateResult> { ... }
  async restartHost(): Promise<void> { ... }
  async updateOrder(ids: string[]): Promise<void> { ... }
  getPlugins(): PluginState[] { ... }
  getPlugin(id: string): PluginState | undefined { ... }
  getHostStatus(): { status: HostStatus; dirtyReasons: DirtyReason[] } { ... }
  getLogManager(): PluginLogManager { return this.logManager; }
  getHookRegistry(): HookRegistry { return this.hookRegistry; }

  bridgeEvlogHooks(nitroApp: NitroApp): void {
    nitroApp.hooks.hook("evlog:drain", async (events) => {
      // Enrichers: patch model
      for (const handler of this.hookRegistry.get("evlog:enricher")) {
        try {
          const patches = await this.bridge.callHook(handler.pluginId, "evlog:enricher", events) as any[];
          if (Array.isArray(patches)) {
            for (let i = 0; i < events.length && i < patches.length; i++) {
              if (patches[i]) Object.assign(events[i], patches[i]);
            }
          }
        } catch (err) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error", type: "event", pluginId: handler.pluginId,
            message: `enricher error: ${(err as Error).message}`,
          });
        }
      }
      // Drains
      for (const handler of this.hookRegistry.get("evlog:drain")) {
        try {
          await this.bridge.callHook(handler.pluginId, "evlog:drain", events);
        } catch (err) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error", type: "event", pluginId: handler.pluginId,
            message: `drain error: ${(err as Error).message}`,
          });
        }
      }
    });
  }

  async destroy(): Promise<void> { ... }
}
```

Expose singleton via `globalThis` symbol (same pattern as settings cache):

```typescript
const PLUGIN_MANAGER_KEY = Symbol.for("irminsul.pluginManager");

export function getPluginManager(): PluginManager {
  return (globalThis as any)[PLUGIN_MANAGER_KEY];
}

export function setPluginManager(manager: PluginManager): void {
  (globalThis as any)[PLUGIN_MANAGER_KEY] = manager;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/plugin-manager.ts
git commit -m "feat(plugin): implement PluginManager orchestrator with lifecycle and evlog bridge"
```

---

## Phase 3: Integration

### Task 12: Settings & Directory Initialization

**Files:**
- Modify: `server/plugins/01.init-dirs.ts`
- Modify: `server/utils/settings.repository.ts`

- [ ] **Step 1: Add plugins directory to init-dirs**

Add `irminsul-data/plugins/` to the directories created on startup in `01.init-dirs.ts`.

- [ ] **Step 2: Add plugin.system.* built-in settings**

In `settings.repository.ts`, add to `BUILTIN_SETTINGS`:

```typescript
"plugin.system.registry": [],
"plugin.system.watcher": true,
"plugin.system.logBufferSize": 200,
"plugin.system.logRetentionDays": 7,
```

- [ ] **Step 3: Commit**

```bash
git add server/plugins/01.init-dirs.ts server/utils/settings.repository.ts
git commit -m "feat(plugin): add plugins directory init and system settings"
```

---

### Task 13: Nitro Startup Plugin + Evlog Bridge

**Files:**
- Create: `server/plugins/08.plugins.ts`
- Modify: `server/plugins/02.evlog-drain.ts`

- [ ] **Step 1: Create 08.plugins.ts**

```typescript
import { createLogger } from "evlog";
import { PluginManager, setPluginManager } from "../utils/plugin/plugin-manager";

export default defineNitroPlugin(async (nitroApp) => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "08.plugins", action: "init" });

  const pluginsDir = "./irminsul-data/plugins";
  const manager = new PluginManager(pluginsDir);
  setPluginManager(manager);

  await manager.scan();
  await manager.start();

  // Bridge enricher/drain hooks
  manager.bridgeEvlogHooks(nitroApp);

  const plugins = manager.getPlugins();
  const enabled = plugins.filter((p) => p.status === "enabled").length;
  log.set({ status: "ok", discovered: plugins.length, enabled });
  log.emit();

  nitroApp.hooks.hook("close", async () => {
    await manager.destroy();
  });
});
```

- [ ] **Step 2: Update evlog-drain plugin ordering note**

The `02.evlog-drain.ts` hooks `evlog:drain` to write to the FS drain. The plugin bridge also hooks `evlog:drain` (in `08.plugins.ts`). Nitro hook ordering: hooks run in the order they are registered. Since `02` registers before `08`, the FS drain runs first, then plugin enrichers/drains. This means plugin enrichers enrich events *after* they've already been written to FS by the built-in drain.

**If enrichment should apply to FS drain too:** Move the evlog bridge hook registration into `02.evlog-drain.ts` using `nitroApp.hooks.hookOnce("evlog:drain", ...)` that runs before the FS drain, OR restructure the drain pipeline. Add a comment explaining the ordering decision. For now, document that plugin enrichers/drains receive events after the built-in FS drain — this is the safer default. The enricher patches are additive and the FS drain captures the raw events.

- [ ] **Step 3: Commit**

```bash
git add server/plugins/08.plugins.ts server/plugins/02.evlog-drain.ts
git commit -m "feat(plugin): add Nitro startup plugin and evlog bridge integration"
```

---

### Task 14: Admin API — Plugin Management

**Files:**
- Create: All files in `server/api/admin/plugins/`

- [ ] **Step 1: GET /api/admin/plugins (list)**

`server/api/admin/plugins/index.get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const manager = getPluginManager();
  const plugins = manager.getPlugins();
  return plugins.map((p) => ({
    id: p.id,
    name: p.meta.name,
    version: p.meta.version,
    description: p.meta.description,
    author: p.meta.author,
    hooks: p.meta.hooks,
    status: p.status,
    order: p.order,
    configSchema: p.meta.config ?? [],
    hasConfig: (p.meta.config?.length ?? 0) > 0,
    error: p.error ?? null,
  }));
});
```

- [ ] **Step 2: GET /api/admin/plugins/:id (detail)**

`server/api/admin/plugins/[id].get.ts`:

Returns full plugin detail including current config values (password fields masked with `"****"`).

- [ ] **Step 3: POST enable, POST disable, PUT config, PUT order**

Create:
- `server/api/admin/plugins/[id]/enable.post.ts` — calls `manager.enablePlugin(id)`
- `server/api/admin/plugins/[id]/disable.post.ts` — calls `manager.disablePlugin(id)`
- `server/api/admin/plugins/[id]/config.put.ts` — reads body, calls `manager.updateConfig(id, body)`
- `server/api/admin/plugins/order.put.ts` — reads `{ order: string[] }`, calls `manager.updateOrder(order)`

All routes call `requireAdmin(event)` first.

- [ ] **Step 4: POST host/restart, GET host/status**

- `server/api/admin/plugins/host/restart.post.ts` — calls `manager.restartHost()`
- `server/api/admin/plugins/host/status.get.ts` — returns `manager.getHostStatus()`

- [ ] **Step 5: Commit**

```bash
git add server/api/admin/plugins/
git commit -m "feat(plugin): add admin API for plugin management"
```

---

### Task 15: Admin API — Logs

**Files:**
- Create: Log-related API files

- [ ] **Step 1: GET /api/admin/plugins/:id/logs/stream (SSE)**

`server/api/admin/plugins/[id]/logs/stream.get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const query = getQuery(event);

  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache");
  setResponseHeader(event, "Connection", "keep-alive");

  const manager = getPluginManager();
  const logManager = manager.getLogManager();

  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = logManager.subscribe(id, controller, {
        level: query.level as string | undefined,
        type: query.type as string | undefined,
      });

      // Clean up on client disconnect
      event.node.req.on("close", () => {
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream);
});
```

**Performance:** SSE uses `ReadableStream` — no polling, backpressure-aware. `subscribe` returns an unsubscribe function for clean teardown.

- [ ] **Step 2: GET history, DELETE logs, GET download**

- `server/api/admin/plugins/[id]/logs/history.get.ts` — reads query params `before`, `limit`, `level`, `type`, calls `logManager.getHistory()`
- `server/api/admin/plugins/[id]/logs/index.delete.ts` — calls `logManager.clearLogs(id)`
- `server/api/admin/plugins/[id]/logs/download.get.ts` — reads `?date=`, streams JSONL file

- [ ] **Step 3: Commit**

```bash
git add server/api/admin/plugins/[id]/logs/
git commit -m "feat(plugin): add admin API for plugin logs (SSE, history, download)"
```

---

### Task 16: Admin API — System Settings

**Files:**
- Create: `server/api/admin/plugins/settings.get.ts`
- Create: `server/api/admin/plugins/settings.put.ts`

- [ ] **Step 1: Implement settings endpoints**

`GET` returns `getSettingsByCategory("plugin.system")`.

`PUT` accepts `{ watcher: boolean, logBufferSize: number, logRetentionDays: number }`, validates, calls `setSetting()` for each. If `watcher` changed, start/stop the file watcher on the PluginManager.

- [ ] **Step 2: Commit**

```bash
git add server/api/admin/plugins/settings.get.ts server/api/admin/plugins/settings.put.ts
git commit -m "feat(plugin): add admin API for plugin system settings"
```

---

## Phase 4: Smoke Test & Verification

### Task 17: End-to-End Smoke Test

**Files:**
- Create: `irminsul-data/plugins/test-enricher/plugin.yaml`
- Create: `irminsul-data/plugins/test-enricher/index.js`

- [ ] **Step 1: Create a test plugin**

```yaml
# plugin.yaml
name: test-enricher
version: 0.1.0
description: Smoke test enricher
author: test
hooks:
  - evlog:enricher
config:
  - key: prefix
    label: Prefix
    type: text
    default: "[test]"
```

```js
// index.js
export function setup(ctx) {
  const { prefix } = ctx.config.getAll();
  ctx.log.info("Test enricher loaded", { prefix });

  ctx.hook("evlog:enricher", (events) => {
    return events.map(() => ({ testPrefix: prefix || "[test]" }));
  });

  ctx.hook("app:started", () => {
    ctx.log.info("Test enricher started");
  });

  ctx.hook("app:shutdown", () => {
    ctx.log.info("Test enricher shutting down");
  });
}
```

- [ ] **Step 2: Start dev server and verify**

Run: `bun run dev`

Verify:
1. Server starts without errors
2. Plugin discovered in startup logs (disabled by default)
3. `GET /api/admin/plugins` returns the test plugin with status "disabled"
4. `POST /api/admin/plugins/test-enricher/enable` → status 200
5. `GET /api/admin/plugins/test-enricher` → status "enabled"
6. `GET /api/admin/plugins/host/status` → "running"
7. Trigger some requests → check that enricher patches appear in events
8. `GET /api/admin/plugins/test-enricher/logs/history` → see plugin logs
9. `POST /api/admin/plugins/test-enricher/disable` → marks dirty
10. `GET /api/admin/plugins/host/status` → "dirty"
11. `POST /api/admin/plugins/host/restart` → restarts, dirty cleared

- [ ] **Step 3: Clean up test plugin (or keep as example), commit**

```bash
git add -A
git commit -m "feat(plugin): complete plugin system implementation with smoke test"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 1 | 1-5 | Core types, condition evaluator, ring buffer, YAML parser, config validator — all pure logic with unit tests |
| Phase 2 | 6-11 | Hook registry, log manager, Plugin Host Worker, IPC bridge, file watcher, orchestrator |
| Phase 3 | 12-16 | Settings init, Nitro plugin, Admin API (management, logs, settings) |
| Phase 4 | 17 | End-to-end smoke test with a real plugin |

**Total: 17 tasks**, each independently committable. Phase 1 is fully TDD with unit tests. Phase 2-3 are implementation-focused with integration verification in Phase 4.
