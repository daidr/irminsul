import type { ObjectId } from "mongodb";

export interface SettingDocument {
  _id: ObjectId;
  /** 配置键，格式: "category.name"，如 "smtp.host" */
  key: string;
  /** 配置值 */
  value: unknown;
  /** 配置来源，内置为 "irminsul.builtin" */
  source: string;
}
