import { z } from "zod";

const bodySchema = z.object({
  category: z.string().optional(),
  values: z.record(z.string(), z.any()).optional(),
});

export default defineWebApiHandler(async (event) => {
  requireAdmin(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }

  const { category, values } = parsed.data;

  if (!category || !values) {
    webError("参数错误");
  }

  if (category === "smtp") {
    const host = values["smtp.host"];
    const port = values["smtp.port"];
    const secure = values["smtp.secure"];
    const user = values["smtp.user"];
    const pass = values["smtp.pass"];
    const from = values["smtp.from"];

    if (typeof host !== "string" || !host.trim()) {
      webError("SMTP 主机不能为空");
    }
    if (typeof port !== "number" || port < 1 || port > 65535) {
      webError("端口号须为 1-65535");
    }

    await setSetting("smtp.host", host.trim());
    await setSetting("smtp.port", port);
    await setSetting("smtp.secure", secure);
    await setSetting("smtp.user", user);
    await setSetting("smtp.pass", pass);
    await setSetting("smtp.from", from);

    return { success: true };
  }

  if (category === "auth") {
    const requireEmailVerification = values["auth.requireEmailVerification"];
    if (typeof requireEmailVerification !== "boolean") {
      webError("参数类型错误");
    }

    await setSetting("auth.requireEmailVerification", requireEmailVerification);
    return { success: true };
  }

  if (category === "general") {
    const announcement = values["general.announcement"];
    if (typeof announcement !== "string") {
      webError("参数类型错误");
    }

    await setSetting("general.announcement", announcement);
    return { success: true };
  }

  if (category === "oauth") {
    const enabled = values["oauth.enabled"];
    if (typeof enabled !== "boolean") {
      webError("参数类型错误");
    }

    await setSetting("oauth.enabled", enabled);
    return { success: true };
  }

  webError("未知的配置分类");
});
