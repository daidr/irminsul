// 当前登录用户在客户端可见的形状——即 server/middleware/01.session.ts 写入
// event.context.user、并由 /api/auth/me 返回、useUser() 消费的对象。
// 作为前后端共享契约，避免前端各处用 any。

export interface ClientBanRecord {
  id?: string;
  /** 封禁开始时间（Unix ms） */
  start: number;
  /** 封禁结束时间（Unix ms，不填表示永久） */
  end?: number;
  reason?: string;
  operatorId?: string;
  /** 撤销时间（Unix ms，设置后表示已撤销） */
  revokedAt?: number;
}

export interface ClientOAuthBinding {
  provider: string;
  providerId: string;
  displayName: string;
  /** 绑定时间（Unix ms） */
  boundAt: number;
}

export interface ClientUser {
  // 来自 session
  userId: string;
  email: string;
  gameId: string;
  ip: string;
  ua: string;
  /** 登录时间（Unix ms） */
  loginAt: number;
  // 资料 / 材质
  skinHash?: string;
  skinSlim: boolean;
  hasCustomSkin: boolean;
  capeHash?: string;
  /** 注册时间（Unix ms） */
  registerAt: number | null;
  // 状态
  bans: ClientBanRecord[];
  isAdmin: boolean;
  isDeveloper: boolean;
  emailVerified: boolean;
  needsEmailVerification: boolean;
  oauthBindings: ClientOAuthBinding[];
}
