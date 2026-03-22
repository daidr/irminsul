/**
 * 已知启动器 UA 正则匹配规则
 * 格式: "启动器名/版本号"
 */
const KNOWN_LAUNCHERS: { pattern: RegExp; name: string }[] = [
  { pattern: /^HMCL\/([\d.]+)/, name: "HMCL" },
  { pattern: /^PCL2?\/([\d.]+)/, name: "PCL2" },
  { pattern: /^BakaXL\/([\d.]+)/, name: "BakaXL" },
];

/**
 * 从 User-Agent 解析启动器标签
 * @returns 如 "HMCL (3.10.4)"、"PCL2 (2.12.2.50)"、"Unknown"
 */
export function parseLauncherLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown";

  for (const { pattern, name } of KNOWN_LAUNCHERS) {
    const match = userAgent.match(pattern);
    if (match?.[1]) {
      return `${name} (${match[1]})`;
    }
  }

  return "Unknown";
}
