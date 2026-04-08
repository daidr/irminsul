export const OAUTH_SCOPES = {
  "profile:read": "读取基础档案（UUID、游戏 ID、皮肤、披风）",
  "profile:write": "修改材质（上传/删除皮肤和披风）",
  "email:read": "读取邮箱地址",
  "account:read": "读取账户信息（注册时间、封禁状态等）",
} as const;

export type OAuthScope = keyof typeof OAUTH_SCOPES;

export const VALID_SCOPES = Object.keys(OAUTH_SCOPES) as OAuthScope[];

export const CLIENT_CREDENTIALS_ALLOWED_SCOPES: OAuthScope[] = ["profile:read"];

export type OAuthClientType = "confidential" | "public";

export type OAuthGrantType =
  | "authorization_code"
  | "client_credentials"
  | "refresh_token";

export interface OAuthAuthorizationCodeData {
  clientId: string;
  userId: string;
  scopes: OAuthScope[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: number;
}
