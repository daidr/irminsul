import type { ObjectId } from "mongodb";

/**
 * 密码哈希版本
 * - "legacy": HmacSHA256(SHA3(plaintext + 'dKfkZh').hex(), globalSalt)
 * - "argon2id": Bun.password.hash (argon2id)
 */
export type HashVersion = "legacy" | "argon2id";

/**
 * 皮肤模型: 0 = 默认 (Steve), 1 = 纤细 (Alex)
 */
export interface UserSkin {
  type: 0 | 1;
  hash: string;
}

/**
 * 披风数据
 */
export interface UserCape {
  hash: string;
}

/**
 * 封禁记录
 */
export interface BanRecord {
  /** 封禁开始时间 */
  start: Date;
  /** 封禁结束时间（不填表示永久） */
  end?: Date;
  /** 封禁原因 */
  reason?: string;
}

/**
 * 判断封禁记录列表中是否存在生效的封禁
 */
export function hasActiveBan(bans: BanRecord[]): boolean {
  const now = new Date();
  return bans?.some((ban) => ban.start <= now && (!ban.end || ban.end > now));
}

/**
 * Yggdrasil 令牌（存储在用户文档中）
 */
export interface YggdrasilToken {
  /** 访问令牌（UUID 无连字符） */
  accessToken: string;
  /** 客户端令牌 */
  clientToken: string;
  /** 状态: 0 = 失效, 1 = 有效 */
  status: 0 | 1;
  /** 创建时间（Unix 时间戳 ms） */
  createdAt: number;
  /** 启动器标签（如 "HMCL (3.10.4)"） */
  label: string;
  /** 创建时的客户端 IP */
  createdIp: string;
  /** 最后使用时的客户端 IP */
  lastUsedIp: string;
  /** 最后使用时间（Unix 时间戳 ms） */
  lastUsedAt: number;
}

/**
 * 通行密钥记录（WebAuthn credential）
 */
export interface PasskeyRecord {
  /** Base64URL 编码的凭证 ID */
  credentialId: string;
  /** Base64URL 编码的 COSE 公钥 */
  publicKey: string;
  /** 签名计数器（防重放） */
  counter: number;
  /** WebAuthn 传输方式 */
  transports?: string[];
  /** 显示名称（用户可重命名） */
  label: string;
  /** 是否支持跨设备同步（WebAuthn BE flag） */
  backupEligible: boolean;
  /** 当前是否已同步（WebAuthn BS flag） */
  backupState: boolean;
  /** 注册时间 */
  createdAt: Date;
  /** 最后使用时间 */
  lastUsedAt: Date;
}

/**
 * MongoDB 用户文档
 */
export interface UserDocument {
  _id: ObjectId;

  /** 游戏 ID / 玩家名（唯一），对应旧项目 playername */
  gameId: string;

  /** 邮箱（唯一，小写存储） */
  email: string;

  /** 邮箱是否已验证 */
  emailVerified: boolean;

  /** UUID（带连字符格式） */
  uuid: string;

  /** 密码哈希 */
  passwordHash: string;

  /** 哈希算法版本 */
  hashVersion: HashVersion;

  /** 皮肤数据 */
  skin: UserSkin | null;

  /** 披风数据 */
  cape: UserCape | null;

  /** 封禁记录列表（最新的在前） */
  bans: BanRecord[];

  /** Yggdrasil 令牌列表 */
  tokens: YggdrasilToken[];

  /** 通行密钥列表 */
  passkeys: PasskeyRecord[];

  /** 是否为管理员 */
  isAdmin: boolean;

  /** IP 记录 */
  ip: {
    register: string | null;
    lastLogged: string | null;
  };

  /** 时间记录 */
  time: {
    /** 注册时间 */
    register: Date;
    /** 最后登录时间 */
    lastLogged: Date | null;
  };
}
