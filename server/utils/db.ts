import { RedisClient } from "bun";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";

// --- MongoDB ---
let _mongoClient: MongoClient | null = null;
let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    const config = useRuntimeConfig();
    _mongoClient = new MongoClient(config.dbUrl);
    _db = _mongoClient.db(config.dbName);
  }
  return _db;
}

export async function gracefulCloseDB(): Promise<void> {
  if (_mongoClient) {
    await _mongoClient.close();
    _mongoClient = null;
    _db = null;
  }
}

// --- Redis ---
let _redisClient: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!_redisClient) {
    const config = useRuntimeConfig();
    _redisClient = new RedisClient(config.redisUrl);
  }
  return _redisClient;
}

export async function gracefulCloseRedis(): Promise<void> {
  if (_redisClient) {
    _redisClient.close();
    _redisClient = null;
  }
}

export function buildRedisKey(...args: string[]): string {
  const config = useRuntimeConfig();
  const globalScope = config.redisScope || "irmin";
  const key = args.join(":");
  return `${globalScope}:${key}`;
}
