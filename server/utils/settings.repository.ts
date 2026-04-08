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

export function getSetting(key: string): unknown {
  return getSettingsCache().get(key) ?? null;
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

/** 内置配置项及默认值 */
const BUILTIN_SETTINGS: Record<string, unknown> = {
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
