import { z } from "zod";

const bodySchema = z.object({
  watcher: z.boolean().optional(),
  logBufferSize: z.number().optional(),
  logRetentionDays: z.number().optional(),
});

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "参数格式错误" });
  }

  const { watcher, logBufferSize, logRetentionDays } = parsed.data;
  const manager = getPluginManager();

  if (typeof watcher === "boolean") {
    await setSetting("plugin.system.watcher", watcher, "irminsul.plugin");
    if (watcher) {
      manager.startWatcher();
    } else {
      manager.stopWatcher();
    }
  }

  if (typeof logBufferSize === "number" && logBufferSize > 0) {
    await setSetting("plugin.system.logBufferSize", logBufferSize, "irminsul.plugin");
  }

  if (typeof logRetentionDays === "number" && logRetentionDays > 0) {
    await setSetting("plugin.system.logRetentionDays", logRetentionDays, "irminsul.plugin");
  }

  return { ok: true };
});
