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
  type: "text" | "password" | "number" | "boolean" | "select" | "textarea" | "oauth-callback-url";
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
  /** 外部配置链接（仅 oauth-callback-url 类型使用） */
  url?: string;
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

export type PluginStatus = "disabled" | "enabled" | "error" | "loading" | "pending_disable";

export interface PluginRegistryEntry {
  id: string;
  enabled: boolean;
  order: number;
}

export interface PluginState {
  id: string;
  meta: PluginMeta;
  enabled: boolean;
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
    }
  | { type: "shutdown:done" };

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

export const LIFECYCLE_HOOKS = ["app:started", "app:shutdown", "config:changed"] as const;

export const KNOWN_FUNCTIONAL_HOOKS = [
  "evlog:enricher",
  "evlog:drain",
  "oauth:provider",
  "oauth:authorize",
  "oauth:map-profile",
  "oauth:exchange-token",
  "oauth:fetch-profile",
] as const;

export const KNOWN_EVENT_HOOKS = [
  "user:registered",
  "user:login",
  "user:ban-created",
  "user:ban-edited",
  "user:ban-revoked",
  "user:ban-deleted",
  "user:password-changed",
  "user:password-reset",
  "user:oauth-bindchanged",
] as const;

export const ALL_KNOWN_HOOKS = [
  ...LIFECYCLE_HOOKS,
  ...KNOWN_FUNCTIONAL_HOOKS,
  ...KNOWN_EVENT_HOOKS,
] as const;

export function isLifecycleHook(name: string): boolean {
  return (LIFECYCLE_HOOKS as readonly string[]).includes(name);
}

export function isKnownHook(name: string): boolean {
  return (ALL_KNOWN_HOOKS as readonly string[]).includes(name);
}

export function isEventHook(name: string): boolean {
  return (KNOWN_EVENT_HOOKS as readonly string[]).includes(name);
}

// ===== User Lifecycle Hook Payloads =====

export interface UserHookBasePayload {
  uuid: string;
  email: string;
  gameId: string;
  timestamp: number;
}

export interface UserRegisteredPayload extends UserHookBasePayload {
  ip: string | null;
}

export interface UserLoginPayload extends UserHookBasePayload {
  ip: string | null;
  method: "password" | "passkey" | "oauth";
}

export interface BanSnapshot {
  start: number;
  end?: number;
  reason?: string;
  revokedAt?: number;
  revokedBy?: string;
}

export interface BanHookBasePayload extends UserHookBasePayload {
  banId: string;
  operator: string;
}

export interface BanCreatedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
}

export interface BanEditedPayload extends BanHookBasePayload {
  old: BanSnapshot;
  new: BanSnapshot;
}

export interface BanRevokedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
}

export interface BanDeletedPayload extends BanHookBasePayload {
  ban: BanSnapshot;
  wasActive: boolean;
}

export interface UserPasswordChangedPayload extends UserHookBasePayload {
  ip: string | null;
}

export interface UserPasswordResetPayload extends UserHookBasePayload {
  ip: string | null;
}

export interface UserOAuthBindChangedPayload extends UserHookBasePayload {
  action: "bind" | "unbind";
  provider: string;
  displayName?: string;
}

export type UserHookPayloadMap = {
  "user:registered": UserRegisteredPayload;
  "user:login": UserLoginPayload;
  "user:ban-created": BanCreatedPayload;
  "user:ban-edited": BanEditedPayload;
  "user:ban-revoked": BanRevokedPayload;
  "user:ban-deleted": BanDeletedPayload;
  "user:password-changed": UserPasswordChangedPayload;
  "user:password-reset": UserPasswordResetPayload;
  "user:oauth-bindchanged": UserOAuthBindChangedPayload;
};
