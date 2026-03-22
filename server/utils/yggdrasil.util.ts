/**
 * 移除 UUID 中的连字符
 * "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" -> "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 */
export function stripUuidHyphens(uuid: string): string {
  return uuid.replace(/-/g, "");
}

/**
 * 为 32 位 hex 字符串添加连字符
 * "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -> "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 */
export function addUuidHyphens(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildProperty(
  name: string,
  value: string,
): { name: string; value: string; signature?: string } {
  const property: { name: string; value: string; signature?: string } = {
    name,
    value,
  };

  const signature = signSha1(value);
  if (signature) {
    property.signature = signature;
  }

  return property;
}
