/**
 * 集中管理散落各处的魔法值，避免同一值在多处硬编码导致漂移。
 * 本文件位于 server/utils，由 Nitro 自动导入——server 上下文中可直接引用这些常量。
 */

// ─── 运行时数据目录（不入 git，由 server 插件在启动时创建）───
/** 运行时数据根目录 */
export const DATA_DIR = "./irminsul-data";
export const TEXTURES_DIR = `${DATA_DIR}/textures`;
export const LOG_DIR = `${DATA_DIR}/log`;
export const PLUGINS_DIR = `${DATA_DIR}/plugins`;
export const AUTO_GENERATE_DIR = `${DATA_DIR}/auto-generate`;
export const SECRETS_PATH = `${AUTO_GENERATE_DIR}/secrets.yaml`;
export const RSA_PRIVATE_KEY_PATH = `${AUTO_GENERATE_DIR}/yggdrasil-private.pem`;
export const RSA_PUBLIC_KEY_PATH = `${AUTO_GENERATE_DIR}/yggdrasil-public.pem`;

// ─── 密码 / 邮箱校验 ───
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── 材质上传 ───
/** OAuth / Yggdrasil 材质上传的二进制大小上限（1MB） */
export const MAX_TEXTURE_UPLOAD_SIZE = 1024 * 1024;

// ─── Yggdrasil ───
/** Yggdrasil 令牌默认有效期（5 天，ms）。与 nuxt.config runtimeConfig 的默认值保持一致。 */
export const DEFAULT_YGGDRASIL_TOKEN_EXPIRY_MS = 432_000_000;
