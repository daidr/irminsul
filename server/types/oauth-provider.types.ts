export const OAUTH_SCOPES = {
  "profile:read": "读取基础档案（UUID、游戏 ID、皮肤、披风）",
  "profile:write": "修改材质（上传/删除皮肤和披风）",
  "email:read": "读取邮箱地址",
  "account:base": "读取基础账户信息（邮箱验证状态、注册时间）",
  "account:ban": "读取封禁信息（当前封禁状态、完整封禁历史）",
} as const;

export type OAuthScope = keyof typeof OAUTH_SCOPES;

export const VALID_SCOPES = Object.keys(OAUTH_SCOPES) as OAuthScope[];

/** profile:read 为强制必选 scope */
export const REQUIRED_SCOPES: OAuthScope[] = ["profile:read"];

export const CLIENT_CREDENTIALS_ALLOWED_SCOPES: OAuthScope[] = ["profile:read"];

export type OAuthClientType = "confidential" | "public";

export type OAuthGrantType = "authorization_code" | "client_credentials" | "refresh_token";

export interface OAuthAuthorizationCodeData {
  clientId: string;
  userId: string;
  scopes: OAuthScope[];
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: "S256";
  createdAt: number;
}
