#!/usr/bin/env bun
/**
 * Irminsul 交互式初始化/迁移脚本
 *
 * 用法: bun cli/src/init.ts  (开发)
 *       bun cli/dist/init.js (构建后)
 *
 * 支持两种模式:
 * 1. 全新安装 — 配置 MongoDB、Redis 等，生成 .env
 * 2. 从 GHAuth 迁移 — 导入旧配置/用户/皮肤，生成 .env
 */

import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { input, confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";

// ─── GHAuth config types ─────────────────────────────────────────────────────

interface GHAuthConfig {
  common: {
    sitename?: string;
    description?: string;
    showAnnouncement?: boolean;
    ignoreEmailVerification?: boolean;
    url?: string;
  };
  extra: {
    port?: number;
    slat?: string;
    mongodb: {
      host: string;
      port: number;
      db: string;
      hasAuth?: boolean;
      username?: string;
      password?: string;
    };
    redis?: {
      host?: string;
      port?: number;
      sessiondb?: number;
      authdb?: number;
    };
    skinDomains?: string[];
    smtp?: {
      host?: string;
      port?: number;
      secure?: boolean;
      auth?: {
        user?: string;
        pass?: string;
      };
    };
  };
}

interface GHAuthUser {
  id?: number;
  email?: string;
  verified?: boolean;
  playername?: string;
  uuid?: string;
  password?: string;
  skin?: {
    type?: number;
    hash?: string;
  };
  isBanned?: boolean;
  tokens?: unknown[];
  ip?: {
    register?: string;
    lastLogged?: string;
  };
  time?: {
    register?: number;
    lastLogged?: number;
  };
}

// ─── Config types ────────────────────────────────────────────────────────────

interface IrminsulConfig {
  IRMIN_DB_URL: string;
  IRMIN_DB_NAME: string;
  IRMIN_REDIS_URL: string;
  IRMIN_REDIS_SCOPE: string;
  HOST: string;
  PORT: string;
  IRMIN_PUBLIC_SITE_NAME: string;
  IRMIN_LEGACY_GLOBAL_SALT: string;
  IRMIN_EVLOG_SAMPLING_INFO: string;
  IRMIN_EVLOG_SAMPLING_DEBUG: string;
  IRMIN_EVLOG_MAX_FILES: string;
  IRMIN_YGGDRASIL_BASE_URL: string;
  IRMIN_YGGDRASIL_SKIN_DOMAINS: string;
  IRMIN_YGGDRASIL_TOKEN_EXPIRY_MS: string;
  IRMIN_YGGDRASIL_DEFAULT_SKIN_HASH: string;
  IRMIN_WEBAUTHN_RP_ID: string;
  IRMIN_WEBAUTHN_ORIGIN: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function buildMongoUrl(cfg: GHAuthConfig["extra"]["mongodb"]): string {
  const { host, port, db, hasAuth, username, password } = cfg;
  if (hasAuth && username && password) {
    return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  return `mongodb://${host}:${port}`;
}

function formatUuid(uuid: string): string {
  if (uuid.length === 32 && !uuid.includes("-")) {
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
  }
  return uuid;
}

function generateEnvContent(config: IrminsulConfig): string {
  return `# Irminsul Configuration (auto-generated)

# Database
IRMIN_DB_URL=${config.IRMIN_DB_URL}
IRMIN_DB_NAME=${config.IRMIN_DB_NAME}
IRMIN_REDIS_URL=${config.IRMIN_REDIS_URL}
IRMIN_REDIS_SCOPE=${config.IRMIN_REDIS_SCOPE}

# Server
HOST=${config.HOST}
PORT=${config.PORT}
IRMIN_PUBLIC_SITE_NAME=${config.IRMIN_PUBLIC_SITE_NAME}

# Legacy password compatibility
IRMIN_LEGACY_GLOBAL_SALT=${config.IRMIN_LEGACY_GLOBAL_SALT}

# Logging
IRMIN_EVLOG_SAMPLING_INFO=${config.IRMIN_EVLOG_SAMPLING_INFO}
IRMIN_EVLOG_SAMPLING_DEBUG=${config.IRMIN_EVLOG_SAMPLING_DEBUG}
IRMIN_EVLOG_MAX_FILES=${config.IRMIN_EVLOG_MAX_FILES}

# Yggdrasil
IRMIN_YGGDRASIL_BASE_URL=${config.IRMIN_YGGDRASIL_BASE_URL}
IRMIN_YGGDRASIL_SKIN_DOMAINS=${config.IRMIN_YGGDRASIL_SKIN_DOMAINS}
IRMIN_YGGDRASIL_TOKEN_EXPIRY_MS=${config.IRMIN_YGGDRASIL_TOKEN_EXPIRY_MS}
IRMIN_YGGDRASIL_DEFAULT_SKIN_HASH=${config.IRMIN_YGGDRASIL_DEFAULT_SKIN_HASH}

# Passkey
IRMIN_WEBAUTHN_RP_ID=${config.IRMIN_WEBAUTHN_RP_ID}
IRMIN_WEBAUTHN_ORIGIN=${config.IRMIN_WEBAUTHN_ORIGIN}
`;
}

// ─── Migration: read GHAuth config files ─────────────────────────────────────

async function readGHAuthConfig(configDir: string): Promise<{
  config: GHAuthConfig;
  adminList: string[];
  announcement: string;
}> {
  const configPath = path.join(configDir, "config.yml");
  const configContent = await fs.readFile(configPath, "utf-8");
  const config = parseYaml(configContent) as GHAuthConfig;

  let adminList: string[] = [];
  const adminListPath = path.join(configDir, "adminList.yml");
  try {
    const adminContent = await fs.readFile(adminListPath, "utf-8");
    const parsed = parseYaml(adminContent);
    if (Array.isArray(parsed)) {
      adminList = parsed as string[];
    }
  } catch {
    // no admin list
  }

  let announcement = "";
  const announcementPath = path.join(configDir, "announcement.md");
  try {
    announcement = await fs.readFile(announcementPath, "utf-8");
  } catch {
    // no announcement
  }

  return { config, adminList, announcement };
}

// ─── Migration: copy skins ──────────────────────────────────────────────────

async function copySkins(srcDir: string, destDir: string): Promise<number> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir);
  const pngFiles = entries.filter((f) => f.endsWith(".png"));

  let copied = 0;
  for (const file of pngFiles) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    await fs.copyFile(src, dest);
    copied++;
  }
  return copied;
}

// ─── Migration: migrate users from GHAuth MongoDB ───────────────────────────

interface SkippedUser {
  email: string;
  playername: string;
  reason: string;
}

interface MigrationResult {
  total: number;
  skipped: number;
  inserted: number;
  duplicates: number;
  skippedUsers: SkippedUser[];
  duplicateUsers: string[];
}

async function migrateUsers(
  ghauthMongoUrl: string,
  ghauthDbName: string,
  newMongoUrl: string,
  newDbName: string,
  adminEmails: string[],
): Promise<MigrationResult> {
  const oldClient = new MongoClient(ghauthMongoUrl);
  const newClient = new MongoClient(newMongoUrl);

  try {
    await oldClient.connect();
    await newClient.connect();

    const oldDb = oldClient.db(ghauthDbName);
    const newDb = newClient.db(newDbName);

    const oldUsers = oldDb.collection<GHAuthUser>("users");
    const newUsers = newDb.collection("users");

    // Ensure indexes
    await newUsers.createIndex({ email: 1 }, { unique: true });
    await newUsers.createIndex({ gameId: 1 }, { unique: true });
    await newUsers.createIndex({ uuid: 1 }, { unique: true });
    await newUsers.createIndex({ "skin.hash": 1 }, { sparse: true });
    await newUsers.createIndex({ "cape.hash": 1 }, { sparse: true });
    await newUsers.createIndex(
      { "passkeys.credentialId": 1 },
      { unique: true, partialFilterExpression: { "passkeys.credentialId": { $exists: true } } },
    );
    await newUsers.createIndex(
      { "oauthBindings.provider": 1, "oauthBindings.providerId": 1 },
      { unique: true, sparse: true },
    );

    const allOldUsers = await oldUsers.find({}).toArray();
    const adminEmailSet = new Set(adminEmails.map((e) => e.toLowerCase()));

    const result: MigrationResult = {
      total: allOldUsers.length,
      skipped: 0,
      inserted: 0,
      duplicates: 0,
      skippedUsers: [],
      duplicateUsers: [],
    };

    if (allOldUsers.length === 0) {
      return result;
    }

    const docsToInsert: Record<string, unknown>[] = [];
    let hasAdmin = false;

    for (const old of allOldUsers) {
      if (!old.email || !old.playername || !old.uuid || !old.password) {
        const missing: string[] = [];
        if (!old.email) missing.push("email");
        if (!old.playername) missing.push("playername");
        if (!old.uuid) missing.push("uuid");
        if (!old.password) missing.push("password");
        result.skipped++;
        result.skippedUsers.push({
          email: old.email ?? "(无)",
          playername: old.playername ?? "(无)",
          reason: `缺少字段: ${missing.join(", ")}`,
        });
        continue;
      }

      const uuid = formatUuid(old.uuid);
      const email = old.email.toLowerCase();
      const isAdmin = adminEmailSet.has(email);
      if (isAdmin) hasAdmin = true;

      docsToInsert.push({
        gameId: old.playername,
        email,
        emailVerified: old.verified ?? false,
        uuid,
        passwordHash: old.password,
        hashVersion: "legacy",
        skin: old.skin?.hash
          ? {
              type: (old.skin.type === 1 ? 1 : 0) as 0 | 1,
              hash: old.skin.hash,
            }
          : null,
        cape: null,
        bans: old.isBanned
          ? [
              {
                id: crypto.randomUUID(),
                start: new Date(),
                reason: "migrated from GHAuth (was banned)",
                operatorId: "system",
              },
            ]
          : [],
        tokens: [],
        passkeys: [],
        oauthBindings: [],
        isAdmin,
        ip: {
          register: old.ip?.register ?? null,
          lastLogged: old.ip?.lastLogged ?? null,
        },
        time: {
          register: old.time?.register ? new Date(old.time.register) : new Date(),
          lastLogged: old.time?.lastLogged ? new Date(old.time.lastLogged) : null,
        },
      });
    }

    // 如果没有找到 admin 邮箱匹配的用户，将第一个用户设为管理员
    if (!hasAdmin && docsToInsert.length > 0) {
      docsToInsert[0].isAdmin = true;
    }

    if (docsToInsert.length === 0) {
      return result;
    }

    try {
      const insertResult = await newUsers.insertMany(docsToInsert, { ordered: false });
      result.inserted = insertResult.insertedCount;
    } catch (err: unknown) {
      const bulkErr = err as {
        insertedCount?: number;
        code?: number;
        writeErrors?: { index: number }[];
      };
      if (bulkErr.code === 11000) {
        result.inserted = bulkErr.insertedCount ?? 0;
        result.duplicates = docsToInsert.length - result.inserted;
        // 收集重复用户的标识信息
        if (bulkErr.writeErrors) {
          for (const we of bulkErr.writeErrors) {
            const doc = docsToInsert[we.index];
            if (doc) {
              result.duplicateUsers.push(`${doc.email as string} (${doc.gameId as string})`);
            }
          }
        }
      } else {
        throw err;
      }
    }

    return result;
  } finally {
    await oldClient.close();
    await newClient.close();
  }
}

// ─── Migration: import settings ─────────────────────────────────────────────

async function importSettings(
  mongoUrl: string,
  dbName: string,
  ghConfig: GHAuthConfig,
  announcement: string,
): Promise<void> {
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db(dbName);
    const settings = db.collection("settings");
    await settings.createIndex({ key: 1 }, { unique: true });

    const source = "irminsul.builtin";
    const smtp = ghConfig.extra.smtp;
    const settingsData: { key: string; value: unknown }[] = [
      { key: "smtp.host", value: smtp?.host ?? "" },
      { key: "smtp.port", value: smtp?.port ?? 465 },
      { key: "smtp.secure", value: smtp?.secure ?? true },
      { key: "smtp.user", value: smtp?.auth?.user ?? "" },
      { key: "smtp.pass", value: smtp?.auth?.pass ?? "" },
      {
        key: "smtp.from",
        value: smtp?.auth?.user
          ? `${ghConfig.common.sitename ?? "Irminsul"} <${smtp.auth.user}>`
          : "",
      },
      {
        key: "auth.requireEmailVerification",
        value: !(ghConfig.common.ignoreEmailVerification ?? false),
      },
      {
        key: "general.announcement",
        value: ghConfig.common.showAnnouncement ? announcement.trim() : "",
      },
      { key: "plugin.system.registry", value: [] },
      { key: "plugin.system.watcher", value: true },
      { key: "plugin.system.logBufferSize", value: 200 },
      { key: "plugin.system.logRetentionDays", value: 7 },
    ];

    const ops = settingsData.map(({ key, value }) => ({
      updateOne: {
        filter: { key },
        update: { $setOnInsert: { key, value, source } },
        upsert: true,
      },
    }));
    await settings.bulkWrite(ops);
  } finally {
    await client.close();
  }
}

// ─── Fresh install: initialize settings ─────────────────────────────────────

async function initDefaultSettings(mongoUrl: string, dbName: string): Promise<void> {
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db(dbName);
    const settings = db.collection("settings");
    await settings.createIndex({ key: 1 }, { unique: true });

    const source = "irminsul.builtin";
    const defaults: { key: string; value: unknown }[] = [
      { key: "smtp.host", value: "" },
      { key: "smtp.port", value: 465 },
      { key: "smtp.secure", value: true },
      { key: "smtp.user", value: "" },
      { key: "smtp.pass", value: "" },
      { key: "smtp.from", value: "" },
      { key: "auth.requireEmailVerification", value: false },
      { key: "general.announcement", value: "" },
      { key: "plugin.system.registry", value: [] },
      { key: "plugin.system.watcher", value: true },
      { key: "plugin.system.logBufferSize", value: 200 },
      { key: "plugin.system.logRetentionDays", value: 7 },
    ];

    const ops = defaults.map(({ key, value }) => ({
      updateOne: {
        filter: { key },
        update: { $setOnInsert: { key, value, source } },
        upsert: true,
      },
    }));
    await settings.bulkWrite(ops);
  } finally {
    await client.close();
  }
}

// ─── Validate MongoDB connectivity ──────────────────────────────────────────

async function testMongo(url: string, dbName: string): Promise<boolean> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

// ─── Validate Redis connectivity ────────────────────────────────────────────

async function testRedis(url: string): Promise<boolean> {
  try {
    const { RedisClient } = await import("bun");
    const client = new RedisClient(url);
    await client.send("PING", []);
    client.close();
    return true;
  } catch {
    return false;
  }
}

// ─── Spinner helper ─────────────────────────────────────────────────────────

function withSpinner(message: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(frames[i++ % frames.length])} ${message}`);
  }, 80);
  return {
    succeed(text: string) {
      clearInterval(timer);
      process.stdout.write(`\r  ${chalk.green("✓")} ${text}\n`);
    },
    fail(text: string) {
      clearInterval(timer);
      process.stdout.write(`\r  ${chalk.red("✗")} ${text}\n`);
    },
  };
}

// ─── Main flows ─────────────────────────────────────────────────────────────

async function freshInstall(): Promise<void> {
  console.log(`\n${chalk.bold.green("── 全新安装 ──")}\n`);

  // MongoDB
  console.log(chalk.bold("MongoDB 配置:"));
  const mongoUrl = await input({
    message: "MongoDB 连接 URL",
    default: "mongodb://localhost:27017",
  });
  const mongoDbName = await input({ message: "数据库名", default: "irmin" });

  const mongoSpinner = withSpinner("测试 MongoDB 连接...");
  if (await testMongo(mongoUrl, mongoDbName)) {
    mongoSpinner.succeed("MongoDB 连接成功");
  } else {
    mongoSpinner.fail("MongoDB 连接失败");
    if (!(await confirm({ message: "是否继续（可能配置有误）?", default: false }))) {
      process.exit(1);
    }
  }

  // Redis
  console.log(chalk.bold("\nRedis 配置:"));
  const redisUrl = await input({
    message: "Redis 连接 URL",
    default: "redis://localhost:6379/0",
  });
  const redisScope = await input({ message: "Redis key 前缀", default: "irmin" });

  const redisSpinner = withSpinner("测试 Redis 连接...");
  if (await testRedis(redisUrl)) {
    redisSpinner.succeed("Redis 连接成功");
  } else {
    redisSpinner.fail("Redis 连接失败");
    if (!(await confirm({ message: "是否继续（可能配置有误）?", default: false }))) {
      process.exit(1);
    }
  }

  // Site
  console.log(chalk.bold("\n站点配置:"));
  const siteName = await input({ message: "站点名称", default: "Irminsul" });
  const appPort = await input({ message: "监听端口", default: "12042" });
  const appHost = await input({ message: "监听地址", default: "0.0.0.0" });
  const baseUrl = await input({
    message: "站点 URL (Yggdrasil 基础 URL)",
    default: `http://localhost:${appPort}`,
  });

  const urlObj = new URL(baseUrl);
  const skinDomains = await input({
    message: "材质可信域名 (逗号分隔)",
    default: urlObj.host,
  });
  const webauthnRpId = await input({ message: "WebAuthn RP ID", default: urlObj.hostname });
  const webauthnOrigin = await input({
    message: "WebAuthn Origin",
    default: `${urlObj.protocol}//${urlObj.host}`,
  });

  const config: IrminsulConfig = {
    IRMIN_DB_URL: mongoUrl,
    IRMIN_DB_NAME: mongoDbName,
    IRMIN_REDIS_URL: redisUrl,
    IRMIN_REDIS_SCOPE: redisScope,
    HOST: appHost,
    PORT: appPort,
    IRMIN_PUBLIC_SITE_NAME: siteName,
    IRMIN_LEGACY_GLOBAL_SALT: "",
    IRMIN_EVLOG_SAMPLING_INFO: "100",
    IRMIN_EVLOG_SAMPLING_DEBUG: "0",
    IRMIN_EVLOG_MAX_FILES: "30",
    IRMIN_YGGDRASIL_BASE_URL: baseUrl,
    IRMIN_YGGDRASIL_SKIN_DOMAINS: skinDomains,
    IRMIN_YGGDRASIL_TOKEN_EXPIRY_MS: "432000000",
    IRMIN_YGGDRASIL_DEFAULT_SKIN_HASH:
      "9b155b4668427669ca9ed3828024531bc52fca1dcf8fbde8ccac3d9d9b53e3cf",
    IRMIN_WEBAUTHN_RP_ID: webauthnRpId,
    IRMIN_WEBAUTHN_ORIGIN: webauthnOrigin,
  };

  // Summary
  console.log(`\n${chalk.bold("── 配置摘要 ──")}`);
  console.log(`  MongoDB:    ${chalk.cyan(mongoUrl)} / ${chalk.cyan(mongoDbName)}`);
  console.log(`  Redis:      ${chalk.cyan(redisUrl)}`);
  console.log(`  站点名称:   ${chalk.cyan(siteName)}`);
  console.log(`  监听:       ${chalk.cyan(`${appHost}:${appPort}`)}`);
  console.log(`  站点 URL:   ${chalk.cyan(baseUrl)}`);

  if (!(await confirm({ message: "确认以上配置并开始初始化?" }))) {
    console.log(chalk.yellow("已取消。"));
    process.exit(0);
  }

  // Write .env
  const envPath = path.resolve(".env");
  await fs.writeFile(envPath, generateEnvContent(config), "utf-8");
  console.log(`  ${chalk.green("✓")} .env 已生成: ${chalk.dim(envPath)}`);

  // Create data dirs
  const dataDir = path.resolve("irminsul-data");
  for (const dir of ["log", "textures", "auto-generate", "plugins"]) {
    await fs.mkdir(path.join(dataDir, dir), { recursive: true });
  }
  console.log(`  ${chalk.green("✓")} 数据目录已创建`);

  // Init default settings
  const settingsSpinner = withSpinner("初始化默认设置...");
  await initDefaultSettings(mongoUrl, mongoDbName);
  settingsSpinner.succeed("默认设置初始化完成");

  console.log(
    `\n${chalk.bold.green("全新安装完成!")} 运行 ${chalk.cyan("bun run dev")} 启动开发服务器。\n`,
  );
}

async function migrateFromGHAuth(): Promise<void> {
  console.log(`\n${chalk.bold.green("── 从 GHAuth 迁移 ──")}\n`);

  // Step 1: GHAuth config directory
  console.log(chalk.bold("Step 1: 旧 GHAuth 配置"));
  const configDir = await input({
    message: "GHAuth 配置文件目录 (含 config.yml)",
    validate: async (val) => {
      if (!val) return "必须提供配置目录";
      try {
        await fs.access(path.join(val, "config.yml"));
        return true;
      } catch {
        return `未找到 ${path.join(val, "config.yml")}`;
      }
    },
  });

  const configSpinner = withSpinner("读取 GHAuth 配置...");
  const { config: ghConfig, adminList, announcement } = await readGHAuthConfig(configDir);
  configSpinner.succeed("GHAuth 配置读取成功");
  console.log(`    站点名称: ${chalk.cyan(ghConfig.common.sitename ?? "(无)")}`);
  console.log(
    `    管理员列表: ${chalk.cyan(adminList.length > 0 ? adminList.join(", ") : "(无)")}`,
  );
  console.log(
    `    公告: ${chalk.cyan(
      announcement ? announcement.slice(0, 50) + (announcement.length > 50 ? "..." : "") : "(无)",
    )}`,
  );

  // Step 2: GHAuth MongoDB
  console.log(chalk.bold("\nStep 2: GHAuth MongoDB 连接"));
  const ghauthMongoUrl = buildMongoUrl(ghConfig.extra.mongodb);
  const ghauthDbName = ghConfig.extra.mongodb.db;
  const confirmedGhauthUrl = await input({
    message: "GHAuth MongoDB URL",
    default: ghauthMongoUrl,
  });
  const confirmedGhauthDb = await input({
    message: "GHAuth 数据库名",
    default: ghauthDbName,
  });

  const ghauthSpinner = withSpinner("测试 GHAuth MongoDB 连接...");
  if (await testMongo(confirmedGhauthUrl, confirmedGhauthDb)) {
    ghauthSpinner.succeed("GHAuth MongoDB 连接成功");
  } else {
    ghauthSpinner.fail("GHAuth MongoDB 连接失败");
    if (!(await confirm({ message: "是否继续?", default: false }))) {
      process.exit(1);
    }
  }

  // Step 3: New Irminsul MongoDB (must be different)
  console.log(chalk.bold("\nStep 3: 新 Irminsul 数据库"));
  let newMongoUrl: string;
  let newDbName: string;
  while (true) {
    newMongoUrl = await input({
      message: "Irminsul MongoDB URL",
      default: confirmedGhauthUrl,
    });
    newDbName = await input({ message: "Irminsul 数据库名", default: "irmin" });

    if (newMongoUrl === confirmedGhauthUrl && newDbName === confirmedGhauthDb) {
      console.log(chalk.red("  新数据库不能与 GHAuth 数据库相同，请重新输入。"));
      continue;
    }
    break;
  }

  const newMongoSpinner = withSpinner("测试新 MongoDB 连接...");
  if (await testMongo(newMongoUrl, newDbName)) {
    newMongoSpinner.succeed("新 MongoDB 连接成功");
  } else {
    newMongoSpinner.fail("新 MongoDB 连接失败");
    if (!(await confirm({ message: "是否继续?", default: false }))) {
      process.exit(1);
    }
  }

  // Redis
  console.log(chalk.bold("\nRedis 配置:"));
  const redisUrl = await input({
    message: "Redis 连接 URL",
    default: "redis://localhost:6379/0",
  });
  const redisScope = await input({ message: "Redis key 前缀", default: "irmin" });

  const redisSpinner = withSpinner("测试 Redis 连接...");
  if (await testRedis(redisUrl)) {
    redisSpinner.succeed("Redis 连接成功");
  } else {
    redisSpinner.fail("Redis 连接失败");
    if (!(await confirm({ message: "是否继续?", default: false }))) {
      process.exit(1);
    }
  }

  // Step 4: Skin directory
  console.log(chalk.bold("\nStep 4: 皮肤目录"));
  const skinDir = await input({ message: "GHAuth 皮肤目录 (留空跳过)", default: "" });

  // Step 5: Site config
  console.log(chalk.bold("\nStep 5: 站点配置"));
  const siteName = await input({
    message: "站点名称",
    default: ghConfig.common.sitename ?? "Irminsul",
  });
  const appPort = await input({ message: "监听端口", default: "12042" });
  const appHost = await input({ message: "监听地址", default: "0.0.0.0" });
  const defaultBaseUrl = ghConfig.common.url ?? `http://localhost:${appPort}`;
  const baseUrl = await input({
    message: "站点 URL (Yggdrasil 基础 URL)",
    default: defaultBaseUrl,
  });

  const urlObj = new URL(baseUrl);
  const defaultSkinDomains = ghConfig.extra.skinDomains?.join(",") ?? urlObj.host;
  const skinDomains = await input({
    message: "材质可信域名 (逗号分隔)",
    default: defaultSkinDomains,
  });
  const webauthnRpId = await input({ message: "WebAuthn RP ID", default: urlObj.hostname });
  const webauthnOrigin = await input({
    message: "WebAuthn Origin",
    default: `${urlObj.protocol}//${urlObj.host}`,
  });

  const config: IrminsulConfig = {
    IRMIN_DB_URL: newMongoUrl,
    IRMIN_DB_NAME: newDbName,
    IRMIN_REDIS_URL: redisUrl,
    IRMIN_REDIS_SCOPE: redisScope,
    HOST: appHost,
    PORT: appPort,
    IRMIN_PUBLIC_SITE_NAME: siteName,
    IRMIN_LEGACY_GLOBAL_SALT: ghConfig.extra.slat ?? "",
    IRMIN_EVLOG_SAMPLING_INFO: "100",
    IRMIN_EVLOG_SAMPLING_DEBUG: "0",
    IRMIN_EVLOG_MAX_FILES: "30",
    IRMIN_YGGDRASIL_BASE_URL: baseUrl,
    IRMIN_YGGDRASIL_SKIN_DOMAINS: skinDomains,
    IRMIN_YGGDRASIL_TOKEN_EXPIRY_MS: "432000000",
    IRMIN_YGGDRASIL_DEFAULT_SKIN_HASH:
      "9b155b4668427669ca9ed3828024531bc52fca1dcf8fbde8ccac3d9d9b53e3cf",
    IRMIN_WEBAUTHN_RP_ID: webauthnRpId,
    IRMIN_WEBAUTHN_ORIGIN: webauthnOrigin,
  };

  // Summary
  console.log(`\n${chalk.bold("── 迁移摘要 ──")}`);
  console.log(
    `  GHAuth MongoDB: ${chalk.cyan(confirmedGhauthUrl)} / ${chalk.cyan(confirmedGhauthDb)}`,
  );
  console.log(`  新 MongoDB:     ${chalk.cyan(newMongoUrl)} / ${chalk.cyan(newDbName)}`);
  console.log(`  Redis:          ${chalk.cyan(redisUrl)}`);
  console.log(`  站点名称:       ${chalk.cyan(siteName)}`);
  console.log(`  监听:           ${chalk.cyan(`${appHost}:${appPort}`)}`);
  console.log(`  站点 URL:       ${chalk.cyan(baseUrl)}`);
  console.log(
    `  旧密码盐:       ${chalk.cyan(config.IRMIN_LEGACY_GLOBAL_SALT ? "(已保留)" : "(无)")}`,
  );
  if (skinDir) {
    console.log(`  皮肤目录:       ${chalk.cyan(skinDir)}`);
  }

  if (!(await confirm({ message: "确认以上配置并开始迁移?" }))) {
    console.log(chalk.yellow("已取消。"));
    process.exit(0);
  }

  // Execute migration
  console.log(`\n${chalk.bold("── 开始迁移 ──")}\n`);

  // 1. Write .env
  const envPath = path.resolve(".env");
  await fs.writeFile(envPath, generateEnvContent(config), "utf-8");
  console.log(`  ${chalk.green("✓")} .env 已生成`);

  // 2. Create data dirs
  const dataDir = path.resolve("irminsul-data");
  for (const dir of ["log", "textures", "auto-generate", "plugins"]) {
    await fs.mkdir(path.join(dataDir, dir), { recursive: true });
  }
  console.log(`  ${chalk.green("✓")} 数据目录已创建`);

  // 3. Copy skins
  if (skinDir) {
    const skinSpinner = withSpinner("复制皮肤文件...");
    try {
      const count = await copySkins(skinDir, path.join(dataDir, "textures"));
      skinSpinner.succeed(`皮肤文件复制完成 (${count} 个文件)`);
    } catch (err) {
      skinSpinner.fail(`皮肤复制失败: ${err}`);
      if (!(await confirm({ message: "跳过皮肤复制，继续?", default: true }))) {
        process.exit(1);
      }
    }
  }

  // 4. Migrate users
  const userSpinner = withSpinner("迁移用户数据...");
  try {
    const result = await migrateUsers(
      confirmedGhauthUrl,
      confirmedGhauthDb,
      newMongoUrl,
      newDbName,
      adminList,
    );
    userSpinner.succeed("用户数据迁移完成");
    console.log(`    GHAuth 总用户: ${result.total}`);
    console.log(`    成功导入: ${chalk.green(String(result.inserted))}`);
    if (result.skipped > 0) {
      console.log(`    跳过 (字段缺失): ${chalk.yellow(String(result.skipped))}`);
      for (const u of result.skippedUsers) {
        console.log(
          `      ${chalk.dim("·")} ${u.email} / ${u.playername} — ${chalk.dim(u.reason)}`,
        );
      }
    }
    if (result.duplicates > 0) {
      console.log(`    跳过 (重复): ${chalk.yellow(String(result.duplicates))}`);
      for (const desc of result.duplicateUsers) {
        console.log(`      ${chalk.dim("·")} ${desc}`);
      }
    }
  } catch (err) {
    userSpinner.fail(`用户迁移失败: ${err}`);
    if (!(await confirm({ message: "跳过用户迁移，继续?", default: true }))) {
      process.exit(1);
    }
  }

  // 5. Import settings
  const settingsSpinner = withSpinner("导入设置...");
  try {
    await importSettings(newMongoUrl, newDbName, ghConfig, announcement);
    settingsSpinner.succeed("设置导入完成");
  } catch (err) {
    settingsSpinner.fail(`设置导入失败: ${err}`);
  }

  console.log(
    `\n${chalk.bold.green("迁移完成!")} 运行 ${chalk.cyan("bun run dev")} 启动开发服务器。`,
  );
  console.log(chalk.dim("注意: 旧用户密码将在首次登录时自动升级为 argon2id。\n"));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log();
  console.log(chalk.bold("╔═════════════════════════════════════╗"));
  console.log(
    `${chalk.bold("║")}   ${chalk.green.bold("Irminsul")} ${chalk.dim("初始化向导")}               ${chalk.bold("║")}`,
  );
  console.log(chalk.bold("╚═════════════════════════════════════╝"));
  console.log();

  // Check if .env already exists
  try {
    await fs.access(path.resolve(".env"));
    console.log(chalk.yellow("检测到已存在 .env 文件。"));
    if (!(await confirm({ message: "继续将覆盖现有配置，是否继续?", default: false }))) {
      process.exit(0);
    }
  } catch {
    // No existing .env, good
  }

  const mode = await select({
    message: "请选择安装模式",
    choices: [
      { name: "全新安装 — 从零开始配置", value: "fresh" as const },
      { name: "从 GHAuth 迁移 — 导入旧数据和配置", value: "migrate" as const },
    ],
  });

  if (mode === "fresh") {
    await freshInstall();
  } else if (mode === "migrate") {
    await migrateFromGHAuth();
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n致命错误: ${err}`));
  process.exit(1);
});
