import { createLogger } from "evlog";
import type { Collection } from "mongodb";
import type { SettingDocument } from "~~/server/types/settings.schema";

const COLLECTION_NAME = "settings";
const BUILTIN_SOURCE = "irminsul.builtin";

const CACHE_KEY = Symbol.for("irminsul.settingsCache");

function getSettingsCache(): Map<string, unknown> {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = new Map<string, unknown>();
  }
  return g[CACHE_KEY] as Map<string, unknown>;
}

export function getSettingsCollection(): Collection<SettingDocument> {
  return getDb().collection<SettingDocument>(COLLECTION_NAME);
}

export async function ensureSettingsIndexes(): Promise<void> {
  const col = getSettingsCollection();
  await col.createIndex({ key: 1 }, { unique: true });
  const log = createLogger({ category: "db" });
  log.set({ action: "ensureSettingsIndexes", status: "complete" });
  log.emit();
}

export async function loadSettingsCache(): Promise<void> {
  const docs = await getSettingsCollection().find().toArray();
  getSettingsCache().clear();
  for (const doc of docs) {
    getSettingsCache().set(doc.key, doc.value);
  }
  const log = createLogger({ category: "db" });
  log.set({ action: "loadSettingsCache", status: "complete", entries: docs.length });
  log.emit();
}

/**
 * 读取配置项。已知的内置键返回精确类型；未知/动态键（如 `plugin.custom.<id>.config`）返回 unknown。
 * 缓存未命中时回退到 BUILTIN_SETTINGS 默认值，使默认值只有这一个来源——调用方无需再写 `|| 默认值`。
 */
export function getSetting<K extends keyof SettingTypes>(key: K): SettingTypes[K];
export function getSetting(key: string): unknown;
export function getSetting(key: string): unknown {
  const cache = getSettingsCache();
  if (cache.has(key)) return cache.get(key);
  return (BUILTIN_SETTINGS as Record<string, unknown>)[key] ?? null;
}

export function getSettingsByCategory(category: string): Record<string, unknown> {
  const prefix = `${category}.`;
  const result: Record<string, unknown> = {};
  for (const [key, value] of getSettingsCache()) {
    if (key.startsWith(prefix)) {
      result[key] = value;
    }
  }
  return result;
}

export async function setSetting(
  key: string,
  value: unknown,
  source: string = BUILTIN_SOURCE,
): Promise<void> {
  await getSettingsCollection().updateOne(
    { key },
    { $set: { key, value, source } },
    { upsert: true },
  );
  getSettingsCache().set(key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  await getSettingsCollection().deleteOne({ key });
  getSettingsCache().delete(key);
}

export function getSettingsMap(keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (getSettingsCache().has(key)) {
      result[key] = getSettingsCache().get(key);
    }
  }
  return result;
}

/** 内置配置项的键 → 值类型映射（getSetting 的类型来源） */
export interface SettingTypes {
  "smtp.host": string;
  "smtp.port": number;
  "smtp.secure": boolean;
  "smtp.user": string;
  "smtp.pass": string;
  "smtp.from": string;
  "auth.requireEmailVerification": boolean;
  "general.announcement": string;
  "oauth.enabled": boolean;
  "oauth.accessTokenTtlMs": number;
  "oauth.refreshTokenTtlMs": number;
  "oauth.authorizationCodeTtlS": number;
  "plugin.system.registry": unknown[];
  "plugin.system.watcher": boolean;
  "plugin.system.logBufferSize": number;
  "plugin.system.logRetentionDays": number;
}

/** 内置配置项及默认值（默认值的唯一来源） */
const BUILTIN_SETTINGS: SettingTypes = {
  "smtp.host": "",
  "smtp.port": 465,
  "smtp.secure": true,
  "smtp.user": "",
  "smtp.pass": "",
  "smtp.from": "",
  "auth.requireEmailVerification": false,
  "general.announcement": "",
  "oauth.enabled": false,
  "oauth.accessTokenTtlMs": 3600000,
  "oauth.refreshTokenTtlMs": 2592000000,
  "oauth.authorizationCodeTtlS": 60,
  "plugin.system.registry": [],
  "plugin.system.watcher": true,
  "plugin.system.logBufferSize": 200,
  "plugin.system.logRetentionDays": 7,
};

/**
 * 初始化内置配置项（不覆盖已有值）
 */
export async function initBuiltinSettings(): Promise<void> {
  const col = getSettingsCollection();
  const ops = Object.entries(BUILTIN_SETTINGS).map(([key, value]) => ({
    updateOne: {
      filter: { key },
      update: { $setOnInsert: { key, value, source: BUILTIN_SOURCE } },
      upsert: true,
    },
  }));
  await col.bulkWrite(ops);
  const log = createLogger({ category: "db" });
  log.set({ action: "initBuiltinSettings", status: "complete" });
  log.emit();
}
