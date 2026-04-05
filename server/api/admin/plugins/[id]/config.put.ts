import { z } from "zod";

const bodySchema = z.record(z.string(), z.any());

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const id = getRouterParam(event, "id")!;
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "参数格式错误" });
  }
  const manager = getPluginManager();
  const result = await manager.updateConfig(id, parsed.data);
  if (!result.ok) throw createError({ statusCode: 400, data: result.errors });
  return { ok: true };
});
